// 多维透视画布适配层：封装 @infinitable/pivot 的 PivotGrid，
// 负责 SmartColumn -> PivotDimension / PivotMeasure 映射、配置与记录原地刷新、水印插件及双击下钻桥接。

import {
  PivotGrid,
  type PivotCellDrillEvent,
  type PivotDimension,
  type PivotMeasure,
} from '@infinitable/pivot'
import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'

import type { SmartColumn, SmartColumnType, SmartPivotConfig, SmartRecord } from '../shared/schema'

/** SmartPivotAdapter 构造参数 */
export interface SmartPivotOptions {
  container: HTMLElement
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  config: SmartPivotConfig
  dpr?: number
  onCellDrill?: (event: PivotCellDrillEvent) => void
}

/** 不适合作为分组维度的媒体/展示列类型 */
const NON_DIMENSION_TYPES = new Set<SmartColumnType>(['image', 'link'])
const DEFAULT_WATERMARK_TEXT = '智能表格 · 透视分析'

/** 按列 numberFormat 格式化透视数值（与网格格式化口径对齐） */
function formatPivotMeasureValue(
  num: number,
  format: SmartColumn['numberFormat'] | undefined,
): string {
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
  return Number.isInteger(num) ? num.toLocaleString('en-US') : num.toFixed(1)
}

/** 提取列字段 → numberFormat 映射 */
function buildNumberFormatMap(
  columns: readonly SmartColumn[],
): Map<string, SmartColumn['numberFormat']> {
  const map = new Map<string, SmartColumn['numberFormat']>()
  for (const col of columns) {
    if (col.numberFormat !== undefined) {
      map.set(col.key, col.numberFormat)
    }
  }
  return map
}

function serializeNumberFormatMap(map: ReadonlyMap<string, SmartColumn['numberFormat']>): string {
  return JSON.stringify(Array.from(map.entries()))
}

/** 判断列是否为可数值聚合的默认度量候选 */
function isNumericMeasureColumn(col: SmartColumn): boolean {
  if (col.type === 'number' || col.type === 'progress' || col.type === 'formula') {
    return true
  }
  if (col.type === 'lookup') {
    if (col.lookupConfig?.mode === 'rollup' && col.lookupConfig.rollupAgg !== 'join') {
      return true
    }
    return col.numberFormat !== undefined
  }
  return false
}

/** 将智能表列定义映射为透视表维度池与度量池 */
export function columnsToPivotFields(columns: readonly SmartColumn[]): {
  dimensions: PivotDimension[]
  measures: PivotMeasure[]
} {
  const dimensions: PivotDimension[] = []
  const measures: PivotMeasure[] = []

  for (const col of columns) {
    if (!NON_DIMENSION_TYPES.has(col.type)) {
      dimensions.push({
        key: col.key,
        title: col.title,
        width: Math.max(80, col.width || 120),
      })
    }
    if (isNumericMeasureColumn(col)) {
      measures.push({
        key: col.key,
        title: col.title,
        field: col.key,
        agg: 'sum',
        width: Math.max(100, col.width || 120),
      })
    }
  }

  measures.push({
    key: '__count__',
    title: '记录数',
    field: '__count__',
    agg: 'count',
    width: 100,
  })

  return { dimensions, measures }
}

/** 将用户配置中的度量项并入度量池，确保自定义 key / agg / title 可被 PivotGrid 识别 */
function mergeMeasurePool(
  baseMeasures: readonly PivotMeasure[],
  config: SmartPivotConfig,
): PivotMeasure[] {
  const map = new Map<string, PivotMeasure>()
  for (const m of baseMeasures) {
    map.set(m.key, { ...m })
  }
  for (const cfg of config.measures) {
    const existing = map.get(cfg.key)
    map.set(cfg.key, {
      key: cfg.key,
      title: cfg.title,
      field: cfg.field,
      agg: cfg.agg,
      width: cfg.width ?? existing?.width ?? 120,
    })
  }
  return Array.from(map.values())
}

/** 解析有效的行维度与激活度量序列（兜底避免 PivotModel 空序列拒绝） */
function resolveActiveSelection(
  dimensions: readonly PivotDimension[],
  measurePool: readonly PivotMeasure[],
  config: SmartPivotConfig,
): { rowDimensions: string[]; columnDimensions: string[]; activeMeasures: string[] } {
  const dimKeys = new Set(dimensions.map((d) => d.key))
  const rowDimensions = config.rowDimensions.filter((k) => dimKeys.has(k))
  if (rowDimensions.length === 0 && dimensions[0]) {
    rowDimensions.push(dimensions[0].key)
  }
  const columnDimensions = config.columnDimensions.filter((k) => dimKeys.has(k))
  const measureKeys = new Set(measurePool.map((m) => m.key))
  const activeMeasures = config.measures.map((m) => m.key).filter((k) => measureKeys.has(k))
  if (activeMeasures.length === 0 && measurePool[0]) {
    activeMeasures.push(measurePool[0].key)
  }
  return { rowDimensions, columnDimensions, activeMeasures }
}

/** 多维透视画布适配器：封装 PivotGrid，提供原地数据/配置刷新、水印打印与双击下钻 */
export class SmartPivotAdapter {
  private readonly container: HTMLElement
  private readonly pivot: PivotGrid
  private readonly watermarkPlugin: WatermarkHandle
  private readonly disposers: Array<() => void> = []
  private resizeObserver: ResizeObserver | null = null
  private destroyed = false

  // 缓存上次生效的配置签名，避免 update 时无条件重建并清空折叠状态
  private lastDimensionsSig: string
  private lastMeasurePoolSig: string
  private lastRowDimensionsSig: string
  private lastColumnDimensionsSig: string
  private lastActiveMeasuresSig: string
  private lastCollapsible: boolean
  private lastShowGrandTotal: boolean
  private numberFormatByField: Map<string, SmartColumn['numberFormat']>
  private lastNumberFormatSig: string

  constructor(options: SmartPivotOptions) {
    this.container = options.container
    const { dimensions, measures } = columnsToPivotFields(options.columns)
    const measurePool = mergeMeasurePool(measures, options.config)
    const selection = resolveActiveSelection(dimensions, measurePool, options.config)
    const showGrandTotal = options.config.showGrandTotal ?? true
    const collapsible = options.config.collapsible ?? true

    this.lastDimensionsSig = JSON.stringify(dimensions)
    this.lastMeasurePoolSig = JSON.stringify(measurePool)
    this.lastRowDimensionsSig = JSON.stringify(selection.rowDimensions)
    this.lastColumnDimensionsSig = JSON.stringify(selection.columnDimensions)
    this.lastActiveMeasuresSig = JSON.stringify(selection.activeMeasures)
    this.lastCollapsible = collapsible
    this.lastShowGrandTotal = showGrandTotal
    this.numberFormatByField = buildNumberFormatMap(options.columns)
    this.lastNumberFormatSig = serializeNumberFormatMap(this.numberFormatByField)

    this.pivot = new PivotGrid({
      container: options.container,
      dimensions,
      measures: measurePool,
      records: options.records,
      rowDimensions: selection.rowDimensions,
      columnDimensions: selection.columnDimensions,
      activeMeasures: selection.activeMeasures,
      showGrandTotal,
      collapsible,
      ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
    })
    this.applyMeasureFormatter()

    this.watermarkPlugin = createWatermarkPlugin({
      enabled: false,
      text: DEFAULT_WATERMARK_TEXT,
    })
    this.pivot.use(this.watermarkPlugin)

    if (options.onCellDrill) {
      this.disposers.push(this.pivot.onCellDrill(options.onCellDrill))
    }
    this.bindResizeObserver()
  }

  /** 原地更新列池、记录与透视配置（仅当结构签名变化时更新对应配置，保留行维度树折叠态） */
  update(params: {
    columns: readonly SmartColumn[]
    records: readonly SmartRecord[]
    config: SmartPivotConfig
  }): void {
    if (this.destroyed) {
      return
    }
    const { dimensions, measures } = columnsToPivotFields(params.columns)
    const measurePool = mergeMeasurePool(measures, params.config)
    const selection = resolveActiveSelection(dimensions, measurePool, params.config)

    const dimensionsSig = JSON.stringify(dimensions)
    if (dimensionsSig !== this.lastDimensionsSig) {
      this.lastDimensionsSig = dimensionsSig
      this.pivot.setDimensions(dimensions)
    }

    const measurePoolSig = JSON.stringify(measurePool)
    if (measurePoolSig !== this.lastMeasurePoolSig) {
      this.lastMeasurePoolSig = measurePoolSig
      this.pivot.setMeasurePool(measurePool)
    }

    const nextFormatMap = buildNumberFormatMap(params.columns)
    const nextFormatSig = serializeNumberFormatMap(nextFormatMap)
    if (nextFormatSig !== this.lastNumberFormatSig) {
      this.lastNumberFormatSig = nextFormatSig
      this.numberFormatByField = nextFormatMap
      this.applyMeasureFormatter()
    }

    this.pivot.setRecords(params.records)

    const rowDimsSig = JSON.stringify(selection.rowDimensions)
    if (rowDimsSig !== this.lastRowDimensionsSig && selection.rowDimensions.length > 0) {
      this.lastRowDimensionsSig = rowDimsSig
      this.pivot.setRowDimensions(selection.rowDimensions)
    }

    const colDimsSig = JSON.stringify(selection.columnDimensions)
    if (colDimsSig !== this.lastColumnDimensionsSig) {
      this.lastColumnDimensionsSig = colDimsSig
      this.pivot.setColumnDimensions(selection.columnDimensions)
    }

    const activeMeasuresSig = JSON.stringify(selection.activeMeasures)
    if (activeMeasuresSig !== this.lastActiveMeasuresSig && selection.activeMeasures.length > 0) {
      this.lastActiveMeasuresSig = activeMeasuresSig
      this.pivot.setMeasures(selection.activeMeasures)
    }

    if (
      params.config.collapsible !== undefined &&
      params.config.collapsible !== this.lastCollapsible
    ) {
      this.lastCollapsible = params.config.collapsible
      this.pivot.setCollapsible(params.config.collapsible)
    }

    const nextShowGrandTotal = params.config.showGrandTotal ?? true
    if (nextShowGrandTotal !== this.lastShowGrandTotal) {
      this.lastShowGrandTotal = nextShowGrandTotal
    }
  }

  /** 订阅数据格双击下钻事件 */
  onCellDrill(listener: (event: PivotCellDrillEvent) => void): () => void {
    return this.pivot.onCellDrill(listener)
  }

  /** 展开全部行维度节点 */
  expandAll(): void {
    this.pivot.expandAll()
  }

  /** 收起全部行维度节点 */
  collapseAll(): void {
    this.pivot.collapseAll()
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

  /** 获取底层 PivotGrid 实例 */
  getPivot(): PivotGrid {
    return this.pivot
  }

  /** 销毁画布与监听 */
  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    for (const dispose of this.disposers) {
      dispose()
    }
    this.disposers.length = 0
    this.pivot.destroy()
  }

  private applyMeasureFormatter(): void {
    this.pivot.setMeasureFormatter((measure, value) => {
      if (measure.agg === 'count') {
        return formatPivotMeasureValue(value, 'integer')
      }
      const format = this.numberFormatByField.get(measure.field)
      return formatPivotMeasureValue(value, format)
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
        this.pivot.getTable().resize(width, height)
      }
    })
    this.resizeObserver.observe(this.container)
  }
}
