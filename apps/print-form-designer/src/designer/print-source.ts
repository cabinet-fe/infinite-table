// 打印供数适配（P8）：P6 数据态表单快照 → print 插件 PrintSource。
//
// 数据链（预览与打印共用同一条，同输入同输出）：文档绑定 sidecar → 按
// （数据集 × 重塑表达式）收集形态 → 原始行经 reshapeDatasetData（P7 唯一重塑
// 管线）重塑 → renderDataState 数据态快照 → 还原进只读 Sheet 模型逐项映射
// PrintSource。样式与显示链取 @infinitable/sheet 公开的显示链纯投影
// （sheetStyleToEngineStyle / formatByNumFmt / 缺省行列尺寸），与屏上渲染同一份
// 换算——打印页所见即画布所得。
import {
  SHEET_DEFAULT_COL_WIDTH,
  SHEET_DEFAULT_ROW_HEIGHT,
  Sheet,
  formatByNumFmt,
  sheetStyleToEngineStyle,
  type SheetSnapshot,
} from '@infinitable/sheet'
import {
  createPrintPlugin,
  type PrintConfig,
  type PrintPluginHandle,
  type PrintPluginOptions,
  type PrintSource,
} from '@infinitable/plugins'

import type { SourceRow } from '../transform/reshape'
import { reshapeDatasetData } from './binding'
import type { FormDoc } from './form-doc'
import { FORM_BINDING_META_NAMESPACE, type FormCellBinding, type RegionSource } from './template'
import { datasetShapeKey, renderDataState, type DatasetShapes } from './data-state'

/** 收集文档内全部格绑定（快照 sidecar 扫描；顺序即快照行序，重复格只取一次） */
export function collectPrintBindings(doc: FormDoc): FormCellBinding[] {
  const items = doc.sheet.snapshot().meta ?? []
  const seen = new Set<string>()
  const bindings: FormCellBinding[] = []
  for (const item of items) {
    if (item.namespace !== FORM_BINDING_META_NAMESPACE) continue
    const key = `${item.row}|${item.col}`
    if (seen.has(key)) continue
    seen.add(key)
    bindings.push(structuredClone(item.payload as FormCellBinding))
  }
  return bindings
}

/**
 * 收集文档内全部区域数据源（只取真正在展开的区域——份数由它的 source 驱动）。
 * 展开份数由区域 source 驱动，与区域内绑定无关——打印取数必须把它们也算进去，
 * 否则区域驱动的数据集根本不会被请求。
 */
export function collectRegionSources(doc: FormDoc): RegionSource[] {
  const sources: RegionSource[] = []
  for (const region of doc.regions) {
    if (region.expand !== 'none' && region.source) sources.push(structuredClone(region.source))
  }
  return sources
}

/** 一份「取哪个数据集的哪种形态」的需求描述：区域 source 与单元格绑定共用的窄口径 */
interface ShapeDemand {
  datasetId: string
  expression?: string
}

/**
 * 形态需求并集：区域 source ∪ 单元格绑定 → 按（datasetId, expression）去重。
 * 相对绑定（展开区内，形状只有 `{ path }`）没有 datasetId，在这里跳过——它们的形态
 * 由区域 source 那条需求提供。
 */
function shapeDemands(
  bindings: readonly FormCellBinding[],
  regionSources: readonly RegionSource[],
): ShapeDemand[] {
  const demands: ShapeDemand[] = []
  const seen = new Set<string>()
  for (const demand of [...regionSources, ...bindings]) {
    const datasetId = demand.datasetId
    if (!datasetId) continue
    const key = datasetShapeKey(datasetId, demand.expression)
    if (seen.has(key)) continue
    seen.add(key)
    demands.push({ datasetId, expression: demand.expression })
  }
  return demands
}

/**
 * 形态需求 → 数据集形态表：按（datasetId, expression）对去重逐对重塑。
 * 同一数据集多表达式并存时各消费者各用各的形态（datasetShapeKey 口径）；表达式
 * 非法抛 TransformError（P7），由调用方呈现。既无区域 source 也无绑定引用的数据集
 * 不出现在结果里。
 */
function buildPrintShapes(
  bindings: readonly FormCellBinding[],
  rowsByDataset: ReadonlyMap<string, SourceRow[]>,
  regionSources: readonly RegionSource[],
): DatasetShapes {
  const shapes: DatasetShapes = new Map()
  for (const demand of shapeDemands(bindings, regionSources)) {
    const rows = rowsByDataset.get(demand.datasetId)
    if (!rows) continue
    shapes.set(
      datasetShapeKey(demand.datasetId, demand.expression),
      reshapeDatasetData(demand.expression, rows),
    )
  }
  return shapes
}

/**
 * 数据态快照 → PrintSource：快照还原进只读 Sheet 模型后逐项映射——
 * 行列数/行高列宽（未自定义回落内置缺省，与屏上同口径）、合并区（模型区间 →
 * 打印内核的扁平区间形状）、cellValue（存储原始值）、cellStyle（有效样式投影，
 * 含列/行/格三层叠加与合并锚点解析）、displayValue（numFmt 显示链，公式格取
 * 计算缓存）。
 */
function createSnapshotPrintSource(snapshot: SheetSnapshot, name: string): PrintSource {
  const sheet = new Sheet('print-data')
  sheet.restore(snapshot)
  const addr = (col: number, row: number) => ({ row, col })
  return {
    name,
    get rowCount(): number {
      return sheet.rows
    },
    get colCount(): number {
      return sheet.cols
    },
    rowHeight: (row) =>
      sheet.getRowHeight(row) ?? sheet.defaultRowHeight ?? SHEET_DEFAULT_ROW_HEIGHT,
    colWidth: (col) => sheet.getColWidth(col) ?? sheet.defaultColWidth ?? SHEET_DEFAULT_COL_WIDTH,
    merges: () =>
      sheet.merges.getMerges().map((range) => ({
        startRow: range.start.row,
        startCol: range.start.col,
        endRow: range.end.row,
        endCol: range.end.col,
      })),
    cellValue: (col, row) => sheet.getCellData(addr(col, row))?.v,
    cellStyle: (col, row) =>
      sheetStyleToEngineStyle(sheet.getEffectiveStyle(addr(col, row))) ?? undefined,
    displayValue: (col, row) => {
      const at = addr(col, row)
      const data = sheet.getCellData(at)
      if (!data) return undefined
      // 公式格取计算缓存（数据态绑定值已去公式，此处仅覆盖模板遗留公式格）
      const raw = data.f != null ? sheet.getDisplayValue(at) : data.v
      if (typeof raw === 'number') {
        const fmt = sheet.getEffectiveStyle(at)?.numFmt
        if (fmt) return formatByNumFmt(raw, fmt)
      }
      return raw
    },
  }
}

/** 打印会话：一次「取数 → 适配 → 供数」的稳定产物，弹框配置只作为方法入参 */
export interface PrintSession {
  /** print 插件句柄（分页/文档构建/打印输出公共入口；source 已绑定） */
  plugin: PrintPluginHandle
  /** 预览文档 HTML：与打印输出同一构建入口（print 输出内部装载同一产物） */
  previewHtml(config: PrintConfig): string
  /** 打印输出（隐藏 iframe 装载文档后调起打印） */
  print(config: PrintConfig): Promise<void>
}

/**
 * 建立打印会话：PrintSource 绑定进 print 插件句柄；预览与打印是同一句柄上的
 * 两个方法（buildDocumentHtml / print），同 source 同 config 同产物——一致性由
 * 结构保证，app 内测试另作断言锁死。hooks 仅测试注入桩用（PrintPluginOptions 口径）。
 */
function createPrintSession(
  source: PrintSource,
  hooks?: PrintPluginOptions['hooks'],
): PrintSession {
  const plugin = createPrintPlugin({ source, hooks })
  return {
    plugin,
    previewHtml: (config) => plugin.buildDocumentHtml(config),
    print: (config) => plugin.print(config),
  }
}

/**
 * 打印取数编排（纯函数，不发请求）：文档 + 各数据集原始行 → 数据态快照适配的
 * 打印会话。原始行由调用方（打印弹框）经 REST 执行获取；测试直接喂行数组。
 */
export function preparePrintSession(
  doc: FormDoc,
  rowsByDataset: ReadonlyMap<string, SourceRow[]>,
  name: string,
  hooks?: PrintPluginOptions['hooks'],
): PrintSession {
  const shapes = buildPrintShapes(
    collectPrintBindings(doc),
    rowsByDataset,
    collectRegionSources(doc),
  )
  const source = createSnapshotPrintSource(renderDataState(doc, shapes), name)
  return createPrintSession(source, hooks)
}
