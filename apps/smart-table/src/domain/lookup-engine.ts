// 傻瓜式 VLOOKUP 跨表关联引擎：支持多条件索引匹配、重名冲突检测、消歧锁定与一对多聚合

import type { TableBundle } from '../shared/api-types'
import type {
  LookupConflictInfo,
  LookupMatchRule,
  LookupMode,
  LookupRollupAgg,
  SmartColumn,
  SmartColumnType,
  SmartRecord,
  SmartTableMeta,
} from '../shared/schema'
import { aggregateFiniteNumbers, scalarToText, toFiniteNumber } from './utils'

/** 整表 VLOOKUP 计算结果 */
export interface LookupEvaluationResult {
  /** 填充了 lookup 列计算结果的浅拷贝新记录数组，保留 _id 与 _lookupOverrides */
  records: SmartRecord[]
  /** record._id -> (groupId -> LookupConflictInfo)，仅当 mode === 'one' 且 candidates.length > 1 时登记 */
  conflictsByRow: Map<string, Map<string, LookupConflictInfo>>
  /** 所有记录中 isResolved === false 的冲突组数量（同一行同 groupId 算 1 个未解决冲突） */
  unresolvedConflictCount: number
}

/** 规范化匹配键值：字符串去首尾空白，空值返回 null（不参与匹配） */
function normalizeMatchKey(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  return null
}

/** 从记录按指定字段列表提取联合匹配键；任一字段为空则整条返回 null */
function buildCompositeKey(record: SmartRecord, fields: readonly string[]): string | null {
  if (fields.length === 0) {
    return null
  }
  const parts: string[] = []
  for (const field of fields) {
    const part = normalizeMatchKey(record[field])
    if (part === null) {
      return null
    }
    parts.push(part)
  }
  return JSON.stringify(parts)
}

/** 为目标表构建多字段复合键索引 */
function buildTargetIndex(
  targetRecords: readonly SmartRecord[],
  targetFields: readonly string[],
): Map<string, SmartRecord[]> {
  const index = new Map<string, SmartRecord[]>()
  if (targetFields.length === 0) {
    return index
  }
  for (const targetRecord of targetRecords) {
    const key = buildCompositeKey(targetRecord, targetFields)
    if (key === null) {
      continue
    }
    const bucket = index.get(key)
    if (bucket) {
      bucket.push(targetRecord)
    } else {
      index.set(key, [targetRecord])
    }
  }
  return index
}

/** 查找单行记录在索引中的候选命中行 */
function findCandidates(
  sourceRecord: SmartRecord,
  matchRules: readonly LookupMatchRule[],
  targetIndex: ReadonlyMap<string, SmartRecord[]>,
): readonly SmartRecord[] {
  if (matchRules.length === 0) {
    return []
  }
  const sourceFields = matchRules.map((rule) => rule.sourceField)
  const key = buildCompositeKey(sourceRecord, sourceFields)
  if (key === null) {
    return []
  }
  return targetIndex.get(key) ?? []
}

/** 按一对多 Rollup 规则对候选行聚合目标字段 */
function evaluateRollup(
  candidates: readonly SmartRecord[],
  targetReturnField: string,
  rollupAgg: LookupRollupAgg,
): unknown {
  if (rollupAgg === 'count') {
    return candidates.length
  }

  if (rollupAgg === 'join') {
    const seen = new Set<string>()
    for (const candidate of candidates) {
      const raw = candidate[targetReturnField]
      if (raw === null || raw === undefined) {
        continue
      }
      const text = scalarToText(raw).trim()
      if (text !== '') {
        seen.add(text)
      }
    }
    return [...seen].join(', ')
  }

  const numbers: number[] = []
  for (const candidate of candidates) {
    const num = toFiniteNumber(candidate[targetReturnField])
    if (num !== null) {
      numbers.push(num)
    }
  }
  return aggregateFiniteNumbers(numbers, rollupAgg)
}

/**
 * 批量计算整张表的所有 `type === 'lookup'` 列，并收集一对一重名冲突状态。
 */
export function evaluateTableLookups(
  meta: SmartTableMeta,
  records: readonly SmartRecord[],
  tablesById: ReadonlyMap<string, TableBundle>,
): LookupEvaluationResult {
  const nextRecords: SmartRecord[] = records.map((record) =>
    record._lookupOverrides
      ? { ...record, _lookupOverrides: { ...record._lookupOverrides } }
      : { ...record },
  )
  const conflictsByRow = new Map<string, Map<string, LookupConflictInfo>>()

  const lookupColumns = meta.columns.filter(
    (col): col is SmartColumn & { lookupConfig: NonNullable<SmartColumn['lookupConfig']> } =>
      col.type === 'lookup' && col.lookupConfig !== undefined,
  )

  if (lookupColumns.length === 0) {
    return { records: nextRecords, conflictsByRow, unresolvedConflictCount: 0 }
  }

  // 按 targetTableId + targetFields 缓存索引，避免同组多列或同表规则重复扫描目标表
  const indexCache = new Map<string, Map<string, SmartRecord[]>>()

  const getOrBuildIndex = (
    targetTableId: string,
    matchRules: readonly LookupMatchRule[],
  ): Map<string, SmartRecord[]> => {
    const targetFields = matchRules.map((rule) => rule.targetField)
    const cacheKey = JSON.stringify([targetTableId, targetFields])
    const cached = indexCache.get(cacheKey)
    if (cached) {
      return cached
    }
    const targetBundle = tablesById.get(targetTableId)
    const index = targetBundle
      ? buildTargetIndex(targetBundle.records, targetFields)
      : new Map<string, SmartRecord[]>()
    indexCache.set(cacheKey, index)
    return index
  }

  for (const col of lookupColumns) {
    const config = col.lookupConfig
    const targetIndex = getOrBuildIndex(config.targetTableId, config.matchRules)

    for (const record of nextRecords) {
      const candidates = findCandidates(record, config.matchRules, targetIndex)

      if (config.mode === 'rollup') {
        const agg = config.rollupAgg ?? 'sum'
        record[col.key] = evaluateRollup(candidates, config.targetReturnField, agg)
        continue
      }

      // mode === 'one'
      if (candidates.length === 0) {
        record[col.key] = null
        continue
      }

      if (candidates.length === 1) {
        const val = candidates[0]![config.targetReturnField]
        record[col.key] = val === undefined ? null : val
        continue
      }

      // candidates.length > 1：检查或登记同一行同 groupId 的冲突消歧信息
      let rowConflicts = conflictsByRow.get(record._id)
      let conflictInfo = rowConflicts?.get(config.groupId)

      if (!conflictInfo) {
        const overrideId = record._lookupOverrides?.[config.groupId]
        const matchedOverride =
          overrideId !== undefined ? candidates.find((c) => c._id === overrideId) : undefined

        conflictInfo = {
          groupId: config.groupId,
          targetTableId: config.targetTableId,
          candidates,
          isResolved: matchedOverride !== undefined,
          selectedRecordId: matchedOverride ? matchedOverride._id : candidates[0]!._id,
        }

        if (!rowConflicts) {
          rowConflicts = new Map<string, LookupConflictInfo>()
          conflictsByRow.set(record._id, rowConflicts)
        }
        rowConflicts.set(config.groupId, conflictInfo)
      }

      const selectedRecord =
        candidates.find((c) => c._id === conflictInfo.selectedRecordId) ?? candidates[0]!
      const val = selectedRecord[config.targetReturnField]
      record[col.key] = val === undefined ? null : val
    }
  }

  let unresolvedConflictCount = 0
  for (const rowConflicts of conflictsByRow.values()) {
    for (const info of rowConflicts.values()) {
      if (!info.isResolved) {
        unresolvedConflictCount += 1
      }
    }
  }

  return {
    records: nextRecords,
    conflictsByRow,
    unresolvedConflictCount,
  }
}

/**
 * 向导批量生成共享同一 `groupId` 的 VLOOKUP 列定义。
 */
export function createLookupColumnsFromWizard(params: {
  groupId?: string
  targetTableId: string
  matchRules: LookupMatchRule[]
  mode: LookupMode
  returnFields: readonly {
    field: string
    title: string
    type?: SmartColumnType
    numberFormat?: SmartColumn['numberFormat']
    rollupAgg?: LookupRollupAgg
    width?: number
  }[]
}): SmartColumn[] {
  const groupId = params.groupId ?? `grp_${crypto.randomUUID().slice(0, 8)}`
  const clonedRules = params.matchRules.map((rule) => ({ ...rule }))

  return params.returnFields.map((item, idx) => {
    const col: SmartColumn = {
      key: `lookup_${groupId}_${item.field}_${idx}`,
      title: item.title,
      type: 'lookup',
      width: item.width ?? 140,
      lookupConfig: {
        groupId,
        targetTableId: params.targetTableId,
        matchRules: clonedRules.map((rule) => ({ ...rule })),
        targetReturnField: item.field,
        mode: params.mode,
        ...(params.mode === 'rollup' ? { rollupAgg: item.rollupAgg ?? 'sum' } : {}),
      },
    }
    if (item.numberFormat !== undefined) {
      col.numberFormat = item.numberFormat
    }
    return col
  })
}

/**
 * 为同 `groupId` 的所有 lookup 列追加联合匹配条件（已存在相同 sourceField + targetField 时跳过）。
 */
export function appendMatchRuleToLookupGroup(
  columns: readonly SmartColumn[],
  groupId: string,
  rule: LookupMatchRule,
): SmartColumn[] {
  return columns.map((col) => {
    if (col.type !== 'lookup' || !col.lookupConfig || col.lookupConfig.groupId !== groupId) {
      return col
    }
    const exists = col.lookupConfig.matchRules.some(
      (existing) =>
        existing.sourceField === rule.sourceField && existing.targetField === rule.targetField,
    )
    if (exists) {
      return col
    }
    return {
      ...col,
      lookupConfig: {
        ...col.lookupConfig,
        matchRules: [...col.lookupConfig.matchRules, { ...rule }],
      },
    }
  })
}

/**
 * 向导实时预览匹配统计：统计唯一命中、存在重名冲突、未命中的源表行数。
 */
export function previewLookupStats(
  sourceRecords: readonly SmartRecord[],
  targetRecords: readonly SmartRecord[],
  matchRules: readonly LookupMatchRule[],
): { matchedRows: number; conflictRows: number; unmatchedRows: number } {
  if (matchRules.length === 0) {
    return {
      matchedRows: 0,
      conflictRows: 0,
      unmatchedRows: sourceRecords.length,
    }
  }

  const targetFields = matchRules.map((rule) => rule.targetField)
  const targetIndex = buildTargetIndex(targetRecords, targetFields)

  let matchedRows = 0
  let conflictRows = 0
  let unmatchedRows = 0

  for (const record of sourceRecords) {
    const candidates = findCandidates(record, matchRules, targetIndex)
    if (candidates.length === 0) {
      unmatchedRows += 1
    } else if (candidates.length === 1) {
      matchedRows += 1
    } else {
      conflictRows += 1
    }
  }

  return { matchedRows, conflictRows, unmatchedRows }
}
