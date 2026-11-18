// 傻瓜式 VLOOKUP 跨表关联引擎：支持多条件索引匹配、本表拓扑排序、重名冲突检测（SmartApp.lookupOverrides）与一对多聚合；
// 目标数据源与返回字段严格限定为目标数据源表 SmartTableMeta.columns 中的原始字段。

import type { TableBundle } from '../shared/api-types'
import {
  filterRawColumns,
  mergeSmartColumns,
  type LookupConfig,
  type LookupConflictInfo,
  type LookupMatchRule,
  type LookupMode,
  type LookupRollupAgg,
  type SmartColumn,
  type SmartRecord,
  type SmartTableMeta,
} from '../shared/schema'
import { aggregateFiniteNumbers, extractLinkText, scalarToText, toFiniteNumber } from './utils'

/** 整表 VLOOKUP 计算可选上下文 */
export interface EvaluateLookupOptions {
  /** SmartApp 派生列列表（与 meta 原始字段合并求值；不传时兼容读取 meta.columns 中的 lookup 列） */
  derivedColumns?: readonly SmartColumn[]
  /** SmartApp 重名消歧覆盖映射：recordId -> (groupId -> targetRecordId) */
  lookupOverrides?: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** 提取可用于 VLOOKUP 关联/带出的目标数据源表原始字段列（严格剔除 lookup / formula） */
export function getEligibleLookupTargetColumns(columns: readonly SmartColumn[]): SmartColumn[] {
  return filterRawColumns(columns)
}

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
  options?: EvaluateLookupOptions,
): LookupEvaluationResult {
  const nextRecords: SmartRecord[] = records.map((record) =>
    record._lookupOverrides
      ? { ...record, _lookupOverrides: { ...record._lookupOverrides } }
      : { ...record },
  )
  const conflictsByRow = new Map<string, Map<string, LookupConflictInfo>>()

  const effectiveColumns =
    options?.derivedColumns !== undefined
      ? mergeSmartColumns(meta.columns, options.derivedColumns)
      : meta.columns

  const lookupColumns = effectiveColumns.filter(
    (col): col is LookupColumnWithConfig => col.type === 'lookup' && col.lookupConfig !== undefined,
  )

  if (lookupColumns.length === 0) {
    return { records: nextRecords, conflictsByRow, unresolvedConflictCount: 0 }
  }

  // 目标数据源表缓存：仅暴露 SmartTableMeta.columns 中的原始字段（严格排除 lookup / formula）
  const rawTargetFieldSetCache = new Map<string, Set<string>>()
  const getTargetRawFieldSet = (targetTableId: string): Set<string> => {
    const cached = rawTargetFieldSetCache.get(targetTableId)
    if (cached) {
      return cached
    }
    const targetBundle = tablesById.get(targetTableId)
    const fieldSet = targetBundle
      ? new Set(filterRawColumns(targetBundle.meta.columns).map((c) => c.key))
      : new Set<string>()
    rawTargetFieldSetCache.set(targetTableId, fieldSet)
    return fieldSet
  }

  // 按 targetTableId + targetFields 缓存索引，避免同组多列或同表规则重复扫描目标表
  const indexCache = new Map<string, Map<string, SmartRecord[]>>()

  const getOrBuildIndex = (
    targetTableId: string,
    matchRules: readonly LookupMatchRule[],
  ): Map<string, SmartRecord[]> => {
    const targetFields = matchRules.map((rule) => rule.targetField)
    const rawFieldSet = getTargetRawFieldSet(targetTableId)
    if (targetFields.length === 0 || targetFields.some((field) => !rawFieldSet.has(field))) {
      return new Map()
    }
    const cacheKey = JSON.stringify([targetTableId, targetFields])
    const cached = indexCache.get(cacheKey)
    if (cached) {
      return cached
    }
    const targetRecords = tablesById.get(targetTableId)?.records ?? []
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
    const rawTargetFieldSet = getTargetRawFieldSet(config.targetTableId)
    if (!rawTargetFieldSet.has(config.targetReturnField)) {
      for (const record of nextRecords) {
        record[col.key] = null
      }
      continue
    }

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

      const overrideId =
        options?.lookupOverrides !== undefined
          ? options.lookupOverrides[record._id]?.[config.groupId]
          : record._lookupOverrides?.[config.groupId]
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
 * 批量计算整张表或 SmartApp 的所有 `type === 'lookup'` 列（支持本表依赖拓扑排序与 SmartApp 消歧覆盖），并收集一对一重名冲突状态。
 */
export function evaluateTableLookups(
  meta: SmartTableMeta,
  records: readonly SmartRecord[],
  tablesById: ReadonlyMap<string, TableBundle>,
  options?: EvaluateLookupOptions,
): LookupEvaluationResult {
  return evaluateTableLookupsInternal(meta, records, tablesById, options)
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
 * 计算不可作为指定关联组（或新建关联组）匹配条件 `sourceField` 的本表列 key 集合：
 * - 所有公式列（formula 在 lookup 之后求值，匹配阶段尚无值）
 * - 同组 `groupId` 的所有带出列（自引用必成环）
 * - 直接或间接依赖该 `groupId` 的其他关联列（避免多组间成环）
 */
export function getBlockedLookupSourceKeys(
  columns: readonly SmartColumn[],
  groupId?: string,
): Set<string> {
  const blocked = new Set<string>()
  const dependents = new Map<string, string[]>()
  const queue: string[] = []

  for (const col of columns) {
    if (col.type === 'formula') {
      blocked.add(col.key)
      continue
    }
    if (col.type !== 'lookup' || !col.lookupConfig) {
      continue
    }
    if (groupId !== undefined && col.lookupConfig.groupId === groupId) {
      blocked.add(col.key)
      queue.push(col.key)
    }
    for (const rule of col.lookupConfig.matchRules) {
      const list = dependents.get(rule.sourceField)
      if (list) {
        list.push(col.key)
      } else {
        dependents.set(rule.sourceField, [col.key])
      }
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!
    for (const nextKey of dependents.get(curr) ?? []) {
      if (!blocked.has(nextKey)) {
        blocked.add(nextKey)
        queue.push(nextKey)
      }
    }
  }

  return blocked
}

/**
 * 过滤可作为指定关联组（或新建关联组）匹配条件 `sourceField` 的本表列。
 */
export function getEligibleLookupSourceColumns(
  columns: readonly SmartColumn[],
  groupId?: string,
): SmartColumn[] {
  const blocked = getBlockedLookupSourceKeys(columns, groupId)
  return columns.filter((col) => !blocked.has(col.key))
}

/**
 * 为同 `groupId` 的所有 lookup 列追加联合匹配条件（已存在相同 sourceField + targetField 时跳过，且拒绝带出列/公式列/成环列）。
 */
export function appendMatchRuleToLookupGroup(
  columns: readonly SmartColumn[],
  groupId: string,
  rule: LookupMatchRule,
): SmartColumn[] {
  const blocked = getBlockedLookupSourceKeys(columns, groupId)
  if (!rule.sourceField || !rule.targetField || blocked.has(rule.sourceField)) {
    return [...columns]
  }

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
 * 向导实时预览匹配统计：统计唯一命中、存在重名冲突、未命中的源表行数（可选传入 targetColumns 限定仅匹配原始字段）。
 */
export function previewLookupStats(
  sourceRecords: readonly SmartRecord[],
  targetRecords: readonly SmartRecord[],
  matchRules: readonly LookupMatchRule[],
  targetColumns?: readonly SmartColumn[],
): { matchedRows: number; conflictRows: number; unmatchedRows: number } {
  if (matchRules.length === 0) {
    return {
      matchedRows: 0,
      conflictRows: 0,
      unmatchedRows: sourceRecords.length,
    }
  }

  if (targetColumns !== undefined) {
    const rawTargetKeys = new Set(filterRawColumns(targetColumns).map((col) => col.key))
    if (matchRules.some((rule) => !rawTargetKeys.has(rule.targetField))) {
      return {
        matchedRows: 0,
        conflictRows: 0,
        unmatchedRows: sourceRecords.length,
      }
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
