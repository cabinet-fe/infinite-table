// PivotGrid：透视表领域引擎——平级引擎经引擎装配协议接入的参考实现（P7）。
// 内部构造 ListTable（引擎唯一构造点）后以 TableEngine 协议面持有（SheetGrid 同款
// 姿势）：维度树展开/折叠、交叉聚合、动态勾选是本层领域状态机（PivotModel 展平 +
// 结构变更 batchUpdate 落地几何），渲染/滚动全走 table 引擎原语。选区不复用 sheet
// 交互面——引擎 interactiveSelection 关闭（无拖选/表头拖选/键盘移动/填充柄），选区
// 是本层领域高亮：纯填充无边框（主题 selectionBorderWidth 压 0），点击经
// applyExternalSelection 回写——组格高亮从命中维度列起的整行带、列维度表头高亮
// 列组 × 全部数据行、数据格高亮自身；结构变化清空旧高亮、图标折叠/展开后按新
// 几何立即重放，高亮不滞后于结构。
// 行方向为多列树形布局：每个行维度独占一列（冻结带），同组单元格跨行合并
// （setMergeCells 行组合并区），折叠时组收敛为单行载体（自带聚合即小计）——点击
// 组格左缘的展开图标切换折叠/展开（collapsible 配置可关掉整棵树的折叠能力，始终
// 平铺）；点击组格其余区域不折叠，而是高亮该组所有层级的整行带。列方向为多级表头：列维度逐层一行 +
// 度量标题行，以引擎冻结行落地（引擎自带列头关闭），同层前缀的连续数据列横向
// 合并；表头区行维度列按维度分列（每列标题竖条）。列数经 setColCount 增删、冻结
// 带 setFrozenColCount/setFrozenRowCount 对齐行维度列与表头行——勾选变化原地落地，
// 不重建实例。对外实现 EngineAssembly 转发面：水印/打印等协议插件挂本引擎即生效
// （插件只收协议装配面，不感知底下是 ListTable）——多引擎架构的公共装配路径证明。
//
// 只读引擎：交叉格为聚合值，编辑面整体关闭（resolveEditable 恒 false）。

import {
  ListTable,
  type CellRenderer,
  type CellRenderTarget,
  type CellStyle,
  type ColumnDefine,
  type ListTableOptions,
  type TableEngine,
  type ThemeOverride,
} from '@infinitable/table'
import { PluginHost } from '@infinitable/grid'
import type {
  EngineAssembly,
  EngineCapabilities,
  EnginePlugin,
  GridReadView,
  PainterRegistration,
} from '@infinitable/protocol'

import { PivotModel } from './pivot-model'
import type { PivotDimension, PivotGridOptions, PivotMeasure, PivotRecord } from './types'

/** 数据行高（引擎构造 rowHeight 缺省；表头冻结行同高） */
export const PIVOT_ROW_HEIGHT = 32
/** 表头行底色（多级表头冻结行；与引擎默认主题列头底色同源，冒烟像素断言锚点） */
export const PIVOT_HEADER_BACKGROUND = '#f5f6f7'
/** 折叠载体行底色（小计载体；冒烟像素断言锚点） */
export const PIVOT_SUBTOTAL_BACKGROUND = '#f1f5f9'
/** 总计行底色（冒烟像素断言锚点） */
export const PIVOT_GRAND_BACKGROUND = '#e2e8f0'
/** 展开钮颜色（中性灰，随格文本色对齐） */
const TREE_TOGGLE_COLOR = '#57606a'
/** 展开钮命中带宽：钮画在组格左缘 x=9、合并区域竖直中线处；点击须落在钮附近才折叠 */
const TREE_TOGGLE_HIT_X = 20
const TREE_TOGGLE_HIT_Y = 12
/**
 * 组格单击判定位移阈值：down/up 落点距离超过该值视为拖拽，不派发组高亮（透视表
 * 无拖选能力，拖拽释放不得改高亮——防止「松手后高亮跳到释放点」的滞后感；阈值与
 * 引擎链接单击判定 LINK_CLICK_SLOP 同口径）
 */
const TREE_CLICK_SLOP = 10

/** 动态列模板：列头关闭（多级表头走冻结行），宽度逐列 setColWidth 覆盖 */
const COLUMN_TEMPLATE: ColumnDefine = { field: '__pivot__', width: 120 }

const DEFAULT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 10,
})

/** 聚合值默认显示：千分位与真实有效小数（显式 en-US 跨环境确定），非有限数出空 */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  return DEFAULT_NUMBER_FORMATTER.format(value === 0 ? 0 : value)
}

/** 单行省略号截断绘制，防止长维度文本溢出到相邻列 */
function drawEllipsisText(
  ctx: CellRenderTarget['ctx'],
  text: string,
  x: number,
  baselineY: number,
  maxWidth: number,
): void {
  if (maxWidth <= 0 || !text) return
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, baselineY)
    return
  }
  const ellipsis = '…'
  if (ctx.measureText(ellipsis).width > maxWidth) return
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  ctx.fillText(text.slice(0, lo) + ellipsis, x, baselineY)
}

/** 树单元格字体串（与 table 内置 cellStyleFont 同约定；包内自足不深引内部原语） */
function treeCellFont(style: CellStyle): string {
  const weight = style.fontWeight ? `${style.fontWeight} ` : ''
  return `${weight}${style.fontSize ?? 12}px sans-serif`
}

/** 展开钮小三角：cy 为合并区域竖直中线 */
function drawToggleTriangle(
  ctx: CellRenderTarget['ctx'],
  cx: number,
  cy: number,
  expanded: boolean,
): void {
  const half = 3.5
  ctx.fillStyle = TREE_TOGGLE_COLOR
  ctx.beginPath()
  if (expanded) {
    ctx.moveTo(cx - half, cy - half / 2)
    ctx.lineTo(cx + half, cy - half / 2)
    ctx.lineTo(cx, cy + half)
  } else {
    ctx.moveTo(cx - half / 2, cy - half)
    ctx.lineTo(cx + half, cy)
    ctx.lineTo(cx - half / 2, cy + half)
  }
  ctx.closePath()
  ctx.fill()
}

/** 双击下钻事件：命中数据格时携带该格聚合覆盖的原始记录 */
export interface PivotCellDrillEvent {
  col: number
  row: number
  records: readonly PivotRecord[]
}

export class PivotGrid implements EngineAssembly {
  readonly capabilities: EngineCapabilities
  private readonly model: PivotModel
  private readonly table: TableEngine
  private readonly container: HTMLElement
  private readonly pluginHost = new PluginHost(this)
  private readonly disposers: (() => void)[] = []
  private readonly drillListeners = new Set<(event: PivotCellDrillEvent) => void>()
  /** 用户拖拽列宽覆盖（按列稳定键记录，结构重算后保留） */
  private readonly userColWidths = new Map<string, number>()
  private measureFormatter?: (measure: PivotMeasure, value: number) => string
  private released = false

  constructor(options: PivotGridOptions) {
    this.container = options.container
    this.model = new PivotModel({
      dimensions: options.dimensions,
      measures: options.measures,
      records: options.records,
      rowDimensions: options.rowDimensions,
      columnDimensions: options.columnDimensions ?? [],
      activeMeasures: options.activeMeasures,
      showGrandTotal: options.showGrandTotal,
      collapsible: options.collapsible,
    })

    this.table = new ListTable({
      width: options.width ?? (this.container.clientWidth || 760),
      height: options.height ?? (this.container.clientHeight || 480),
      // 列结构全动态：模板占位，applyStructure 对齐实际列数/列宽/冻结带/合并区
      columns: Array.from({ length: this.model.columns.length }, () => ({
        ...COLUMN_TEMPLATE,
      })),
      model: this.model,
      // 多级表头走冻结行 + 合并区自绘：引擎自带单行列头关闭
      showColHeader: false,
      resolveDisplayValue: (col, row, base) => this.displayValue(col, row, base),
      resolveCellStyle: (col, row) => this.cellStyle(col, row),
      resolveCellRenderer: (col, row) =>
        col < this.model.rowHeaderCount && row >= this.model.headerRowCount ? this.treeCell : null,
      resolveEditable: () => false,
      // 选区不复用 sheet 交互面：无拖选/表头拖选/键盘移动/填充柄，选区只作本层
      // 领域高亮（点击路由回写，见 bindClick）
      interactiveSelection: false,
      rowHeight: PIVOT_ROW_HEIGHT,
      showRowHeader: false,
      // 高亮为纯填充无边框：选区边框宽压 0（宿主 theme.interaction 显式键仍可覆盖）
      theme: {
        ...options.theme,
        interaction: { selectionBorderWidth: 0, ...options.theme?.interaction },
      },
      hostOptions: {
        container: this.container,
        ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
      },
    } satisfies ListTableOptions)

    this.capabilities = {
      gridRead: this.read,
    }

    this.disposers.push(
      this.table.onColResizeEnd(({ col, width }) => {
        const key = this.pivotColumnKey(col)
        if (key !== undefined) this.userColWidths.set(key, width)
      }),
    )

    this.applyStructure()
    this.bindWheel()
    this.bindClick()
    this.bindDrill()
    for (const plugin of options.plugins ?? []) {
      this.use(plugin)
    }
  }

  // ---- 领域操作（动态勾选：结构重算 + 引擎几何原地落地） ----

  /** 勾选行维度序列（调用方顺序即树层级序；至少一个） */
  setRowDimensions(keys: readonly string[]): void {
    if (this.model.setRowDimensions(keys)) this.applyStructure()
  }

  /** 勾选列维度序列（调用方顺序即表头层级序；空序列度量直排） */
  setColumnDimensions(keys: readonly string[]): void {
    if (this.model.setColumnDimensions(keys)) this.applyStructure()
  }

  /** 勾选度量序列（调用方顺序即数据列分组序；至少一个） */
  setMeasures(keys: readonly string[]): void {
    if (this.model.setMeasures(keys)) this.applyStructure()
  }

  /** 更高度量定义（聚合方式 / 标题 / 列宽；不改勾选序列） */
  updateMeasure(key: string, patch: Partial<Pick<PivotMeasure, 'agg' | 'title' | 'width'>>): void {
    if (this.model.updateMeasure(key, patch)) this.applyStructure()
  }

  /** 原地更新原始记录并重算聚合矩阵与引擎几何（不重建实例） */
  setRecords(records: readonly PivotRecord[]): void {
    if (this.model.setRecords(records)) this.applyStructure()
  }

  /** 原地更新维度池（增删维度字段时重算结构与几何） */
  setDimensions(dimensions: readonly PivotDimension[]): void {
    if (this.model.setDimensions(dimensions)) this.applyStructure()
  }

  /** 原地更新度量池（增删度量字段时重算结构与几何） */
  setMeasurePool(measures: readonly PivotMeasure[]): void {
    if (this.model.setMeasurePool(measures)) this.applyStructure()
  }

  /** 切换 branch 节点展开态（展开时组格跨行合并，折叠时收敛为载体行） */
  toggleNode(path: readonly string[]): void {
    if (this.model.toggleNode(path)) this.applyStructure()
  }

  /** 是否显示总计行 */
  getShowGrandTotal(): boolean {
    return this.model.showGrandTotal
  }

  /** 切换总计行显示（原地增删总计行并刷新引擎几何与选区，保留列宽与折叠态，不重建实例） */
  setShowGrandTotal(enabled: boolean): void {
    if (this.model.setShowGrandTotal(enabled)) this.applyStructure()
  }

  /** 行维度树是否可折叠（false 时始终平铺展开，无展开钮） */
  getCollapsible(): boolean {
    return this.model.collapsible
  }

  /** 切换可折叠配置（关闭时既有折叠态清空，整树平铺） */
  setCollapsible(enabled: boolean): void {
    if (this.model.setCollapsible(enabled)) this.applyStructure()
  }

  /** 全部展开 */
  expandAll(): void {
    if (this.model.expandAll()) this.applyStructure()
  }

  /** 全部收起：整树收拢到一级 */
  collapseAll(): void {
    if (this.model.collapseAll()) this.applyStructure()
  }

  // ---- 领域查询 ----

  /** 可见数据行数（leaf + 折叠载体 + 总计，不含表头行） */
  getVisibleRowCount(): number {
    return this.model.rows.length
  }

  /** 数据列数（列维度叶子路径数 × 度量数） */
  getDataColumnCount(): number {
    return this.model.dataColumnCount
  }

  /** 行头列数（多列树形布局 = 行维度数） */
  getRowHeaderCount(): number {
    return this.model.rowHeaderCount
  }

  /** 表头行数（列维度层数 + 度量行） */
  getHeaderRowCount(): number {
    return this.model.headerRowCount
  }

  /** 折叠载体行数（小计载体，不含总计） */
  getSubtotalRowCount(): number {
    return this.model.branchRowCount
  }

  /** 记录总数 */
  getRecordCount(): number {
    return this.model.recordCount
  }

  /** 当前行维度 key 序列（勾选面板回读引擎真实结构） */
  getRowDimensionKeys(): readonly string[] {
    return this.model.activeRowDimensions.map((dimension) => dimension.key)
  }

  /** 当前列维度 key 序列（空序列为无列维度度量直排） */
  getColumnDimensionKeys(): readonly string[] {
    return this.model.activeColumnDimensions.map((dimension) => dimension.key)
  }

  /** 当前度量 key 序列（勾选面板回读引擎真实结构） */
  getMeasureKeys(): readonly string[] {
    return this.model.activeMeasures.map((measure) => measure.key)
  }

  /** 当前度量定义快照（含运行时改过的聚合方式；副本，防外改池） */
  getMeasures(): readonly PivotMeasure[] {
    return this.model.activeMeasures.map((measure) => ({ ...measure }))
  }

  /** 当前维度池快照（副本） */
  getDimensions(): readonly PivotDimension[] {
    return this.model.dimensions
  }

  /** 当前度量池快照（副本） */
  getMeasurePool(): readonly PivotMeasure[] {
    return this.model.measures
  }

  /** 交叉格明细：该格聚合覆盖的原始记录（双击下钻数据源；引擎坐标） */
  getCellRecords(col: number, row: number): readonly PivotRecord[] {
    return this.model.getCellRecords(col, row)
  }

  /** 订阅双击下钻（数据格双击；返回退订函数） */
  onCellDrill(listener: (event: PivotCellDrillEvent) => void): () => void {
    this.drillListeners.add(listener)
    return () => this.drillListeners.delete(listener)
  }

  /** 注册自定义度量数值格式化器（用于货币/百分比等列级格式化） */
  setMeasureFormatter(
    formatter: ((measure: PivotMeasure, value: number) => string) | undefined,
  ): void {
    this.measureFormatter = formatter
    const { rows, cols } = this.table.getBodyVisibleCellRange()
    this.table.batchUpdate(() => {
      for (let r = rows.start; r < rows.end; r++) {
        for (let c = Math.max(cols.start, this.model.rowHeaderCount); c < cols.end; c++) {
          this.table.refreshCell(c, r)
        }
      }
    })
  }

  /** 引擎协议面出口（宿主调试/领域外操作的窄接口；本类不暴露 ListTable 具体类型） */
  getTable(): TableEngine {
    return this.table
  }

  // ---- EngineAssembly 转发面（协议插件挂本引擎即生效） ----

  get host() {
    return this.table.host
  }

  get width(): number {
    return this.table.width
  }

  get height(): number {
    return this.table.height
  }

  resize(width: number, height: number): void {
    if (this.released) return
    this.table.resize(width, height)
  }

  get rowCount(): number {
    return this.model.rowCount
  }

  getCellValue(col: number, row: number): unknown {
    return this.model.getCellValue(col, row)
  }

  getTheme() {
    return this.table.getTheme()
  }

  updateTheme(override: ThemeOverride): void {
    if (this.released) return
    this.table.updateTheme(override)
  }

  registerPainter(registration: PainterRegistration): () => void {
    if (this.released) return () => {}
    return this.table.registerPainter(registration)
  }

  use(plugin: EnginePlugin): () => void {
    if (this.released) return () => {}
    return this.pluginHost.use(plugin)
  }

  unuse(plugin: EnginePlugin | string): void {
    if (this.released) return
    this.pluginHost.unuse(plugin)
  }

  get read(): GridReadView {
    return this.table.read
  }

  destroy(): void {
    if (this.released) return
    this.released = true
    this.pluginHost.unmountAll()
    for (const dispose of this.disposers) dispose()
    this.disposers.length = 0
    this.table.destroy()
  }

  // ---- 内部：树单元格自绘（resolveCellRenderer 扩展缝，G8） ----

  /**
   * 行维度列格：只有合并主格会进渲染（被覆盖格无节点）。展开钮画在组格左缘、
   * 竖直居中于合并区域；最深维度列与总计行无钮。折叠载体行的主格（组自身）出
   * ▸，其余可见组的格出 ▾（本行可见即其祖先组必为展开态）。
   */
  private readonly treeCell: CellRenderer = ({ ctx, col, row, width, height, style, font }) => {
    const pivotRow = this.model.rows[row - this.model.headerRowCount]
    if (!pivotRow) return
    const isCarrierMaster = pivotRow.type === 'branch' && col === pivotRow.path.length - 1
    const label = pivotRow.type === 'grand' ? '总计' : (pivotRow.path[col] ?? '')
    // 不可折叠配置下不绘展开钮（点击也不折叠），标签回到普通内边距
    const showToggle =
      this.model.collapsible &&
      pivotRow.type !== 'grand' &&
      col < this.model.rowHeaderCount - 1 &&
      label !== ''
    const { centerY } = this.resolveTreeCellLayout(col, row, height)
    if (showToggle) {
      drawToggleTriangle(ctx, 9, centerY, !isCarrierMaster)
    }
    ctx.fillStyle = style.color ?? '#1f2329'
    ctx.font = font ?? treeCellFont(style)
    const textX = showToggle ? 18 : 8
    const maxWidth = Math.max(0, width - textX - 8)
    const baselineY = centerY + Math.round((style.fontSize ?? 12) / 3)
    drawEllipsisText(ctx, label, textX, baselineY, maxWidth)
  }

  // ---- 内部：显示与样式投影 ----

  private displayValue(col: number, _row: number, base: unknown): string {
    // 表头/树格文本为模型产出的字符串直接透传；聚合数值支持自定义格式化或千分位
    if (typeof base !== 'number') {
      return (base as string | undefined) ?? ''
    }
    if (this.measureFormatter) {
      const column = this.model.columns[col]
      if (column?.kind === 'measure') {
        return this.measureFormatter(column.measure, base)
      }
    }
    return formatNumber(base)
  }

  private cellStyle(col: number, row: number): CellStyle | null {
    if (row < this.model.headerRowCount) {
      return { background: PIVOT_HEADER_BACKGROUND, textAlign: 'center' }
    }
    const pivotRow = this.model.rows[row - this.model.headerRowCount]
    if (!pivotRow) return null
    const isDataCol = col >= this.model.rowHeaderCount
    if (pivotRow.type === 'grand') {
      return {
        background: PIVOT_GRAND_BACKGROUND,
        fontWeight: 600,
        ...(isDataCol ? { textAlign: 'right' as const } : {}),
      }
    }
    if (pivotRow.type === 'branch') {
      return {
        background: PIVOT_SUBTOTAL_BACKGROUND,
        fontWeight: 600,
        ...(isDataCol ? { textAlign: 'right' as const } : {}),
      }
    }
    // 交叉格聚合数值右对齐
    return isDataCol ? { textAlign: 'right' } : null
  }

  // ---- 内部：结构落地 ----

  /** 列稳定键（行维度键或度量键+列路径），用于结构重算后保留用户拖拽列宽 */
  private pivotColumnKey(col: number): string | undefined {
    const column = this.model.columns[col]
    if (!column) return undefined
    if (column.kind === 'row-header') {
      return `row:${this.model.activeRowDimensions[col]?.key ?? column.title}`
    }
    return `measure:${column.measure.key}:${column.colPath.join('\u0000')}`
  }

  /**
   * 结构落地：行数（表头行 + 数据行）/列数/冻结带（行维度列 × 表头行）/逐列宽/
   * 合并区（batchUpdate 合并为一次失效提交）。结构变化后行列坐标整体重排，旧
   * 选区坐标失效——清空选区防「选区滞后于结构」的错位框（组块选区由点击链路
   * 在结构落地后按新几何重放）。
   */
  private applyStructure(): void {
    this.table.batchUpdate(() => {
      this.table.setRowCount(this.model.rowCount)
      this.table.setColCount(this.model.columns.length, COLUMN_TEMPLATE)
      this.table.setFrozenColCount(this.model.rowHeaderCount)
      this.table.setFrozenRowCount(this.model.headerRowCount)
      for (let col = 0; col < this.model.columns.length; col++) {
        const key = this.pivotColumnKey(col)
        const width =
          (key !== undefined ? this.userColWidths.get(key) : undefined) ??
          this.model.getColumnWidth(col)
        if (width !== undefined && this.table.getColWidth(col) !== width) {
          this.table.setColWidth(col, width)
        }
      }
      this.table.setMergeCells(this.model.mergeRanges)
    })
    this.table.applyExternalSelection({ ranges: [], focus: null })
  }

  /**
   * 点击路由（容器 DOM 事件 + 引擎命中换算，合并区命中即主格）——四类落点各自的
   * 高亮几何，全部经 applyExternalSelection 回写（纯填充无边框，无拖选/填充柄）：
   * - 行维度组格（数据区 × 行头列）：组合并区的主格行取组内首个可见行，统一按
   *   「命中列 = 组深度」截取路径前缀；高亮从命中的维度列起延展到最后一列（组
   *   的可见行块 × 命中列后的整行带）。点击展开图标（组格左缘横向带 × 合并区域
   *   竖直中线的钮带内）才折叠/展开，结构落地后按新结构重算组块重放。总计行头
   *   点击高亮总计行（从合并主格列起）。
   * - 列维度表头（表头区 × 数据列）：高亮该列组（同前缀合并跨度，度量行单列）
   *   × 全部数据行。
   * - 数据格：高亮单元格自身。
   * - 行维度标题竖条（表头区 × 行头列）：无操作。
   * 拖拽（down/up 位移超 TREE_CLICK_SLOP）不触发——透视表高亮无拖选能力，
   * 拖拽释放不得改高亮。
   */
  private bindClick(): void {
    let downAt: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent): void => {
      downAt = { x: event.clientX, y: event.clientY }
    }
    const onClick = (event: MouseEvent): void => {
      const rect = this.container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      // 一次 pointerdown 至多武装一次 click；无 down 锚（程序化派发）不设限
      const down = downAt
      downAt = null
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > TREE_CLICK_SLOP) {
        return
      }
      const cell = this.table.getCellAtRelativePosition(x, y)
      if (!cell) return
      // 数据格：高亮单元格自身
      if (cell.col >= this.model.rowHeaderCount && cell.row >= this.model.headerRowCount) {
        this.table.applyExternalSelection({
          ranges: [
            { start: { col: cell.col, row: cell.row }, end: { col: cell.col, row: cell.row } },
          ],
          focus: cell,
        })
        return
      }
      // 列维度表头：高亮列组 × 全部数据行（表头行之下直到总计）
      if (cell.col >= this.model.rowHeaderCount) {
        const colRange = this.model.headerColumnRange(cell.col, cell.row)
        if (!colRange) return
        this.table.applyExternalSelection({
          ranges: [
            {
              start: { col: colRange.startCol, row: this.model.headerRowCount },
              end: { col: colRange.endCol, row: this.model.rowCount - 1 },
            },
          ],
          focus: cell,
        })
        return
      }
      // 表头区行维度列（维度标题竖条）：无操作
      if (cell.row < this.model.headerRowCount) return
      // 行维度组格：组块整行带（从命中的维度列起）
      const pivotRow = this.model.rows[cell.row - this.model.headerRowCount]
      if (!pivotRow) return
      const path = pivotRow.type === 'grand' ? null : pivotRow.path.slice(0, cell.col + 1)
      let range =
        pivotRow.type === 'grand'
          ? { startRow: cell.row, endRow: cell.row }
          : this.model.groupRange(path!)
      if (!range) return
      // 图标命中：与 treeCell 渲染共用 resolveTreeCellLayout，确保粘性居中后的三角图标与点击坐标一致
      if (
        this.model.collapsible &&
        pivotRow.type !== 'grand' &&
        cell.col < this.model.rowHeaderCount - 1 &&
        pivotRow.path.length > cell.col
      ) {
        const mergedHeight = (range.endRow - range.startRow + 1) * PIVOT_ROW_HEIGHT
        const { origin, centerY } = this.resolveTreeCellLayout(
          cell.col,
          range.startRow,
          mergedHeight,
        )
        if (
          origin !== null &&
          x - origin.x >= 0 &&
          x - origin.x <= TREE_TOGGLE_HIT_X &&
          Math.abs(y - (origin.y + centerY)) <= TREE_TOGGLE_HIT_Y
        ) {
          this.toggleNode(path!)
          // 结构已变：按新结构重算组块（折叠收敛为载体行、展开恢复全组行），
          // 高亮重放到新几何——不残留旧结构的行区间
          range = this.model.groupRange(path!) ?? range
        }
      }
      this.table.applyExternalSelection({
        ranges: [
          {
            start: { col: cell.col, row: range.startRow },
            end: { col: this.model.columns.length - 1, row: range.endRow },
          },
        ],
        focus: cell,
      })
    }
    this.container.addEventListener('pointerdown', onPointerDown)
    this.container.addEventListener('click', onClick)
    this.disposers.push(() => {
      this.container.removeEventListener('pointerdown', onPointerDown)
      this.container.removeEventListener('click', onClick)
    })
  }

  /** 双击下钻：数据格双击带出明细记录（飞书式「双击查明细」交互的领域面） */
  private bindDrill(): void {
    const onDblClick = (event: MouseEvent): void => {
      const rect = this.container.getBoundingClientRect()
      const cell = this.table.getCellAtRelativePosition(
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
      if (!cell || cell.col < this.model.rowHeaderCount) return
      if (cell.row < this.model.headerRowCount) return
      const records = this.model.getCellRecords(cell.col, cell.row)
      if (records.length === 0) return
      for (const listener of this.drillListeners) {
        listener({ col: cell.col, row: cell.row, records })
      }
    }
    this.container.addEventListener('dblclick', onDblClick)
    this.disposers.push(() => this.container.removeEventListener('dblclick', onDblClick))
  }

  /** 宿主滚轮接线：引擎无内置滚轮；只在引擎确实消费滚动时 preventDefault（饿死外层滚动的防回流口径同 SheetGrid） */
  private bindWheel(): void {
    if (this.table.usesNativeScrollbar) return
    const onWheel = (event: WheelEvent): void => {
      let deltaX = Number.isFinite(event.deltaX) ? event.deltaX : 0
      let deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0
      if (event.shiftKey && deltaY && !deltaX) {
        deltaX = deltaY
        deltaY = 0
      }
      if (!deltaX && !deltaY) return
      const beforeLeft = this.table.getScrollLeft()
      const beforeTop = this.table.getScrollTop()
      this.table.scrollBy(deltaX, deltaY)
      const consumed =
        this.table.getScrollLeft() !== beforeLeft || this.table.getScrollTop() !== beforeTop
      if (consumed && event.cancelable) event.preventDefault()
    }
    this.container.addEventListener('wheel', onWheel, { passive: false })
    this.disposers.push(() => this.container.removeEventListener('wheel', onWheel))
  }

  /**
   * 树单元格内容竖直居中布局（渲染与点击命中共用，保证三角形与文本在长合并组滚出视口时
   * 仍粘性居中于可见表体区间内，且点击命中带与绘制坐标严格一致）：
   * 1. 解析合并组主格在视口坐标下的原点 origin（支持首行滚出视口上方时的 O(1) 定位）；
   * 2. 用 table.getDrawRange() 与冻结表头行高夹取节点局部 [0, mergedHeight] 到可见表体区间；
   * 3. 在可见区间中点取 centerY，并以半行内边距夹紧到 [pad, mergedHeight - pad] 防贴边裁切；
   * 几何不可用或完全在视口内时回落 mergedHeight / 2。
   */
  private resolveTreeCellLayout(
    col: number,
    startRow: number,
    mergedHeight: number,
  ): { origin: { x: number; y: number } | null; centerY: number } {
    const fallbackCenterY = mergedHeight / 2
    const rowSpan = Math.max(1, Math.round(mergedHeight / PIVOT_ROW_HEIGHT))
    const origin = this.resolveMergedCellOrigin(col, {
      startRow,
      endRow: startRow + rowSpan - 1,
    })
    if (!origin || mergedHeight <= 0) {
      return { origin, centerY: fallbackCenterY }
    }
    const drawRange = this.table.getDrawRange()
    const frozenRowCount = this.table.getFrozenRowCount()
    let frozenRowsHeight = 0
    for (let r = 0; r < frozenRowCount; r++) {
      frozenRowsHeight += this.table.getRowHeight(r)
    }
    const bodyViewportTop = drawRange.y + frozenRowsHeight
    const bodyViewportBottom = drawRange.y + drawRange.height
    if (bodyViewportBottom <= bodyViewportTop) {
      return { origin, centerY: fallbackCenterY }
    }
    const visibleLocalTop = Math.max(0, bodyViewportTop - origin.y)
    const visibleLocalBottom = Math.min(mergedHeight, bodyViewportBottom - origin.y)
    if (visibleLocalBottom <= visibleLocalTop) {
      return { origin, centerY: fallbackCenterY }
    }
    if (visibleLocalTop <= 0 && visibleLocalBottom >= mergedHeight) {
      return { origin, centerY: fallbackCenterY }
    }
    const pad = Math.min(fallbackCenterY, PIVOT_ROW_HEIGHT / 2)
    const rawCenterY = (visibleLocalTop + visibleLocalBottom) / 2
    const centerY = Math.max(pad, Math.min(mergedHeight - pad, rawCenterY))
    return { origin, centerY }
  }

  /** 计算合并组格主格的视口左上角坐标（支持首行已滚出视口上方时的局部可见组） */
  private resolveMergedCellOrigin(
    col: number,
    range: { startRow: number; endRow: number },
  ): { x: number; y: number } | null {
    // 优先直接查询主格；主格在窗口外时，按当前滚动位置 O(1) 估算首个可见行起探
    const direct = this.table.getCellRelativeRect(col, range.startRow)
    if (direct) {
      return { x: direct.x, y: direct.y }
    }
    const frozenRowCount = this.table.getFrozenRowCount()
    const approxFirstRow = frozenRowCount + Math.floor(this.table.getScrollTop() / PIVOT_ROW_HEIGHT)
    const probeRow = Math.max(range.startRow, Math.min(range.endRow, approxFirstRow))
    const probed = this.table.getCellRelativeRect(col, probeRow)
    if (probed) {
      return {
        x: probed.x,
        y: probed.y - (probeRow - range.startRow) * PIVOT_ROW_HEIGHT,
      }
    }
    // 兜底逐行探测组内首个视口可见行（含冻结表头时 getBodyVisibleCellRange().rows.start 恒为 0）
    for (let row = range.startRow + 1; row <= range.endRow; row++) {
      const rect = this.table.getCellRelativeRect(col, row)
      if (rect) {
        return {
          x: rect.x,
          y: rect.y - (row - range.startRow) * PIVOT_ROW_HEIGHT,
        }
      }
    }
    return null
  }
}
