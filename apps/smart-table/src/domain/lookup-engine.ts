// 傻瓜式 VLOOKUP 跨表关联引擎：支持多条件索引匹配、跨表递归求值、拓扑排序、重名冲突检测与一对多聚合

import type { TableBundle } from '../shared/api-types'
import type {
  LookupConfig,
  LookupConflictInfo,
  LookupMatchRule,
  LookupMode,
  LookupRollupAgg,
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
} from '../shared/schema'
import { evaluateFormulaColumns } from './formula-column'
import { aggregateFiniteNumbers, extractLinkText, scalarToText, toFiniteNumber } from './utils'

/** 整表 VLOOKUP 计算结果 */
export interface LookupEvaluationResult {
  /** 填充了 lookup 列计算结果的浅拷贝新记录数组，保留 _id 与 _lookupOverrides */
  records: SmartRecord[]
  /** record._id -> (groupId -> LookupConflictInfo)，仅当 mode === 'one' 且 candidates.length > 1 时登记 */
  conflictsByRow: Map<string, Map<string, LookupConflictInfo>>
  /** 所有记录中 isResolved === false 的冲突组数量（同一行同 groupId 算 1 个未解决冲突） */
  unresolvedConflictCount: number
}

type LookupColumnWithConfig = SmartColumn & {
  lookupConfig: NonNullable<SmartColumn['lookupConfig']>
}

interface LookupEvalContext {
  visitingTables: Set<string>
  evaluatedCache: Map<string, TableBundle>
}

/** 规范化匹配键值：字符串去首尾空白，支持链接对象，空值返回 null（不参与匹配） */
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
  const linkText = extractLinkText(value)
  if (linkText !== null) {
    return linkText === '' ? null : linkText
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

/** 对本表多个 lookup 列按 sourceField 依赖做拓扑排序，同时分离成环列 */
function topoSortLookupColumns(lookupColumns: readonly LookupColumnWithConfig[]): {
  ordered: LookupColumnWithConfig[]
  cyclicKeys: Set<string>
} {
  const byKey = new Map<string, LookupColumnWithConfig>()
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const col of lookupColumns) {
    byKey.set(col.key, col)
    inDegree.set(col.key, 0)
    dependents.set(col.key, [])
  }

  for (const col of lookupColumns) {
    const seenDeps = new Set<string>()
    for (const rule of col.lookupConfig.matchRules) {
      const depKey = rule.sourceField
      if (!byKey.has(depKey) || seenDeps.has(depKey)) {
        continue
      }
      seenDeps.add(depKey)
      inDegree.set(col.key, (inDegree.get(col.key) ?? 0) + 1)
      dependents.get(depKey)!.push(col.key)
    }
  }

  const queue: string[] = []
  for (const col of lookupColumns) {
    if ((inDegree.get(col.key) ?? 0) === 0) {
      queue.push(col.key)
    }
  }

  const ordered: LookupColumnWithConfig[] = []
  while (queue.length > 0) {
    const currKey = queue.shift()!
    ordered.push(byKey.get(currKey)!)
    for (const nextKey of dependents.get(currKey) ?? []) {
      const nextDeg = (inDegree.get(nextKey) ?? 0) - 1
      inDegree.set(nextKey, nextDeg)
      if (nextDeg === 0) {
        queue.push(nextKey)
      }
    }
  }

  const cyclicKeys = new Set<string>()
  for (const col of lookupColumns) {
    if ((inDegree.get(col.key) ?? 0) > 0) {
      cyclicKeys.add(col.key)
    }
  }

  return { ordered, cyclicKeys }
}

function buildGroupRuleSignature(config: LookupConfig): string {
  return JSON.stringify([
    config.targetTableId,
    config.matchRules.map((rule) => [rule.sourceField, rule.targetField]),
  ])
}

function evaluateTableLookupsInternal(
  meta: SmartTableMeta,
  records: readonly SmartRecord[],
  tablesById: ReadonlyMap<string, TableBundle>,
  context: LookupEvalContext,
): LookupEvaluationResult {
  const nextRecords: SmartRecord[] = records.map((record) =>
    record._lookupOverrides
      ? { ...record, _lookupOverrides: { ...record._lookupOverrides } }
      : { ...record },
  )
  const conflictsByRow = new Map<string, Map<string, LookupConflictInfo>>()

  const lookupColumns = meta.columns.filter(
    (col): col is LookupColumnWithConfig => col.type === 'lookup' && col.lookupConfig !== undefined,
  )

  if (lookupColumns.length === 0) {
    return { records: nextRecords, conflictsByRow, unresolvedConflictCount: 0 }
  }

  context.visitingTables.add(meta.id)
  try {
    // 递归求值并缓存目标表（含目标表自身的 lookup 与 formula 列），带循环引用保护
    const resolveTargetRecords = (targetTableId: string): readonly SmartRecord[] => {
      if (context.visitingTables.has(targetTableId)) {
        return tablesById.get(targetTableId)?.records ?? []
      }
      const cached = context.evaluatedCache.get(targetTableId)
      if (cached) {
        return cached.records
      }
      const targetBundle = tablesById.get(targetTableId)
      if (!targetBundle) {
        return []
      }

      const targetLookupRes = evaluateTableLookupsInternal(
        targetBundle.meta,
        targetBundle.records,
        tablesById,
        context,
      )
      const computedTargetRecords = evaluateFormulaColumns(
        targetBundle.meta.columns,
        targetLookupRes.records,
      )
      context.evaluatedCache.set(targetTableId, {
        meta: targetBundle.meta,
        records: computedTargetRecords,
      })
      return computedTargetRecords
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
      const targetRecords = resolveTargetRecords(targetTableId)
      const index = buildTargetIndex(targetRecords, targetFields)
      indexCache.set(cacheKey, index)
      return index
    }

    const { ordered, cyclicKeys } = topoSortLookupColumns(lookupColumns)
    for (const cyclicKey of cyclicKeys) {
      for (const record of nextRecords) {
        record[cyclicKey] = null
      }
    }

    // 校验同 groupId 共享冲突对象时的 targetTableId 与 matchRules 一致性
    const groupPrimarySignature = new Map<string, string>()

    for (const col of ordered) {
      const config = col.lookupConfig
      const targetIndex = getOrBuildIndex(config.targetTableId, config.matchRules)
      const signature = config.mode === 'one' ? buildGroupRuleSignature(config) : ''
      let isGroupRuleConsistent = true
      if (config.mode === 'one') {
        const expected = groupPrimarySignature.get(config.groupId)
        if (expected === undefined) {
          groupPrimarySignature.set(config.groupId, signature)
        } else if (expected !== signature) {
          isGroupRuleConsistent = false
        }
      }

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

        const overrideId = record._lookupOverrides?.[config.groupId]
        const matchedOverride =
          overrideId !== undefined ? candidates.find((c) => c._id === overrideId) : undefined

        // 同 groupId 配置一致时共享同一 LookupConflictInfo；若同 groupId 下配置分裂则独立选值不污染主冲突对象
        if (!isGroupRuleConsistent) {
          const selected = matchedOverride ?? candidates[0]!
          const val = selected[config.targetReturnField]
          record[col.key] = val === undefined ? null : val
          continue
        }

        // candidates.length > 1：检查或登记同一行同 groupId 的冲突消歧信息
        let rowConflicts = conflictsByRow.get(record._id)
        let conflictInfo = rowConflicts?.get(config.groupId)

        if (!conflictInfo) {
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
  } finally {
    context.visitingTables.delete(meta.id)
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
 * 批量计算整张表的所有 `type === 'lookup'` 列（支持跨表递归求值与本表依赖拓扑排序），并收集一对一重名冲突状态。
 */
export function evaluateTableLookups(
  meta: SmartTableMeta,
  records: readonly SmartRecord[],
  tablesById: ReadonlyMap<string, TableBundle>,
): LookupEvaluationResult {
  const context: LookupEvalContext = {
    visitingTables: new Set<string>(),
    evaluatedCache: new Map<string, TableBundle>(),
  }
  return evaluateTableLookupsInternal(meta, records, tablesById, context)
}

/**
 * 向导批量生成共享同一 `groupId` 的 VLOOKUP 列定义。
 */
export function createLookupColumnsFromWizard(params: {
  groupId?: string
  targetTableId: string
  matchRules: LookupMatchRule[]
  mode: LookupMode
  existingKeys?: ReadonlySet<string> | readonly string[]
  returnFields: readonly {
    field: string
    title: string
    numberFormat?: SmartColumn['numberFormat']
    rollupAgg?: LookupRollupAgg
    width?: number
  }[]
}): SmartColumn[] {
  const groupId = params.groupId ?? `grp_${crypto.randomUUID().slice(0, 8)}`
  const clonedRules = params.matchRules.map((rule) => ({ ...rule }))
  const usedKeys = new Set<string>(params.existingKeys ?? [])

  const allocateKey = (field: string, idx: number): string => {
    const base = `lookup_${groupId}_${field}_${idx}`
    if (!usedKeys.has(base)) {
      usedKeys.add(base)
      return base
    }
    let suffix = idx + 1
    while (usedKeys.has(`lookup_${groupId}_${field}_${suffix}`)) {
      suffix += 1
    }
    const candidate = `lookup_${groupId}_${field}_${suffix}`
    usedKeys.add(candidate)
    return candidate
  }

  return params.returnFields.map((item, idx) => {
    const agg = params.mode === 'rollup' ? (item.rollupAgg ?? 'sum') : undefined
    const col: SmartColumn = {
      key: allocateKey(item.field, idx),
      title: item.title,
      type: 'lookup',
      width: item.width ?? 140,
      lookupConfig: {
        groupId,
        targetTableId: params.targetTableId,
        matchRules: clonedRules.map((rule) => ({ ...rule })),
        targetReturnField: item.field,
        mode: params.mode,
        ...(agg !== undefined ? { rollupAgg: agg } : {}),
      },
    }

    if (params.mode === 'rollup') {
      if (agg === 'count') {
        col.numberFormat = 'integer'
      } else if (agg !== 'join' && item.numberFormat !== undefined) {
        col.numberFormat = item.numberFormat
      }
    } else if (item.numberFormat !== undefined) {
      col.numberFormat = item.numberFormat
    }

    return col
  })
}

/**
 * 为同 `groupId` 的所有 lookup 列追加联合匹配条件（已存在相同 sourceField + targetField 时跳过，且保持同组 targetTableId 一致）。
 */
export function appendMatchRuleToLookupGroup(
  columns: readonly SmartColumn[],
  groupId: string,
  rule: LookupMatchRule,
): SmartColumn[] {
  const firstMatch = columns.find(
    (col) => col.type === 'lookup' && col.lookupConfig?.groupId === groupId,
  )
  const expectedTargetTableId = firstMatch?.lookupConfig?.targetTableId

  return columns.map((col) => {
    if (
      col.type !== 'lookup' ||
      !col.lookupConfig ||
      col.lookupConfig.groupId !== groupId ||
      col.lookupConfig.targetTableId !== expectedTargetTableId
    ) {
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
