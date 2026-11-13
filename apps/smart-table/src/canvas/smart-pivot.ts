// 多维透视画布适配层：封装 @infinitable/pivot 的 PivotGrid，
// 负责 SmartColumn -> PivotDimension / PivotMeasure 映射、配置与记录原地刷新、水印/打印插件及双击下钻桥接。

import {
  PivotGrid,
  type PivotCellDrillEvent,
  type PivotDimension,
  type PivotMeasure,
} from '@infinitable/pivot'
import {
  createPrintPlugin,
  createWatermarkPlugin,
  type PrintConfig,
  type PrintPluginHandle,
  type WatermarkHandle,
} from '@infinitable/plugins'

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
  private readonly printPlugin: PrintPluginHandle
  private readonly disposers: Array<() => void> = []
  private resizeObserver: ResizeObserver | null = null
  private destroyed = false

  constructor(options: SmartPivotOptions) {
    this.container = options.container
    const { dimensions, measures } = columnsToPivotFields(options.columns)
    const measurePool = mergeMeasurePool(measures, options.config)
    const selection = resolveActiveSelection(dimensions, measurePool, options.config)

    this.pivot = new PivotGrid({
      container: options.container,
      dimensions,
      measures: measurePool,
      records: options.records,
      rowDimensions: selection.rowDimensions,
      columnDimensions: selection.columnDimensions,
      activeMeasures: selection.activeMeasures,
      showGrandTotal: options.config.showGrandTotal ?? true,
      collapsible: options.config.collapsible ?? true,
      ...(options.dpr !== undefined ? { dpr: options.dpr } : {}),
    })

    this.watermarkPlugin = createWatermarkPlugin({
      enabled: false,
      text: DEFAULT_WATERMARK_TEXT,
    })
    this.printPlugin = createPrintPlugin({})
    this.pivot.use(this.watermarkPlugin)
    this.pivot.use(this.printPlugin)

    if (options.onCellDrill) {
      this.disposers.push(this.pivot.onCellDrill(options.onCellDrill))
    }
    this.bindResizeObserver()
  }

  /** 原地更新列池、记录与透视配置（不销毁重建 PivotGrid 实例） */
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

    this.pivot.setDimensions(dimensions)
    this.pivot.setMeasurePool(measurePool)
    this.pivot.setRecords(params.records)
    if (selection.rowDimensions.length > 0) {
      this.pivot.setRowDimensions(selection.rowDimensions)
    }
    this.pivot.setColumnDimensions(selection.columnDimensions)
    if (selection.activeMeasures.length > 0) {
      this.pivot.setMeasures(selection.activeMeasures)
    }
    if (params.config.collapsible !== undefined) {
      this.pivot.setCollapsible(params.config.collapsible)
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
