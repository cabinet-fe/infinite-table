// 报表式只读快照渲染场景（meta 报表迁移参考形态）：
// 手写报表快照（SheetSnapshot）→ Sheet.restore 全量灌入模型（模型侧唯一事实源）→
// SheetGrid readonly 渲染（不注册编辑器 + 行列尺寸拖改全禁 + 不接填充/撤销写路径）。
// images/selection 随快照携带：浮动图由 SheetGrid 浮动图桥对齐模型、选区由选区控制器
// 初始同步落画布——与 meta 迁移时「服务端快照 → 灌模型 → 只读渲染」的形态一致，可整段照搬。
// 行列头关闭（showColHeader/showRowHeader false）：报表的表头带/标题行本身就是快照数据，
// 引擎级行列头对纯报表形态是多余的 Chrome。控件面（重灌按钮与状态行）由 ReportPage
// 以 shadcn 渲染，经 demo.reloadSnapshot 驱动。

import type { ListTable } from '@infinitable/core'
import { Sheet, SheetGrid, type SheetSnapshot } from '@infinitable/sheet'

// ---- 报表维度与口径常量（smoke 断言与快照 fixture 共用） ----

const REPORT_ROW_COUNT = 36
const REPORT_COL_COUNT = 8
/** 演示视口尺寸（全表 734px 列宽 + 余量） */
const REPORT_VIEW_WIDTH = 760
const REPORT_VIEW_HEIGHT = 360
/** 标题行 / 元信息行 / 表头带上 / 表头带下 / 数据首行 / 数据末行 / 合计行 */
export const REPORT_ROWS = {
  title: 0,
  meta: 1,
  headerTop: 2,
  headerSub: 3,
  dataFirst: 4,
  dataLast: 33,
  summary: 34,
} as const
/** 逐列宽度（合计 734 ≤ 视口 760：初始态无横向滚动） */
export const REPORT_COL_WIDTHS = [56, 90, 110, 110, 96, 96, 88, 88] as const
/** 标题带底色（smoke 像素断言用：合并区跨满 8 列即证明合并渲染生效） */
export const REPORT_TITLE_BACKGROUND = '#dbeafe'
/** 报表浮动图（锚定 from→to、无显式像素尺寸：随行列尺寸伸缩的口径示例） */
export const REPORT_FLOAT_IMAGE_ID = 'report-chart'
/**
 * 浮动图源（内联 SVG data URL）：SheetGrid 浮动图走引擎默认图片加载，
 * data URL 可直接命中，无需宿主注入自定义 loader。
 */
const REPORT_FLOAT_CHART_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="108" viewBox="0 0 180 108">' +
    '<rect width="180" height="108" fill="#f8fafc" stroke="#cbd5e1"/>' +
    '<rect x="16" y="62" width="20" height="34" fill="#60a5fa"/>' +
    '<rect x="46" y="46" width="20" height="50" fill="#3b82f6"/>' +
    '<rect x="76" y="54" width="20" height="42" fill="#60a5fa"/>' +
    '<rect x="106" y="30" width="20" height="66" fill="#2563eb"/>' +
    '<rect x="136" y="40" width="20" height="56" fill="#3b82f6"/>' +
    '<polyline points="26,52 56,38 86,44 116,22 146,32" fill="none" stroke="#dc2626" stroke-width="2"/>' +
    '</svg>',
)}`

// ---- 快照 fixture：确定性生成（经 Sheet API 装配后采集，九类负载全覆盖） ----

/** 区域 → 城市轮转表（30 行数据用） */
const REGION_CITIES: ReadonlyArray<{ region: string; city: string }> = [
  { region: '华东', city: '上海' },
  { region: '华东', city: '杭州' },
  { region: '华东', city: '苏州' },
  { region: '华东', city: '南京' },
  { region: '华北', city: '北京' },
  { region: '华北', city: '天津' },
  { region: '华北', city: '石家庄' },
  { region: '华南', city: '广州' },
  { region: '华南', city: '深圳' },
  { region: '华南', city: '厦门' },
  { region: '西南', city: '成都' },
  { region: '西南', city: '重庆' },
  { region: '西南', city: '昆明' },
]
const CATEGORIES = ['办公用品', '家居生活', '数码电器'] as const

/** 数据行取值（确定性：无随机） */
function dataRowCells(row: number): unknown[] {
  const entry = REGION_CITIES[(row - REPORT_ROWS.dataFirst) % REGION_CITIES.length]!
  const category = CATEGORIES[(row - REPORT_ROWS.dataFirst) % CATEGORIES.length]!
  const seq = row - REPORT_ROWS.dataFirst + 1
  const sales = 180 + ((row * 37) % 220) + (row % 3) * 60
  const target = sales + 40 + (row % 7) * 5
  const rate = `${((sales / target) * 100).toFixed(1)}%`
  // 环比轮转 -4.2/-2.1/0/+2.1/+4.2：保证出现负值格（负环比红字样式的对照面）
  const qoqValue = ((row % 5) - 2) * 2.1
  const qoq = `${qoqValue > 0 ? '+' : ''}${qoqValue.toFixed(1)}%`
  return [seq, entry.region, entry.city, category, sales, target, rate, qoq]
}

/** 合计行取值（对数据行求和/汇总） */
function summaryRowCells(): unknown[] {
  let sales = 0
  let target = 0
  for (let row = REPORT_ROWS.dataFirst; row <= REPORT_ROWS.dataLast; row++) {
    sales += dataRowCells(row)[4] as number
    target += dataRowCells(row)[5] as number
  }
  return [
    '合计',
    null,
    null,
    null,
    sales,
    target,
    `${((sales / target) * 100).toFixed(1)}%`,
    '+6.8%',
  ]
}

/**
 * 构造报表快照（cells/styles/merges/frozen/rowHeights/colWidths/colStyles/images/meta/selection）：
 * 经 Sheet 公共 API 装配后 snapshot() 采集——fixture 与 restore 往返共用同一序列化口径。
 */
function createReportSnapshot(): SheetSnapshot {
  const sheet = new Sheet('report')

  // ① 值：标题/元信息/表头带/数据行/合计行（先写值，合并命令按「保留首个有值格」清覆盖格）
  const values: Array<{ row: number; col: number; value: unknown }> = []
  const push = (col: number, row: number, value: unknown): void => {
    if (value !== null && value !== undefined) {
      values.push({ row, col, value })
    }
  }
  push(0, REPORT_ROWS.title, '2026 Q3 销售汇总报表')
  push(0, REPORT_ROWS.meta, '报表编号：RPT-2026-Q3')
  push(2, REPORT_ROWS.meta, '生成时间：2026-09-30 08:00')
  push(5, REPORT_ROWS.meta, '单位：万元（销售额 / 目标）')
  const headersTop: Array<[number, string]> = [
    [0, '序号'],
    [1, '区域'],
    [2, '城市'],
    [3, '品类'],
    [4, '指标（Q3）'],
  ]
  for (const [col, text] of headersTop) {
    push(col, REPORT_ROWS.headerTop, text)
  }
  const headersSub: Array<[number, string]> = [
    [4, '销售额'],
    [5, '目标'],
    [6, '完成率'],
    [7, '环比'],
  ]
  for (const [col, text] of headersSub) {
    push(col, REPORT_ROWS.headerSub, text)
  }
  for (let row = REPORT_ROWS.dataFirst; row <= REPORT_ROWS.dataLast; row++) {
    dataRowCells(row).forEach((value, col) => push(col, row, value))
  }
  summaryRowCells().forEach((value, col) => push(col, REPORT_ROWS.summary, value))
  sheet.setCells(
    values.map(({ row, col, value }) => ({
      addr: { row, col },
      data: {
        v: value as number | string,
        t: typeof value === 'number' ? ('n' as const) : ('s' as const),
      },
    })),
  )

  // ② 合并：标题横跨全表 + 元信息三段 + 表头带整列字段纵合并与「指标」横跨 + 合计行
  sheet.mergeCellsBatch([
    { start: { row: REPORT_ROWS.title, col: 0 }, end: { row: REPORT_ROWS.title, col: 7 } },
    { start: { row: REPORT_ROWS.meta, col: 0 }, end: { row: REPORT_ROWS.meta, col: 1 } },
    { start: { row: REPORT_ROWS.meta, col: 2 }, end: { row: REPORT_ROWS.meta, col: 4 } },
    { start: { row: REPORT_ROWS.meta, col: 5 }, end: { row: REPORT_ROWS.meta, col: 7 } },
    { start: { row: REPORT_ROWS.headerTop, col: 0 }, end: { row: REPORT_ROWS.headerSub, col: 0 } },
    { start: { row: REPORT_ROWS.headerTop, col: 1 }, end: { row: REPORT_ROWS.headerSub, col: 1 } },
    { start: { row: REPORT_ROWS.headerTop, col: 2 }, end: { row: REPORT_ROWS.headerSub, col: 2 } },
    { start: { row: REPORT_ROWS.headerTop, col: 3 }, end: { row: REPORT_ROWS.headerSub, col: 3 } },
    { start: { row: REPORT_ROWS.headerTop, col: 4 }, end: { row: REPORT_ROWS.headerTop, col: 7 } },
    { start: { row: REPORT_ROWS.summary, col: 0 }, end: { row: REPORT_ROWS.summary, col: 3 } },
  ])

  // ③ 样式：格级（标题/元信息/表头带/负环比/合计行）+ 数值列右对齐（colStyles 列级）
  const metaStyle = { font: { italic: true, color: '#64748b' }, fill: { color: '#f8fafc' } }
  const summaryStyle = {
    font: { bold: true },
    fill: { color: '#f1f5f9' },
    border: { top: { style: 'medium' as const, width: 2, color: '#334155' } },
  }
  const styleItems = [
    // 标题：加粗居中大字（12pt = 16px）+ 浅蓝底
    {
      addr: { row: REPORT_ROWS.title, col: 0 },
      partial: {
        fill: { color: REPORT_TITLE_BACKGROUND },
        font: { bold: true, size: 12, color: '#1d4ed8' },
        align: { horizontal: 'center' as const },
      },
    },
    // 元信息行：斜体灰字 + 浅灰底
    { addr: { row: REPORT_ROWS.meta, col: 0 }, partial: metaStyle },
    { addr: { row: REPORT_ROWS.meta, col: 2 }, partial: metaStyle },
    { addr: { row: REPORT_ROWS.meta, col: 5 }, partial: metaStyle },
    // 表头带：居中加粗 + 底部粗分隔线
    ...[0, 1, 2, 3, 4].map((col) => ({
      addr: { row: REPORT_ROWS.headerTop, col },
      partial: headerBandStyle(),
    })),
    ...[4, 5, 6, 7].map((col) => ({
      addr: { row: REPORT_ROWS.headerSub, col },
      partial: headerBandStyle(),
    })),
    // 负环比格红字（环比值为负号开头的格）
    ...negativeQoqRows().map((row) => ({
      addr: { row, col: 7 },
      partial: { font: { color: '#dc2626' } },
    })),
    // 合计行：加粗 + 顶部粗边 + 浅灰底
    ...Array.from({ length: REPORT_COL_COUNT }, (_, col) => ({
      addr: { row: REPORT_ROWS.summary, col },
      partial: summaryStyle,
    })),
  ]
  sheet.setCellStyles(styleItems)
  for (const col of [4, 5, 6, 7]) {
    sheet.setColStyle(col, { align: { horizontal: 'right' } })
  }

  // ④ 冻结报表头四行（标题/元信息/表头带两行）；不冻结列：全表 734px 无横向滚动
  sheet.setFrozen(4, 0)
  sheet.setRowHeight(REPORT_ROWS.title, 42)
  sheet.setRowHeight(REPORT_ROWS.summary, 36)
  REPORT_COL_WIDTHS.forEach((width, col) => sheet.setColWidth(col, width))

  // ⑤ Cell Meta：模板绑定（模板字段 → 引擎格位）与报表级（模板标识与版本）
  const bindingFields: Array<[number, number, string]> = [
    [1, REPORT_ROWS.headerTop, 'region'],
    [2, REPORT_ROWS.headerTop, 'city'],
    [3, REPORT_ROWS.headerTop, 'category'],
    [4, REPORT_ROWS.headerSub, 'sales'],
    [5, REPORT_ROWS.headerSub, 'target'],
    [6, REPORT_ROWS.headerSub, 'completion'],
    [7, REPORT_ROWS.headerSub, 'qoq'],
  ]
  for (const [col, row, field] of bindingFields) {
    sheet.setCellMeta({ row, col }, 'binding', { field })
  }
  sheet.setCellMeta({ row: REPORT_ROWS.title, col: 0 }, 'report', {
    template: 'quarterly-sales',
    version: 3,
  })

  // ⑥ 浮动图（锚定 from→to、无显式像素尺寸：随行列尺寸伸缩）
  sheet.insertImage({
    id: REPORT_FLOAT_IMAGE_ID,
    data: new Uint8Array(0),
    type: 'svg',
    anchor: {
      from: { col: 5, row: REPORT_ROWS.dataFirst + 12, offsetX: 4, offsetY: 4 },
      to: { col: 7, row: REPORT_ROWS.summary - 2 },
    },
    src: REPORT_FLOAT_CHART_SRC,
    title: 'Q3 销售趋势（示意）',
  })

  // ⑦ 选区：合计行为当前查看焦点（readonly 报表的「查看位置」随快照恢复）
  sheet.selectRange({
    start: { row: REPORT_ROWS.summary, col: 0 },
    end: { row: REPORT_ROWS.summary, col: 7 },
  })

  return sheet.snapshot()
}

function headerBandStyle() {
  return {
    font: { bold: true },
    align: { horizontal: 'center' as const },
    fill: { color: '#eef2f7' },
    border: { bottom: { style: 'medium' as const, width: 2, color: '#64748b' } },
  }
}

/** 负环比行（环比值为负号开头的格） */
function negativeQoqRows(): number[] {
  const rows: number[] = []
  for (let row = REPORT_ROWS.dataFirst; row <= REPORT_ROWS.dataLast; row++) {
    const qoq = dataRowCells(row)[7] as string
    if (qoq.startsWith('-')) {
      rows.push(row)
    }
  }
  return rows
}

// ---- 演示区装配 ----

export interface ReportDemo {
  container: HTMLElement
  grid: SheetGrid
  sheet: Sheet
  /** 重灌快照（替换语义：静默全量还原，对账后一切如初，验证灌回幂等） */
  reloadSnapshot: () => void
  /** 当前模型全量快照采集（smoke 往返等价断言用） */
  saveSnapshot: () => SheetSnapshot
}

/** 冒烟/控制台驱动句柄（SmokeMode 冒烟路径写入 window.__REPORT_DEMO__） */
interface ReportDemoHandle {
  getTable: () => ListTable
  getSheet: () => Sheet
  getContainer: () => HTMLElement
  reloadSnapshot: () => void
  /** 当前模型全量快照采集（smoke 往返等价断言用） */
  saveSnapshot: () => SheetSnapshot
  /** 快照 fixture 重建（smoke 往返等价断言的对照源） */
  buildSnapshot: () => SheetSnapshot
}

declare global {
  interface Window {
    __REPORT_DEMO__?: ReportDemoHandle
  }
}

export function mountReport(root: HTMLElement): ReportDemo {
  const section = document.createElement('section')
  root.appendChild(section)
  const container = document.createElement('div')
  container.className = 'table-mount'
  container.style.width = `${REPORT_VIEW_WIDTH}px`
  container.style.height = `${REPORT_VIEW_HEIGHT}px`
  section.appendChild(container)

  // 快照先行灌入模型（冻结/合并/列宽在 SheetGrid 构造期一次读取），readonly 形态渲染：
  // 不注册编辑器、行列尺寸拖改全禁、不接填充/撤销写路径（SheetGrid readonly 口径）
  const sheet = new Sheet('report')
  sheet.restore(createReportSnapshot())
  const grid = new SheetGrid({
    container,
    sheet,
    rows: REPORT_ROW_COUNT,
    cols: REPORT_COL_COUNT,
    width: REPORT_VIEW_WIDTH,
    height: REPORT_VIEW_HEIGHT,
    readonly: true,
    showColHeader: false,
    showRowHeader: false,
  })

  return {
    container,
    grid,
    sheet,
    reloadSnapshot: () => {
      sheet.restore(createReportSnapshot())
    },
    saveSnapshot: () => sheet.snapshot(),
  }
}

/** 调试句柄装配（SmokeMode 冒烟路径共用） */
export function createReportHandle(demo: ReportDemo): ReportDemoHandle {
  return {
    getTable: () => demo.grid.getTable(),
    getSheet: () => demo.sheet,
    getContainer: () => demo.container,
    reloadSnapshot: demo.reloadSnapshot,
    saveSnapshot: demo.saveSnapshot,
    buildSnapshot: createReportSnapshot,
  }
}
