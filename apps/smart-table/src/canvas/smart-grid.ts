// 智能表格画布适配层：封装 @infinitable/table 的 ListTable，提供富媒体列渲染、
// 数字格式化、checkbox 点击切换、VLOOKUP 冲突角标与消歧触发、水印/打印插件挂载与容器自适应。

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
import {
  createPrintPlugin,
  createWatermarkPlugin,
  type PrintConfig,
  type PrintPluginHandle,
  type WatermarkHandle,
} from '@infinitable/plugins'
import { roundRectPath, type Region, type RenderContext } from '@infinitable/render'

import type { LookupConflictInfo, SelectOption, SmartColumn, SmartRecord } from '../shared/schema'

/** 冲突角标点击回调入参 */
export interface SmartGridConflictClickInfo {
  record: SmartRecord
  column: SmartColumn
  conflict: LookupConflictInfo
  rect: Region
}

/** SmartGridAdapter 构造配置 */
export interface SmartGridOptions {
  container: HTMLElement
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  conflictsByRow?: Map<string, Map<string, LookupConflictInfo>>
  readonly?: boolean
  dpr?: number
  onCellValueChange?: (recordId: string, fieldKey: string, newValue: unknown) => void
  onConflictClick?: (info: SmartGridConflictClickInfo) => void
  onRowSelectionChange?: (recordIds: string[]) => void
}

/** 点击判定位移阈值（与引擎链接单击/透视表组格单击同口径） */
const CLICK_SLOP = 10
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 500
const DEFAULT_WATERMARK_TEXT = '智能表格 · 内部数据'
const AVATAR_PALETTE = ['#3370ff', '#00b42a', '#ff7d00', '#722ed1', '#eb2f96', '#0fc6c2'] as const

/** 自定义表格数据模型：支持记录数组原地替换与单元格回写 */
class SmartTableModel implements TableModel {
  private columns: readonly SmartColumn[]
  private records: readonly SmartRecord[]
  private readonly changeListeners = new Set<(change: CellChangeEvent) => void>()

  constructor(columns: readonly SmartColumn[], records: readonly SmartRecord[]) {
    this.columns = columns
    this.records = records
  }

  get rowCount(): number {
    return this.records.length
  }

  setData(columns: readonly SmartColumn[], records: readonly SmartRecord[]): void {
    this.columns = columns
    this.records = records
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

/** 判断列是否为可编辑列 */
function isColumnEditable(col: SmartColumn | undefined): boolean {
  if (!col) {
    return false
  }
  return (
    col.type !== 'lookup' &&
    col.type !== 'formula' &&
    col.type !== 'image' &&
    col.type !== 'checkbox'
  )
}

/** 生成 ListTable 列定义 */
function toColumnDefine(col: SmartColumn): ColumnDefine {
  const isNumeric = col.type === 'number' || col.numberFormat !== undefined
  const base: ColumnDefine = {
    field: col.key,
    title: formatSmartColumnTitle(col),
    width: col.width,
  }
  if (col.type === 'checkbox') {
    base.cellType = 'checkbox'
    base.style = { textAlign: 'center' }
  } else if (isNumeric) {
    base.style = { textAlign: 'right' }
  }
  if (isColumnEditable(col)) {
    base.editor = 'text'
  }
  return base
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

/** 绘制带重名冲突/已锁定角标的 lookup 单元格 */
function createLookupConflictRenderer(conflict: LookupConflictInfo): CellRenderer {
  return ({ ctx, width, height, text, style, font }) => {
    const badgeText = conflict.isResolved ? '✅ 已锁定' : `⚠️ ${conflict.candidates.length}条重名`
    const badgeBg = conflict.isResolved ? '#dcfce7' : '#fef3c7'
    const badgeFg = conflict.isResolved ? '#15803d' : '#b45309'

    ctx.font = '11px sans-serif'
    const badgeTextW = ctx.measureText(badgeText).width
    const badgePadX = 6
    const badgeH = Math.min(20, Math.max(14, height - 10))
    const badgeW = Math.min(Math.max(40, width * 0.62), badgeTextW + badgePadX * 2)
    const badgeX = Math.max(8, width - 8 - badgeW)
    const badgeY = (height - badgeH) / 2

    const fontSize = style.fontSize ?? 12
    const textMaxW = Math.max(0, badgeX - 14)
    if (text && textMaxW > 4) {
      ctx.font = font ?? `${fontSize}px sans-serif`
      ctx.fillStyle = style.color ?? '#1f2329'
      drawClippedText(ctx, text, 8, height / 2 + Math.round(fontSize / 3), textMaxW)
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

/** 将编辑器文本按列类型归一化回写类型 */
function coerceEditedValue(col: SmartColumn, value: unknown): unknown {
  if (col.type !== 'number' && col.type !== 'progress') {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') {
      return null
    }
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}

/** 智能表格画布适配器：持有 ListTable 与自定义 TableModel，支持原地数据刷新与交互桥接 */
export class SmartGridAdapter {
  private readonly container: HTMLElement
  private readonly dpr: number | undefined
  private readonly readonlyMode: boolean
  private readonly onCellValueChange: SmartGridOptions['onCellValueChange']
  private readonly onConflictClick: SmartGridOptions['onConflictClick']
  private readonly onRowSelectionChange: SmartGridOptions['onRowSelectionChange']

  private columns: readonly SmartColumn[]
  private records: readonly SmartRecord[]
  private conflictsByRow: Map<string, Map<string, LookupConflictInfo>> | undefined

  private readonly editorRegistry: EditorRegistry
  private readonly model: SmartTableModel
  private readonly watermarkPlugin: WatermarkHandle
  private readonly printPlugin: PrintPluginHandle
  private table: ListTable
  private tableUnsubscribers: Array<() => void> = []
  private readonly containerDisposers: Array<() => void> = []
  private resizeObserver: ResizeObserver | null = null
  private destroyed = false

  constructor(options: SmartGridOptions) {
    this.container = options.container
    this.dpr = options.dpr
    this.readonlyMode = options.readonly ?? false
    this.onCellValueChange = options.onCellValueChange
    this.onConflictClick = options.onConflictClick
    this.onRowSelectionChange = options.onRowSelectionChange

    this.columns = options.columns
    this.records = options.records
    this.conflictsByRow = options.conflictsByRow

    this.editorRegistry = new EditorRegistry()
    this.editorRegistry.registerEditor('text', {})

    this.model = new SmartTableModel(this.columns, this.records)
    this.watermarkPlugin = createWatermarkPlugin({
      enabled: false,
      text: DEFAULT_WATERMARK_TEXT,
    })
    this.printPlugin = createPrintPlugin({})

    this.table = this.createListTable()
    this.bindContainerEvents()
    this.bindResizeObserver()
  }

  /** 原地更新列结构与行数据：列定义未变时走 TableModel + setRowCount/refreshCell 不重建画布 */
  setData(
    columns: readonly SmartColumn[],
    records: readonly SmartRecord[],
    conflictsByRow?: Map<string, Map<string, LookupConflictInfo>>,
  ): void {
    if (this.destroyed) {
      return
    }
    const schemaChanged = !columnsEqual(this.columns, columns)
    this.columns = columns
    this.records = records
    this.conflictsByRow = conflictsByRow
    this.model.setData(columns, records)

    if (schemaChanged) {
      this.rebuildListTable()
      return
    }

    const prevRowCount = this.table.rowCount
    const nextRowCount = records.length
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

  /** 调起打印（支持传标题串或完整 PrintConfig） */
  print(titleOrConfig?: string | PrintConfig): Promise<void> {
    const config: PrintConfig | undefined =
      typeof titleOrConfig === 'string'
        ? { headerFooter: { header: { center: titleOrConfig } } }
        : titleOrConfig
    return this.printPlugin.print(config)
  }

  /** 打开打印预览弹层 */
  openPrintPreview(config?: PrintConfig) {
    return this.printPlugin.openPreview(config)
  }

  /** 获取打印插件句柄 */
  getPrintPlugin(): PrintPluginHandle {
    return this.printPlugin
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
    const table = new ListTable({
      width,
      height,
      columns: this.columns.map(toColumnDefine),
      model: this.model,
      editorRegistry: this.editorRegistry,
      editCellOnEnter: true,
      plugins: [this.watermarkPlugin, this.printPlugin],
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
      resolveEditable: (col) => !this.readonlyMode && isColumnEditable(this.columns[col]),
    })

    this.tableUnsubscribers.push(
      table.onCellChange((change) => this.handleTableCellChange(change)),
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
    const coerced = coerceEditedValue(colDef, change.newValue)
    if (coerced !== change.newValue) {
      this.model.setCellValue(change.col, change.row, coerced)
      this.table.refreshCell(change.col, change.row)
    }
    this.onCellValueChange?.(record._id, colDef.key, coerced)
  }

  private bindContainerEvents(): void {
    let downAt: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent): void => {
      downAt = { x: event.clientX, y: event.clientY }
    }
    const onClick = (event: MouseEvent): void => {
      const down = downAt
      downAt = null
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_SLOP) {
        return
      }
      const rect = this.container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const cell = this.table.getCellAtRelativePosition(x, y)
      if (!cell) {
        return
      }
      const colDef = this.columns[cell.col]
      const record = this.records[cell.row]
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
            height: 32,
          }
          this.onConflictClick?.({
            record,
            column: colDef,
            conflict,
            rect: cellRect,
          })
        }
      }
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
      const consumed =
        this.table.getScrollLeft() !== beforeLeft || this.table.getScrollTop() !== beforeTop
      if (consumed && event.cancelable) {
        event.preventDefault()
      }
    }

    this.container.addEventListener('pointerdown', onPointerDown)
    this.container.addEventListener('click', onClick)
    this.container.addEventListener('wheel', onWheel, { passive: false })
    this.containerDisposers.push(() => {
      this.container.removeEventListener('pointerdown', onPointerDown)
      this.container.removeEventListener('click', onClick)
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
