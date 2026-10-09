// 工具栏写路径（按钮与弹层 UI 由 React 工具栏渲染）：
// 写路径统一走 @infinitable/sheet 模型命令（样式片段 setCellStyles / 合并 mergeCells /
// 边框预设 buildBorderPresetItems，均为单命令 = 单 undo 单元），视图刷新由模型事件联动。

import type { ListTable } from '@infinitable/core'

import {
  buildBorderPresetItems,
  type BorderEdge,
  type BorderPreset,
  type CellStyle,
  type CellStylePatch,
  type Sheet,
} from '@infinitable/sheet'

/** 边框线型 / 预设（模型五线型 + 八预设） */
export type BorderLineStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted'

/** 填充/字色共用色板（7 列 × 5 行） */
export const PALETTE: readonly string[] = [
  '#000000',
  '#7f7f7f',
  '#880015',
  '#ed1c24',
  '#ff7f27',
  '#fff200',
  '#22b14c',
  '#00a2e8',
  '#3f48cc',
  '#a349a4',
  '#ffffff',
  '#c3c3c3',
  '#b97a57',
  '#ffc000',
  '#92d050',
  '#00b050',
  '#00b0f0',
  '#0070c0',
  '#002060',
  '#7030a0',
  '#f2dcdb',
  '#e5e0ec',
  '#d8e4bc',
  '#dbe5f1',
  '#fde9d9',
  '#f2f2f2',
  '#bfbfbf',
  '#595959',
  '#404040',
  '#5b9bd5',
  '#ed7d31',
  '#a5a5a5',
  '#4472c4',
  '#70ad47',
  '#264478',
]

/** 字号档位（模型字号单位 pt；渲染 ×4/3 转 px） */
export const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32] as const

/** 边框线型（模型 BorderLineStyle 直用；BORDER_STYLE_WIDTH 定宽） */
export const LINE_STYLES: ReadonlyArray<{ id: BorderLineStyle; label: string }> = [
  { id: 'thin', label: '细线' },
  { id: 'medium', label: '中粗线' },
  { id: 'thick', label: '粗线' },
  { id: 'dashed', label: '虚线' },
  { id: 'dotted', label: '点线' },
]

/** 线型 + 颜色 → 模型边定义（BORDER_STYLE_WIDTH 默认线宽） */
export function borderEdgeOf(line: BorderLineStyle, color: string): BorderEdge {
  return { style: line, width: line === 'thick' ? 3 : line === 'medium' ? 2 : 1, color }
}

export interface ToolbarActionsDeps {
  table: () => ListTable
  store: () => Sheet
  notify: (text: string, kind?: 'info' | 'warn') => void
  /** 按钮态刷新（写入完成后调用，React 工具栏重读焦点格样式） */
  refreshStates: () => void
}

export interface ToolbarActions {
  selectionBounds(): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null
  focusCellStyle(): CellStyle | undefined
  /** 对选区逐格套用片段：mode=toggle 时若选区内全部已含同值属性则移除（null 字段删除） */
  applyFragment(fragment: CellStylePatch, mode: 'toggle' | 'set'): void
  /** 移除选区样式的指定键（无填充/自动字色等「清除」语义） */
  applyRemoveKeys(keys: 'fill' | 'color'): void
  clearFormat(): void
  mergeSelection(): void
  unmergeSelection(): void
  /** 浮动图片插入（锚定焦点格，跨 2×2 格；字节/类型由调用方解析） */
  insertFloatImage(input: { data: Uint8Array; type: 'png' | 'jpeg' | 'gif' | 'svg' | 'webp' }): void
  /** 边框预设写入选区（逐格补丁由 buildBorderPresetItems 展开，单命令落撤销栈） */
  applyBorderPreset(preset: BorderPreset, edge: BorderEdge): void
}

export function createToolbarActions(deps: ToolbarActionsDeps): ToolbarActions {
  const selectionBounds = () => {
    const range = deps.table().getSelectedCellRanges()[0]
    if (!range) {
      return null
    }
    return {
      minCol: Math.min(range.start.col, range.end.col),
      maxCol: Math.max(range.start.col, range.end.col),
      minRow: Math.min(range.start.row, range.end.row),
      maxRow: Math.max(range.start.row, range.end.row),
    }
  }

  /** 当前焦点格（选区首段锚点） */
  const focusCell = (): { col: number; row: number } | null => {
    const bounds = selectionBounds()
    return bounds ? { col: bounds.minCol, row: bounds.minRow } : null
  }

  const focusCellStyle = (): CellStyle | undefined => {
    const focus = focusCell()
    return focus ? deps.store().getCellStyle({ row: focus.row, col: focus.col }) : undefined
  }

  /** 值相等判定：对象值按结构比较（toggle 判定不依赖引用） */
  const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) {
      return true
    }
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      return JSON.stringify(a) === JSON.stringify(b)
    }
    return false
  }

  /** toggle 的「全命中」判定：逐字段比较（fill.color / font.* / align.* / numFmt） */
  const allMatch = (
    bounds: NonNullable<ReturnType<typeof selectionBounds>>,
    fragment: CellStylePatch,
  ): boolean => {
    const store = deps.store()
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const style = store.getCellStyle({ row, col })
        if (fragment.fill !== undefined) {
          if (!sameValue(style?.fill?.color, fragment.fill.color)) {
            return false
          }
        }
        for (const [family, patch] of [
          ['font', fragment.font],
          ['align', fragment.align],
        ] as const) {
          if (patch === undefined) {
            continue
          }
          for (const [field, value] of Object.entries(patch)) {
            const current =
              style?.[family]?.[field as keyof (CellStyle['font'] & CellStyle['align'])]
            if (!sameValue(current, value)) {
              return false
            }
          }
        }
        if (fragment.numFmt !== undefined && !sameValue(style?.numFmt, fragment.numFmt)) {
          return false
        }
      }
    }
    return true
  }

  /** 片段取反（toggle 全命中时）：对象族整体置空 / 未提供族忽略 */
  const negateFragment = (fragment: CellStylePatch): CellStylePatch => {
    const negated: CellStylePatch = {}
    if (fragment.fill !== undefined) negated.fill = {}
    if (fragment.font !== undefined) {
      negated.font = Object.fromEntries(
        Object.keys(fragment.font).map((key) => [key, null]),
      ) as CellStylePatch['font']
    }
    if (fragment.align !== undefined) {
      negated.align = Object.fromEntries(
        Object.keys(fragment.align).map((key) => [key, null]),
      ) as CellStylePatch['align']
    }
    if (fragment.numFmt !== undefined) negated.numFmt = null
    return negated
  }

  /** 对选区逐格套用片段：mode=toggle 时若选区内全部已含同值属性则移除 */
  const applyFragment = (fragment: CellStylePatch, mode: 'toggle' | 'set'): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const removing = mode === 'toggle' && allMatch(bounds, fragment)
    const patch = removing ? negateFragment(fragment) : fragment
    const store = deps.store()
    store.setCellStyles(rangeAddrs(bounds).map((addr) => ({ addr, partial: patch })))
    const label = STYLE_LABELS[styleLabelKey(fragment) ?? ''] ?? '样式'
    deps.notify(`${removing ? '已取消' : '已应用'}${label}`)
    deps.refreshStates()
  }

  /** 移除选区样式的指定键（无填充/自动字色等「清除」语义） */
  const applyRemoveKeys = (keys: 'fill' | 'color'): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const patch: CellStylePatch = keys === 'fill' ? { fill: {} } : { font: { color: null } }
    const store = deps.store()
    store.setCellStyles(rangeAddrs(bounds).map((addr) => ({ addr, partial: patch })))
    deps.refreshStates()
  }

  /**
   * 边框预设写入选区：逐格补丁由 buildBorderPresetItems 展开（8 预设语义对齐 ultra-ui，
   * 共享边同步邻居），一次 setCellStyles = 单 undo 单元。
   */
  const applyBorderPreset = (preset: BorderPreset, edge: BorderEdge): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const store = deps.store()
    const range = {
      start: { row: bounds.minRow, col: bounds.minCol },
      end: { row: bounds.maxRow, col: bounds.maxCol },
    }
    const items = buildBorderPresetItems(range, preset, edge, (addr) => store.getCellStyle(addr))
    store.setCellStyles(items.map((item) => ({ addr: item.addr, partial: item.patch })))
    deps.notify(preset === 'none' ? '已清除边框' : '已应用边框')
  }

  const clearFormat = (): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    deps.store().clearCellStyle({
      start: { row: bounds.minRow, col: bounds.minCol },
      end: { row: bounds.maxRow, col: bounds.maxCol },
    })
    deps.notify('已清除选区格式')
    deps.refreshStates()
  }

  const mergeSelection = (): void => {
    const bounds = selectionBounds()
    if (!bounds || (bounds.minCol === bounds.maxCol && bounds.minRow === bounds.maxRow)) {
      deps.notify('请先选择多格区域', 'warn')
      return
    }
    deps.store().mergeCells({
      start: { row: bounds.minRow, col: bounds.minCol },
      end: { row: bounds.maxRow, col: bounds.maxCol },
    })
    deps.notify('已合并选区')
  }

  const unmergeSelection = (): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      return
    }
    deps.store().unmergeCells({
      start: { row: bounds.minRow, col: bounds.minCol },
      end: { row: bounds.maxRow, col: bounds.maxCol },
    })
    deps.notify('已取消合并')
  }

  const insertFloatImage = (input: {
    data: Uint8Array
    type: 'png' | 'jpeg' | 'gif' | 'svg' | 'webp'
  }): void => {
    const focus = focusCell()
    const col = focus?.col ?? 0
    const row = focus?.row ?? 0
    deps.store().insertImage({
      data: input.data,
      type: input.type,
      anchor: {
        from: { row, col, offsetX: 2, offsetY: 2 },
        to: { row: row + 2, col: col + 2 },
      },
      title: '插入图片',
    })
    deps.notify('已插入图片')
  }

  return {
    selectionBounds,
    focusCellStyle,
    applyFragment,
    applyRemoveKeys,
    clearFormat,
    mergeSelection,
    unmergeSelection,
    insertFloatImage,
    applyBorderPreset,
  }
}

/** 选区边界 → 逐格地址清单 */
function rangeAddrs(bounds: {
  minCol: number
  maxCol: number
  minRow: number
  maxRow: number
}): Array<{ row: number; col: number }> {
  const addrs: Array<{ row: number; col: number }> = []
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      addrs.push({ row, col })
    }
  }
  return addrs
}

/** 单字段片段 → 提示用中文名（toggle/set 通知文案） */
const STYLE_LABELS: Record<string, string> = {
  'fill.color': '填充色',
  'font.color': '字体颜色',
  'font.bold': '加粗',
  'font.italic': '斜体',
  'font.underline': '下划线',
  'font.strikethrough': '删除线',
  'font.size': '字号',
  'align.horizontal': '对齐',
  'align.vertical': '垂直对齐',
  'align.wrap': '自动换行',
}

/** 片段 → 标签键（取首个设置族的首个字段） */
function styleLabelKey(fragment: CellStylePatch): string | undefined {
  if (fragment.fill?.color !== undefined) {
    return 'fill.color'
  }
  for (const [family, patch] of [
    ['font', fragment.font],
    ['align', fragment.align],
  ] as const) {
    if (patch === undefined) {
      continue
    }
    const field = Object.keys(patch)[0]
    if (field) {
      return `${family}.${field}`
    }
  }
  return undefined
}

/** 图片文件 → data: URL（插入浮动图片的文件读取段） */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取文件失败')))
    reader.readAsDataURL(file)
  })
}

/** 图片文件（data: URL）→ 模型图片字节（非 data: URL 返回 null） */
export function dataUrlToImage(
  url: string,
): { data: Uint8Array; type: 'png' | 'jpeg' | 'gif' | 'svg' | 'webp' } | null {
  const match = /^data:image\/(png|jpeg|gif|svg\+xml|webp);base64,(.+)$/i.exec(url)
  if (!match) {
    return null
  }
  const raw = atob(match[2]!)
  const data = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) {
    data[index] = raw.charCodeAt(index)
  }
  return {
    data,
    type:
      match[1]!.toLowerCase() === 'svg+xml'
        ? 'svg'
        : (match[1]!.toLowerCase() as 'png' | 'jpeg' | 'gif' | 'webp'),
  }
}
