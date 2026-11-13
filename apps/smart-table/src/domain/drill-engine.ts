// 透视表双模式「下钻」分析引擎：筛选可用下钻维度并按下一维度逐层拆解聚合

import type {
  SmartColumn,
  SmartColumnType,
  SmartPivotMeasureConfig,
  SmartRecord,
} from '../shared/schema'
import {
  aggregateFiniteNumbers,
  isEmptyCellValue,
  scalarToText,
  sumNumbersSafe,
  toFiniteNumber,
} from './utils'

/** 下一维度拆解单项结果 */
export interface DrillDimensionBreakdownItem {
  value: string
  count: number
  records: SmartRecord[]
  metrics: Record<string, number | null>
  /** 主指标占比 0~1；若主指标总和为 0 或无数值则回退按记录数占比 */
  ratio: number
}

const DRILL_DIMENSION_TYPES: ReadonlySet<SmartColumnType> = new Set([
  'text',
  'select',
  'person',
  'date',
  'checkbox',
  'lookup',
])

/**
 * 列出尚未放入行/列维度且适合作为逐层下钻分组维度的列。
 */
export function getAvailableDrillDimensions(
  columns: readonly SmartColumn[],
  rowDimensions: readonly string[],
  columnDimensions: readonly string[],
): SmartColumn[] {
  const used = new Set<string>([...rowDimensions, ...columnDimensions])
  return columns.filter((col) => !used.has(col.key) && DRILL_DIMENSION_TYPES.has(col.type))
}

function toDimensionLabel(raw: unknown): string {
  if (isEmptyCellValue(raw)) {
    return '(空)'
  }
  const text = scalarToText(raw).trim()
  return text === '' ? '(空)' : text
}

function computeMeasureValue(
  groupRecords: readonly SmartRecord[],
  measure: SmartPivotMeasureConfig,
): number | null {
  if (measure.agg === 'count') {
    return groupRecords.length
  }
  const numbers: number[] = []
  for (const record of groupRecords) {
    const num = toFiniteNumber(record[measure.field])
    if (num !== null) {
      numbers.push(num)
    }
  }
  return aggregateFiniteNumbers(numbers, measure.agg)
}

/**
 * 在当前下钻明细子集上按指定维度分组计算各度量指标、按主指标降序排列并计算占比。
 */
export function computeDimensionBreakdown(
  records: readonly SmartRecord[],
  dimensionKey: string,
  measures: readonly SmartPivotMeasureConfig[],
): DrillDimensionBreakdownItem[] {
  if (records.length === 0) {
    return []
  }

  const groups = new Map<string, SmartRecord[]>()
  for (const record of records) {
    const label = toDimensionLabel(record[dimensionKey])
    const bucket = groups.get(label)
    if (bucket) {
      bucket.push(record)
    } else {
      groups.set(label, [record])
    }
  }

  const items: DrillDimensionBreakdownItem[] = []
  for (const [value, groupRecords] of groups.entries()) {
    const metrics: Record<string, number | null> = {}
    for (const measure of measures) {
      metrics[measure.key] = computeMeasureValue(groupRecords, measure)
    }
    items.push({
      value,
      count: groupRecords.length,
      records: groupRecords,
      metrics,
      ratio: 0,
    })
  }

  const primaryMeasure = measures[0]
  if (primaryMeasure) {
    items.sort((a, b) => {
      const valA = a.metrics[primaryMeasure.key] ?? null
      const valB = b.metrics[primaryMeasure.key] ?? null
      if (valA === null && valB === null) {
        return b.count - a.count
      }
      if (valA === null) {
        return 1
      }
      if (valB === null) {
        return -1
      }
      if (valB !== valA) {
        return valB - valA
      }
      return b.count - a.count
    })

    const positiveValues: number[] = []
    for (const item of items) {
      const val = item.metrics[primaryMeasure.key] ?? null
      if (val !== null && val > 0) {
        positiveValues.push(val)
      }
    }
    const totalPrimary = sumNumbersSafe(positiveValues)

    if (totalPrimary > 0) {
      for (const item of items) {
        const val = item.metrics[primaryMeasure.key] ?? null
        item.ratio = val !== null && val > 0 ? val / totalPrimary : 0
      }
      return items
    }
  } else {
    items.sort((a, b) => b.count - a.count)
  }

  for (const item of items) {
    item.ratio = item.count / records.length
  }
  return items
}
