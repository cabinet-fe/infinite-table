// 报表式只读快照渲染场景（meta 报表迁移参考形态）：
// 手写报表快照（九字段结构）→ sheet 插件（单表只读形态）handle 全量灌入 Store（模型侧唯一事实源）→
// readonly 渲染（resolveEditable 全禁编 + canResizeCol/Row 全禁改尺寸 + 插件 readonly 不接填充/撤销写路径）。
// images/selection 随快照携带，经灌回 wiring 由宿主接线引擎 floatObjects / applyExternalSelection——
// 与 meta 迁移时「服务端快照 → 灌模型 → 只读渲染」的形态一致，可整段照搬。
// 行列头关闭（showColHeader/showRowHeader false）：报表的表头带/标题行本身就是快照数据，
// 引擎级行列头对纯报表形态是多余的 Chrome。控件面（重灌按钮与状态行）由 ReportPage
// 以 shadcn 渲染，经 demo.reloadSnapshot 驱动。

import type { CellStyle, ListTable, ListTableOptions } from '@infinitable/core'
import { createSheetPlugin, type SheetPluginHandle } from '@infinitable/plugins'

import { demoLoadImage, mountTable, type DemoMount } from '../mount'

/** 演示层 Store 类型（sheet 插件 handle 的 store 面） */
type SheetStore = NonNullable<SheetPluginHandle['store']>
/** 快照类型（插件 handle 的采集产物形态；fixture 构建与往返断言共用） */
type SheetSnapshot = ReturnType<SheetPluginHandle['saveSnapshot']>

// ---- 报表维度与口径常量（smoke 断言与快照 fixture 共用） ----

const REPORT_ROW_COUNT = 36
const REPORT_COL_COUNT = 8
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

// ---- 快照 fixture：确定性生成，九字段全覆盖 ----

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

/** 构造报表快照（九字段：cells/styles/merges/frozen/rowHeights/colWidths/images/meta/selection） */
function createReportSnapshot(): SheetSnapshot {
  const cells: SheetSnapshot['cells'] = []
  const push = (col: number, row: number, value: unknown): void => {
    if (value !== null && value !== undefined) {
      cells.push({ col, row, value })
    }
  }
  // 标题行 + 元信息行（合并区）
  push(0, REPORT_ROWS.title, '2026 Q3 销售汇总报表')
  push(0, REPORT_ROWS.meta, '报表编号：RPT-2026-Q3')
  push(2, REPORT_ROWS.meta, '生成时间：2026-09-30 08:00')
  push(5, REPORT_ROWS.meta, '单位：万元（销售额 / 目标）')
  // 表头带（上：整列字段 + 「指标」横跨；下：指标细分）
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
  // 数据行 + 合计行
  for (let row = REPORT_ROWS.dataFirst; row <= REPORT_ROWS.dataLast; row++) {
    dataRowCells(row).forEach((value, col) => push(col, row, value))
  }
  summaryRowCells().forEach((value, col) => push(col, REPORT_ROWS.summary, value))

  return {
    cells,
    styles: {
      cells: [
        // 标题：加粗居中大字 + 浅蓝底
        {
          col: 0,
          row: REPORT_ROWS.title,
          style: {
            fontWeight: 700,
            fontSize: 16,
            textAlign: 'center',
            background: REPORT_TITLE_BACKGROUND,
            color: '#1d4ed8',
          },
        },
        // 元信息行：斜体灰字 + 浅灰底
        {
          col: 0,
          row: REPORT_ROWS.meta,
          style: { fontStyle: 'italic', color: '#64748b', background: '#f8fafc' },
        },
        {
          col: 2,
          row: REPORT_ROWS.meta,
          style: { fontStyle: 'italic', color: '#64748b', background: '#f8fafc' },
        },
        {
          col: 5,
          row: REPORT_ROWS.meta,
          style: { fontStyle: 'italic', color: '#64748b', background: '#f8fafc' },
        },
        // 表头带：居中加粗 + 底部粗分隔线
        {
          col: 0,
          row: REPORT_ROWS.headerTop,
          style: headerBandStyle(),
        },
        { col: 1, row: REPORT_ROWS.headerTop, style: headerBandStyle() },
        { col: 2, row: REPORT_ROWS.headerTop, style: headerBandStyle() },
        { col: 3, row: REPORT_ROWS.headerTop, style: headerBandStyle() },
        { col: 4, row: REPORT_ROWS.headerTop, style: headerBandStyle() },
        { col: 4, row: REPORT_ROWS.headerSub, style: headerBandStyle() },
        { col: 5, row: REPORT_ROWS.headerSub, style: headerBandStyle() },
        { col: 6, row: REPORT_ROWS.headerSub, style: headerBandStyle() },
        { col: 7, row: REPORT_ROWS.headerSub, style: headerBandStyle() },
        // 负环比红字（格级覆盖列级右对齐之外的色）
        ...negativeQoqStyles(),
        // 合计行：加粗 + 顶部粗边 + 浅灰底
        {
          col: 0,
          row: REPORT_ROWS.summary,
          style: {
            fontWeight: 700,
            background: '#f1f5f9',
            border: { top: { width: 2, color: '#334155' } },
          },
        },
        ...Array.from({ length: REPORT_COL_COUNT - 1 }, (_, i) => ({
          col: i + 1,
          row: REPORT_ROWS.summary,
          style: {
            fontWeight: 700,
            background: '#f1f5f9',
            border: { top: { width: 2, color: '#334155' } },
          },
        })),
      ],
      // 列级：数值列右对齐（快照 styles.columns 字段）
      columns: [4, 5, 6, 7].map((col) => ({ col, style: { textAlign: 'right' } })),
    },
    merges: [
      // 标题横跨全表 + 元信息三段 + 表头带整列字段纵合并与「指标」横跨
      { startCol: 0, endCol: 7, startRow: REPORT_ROWS.title, endRow: REPORT_ROWS.title },
      { startCol: 0, endCol: 1, startRow: REPORT_ROWS.meta, endRow: REPORT_ROWS.meta },
      { startCol: 2, endCol: 4, startRow: REPORT_ROWS.meta, endRow: REPORT_ROWS.meta },
      { startCol: 5, endCol: 7, startRow: REPORT_ROWS.meta, endRow: REPORT_ROWS.meta },
      { startCol: 0, endCol: 0, startRow: REPORT_ROWS.headerTop, endRow: REPORT_ROWS.headerSub },
      { startCol: 1, endCol: 1, startRow: REPORT_ROWS.headerTop, endRow: REPORT_ROWS.headerSub },
      { startCol: 2, endCol: 2, startRow: REPORT_ROWS.headerTop, endRow: REPORT_ROWS.headerSub },
      { startCol: 3, endCol: 3, startRow: REPORT_ROWS.headerTop, endRow: REPORT_ROWS.headerSub },
      { startCol: 4, endCol: 7, startRow: REPORT_ROWS.headerTop, endRow: REPORT_ROWS.headerTop },
      { startCol: 0, endCol: 3, startRow: REPORT_ROWS.summary, endRow: REPORT_ROWS.summary },
    ],
    // 冻结报表头四行（标题/元信息/表头带两行）；不冻结列：全表 734px 无横向滚动
    frozen: { colCount: 0, rowCount: 4 },
    rowHeights: [
      { row: REPORT_ROWS.title, height: 42 },
      { row: REPORT_ROWS.summary, height: 36 },
    ],
    colWidths: REPORT_COL_WIDTHS.map((width, col) => ({ col, width })),
    images: [
      {
        id: REPORT_FLOAT_IMAGE_ID,
        kind: 'image',
        anchor: {
          from: { col: 5, row: REPORT_ROWS.dataFirst + 12 },
          to: { col: 7, row: REPORT_ROWS.summary - 2 },
          offsetX: 4,
          offsetY: 4,
        },
        src: 'demo://report/chart',
        title: 'Q3 销售趋势（示意）',
      },
    ],
    meta: [
      // 模板绑定 meta（meta 报表：模板字段 → 引擎格位）
      {
        ns: 'binding',
        entries: [
          { col: 1, row: REPORT_ROWS.headerTop, value: { field: 'region' } },
          { col: 2, row: REPORT_ROWS.headerTop, value: { field: 'city' } },
          { col: 3, row: REPORT_ROWS.headerTop, value: { field: 'category' } },
          { col: 4, row: REPORT_ROWS.headerSub, value: { field: 'sales' } },
          { col: 5, row: REPORT_ROWS.headerSub, value: { field: 'target' } },
          { col: 6, row: REPORT_ROWS.headerSub, value: { field: 'completion' } },
          { col: 7, row: REPORT_ROWS.headerSub, value: { field: 'qoq' } },
        ],
      },
      // 报表级 meta（模板标识与版本）
      {
        ns: 'report',
        entries: [
          { col: 0, row: REPORT_ROWS.title, value: { template: 'quarterly-sales', version: 3 } },
        ],
      },
    ],
    // 选区快照：合计行为当前查看焦点（readonly 报表的「查看位置」随快照恢复）
    selection: {
      ranges: [
        { start: { col: 0, row: REPORT_ROWS.summary }, end: { col: 7, row: REPORT_ROWS.summary } },
      ],
      focus: null,
    },
  }
}

function headerBandStyle(): CellStyle {
  return {
    fontWeight: 700,
    textAlign: 'center',
    background: '#eef2f7',
    border: { bottom: { width: 2, color: '#64748b' } },
  }
}

/** 负环比格红字（环比值为负号开头的格） */
function negativeQoqStyles(): Array<{ col: number; row: number; style: { color: string } }> {
  const entries: Array<{ col: number; row: number; style: { color: string } }> = []
  for (let row = REPORT_ROWS.dataFirst; row <= REPORT_ROWS.dataLast; row++) {
    const qoq = dataRowCells(row)[7] as string
    if (qoq.startsWith('-')) {
      entries.push({ col: 7, row, style: { color: '#dc2626' } })
    }
  }
  return entries
}

// ---- 演示区装配 ----

export interface ReportDemo {
  mount: DemoMount
  store: SheetStore
  /** 重灌快照（替换语义：对账后一切如初，验证灌回幂等） */
  reloadSnapshot: () => void
  /** 当前 Store 全量快照采集（smoke 往返等价断言用） */
  saveSnapshot: () => SheetSnapshot
}

/** 冒烟/控制台驱动句柄（SmokeMode 冒烟路径写入 window.__REPORT_DEMO__） */
interface ReportDemoHandle {
  getTable: () => ListTable
  getStore: () => SheetStore
  getContainer: () => HTMLElement
  reloadSnapshot: () => void
  /** 当前 Store 全量快照采集（smoke 往返等价断言用） */
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

  // sheet 插件单表只读形态：持有唯一 Store（报表事实源），不装配写路径接线
  const sheet = createSheetPlugin({
    store: {
      rowCount: REPORT_ROW_COUNT,
      colCount: REPORT_COL_COUNT,
      defaultColWidth: 96,
      defaultRowHeight: 32,
    },
    readonly: true,
  })
  const store = sheet.store!

  // readonly 渲染口径：可编判定恒 false、行列尺寸拖改恒禁止；不注册编辑器、插件 readonly 不接写路径
  const readonlyOptions: Partial<ListTableOptions> = {
    resolveEditable: () => false,
    canResizeCol: () => false,
    canResizeRow: () => false,
  }
  const mount = mountTable(section, {
    width: 760,
    height: 360,
    columns: Array.from({ length: REPORT_COL_COUNT }, (_, col) => ({
      title: `R${col}`,
      width: REPORT_COL_WIDTHS[col],
    })),
    model: store.asModel(),
    plugins: [sheet],
    // 有效样式走模型侧读取 API（基础→列级→格级合成），样式面与快照单一事实源一致
    resolveCellStyle: (col, row) => store.getEffectiveStyle(col, row) ?? null,
    showColHeader: false,
    showRowHeader: false,
    rowHeight: 32,
    imageServiceOptions: { loadImage: demoLoadImage },
    ...readonlyOptions,
  })
  const table = mount.table

  // Store rebuild 汇总 → 全量应用引擎侧（冻结/合并/尺寸）+ 全表刷新（样式为拉取式）
  const applySnapshotToTable = (): void => {
    const frozen = store.getFrozen()
    table.setFrozenColCount(frozen.colCount)
    table.setFrozenRowCount(frozen.rowCount)
    table.setMergeCells([...store.getMerges()])
    table.batchUpdate(() => {
      for (const [col, width] of store.getColWidthOverrides()) {
        table.setColWidth(col, width)
      }
      for (const [row, height] of store.getRowHeightOverrides()) {
        table.setRowHeight(row, height)
      }
      for (let col = 0; col < store.getColCount(); col++) {
        for (let row = 0; row < store.getRowCount(); row++) {
          table.refreshCell(col, row)
        }
      }
    })
  }
  store.onChange((event) => {
    if (event.type === 'rebuild') {
      applySnapshotToTable()
    }
  })

  // 浮动图对账：先移除上一轮灌入的，再按快照全量加（灌回 wiring 的宿主侧实现）
  let appliedImageIds: string[] = []
  const reloadSnapshot = (): void => {
    sheet.restoreSnapshot(store, createReportSnapshot(), {
      images: (images) => {
        for (const id of appliedImageIds) {
          table.floatObjects.remove(id)
        }
        appliedImageIds = images.map((image) => image.id)
        for (const image of images) {
          table.floatObjects.add(image)
        }
      },
      selection: (selection) => {
        if (selection) {
          table.applyExternalSelection(selection)
        } else {
          table.clearSelection()
        }
      },
    })
  }
  reloadSnapshot()

  return { mount, store, reloadSnapshot, saveSnapshot: () => sheet.saveSnapshot(store) }
}

/** 调试句柄装配（SmokeMode 冒烟路径共用） */
export function createReportHandle(demo: ReportDemo): ReportDemoHandle {
  return {
    getTable: () => demo.mount.table,
    getStore: () => demo.store,
    getContainer: () => demo.mount.container,
    reloadSnapshot: demo.reloadSnapshot,
    saveSnapshot: demo.saveSnapshot,
    buildSnapshot: createReportSnapshot,
  }
}
