// 打印演示区：headless 打印内核（分页/页面构建/占位符求值/iframe 输出）+ DOM 薄壳
// 预览（openPrintPreview）的浏览器可验证路径。示例表超过一页（两行表头带合并单元格
// + 48 行数据），PrintSource 经 SheetStore 适配供数（「宿主/适配器供数」形态，meta
// 接入同款）；纸张/方向/缩放/分页模式（fitpage/fixrows 每页行数）配置入口即时合成
// PrintConfig。window.print 在示例内替换为计数桩（不弹系统对话框），打印按钮经
// printPages → 注入钩子汇到 window.print，计数与最近配置写入状态行；
// window.__DEMO__.print 暴露 getPrintCount/getLastPrintConfig 供冒烟判定。

import type { CellStyle, ListTableOptions } from '@infinitable/core'
import {
  openPrintPreview,
  SheetStore,
  type PrintConfig,
  type PrintHooks,
  type PrintOrientation,
  type PrintPaperPreset,
  type PrintPagingMode,
  type PrintScaleMode,
  type PrintSource,
} from '@infinitable/plugins'

import { addButton, addStatus, createSection, mountTable, type DemoMount } from '../mount'

// ---- 示例数据维度（确定性生成，无随机） ----

/** 表头带行数（两行表头 = 每页重复表头行数） */
export const PRINT_HEADER_ROWS = 2
/** 数据行数（A4 纵向约 32 行/页 → 2 页起，fixrows/横向更多页） */
export const PRINT_DATA_ROWS = 48
/** 逐列宽度（合计 598 ≤ 屏上演示区 640；A4 纵向可用宽 698 装得下） */
const PRINT_COL_WIDTHS = [56, 84, 84, 104, 90, 90, 90] as const
/** 数值列（页脚「本页小计 {pageSum:4}」取销售额列） */
const SALES_COL = 4

const REGION_CITIES: ReadonlyArray<{ region: string; city: string }> = [
  { region: '华东', city: '上海' },
  { region: '华东', city: '杭州' },
  { region: '华北', city: '北京' },
  { region: '华北', city: '天津' },
  { region: '华南', city: '广州' },
  { region: '西南', city: '成都' },
]
const CATEGORIES = ['办公用品', '家居生活', '数码电器'] as const

/** 数据行取值（row 为源表行号，含表头带偏移） */
function dataRowValue(col: number, row: number): unknown {
  const seq = row - PRINT_HEADER_ROWS + 1
  const entry = REGION_CITIES[seq % REGION_CITIES.length]!
  if (col === 0) return seq
  if (col === 1) return entry.region
  if (col === 2) return entry.city
  if (col === 3) return CATEGORIES[seq % CATEGORIES.length]!
  const sales = 180 + ((row * 37) % 220) + (row % 3) * 60
  if (col === SALES_COL) return sales
  if (col === 5) return sales + 40 + (row % 7) * 5
  const qoq = ((row % 5) - 2) * 2.1
  return `${qoq > 0 ? '+' : ''}${qoq.toFixed(1)}%`
}

function headerBandStyle(): CellStyle {
  return {
    fontWeight: 700,
    textAlign: 'center',
    background: '#eef2f7',
    border: { bottom: { width: 2, color: '#64748b' } },
  }
}

/** 表头带两行的格值（上行整列字段 + 「指标」横跨；下行指标细分，纵合并客格空） */
const HEADER_TOP_CELLS: Array<[number, string]> = [
  [0, '序号'],
  [1, '区域'],
  [2, '城市'],
  [3, '品类'],
  [4, '指标（Q3）'],
]
const HEADER_SUB_CELLS: Array<[number, string]> = [
  [SALES_COL, '销售额'],
  [5, '目标'],
  [6, '环比'],
]

/** SheetStore → PrintSource 适配（types.ts P1 注释的宿主适配形态） */
function createPrintSource(store: SheetStore): PrintSource {
  return {
    name: '2026 Q3 销售明细（打印示例）',
    rowCount: store.getRowCount(),
    colCount: store.getColCount(),
    rowHeight: (row) => store.getRowHeight(row),
    colWidth: (col) => store.getColWidth(col),
    merges: () => store.getMerges(),
    cellValue: (col, row) => store.getValue(col, row),
    cellStyle: (col, row) => store.getEffectiveStyle(col, row),
    displayValue: (col, row) => store.getDisplayValue(col, row),
  }
}

// ---- 演示区装配 ----

export interface PrintDemo {
  mount: DemoMount
  /** window.print 桩计数（打印按钮真实触发 print 链路 ≥1 即通过） */
  getPrintCount(): number
  /** 最近一次打印的完整配置（null = 尚未打印） */
  getLastPrintConfig(): PrintConfig | null
}

/** 配置入口当前值（预览/打印按钮每次点击时合成） */
interface PrintSettings {
  paper: PrintPaperPreset
  orientation: PrintOrientation
  scale: PrintScaleMode
  paging: PrintPagingMode
  fixRows: number
}

/** 控件行内联样式（不进共享 style.css：打印区自包含，同 watermark 区形态） */
function styleControlRow(row: HTMLLabelElement): void {
  row.style.display = 'flex'
  row.style.alignItems = 'center'
  row.style.gap = '10px'
  row.style.margin = '8px 0'
  const caption = row.firstElementChild as HTMLElement | null
  if (caption) {
    caption.style.flex = '0 0 72px'
    caption.style.fontSize = '12px'
    caption.style.color = 'var(--text-2)'
  }
  const input = row.querySelector<HTMLElement>('select, input')
  if (input) {
    input.style.flex = '0 0 150px'
  }
}

function addControlRow(section: HTMLElement, label: string): HTMLLabelElement {
  const row = document.createElement('label')
  row.className = 'print-control'
  row.appendChild(document.createElement('span')).textContent = label
  section.appendChild(row)
  return row
}

function addSelect<T extends string>(
  section: HTMLElement,
  label: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T,
  onChange: (value: T) => void,
): void {
  const row = addControlRow(section, label)
  const select = document.createElement('select')
  for (const option of options) {
    const optionElement = document.createElement('option')
    optionElement.value = option.value
    optionElement.textContent = option.label
    select.appendChild(optionElement)
  }
  select.value = value
  select.addEventListener('change', () => onChange(select.value as T))
  row.appendChild(select)
  styleControlRow(row)
}

/** 纸张标注（状态行显示用；预设代号或自定义 mm 尺寸） */
function paperLabel(paper: PrintConfig['paperSize']): string {
  if (paper === undefined) {
    return 'A4'
  }
  return typeof paper === 'object' ? `自定义 ${paper.widthMm}×${paper.heightMm}mm` : paper
}

export function mountPrint(root: HTMLElement): PrintDemo {
  const section = createSection(
    root,
    '打印预览与输出',
    'headless 打印内核 + DOM 薄壳预览：分页（fitpage 按页高 / fixrows 固定行数补空行）、每页重复两行' +
      '表头、页眉页脚占位符（{title}/{date}/{page}/{pageCount} 与页级聚合 {pageSum:4}）。示例表超过一页，' +
      '「打印预览」打开缩略列表 + 当前页放大预览弹层；window.print 已替换为计数桩，点打印按钮后状态行' +
      '与 window.__DEMO__.print 可读取调用计数与最近配置。',
  )

  // ---- 数据面：SheetStore 灌入表头带 + 48 行数据（单一事实源，屏上表格与打印共用） ----
  const rowCount = PRINT_HEADER_ROWS + PRINT_DATA_ROWS
  const store = new SheetStore({
    rowCount,
    colCount: PRINT_COL_WIDTHS.length,
    defaultColWidth: 90,
    defaultRowHeight: 30,
  })
  for (const [col, text] of HEADER_TOP_CELLS) {
    store.setValue(col, 0, text)
    store.setStyle(col, 0, headerBandStyle())
  }
  for (const [col, text] of HEADER_SUB_CELLS) {
    store.setValue(col, 1, text)
    store.setStyle(col, 1, headerBandStyle())
  }
  for (let row = PRINT_HEADER_ROWS; row < rowCount; row++) {
    for (let col = 0; col < PRINT_COL_WIDTHS.length; col++) {
      store.setValue(col, row, dataRowValue(col, row))
    }
    const qoq = dataRowValue(6, row) as string
    if (qoq.startsWith('-')) {
      store.setStyle(6, row, { color: '#dc2626' })
    }
  }
  // 整列字段纵合并（表头带两行）+「指标」横跨三列
  store.setMerges([
    ...[0, 1, 2, 3].map((col) => ({ startCol: col, endCol: col, startRow: 0, endRow: 1 })),
    { startCol: SALES_COL, endCol: 6, startRow: 0, endRow: 0 },
  ])
  for (const [col, width] of PRINT_COL_WIDTHS.entries()) {
    store.setColWidth(col, width)
  }

  // ---- 屏上演示表格（只读渲染：样式走模型侧有效样式读取面） ----
  const readonlyOptions: Partial<ListTableOptions> = {
    resolveEditable: () => false,
    canResizeCol: () => false,
    canResizeRow: () => false,
  }
  const mount = mountTable(section, {
    width: 640,
    height: 320,
    columns: PRINT_COL_WIDTHS.map((width, col) => ({ title: `C${col}`, width })),
    model: store.asModel(),
    resolveCellStyle: (col, row) => store.getEffectiveStyle(col, row) ?? null,
    showColHeader: false,
    showRowHeader: false,
    rowHeight: 30,
    ...readonlyOptions,
  })
  mount.table.setMergeCells([...store.getMerges()])
  mount.table.setFrozenRowCount(PRINT_HEADER_ROWS)

  const source = createPrintSource(store)

  // ---- 配置入口（每次打开预览/打印时合成 PrintConfig） ----
  const settings: PrintSettings = {
    paper: 'A4',
    orientation: 'portrait',
    scale: 'origin',
    paging: 'fitpage',
    fixRows: 12,
  }
  const buildConfig = (): PrintConfig => ({
    paperSize: settings.paper,
    orientation: settings.orientation,
    scale: settings.scale,
    paging: settings.paging,
    fixRows: settings.paging === 'fixrows' ? settings.fixRows : undefined,
    headerRepeatRows: PRINT_HEADER_ROWS,
    headerFooter: {
      header: { left: '{title}', right: '{date} {time}' },
      footer: { left: '本页小计 {pageSum:4}', center: '第 {page} 页 / 共 {pageCount} 页' },
    },
  })

  // ---- 打印桩：替换 window.print 计数真实调用（打印链路终态汇到此处） ----
  let printCount = 0
  let lastPrintConfig: PrintConfig | null = null
  window.print = () => {
    printCount++
    lastPrintConfig = buildConfig()
    refreshStatus()
  }
  const printHooks: PrintHooks = {
    print: () => {
      window.print()
    },
  }

  const status = addStatus(section)
  const refreshStatus = (): void => {
    const last = lastPrintConfig
    status.textContent =
      `打印调用 ${printCount} 次` +
      (last
        ? `；最近：${paperLabel(last.paperSize)} ${last.orientation ?? 'portrait'}` +
          ` ${last.paging ?? 'fitpage'}` +
          `${last.paging === 'fixrows' ? `（每页 ${last.fixRows ?? '-'} 行）` : ''}` +
          ` ${last.scale ?? 'origin'}`
        : '；尚未打印（打开预览后点打印按钮）')
  }
  refreshStatus()

  addSelect(
    section,
    '纸张',
    [
      { value: 'A4', label: 'A4' },
      { value: 'A5', label: 'A5' },
      { value: 'Letter', label: 'Letter' },
      { value: 'A3', label: 'A3' },
    ],
    settings.paper,
    (paper) => {
      settings.paper = paper
    },
  )
  addSelect(
    section,
    '方向',
    [
      { value: 'portrait', label: '纵向' },
      { value: 'landscape', label: '横向' },
    ],
    settings.orientation,
    (orientation) => {
      settings.orientation = orientation
    },
  )
  addSelect(
    section,
    '缩放',
    [
      { value: 'origin', label: '原始尺寸' },
      { value: 'fit-width', label: '适配页宽' },
    ],
    settings.scale,
    (scale) => {
      settings.scale = scale
    },
  )
  addSelect(
    section,
    '分页模式',
    [
      { value: 'fitpage', label: 'fitpage 按页高' },
      { value: 'fixrows', label: 'fixrows 固定行数' },
    ],
    settings.paging,
    (paging) => {
      settings.paging = paging
    },
  )
  const fixRowsRow = addControlRow(section, '每页行数')
  const fixRowsInput = document.createElement('input')
  fixRowsInput.type = 'number'
  fixRowsInput.min = String(PRINT_HEADER_ROWS + 1)
  fixRowsInput.max = '40'
  fixRowsInput.value = String(settings.fixRows)
  fixRowsInput.addEventListener('change', () => {
    const parsed = Number(fixRowsInput.value)
    if (Number.isFinite(parsed) && parsed > PRINT_HEADER_ROWS) {
      settings.fixRows = Math.trunc(parsed)
      refreshStatus()
    }
  })
  fixRowsRow.appendChild(fixRowsInput)
  styleControlRow(fixRowsRow)

  addButton(section, '打印预览', () => {
    openPrintPreview(source, buildConfig(), printHooks)
  })

  return {
    mount,
    getPrintCount: () => printCount,
    getLastPrintConfig: () => lastPrintConfig,
  }
}
