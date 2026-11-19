// 智能表格画布适配层：封装 @infinitable/table 的 ListTable，提供原生底部冻结汇总行、
// 列头排序/菜单按钮热区隔离、全区域右键菜单定位、多层次样式合并渲染与视图配置原地更新。

import {
  EditorRegistry,
  ListTable,
  type CellAddress,
  type CellChangeEvent,
  type CellLink,
  type CellRenderer,
  type CellRenderTarget,
  type CellStyle,
  type ColHeaderClickEvent,
  type ColHeaderHitRegion,
  type ColumnDefine,
  type TableContextMenuEvent,
  type TableModel,
  type BottomCellClickEvent,
} from '@infinitable/table'
import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'
import { roundRectPath, type Region, type RenderContext, type Size } from '@infinitable/render'

import {
  computeSummaries,
  formatSummaryValue,
  type SummaryCellResult,
} from '../domain/query-engine'
import { formatNumberValue, formatProgressPercent } from '../shared/number-format'
import {
  createViewStyleResolver,
  resolveRowHeightPx,
  resolveVisibleColumns,
  type ViewStyleResolver,
} from '../domain/style-engine'
import { validateAndCoerceCellValue, type CellValidationResult } from '../shared/record-validation'
import type {
  CellTextAlign,
  LookupConflictInfo,
  RowHeightPreset,
  SelectOption,
  SmartColumn,
  SmartRecord,
  SmartView,
  SortRule,
  SummaryType,
} from '../shared/schema'
import {
  attachHostContainerSizeSync,
  ensureHostContainerPosition,
  readHostContainerSize,
  type HostContainerSize,
  type HostContainerSizeSync,
} from './host-container'

/** 视图呈现与样式配置切片（驱动列显隐/顺序/宽、冻结列、行高与三层样式合并） */
export type SmartGridViewPresentation = Pick<
  SmartView,
  | 'columnOrder'
  | 'hiddenColumns'
  | 'columnWidths'
  | 'frozenColCount'
  | 'rowHeight'
  | 'columnStyles'
  | 'cellStyles'
  | 'conditionalFormats'
>

/** 冲突角标点击回调入参（rect 为视口坐标） */
export interface SmartGridConflictClickInfo {
  record: SmartRecord
  column: SmartColumn
  conflict: LookupConflictInfo
  rect: Region
}

/** 富交互列（select / date）双击编辑回调入参（rect 为视口坐标） */
export interface SmartGridRichEditInfo {
  record: SmartRecord
  column: SmartColumn
  rect: Region
  value: unknown
}

/** 底部汇总格点击回调入参（rect 为视口坐标） */
export interface SmartGridSummaryClickInfo {
  column: SmartColumn
  columnKey: string
  colIndex: number
  summaryType: SummaryType
  rect: Region
}

/** 列头显式排序按钮点击回调入参（rect 为按钮视口坐标） */
export interface SmartGridHeaderSortClickInfo {
  column: SmartColumn
  field: string
  colIndex: number
  additive: boolean
  rect: Region
}

/** 列头显式菜单按钮点击回调入参（rect 为按钮视口坐标，headerRect 为整列头格视口坐标） */
export interface SmartGridHeaderMenuClickInfo {
  column: SmartColumn
  columnKey: string
  colIndex: number
  rect: Region
  headerRect: Region
}

/** 选区单个矩形范围（同时提供格坐标与解析后的行 ID / 列键） */
export interface SmartGridSelectionRange {
  start: CellAddress
  end: CellAddress
  recordIds: string[]
  columnKeys: string[]
}

/** 当前画布选区快照 */
export interface SmartGridSelectionInfo {
  ranges: SmartGridSelectionRange[]
  recordIds: string[]
  columnKeys: string[]
  focus: CellAddress | null
}

/** 全区域右键菜单回调入参（body / col-header / row-header） */
export interface SmartGridContextMenuInfo {
  region: 'body' | 'col-header' | 'row-header'
  /** 浏览器视口坐标 */
  x: number
  y: number
  /** 目标矩形在浏览器视口中的位置（格/列头/行头矩形；空白处为点击点 0x0 矩形） */
  rect: Region
  /** 命中格坐标（仅 body 命中数据格时非空） */
  cell: CellAddress | null
  colIndex: number | null
  rowIndex: number | null
  column: SmartColumn | null
  record: SmartRecord | null
  selection: SmartGridSelectionInfo
}

/** 列宽拖拽写回回调入参 */
export interface SmartGridColWidthChangeInfo {
  column: SmartColumn
  columnKey: string
  colIndex: number
  width: number
}

/** setData 附加配置参数 */
export interface SmartGridSetDataExtra {
  view?: SmartGridViewPresentation
  summaries?: Record<string, SummaryType>
  summaryResults?: Record<string, SummaryCellResult>
  totalCount?: number
}

/** SmartGridAdapter 构造配置 */
export interface SmartGridOptions {
  container: HTMLElement
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  conflictsByRow?: Map<string, Map<string, LookupConflictInfo>>
  readonly?: boolean
  dpr?: number
  sortRules?: readonly SortRule[]
  /** 视图呈现与样式配置（列显隐/顺序/宽、冻结列、行高、多层次样式） */
  view?: SmartGridViewPresentation
  /** 列汇总配置（columnKey -> SummaryType） */
  summaries?: Record<string, SummaryType>
  /** 预计算汇总结果（未传时按 records / visibleColumns / summaries 自动计算） */
  summaryResults?: Record<string, SummaryCellResult>
  /** 过滤前总记录数（用于底部行头展示 `共 N 条` 或 `筛选/总数`；缺省等于 records.length） */
  totalCount?: number
  /** 是否显示原生底部冻结汇总行（缺省 true） */
  showSummaryRow?: boolean
  onCellValueChange?: (recordId: string, fieldKey: string, newValue: unknown) => void
  onConflictClick?: (info: SmartGridConflictClickInfo) => void
  onRichCellEdit?: (info: SmartGridRichEditInfo) => void
  onValidationError?: (message: string) => void
  onScrollChange?: (scrollLeft: number, scrollTop: number) => void
  onRowSelectionChange?: (recordIds: string[]) => void
  /** 选区变更快照回调（包含行 ID 与列键范围） */
  onSelectionInfoChange?: (info: SmartGridSelectionInfo) => void
  /** 点击列头显式排序按钮 */
  onHeaderSortClick?: (info: SmartGridHeaderSortClickInfo) => void
  /** 点击列头显式菜单按钮 */
  onHeaderMenuClick?: (info: SmartGridHeaderMenuClickInfo) => void
  /** 点击底部汇总行数据格 */
  onSummaryCellClick?: (info: SmartGridSummaryClickInfo) => void
  /** 全区域右键菜单（body / col-header / row-header） */
  onContextMenu?: (info: SmartGridContextMenuInfo) => void
  /** 列宽拖拽结束写回 */
  onColWidthChange?: (info: SmartGridColWidthChangeInfo) => void
}

/** 点击判定位移阈值（与引擎链接单击/透视表组格单击同口径） */
const CLICK_SLOP = 10
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 500
const DEFAULT_ROW_HEIGHT = 38
const DEFAULT_HEADER_HEIGHT = 38
const DEFAULT_BOTTOM_ROW_HEIGHT = 36
const DEFAULT_ROW_HEADER_WIDTH = 64
const MIN_ROW_HEIGHT_PX = 24
const DEFAULT_WATERMARK_TEXT = '智能表格 · 内部数据'
const AVATAR_PALETTE = ['#3370ff', '#00b42a', '#ff7d00', '#722ed1', '#eb2f96', '#0fc6c2'] as const

const HEADER_BTN_WIDTH = 18
const HEADER_BTN_HEIGHT = 20
const HEADER_BTN_GAP = 2
// 右侧留 6px 边距，避开列边界 ±4px resize 热区
const HEADER_BTN_RIGHT_PAD = 6

const SUMMARY_SHORT_LABELS: Record<SummaryType, string> = {
  none: '',
  sum: '求和',
  avg: '均值',
  max: '最大',
  min: '最小',
  count: '计数',
  filled_rate: '填充率',
}

/** 自定义表格数据模型：内部持有记录浅拷贝防原地变异，支持静默回滚与快照读取 */
class SmartTableModel implements TableModel {
  private columns: readonly SmartColumn[]
  private records: SmartRecord[]
  private readonly changeListeners = new Set<(change: CellChangeEvent) => void>()

  constructor(columns: readonly SmartColumn[], records: readonly SmartRecord[]) {
    this.columns = columns
    this.records = records.map((record) => ({ ...record }))
  }

  get rowCount(): number {
    return this.records.length
  }

  setData(columns: readonly SmartColumn[], records: readonly SmartRecord[]): void {
    this.columns = columns
    this.records = records.map((record) => ({ ...record }))
  }

  getRecordsSnapshot(): SmartRecord[] {
    return this.records.map((record) => ({ ...record }))
  }

  getRecordSnapshot(row: number): SmartRecord | undefined {
    const record = this.records[row]
    return record ? { ...record } : undefined
  }

  getCellValue(col: number, row: number): unknown {
    const colDef = this.columns[col]
    const record = this.records[row]
    if (!colDef || !record) {
      return undefined
    }
    return record[colDef.key]
  }

  setCellValue(col: number, row: number, value: unknown): void {
    const colDef = this.columns[col]
    const record = this.records[row]
    if (!colDef || !record) {
      return
    }
    const oldValue = record[colDef.key]
    if (oldValue === value) {
      return
    }
    record[colDef.key] = value
    const change: CellChangeEvent = { col, row, oldValue, newValue: value }
    for (const listener of this.changeListeners) {
      listener(change)
    }
  }

  /** 静默回写/回滚单元格内部拷贝值（不触发 onCellChange，避免回调重入） */
  revertCell(col: number, row: number, value: unknown): void {
    const colDef = this.columns[col]
    const record = this.records[row]
    if (!colDef || !record) {
      return
    }
    record[colDef.key] = value
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }
}

/** 格式化表头标题：主键 🔑、关联 🔗、公式 ƒx */
export function formatSmartColumnTitle(col: SmartColumn): string {
  if (col.isUniqueKey) {
    return `🔑 ${col.title}`
  }
  if (col.type === 'lookup') {
    return `🔗 ${col.title}`
  }
  if (col.type === 'formula') {
    return `ƒx ${col.title}`
  }
  return col.title
}

/** 任意基础值安全转文本（避免对象退化为 [object Object]） */
function valueToText(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'object') {
    if ('text' in value && typeof (value as { text?: unknown }).text === 'string') {
      return (value as { text: string }).text
    }
    if ('url' in value && typeof (value as { url?: unknown }).url === 'string') {
      return (value as { url: string }).url
    }
  }
  return ''
}

/** 按列定义与基础值计算展示文本 */
export function formatSmartCellDisplayValue(col: SmartColumn | undefined, value: unknown): string {
  if (!col) {
    return valueToText(value)
  }
  if (col.type === 'checkbox') {
    return value ? '✓' : ''
  }
  if (value === null || value === undefined || value === '') {
    return col.type === 'lookup' ? '-' : ''
  }
  if (col.type === 'progress') {
    const num = typeof value === 'number' ? value : Number(value)
    return formatProgressPercent(num, col.decimalPlaces)
  }
  if (col.type === 'number' || col.numberFormat !== undefined) {
    const num =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN
    if (Number.isFinite(num)) {
      return formatNumberValue(num, col.numberFormat, col.decimalPlaces)
    }
  }
  return valueToText(value)
}

/** 解析单元格超链接（非 link 列返回 null） */
function parseCellLink(col: SmartColumn | undefined, value: unknown): CellLink | null {
  if (!col || col.type !== 'link' || value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    const url = value.trim()
    return url ? { url, text: url } : null
  }
  if (typeof value === 'object' && 'url' in value) {
    const rawUrl = (value as { url?: unknown }).url
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
      return null
    }
    const rawText = 'text' in value ? (value as { text?: unknown }).text : undefined
    const text =
      typeof rawText === 'string' && rawText.trim() !== '' ? rawText.trim() : rawUrl.trim()
    return { url: rawUrl.trim(), text }
  }
  return null
}

/** 解析单元格图片 URL（非 image 列或空串返回 null） */
function parseCellImage(col: SmartColumn | undefined, value: unknown): string | null {
  if (!col || col.type !== 'image' || typeof value !== 'string') {
    return null
  }
  const url = value.trim()
  return url ? url : null
}

/** 判断列是否为可文本编辑列（挂载 onRichCellEdit 时，select/date 交由富交互浮层处理） */
function isColumnEditable(col: SmartColumn | undefined, hasRichCellEdit: boolean): boolean {
  if (!col) {
    return false
  }
  if (hasRichCellEdit && (col.type === 'select' || col.type === 'date')) {
    return false
  }
  return (
    col.type !== 'lookup' &&
    col.type !== 'formula' &&
    col.type !== 'image' &&
    col.type !== 'checkbox'
  )
}

function defaultColumnAlign(col: SmartColumn): CellTextAlign | undefined {
  if (col.align !== undefined) {
    return col.align
  }
  if (col.type === 'checkbox') {
    return 'center'
  }
  if (col.type === 'number' || col.numberFormat !== undefined) {
    return 'right'
  }
  return undefined
}

/** 生成 ListTable 列定义 */
function toColumnDefine(col: SmartColumn, hasRichCellEdit: boolean): ColumnDefine {
  const base: ColumnDefine = {
    field: col.key,
    title: formatSmartColumnTitle(col),
    width: col.width,
  }
  const defaultAlign = defaultColumnAlign(col)
  if (col.type === 'checkbox') {
    base.cellType = 'checkbox'
  }
  if (defaultAlign) {
    base.style = { textAlign: defaultAlign }
  }
  if (isColumnEditable(col, hasRichCellEdit)) {
    base.editor = 'text'
  }
  return base
}

function selectOptionsEqual(
  a: readonly SelectOption[] | undefined,
  b: readonly SelectOption[] | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      a[i]!.label !== b[i]!.label ||
      a[i]!.color !== b[i]!.color ||
      a[i]!.textColor !== b[i]!.textColor
    ) {
      return false
    }
  }
  return true
}

function lookupConfigEqual(
  a: SmartColumn['lookupConfig'],
  b: SmartColumn['lookupConfig'],
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.groupId === b.groupId &&
    a.targetTableId === b.targetTableId &&
    a.targetReturnField === b.targetReturnField &&
    a.mode === b.mode &&
    a.rollupAgg === b.rollupAgg
  )
}

/** 判断可见列结构是否一致（不含 width，width 变化可原地 setColWidths 不重建实例） */
function columnsSchemaEqual(a: readonly SmartColumn[], b: readonly SmartColumn[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    const ca = a[i]!
    const cb = b[i]!
    if (
      ca.key !== cb.key ||
      ca.title !== cb.title ||
      ca.type !== cb.type ||
      ca.align !== cb.align ||
      ca.isUniqueKey !== cb.isUniqueKey ||
      ca.numberFormat !== cb.numberFormat ||
      ca.decimalPlaces !== cb.decimalPlaces ||
      ca.formulaExpr !== cb.formulaExpr ||
      !selectOptionsEqual(ca.options, cb.options) ||
      !lookupConfigEqual(ca.lookupConfig, cb.lookupConfig)
    ) {
      return false
    }
  }
  return true
}

/** 按姓名哈希选取稳定的头像颜色 */
function pickAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!
}

/** 头像缩写：中文姓名取末字，其余取首字母大写 */
function avatarInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  if (/[\u4e00-\u9fa5]/.test(trimmed)) {
    return trimmed.slice(-1)
  }
  return trimmed.slice(0, 1).toUpperCase()
}

/** 测量并计算省略号截断文本与实际渲染宽度 */
function clipTextToWidth(
  ctx: RenderContext,
  text: string,
  maxWidth: number,
): { text: string; width: number } {
  if (maxWidth <= 0 || !text) {
    return { text: '', width: 0 }
  }
  const fullWidth = ctx.measureText(text).width
  if (fullWidth <= maxWidth) {
    return { text, width: fullWidth }
  }
  const ellipsis = '…'
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
  const clipped = text.slice(0, lo) + ellipsis
  return { text: clipped, width: ctx.measureText(clipped).width }
}

/** 在指定水平区域内按对齐方式绘制单行省略号截断文本 */
function drawAlignedClippedText(
  ctx: RenderContext,
  text: string,
  left: number,
  maxWidth: number,
  baselineY: number,
  align?: CellTextAlign,
): void {
  const clipped = clipTextToWidth(ctx, text, maxWidth)
  if (!clipped.text) {
    return
  }
  let x = left
  if (align === 'center') {
    x = left + Math.max(0, (maxWidth - clipped.width) / 2)
  } else if (align === 'right') {
    x = left + Math.max(0, maxWidth - clipped.width)
  }
  ctx.fillText(clipped.text, x, baselineY)
}

/** 计算列头右侧按钮热区（列头自绘与交互命中单源共享） */
function computeHeaderRegions(size: Size): ColHeaderHitRegion[] {
  const y = Math.max(0, Math.round((size.height - HEADER_BTN_HEIGHT) / 2))
  const menuX = size.width - HEADER_BTN_RIGHT_PAD - HEADER_BTN_WIDTH
  if (size.width >= 52) {
    const sortX = menuX - HEADER_BTN_GAP - HEADER_BTN_WIDTH
    return [
      {
        id: 'sort',
        rect: { x: sortX, y, width: HEADER_BTN_WIDTH, height: HEADER_BTN_HEIGHT },
        cursor: 'pointer',
      },
      {
        id: 'menu',
        rect: { x: menuX, y, width: HEADER_BTN_WIDTH, height: HEADER_BTN_HEIGHT },
        cursor: 'pointer',
      },
    ]
  }
  if (size.width >= 28) {
    return [
      {
        id: 'menu',
        rect: { x: menuX, y, width: HEADER_BTN_WIDTH, height: HEADER_BTN_HEIGHT },
        cursor: 'pointer',
      },
    ]
  }
  return []
}

/** 绘制列头矢量排序指示器（双向圆角折线箭头，支持主/次排序视觉区分） */
function drawHeaderSortIndicator(
  ctx: RenderContext,
  rect: Region,
  sortRules: readonly SortRule[],
  field: string,
): void {
  const index = sortRules.findIndex((rule) => rule.field === field)
  const direction = index >= 0 ? sortRules[index]!.direction : null
  const isMultiSort = sortRules.length > 1 && index >= 0

  if (index >= 0) {
    roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, 4)
    ctx.fillStyle = '#ebf1ff'
    ctx.fill()
  }

  const arrowCx = isMultiSort ? rect.x + rect.width / 2 - 2.5 : rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const halfW = 3
  const upTipY = cy - 4.5
  const upBaseY = cy - 1.5
  const downBaseY = cy + 1.5
  const downTipY = cy + 4.5

  const activeColor = index === 0 ? '#2563eb' : '#60a5fa'
  const mutedColor = '#cbd5e1'
  const idleColor = '#94a3b8'

  const drawChevron = (yBase: number, yTip: number, color: string, lineWidth: number): void => {
    ctx.beginPath()
    ctx.moveTo(arrowCx - halfW, yBase)
    ctx.lineTo(arrowCx, yTip)
    ctx.lineTo(arrowCx + halfW, yBase)
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }

  ctx.save()
  if (direction === 'asc') {
    drawChevron(upBaseY, upTipY, activeColor, index === 0 ? 1.8 : 1.6)
    drawChevron(downBaseY, downTipY, mutedColor, 1.25)
  } else if (direction === 'desc') {
    drawChevron(upBaseY, upTipY, mutedColor, 1.25)
    drawChevron(downBaseY, downTipY, activeColor, index === 0 ? 1.8 : 1.6)
  } else {
    drawChevron(upBaseY, upTipY, idleColor, 1.4)
    drawChevron(downBaseY, downTipY, idleColor, 1.4)
  }

  if (isMultiSort) {
    ctx.font = '600 8px sans-serif'
    ctx.fillStyle = activeColor
    ctx.fillText(String(index + 1), arrowCx + 3.5, cy + 4.5)
  }
  ctx.restore()
}

/** 绘制 select 圆角彩色标签胶囊（支持 align 与未命中枚举时的文字色继承） */
function createSelectRenderer(col: SmartColumn): CellRenderer {
  return ({ ctx, width, height, text, style }: CellRenderTarget) => {
    const label = text.trim()
    if (!label) {
      return
    }
    const matched = col.options?.find((opt) => opt.label === label)
    const bgColor = matched?.color ?? '#eef0f3'
    const fgColor = matched?.textColor ?? style.color ?? '#1f2329'
    const fontSize = style.fontSize ?? 12
    ctx.font = `500 ${fontSize}px sans-serif`
    const padX = 8
    const pillH = Math.min(22, Math.max(14, height - 10))
    const maxPillW = Math.max(0, width - 16)
    const measured = ctx.measureText(label).width
    const pillW = Math.min(maxPillW, measured + padX * 2)
    if (pillW <= 0) {
      return
    }
    let pillX = 8
    if (style.textAlign === 'center') {
      pillX = Math.max(8, (width - pillW) / 2)
    } else if (style.textAlign === 'right') {
      pillX = Math.max(8, width - 8 - pillW)
    }
    const pillY = (height - pillH) / 2
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2)
    ctx.fillStyle = bgColor
    ctx.fill()

    ctx.save()
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2)
    ctx.clip()
    ctx.fillStyle = fgColor
    const innerMaxW = Math.max(0, pillW - padX * 2)
    const textX = measured <= innerMaxW ? pillX + (pillW - measured) / 2 : pillX + padX
    const baselineY = pillY + pillH / 2 + Math.round(fontSize / 3)
    drawAlignedClippedText(ctx, label, textX, innerMaxW, baselineY)
    ctx.restore()
  }
}

/** 绘制 person 彩色圆形头像 + 姓名（协调水平对齐与文字色） */
const renderPersonCell: CellRenderer = ({ ctx, width, height, text, style, font }) => {
  const name = text.trim()
  if (!name) {
    return
  }
  const fontSize = style.fontSize ?? 12
  const textFont = font ?? `${fontSize}px sans-serif`
  ctx.font = textFont
  const nameW = ctx.measureText(name).width

  const radius = Math.min(10, Math.max(6, (height - 10) / 2))
  const gap = 6
  const groupW = Math.min(Math.max(0, width - 16), radius * 2 + gap + nameW)
  let startX = 8
  if (style.textAlign === 'center') {
    startX = Math.max(8, (width - groupW) / 2)
  } else if (style.textAlign === 'right') {
    startX = Math.max(8, width - 8 - groupW)
  }

  const cx = startX + radius
  const cy = height / 2
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStyle = pickAvatarColor(name)
  ctx.fill()

  const initial = avatarInitial(name)
  ctx.font = '600 10px sans-serif'
  ctx.fillStyle = '#ffffff'
  const initialW = ctx.measureText(initial).width
  ctx.fillText(initial, cx - initialW / 2, cy + 3.5)

  ctx.font = textFont
  ctx.fillStyle = style.color ?? '#1f2329'
  const textX = cx + radius + gap
  const maxW = Math.max(0, width - textX - 8)
  const baselineY = height / 2 + Math.round(fontSize / 3)
  drawAlignedClippedText(ctx, name, textX, maxW, baselineY)
}

/** 绘制 progress 圆角轨道 + 进度条 + 右侧百分比文字（协调文字色） */
function createProgressRenderer(col: SmartColumn): CellRenderer {
  return ({ ctx, width, height, value, style }) => {
    const raw = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(raw)) {
      return
    }
    const pct = Math.max(0, Math.min(100, raw))
    const barColor = pct >= 100 ? '#16a34a' : pct >= 50 ? '#2563eb' : '#d97706'
    const label = formatProgressPercent(pct, col.decimalPlaces)

    ctx.font = '11px sans-serif'
    const labelW = ctx.measureText(label).width
    const labelGap = 8
    const trackX = 8
    const trackH = 8
    const trackY = (height - trackH) / 2
    const trackW = Math.max(12, width - trackX - 8 - labelW - labelGap)

    roundRectPath(ctx, trackX, trackY, trackW, trackH, trackH / 2)
    ctx.fillStyle = '#e5e7eb'
    ctx.fill()

    if (pct > 0) {
      const fillW = Math.min(trackW, Math.max(trackH, (trackW * pct) / 100))
      roundRectPath(ctx, trackX, trackY, fillW, trackH, trackH / 2)
      ctx.fillStyle = barColor
      ctx.fill()
    }

    ctx.fillStyle = style.color ?? '#4b5563'
    ctx.fillText(label, width - 8 - labelW, height / 2 + 4)
  }
}

/** 绘制带重名冲突/已锁定角标的 lookup 单元格（窄列自动切换紧凑文案与对齐） */
function createLookupConflictRenderer(conflict: LookupConflictInfo): CellRenderer {
  return ({ ctx, width, height, text, style, font }) => {
    const isCompact = width < 155
    const badgeText = isCompact
      ? conflict.isResolved
        ? '✓ 锁定'
        : `⚠️ ${conflict.candidates.length}`
      : conflict.isResolved
        ? '✅ 已锁定'
        : `⚠️ ${conflict.candidates.length}条重名`
    const badgeBg = conflict.isResolved ? '#dcfce7' : '#fef3c7'
    const badgeFg = conflict.isResolved ? '#15803d' : '#b45309'

    ctx.font = '11px sans-serif'
    const badgeTextW = ctx.measureText(badgeText).width
    const badgePadX = 6
    const badgeH = Math.min(20, Math.max(14, height - 10))
    const maxBadgeW = Math.min(76, width * 0.45)
    const badgeW = Math.min(maxBadgeW, badgeTextW + badgePadX * 2)
    const badgeX = Math.max(8, width - 8 - badgeW)
    const badgeY = (height - badgeH) / 2

    const fontSize = style.fontSize ?? 12
    const textMaxW = Math.max(0, badgeX - 14)
    if (text && textMaxW > 4) {
      ctx.font = font ?? `${fontSize}px sans-serif`
      ctx.fillStyle = style.color ?? '#1f2329'
      drawAlignedClippedText(
        ctx,
        text,
        8,
        textMaxW,
        height / 2 + Math.round(fontSize / 3),
        style.textAlign,
      )
    }

    if (badgeW < 12) {
      return
    }

    roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2)
    ctx.fillStyle = badgeBg
    ctx.fill()

    ctx.save()
    roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2)
    ctx.clip()
    ctx.font = '11px sans-serif'
    ctx.fillStyle = badgeFg
    drawAlignedClippedText(
      ctx,
      badgeText,
      badgeX + badgePadX,
      badgeW - badgePadX * 2,
      badgeY + badgeH / 2 + 3.5,
    )
    ctx.restore()
  }
}

/** 委托共享记录校验单源执行必填 required 与字段类型校验及归一化 */
function coerceEditedValue(col: SmartColumn, value: unknown): CellValidationResult {
  return validateAndCoerceCellValue(col, value)
}

/** 判断 DOM 事件目标是否处于单元格文本编辑控件内 */
function isEditingDomTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') {
    return false
  }
  const el = target as { tagName?: unknown; isContentEditable?: unknown }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return true
  }
  return el.isContentEditable === true
}

function toCellStyleOverride(resolved: {
  bgColor?: string
  textColor?: string
  align?: CellTextAlign
}): CellStyle | null {
  if (
    resolved.bgColor === undefined &&
    resolved.textColor === undefined &&
    resolved.align === undefined
  ) {
    return null
  }
  const style: CellStyle = {}
  if (resolved.bgColor !== undefined) {
    style.background = resolved.bgColor
  }
  if (resolved.textColor !== undefined) {
    style.color = resolved.textColor
  }
  if (resolved.align !== undefined) {
    style.textAlign = resolved.align
  }
  return style
}

/** 智能表格画布适配器：持有 ListTable 与自定义 TableModel，支持原生底部汇总行、热区隔离、右键菜单与样式合并 */
export class SmartGridAdapter {
  private readonly container: HTMLElement
  private readonly dpr: number | undefined
  private readonly readonlyMode: boolean
  private readonly showSummaryRow: boolean
  private readonly onCellValueChange: SmartGridOptions['onCellValueChange']
  private readonly onConflictClick: SmartGridOptions['onConflictClick']
  private readonly onRichCellEdit: SmartGridOptions['onRichCellEdit']
  private readonly onValidationError: SmartGridOptions['onValidationError']
  private readonly onScrollChange: SmartGridOptions['onScrollChange']
  private readonly onRowSelectionChange: SmartGridOptions['onRowSelectionChange']
  private readonly onSelectionInfoChange: SmartGridOptions['onSelectionInfoChange']
  private readonly onHeaderSortClick: SmartGridOptions['onHeaderSortClick']
  private readonly onHeaderMenuClick: SmartGridOptions['onHeaderMenuClick']
  private readonly onSummaryCellClick: SmartGridOptions['onSummaryCellClick']
  private readonly onContextMenu: SmartGridOptions['onContextMenu']
  private readonly onColWidthChange: SmartGridOptions['onColWidthChange']

  private allColumns: readonly SmartColumn[]
  private visibleColumns: SmartColumn[]
  private records: readonly SmartRecord[]
  private totalCount: number
  private sortRules: readonly SortRule[]
  private conflictsByRow: Map<string, Map<string, LookupConflictInfo>> | undefined
  private viewPresentation: SmartGridViewPresentation
  private styleResolver: ViewStyleResolver
  private summaries: Record<string, SummaryType>
  private computedSummaries: Record<string, SummaryCellResult>
  private rowHeightPx: number

  private readonly editorRegistry: EditorRegistry
  private readonly model: SmartTableModel
  private readonly watermarkPlugin: WatermarkHandle
  private table: ListTable
  private tableUnsubscribers: Array<() => void> = []
  private readonly containerDisposers: Array<() => void> = []
  private readonly restoreContainerPosition: () => void
  private readonly hostSizeSync: HostContainerSizeSync
  private lastScrollLeft = 0
  private lastScrollTop = 0
  private destroyed = false

  constructor(options: SmartGridOptions) {
    this.container = options.container
    this.restoreContainerPosition = ensureHostContainerPosition(this.container)
    const initialSize = readHostContainerSize(this.container)
    this.dpr = options.dpr
    this.readonlyMode = options.readonly ?? false
    this.showSummaryRow = options.showSummaryRow ?? true
    this.onCellValueChange = options.onCellValueChange
    this.onConflictClick = options.onConflictClick
    this.onRichCellEdit = options.onRichCellEdit
    this.onValidationError = options.onValidationError
    this.onScrollChange = options.onScrollChange
    this.onRowSelectionChange = options.onRowSelectionChange
    this.onSelectionInfoChange = options.onSelectionInfoChange
    this.onHeaderSortClick = options.onHeaderSortClick
    this.onHeaderMenuClick = options.onHeaderMenuClick
    this.onSummaryCellClick = options.onSummaryCellClick
    this.onContextMenu = options.onContextMenu
    this.onColWidthChange = options.onColWidthChange

    this.allColumns = options.columns
    this.records = options.records
    this.totalCount = options.totalCount ?? options.records.length
    this.sortRules = options.sortRules ?? []
    this.conflictsByRow = options.conflictsByRow
    this.viewPresentation = options.view ? { ...options.view } : {}
    this.visibleColumns = resolveVisibleColumns(this.allColumns, this.viewPresentation)
    this.styleResolver = createViewStyleResolver(this.visibleColumns, this.viewPresentation)
    this.rowHeightPx = resolveRowHeightPx(this.viewPresentation.rowHeight)
    this.summaries = options.summaries ? { ...options.summaries } : {}
    this.computedSummaries =
      options.summaryResults ?? computeSummaries(this.records, this.visibleColumns, this.summaries)

    this.editorRegistry = new EditorRegistry()
    this.editorRegistry.registerEditor('text', {})

    this.model = new SmartTableModel(this.visibleColumns, this.records)
    this.watermarkPlugin = createWatermarkPlugin({
      enabled: false,
      text: DEFAULT_WATERMARK_TEXT,
    })

    this.table = this.createListTable(initialSize)
    this.bindContainerEvents()
    this.hostSizeSync = attachHostContainerSizeSync(
      this.container,
      initialSize,
      (width, height) => {
        if (!this.destroyed) {
          this.table.resize(width, height)
        }
      },
    )
  }

  /** 原地更新列结构、行数据、排序、汇总与视图配置（可见列序列未变时原地刷新不重建画布） */
  setData(
    columns: readonly SmartColumn[],
    records: readonly SmartRecord[],
    conflictsByRow?: Map<string, Map<string, LookupConflictInfo>>,
    sortRules?: readonly SortRule[],
    extra?: SmartGridSetDataExtra,
  ): void {
    if (this.destroyed) {
      return
    }
    const prevRowCount = this.records.length
    const nextRowCount = records.length

    this.allColumns = columns
    this.records = records
    this.totalCount = extra?.totalCount ?? records.length
    this.conflictsByRow = conflictsByRow
    if (sortRules !== undefined) {
      this.sortRules = sortRules
    }
    if (extra?.view !== undefined) {
      this.viewPresentation = { ...extra.view }
    }
    if (extra?.summaries !== undefined) {
      this.summaries = { ...extra.summaries }
    }

    const nextVisibleColumns = resolveVisibleColumns(this.allColumns, this.viewPresentation)
    const nextRowHeightPx = resolveRowHeightPx(this.viewPresentation.rowHeight)
    const schemaChanged = !columnsSchemaEqual(this.visibleColumns, nextVisibleColumns)

    this.visibleColumns = nextVisibleColumns
    this.styleResolver = createViewStyleResolver(this.visibleColumns, this.viewPresentation)
    this.rowHeightPx = nextRowHeightPx
    this.computedSummaries =
      extra?.summaryResults ?? computeSummaries(this.records, this.visibleColumns, this.summaries)
    this.model.setData(this.visibleColumns, this.records)

    if (schemaChanged) {
      this.rebuildListTable()
      return
    }

    this.table.batchUpdate(() => {
      this.syncPresentationInPlace(nextVisibleColumns, nextRowHeightPx)
      if (prevRowCount !== nextRowCount) {
        this.table.setRowCount(nextRowCount)
        if (nextRowCount > prevRowCount && this.rowHeightPx !== this.table.rowHeight) {
          for (let r = prevRowCount; r < nextRowCount; r++) {
            this.table.setRowHeight(r, this.rowHeightPx)
          }
        }
      } else {
        this.refreshVisibleBodyCells()
      }
      this.table.refreshColHeaders()
      if (this.showSummaryRow) {
        this.table.refreshBottomRow(0)
      }
    })
    this.hostSizeSync.syncNow()
  }

  /** 原地更新视图呈现与样式配置（列显隐/顺序/宽、冻结列、行高与多层次样式） */
  setViewPresentation(view: SmartGridViewPresentation): void {
    if (this.destroyed) {
      return
    }
    this.viewPresentation = { ...view }
    const nextVisibleColumns = resolveVisibleColumns(this.allColumns, this.viewPresentation)
    const nextRowHeightPx = resolveRowHeightPx(this.viewPresentation.rowHeight)
    const schemaChanged = !columnsSchemaEqual(this.visibleColumns, nextVisibleColumns)

    this.visibleColumns = nextVisibleColumns
    this.styleResolver = createViewStyleResolver(this.visibleColumns, this.viewPresentation)
    this.rowHeightPx = nextRowHeightPx
    this.model.setData(this.visibleColumns, this.records)

    if (schemaChanged) {
      this.rebuildListTable()
      return
    }

    this.table.batchUpdate(() => {
      this.syncPresentationInPlace(nextVisibleColumns, nextRowHeightPx)
      this.refreshVisibleBodyCells()
      this.table.refreshColHeaders()
      if (this.showSummaryRow) {
        this.table.refreshBottomRow(0)
      }
    })
    this.hostSizeSync.syncNow()
  }

  /** 更新列顺序与隐藏列配置 */
  setColumnOrder(columnOrder: string[], hiddenColumns?: string[]): void {
    this.setViewPresentation({
      ...this.viewPresentation,
      columnOrder,
      ...(hiddenColumns !== undefined ? { hiddenColumns } : {}),
    })
  }

  /** 原地设置左侧冻结列数 */
  setFrozenColCount(count: number): void {
    if (this.destroyed) {
      return
    }
    const clamped = Math.max(0, Math.min(this.visibleColumns.length, Math.floor(count)))
    this.viewPresentation = { ...this.viewPresentation, frozenColCount: clamped }
    this.table.setFrozenColCount(clamped)
  }

  /** 原地设置行高（支持预设档位或像素值） */
  setRowHeight(presetOrPx: RowHeightPreset | number): void {
    if (this.destroyed) {
      return
    }
    const nextPx =
      typeof presetOrPx === 'number'
        ? Math.max(MIN_ROW_HEIGHT_PX, Math.round(presetOrPx))
        : resolveRowHeightPx(presetOrPx)
    if (typeof presetOrPx !== 'number') {
      this.viewPresentation = { ...this.viewPresentation, rowHeight: presetOrPx }
    }
    this.rowHeightPx = nextPx
    this.applyRowHeightInPlace(nextPx)
  }

  /** 原地更新排序规则并刷新列头按钮状态 */
  setSortRules(sortRules: readonly SortRule[]): void {
    if (this.destroyed) {
      return
    }
    this.sortRules = sortRules
    this.table.refreshColHeaders()
  }

  /** 原地更新底部汇总配置与计数，局部刷新底部冻结行 */
  setSummaries(
    summaries: Record<string, SummaryType>,
    totalCount?: number,
    summaryResults?: Record<string, SummaryCellResult>,
  ): void {
    if (this.destroyed) {
      return
    }
    this.summaries = { ...summaries }
    if (totalCount !== undefined) {
      this.totalCount = totalCount
    }
    this.computedSummaries =
      summaryResults ?? computeSummaries(this.records, this.visibleColumns, this.summaries)
    if (this.showSummaryRow) {
      this.table.refreshBottomRow(0)
    }
  }

  /** 获取当前画布选区（坐标段 + 解析后的行 ID 与列键） */
  getSelectionInfo(): SmartGridSelectionInfo {
    const snapshot = this.table.getSelection()
    const ranges: SmartGridSelectionRange[] = []
    const allRecordIds = new Set<string>()
    const allColumnKeys = new Set<string>()

    for (const range of snapshot.ranges) {
      const minRow = Math.max(0, Math.min(range.start.row, range.end.row))
      const maxRow = Math.min(this.records.length - 1, Math.max(range.start.row, range.end.row))
      const minCol = Math.max(0, Math.min(range.start.col, range.end.col))
      const maxCol = Math.min(
        this.visibleColumns.length - 1,
        Math.max(range.start.col, range.end.col),
      )

      const recordIds: string[] = []
      for (let r = minRow; r <= maxRow; r++) {
        const record = this.records[r]
        if (record) {
          recordIds.push(record._id)
          allRecordIds.add(record._id)
        }
      }

      const columnKeys: string[] = []
      for (let c = minCol; c <= maxCol; c++) {
        const colDef = this.visibleColumns[c]
        if (colDef) {
          columnKeys.push(colDef.key)
          allColumnKeys.add(colDef.key)
        }
      }

      ranges.push({
        start: { col: minCol, row: minRow },
        end: { col: maxCol, row: maxRow },
        recordIds,
        columnKeys,
      })
    }

    return {
      ranges,
      recordIds: Array.from(allRecordIds),
      columnKeys: Array.from(allColumnKeys),
      focus: snapshot.focus ? { ...snapshot.focus } : null,
    }
  }

  /** 获取当前可见列定义（已应用显隐、顺序与列宽覆盖） */
  getVisibleColumns(): readonly SmartColumn[] {
    return this.visibleColumns
  }

  /** 获取内部数据记录快照（浅拷贝，避免外部引用污染模型） */
  getRecordsSnapshot(): SmartRecord[] {
    return this.model.getRecordsSnapshot()
  }

  /** 触发指定记录单元格进入编辑态（只读或不可编辑列返回 false） */
  startEditCell(recordId: string, fieldKey: string): boolean {
    if (this.destroyed || this.readonlyMode) {
      return false
    }
    const row = this.records.findIndex((record) => record._id === recordId)
    const col = this.visibleColumns.findIndex((column) => column.key === fieldKey)
    if (row < 0 || col < 0) {
      return false
    }
    return this.table.startEdit(col, row)
  }

  /** 将指定记录的单元格恢复为给定值并刷新画布（供外部保存失败回滚） */
  revertCell(recordId: string, fieldKey: string, value: unknown): void {
    if (this.destroyed) {
      return
    }
    const row = this.records.findIndex((record) => record._id === recordId)
    const col = this.visibleColumns.findIndex((column) => column.key === fieldKey)
    if (row < 0 || col < 0) {
      return
    }
    this.model.revertCell(col, row, value)
    this.table.refreshCell(col, row)
  }

  /** 获取指定记录单元格在浏览器视口中的矩形（不可见或不存在返回 null） */
  getCellViewportRect(recordId: string, fieldKey: string): Region | null {
    if (this.destroyed) {
      return null
    }
    const row = this.records.findIndex((record) => record._id === recordId)
    const col = this.visibleColumns.findIndex((column) => column.key === fieldKey)
    if (row < 0 || col < 0) {
      return null
    }
    const cellRect = this.table.getCellRelativeRect(col, row)
    return cellRect ? this.toViewportRect(cellRect) : null
  }

  /** 滚动使目标记录行（可选指定列）完整进入可视区 */
  scrollToRecord(recordId: string, fieldKey?: string): void {
    if (this.destroyed || this.visibleColumns.length === 0) {
      return
    }
    const row = this.records.findIndex((record) => record._id === recordId)
    if (row < 0) {
      return
    }
    let col = this.table.getBodyVisibleCellRange().cols.start
    if (fieldKey !== undefined) {
      const targetCol = this.visibleColumns.findIndex((column) => column.key === fieldKey)
      if (targetCol >= 0) {
        col = targetCol
      }
    }
    col = Math.max(0, Math.min(this.visibleColumns.length - 1, col))
    this.table.scrollToCell({ col, row })
    this.emitScrollChange(this.table.getScrollLeft(), this.table.getScrollTop())
  }

  /** 开关或更新平铺水印 */
  setWatermark(enabled: boolean, text?: string): void {
    if (this.destroyed) {
      return
    }
    this.watermarkPlugin.updateConfig({
      enabled,
      ...(text !== undefined ? { text } : {}),
    })
  }

  /** 获取水印插件句柄 */
  getWatermarkPlugin(): WatermarkHandle {
    return this.watermarkPlugin
  }

  /** 获取底层 ListTable 实例 */
  getTable(): ListTable {
    return this.table
  }

  /** 销毁画布与容器监听 */
  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.hostSizeSync.dispose()
    for (const dispose of this.containerDisposers) {
      dispose()
    }
    this.containerDisposers.length = 0
    this.disposeTable()
    this.restoreContainerPosition()
  }

  private createListTable(fallbackSize?: HostContainerSize): ListTable {
    const measured = readHostContainerSize(this.container)
    const width = measured.width || fallbackSize?.width || DEFAULT_WIDTH
    const height = measured.height || fallbackSize?.height || DEFAULT_HEIGHT
    const hasRichCellEdit = Boolean(this.onRichCellEdit)
    const frozenColCount = Math.max(
      0,
      Math.min(this.visibleColumns.length, this.viewPresentation.frozenColCount ?? 0),
    )

    const table = new ListTable({
      width,
      height,
      rowHeight: this.rowHeightPx,
      headerHeight: DEFAULT_HEADER_HEIGHT,
      rowHeaderWidth: DEFAULT_ROW_HEADER_WIDTH,
      frozenColCount,
      frozenBottomRowCount: this.showSummaryRow ? 1 : 0,
      bottomRowHeight: DEFAULT_BOTTOM_ROW_HEIGHT,
      columns: this.visibleColumns.map((col) => toColumnDefine(col, hasRichCellEdit)),
      model: this.model,
      editorRegistry: this.editorRegistry,
      editCellOnEnter: true,
      fillHandle: false,
      plugins: [this.watermarkPlugin],
      theme: {
        rowHeight: DEFAULT_ROW_HEIGHT,
        headerHeight: DEFAULT_HEADER_HEIGHT,
        rowHeaderWidth: DEFAULT_ROW_HEADER_WIDTH,
        body: {
          font: '13px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: 13,
          color: '#1f2329',
          background: '#ffffff',
          borderColor: '#ebedf0',
        },
        header: {
          font: '600 12px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
          fontSize: 12,
          fontWeight: 600,
          color: '#4e5969',
          background: '#f7f8fa',
          borderColor: '#ebedf0',
        },
        rowHeader: {
          color: '#86909c',
          background: '#f7f8fa',
          borderColor: '#ebedf0',
        },
        corner: {
          background: '#f7f8fa',
          borderColor: '#ebedf0',
        },
        interaction: {
          selectionFill: 'rgba(51, 112, 255, 0.08)',
          selectionBorder: '#3370ff',
          selectionBorderWidth: 1.5,
          resizeLine: '#3370ff',
          headerHighlight: '#ebf1ff',
          freezeDividerColor: '#dcdfe6',
        },
      },
      hostOptions: {
        container: this.container,
        ...(this.dpr !== undefined ? { dpr: this.dpr } : {}),
      },
      resolveDisplayValue: (col, _row, value) =>
        formatSmartCellDisplayValue(this.visibleColumns[col], value),
      resolveCellStyle: (col, row) => this.resolveBodyCellStyle(col, row),
      resolveCellRenderer: (col, row) => this.resolveRenderer(col, row),
      resolveColHeaderStyle: (col) => this.resolveHeaderCellStyle(col),
      resolveColHeaderRenderer: (col) => this.resolveHeaderRenderer(col),
      resolveColHeaderRegions: (_col, size) => computeHeaderRegions(size),
      resolveBottomRowHeaderStyle: () => ({
        background: '#f7f8fa',
        color: '#4e5969',
        fontSize: 11,
        fontWeight: 500,
        textAlign: 'center',
      }),
      resolveBottomRowHeaderRenderer: () => this.resolveSummaryRowHeaderRenderer(),
      resolveBottomCellStyle: (col) => this.resolveSummaryCellStyle(col),
      resolveBottomCellRenderer: (col) => this.resolveSummaryCellRenderer(col),
      resolveCellImage: (col, row) =>
        parseCellImage(this.visibleColumns[col], this.model.getCellValue(col, row)),
      resolveCellLink: (col, row) =>
        parseCellLink(this.visibleColumns[col], this.model.getCellValue(col, row)),
      resolveEditable: (col) =>
        !this.readonlyMode && isColumnEditable(this.visibleColumns[col], hasRichCellEdit),
    })

    this.tableUnsubscribers.push(
      table.onCellChange((change) => this.handleTableCellChange(change)),
      table.onScrollFrame((state) => this.emitScrollChange(state.left, state.top)),
      table.onColResizeEnd(({ col, width: colWidth }) => this.handleColResizeEnd(col, colWidth)),
      table.onColHeaderClick((event) => this.handleColHeaderClick(event)),
      table.onBottomCellClick((event) => this.handleBottomCellClick(event)),
      table.onSelectionChange((snapshot) => {
        if (this.onSelectionInfoChange) {
          this.onSelectionInfoChange(this.getSelectionInfo())
        }
        if (!this.onRowSelectionChange) {
          return
        }
        const ids = new Set<string>()
        for (const range of snapshot.ranges) {
          const minRow = Math.max(0, Math.min(range.start.row, range.end.row))
          const maxRow = Math.min(this.records.length - 1, Math.max(range.start.row, range.end.row))
          for (let r = minRow; r <= maxRow; r++) {
            const record = this.records[r]
            if (record) {
              ids.add(record._id)
            }
          }
        }
        this.onRowSelectionChange(Array.from(ids))
      }),
    )

    if (this.onContextMenu) {
      this.tableUnsubscribers.push(
        table.onContextMenu((event) => this.handleTableContextMenu(event)),
      )
    }

    return table
  }

  private rebuildListTable(): void {
    const scrollLeft = this.table.getScrollLeft()
    const scrollTop = this.table.getScrollTop()
    this.disposeTable()
    this.table = this.createListTable(this.hostSizeSync.getLastValidSize())
    if (scrollLeft > 0 || scrollTop > 0) {
      this.table.scrollTo(scrollLeft, scrollTop)
    }
  }

  private disposeTable(): void {
    for (const unsub of this.tableUnsubscribers) {
      unsub()
    }
    this.tableUnsubscribers = []
    this.table.destroy()
  }

  private syncPresentationInPlace(
    nextVisibleColumns: readonly SmartColumn[],
    nextRowHeightPx: number,
  ): void {
    const widthUpdates = new Map<number, number>()
    for (let i = 0; i < nextVisibleColumns.length; i++) {
      const nextWidth = nextVisibleColumns[i]!.width
      if (this.table.getColWidth(i) !== nextWidth) {
        widthUpdates.set(i, nextWidth)
      }
    }
    if (widthUpdates.size > 0) {
      this.table.setColWidths(widthUpdates)
    }

    const nextFrozen = Math.max(
      0,
      Math.min(nextVisibleColumns.length, this.viewPresentation.frozenColCount ?? 0),
    )
    if (this.table.getFrozenColCount() !== nextFrozen) {
      this.table.setFrozenColCount(nextFrozen)
    }

    this.applyRowHeightInPlace(nextRowHeightPx)
  }

  private applyRowHeightInPlace(nextPx: number): void {
    if (nextPx === this.table.rowHeight) {
      this.table.resetRowHeights()
      return
    }
    if (this.records.length === 0) {
      return
    }
    const heights = new Map<number, number>()
    for (let r = 0; r < this.records.length; r++) {
      heights.set(r, nextPx)
    }
    this.table.setRowHeights(heights)
  }

  private refreshVisibleBodyCells(): void {
    const { rows } = this.table.getBodyVisibleCellRange()
    const endRow = Math.min(this.records.length, rows.end)
    for (let r = rows.start; r < endRow; r++) {
      for (let c = 0; c < this.visibleColumns.length; c++) {
        this.table.refreshCell(c, r)
      }
    }
  }

  private resolveBodyCellStyle(col: number, row: number): CellStyle | null {
    const colDef = this.visibleColumns[col]
    const record = this.records[row]
    if (!colDef || !record) {
      return null
    }
    return toCellStyleOverride(this.styleResolver.resolveCell(record, colDef.key))
  }

  private resolveHeaderCellStyle(col: number): CellStyle | null {
    const colDef = this.visibleColumns[col]
    if (!colDef) {
      return null
    }
    return toCellStyleOverride(this.styleResolver.resolveHeader(colDef.key))
  }

  private resolveHeaderRenderer(col: number): CellRenderer | null {
    const colDef = this.visibleColumns[col]
    if (!colDef) {
      return null
    }
    return ({ ctx, width, height, style, font }: CellRenderTarget) => {
      const regions = computeHeaderRegions({ width, height })
      const leftPad = 8
      const rightBound = regions.length > 0 ? regions[0]!.rect.x - 4 : width - 8
      const titleMaxW = Math.max(0, rightBound - leftPad)

      const fontSize = style.fontSize ?? 12
      ctx.font = font ?? `600 ${fontSize}px sans-serif`
      ctx.fillStyle = style.color ?? '#4e5969'
      const baselineY = height / 2 + Math.round(fontSize / 3)
      drawAlignedClippedText(
        ctx,
        formatSmartColumnTitle(colDef),
        leftPad,
        titleMaxW,
        baselineY,
        style.textAlign,
      )

      const sortRegion = regions.find((r) => r.id === 'sort')
      if (sortRegion) {
        drawHeaderSortIndicator(ctx, sortRegion.rect, this.sortRules, colDef.key)
      }

      const menuRegion = regions.find((r) => r.id === 'menu')
      if (menuRegion) {
        const r = menuRegion.rect
        const glyph = '⋯'
        ctx.font = '600 12px sans-serif'
        ctx.fillStyle = '#646a73'
        const glyphW = ctx.measureText(glyph).width
        ctx.fillText(glyph, r.x + (r.width - glyphW) / 2, r.y + r.height / 2 + 4)
      }
    }
  }

  private resolveSummaryRowHeaderRenderer(): CellRenderer {
    return ({ ctx, width, height, style }: CellRenderTarget) => {
      const countText =
        this.records.length === this.totalCount
          ? `共 ${this.records.length} 条`
          : `${this.records.length}/${this.totalCount}`
      const fontSize = style.fontSize ?? 11
      ctx.font = `500 ${fontSize}px sans-serif`
      ctx.fillStyle = style.color ?? '#4e5969'
      drawAlignedClippedText(
        ctx,
        countText,
        4,
        Math.max(0, width - 8),
        height / 2 + Math.round(fontSize / 3),
        'center',
      )
    }
  }

  private resolveSummaryCellStyle(col: number): CellStyle | null {
    const colDef = this.visibleColumns[col]
    if (!colDef) {
      return null
    }
    const headerAlign = this.styleResolver.resolveHeader(colDef.key).align
    const align = headerAlign ?? defaultColumnAlign(colDef) ?? 'left'
    return {
      background: '#f7f8fa',
      color: '#1f2329',
      fontSize: 12,
      textAlign: align,
    }
  }

  private resolveSummaryCellRenderer(col: number): CellRenderer | null {
    const colDef = this.visibleColumns[col]
    if (!colDef) {
      return null
    }
    const summaryType = this.summaries[colDef.key] ?? 'none'
    if (summaryType === 'none') {
      return null
    }
    const label = SUMMARY_SHORT_LABELS[summaryType]
    const result = this.computedSummaries[colDef.key]
    const valueText =
      result?.text ??
      formatSummaryValue(null, summaryType, colDef.numberFormat, colDef.decimalPlaces)

    return ({ ctx, width, height, style }: CellRenderTarget) => {
      const innerW = Math.max(0, width - 16)
      if (innerW <= 0) {
        return
      }
      const baselineY = height / 2 + 4
      ctx.font = '600 12px sans-serif'
      const valW = ctx.measureText(valueText).width
      ctx.font = '11px sans-serif'
      const labelW = ctx.measureText(label).width

      if (style.textAlign === 'right' && innerW >= labelW + valW + 10) {
        ctx.font = '11px sans-serif'
        ctx.fillStyle = '#86909c'
        ctx.fillText(label, 8, baselineY)

        ctx.font = '600 12px sans-serif'
        ctx.fillStyle = style.color ?? '#1f2329'
        ctx.fillText(valueText, width - 8 - valW, baselineY)
        return
      }

      const fullText = innerW >= labelW + valW + 8 ? `${label} ${valueText}` : valueText
      ctx.font = '600 12px sans-serif'
      ctx.fillStyle = style.color ?? '#1f2329'
      drawAlignedClippedText(ctx, fullText, 8, innerW, baselineY, style.textAlign)
    }
  }

  private resolveRenderer(col: number, row: number): CellRenderer | null {
    const colDef = this.visibleColumns[col]
    if (!colDef) {
      return null
    }
    if (colDef.type === 'select') {
      return createSelectRenderer(colDef)
    }
    if (colDef.type === 'person') {
      return renderPersonCell
    }
    if (colDef.type === 'progress') {
      return createProgressRenderer(colDef)
    }
    if (colDef.type === 'lookup' && colDef.lookupConfig?.mode === 'one') {
      const conflict = this.getLookupConflict(colDef, row)
      if (conflict && conflict.candidates.length > 1) {
        return createLookupConflictRenderer(conflict)
      }
    }
    return null
  }

  private getLookupConflict(colDef: SmartColumn, row: number): LookupConflictInfo | undefined {
    const groupId = colDef.lookupConfig?.groupId
    const record = this.records[row]
    if (!groupId || !record) {
      return undefined
    }
    return this.conflictsByRow?.get(record._id)?.get(groupId)
  }

  private handleTableCellChange(change: CellChangeEvent): void {
    const colDef = this.visibleColumns[change.col]
    const record = this.records[change.row]
    if (!colDef || !record) {
      return
    }
    const result = coerceEditedValue(colDef, change.newValue)
    if (!result.valid) {
      this.model.revertCell(change.col, change.row, change.oldValue)
      this.table.refreshCell(change.col, change.row)
      this.onValidationError?.(result.message)
      return
    }
    if (result.value !== change.newValue) {
      this.model.revertCell(change.col, change.row, result.value)
      this.table.refreshCell(change.col, change.row)
    }
    this.onCellValueChange?.(record._id, colDef.key, result.value)
  }

  private handleColResizeEnd(col: number, width: number): void {
    const colDef = this.visibleColumns[col]
    if (!colDef) {
      return
    }
    colDef.width = width
    this.viewPresentation = {
      ...this.viewPresentation,
      columnWidths: {
        ...this.viewPresentation.columnWidths,
        [colDef.key]: width,
      },
    }
    this.onColWidthChange?.({
      column: colDef,
      columnKey: colDef.key,
      colIndex: col,
      width,
    })
  }

  private handleColHeaderClick(event: ColHeaderClickEvent): void {
    const colDef = this.visibleColumns[event.col]
    if (!colDef) {
      return
    }
    if (event.hitId === 'sort') {
      this.onHeaderSortClick?.({
        column: colDef,
        field: colDef.key,
        colIndex: event.col,
        additive: event.originalEvent.shiftKey ?? false,
        rect: this.toViewportRect(event.hitRect ?? event.rect),
      })
      return
    }
    if (event.hitId === 'menu') {
      this.onHeaderMenuClick?.({
        column: colDef,
        columnKey: colDef.key,
        colIndex: event.col,
        rect: this.toViewportRect(event.hitRect ?? event.rect),
        headerRect: this.toViewportRect(event.rect),
      })
    }
  }

  private handleBottomCellClick(event: BottomCellClickEvent): void {
    const colDef = this.visibleColumns[event.col]
    if (!colDef || !this.onSummaryCellClick) {
      return
    }
    this.onSummaryCellClick({
      column: colDef,
      columnKey: colDef.key,
      colIndex: event.col,
      summaryType: this.summaries[colDef.key] ?? 'none',
      rect: this.toViewportRect(event.rect),
    })
  }

  private handleTableContextMenu(event: TableContextMenuEvent): void {
    if (!this.onContextMenu) {
      return
    }
    const containerRect = this.container.getBoundingClientRect()
    const viewportX = containerRect.left + event.x
    const viewportY = containerRect.top + event.y
    const selection = this.getSelectionInfo()

    if (event.region === 'col-header') {
      const colIndex = this.resolveColIndexAt(event.x)
      const column = colIndex !== null ? (this.visibleColumns[colIndex] ?? null) : null
      const rect =
        colIndex !== null
          ? this.getHeaderViewportRect(colIndex)
          : { x: viewportX, y: viewportY, width: 0, height: 0 }
      this.onContextMenu({
        region: 'col-header',
        x: viewportX,
        y: viewportY,
        rect,
        cell: null,
        colIndex,
        rowIndex: null,
        column,
        record: null,
        selection,
      })
      return
    }

    if (event.region === 'row-header') {
      const rowIndex = this.resolveRowIndexAt(event.y)
      const record =
        rowIndex !== null
          ? (this.model.getRecordSnapshot(rowIndex) ?? this.records[rowIndex] ?? null)
          : null
      const rect =
        rowIndex !== null
          ? this.getRowHeaderViewportRect(rowIndex, viewportX, viewportY)
          : { x: viewportX, y: viewportY, width: 0, height: 0 }
      this.onContextMenu({
        region: 'row-header',
        x: viewportX,
        y: viewportY,
        rect,
        cell: null,
        colIndex: null,
        rowIndex,
        column: null,
        record,
        selection,
      })
      return
    }

    const cell = event.cell
    const colIndex = cell ? cell.col : null
    const rowIndex = cell ? cell.row : null
    const column = colIndex !== null ? (this.visibleColumns[colIndex] ?? null) : null
    const record =
      rowIndex !== null
        ? (this.model.getRecordSnapshot(rowIndex) ?? this.records[rowIndex] ?? null)
        : null
    const cellRect = cell ? this.table.getCellRelativeRect(cell.col, cell.row) : null
    const rect = cellRect
      ? this.toViewportRect(cellRect)
      : { x: viewportX, y: viewportY, width: 0, height: 0 }

    this.onContextMenu({
      region: 'body',
      x: viewportX,
      y: viewportY,
      rect,
      cell,
      colIndex,
      rowIndex,
      column,
      record,
      selection,
    })
  }

  private toViewportRect(cellRect: Region): Region {
    const containerRect = this.container.getBoundingClientRect()
    return {
      x: containerRect.left + cellRect.x,
      y: containerRect.top + cellRect.y,
      width: cellRect.width,
      height: cellRect.height,
    }
  }

  private emitScrollChange(scrollLeft: number, scrollTop: number): void {
    if (scrollLeft === this.lastScrollLeft && scrollTop === this.lastScrollTop) {
      return
    }
    this.lastScrollLeft = scrollLeft
    this.lastScrollTop = scrollTop
    this.onScrollChange?.(scrollLeft, scrollTop)
  }

  private isInsideBodyDrawRange(x: number, y: number): boolean {
    const drawRange = this.table.getDrawRange()
    return (
      x >= drawRange.x &&
      y >= drawRange.y &&
      x < drawRange.x + drawRange.width &&
      y < drawRange.y + drawRange.height
    )
  }

  private resolveColIndexAt(x: number): number | null {
    const table = this.table
    if (x < table.rowHeaderWidth || x >= table.rowHeaderWidth + table.viewportWidth) {
      return null
    }
    const rel = x - table.rowHeaderWidth
    const contentX = rel < table.geometryState.frozenColsWidth ? rel : rel + table.getScrollLeft()
    const offsets = table.geometryState.colOffsets
    for (let i = 0; i < offsets.length - 1; i++) {
      if (contentX >= offsets[i]! && contentX < offsets[i + 1]!) {
        return i
      }
    }
    return null
  }

  private resolveRowIndexAt(y: number): number | null {
    if (this.visibleColumns.length === 0) {
      return null
    }
    const hit = this.table.getCellAtRelativePosition(this.table.rowHeaderWidth + 1, y)
    return hit ? hit.row : null
  }

  private getHeaderViewportRect(index: number): Region {
    const table = this.table
    const offsets = table.geometryState.colOffsets
    const contentX = offsets[index] ?? 0
    const rel =
      contentX < table.geometryState.frozenColsWidth ? contentX : contentX - table.getScrollLeft()
    return this.toViewportRect({
      x: rel + table.rowHeaderWidth,
      y: 0,
      width: (offsets[index + 1] ?? contentX + table.getColWidth(index)) - contentX,
      height: table.headerHeight,
    })
  }

  private getRowHeaderViewportRect(rowIndex: number, fallbackX: number, fallbackY: number): Region {
    const cellRect =
      this.visibleColumns.length > 0 ? this.table.getCellRelativeRect(0, rowIndex) : null
    if (cellRect) {
      return this.toViewportRect({
        x: 0,
        y: cellRect.y,
        width: this.table.rowHeaderWidth,
        height: cellRect.height,
      })
    }
    return {
      x: fallbackX,
      y: fallbackY,
      width: this.table.rowHeaderWidth,
      height: this.table.getRowHeight(rowIndex),
    }
  }

  private bindContainerEvents(): void {
    let downAt: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent): void => {
      downAt = { x: event.clientX, y: event.clientY }
    }
    const onClick = (event: MouseEvent): void => {
      const down = downAt
      downAt = null
      if (isEditingDomTarget(event.target)) {
        return
      }
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP) {
        return
      }
      const rect = this.container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (!this.isInsideBodyDrawRange(x, y)) {
        return
      }
      const cell = this.table.getCellAtRelativePosition(x, y)
      if (!cell) {
        return
      }
      const colDef = this.visibleColumns[cell.col]
      const record = this.model.getRecordSnapshot(cell.row) ?? this.records[cell.row]
      if (!colDef || !record) {
        return
      }

      if (colDef.type === 'checkbox') {
        if (this.readonlyMode) {
          return
        }
        const nextVal = !this.table.getCellValue(cell.col, cell.row)
        this.table.updateCell(cell.col, cell.row, nextVal)
        this.onCellValueChange?.(record._id, colDef.key, nextVal)
        return
      }

      if (colDef.type === 'lookup' && colDef.lookupConfig?.mode === 'one') {
        const conflict = this.getLookupConflict(colDef, cell.row)
        if (conflict && conflict.candidates.length > 1) {
          const cellRect = this.table.getCellRelativeRect(cell.col, cell.row) ?? {
            x,
            y,
            width: colDef.width,
            height: this.rowHeightPx,
          }
          this.onConflictClick?.({
            record,
            column: colDef,
            conflict,
            rect: this.toViewportRect(cellRect),
          })
        }
      }
    }

    const onDblClick = (event: MouseEvent): void => {
      if (this.readonlyMode || !this.onRichCellEdit || isEditingDomTarget(event.target)) {
        return
      }
      const rect = this.container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      if (!this.isInsideBodyDrawRange(x, y)) {
        return
      }
      const cell = this.table.getCellAtRelativePosition(x, y)
      if (!cell) {
        return
      }
      const colDef = this.visibleColumns[cell.col]
      const record = this.model.getRecordSnapshot(cell.row) ?? this.records[cell.row]
      if (!colDef || !record || (colDef.type !== 'select' && colDef.type !== 'date')) {
        return
      }
      const cellRect = this.table.getCellRelativeRect(cell.col, cell.row) ?? {
        x,
        y,
        width: colDef.width,
        height: this.rowHeightPx,
      }
      this.onRichCellEdit({
        record,
        column: colDef,
        rect: this.toViewportRect(cellRect),
        value: this.model.getCellValue(cell.col, cell.row),
      })
    }

    const onWheel = (event: WheelEvent): void => {
      if (this.table.usesNativeScrollbar) {
        return
      }
      let deltaX = Number.isFinite(event.deltaX) ? event.deltaX : 0
      let deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0
      if (event.shiftKey && deltaY && !deltaX) {
        deltaX = deltaY
        deltaY = 0
      }
      if (!deltaX && !deltaY) {
        return
      }
      const beforeLeft = this.table.getScrollLeft()
      const beforeTop = this.table.getScrollTop()
      this.table.scrollBy(deltaX, deltaY)
      const afterLeft = this.table.getScrollLeft()
      const afterTop = this.table.getScrollTop()
      const consumed = afterLeft !== beforeLeft || afterTop !== beforeTop
      if (consumed) {
        this.emitScrollChange(afterLeft, afterTop)
        if (event.cancelable) {
          event.preventDefault()
        }
      }
    }

    this.container.addEventListener('pointerdown', onPointerDown)
    this.container.addEventListener('click', onClick)
    this.container.addEventListener('dblclick', onDblClick)
    this.container.addEventListener('wheel', onWheel, { passive: false })
    this.containerDisposers.push(() => {
      this.container.removeEventListener('pointerdown', onPointerDown)
      this.container.removeEventListener('click', onClick)
      this.container.removeEventListener('dblclick', onDblClick)
      this.container.removeEventListener('wheel', onWheel)
    })
  }
}
