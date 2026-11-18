// 关联列字段设置面板（企微/飞书式）：右键关联列头或从字段管理唤起，编辑列名、
// 匹配条件（保存时同组联动）、带出字段/聚合方式并可删除字段，命中统计实时预览。
// 草稿与变更计算复用 domain/lookup-manage，本组件只负责渲染与调用。

import { useEffect, useMemo, useState } from 'react'
import type { Region } from '@infinitable/render'
import {
  appendLookupRule,
  applyLookupManageChanges,
  buildLookupManageChanges,
  createLookupManageDraft,
  isLookupDraftDirty,
  lookupDraftError,
  removeLookupRule,
  setLookupItemAgg,
  setLookupItemField,
  setLookupItemTitle,
  updateLookupRule,
} from '../domain/lookup-manage'
import { previewLookupStats } from '../domain/lookup-engine'
import type { TableBundle } from '../shared/api-types'
import type { SmartColumn, SmartRecord } from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import { ROLLUP_AGG_OPTIONS } from './LookupWizardModal'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  XIcon,
} from './Icons'

export interface LookupFieldPanelProps {
  columnKey: string
  /** 列头（或唤起按钮）在浏览器视口中的矩形，面板锚定其下方 */
  rect: Region
  sourceTable: TableBundle
  sourceComputedRecords: readonly SmartRecord[]
  allTables: readonly TableBundle[]
  onClose: () => void
  /** 保存全部修改：应用删改后的完整列数组由 App 落 meta */
  onSave: (nextColumns: SmartColumn[]) => Promise<void>
  onDeleteColumn: (columnKey: string) => Promise<void>
}

export function LookupFieldPanel({
  columnKey,
  rect,
  sourceTable,
  sourceComputedRecords,
  allTables,
  onClose,
  onSave,
  onDeleteColumn,
}: LookupFieldPanelProps) {
  const tablesById = useMemo(
    () => new Map(allTables.map((bundle) => [bundle.meta.id, bundle])),
    [allTables],
  )
  const [draft, setDraft] = useState(() =>
    createLookupManageDraft(sourceTable.meta.columns, tablesById),
  )
  const [submitting, setSubmitting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const group = draft.groups.find((g) => g.items.some((item) => item.key === columnKey))
  const item = group?.items.find((row) => row.key === columnKey)

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

  if (!group || !item) {
    return null
  }

  const targetBundle = tablesById.get(group.targetTableId)
  const targetColumns = (targetBundle?.meta.columns ?? []).filter((c) => c.key !== '_id')
  const targetFieldOptions = targetColumns.map((c) => ({ value: c.key, label: c.title }))
  const stats = targetBundle
    ? previewLookupStats(sourceComputedRecords, targetBundle.records, group.matchRules)
    : { matchedRows: 0, conflictRows: 0, unmatchedRows: 0 }
  const error = lookupDraftError(draft)
  const dirty = isLookupDraftDirty(draft)

  async function handleSave() {
    if (error || !dirty) return
    const nextColumns = applyLookupManageChanges(
      sourceTable.meta.columns,
      buildLookupManageChanges(draft, sourceTable.meta.columns, tablesById),
    )
    setSubmitting(true)
    try {
      await onSave(nextColumns)
      onClose()
    } catch {
      // 保存失败留在面板内，错误由 Toast 展现
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete() {
    setSubmitting(true)
    try {
      await onDeleteColumn(columnKey)
      onClose()
    } catch {
      setSubmitting(false)
    }
  }

  // 面板贴靠视口：优先列头下方，空间不足则翻到上方，整体不越界
  const panelWidth = 380
  const left = Math.min(Math.max(12, rect.x), Math.max(12, window.innerWidth - panelWidth - 12))
  const belowTop = rect.y + rect.height + 6
  const top = belowTop + 480 <= window.innerHeight - 12 ? belowTop : Math.max(12, rect.y - 486)

  return (
    <div className="st-cell-popover-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="st-field-panel"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`关联字段设置 ${item.title}`}
      >
        <div className="st-popover-header">
          <div>
            <div className="st-popover-title">
              <SettingsIcon size={14} className="st-primary-icon" />
              <span>关联字段设置</span>
            </div>
            <div className="st-popover-sub">
              {sourceTable.meta.name} → {targetBundle?.meta.name ?? group.targetTableId}（
              {group.mode === 'one' ? '一对一带出' : '一对多汇总'}）
            </div>
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

        <div className="st-field-panel-body">
          <div className="st-field-panel-section">
            <label className="st-label" htmlFor="st-lookup-field-title">
              列名
            </label>
            <input
              id="st-lookup-field-title"
              type="text"
              className={`st-input st-input-sm ${item.title.trim() === '' ? 'is-invalid' : ''}`}
              value={item.title}
              disabled={submitting}
              onChange={(e) =>
                setDraft((prev) =>
                  setLookupItemTitle(prev, group.groupId, columnKey, e.target.value),
                )
              }
            />
          </div>

          <div className="st-field-panel-section">
            <div className="st-field-head">
              <label className="st-label">匹配条件（AND 联合，同组列共用）</label>
              <button
                type="button"
                className="st-btn st-btn-xs"
                disabled={submitting}
                onClick={() =>
                  setDraft((prev) =>
                    appendLookupRule(prev, group.groupId, {
                      sourceField: sourceTable.meta.columns[0]?.key ?? '',
                      targetField: targetColumns[0]?.key ?? '',
                    }),
                  )
                }
              >
                <PlusIcon size={12} />
                <span>追加</span>
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
                    options={sourceTable.meta.columns.map((c) => ({
                      value: c.key,
                      label: c.title,
                    }))}
                    disabled={submitting}
                    onChange={(val) =>
                      setDraft((prev) =>
                        updateLookupRule(prev, group.groupId, idx, { sourceField: val }),
                      )
                    }
                  />
                  <span className="st-eq-sign">=</span>
                  <CustomSelect
                    size="sm"
                    className="st-flex-1"
                    value={rule.targetField}
                    ariaLabel="目标表匹配字段"
                    options={(targetBundle?.meta.columns ?? []).map((c) => ({
                      value: c.key,
                      label: c.title,
                    }))}
                    disabled={submitting}
                    onChange={(val) =>
                      setDraft((prev) =>
                        updateLookupRule(prev, group.groupId, idx, { targetField: val }),
                      )
                    }
                  />
                  {group.matchRules.length > 1 && (
                    <button
                      type="button"
                      className="st-icon-btn st-icon-danger"
                      disabled={submitting}
                      onClick={() => setDraft((prev) => removeLookupRule(prev, group.groupId, idx))}
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

          {group.mode === 'one' ? (
            <div className="st-field-panel-section">
              <label className="st-label">带出字段（从目标表取哪一列）</label>
              <CustomSelect
                value={item.field}
                ariaLabel="带出字段"
                options={targetFieldOptions}
                disabled={submitting}
                onChange={(field) =>
                  setDraft((prev) =>
                    setLookupItemField(
                      prev,
                      group.groupId,
                      columnKey,
                      field,
                      targetColumns.find((c) => c.key === field)?.title ?? field,
                    ),
                  )
                }
              />
            </div>
          ) : (
            <div className="st-field-panel-section">
              <label className="st-label">聚合字段与方式（对匹配到的全部行计算）</label>
              <div className="st-match-rule-row">
                <CustomSelect
                  size="sm"
                  className="st-flex-1"
                  value={item.field}
                  ariaLabel="聚合字段"
                  options={targetFieldOptions}
                  disabled={submitting}
                  onChange={(field) =>
                    setDraft((prev) =>
                      setLookupItemField(
                        prev,
                        group.groupId,
                        columnKey,
                        field,
                        targetColumns.find((c) => c.key === field)?.title ?? field,
                      ),
                    )
                  }
                />
                <CustomSelect
                  size="sm"
                  className="st-flex-1"
                  value={item.rollupAgg ?? 'sum'}
                  ariaLabel="聚合方式"
                  options={ROLLUP_AGG_OPTIONS}
                  disabled={submitting}
                  onChange={(agg) =>
                    setDraft((prev) => setLookupItemAgg(prev, group.groupId, columnKey, agg))
                  }
                />
              </div>
            </div>
          )}
        </div>

        {error && <div className="st-field-panel-error">{error}</div>}

        <div className="st-field-panel-footer">
          {confirmDelete ? (
            <div className="st-row-actions">
              <span className="st-field-panel-delete-hint">删除此列？</span>
              <button
                type="button"
                className="st-btn st-btn-xs st-btn-danger"
                disabled={submitting}
                onClick={() => void handleDelete()}
              >
                确认删除
              </button>
              <button
                type="button"
                className="st-btn st-btn-xs"
                disabled={submitting}
                onClick={() => setConfirmDelete(false)}
              >
                再想想
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="st-icon-btn st-icon-danger"
              disabled={submitting}
              title="删除此关联列"
              aria-label="删除此关联列"
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon size={13} />
            </button>
          )}
          <div className="st-row-actions">
            <button
              type="button"
              className="st-btn st-btn-sm"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="st-btn st-btn-sm st-btn-primary"
              disabled={submitting || !dirty || error !== null}
              onClick={() => void handleSave()}
            >
              {submitting ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
