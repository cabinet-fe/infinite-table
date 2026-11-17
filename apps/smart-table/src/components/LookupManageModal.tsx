// 关联查找管理弹窗：按 groupId 聚合展示本表全部 VLOOKUP 关联，支持编辑匹配条件、
// 重命名/删除带出列、切换汇总聚合方式、追加带出字段与删除整组，一次性保存落库。

import { useEffect, useMemo, useState } from 'react'
import {
  applyLookupManageChanges,
  createLookupColumnsFromWizard,
  previewLookupStats,
  type LookupColumnUpdate,
  type LookupManageChanges,
} from '../domain/lookup-engine'
import type { TableBundle } from '../shared/api-types'
import type {
  LookupMatchRule,
  LookupMode,
  LookupRollupAgg,
  SmartColumn,
  SmartRecord,
} from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleIcon,
  Link2Icon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from './Icons'

const ROLLUP_AGG_OPTIONS: { value: LookupRollupAgg; label: string }[] = [
  { value: 'sum', label: '求和 (SUM)' },
  { value: 'count', label: '计数 (COUNT)' },
  { value: 'avg', label: '平均值 (AVG)' },
  { value: 'max', label: '最大值 (MAX)' },
  { value: 'min', label: '最小值 (MIN)' },
  { value: 'join', label: '文本拼接 (JOIN)' },
]

interface ItemDraft {
  key: string
  field: string
  /** 目标字段原标题（展示用；要换字段请删掉后重新添加） */
  targetTitle: string
  title: string
  origTitle: string
  rollupAgg?: LookupRollupAgg
  origRollupAgg?: LookupRollupAgg
  removed: boolean
}

interface StagedDraft {
  field: string
  title: string
  rollupAgg?: LookupRollupAgg
}

interface GroupDraft {
  groupId: string
  targetTableId: string
  mode: LookupMode
  origMatchRules: LookupMatchRule[]
  matchRules: LookupMatchRule[]
  items: ItemDraft[]
  staged: StagedDraft[]
  deleted: boolean
}

export interface LookupManageModalProps {
  sourceTable: TableBundle
  sourceComputedRecords: readonly SmartRecord[]
  allTables: readonly TableBundle[]
  onClose: () => void
  /** 保存全部修改：应用删除/更新/追加后的完整列数组由 App 落 meta */
  onSave: (nextColumns: SmartColumn[]) => Promise<void>
}

export function LookupManageModal({
  sourceTable,
  sourceComputedRecords,
  allTables,
  onClose,
  onSave,
}: LookupManageModalProps) {
  const tablesById = useMemo(
    () => new Map(allTables.map((bundle) => [bundle.meta.id, bundle])),
    [allTables],
  )
  const [groups, setGroups] = useState<GroupDraft[]>(() =>
    buildDrafts(sourceTable.meta.columns, tablesById),
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitting, onClose])

  const sourceColOptions = sourceTable.meta.columns.map((c) => ({
    value: c.key,
    label: c.title,
  }))

  function patchGroup(groupId: string, patch: Partial<GroupDraft>) {
    setGroups((prev) => prev.map((g) => (g.groupId === groupId ? { ...g, ...patch } : g)))
  }

  function updateRule(groupId: string, idx: number, rulePatch: Partial<LookupMatchRule>) {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId === groupId
          ? {
              ...g,
              matchRules: g.matchRules.map((r, i) => (i === idx ? { ...r, ...rulePatch } : r)),
            }
          : g,
      ),
    )
  }

  function addRule(groupId: string) {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.groupId !== groupId) return g
        const sCol = sourceTable.meta.columns[0]?.key ?? ''
        const tCol = tablesById.get(g.targetTableId)?.meta.columns[0]?.key ?? ''
        return sCol && tCol
          ? { ...g, matchRules: [...g.matchRules, { sourceField: sCol, targetField: tCol }] }
          : g
      }),
    )
  }

  function removeRule(groupId: string, idx: number) {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId === groupId && g.matchRules.length > 1
          ? { ...g, matchRules: g.matchRules.filter((_, i) => i !== idx) }
          : g,
      ),
    )
  }

  /** 删除整组 = 既有列全部移除 + 丢弃未保存的追加项 */
  function deleteGroup(groupId: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId === groupId
          ? {
              ...g,
              deleted: true,
              staged: [],
              items: g.items.map((item) => ({ ...item, removed: true })),
            }
          : g,
      ),
    )
  }

  const visibleGroups = groups.filter((g) => !g.deleted)

  const invalidTitleExists = visibleGroups.some(
    (g) =>
      g.items.some((item) => !item.removed && item.title.trim() === '') ||
      g.staged.some((staged) => staged.title.trim() === ''),
  )

  async function handleSave() {
    if (invalidTitleExists) return
    const nextColumns = applyLookupManageChanges(
      sourceTable.meta.columns,
      buildChanges(groups, sourceTable.meta.columns, tablesById),
    )
    setSubmitting(true)
    try {
      await onSave(nextColumns)
      onClose()
    } catch {
      // 保存失败留在弹窗内，错误由 Toast 展现
    } finally {
      setSubmitting(false)
    }
  }

  const dirty =
    serializeDraft(groups) !== serializeDraft(buildDrafts(sourceTable.meta.columns, tablesById))
  const canSave =
    dirty && !invalidTitleExists && visibleGroups.every((g) => g.matchRules.length > 0)

  return (
    <div className="st-modal-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="st-modal st-modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="管理关联查找"
      >
        <div className="st-modal-header">
          <div>
            <h2 className="st-modal-title st-title-with-icon">
              <Link2Icon size={16} className="st-primary-icon" />
              <span>管理关联查找</span>
            </h2>
            <p className="st-modal-sub">
              编辑匹配条件、增删带出列或整组删除；匹配条件变更对同组全部带出列生效
            </p>
          </div>
          <button
            type="button"
            className="st-icon-btn"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="st-modal-body">
          {visibleGroups.length === 0 ? (
            <div className="st-empty-state">
              当前表还没有关联查找列，点击工具栏「关联查找 (VLOOKUP)」开始创建。
            </div>
          ) : (
            <div className="st-lookup-group-list">
              {visibleGroups.map((group) => {
                const targetBundle = tablesById.get(group.targetTableId)
                const targetColumns = targetBundle?.meta.columns ?? []
                const targetName = targetBundle?.meta.name ?? group.targetTableId
                const activeItems = group.items.filter((item) => !item.removed)
                const usedFields = new Set([
                  ...activeItems.map((item) => item.field),
                  ...group.staged.map((staged) => staged.field),
                ])
                const availableFields = targetColumns
                  .filter((c) => c.key !== '_id' && !usedFields.has(c.key))
                  .map((c) => ({ value: c.key, label: c.title }))
                const stats = targetBundle
                  ? previewLookupStats(
                      sourceComputedRecords,
                      targetBundle.records,
                      group.matchRules,
                    )
                  : { matchedRows: 0, conflictRows: 0, unmatchedRows: 0 }

                return (
                  <section key={group.groupId} className="st-lookup-group-card">
                    <header className="st-lookup-group-head">
                      <div className="st-lookup-group-title">
                        <Link2Icon size={13} className="st-primary-icon" />
                        <span>
                          {sourceTable.meta.name} → {targetName}
                        </span>
                        <span
                          className={`st-tag ${targetBundle?.meta.kind === 'advanced' ? 'st-tag-sql' : ''}`}
                        >
                          {group.mode === 'one' ? '一对一带出' : '一对多汇总'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="st-icon-btn st-icon-danger"
                        disabled={submitting}
                        onClick={() => deleteGroup(group.groupId)}
                        title="删除整组关联列"
                        aria-label={`删除与 ${targetName} 的关联`}
                      >
                        <TrashIcon size={13} />
                      </button>
                    </header>

                    <div className="st-lookup-group-section">
                      <div className="st-field-head">
                        <label className="st-label">匹配条件（AND 联合）</label>
                        <button
                          type="button"
                          className="st-btn st-btn-xs"
                          disabled={submitting}
                          onClick={() => addRule(group.groupId)}
                        >
                          <PlusIcon size={12} />
                          <span>追加条件</span>
                        </button>
                      </div>
                      <div className="st-rule-list">
                        {group.matchRules.map((rule, idx) => (
                          <div
                            key={`${rule.sourceField}-${rule.targetField}-${idx}`}
                            className="st-match-rule-row"
                          >
                            <CustomSelect
                              size="sm"
                              className="st-flex-1"
                              value={rule.sourceField}
                              ariaLabel="本表匹配字段"
                              options={sourceColOptions}
                              disabled={submitting}
                              onChange={(val) =>
                                updateRule(group.groupId, idx, { sourceField: val })
                              }
                            />
                            <span className="st-eq-sign">=</span>
                            <CustomSelect
                              size="sm"
                              className="st-flex-1"
                              value={rule.targetField}
                              ariaLabel="目标表匹配字段"
                              options={targetColumns.map((c) => ({ value: c.key, label: c.title }))}
                              disabled={submitting}
                              onChange={(val) =>
                                updateRule(group.groupId, idx, { targetField: val })
                              }
                            />
                            {group.matchRules.length > 1 && (
                              <button
                                type="button"
                                className="st-icon-btn st-icon-danger"
                                disabled={submitting}
                                onClick={() => removeRule(group.groupId, idx)}
                                aria-label="删除此匹配条件"
                              >
                                <XIcon size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="st-preview-stats">
                        <div className="st-stat-item is-ok">
                          <CheckCircleIcon size={14} />
                          <span>
                            唯一命中 <strong>{stats.matchedRows}</strong>
                          </span>
                        </div>
                        <div className={`st-stat-item ${stats.conflictRows > 0 ? 'is-warn' : ''}`}>
                          <AlertTriangleIcon size={14} />
                          <span>
                            多候选 <strong>{stats.conflictRows}</strong>
                          </span>
                        </div>
                        <div className="st-stat-item">
                          <CircleIcon size={14} />
                          <span>
                            未命中 <strong>{stats.unmatchedRows}</strong>
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="st-lookup-group-section">
                      <label className="st-label">
                        带出列（{activeItems.length + group.staged.length}）
                      </label>
                      <div className="st-return-list">
                        {activeItems.map((item) => (
                          <div key={item.key} className="st-lookup-item-row">
                            <span
                              className="st-lookup-item-source"
                              title={`目标字段：${item.targetTitle}`}
                            >
                              {item.targetTitle}
                            </span>
                            {group.mode === 'rollup' && (
                              <CustomSelect
                                value={item.rollupAgg ?? 'sum'}
                                options={ROLLUP_AGG_OPTIONS}
                                size="sm"
                                className="st-lookup-item-agg"
                                ariaLabel={`列 ${item.title} 聚合方式`}
                                disabled={submitting}
                                onChange={(agg) =>
                                  patchGroup(group.groupId, {
                                    items: group.items.map((row) =>
                                      row.key === item.key ? { ...row, rollupAgg: agg } : row,
                                    ),
                                  })
                                }
                              />
                            )}
                            <input
                              type="text"
                              className={`st-input st-input-sm ${item.title.trim() === '' ? 'is-invalid' : ''}`}
                              value={item.title}
                              aria-label={`列 ${item.targetTitle} 显示名称`}
                              disabled={submitting}
                              onChange={(e) =>
                                patchGroup(group.groupId, {
                                  items: group.items.map((row) =>
                                    row.key === item.key ? { ...row, title: e.target.value } : row,
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              className="st-icon-btn st-icon-danger"
                              disabled={submitting}
                              title="删除此带出列"
                              aria-label={`删除带出列 ${item.title}`}
                              onClick={() =>
                                patchGroup(group.groupId, {
                                  items: group.items.map((row) =>
                                    row.key === item.key ? { ...row, removed: true } : row,
                                  ),
                                })
                              }
                            >
                              <TrashIcon size={13} />
                            </button>
                          </div>
                        ))}
                        {group.staged.map((staged, idx) => (
                          <div
                            key={`staged_${staged.field}`}
                            className="st-lookup-item-row is-staged"
                          >
                            <span className="st-lookup-item-source">
                              {targetColumns.find((c) => c.key === staged.field)?.title ??
                                staged.field}
                            </span>
                            {group.mode === 'rollup' && (
                              <CustomSelect
                                value={staged.rollupAgg ?? 'sum'}
                                options={ROLLUP_AGG_OPTIONS}
                                size="sm"
                                className="st-lookup-item-agg"
                                ariaLabel="新列聚合方式"
                                disabled={submitting}
                                onChange={(agg) =>
                                  patchGroup(group.groupId, {
                                    staged: group.staged.map((row, i) =>
                                      i === idx ? { ...row, rollupAgg: agg } : row,
                                    ),
                                  })
                                }
                              />
                            )}
                            <input
                              type="text"
                              className={`st-input st-input-sm ${staged.title.trim() === '' ? 'is-invalid' : ''}`}
                              value={staged.title}
                              aria-label="新列显示名称"
                              disabled={submitting}
                              onChange={(e) =>
                                patchGroup(group.groupId, {
                                  staged: group.staged.map((row, i) =>
                                    i === idx ? { ...row, title: e.target.value } : row,
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              className="st-icon-btn st-icon-danger"
                              disabled={submitting}
                              title="移除待添加列"
                              aria-label="移除待添加列"
                              onClick={() =>
                                patchGroup(group.groupId, {
                                  staged: group.staged.filter((_, i) => i !== idx),
                                })
                              }
                            >
                              <XIcon size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                      {availableFields.length > 0 && (
                        <button
                          type="button"
                          className="st-btn st-btn-xs"
                          disabled={submitting}
                          onClick={() => {
                            const field = availableFields[0]!.value
                            const targetCol = targetColumns.find((c) => c.key === field)
                            const fallbackTitle = targetCol?.title ?? field
                            patchGroup(group.groupId, {
                              staged: [
                                ...group.staged,
                                {
                                  field,
                                  title:
                                    group.mode === 'rollup'
                                      ? `${fallbackTitle}汇总`
                                      : fallbackTitle,
                                  ...(group.mode === 'rollup'
                                    ? { rollupAgg: 'sum' as LookupRollupAgg }
                                    : {}),
                                },
                              ],
                            })
                          }}
                        >
                          <PlusIcon size={12} />
                          <span>添加带出字段</span>
                        </button>
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </div>

        <div className="st-modal-footer">
          <button type="button" className="st-btn" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="st-btn st-btn-primary"
            disabled={submitting || !canSave}
            onClick={() => void handleSave()}
          >
            {submitting ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 从既有 lookup 列构建分组草稿（同 groupId 一组；无 lookupConfig 的列忽略） */
function buildDrafts(
  columns: readonly SmartColumn[],
  tablesById: ReadonlyMap<string, TableBundle>,
): GroupDraft[] {
  const byGroup = new Map<string, GroupDraft>()
  for (const col of columns) {
    if (col.type !== 'lookup' || !col.lookupConfig) continue
    const config = col.lookupConfig
    let group = byGroup.get(config.groupId)
    if (!group) {
      group = {
        groupId: config.groupId,
        targetTableId: config.targetTableId,
        mode: config.mode,
        origMatchRules: config.matchRules.map((rule) => ({ ...rule })),
        matchRules: config.matchRules.map((rule) => ({ ...rule })),
        items: [],
        staged: [],
        deleted: false,
      }
      byGroup.set(config.groupId, group)
    }
    const targetTitle =
      tablesById
        .get(config.targetTableId)
        ?.meta.columns.find((c) => c.key === config.targetReturnField)?.title ??
      config.targetReturnField
    group.items.push({
      key: col.key,
      field: config.targetReturnField,
      targetTitle,
      title: col.title,
      origTitle: col.title,
      rollupAgg: config.rollupAgg,
      origRollupAgg: config.rollupAgg,
      removed: false,
    })
  }
  return [...byGroup.values()]
}

/** 草稿 → 保存载荷：删除 keys、标题/规则/聚合变更 updates、staged 物化为新列 */
function buildChanges(
  groups: readonly GroupDraft[],
  columns: readonly SmartColumn[],
  tablesById: ReadonlyMap<string, TableBundle>,
): LookupManageChanges {
  const deletedKeys: string[] = []
  const updates: LookupColumnUpdate[] = []
  const addedColumns: SmartColumn[] = []
  const columnByKey = new Map(columns.map((col) => [col.key, col]))

  for (const group of groups) {
    if (group.deleted) {
      deletedKeys.push(...group.items.map((item) => item.key))
      continue
    }

    const rulesChanged = JSON.stringify(group.matchRules) !== JSON.stringify(group.origMatchRules)

    for (const item of group.items) {
      if (item.removed) {
        deletedKeys.push(item.key)
        continue
      }
      const col = columnByKey.get(item.key)
      const config = col?.lookupConfig
      if (!col || !config) continue

      const aggChanged = item.rollupAgg !== item.origRollupAgg
      const titleChanged = item.title.trim() !== item.origTitle && item.title.trim() !== ''
      if (!rulesChanged && !aggChanged && !titleChanged) continue

      // 聚合方式切换联动数值格式：count 出整数、join 为纯文本、其余沿用原格式
      let numberFormat: SmartColumn['numberFormat'] | null | undefined
      if (aggChanged) {
        numberFormat =
          item.rollupAgg === 'count'
            ? 'integer'
            : item.rollupAgg === 'join'
              ? null
              : (col.numberFormat ?? 'decimal')
      }

      updates.push({
        key: item.key,
        ...(titleChanged ? { title: item.title.trim() } : {}),
        ...(numberFormat !== undefined ? { numberFormat } : {}),
        ...(rulesChanged || aggChanged
          ? {
              lookupConfig: {
                ...config,
                matchRules: group.matchRules.map((rule) => ({ ...rule })),
                ...(item.rollupAgg !== undefined ? { rollupAgg: item.rollupAgg } : {}),
              },
            }
          : {}),
      })
    }

    if (group.staged.length > 0) {
      const targetColumns = tablesById.get(group.targetTableId)?.meta.columns ?? []
      addedColumns.push(
        ...createLookupColumnsFromWizard({
          groupId: group.groupId,
          targetTableId: group.targetTableId,
          matchRules: group.matchRules,
          mode: group.mode,
          existingKeys: columns.map((col) => col.key),
          returnFields: group.staged.map((staged) => {
            const targetCol = targetColumns.find((c) => c.key === staged.field)
            return {
              field: staged.field,
              title: staged.title.trim(),
              ...(staged.rollupAgg !== undefined ? { rollupAgg: staged.rollupAgg } : {}),
              ...(targetCol?.numberFormat !== undefined
                ? { numberFormat: targetCol.numberFormat }
                : {}),
              ...(targetCol?.width !== undefined ? { width: targetCol.width } : {}),
            }
          }),
        }),
      )
    }
  }

  return { deletedKeys, updates, addedColumns }
}

/** dirty 比对：只序列化会影响保存载荷的字段 */
function serializeDraft(groups: readonly GroupDraft[]): string {
  return JSON.stringify(
    groups.map((group) => ({
      deleted: group.deleted,
      matchRules: group.matchRules,
      items: group.items.map((item) => ({
        removed: item.removed,
        title: item.title,
        rollupAgg: item.rollupAgg,
      })),
      staged: group.staged,
    })),
  )
}
