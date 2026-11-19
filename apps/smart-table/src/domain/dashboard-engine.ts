// 仪表盘聚合计算引擎：计算 KPI 指标卡与多图型（单/双维度多系列）图表数据集

import { safeDecimalDiv } from '../shared/number-format'
import type {
  DashboardChartConfig,
  DashboardChartType,
  DashboardConfig,
  DashboardKpiAgg,
  DashboardKpiConfig,
  DashboardKpiIcon,
  SmartColumn,
  SmartPivotAgg,
  SmartRecord,
} from '../shared/schema'
import { computeSummaries, formatSummaryValue } from './query-engine'
import {
  aggregateFiniteNumbers,
  isEmptyCellValue,
  scalarToText,
  sumNumbersSafe,
  toFiniteNumber,
} from './utils'

/** 二级分组多系列图表的最大系列数上限 */
export const MAX_CHART_SERIES = 8

/** 解析后的 KPI 图标类型（不含 'auto'） */
export type ResolvedDashboardKpiIcon = Exclude<DashboardKpiIcon, 'auto'>

/** 单个 KPI 指标卡计算结果 */
export interface DashboardKpiResult {
  id: string
  title: string
  field: string
  agg: DashboardKpiAgg
  value: number | null
  formattedValue: string
  icon: ResolvedDashboardKpiIcon
  prefix?: string
  suffix?: string
  accentColor?: string
  recordCount: number
}

/** 图表单个维度分类项（单系列与兼容输出） */
export interface DashboardChartDatum {
  label: string
  value: number
  count: number
  ratio: number
  color?: string
}

/** 二级分组多系列图表单条系列数据 */
export interface DashboardChartSeries {
  name: string
  values: number[]
  counts: number[]
  totalValue: number
  color?: string
}

/** 单个图表聚合计算结果 */
export interface DashboardChartResult {
  id: string
  title: string
  chartType: DashboardChartType
  dimensionField: string
  measureField: string
  agg: SmartPivotAgg
  data: DashboardChartDatum[]
  categories: string[]
  series?: DashboardChartSeries[]
  seriesField?: string
  stacked?: boolean
  totalValue: number
  totalRecords: number
  donut?: boolean
  span?: 1 | 2
}

/** 仪表盘完整计算结果 */
export interface DashboardComputeResult {
  kpis: DashboardKpiResult[]
  charts: DashboardChartResult[]
}

function resolveDimensionLabel(raw: unknown): string {
  if (isEmptyCellValue(raw)) return '(空)'
  const text = scalarToText(raw).trim()
  return text === '' ? '(空)' : text
}

function buildOptionColorMap(col?: SmartColumn): Map<string, string> {
  const map = new Map<string, string>()
  if (col?.options) {
    for (const opt of col.options) {
      map.set(opt.label, opt.color)
    }
  }
  return map
}

function computeAggregateValue(
  groupRecords: readonly SmartRecord[],
  measureField: string,
  agg: SmartPivotAgg,
): number {
  if (agg === 'count') {
    return groupRecords.length
  }
  const numbers: number[] = []
  for (const rec of groupRecords) {
    const num = toFiniteNumber(rec[measureField])
    if (num !== null) numbers.push(num)
  }
  return aggregateFiniteNumbers(numbers, agg) ?? 0
}

/** 按配置与列元信息解析 KPI 图标（手动指定非 'auto' 优先，否则自动匹配） */
export function resolveKpiIcon(
  kpi: Pick<DashboardKpiConfig, 'agg' | 'numberFormat' | 'icon'>,
  col?: SmartColumn,
): ResolvedDashboardKpiIcon {
  if (kpi.icon && kpi.icon !== 'auto') {
    return kpi.icon
  }
  if (kpi.agg === 'count') {
    return 'hash'
  }
  if (kpi.agg === 'filled_rate') {
    return 'percent'
  }
  const numberFormat = kpi.numberFormat ?? col?.numberFormat
  if (numberFormat === 'currency') {
    return 'dollar'
  }
  if (numberFormat === 'percent' || col?.type === 'progress') {
    return 'percent'
  }
  if (col?.type === 'date') {
    return 'clock'
  }
  switch (kpi.agg) {
    case 'max':
      return 'award'
    case 'avg':
      return 'trending'
    case 'min':
      return 'clock'
    case 'sum':
      return 'layers'
    default:
      return 'hash'
  }
}

/** 计算单个 KPI 指标卡数值与格式化显示 */
export function computeDashboardKpi(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  kpi: DashboardKpiConfig,
): DashboardKpiResult {
  const col = columns.find((c) => c.key === kpi.field)
  let value: number | null = null

  if (kpi.agg === 'count' && (!kpi.field || kpi.field === '__count__')) {
    value = records.length
  } else {
    const fieldKey = kpi.field
    const summaryRes = computeSummaries(records, columns, { [fieldKey]: kpi.agg })
    value = summaryRes[fieldKey]?.value ?? null
  }

  const numberFormat = kpi.numberFormat ?? col?.numberFormat
  const decimalPlaces = kpi.decimalPlaces ?? col?.decimalPlaces
  const baseText = formatSummaryValue(value, kpi.agg, numberFormat, decimalPlaces)
  const formattedValue =
    value !== null ? `${kpi.prefix ?? ''}${baseText}${kpi.suffix ?? ''}` : baseText

  return {
    id: kpi.id,
    title: kpi.title,
    field: kpi.field,
    agg: kpi.agg,
    value,
    formattedValue,
    icon: resolveKpiIcon(kpi, col),
    ...(kpi.prefix !== undefined ? { prefix: kpi.prefix } : {}),
    ...(kpi.suffix !== undefined ? { suffix: kpi.suffix } : {}),
    ...(kpi.accentColor !== undefined ? { accentColor: kpi.accentColor } : {}),
    recordCount: records.length,
  }
}

function buildMultiSeries(
  categories: readonly string[],
  cellGroups: ReadonlyMap<string, ReadonlyMap<string, SmartRecord[]>>,
  chart: DashboardChartConfig,
  seriesCol?: SmartColumn,
): DashboardChartSeries[] {
  const seriesNames = new Set<string>()
  for (const cat of categories) {
    const serMap = cellGroups.get(cat)
    if (!serMap) continue
    for (const name of serMap.keys()) {
      seriesNames.add(name)
    }
  }

  const seriesColorMap = buildOptionColorMap(seriesCol)
  const allSeries: DashboardChartSeries[] = []

  for (const name of seriesNames) {
    const values: number[] = []
    const counts: number[] = []
    for (const cat of categories) {
      const bucket = cellGroups.get(cat)?.get(name)
      if (bucket && bucket.length > 0) {
        values.push(computeAggregateValue(bucket, chart.measureField, chart.agg))
        counts.push(bucket.length)
      } else {
        values.push(0)
        counts.push(0)
      }
    }
    const color = seriesColorMap.get(name)
    allSeries.push({
      name,
      values,
      counts,
      totalValue: sumNumbersSafe(values),
      ...(color !== undefined ? { color } : {}),
    })
  }

  allSeries.sort((a, b) => {
    if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue
    return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  })

  return allSeries.slice(0, MAX_CHART_SERIES)
}

/** 计算单个图表（单/双维度分组聚合）数据 */
export function computeDashboardChart(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  chart: DashboardChartConfig,
): DashboardChartResult {
  const dimensionCol = columns.find((c) => c.key === chart.dimensionField)
  const optionColorMap = buildOptionColorMap(dimensionCol)

  const rawSeriesField = chart.seriesField?.trim()
  const isPie = chart.chartType === 'pie'
  const effectiveSeriesField = !isPie && rawSeriesField ? rawSeriesField : undefined
  const supportsStacked = chart.chartType === 'bar' || chart.chartType === 'horizontalBar'

  const groups = new Map<string, SmartRecord[]>()
  const cellGroups = effectiveSeriesField
    ? new Map<string, Map<string, SmartRecord[]>>()
    : undefined

  for (const record of records) {
    const label = resolveDimensionLabel(record[chart.dimensionField])
    const bucket = groups.get(label)
    if (bucket) {
      bucket.push(record)
    } else {
      groups.set(label, [record])
    }

    if (effectiveSeriesField && cellGroups) {
      const serLabel = resolveDimensionLabel(record[effectiveSeriesField])
      let serMap = cellGroups.get(label)
      if (!serMap) {
        serMap = new Map<string, SmartRecord[]>()
        cellGroups.set(label, serMap)
      }
      const cellBucket = serMap.get(serLabel)
      if (cellBucket) {
        cellBucket.push(record)
      } else {
        serMap.set(serLabel, [record])
      }
    }
  }

  const rawItems: Array<{ label: string; value: number; count: number; color?: string }> = []
  for (const [label, groupRecords] of groups.entries()) {
    const value = computeAggregateValue(groupRecords, chart.measureField, chart.agg)
    const color = optionColorMap.get(label)
    rawItems.push({
      label,
      value,
      count: groupRecords.length,
      ...(color !== undefined ? { color } : {}),
    })
  }

  const sortBy =
    chart.sortBy ??
    (chart.chartType === 'line' || chart.chartType === 'area' ? 'label_asc' : 'value_desc')
  rawItems.sort((a, b) => {
    if (sortBy === 'label_asc') {
      return a.label.localeCompare(b.label, 'zh-CN', { numeric: true })
    }
    if (sortBy === 'value_asc') {
      if (a.value !== b.value) return a.value - b.value
      return a.label.localeCompare(b.label, 'zh-CN', { numeric: true })
    }
    if (b.value !== a.value) return b.value - a.value
    return a.label.localeCompare(b.label, 'zh-CN', { numeric: true })
  })

  const sliced =
    typeof chart.limit === 'number' && chart.limit > 0
      ? rawItems.slice(0, Math.floor(chart.limit))
      : rawItems

  const positiveValues = sliced.filter((item) => item.value > 0).map((item) => item.value)
  const positiveSum = sumNumbersSafe(positiveValues)
  const totalValue = sumNumbersSafe(sliced.map((item) => item.value))

  const data: DashboardChartDatum[] = sliced.map((item) => ({
    ...item,
    ratio: positiveSum > 0 && item.value > 0 ? safeDecimalDiv(item.value, positiveSum) : 0,
  }))
  const categories = data.map((item) => item.label)

  const seriesCol = effectiveSeriesField
    ? columns.find((c) => c.key === effectiveSeriesField)
    : undefined
  const series =
    effectiveSeriesField && cellGroups
      ? buildMultiSeries(categories, cellGroups, chart, seriesCol)
      : undefined

  return {
    id: chart.id,
    title: chart.title,
    chartType: chart.chartType,
    dimensionField: chart.dimensionField,
    measureField: chart.measureField,
    agg: chart.agg,
    data,
    categories,
    ...(series !== undefined ? { series } : {}),
    ...(effectiveSeriesField !== undefined ? { seriesField: effectiveSeriesField } : {}),
    ...(supportsStacked && chart.stacked !== undefined ? { stacked: chart.stacked } : {}),
    totalValue,
    totalRecords: records.length,
    ...(chart.donut !== undefined ? { donut: chart.donut } : {}),
    ...(chart.span !== undefined ? { span: chart.span } : {}),
  }
}

/** 批量计算仪表盘所有 KPI 指标卡与图表数据 */
export function computeDashboard(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  config: DashboardConfig,
): DashboardComputeResult {
  return {
    kpis: config.kpis.map((kpi) => computeDashboardKpi(records, columns, kpi)),
    charts: config.charts.map((chart) => computeDashboardChart(records, columns, chart)),
  }
}
