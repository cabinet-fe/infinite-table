// 打印供数编排：数据态表单快照 → print 插件 PrintSource（快照 → PrintSource 的逐项
// 映射本体已下沉 @infinitable/sheet 的 createSnapshotPrintSource，本文件只保留取数编排）。
//
// 数据链（预览与打印共用同一条，同输入同输出）：
// 数据块数据源 + 聚合入参 → 收集数据集 id 并集 → 原始行 → 按（数据集 × 重塑表达式）
// 收集形态（reshapeDatasetData 唯一重塑管线）→ runAggregations 产出 agg →
// renderDataState 数据态快照（分组展开 + 函数求值）→ createSnapshotPrintSource 适配
// （结构化兼容 plugins 的 PrintSource，样式与显示链和屏上渲染同一份换算——
// 打印页所见即画布所得）。
import { createSnapshotPrintSource } from '@infinitable/sheet'
import {
  createPrintPlugin,
  type PrintConfig,
  type PrintPluginHandle,
  type PrintPluginOptions,
  type PrintSource,
} from '@infinitable/plugins'

import type { SourceRow } from '../transform/reshape'
import { runAggregations } from '../domain/aggregation'
import { reshapeDatasetData } from './binding'
import type { FormDoc } from '../domain/form-doc'
import type { RegionSource } from '../shared/template-schema'
import { renderDataState, datasetShapeKey, type DatasetShapes } from './data-state'

/**
 * 收集文档内全部数据块的数据源（v4：**任何**带源的数据块都要取数——不展开的数据块带源时
 * 数据块内的绑定取第 1 条；agg 来源不需要数据集行，由聚合阶段覆盖）。
 */
export function collectRegionSources(doc: FormDoc): RegionSource[] {
  // source 只被读取（kind/datasetId/expression/path），按只读约定共享引用
  return doc.regions.filter((region) => region.source).map((region) => region.source!)
}

/** 打印/预览需要执行的数据集 id 并集：数据块 dataset 来源 ∪ 聚合入参 */
export function collectDatasetIds(doc: FormDoc): string[] {
  const ids = new Set<string>()
  for (const source of collectRegionSources(doc)) {
    if (source.kind === 'dataset') ids.add(source.datasetId)
  }
  for (const aggregation of doc.aggregations) {
    for (const param of aggregation.params) ids.add(param.datasetId)
  }
  return [...ids]
}

/**
 * 形态需求 → 数据集形态表：按（datasetId, expression）对去重逐对重塑。
 * 同一数据集多表达式并存时各消费者各用各的形态（datasetShapeKey 口径）；表达式
 * 非法抛 TransformError，由调用方呈现。既无数据块 source 引用的数据集不出现在结果里。
 *
 * 不并入 data-state 的 loopArrayForRegion：本函数是它的**上游**（构建形态表本身，
 * 不做循环数组读取，两条职责不重叠）；且口径为严格版——表达式非法直接抛错（打印
 * 要求快失败，由弹框呈现错误），该行为被 print 测试锁死。编辑器侧消费
 * loopArrayForRegion 时的容错（非法表达式按数据块跳过）属各消费方的 UI 策略，不拉平。
 */
function buildPrintShapes(
  regionSources: readonly RegionSource[],
  rowsByDataset: ReadonlyMap<string, SourceRow[]>,
): DatasetShapes {
  const shapes: DatasetShapes = new Map()
  const seen = new Set<string>()
  for (const source of regionSources) {
    if (source.kind !== 'dataset') continue
    const key = datasetShapeKey(source.datasetId, source.expression)
    if (seen.has(key)) continue
    const rows = rowsByDataset.get(source.datasetId)
    if (!rows) continue
    seen.add(key)
    shapes.set(key, reshapeDatasetData(source.expression, rows))
  }
  return shapes
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
  const regionSources = collectRegionSources(doc)
  const shapes = buildPrintShapes(regionSources, rowsByDataset)
  const agg = runAggregations(doc.aggregations, rowsByDataset)
  const source = createSnapshotPrintSource(renderDataState(doc, { shapes, agg }), name)
  return createPrintSession(source, hooks)
}
