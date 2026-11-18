// VLOOKUP 重名冲突消歧浮层：支持点选锁定目标行或追加联合匹配条件，切格同步重置状态且失败保持打开

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, X } from 'lucide-react'
import type { SmartGridConflictClickInfo } from '../canvas/smart-grid'
import { scalarToText } from '../domain/utils'
import type { TableBundle } from '../shared/api-types'
import type { LookupMatchRule, SmartColumn, SmartRecord } from '../shared/schema'
import { CustomSelect } from './CustomSelect'

export interface DisambiguatePopoverProps {
  conflictInfo: SmartGridConflictClickInfo
  sourceColumns: readonly SmartColumn[]
  targetBundle: TableBundle | undefined
  onClose: () => void
  onSelectCandidate: (recordId: string, groupId: string, targetRecordId: string) => Promise<void>
  onAppendMatchRule: (groupId: string, rule: LookupMatchRule) => Promise<void>
}

export function DisambiguatePopover({
  conflictInfo,
  sourceColumns,
  targetBundle,
  onClose,
  onSelectCandidate,
  onAppendMatchRule,
}: DisambiguatePopoverProps) {
  const { record, column, conflict, rect } = conflictInfo
  const targetColumns = targetBundle?.meta.columns ?? []
  const existingRules = column.lookupConfig?.matchRules ?? []

  const availableSourceCols = useMemo(
    () =>
      sourceColumns.filter(
        (c) => c.type !== 'formula' && !existingRules.some((r) => r.sourceField === c.key),
      ),
    [sourceColumns, existingRules],
  )
  const availableTargetCols = useMemo(
    () => targetColumns.filter((c) => !existingRules.some((r) => r.targetField === c.key)),
    [targetColumns, existingRules],
  )

  const defaultSource =
    availableSourceCols.find((c) => c.key.includes('dept'))?.key ??
    availableSourceCols[0]?.key ??
    ''
  const defaultTarget =
    availableTargetCols.find((c) => c.key.includes('dept'))?.key ??
    availableTargetCols[0]?.key ??
    ''

  const [showRuleBuilder, setShowRuleBuilder] = useState(false)
  const [sourceField, setSourceField] = useState(defaultSource)
  const [targetField, setTargetField] = useState(defaultTarget)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setShowRuleBuilder(false)
    setSourceField(defaultSource)
    setTargetField(defaultTarget)
  }, [conflictInfo, defaultSource, defaultTarget])

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

  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.min(Math.max(16, rect.x), Math.max(16, viewportW - 396))
  const top =
    rect.y + rect.height + 6 + 340 <= viewportH - 16
      ? Math.max(16, rect.y + rect.height + 6)
      : Math.max(16, viewportH - 360)

  const previewCols = targetColumns.filter((c) => c.key !== '_id').slice(0, 5)
  const pkField = targetBundle?.meta.primaryKeyField

  async function handleChoose(candidateId: string) {
    setSubmitting(true)
    try {
      await onSelectCandidate(record._id, conflict.groupId, candidateId)
      onClose()
    } catch {
      // 保持浮层打开
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault()
    if (!sourceField || !targetField) return
    setSubmitting(true)
    try {
      await onAppendMatchRule(conflict.groupId, { sourceField, targetField })
      onClose()
    } catch {
      // 保持浮层打开
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1050]" onClick={() => !submitting && onClose()}>
      <div
        className="fixed w-[380px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="VLOOKUP 重名记录消歧"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <span>检测到重名候选记录</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              关联目标表「{targetBundle?.meta.name ?? conflict.targetTableId}」，共命中{' '}
              {conflict.candidates.length} 条记录，请选择正确的一条：
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

        <div className="max-h-60 space-y-2 overflow-y-auto p-3">
          {conflict.candidates.map((candidate: SmartRecord) => {
            const isSelected = conflict.selectedRecordId === candidate._id
            const pkValue = pkField ? candidate[pkField] : candidate._id
            return (
              <button
                key={candidate._id}
                type="button"
                disabled={submitting}
                onClick={() => void handleChoose(candidate._id)}
                className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                  isSelected
                    ? 'border-blue-400 bg-blue-50/60'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    {scalarToText(pkValue) || candidate._id}
                  </span>
                  {isSelected && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                      {conflict.isResolved ? '已锁定' : '当前默认'}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  {previewCols.map((col) => (
                    <span key={col.key}>
                      <em className="not-italic text-slate-400">{col.title}:</em>{' '}
                      {scalarToText(candidate[col.key]) || '—'}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>

        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-2.5">
          {!showRuleBuilder ? (
            <button
              type="button"
              onClick={() => setShowRuleBuilder(true)}
              disabled={availableSourceCols.length === 0 || availableTargetCols.length === 0}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>追加联合匹配条件（彻底避免重名冲突）</span>
            </button>
          ) : (
            <form className="space-y-2" onSubmit={(e) => void handleAddRule(e)}>
              <div className="flex items-center gap-1.5">
                <CustomSelect
                  size="xs"
                  className="flex-1"
                  value={sourceField}
                  ariaLabel="选择本表字段"
                  options={availableSourceCols.map((c) => ({
                    value: c.key,
                    label: `本表 · ${c.title}`,
                  }))}
                  onChange={setSourceField}
                />
                <span className="text-xs font-semibold text-slate-400">=</span>
                <CustomSelect
                  size="xs"
                  className="flex-1"
                  value={targetField}
                  ariaLabel="选择目标表字段"
                  options={availableTargetCols.map((c) => ({
                    value: c.key,
                    label: `目标 · ${c.title}`,
                  }))}
                  onChange={setTargetField}
                />
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowRuleBuilder(false)}
                  className="h-6 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || !sourceField || !targetField}
                  className="h-6 rounded bg-blue-600 px-2.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  应用联合条件
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
