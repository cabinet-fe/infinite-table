// 工具栏写路径（mountToolbar 的操作语义原样迁移；按钮与弹层 UI 由 React 工具栏渲染）：
// 写路径统一走 Store 格级样式 + resolveCellStyle hook + batchUpdate 收敛刷新。

import {
  normalizeRange,
  type CellBorderEdge,
  type CellStyle,
  type ListTable,
} from '@infinitable/core'

import type { SheetPluginHandle } from '@infinitable/plugins'

import { mergeBounds, unmergeAt } from '../../../sections/sheet/ops'
import type { SheetStore } from '../../../sections/sheet/book'

/** 边框线型 / 预设（sheet 插件 handle 边框方法的参数面） */
export type BorderLineStyle = Parameters<SheetPluginHandle['borderEdge']>[0]
export type BorderPreset = Parameters<SheetPluginHandle['borderCells']>[1]

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

/** 字号档位（pt 标注语义，落 Store 为 fontSize 像素数值） */
export const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32] as const

/** 边框线型（边定义由 sheet 插件 handle.borderEdge 映射：thin/medium/thick→solid 1/2/3px，dashed/dotted 同名线型） */
export const LINE_STYLES: ReadonlyArray<{ id: BorderLineStyle; label: string }> = [
  { id: 'thin', label: '细线' },
  { id: 'medium', label: '中粗线' },
  { id: 'thick', label: '粗线' },
  { id: 'dashed', label: '虚线' },
  { id: 'dotted', label: '点线' },
]

/** 样式 key → 工具栏提示用中文名 */
const STYLE_LABELS: Record<string, string> = {
  fontWeight: '加粗',
  fontStyle: '斜体',
  underline: '下划线',
  lineThrough: '删除线',
  textAlign: '对齐',
  verticalAlign: '垂直对齐',
  background: '填充色',
  color: '字体颜色',
  fontSize: '字号',
  border: '边框',
  textWrap: '自动换行',
}

export interface ToolbarActionsDeps {
  table: () => ListTable
  store: () => SheetStore
  notify: (text: string, kind?: 'info' | 'warn') => void
  /** sheet 插件 handle（边框预设展开） */
  sheet: SheetPluginHandle
  /** 按钮态刷新（写入完成后调用，React 工具栏重读焦点格样式） */
  refreshStates: () => void
}

export interface ToolbarActions {
  selectionBounds(): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null
  focusCellStyle(): CellStyle | undefined
  /** 对选区逐格套用片段：mode=toggle 时若选区内全部已含同值属性则移除 */
  applyFragment(fragment: CellStyle, mode: 'toggle' | 'set'): void
  /** 移除选区样式的指定键（无填充/自动字色等「清除」语义） */
  applyRemoveKeys(keys: string[]): void
  clearFormat(): void
  mergeSelection(): void
  unmergeSelection(): void
  /** 浮动图片插入（锚定焦点格，跨 2×2 格） */
  insertFloatImage(src: string): void
  /** 边框预设写入选区（逐格片段由 sheet 插件 handle.borderCells 展开） */
  applyBorderPreset(preset: BorderPreset, edge: CellBorderEdge): void
}

export function createToolbarActions(deps: ToolbarActionsDeps): ToolbarActions {
  const selectionBounds = () => {
    const range = deps.table().getSelectedCellRanges()[0]
    return range ? normalizeRange(range) : null
  }

  /** 当前焦点格（选区首段锚点） */
  const focusCell = (): { col: number; row: number } | null => {
    const bounds = selectionBounds()
    return bounds ? { col: bounds.minCol, row: bounds.minRow } : null
  }

  const focusCellStyle = (): CellStyle | undefined => {
    const focus = focusCell()
    return focus ? deps.store().getStyle(focus.col, focus.row) : undefined
  }

  const refreshSelection = (bounds: {
    minCol: number
    maxCol: number
    minRow: number
    maxRow: number
  }): void => {
    deps.table().batchUpdate(() => {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          deps.table().refreshCell(col, row)
        }
      }
    })
  }

  /** 值相等判定：对象值（如 border）按结构比较（toggle 判定不依赖引用） */
  const sameValue = (a: unknown, b: unknown): boolean => {
    if (a === b) {
      return true
    }
    if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
      return JSON.stringify(a) === JSON.stringify(b)
    }
    return false
  }

  /** 移除选区样式的指定键（无填充/自动字色等「清除」语义） */
  const applyRemoveKeys = (keys: string[]): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const store = deps.store()
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const base = { ...store.getStyle(col, row) } as Record<string, unknown>
        for (const key of keys) {
          delete base[key]
        }
        if (Object.keys(base).length === 0) {
          store.clearStyle(col, row)
        } else {
          store.setStyle(col, row, base as CellStyle)
        }
      }
    }
    refreshSelection(bounds)
    deps.refreshStates()
  }

  /** 对选区逐格套用片段：mode=toggle 时若选区内全部已含同值属性则移除 */
  const applyFragment = (fragment: CellStyle, mode: 'toggle' | 'set'): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const key = Object.keys(fragment)[0]!
    const store = deps.store()
    let allMatch = mode === 'toggle'
    if (mode === 'toggle') {
      outer: for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
          const style = store.getStyle(col, row) as Record<string, unknown> | undefined
          if (!style || !sameValue(style[key], fragment[key as keyof CellStyle])) {
            allMatch = false
            break outer
          }
        }
      }
    }
    const removing = mode === 'toggle' && allMatch
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const base = { ...store.getStyle(col, row) } as Record<string, unknown>
        if (removing) {
          delete base[key]
        } else {
          Object.assign(base, fragment)
        }
        if (Object.keys(base).length === 0) {
          store.clearStyle(col, row)
        } else {
          store.setStyle(col, row, base as CellStyle)
        }
      }
    }
    refreshSelection(bounds)
    deps.notify(`${removing ? '已取消' : '已应用'}${STYLE_LABELS[key] ?? key}`)
    deps.refreshStates()
  }

  /**
   * 边框预设写入选区：逐格片段由 sheet 插件 handle.borderCells 展开（8 预设语义对齐 ultra-ui），
   * 写入按边级合并进既有 border（部分预设不丢其余边）；none 清除边框键。
   * 不做邻居共享边回写——core 共享边裁决保证单侧设置即正确显示；左/上邻居刷新由
   * refreshCell 联动覆盖（refreshSelection 只刷选区内）。
   */
  const applyBorderPreset = (preset: BorderPreset, edge: CellBorderEdge): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const store = deps.store()
    for (const item of deps.sheet.borderCells(bounds, preset, edge)) {
      const base = { ...store.getStyle(item.col, item.row) } as Record<string, unknown>
      if (item.border === null) {
        delete base.border
      } else {
        const existing = base.border as Record<string, unknown> | undefined
        base.border = { ...existing, ...item.border }
      }
      if (Object.keys(base).length === 0) {
        store.clearStyle(item.col, item.row)
      } else {
        store.setStyle(item.col, item.row, base as CellStyle)
      }
    }
    refreshSelection(bounds)
    deps.notify(preset === 'none' ? '已清除边框' : '已应用边框')
  }

  const clearFormat = (): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      deps.notify('无选区', 'warn')
      return
    }
    const store = deps.store()
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        store.clearStyle(col, row)
      }
    }
    refreshSelection(bounds)
    deps.notify('已清除选区格式')
    deps.refreshStates()
  }

  const mergeSelection = (): void => {
    const bounds = selectionBounds()
    if (!bounds || (bounds.minCol === bounds.maxCol && bounds.minRow === bounds.maxRow)) {
      deps.notify('请先选择多格区域', 'warn')
      return
    }
    const table = deps.table()
    try {
      table.setMergeCells([...deps.store().getMerges(), mergeBounds(bounds)])
      deps.store().setMerges([...deps.store().getMerges(), mergeBounds(bounds)])
      deps.notify('已合并选区')
    } catch (error) {
      deps.notify(`已拒绝：${(error as Error).message}`, 'warn')
    }
  }

  const unmergeSelection = (): void => {
    const bounds = selectionBounds()
    if (!bounds) {
      return
    }
    const kept = unmergeAt(deps.store(), bounds)
    deps.table().setMergeCells([...kept])
    deps.notify('已取消合并')
  }

  let floatSeq = 0
  const insertFloatImage = (src: string): void => {
    const focus = focusCell()
    const col = focus?.col ?? 0
    const row = focus?.row ?? 0
    floatSeq += 1
    deps.table().floatObjects.add({
      id: `sheet-float-${floatSeq}`,
      kind: 'image',
      anchor: { from: { col, row }, to: { col: col + 2, row: row + 2 }, offsetX: 2, offsetY: 2 },
      src,
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

/** 图片文件 → data: URL（插入浮动图片用） */
export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('读取文件失败')))
    reader.readAsDataURL(file)
  })
}
