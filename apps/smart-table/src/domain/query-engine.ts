// 数据查询与计算管线引擎：串联 VLOOKUP → 公式列 → 过滤（快捷胶囊 + 高级条件组）→ 多级排序 → 底部汇总

import type { TableBundle } from '../shared/api-types'
import type {
  FilterCondition,
  FilterGroup,
  LookupConflictInfo,
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
  SmartView,
  SortRule,
  SummaryType,
} from '../shared/schema'
import { evaluateFormulaColumns } from './formula-column'
import { evaluateTableLookups } from './lookup-engine'
import { aggregateFiniteNumbers, isEmptyCellValue, scalarToText, toFiniteNumber } from './utils'

/** 单列底部统计汇总结果 */
export interface SummaryCellResult {
  type: SummaryType
  value: number | null
  text: string
}

/** 智能表格完整计算管线输出 */
export interface SmartPipelineResult {
  /** 经 VLOOKUP 与公式列求值后的全量记录（过滤排序前） */
  allComputedRecords: SmartRecord[]
  /** 经当前视图过滤与排序后的展示记录 */
  displayRecords: SmartRecord[]
  /** 行级 VLOOKUP 重名冲突映射 */
  conflictsByRow: Map<string, Map<string, LookupConflictInfo>>
  /** 未消歧冲突组总数 */
  unresolvedConflictCount: number
  /** 基于 displayRecords 计算的底部汇总结果 */
  summaries: Record<string, SummaryCellResult>
}

function toBooleanOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
  }
  return null
}

function toDateTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isFinite(ts) ? ts : null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  // 严格校验 YYYY-MM-DD / YYYY/MM/DD 避免如 2025-02-30 自动进位
  const dateOnlyMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed)
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1])
    const month = Number(dateOnlyMatch[2])
    const day = Number(dateOnlyMatch[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null
    }
    const utcDate = new Date(Date.UTC(year, month - 1, day))
    if (
      utcDate.getUTCFullYear() !== year ||
      utcDate.getUTCMonth() !== month - 1 ||
      utcDate.getUTCDate() !== day
    ) {
      return null
    }
    return utcDate.getTime()
  }

  // 仅当包含完整日期结构时才允许 Date.parse，避免纯文本如 "12" 被误解析
  if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/.test(trimmed)) {
    return null
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function valuesEqual(raw: unknown, target: unknown, col?: SmartColumn): boolean {
  if (col?.type === 'checkbox') {
    const b1 = isEmptyCellValue(raw) ? false : toBooleanOrNull(raw)
    const b2 = isEmptyCellValue(target) ? false : toBooleanOrNull(target)
    if (b1 !== null && b2 !== null) {
      return b1 === b2
    }
  }

  const rawEmpty = isEmptyCellValue(raw)
  const targetEmpty = isEmptyCellValue(target)
  if (rawEmpty && targetEmpty) {
    return true
  }
  if (rawEmpty || targetEmpty) {
    return false
  }

  if (typeof raw === 'boolean' || typeof target === 'boolean') {
    const b1 = toBooleanOrNull(raw)
    const b2 = toBooleanOrNull(target)
    if (b1 !== null && b2 !== null) {
      return b1 === b2
    }
  }

  if (
    col?.type === 'number' ||
    col?.type === 'progress' ||
    col?.numberFormat !== undefined ||
    typeof raw === 'number' ||
    typeof target === 'number'
  ) {
    const n1 = toFiniteNumber(raw)
    const n2 = toFiniteNumber(target)
    if (n1 !== null && n2 !== null) {
      return n1 === n2
    }
  }

  return scalarToText(raw).trim() === scalarToText(target).trim()
}

function compareForFilter(raw: unknown, target: unknown, col?: SmartColumn): number | null {
  if (isEmptyCellValue(raw) || isEmptyCellValue(target)) {
    return null
  }
  if (col?.type === 'date') {
    const d1 = toDateTimestamp(raw)
    const d2 = toDateTimestamp(target)
    return d1 !== null && d2 !== null ? d1 - d2 : null
  }
  if (col?.type === 'number' || col?.type === 'progress' || col?.numberFormat !== undefined) {
    const n1 = toFiniteNumber(raw)
    const n2 = toFiniteNumber(target)
    return n1 !== null && n2 !== null ? n1 - n2 : null
  }

  const n1 = toFiniteNumber(raw)
  const n2 = toFiniteNumber(target)
  if (n1 !== null && n2 !== null) {
    return n1 - n2
  }
  return scalarToText(raw).localeCompare(scalarToText(target), 'zh-CN', { numeric: true })
}

function matchCondition(
  record: SmartRecord,
  condition: FilterCondition,
  colMap: ReadonlyMap<string, SmartColumn>,
): boolean {
  const raw = record[condition.field]
  const target = condition.value
  const col = colMap.get(condition.field)

  switch (condition.operator) {
    case 'is_empty':
      return isEmptyCellValue(raw)
    case 'is_not_empty':
      return !isEmptyCellValue(raw)
    case 'eq':
      return valuesEqual(raw, target, col)
    case 'neq':
      return !valuesEqual(raw, target, col)
    case 'contains': {
      if (isEmptyCellValue(target)) {
        return true
      }
      if (isEmptyCellValue(raw)) {
        return false
      }
      return scalarToText(raw).toLowerCase().includes(scalarToText(target).toLowerCase())
    }
    case 'not_contains': {
      if (isEmptyCellValue(target) || isEmptyCellValue(raw)) {
        return true
      }
      return !scalarToText(raw).toLowerCase().includes(scalarToText(target).toLowerCase())
    }
    case 'gt': {
      const cmp = compareForFilter(raw, target, col)
      return cmp !== null && cmp > 0
    }
    case 'gte': {
      const cmp = compareForFilter(raw, target, col)
      return cmp !== null && cmp >= 0
    }
    case 'lt': {
      const cmp = compareForFilter(raw, target, col)
      return cmp !== null && cmp < 0
    }
    case 'lte': {
      const cmp = compareForFilter(raw, target, col)
      return cmp !== null && cmp <= 0
    }
    case 'in': {
      if (Array.isArray(target)) {
        if (target.length === 0) {
          return false
        }
        return target.some((item) => valuesEqual(raw, item, col))
      }
      if (typeof target === 'string') {
        const items = target
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item !== '')
        if (items.length === 0) {
          return false
        }
        return items.some((item) => valuesEqual(raw, item, col))
      }
      return valuesEqual(raw, target, col)
    }
  }
}

/**
 * 按快捷筛选胶囊与高级条件组过滤记录数组（返回新数组，不修改原数组）。
 */
export function filterRecords(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  filterGroup: FilterGroup,
  quickFilterValues?: Record<string, string[]>,
): SmartRecord[] {
  const colMap = new Map<string, SmartColumn>()
  for (const col of columns) {
    colMap.set(col.key, col)
  }

  const activeQuickFilters: Array<[string, Set<string>]> = []
  if (quickFilterValues) {
    for (const [field, values] of Object.entries(quickFilterValues)) {
      if (values.length > 0) {
        activeQuickFilters.push([field, new Set(values)])
      }
    }
  }

  const hasConditions = filterGroup.conditions.length > 0
  if (activeQuickFilters.length === 0 && !hasConditions) {
    return [...records]
  }

  return records.filter((record) => {
    for (const [field, allowed] of activeQuickFilters) {
      const raw = record[field]
      const trimmed = scalarToText(raw).trim()
      const token = isEmptyCellValue(raw) || trimmed === '' ? '(空)' : trimmed
      if (!allowed.has(token)) {
        return false
      }
    }

    if (!hasConditions) {
      return true
    }

    if (filterGroup.conjunction === 'or') {
      return filterGroup.conditions.some((cond) => matchCondition(record, cond, colMap))
    }
    return filterGroup.conditions.every((cond) => matchCondition(record, cond, colMap))
  })
}

/**
 * 多级排序：空值统一置底，数字列与数值字段按数值比较，其余按中文自然序比较。
 */
export function sortRecords(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  sortRules: readonly SortRule[],
): SmartRecord[] {
  if (sortRules.length === 0) {
    return [...records]
  }

  const colMap = new Map<string, SmartColumn>()
  for (const col of columns) {
    colMap.set(col.key, col)
  }

  const sorted = [...records]
  sorted.sort((a, b) => {
    for (const rule of sortRules) {
      const aVal = a[rule.field]
      const bVal = b[rule.field]
      const aEmpty = isEmptyCellValue(aVal)
      const bEmpty = isEmptyCellValue(bVal)

      if (aEmpty && bEmpty) {
        continue
      }
      // 空值统一置底，不受升序/降序反转影响
      if (aEmpty) {
        return 1
      }
      if (bEmpty) {
        return -1
      }

      const col = colMap.get(rule.field)
      const preferNumeric =
        col?.type === 'number' ||
        col?.type === 'progress' ||
        col?.numberFormat !== undefined ||
        (typeof aVal === 'number' && typeof bVal === 'number')

      let cmp = 0
      if (preferNumeric) {
        const numA = toFiniteNumber(aVal)
        const numB = toFiniteNumber(bVal)
        if (numA !== null && numB !== null) {
          cmp = numA - numB
        } else if (numA === null && numB !== null) {
          cmp = 1
        } else if (numA !== null && numB === null) {
          cmp = -1
        } else {
          cmp = scalarToText(aVal).localeCompare(scalarToText(bVal), 'zh-CN', { numeric: true })
        }
      } else {
        cmp = scalarToText(aVal).localeCompare(scalarToText(bVal), 'zh-CN', { numeric: true })
      }

      if (cmp !== 0) {
        return rule.direction === 'desc' ? -cmp : cmp
      }
    }
    return 0
  })

  return sorted
}

function formatPercent(ratio: number): string {
  const pct = Math.round(ratio * 1000) / 10
  return `${pct}%`
}

/**
 * 格式化底部汇总指标显示文本（与画布千分位/小数位规格对齐）。
 */
export function formatSummaryValue(
  value: number | null,
  type: SummaryType,
  numberFormat?: SmartColumn['numberFormat'],
): string {
  if (type === 'none') {
    return ''
  }
  if (value === null || !Number.isFinite(value)) {
    return '-'
  }
  if (type === 'filled_rate') {
    return formatPercent(value)
  }
  if (type === 'count') {
    return Math.round(value).toLocaleString('en-US')
  }

  switch (numberFormat) {
    case 'integer':
      return Math.round(value).toLocaleString('en-US')
    case 'currency': {
      const abs = Math.abs(value)
      const formatted = Number.isInteger(abs)
        ? abs.toLocaleString('en-US')
        : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      return value < 0 ? `-¥${formatted}` : `¥${formatted}`
    }
    case 'percent':
      return formatPercent(value)
    case 'decimal':
      return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    default:
      return Number.isInteger(value)
        ? value.toLocaleString('en-US')
        : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
}

/**
 * 计算表格底部统计汇总栏各列统计值及格式化文本。
 */
export function computeSummaries(
  records: readonly SmartRecord[],
  columns: readonly SmartColumn[],
  summaries: Record<string, SummaryType>,
): Record<string, SummaryCellResult> {
  const colMap = new Map<string, SmartColumn>()
  for (const col of columns) {
    colMap.set(col.key, col)
  }

  const result: Record<string, SummaryCellResult> = {}

  for (const [field, summaryType] of Object.entries(summaries)) {
    const col = colMap.get(field)

    if (summaryType === 'none') {
      result[field] = { type: 'none', value: null, text: '' }
      continue
    }

    let value: number | null = null

    if (summaryType === 'count') {
      let count = 0
      for (const record of records) {
        if (!isEmptyCellValue(record[field])) {
          count += 1
        }
      }
      value = count
    } else if (summaryType === 'filled_rate') {
      if (records.length > 0) {
        let filled = 0
        for (const record of records) {
          const raw = record[field]
          if (col?.type === 'checkbox') {
            if (toBooleanOrNull(raw) === true) {
              filled += 1
            }
          } else if (!isEmptyCellValue(raw)) {
            filled += 1
          }
        }
        value = filled / records.length
      }
    } else {
      const numbers: number[] = []
      for (const record of records) {
        const num = toFiniteNumber(record[field])
        if (num !== null) {
          numbers.push(num)
        }
      }
      value = numbers.length === 0 ? null : aggregateFiniteNumbers(numbers, summaryType)
    }

    result[field] = {
      type: summaryType,
      value,
      text: formatSummaryValue(value, summaryType, col?.numberFormat),
    }
  }

  return result
}

/**
 * 串联完整领域计算管线：VLOOKUP 求值 → 公式列求值 → 视图过滤 → 视图排序 → 底部汇总。
 */
export function runSmartTablePipeline(
  meta: SmartTableMeta,
  rawRecords: readonly SmartRecord[],
  tablesById: ReadonlyMap<string, TableBundle>,
  activeView?: SmartView,
): SmartPipelineResult {
  const lookupResult = evaluateTableLookups(meta, rawRecords, tablesById)
  const allComputedRecords = evaluateFormulaColumns(meta.columns, lookupResult.records)

  const filteredRecords = activeView
    ? filterRecords(
        allComputedRecords,
        meta.columns,
        activeView.filterGroup,
        activeView.quickFilterValues,
      )
    : [...allComputedRecords]

  const displayRecords = activeView
    ? sortRecords(filteredRecords, meta.columns, activeView.sortRules)
    : filteredRecords

  const summaries = computeSummaries(displayRecords, meta.columns, meta.summaries)

  return {
    allComputedRecords,
    displayRecords,
    conflictsByRow: lookupResult.conflictsByRow,
    unresolvedConflictCount: lookupResult.unresolvedConflictCount,
    summaries,
  }
}
