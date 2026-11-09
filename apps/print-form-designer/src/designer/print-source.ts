// 打印供数适配：数据态表单快照 → print 插件 PrintSource。
//
// 数据链（预览与打印共用同一条，同输入同输出）：
// 数据块数据源 + 聚合入参 → 收集数据集 id 并集 → 原始行 → 按（数据集 × 重塑表达式）
// 收集形态（reshapeDatasetData 唯一重塑管线）→ runAggregations 产出 agg →
// renderDataState 数据态快照（分组展开 + 函数求值）→ 还原进只读 Sheet 模型逐项映射
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
import { runAggregations } from './aggregation'
import { reshapeDatasetData } from './binding'
import type { FormDoc } from './form-doc'
import type { RegionSource } from './template'
import { renderDataState, datasetShapeKey, type DatasetShapes } from './data-state'

/**
 * 收集文档内全部数据块的数据源（v4：**任何**带源的数据块都要取数——不展开的数据块带源时
 * 数据块内的绑定取第 1 条；agg 来源不需要数据集行，由聚合阶段覆盖）。
 */
export function collectRegionSources(doc: FormDoc): RegionSource[] {
  // source 只被读取（kind/datasetId/expression/path），按只读约定共享引用
  return doc.regions
    .filter((region) => region.source)
    .map((region) => region.source!)
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
      // 公式格取计算缓存（数据态绑定/函数值已去公式，此处仅覆盖模板遗留公式格）
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
  const regionSources = collectRegionSources(doc)
  const shapes = buildPrintShapes(regionSources, rowsByDataset)
  const agg = runAggregations(doc.aggregations, rowsByDataset)
  const source = createSnapshotPrintSource(renderDataState(doc, { shapes, agg }), name)
  return createPrintSession(source, hooks)
}
