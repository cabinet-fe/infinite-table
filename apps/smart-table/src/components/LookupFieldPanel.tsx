// 关联列字段设置面板：右键关联列头或从字段管理唤起，编辑列名、
// 匹配条件（保存时同组联动）、带出字段/聚合方式并可删除字段，命中统计实时预览。

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Plus, Settings, Trash2, X } from 'lucide-react'
import type { Region } from '@infinitable/render'
import {
  getEligibleLookupSourceColumns,
  getEligibleLookupTargetColumns,
  previewLookupStats,
} from '../domain/lookup-engine'
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
import type { TableBundle } from '../shared/api-types'
import { mergeSmartColumns, type SmartColumn, type SmartRecord } from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import { ROLLUP_AGG_OPTIONS } from './LookupWizardModal'

export interface LookupFieldPanelProps {
  columnKey: string
  rect: Region
  sourceTable: TableBundle
  derivedColumns?: readonly SmartColumn[]
  sourceComputedRecords: readonly SmartRecord[]
  allTables: readonly TableBundle[]
  onClose: () => void
  onSave: (nextColumns: SmartColumn[]) => Promise<void>
  onDeleteColumn: (columnKey: string) => Promise<void>
}

export function LookupFieldPanel({
  columnKey,
  rect,
  sourceTable,
  derivedColumns,
  sourceComputedRecords,
  allTables,
  onClose,
  onSave,
  onDeleteColumn,
}: LookupFieldPanelProps) {
  const effectiveSourceColumns = useMemo(
    () =>
      derivedColumns !== undefined
        ? mergeSmartColumns(sourceTable.meta.columns, derivedColumns)
        : sourceTable.meta.columns,
    [sourceTable.meta.columns, derivedColumns],
  )
  const tablesById = useMemo(
    () => new Map(allTables.map((bundle) => [bundle.meta.id, bundle])),
    [allTables],
  )
  const [draft, setDraft] = useState(() =>
    createLookupManageDraft(effectiveSourceColumns, tablesById),
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
  const eligibleSourceCols = getEligibleLookupSourceColumns(effectiveSourceColumns, group.groupId)
  const eligibleSourceKeySet = new Set(eligibleSourceCols.map((c) => c.key))
  const targetColumns = getEligibleLookupTargetColumns(targetBundle?.meta.columns ?? []).filter(
    (c) => c.key !== '_id',
  )
  const targetFieldOptions = targetColumns.map((c) => ({ value: c.key, label: c.title }))
  const stats = targetBundle
    ? previewLookupStats(sourceComputedRecords, targetBundle.records, group.matchRules)
    : { matchedRows: 0, conflictRows: 0, unmatchedRows: 0 }
  const error = lookupDraftError(draft, effectiveSourceColumns, tablesById)
  const dirty = isLookupDraftDirty(draft)

  function handleAppendRule() {
    if (!group) return
    const usedSourceFields = new Set(group.matchRules.map((r) => r.sourceField))
    const usedTargetFields = new Set(group.matchRules.map((r) => r.targetField))
    const nextSource =
      eligibleSourceCols.find((c) => c.type !== 'lookup' && !usedSourceFields.has(c.key))?.key ??
      eligibleSourceCols.find((c) => !usedSourceFields.has(c.key))?.key ??
      eligibleSourceCols[0]?.key ??
      ''
    const nextTarget =
      targetColumns.find((c) => !usedTargetFields.has(c.key))?.key ?? targetColumns[0]?.key ?? ''
    if (!nextSource || !nextTarget) return
    setDraft((prev) =>
      appendLookupRule(prev, group.groupId, {
        sourceField: nextSource,
        targetField: nextTarget,
      }),
    )
  }

  async function handleSave() {
    if (error || !dirty) return
    const nextColumns = applyLookupManageChanges(
      effectiveSourceColumns,
      buildLookupManageChanges(draft, effectiveSourceColumns, tablesById),
    )
    setSubmitting(true)
    try {
      await onSave(nextColumns)
      onClose()
    } catch {
      // 留在面板内
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

  const panelWidth = 380
  const left = Math.min(Math.max(12, rect.x), Math.max(12, window.innerWidth - panelWidth - 12))
  const belowTop = rect.y + rect.height + 6
  const top = belowTop + 480 <= window.innerHeight - 12 ? belowTop : Math.max(12, rect.y - 486)

  return (
    <div className="fixed inset-0 z-[1050]" onClick={() => !submitting && onClose()}>
      <div
        className="fixed w-[380px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`关联字段设置 ${item.title}`}
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <Settings className="h-3.5 w-3.5 text-blue-600" />
              <span>关联字段设置</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {sourceTable.meta.name} → {targetBundle?.meta.name ?? group.targetTableId}（
              {group.mode === 'one' ? '一对一带出' : '一对多汇总'}）
            </div>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="max-h-[420px] space-y-4 overflow-y-auto p-4">
          <div className="space-y-1.5">
            <label
              className="block text-xs font-medium text-slate-700"
              htmlFor="st-lookup-field-title"
            >
              列名
            </label>
            <input
              id="st-lookup-field-title"
              type="text"
              className={`h-8 w-full rounded-md border px-2.5 text-xs text-slate-800 focus:outline-none ${
                item.title.trim() === ''
                  ? 'border-red-400 bg-red-50/40'
                  : 'border-slate-200 focus:border-blue-500'
              }`}
              value={item.title}
              disabled={submitting}
              onChange={(e) =>
                setDraft((prev) =>
                  setLookupItemTitle(prev, group.groupId, columnKey, e.target.value),
                )
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">
                匹配条件（AND 联合，同组列共用）
              </label>
              <button
                type="button"
                disabled={
                  submitting || eligibleSourceCols.length === 0 || targetColumns.length === 0
                }
                onClick={handleAppendRule}
                className="inline-flex h-6 items-center gap-0.5 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                <span>追加</span>
              </button>
            </div>

            <div className="space-y-1.5">
              {group.matchRules.map((rule, idx) => {
                const legacyCol =
                  rule.sourceField && !eligibleSourceKeySet.has(rule.sourceField)
                    ? effectiveSourceColumns.find((c) => c.key === rule.sourceField)
                    : undefined
                const sourceOptions = [
                  ...eligibleSourceCols.map((c) => ({ value: c.key, label: c.title })),
                  ...(rule.sourceField && !eligibleSourceKeySet.has(rule.sourceField)
                    ? [
                        {
                          value: rule.sourceField,
                          label: `${legacyCol?.title ?? rule.sourceField}（不可用）`,
                          disabled: true,
                        },
                      ]
                    : []),
                ]
                return (
                  <div
                    key={`${rule.sourceField}-${rule.targetField}-${idx}`}
                    className="flex items-center gap-1.5"
                  >
                    <CustomSelect
                      size="sm"
                      className="flex-1"
                      value={rule.sourceField}
                      ariaLabel="本表匹配字段"
                      options={sourceOptions}
                      disabled={submitting}
                      onChange={(val) =>
                        setDraft((prev) =>
                          updateLookupRule(prev, group.groupId, idx, { sourceField: val }),
                        )
                      }
                    />
                    <span className="text-xs font-semibold text-slate-400">=</span>
                    <CustomSelect
                      size="sm"
                      className="flex-1"
                      value={rule.targetField}
                      ariaLabel="目标表匹配字段"
                      options={targetFieldOptions}
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
                        disabled={submitting}
                        onClick={() =>
                          setDraft((prev) => removeLookupRule(prev, group.groupId, idx))
                        }
                        aria-label="删除此匹配条件"
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-slate-50 p-2 text-[11px]">
              <div className="flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  命中 <strong>{stats.matchedRows}</strong>
                </span>
              </div>
              <div
                className={`flex items-center gap-1 ${
                  stats.conflictRows > 0 ? 'text-amber-700' : 'text-slate-500'
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  冲突 <strong>{stats.conflictRows}</strong>
                </span>
              </div>
              <div className="flex items-center gap-1 text-slate-500">
                <Circle className="h-3.5 w-3.5 shrink-0" />
                <span>
                  未命中 <strong>{stats.unmatchedRows}</strong>
                </span>
              </div>
            </div>
          </div>

          {group.mode === 'one' ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                带出字段（从目标表取哪一列）
              </label>
              <CustomSelect
                className="w-full"
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
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                聚合字段与方式（对匹配到的全部行计算）
              </label>
              <div className="flex items-center gap-2">
                <CustomSelect
                  size="sm"
                  className="flex-1"
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
                  className="flex-1"
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

        {error && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-4 py-2.5">
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-600">删除此列？</span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleDelete()}
                className="h-6 rounded bg-red-600 px-2 text-[11px] font-medium text-white hover:bg-red-700"
              >
                确认删除
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmDelete(false)}
                className="h-6 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-600"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={submitting}
              title="删除此关联列"
              aria-label="删除此关联列"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="h-7 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="button"
              disabled={submitting || !dirty || error !== null}
              onClick={() => void handleSave()}
              className="h-7 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {submitting ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
