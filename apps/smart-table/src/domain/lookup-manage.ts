// 关联管理草稿模型：从既有 lookup 列构建分组草稿，提供编辑操作纯函数、
// dirty/校验判断与一次性保存载荷（LookupManageChanges）的构建与应用。
// LookupManageModal 只负责渲染与调用这些操作，编辑规则单一事实源在本文件。
import type { TableBundle } from '../shared/api-types'
import {
  filterRawColumns,
  type LookupConfig,
  type LookupMatchRule,
  type LookupRollupAgg,
  type SmartColumn,
} from '../shared/schema'
import { createLookupColumnsFromWizard, getBlockedLookupSourceKeys } from './lookup-engine'

/** 既有带出列的编辑草稿（orig* 为落库原值，供 dirty 比对） */
export interface LookupItemDraft {
  key: string
  /** 从目标表带出的字段 key（可切换，保存时写入 targetReturnField） */
  field: string
  origField: string
  /** 目标字段原标题（展示用，随 field 切换更新） */
  targetTitle: string
  title: string
  origTitle: string
  rollupAgg?: LookupRollupAgg
  origRollupAgg?: LookupRollupAgg
  removed: boolean
}

/** 待新增带出列草稿（保存时物化为 SmartColumn） */
export interface LookupStagedDraft {
  field: string
  title: string
  rollupAgg?: LookupRollupAgg
}

/** 一个关联分组（同 groupId）的编辑草稿 */
export interface LookupGroupDraft {
  groupId: string
  targetTableId: string
  mode: LookupConfig['mode']
  matchRules: LookupMatchRule[]
  origMatchRules: LookupMatchRule[]
  items: LookupItemDraft[]
  staged: LookupStagedDraft[]
  deleted: boolean
}

export interface LookupManageDraft {
  groups: LookupGroupDraft[]
}

/** 关联管理保存时的单列编辑项 */
export interface LookupColumnUpdate {
  key: string
  title?: string
  lookupConfig?: LookupConfig
  /** 数值格式调整；null 表示清除（聚合切文本拼接时） */
  numberFormat?: SmartColumn['numberFormat'] | null
  /** 小数位调整；null 表示清除（切 count / join 时） */
  decimalPlaces?: number | null
}

/** 关联管理的一次性保存载荷：删列、改列与追加新带出列 */
export interface LookupManageChanges {
  deletedKeys: readonly string[]
  updates: readonly LookupColumnUpdate[]
  addedColumns: readonly SmartColumn[]
}

/** 从既有 lookup 列构建分组草稿（同 groupId 一组，无 lookupConfig 的列忽略） */
export function createLookupManageDraft(
  columns: readonly SmartColumn[],
  tablesById: ReadonlyMap<string, TableBundle>,
): LookupManageDraft {
  const groups = new Map<string, LookupGroupDraft>()
  for (const col of columns) {
    if (col.type !== 'lookup' || !col.lookupConfig) continue
    const config = col.lookupConfig
    let group = groups.get(config.groupId)
    if (!group) {
      group = {
        groupId: config.groupId,
        targetTableId: config.targetTableId,
        mode: config.mode,
        matchRules: config.matchRules.map((rule) => ({ ...rule })),
        origMatchRules: config.matchRules.map((rule) => ({ ...rule })),
        items: [],
        staged: [],
        deleted: false,
      }
      groups.set(config.groupId, group)
    }
    const targetRawColumns = filterRawColumns(
      tablesById.get(config.targetTableId)?.meta.columns ?? [],
    )
    group.items.push({
      key: col.key,
      field: config.targetReturnField,
      origField: config.targetReturnField,
      targetTitle:
        targetRawColumns.find((c) => c.key === config.targetReturnField)?.title ??
        config.targetReturnField,
      title: col.title,
      origTitle: col.title,
      rollupAgg: config.rollupAgg,
      origRollupAgg: config.rollupAgg,
      removed: false,
    })
  }
  return { groups: [...groups.values()] }
}

/** 命中分组则整体替换（未命中原样返回） */
function mapGroup(
  draft: LookupManageDraft,
  groupId: string,
  fn: (group: LookupGroupDraft) => LookupGroupDraft,
): LookupManageDraft {
  return {
    groups: draft.groups.map((group) => (group.groupId === groupId ? fn(group) : group)),
  }
}

function mapItems(
  draft: LookupManageDraft,
  groupId: string,
  fn: (items: LookupItemDraft[]) => LookupItemDraft[],
): LookupManageDraft {
  return mapGroup(draft, groupId, (group) => ({ ...group, items: fn(group.items) }))
}

export function updateLookupRule(
  draft: LookupManageDraft,
  groupId: string,
  index: number,
  patch: Partial<LookupMatchRule>,
): LookupManageDraft {
  return mapGroup(draft, groupId, (group) => ({
    ...group,
    matchRules: group.matchRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
  }))
}

export function appendLookupRule(
  draft: LookupManageDraft,
  groupId: string,
  rule: LookupMatchRule,
): LookupManageDraft {
  return mapGroup(draft, groupId, (group) => ({
    ...group,
    matchRules: [...group.matchRules, { ...rule }],
  }))
}

export function removeLookupRule(
  draft: LookupManageDraft,
  groupId: string,
  index: number,
): LookupManageDraft {
  return mapGroup(draft, groupId, (group) =>
    group.matchRules.length <= 1
      ? group
      : { ...group, matchRules: group.matchRules.filter((_, i) => i !== index) },
  )
}

export function setLookupItemTitle(
  draft: LookupManageDraft,
  groupId: string,
  itemKey: string,
  title: string,
): LookupManageDraft {
  return mapItems(draft, groupId, (items) =>
    items.map((item) => (item.key === itemKey ? { ...item, title } : item)),
  )
}

/** 切换带出字段（同步展示用 targetTitle） */
export function setLookupItemField(
  draft: LookupManageDraft,
  groupId: string,
  itemKey: string,
  field: string,
  targetTitle: string,
): LookupManageDraft {
  return mapItems(draft, groupId, (items) =>
    items.map((item) => (item.key === itemKey ? { ...item, field, targetTitle } : item)),
  )
}

export function setLookupItemAgg(
  draft: LookupManageDraft,
  groupId: string,
  itemKey: string,
  rollupAgg: LookupRollupAgg,
): LookupManageDraft {
  return mapItems(draft, groupId, (items) =>
    items.map((item) => (item.key === itemKey ? { ...item, rollupAgg } : item)),
  )
}

export function removeLookupItem(
  draft: LookupManageDraft,
  groupId: string,
  itemKey: string,
): LookupManageDraft {
  return mapItems(draft, groupId, (items) =>
    items.map((item) => (item.key === itemKey ? { ...item, removed: true } : item)),
  )
}

export function stageLookupField(
  draft: LookupManageDraft,
  groupId: string,
  staged: LookupStagedDraft,
): LookupManageDraft {
  return mapGroup(draft, groupId, (group) => ({
    ...group,
    staged: [...group.staged, staged],
  }))
}

export function unstageLookupField(
  draft: LookupManageDraft,
  groupId: string,
  field: string,
): LookupManageDraft {
  return mapGroup(draft, groupId, (group) => ({
    ...group,
    staged: group.staged.filter((item) => item.field !== field),
  }))
}

/** 删除整组 = 既有列全部移除 + 丢弃未保存的追加项 */
export function deleteLookupGroup(draft: LookupManageDraft, groupId: string): LookupManageDraft {
  return mapGroup(draft, groupId, (group) => ({
    ...group,
    deleted: true,
    staged: [],
    items: group.items.map((item) => ({ ...item, removed: true })),
  }))
}

/** 是否存在未保存的编辑（与各 orig* 快照比对） */
export function isLookupDraftDirty(draft: LookupManageDraft): boolean {
  return draft.groups.some(
    (group) =>
      group.deleted ||
      group.staged.length > 0 ||
      !rulesEqual(group.matchRules, group.origMatchRules) ||
      group.items.some(
        (item) =>
          item.removed ||
          item.title.trim() !== item.origTitle ||
          item.field !== item.origField ||
          item.rollupAgg !== item.origRollupAgg,
      ),
  )
}

/** 校验失败返回错误消息（供弹窗就地提示），通过返回 null；传 tablesById 时同步校验目标表原始字段边界 */
export function lookupDraftError(
  draft: LookupManageDraft,
  columns?: readonly SmartColumn[],
  tablesById?: ReadonlyMap<string, TableBundle>,
): string | null {
  for (const group of draft.groups) {
    if (group.deleted) continue
    if (group.matchRules.length === 0) return '每组关联至少保留一条匹配条件'
    if (group.matchRules.some((rule) => !rule.sourceField || !rule.targetField)) {
      return '请完善匹配条件字段'
    }
    if (columns) {
      const blocked = getBlockedLookupSourceKeys(columns, group.groupId)
      if (group.matchRules.some((rule) => blocked.has(rule.sourceField))) {
        return '匹配条件不能使用本组带出字段或公式字段'
      }
    }
    if (tablesById) {
      const targetBundle = tablesById.get(group.targetTableId)
      if (!targetBundle) {
        return '关联的目标数据源表不存在'
      }
      const rawTargetKeys = new Set(filterRawColumns(targetBundle.meta.columns).map((c) => c.key))
      if (group.matchRules.some((rule) => !rawTargetKeys.has(rule.targetField))) {
        return '匹配条件只能选择目标数据源表的原始字段'
      }
      const activeItems = group.items.filter((item) => !item.removed)
      if (
        activeItems.some((item) => !rawTargetKeys.has(item.field)) ||
        group.staged.some((staged) => !rawTargetKeys.has(staged.field))
      ) {
        return '带出字段只能选择目标数据源表的原始字段'
      }
    }
    const emptyTitle = [...group.items.filter((item) => !item.removed), ...group.staged].find(
      (item) => item.title.trim() === '',
    )
    if (emptyTitle) return '带出列显示名称不能为空'
  }
  return null
}

/** 草稿 → 保存载荷：删除 keys、标题/规则/聚合变更 updates、staged 物化为新列 */
export function buildLookupManageChanges(
  draft: LookupManageDraft,
  columns: readonly SmartColumn[],
  tablesById: ReadonlyMap<string, TableBundle>,
  extraExistingKeys?: readonly string[],
): LookupManageChanges {
  const deletedKeys: string[] = []
  const updates: LookupColumnUpdate[] = []
  const addedColumns: SmartColumn[] = []
  const columnByKey = new Map(columns.map((col) => [col.key, col]))
  const existingKeySet = new Set([...columns.map((col) => col.key), ...(extraExistingKeys ?? [])])

  for (const group of draft.groups) {
    if (group.deleted) {
      deletedKeys.push(...group.items.map((item) => item.key))
      continue
    }

    const rulesChanged = !rulesEqual(group.matchRules, group.origMatchRules)
    for (const item of group.items) {
      if (item.removed) {
        deletedKeys.push(item.key)
        continue
      }
      const col = columnByKey.get(item.key)
      if (!col?.lookupConfig) continue

      const aggChanged = item.rollupAgg !== item.origRollupAgg
      const fieldChanged = item.field !== item.origField
      const title = item.title.trim()
      if (!rulesChanged && !aggChanged && !fieldChanged && title === item.origTitle) continue

      updates.push({
        key: item.key,
        ...(title !== item.origTitle ? { title } : {}),
        ...(aggChanged
          ? {
              numberFormat: rollupNumberFormat(item.rollupAgg, col.numberFormat),
              ...(item.rollupAgg === 'count' || item.rollupAgg === 'join'
                ? { decimalPlaces: null }
                : {}),
            }
          : {}),
        ...(rulesChanged || aggChanged || fieldChanged
          ? {
              lookupConfig: {
                ...col.lookupConfig,
                matchRules: group.matchRules.map((rule) => ({ ...rule })),
                ...(fieldChanged ? { targetReturnField: item.field } : {}),
                ...(item.rollupAgg !== undefined ? { rollupAgg: item.rollupAgg } : {}),
              },
            }
          : {}),
      })
    }

    if (group.staged.length > 0) {
      const targetColumns = filterRawColumns(
        tablesById.get(group.targetTableId)?.meta.columns ?? [],
      )
      const materialized = createLookupColumnsFromWizard({
        groupId: group.groupId,
        targetTableId: group.targetTableId,
        matchRules: group.matchRules,
        mode: group.mode,
        existingKeys: existingKeySet,
        returnFields: group.staged.map((staged) => ({
          field: staged.field,
          title: staged.title.trim(),
          ...(staged.rollupAgg !== undefined ? { rollupAgg: staged.rollupAgg } : {}),
          ...pickTargetFormat(targetColumns, staged.field),
        })),
      })
      for (const col of materialized) {
        existingKeySet.add(col.key)
      }
      addedColumns.push(...materialized)
    }
  }

  return { deletedKeys, updates, addedColumns }
}

/** 关联管理编辑结果应用到表列：先删、再改（标题/数值格式/lookupConfig）、最后追加新列 */
export function applyLookupManageChanges(
  columns: readonly SmartColumn[],
  changes: LookupManageChanges,
): SmartColumn[] {
  const deleted = new Set(changes.deletedKeys)
  const updatesByKey = new Map(changes.updates.map((update) => [update.key, update]))
  const edited = columns
    .filter((col) => !deleted.has(col.key))
    .map((col) => {
      const update = updatesByKey.get(col.key)
      if (!update) return col
      return {
        ...col,
        ...(update.title !== undefined ? { title: update.title } : {}),
        ...(update.numberFormat !== undefined
          ? { numberFormat: update.numberFormat ?? undefined }
          : {}),
        ...(update.decimalPlaces !== undefined
          ? { decimalPlaces: update.decimalPlaces ?? undefined }
          : {}),
        ...(update.lookupConfig !== undefined ? { lookupConfig: update.lookupConfig } : {}),
      }
    })
  return [...edited, ...changes.addedColumns]
}

function rulesEqual(a: readonly LookupMatchRule[], b: readonly LookupMatchRule[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 聚合方式切换的联动数值格式：count 出整数、join 纯文本（null 清除）、其余沿用原格式 */
function rollupNumberFormat(
  agg: LookupRollupAgg | undefined,
  current: SmartColumn['numberFormat'],
): SmartColumn['numberFormat'] | null {
  if (agg === 'count') return 'integer'
  if (agg === 'join') return null
  return current ?? 'decimal'
}

/** 新增带出列沿用目标字段的数值格式、小数位与列宽 */
function pickTargetFormat(
  targetColumns: readonly SmartColumn[],
  field: string,
): { numberFormat?: SmartColumn['numberFormat']; decimalPlaces?: number; width?: number } {
  const target = targetColumns.find((col) => col.key === field)
  return {
    ...(target?.numberFormat !== undefined ? { numberFormat: target.numberFormat } : {}),
    ...(target?.decimalPlaces !== undefined ? { decimalPlaces: target.decimalPlaces } : {}),
    ...(target?.width !== undefined ? { width: target.width } : {}),
  }
}
