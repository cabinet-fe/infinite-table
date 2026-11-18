// 智能表格画布适配层：封装 @infinitable/table 的 ListTable，提供富媒体列渲染、
// 数字格式化、checkbox 点击切换、VLOOKUP 冲突角标与消歧触发、水印插件挂载与容器自适应。

import {
  EditorRegistry,
  ListTable,
  type CellChangeEvent,
  type CellLink,
  type CellRenderer,
  type CellRenderTarget,
  type ColumnDefine,
  type TableModel,
} from '@infinitable/table'
import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'
import { roundRectPath, type Region, type RenderContext } from '@infinitable/render'

import type {
  LookupConflictInfo,
  SelectOption,
  SmartColumn,
  SmartRecord,
  SortRule,
} from '../shared/schema'

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

/** 汇总栏单个列的几何镜像（left 为画布内容坐标，滚动由消费方自行扣除） */
export interface FooterColumnLayout {
  field: string
  left: number
  width: number
}

/** 汇总栏布局快照：行表头宽、列几何、滚动条预留厚与内容总宽（全部取自引擎布局） */
export interface FooterLayout {
  rowHeaderWidth: number
  scrollbarSize: number
  contentWidth: number
  columns: FooterColumnLayout[]
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
  onCellValueChange?: (recordId: string, fieldKey: string, newValue: unknown) => void
  onConflictClick?: (info: SmartGridConflictClickInfo) => void
  onRichCellEdit?: (info: SmartGridRichEditInfo) => void
  onValidationError?: (message: string) => void
  onScrollChange?: (scrollLeft: number, scrollTop: number) => void
  onRowSelectionChange?: (recordIds: string[]) => void
  onHeaderColumnClick?: (field: string, meta: { additive: boolean }) => void
  /** 列头右键（仅数据列）：抛列定义与列头视口矩形，供宿主挂字段设置面板 */
  onHeaderContextMenu?: (info: { column: SmartColumn; rect: Region }) => void
  onFooterLayoutChange?: (layout: FooterLayout) => void
}

/** 点击判定位移阈值（与引擎链接单击/透视表组格单击同口径） */
const CLICK_SLOP = 10
/** 列边界列宽拖拽热区半宽（与引擎 resize 命中阈值同口径，热区内点击不触发排序） */
const RESIZE_HOT_PX = 4
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 500
const DEFAULT_ROW_HEIGHT = 38
const DEFAULT_HEADER_HEIGHT = 38
const DEFAULT_WATERMARK_TEXT = '智能表格 · 内部数据'
const AVATAR_PALETTE = ['#3370ff', '#00b42a', '#ff7d00', '#722ed1', '#eb2f96', '#0fc6c2'] as const

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

/** 按当前排序规则取列头方向指示：首规则实心箭头、次级规则空心箭头 */
function sortIndicatorFor(sortRules: readonly SortRule[], field: string): string {
  const index = sortRules.findIndex((rule) => rule.field === field)
  if (index < 0) {
    return ''
  }
  const asc = sortRules[index]!.direction === 'asc'
  return index === 0 ? (asc ? ' ▲' : ' ▼') : asc ? ' △' : ' ▽'
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

/** 数值按列 format 格式化 */
function formatNumberBySpec(num: number, format: SmartColumn['numberFormat']): string {
  if (!Number.isFinite(num)) {
    return ''
  }
  if (format === 'currency') {
    const abs = Math.abs(num)
    const formatted = Number.isInteger(abs)
      ? abs.toLocaleString('en-US')
      : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return num < 0 ? `-¥${formatted}` : `¥${formatted}`
  }
  if (format === 'percent') {
    const pct = Number((num * 100).toFixed(1))
    return `${pct}%`
  }
  if (format === 'integer') {
    return Math.round(num).toLocaleString('en-US')
  }
  if (format === 'decimal') {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return Number.isInteger(num)
    ? num.toLocaleString('en-US')
    : num.toLocaleString('en-US', { maximumFractionDigits: 2 })
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
    if (!Number.isFinite(num)) {
      return ''
    }
    const clamped = Math.max(0, Math.min(100, num))
    return `${Number(clamped.toFixed(1))}%`
  }
  if (col.type === 'number' || col.numberFormat !== undefined) {
    const num =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : Number.NaN
    if (Number.isFinite(num)) {
      return formatNumberBySpec(num, col.numberFormat)
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

/** 生成 ListTable 列定义（标题按当前排序规则追加方向指示） */
function toColumnDefine(
  col: SmartColumn,
  hasRichCellEdit: boolean,
  sortRules: readonly SortRule[],
): ColumnDefine {
  const isNumeric = col.type === 'number' || col.numberFormat !== undefined
  const base: ColumnDefine = {
    field: col.key,
    title: formatSmartColumnTitle(col) + sortIndicatorFor(sortRules, col.key),
    width: col.width,
  }
  if (col.type === 'checkbox') {
    base.cellType = 'checkbox'
    base.style = { textAlign: 'center' }
  } else if (isNumeric) {
    base.style = { textAlign: 'right' }
  }
  if (isColumnEditable(col, hasRichCellEdit)) {
    base.editor = 'text'
  }
  return base
}

/** 判断两组排序规则是否一致（不一致时列头箭头需重建列定义刷新） */
function sortRulesEqual(a: readonly SortRule[], b: readonly SortRule[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.field !== b[i]!.field || a[i]!.direction !== b[i]!.direction) {
      return false
    }
  }
  return true
}

/** 判断两组列定义是否在结构或展示配置上完全一致（一致时可原地刷新行数据而不重建实例） */
function columnsEqual(a: readonly SmartColumn[], b: readonly SmartColumn[]): boolean {
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
      ca.width !== cb.width ||
      ca.isUniqueKey !== cb.isUniqueKey ||
      ca.numberFormat !== cb.numberFormat ||
      ca.formulaExpr !== cb.formulaExpr ||
      !selectOptionsEqual(ca.options, cb.options) ||
      !lookupConfigEqual(ca.lookupConfig, cb.lookupConfig)
    ) {
      return false
    }
  }
  return true
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

/** 按姓名哈希选取稳定的头像颜色 */
function pickAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!
}

/** 头像缩写：中文姓名取首字或末字，其余取首字母大写 */
function avatarInitial(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  if (/[\u4e00-\u9fa5]/.test(trimmed)) {
    return trimmed.slice(-1)
  }
  return trimmed.slice(0, 1).toUpperCase()
}

/** 单行单格省略号截断绘制 */
function drawClippedText(
  ctx: RenderContext,
  text: string,
  x: number,
  baselineY: number,
  maxWidth: number,
): void {
  if (maxWidth <= 0 || !text) {
    return
  }
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, baselineY)
    return
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
  ctx.fillText(text.slice(0, lo) + ellipsis, x, baselineY)
}

/** 绘制 select 圆角彩色标签胶囊 */
function createSelectRenderer(col: SmartColumn): CellRenderer {
  return ({ ctx, width, height, text, style }: CellRenderTarget) => {
    const label = text.trim()
    if (!label) {
      return
    }
    const matched = col.options?.find((opt) => opt.label === label)
    const bgColor = matched?.color ?? '#eef0f3'
    const fgColor = matched?.textColor ?? '#1f2329'
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
    const pillX = 8
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
    drawClippedText(ctx, label, textX, baselineY, innerMaxW)
    ctx.restore()
  }
}

/** 绘制 person 彩色圆形头像 + 姓名 */
const renderPersonCell: CellRenderer = ({ ctx, width, height, text, style, font }) => {
  const name = text.trim()
  if (!name) {
    return
  }
  const radius = Math.min(10, Math.max(6, (height - 10) / 2))
  const cx = 8 + radius
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

  const fontSize = style.fontSize ?? 12
  ctx.font = font ?? `${fontSize}px sans-serif`
  ctx.fillStyle = style.color ?? '#1f2329'
  const textX = cx + radius + 6
  const maxW = Math.max(0, width - textX - 8)
  const baselineY = height / 2 + Math.round(fontSize / 3)
  drawClippedText(ctx, name, textX, baselineY, maxW)
}

/** 绘制 progress 圆角轨道 + 进度条 + 右侧百分比文字 */
const renderProgressCell: CellRenderer = ({ ctx, width, height, value }) => {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) {
    return
  }
  const pct = Math.max(0, Math.min(100, raw))
  const barColor = pct >= 100 ? '#16a34a' : pct >= 50 ? '#2563eb' : '#d97706'
  const label = `${Number(pct.toFixed(1))}%`

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

  ctx.fillStyle = '#4b5563'
  ctx.fillText(label, width - 8 - labelW, height / 2 + 4)
}

/** 绘制带重名冲突/已锁定角标的 lookup 单元格（窄列自动切换紧凑文案与最大宽度限制） */
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
      drawClippedText(ctx, text, 8, height / 2 + Math.round(fontSize / 3), textMaxW)
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
    drawClippedText(
      ctx,
      badgeText,
      badgeX + badgePadX,
      badgeY + badgeH / 2 + 3.5,
      badgeW - badgePadX * 2,
    )
    ctx.restore()
  }
}

type CoerceEditResult = { valid: true; value: unknown } | { valid: false; message: string }

/** 将编辑器文本按列类型校验并归一化回写类型（number/progress 校验失败不写入脏值） */
function coerceEditedValue(col: SmartColumn, value: unknown): CoerceEditResult {
  if (col.type !== 'number' && col.type !== 'progress') {
    return { valid: true, value }
  }
  if (value === null || value === undefined) {
    return { valid: true, value: null }
  }
  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') {
      return { valid: true, value: null }
    }
    parsed = Number(trimmed)
  } else {
    return { valid: false, message: '请输入有效数值' }
  }
  if (!Number.isFinite(parsed)) {
    return { valid: false, message: '请输入有效数值' }
  }
  const normalized = col.type === 'progress' ? Math.max(0, Math.min(100, parsed)) : parsed
  return { valid: true, value: normalized }
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

/** 智能表格画布适配器：持有 ListTable 与自定义 TableModel，支持原地数据刷新与交互桥接 */
export class SmartGridAdapter {
  private readonly container: HTMLElement
  private readonly dpr: number | undefined
  private readonly readonlyMode: boolean
  private readonly onCellValueChange: SmartGridOptions['onCellValueChange']
  private readonly onConflictClick: SmartGridOptions['onConflictClick']
  private readonly onRichCellEdit: SmartGridOptions['onRichCellEdit']
  private readonly onValidationError: SmartGridOptions['onValidationError']
  private readonly onScrollChange: SmartGridOptions['onScrollChange']
  private readonly onRowSelectionChange: SmartGridOptions['onRowSelectionChange']
  private readonly onHeaderColumnClick: SmartGridOptions['onHeaderColumnClick']
  private readonly onHeaderContextMenu: SmartGridOptions['onHeaderContextMenu']
  private readonly onFooterLayoutChange: SmartGridOptions['onFooterLayoutChange']

  private columns: readonly SmartColumn[]
  private records: readonly SmartRecord[]
  private sortRules: readonly SortRule[]
  private conflictsByRow: Map<string, Map<string, LookupConflictInfo>> | undefined

  private readonly editorRegistry: EditorRegistry
  private readonly model: SmartTableModel
  private readonly watermarkPlugin: WatermarkHandle
  private table: ListTable
  private tableUnsubscribers: Array<() => void> = []
  private readonly containerDisposers: Array<() => void> = []
  private resizeObserver: ResizeObserver | null = null
  private lastScrollLeft = 0
  private lastScrollTop = 0
  private destroyed = false

  constructor(options: SmartGridOptions) {
    this.container = options.container
    this.dpr = options.dpr
    this.readonlyMode = options.readonly ?? false
    this.onCellValueChange = options.onCellValueChange
    this.onConflictClick = options.onConflictClick
    this.onRichCellEdit = options.onRichCellEdit
    this.onValidationError = options.onValidationError
    this.onScrollChange = options.onScrollChange
    this.onRowSelectionChange = options.onRowSelectionChange
    this.onHeaderColumnClick = options.onHeaderColumnClick
    this.onHeaderContextMenu = options.onHeaderContextMenu
    this.onFooterLayoutChange = options.onFooterLayoutChange

    this.columns = options.columns
    this.records = options.records
    this.sortRules = options.sortRules ?? []
    this.conflictsByRow = options.conflictsByRow

    this.editorRegistry = new EditorRegistry()
    this.editorRegistry.registerEditor('text', {})

    this.model = new SmartTableModel(this.columns, this.records)
    this.watermarkPlugin = createWatermarkPlugin({
      enabled: false,
      text: DEFAULT_WATERMARK_TEXT,
    })

    this.table = this.createListTable()
    this.bindContainerEvents()
    this.bindResizeObserver()
  }

  /** 原地更新列结构与行数据：列定义/排序指示未变时走 TableModel + setRowCount/refreshCell 不重建画布 */
  setData(
    columns: readonly SmartColumn[],
    records: readonly SmartRecord[],
    conflictsByRow?: Map<string, Map<string, LookupConflictInfo>>,
    sortRules?: readonly SortRule[],
  ): void {
    if (this.destroyed) {
      return
    }
    // 必须在覆写 this.records / this.model.setData 之前读取旧行数：
    // ListTable.rowCount 在模型形态下实时代理 model.rowCount，模型先改再读会导致 prevRowCount === nextRowCount
    const prevRowCount = this.records.length
    const nextRowCount = records.length
    const schemaChanged = !columnsEqual(this.columns, columns)
    const nextSortRules = sortRules ?? this.sortRules
    const sortChanged = !sortRulesEqual(this.sortRules, nextSortRules)
    this.columns = columns
    this.records = records
    this.sortRules = nextSortRules
    this.conflictsByRow = conflictsByRow
    this.model.setData(columns, records)

    if (schemaChanged || sortChanged) {
      this.rebuildListTable()
      return
    }

    this.table.batchUpdate(() => {
      if (prevRowCount !== nextRowCount) {
        this.table.setRowCount(nextRowCount)
      } else {
        const { rows } = this.table.getBodyVisibleCellRange()
        const endRow = Math.min(nextRowCount, rows.end)
        for (let r = rows.start; r < endRow; r++) {
          for (let c = 0; c < this.columns.length; c++) {
            this.table.refreshCell(c, r)
          }
        }
      }
    })
  }

  /** 获取内部数据记录快照（浅拷贝，避免外部引用污染模型） */
  getRecordsSnapshot(): SmartRecord[] {
    return this.model.getRecordsSnapshot()
  }

  /** 将指定记录的单元格恢复为给定值并刷新画布（供外部保存失败回滚） */
  revertCell(recordId: string, fieldKey: string, value: unknown): void {
    if (this.destroyed) {
      return
    }
    const row = this.records.findIndex((record) => record._id === recordId)
    const col = this.columns.findIndex((column) => column.key === fieldKey)
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
    const col = this.columns.findIndex((column) => column.key === fieldKey)
    if (row < 0 || col < 0) {
      return null
    }
    const cellRect = this.table.getCellRelativeRect(col, row)
    return cellRect ? this.toViewportRect(cellRect) : null
  }

  /** 滚动使目标记录行（可选指定列）完整进入可视区 */
  scrollToRecord(recordId: string, fieldKey?: string): void {
    if (this.destroyed || this.columns.length === 0) {
      return
    }
    const row = this.records.findIndex((record) => record._id === recordId)
    if (row < 0) {
      return
    }
    let col = this.table.getBodyVisibleCellRange().cols.start
    if (fieldKey !== undefined) {
      const targetCol = this.columns.findIndex((column) => column.key === fieldKey)
      if (targetCol >= 0) {
        col = targetCol
      }
    }
    col = Math.max(0, Math.min(this.columns.length - 1, col))
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

  /** 汇总栏布局快照：行表头宽、列内容坐标几何、滚动条预留厚与内容总宽（引擎布局直读，不自行累加列宽） */
  getFooterLayout(): FooterLayout {
    return this.buildFooterLayout(this.table)
  }

  private buildFooterLayout(table: ListTable): FooterLayout {
    const offsets = table.geometryState.colOffsets
    return {
      rowHeaderWidth: table.rowHeaderWidth,
      scrollbarSize: table.theme.interaction.scrollbarSize,
      contentWidth: table.contentWidth,
      columns: this.columns.map((col, i) => ({
        field: col.key,
        left: offsets[i] ?? 0,
        width: table.getColWidth(i),
      })),
    }
  }

  /** 构造/重建期间 this.table 尚未赋值，传入正在装配的 table 实例 */
  private emitFooterLayout(table: ListTable = this.table): void {
    this.onFooterLayoutChange?.(this.buildFooterLayout(table))
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
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    for (const dispose of this.containerDisposers) {
      dispose()
    }
    this.containerDisposers.length = 0
    this.disposeTable()
  }

  private createListTable(): ListTable {
    const width = this.container.clientWidth || DEFAULT_WIDTH
    const height = this.container.clientHeight || DEFAULT_HEIGHT
    const hasRichCellEdit = Boolean(this.onRichCellEdit)
    const table = new ListTable({
      width,
      height,
      rowHeight: DEFAULT_ROW_HEIGHT,
      headerHeight: DEFAULT_HEADER_HEIGHT,
      columns: this.columns.map((col) => toColumnDefine(col, hasRichCellEdit, this.sortRules)),
      model: this.model,
      editorRegistry: this.editorRegistry,
      editCellOnEnter: true,
      // 关闭选区右下角填充柄（柄绘制/命中/十字光标随引擎联动关闭），选区交互保持
      fillHandle: false,
      plugins: [this.watermarkPlugin],
      theme: {
        rowHeight: DEFAULT_ROW_HEIGHT,
        headerHeight: DEFAULT_HEADER_HEIGHT,
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
        formatSmartCellDisplayValue(this.columns[col], value),
      resolveCellRenderer: (col, row) => this.resolveRenderer(col, row),
      resolveCellImage: (col, row) =>
        parseCellImage(this.columns[col], this.model.getCellValue(col, row)),
      resolveCellLink: (col, row) =>
        parseCellLink(this.columns[col], this.model.getCellValue(col, row)),
      resolveEditable: (col) =>
        !this.readonlyMode && isColumnEditable(this.columns[col], hasRichCellEdit),
    })

    this.tableUnsubscribers.push(
      table.onCellChange((change) => this.handleTableCellChange(change)),
      table.onScrollFrame((state) => this.emitScrollChange(state.left, state.top)),
      // 列宽拖拽结束即刻推送新布局，保持汇总栏与画布列对齐
      table.onColResizeEnd(() => this.emitFooterLayout()),
      table.onSelectionChange((snapshot) => {
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

    // 建表即推送一次布局快照（构造与重建路径共用），汇总栏随列定义就位
    this.emitFooterLayout(table)

    return table
  }

  private rebuildListTable(): void {
    const scrollLeft = this.table.getScrollLeft()
    const scrollTop = this.table.getScrollTop()
    this.disposeTable()
    this.table = this.createListTable()
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

  private resolveRenderer(col: number, row: number): CellRenderer | null {
    const colDef = this.columns[col]
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
      return renderProgressCell
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
    const colDef = this.columns[change.col]
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

  /**
   * 列头命中解析：行表头/角格、checkbox 列与列边界拖拽热区（±RESIZE_HOT_PX，与引擎
   * resize 命中同口径）不命中；命中数据列返回其索引与列定义。
   */
  private resolveHeaderColumnAt(x: number): { index: number; colDef: SmartColumn } | null {
    if (x < this.table.rowHeaderWidth) {
      return null
    }
    const table = this.table
    const rel = x - table.rowHeaderWidth
    const contentX = rel < table.geometryState.frozenColsWidth ? rel : rel + table.getScrollLeft()
    const offsets = table.geometryState.colOffsets
    for (let i = 0; i < offsets.length - 1; i++) {
      if (contentX < offsets[i]! || contentX >= offsets[i + 1]!) {
        continue
      }
      const colDef = this.columns[i]
      if (!colDef || colDef.type === 'checkbox') {
        return null
      }
      // 落在列边界热区（列宽拖拽把手）让位给 resize
      const distToEdges = Math.min(contentX - offsets[i]!, offsets[i + 1]! - contentX)
      if (distToEdges <= RESIZE_HOT_PX) {
        return null
      }
      return { index: i, colDef }
    }
    return null
  }

  /** 列头单击命中数据列时按 shiftKey 抛 additive 点击排序回调 */
  private handleHeaderColumnClick(x: number, additive: boolean): void {
    if (!this.onHeaderColumnClick) {
      return
    }
    const hit = this.resolveHeaderColumnAt(x)
    if (hit) {
      this.onHeaderColumnClick(hit.colDef.key, { additive })
    }
  }

  /** 列头单元格在浏览器视口中的矩形（列头恒在可视区，直接由列几何换算） */
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
      // 列头带优先路由：未拖拽的单击经引擎几何换算列 field 抛给宿主做点击排序
      if (y < this.table.headerHeight) {
        this.handleHeaderColumnClick(x, event.shiftKey)
        return
      }
      if (!this.isInsideBodyDrawRange(x, y)) {
        return
      }
      const cell = this.table.getCellAtRelativePosition(x, y)
      if (!cell) {
        return
      }
      const colDef = this.columns[cell.col]
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
            height: DEFAULT_ROW_HEIGHT,
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
      const colDef = this.columns[cell.col]
      const record = this.model.getRecordSnapshot(cell.row) ?? this.records[cell.row]
      if (!colDef || !record || (colDef.type !== 'select' && colDef.type !== 'date')) {
        return
      }
      const cellRect = this.table.getCellRelativeRect(cell.col, cell.row) ?? {
        x,
        y,
        width: colDef.width,
        height: DEFAULT_ROW_HEIGHT,
      }
      this.onRichCellEdit({
        record,
        column: colDef,
        rect: this.toViewportRect(cellRect),
        value: this.model.getCellValue(cell.col, cell.row),
      })
    }

    const onContextMenu = (event: MouseEvent): void => {
      if (!this.onHeaderContextMenu) {
        return
      }
      const rect = this.container.getBoundingClientRect()
      const y = event.clientY - rect.top
      if (y >= this.table.headerHeight) {
        return
      }
      const hit = this.resolveHeaderColumnAt(event.clientX - rect.left)
      if (!hit) {
        return
      }
      event.preventDefault()
      this.onHeaderContextMenu({ column: hit.colDef, rect: this.getHeaderViewportRect(hit.index) })
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
    this.container.addEventListener('contextmenu', onContextMenu)
    this.container.addEventListener('wheel', onWheel, { passive: false })
    this.containerDisposers.push(() => {
      this.container.removeEventListener('pointerdown', onPointerDown)
      this.container.removeEventListener('click', onClick)
      this.container.removeEventListener('dblclick', onDblClick)
      this.container.removeEventListener('contextmenu', onContextMenu)
      this.container.removeEventListener('wheel', onWheel)
    })
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed) {
        return
      }
      const width = this.container.clientWidth
      const height = this.container.clientHeight
      if (width > 0 && height > 0) {
        this.table.resize(width, height)
      }
    })
    this.resizeObserver.observe(this.container)
  }
}
