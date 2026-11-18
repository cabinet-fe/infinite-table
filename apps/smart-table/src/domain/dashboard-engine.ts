// 仪表盘聚合计算引擎：计算 KPI 指标卡与柱状图/折线图/饼图数据集

import type {
  DashboardChartConfig,
  DashboardChartType,
  DashboardConfig,
  DashboardKpiAgg,
  DashboardKpiConfig,
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

/** 单个 KPI 指标卡计算结果 */
export interface DashboardKpiResult {
  id: string
  title: string
  field: string
  agg: DashboardKpiAgg
  value: number | null
  formattedValue: string
  prefix?: string
  suffix?: string
  accentColor?: string
  recordCount: number
}

/** 图表单个维度分类项 */
export interface DashboardChartDatum {
  label: string
  value: number
  count: number
  ratio: number
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
  const baseText = formatSummaryValue(value, kpi.agg, numberFormat)
  const formattedValue =
    value !== null ? `${kpi.prefix ?? ''}${baseText}${kpi.suffix ?? ''}` : baseText

  return {
    id: kpi.id,
    title: kpi.title,
    field: kpi.field,
    agg: kpi.agg,
    value,
    formattedValue,
    ...(kpi.prefix !== undefined ? { prefix: kpi.prefix } : {}),
    ...(kpi.suffix !== undefined ? { suffix: kpi.suffix } : {}),
    ...(kpi.accentColor !== undefined ? { accentColor: kpi.accentColor } : {}),
    recordCount: records.length,
  }
}

/** 计算单个图表（柱状图/折线图/饼图）分组聚合数据 */
export function computeDashboardChart(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  chart: DashboardChartConfig,
): DashboardChartResult {
  const dimensionCol = columns.find((c) => c.key === chart.dimensionField)
  const optionColorMap = new Map<string, string>()
  if (dimensionCol?.options) {
    for (const opt of dimensionCol.options) {
      optionColorMap.set(opt.label, opt.color)
    }
  }

  const groups = new Map<string, SmartRecord[]>()
  for (const record of records) {
    const label = resolveDimensionLabel(record[chart.dimensionField])
    const bucket = groups.get(label)
    if (bucket) {
      bucket.push(record)
    } else {
      groups.set(label, [record])
    }
  }

  const rawItems: Array<{ label: string; value: number; count: number; color?: string }> = []
  for (const [label, groupRecords] of groups.entries()) {
    let value = 0
    if (chart.agg === 'count') {
      value = groupRecords.length
    } else {
      const numbers: number[] = []
      for (const rec of groupRecords) {
        const num = toFiniteNumber(rec[chart.measureField])
        if (num !== null) numbers.push(num)
      }
      value = aggregateFiniteNumbers(numbers, chart.agg) ?? 0
    }
    const color = optionColorMap.get(label)
    rawItems.push({
      label,
      value,
      count: groupRecords.length,
      ...(color !== undefined ? { color } : {}),
    })
  }

  const sortBy = chart.sortBy ?? (chart.chartType === 'line' ? 'label_asc' : 'value_desc')
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
    ratio: positiveSum > 0 && item.value > 0 ? item.value / positiveSum : 0,
  }))

  return {
    id: chart.id,
    title: chart.title,
    chartType: chart.chartType,
    dimensionField: chart.dimensionField,
    measureField: chart.measureField,
    agg: chart.agg,
    data,
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
