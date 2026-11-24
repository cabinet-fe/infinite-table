// VLOOKUP 重名冲突消歧浮层：支持点选锁定目标行或追加联合匹配条件，切格同步重置状态且失败保持打开

import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import type { SmartGridConflictClickInfo } from '../canvas/smart-grid'
import { getEligibleLookupSourceColumns } from '../domain/lookup-engine'
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
      getEligibleLookupSourceColumns(sourceColumns, conflict.groupId).filter(
        (c) => !existingRules.some((r) => r.sourceField === c.key),
      ),
    [sourceColumns, conflict.groupId, existingRules],
  )
  const availableTargetCols = useMemo(
    () => targetColumns.filter((c) => !existingRules.some((r) => r.targetField === c.key)),
    [targetColumns, existingRules],
  )

  const defaultSource =
    availableSourceCols.find((c) => c.type !== 'lookup' && c.key.includes('dept'))?.key ??
    availableSourceCols.find((c) => c.type !== 'lookup')?.key ??
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

  const pkField = targetBundle?.meta.primaryKeyField
  const previewCols = targetColumns.filter((c) => c.key !== '_id').slice(0, 5)

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
        className="st-popover p-3 w-72 fixed"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="VLOOKUP 重名记录消歧"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900">重名消歧</div>
            <p className="mt-0.5 text-xs text-slate-500">
              关联目标表「{targetBundle?.meta.name ?? conflict.targetTableId}」共命中{' '}
              {conflict.candidates.length} 条记录，请选择正确的一条
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
            className="st-icon-btn st-icon-btn-xs"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="st-scroll mt-2 flex max-h-60 flex-col gap-0.5 overflow-y-auto">
          {conflict.candidates.map((candidate: SmartRecord) => {
            const isSelected = conflict.selectedRecordId === candidate._id
            const pkValue = pkField ? candidate[pkField] : candidate._id
            const previewText = previewCols
              .map((col) => scalarToText(candidate[col.key]))
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={candidate._id}
                type="button"
                disabled={submitting}
                onClick={() => void handleChoose(candidate._id)}
                className={`st-menu-item ${isSelected ? 'st-menu-item-active' : ''}`}
              >
                <span className="truncate">{scalarToText(pkValue) || candidate._id}</span>
                <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-slate-400">
                  <span className="truncate">{previewText}</span>
                  {isSelected && (
                    <span className="shrink-0">{conflict.isResolved ? '已锁定' : '当前默认'}</span>
                  )}
                </span>
                {isSelected && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )
          })}
        </div>

        <div className="mt-2 border-t border-slate-100 pt-2">
          {!showRuleBuilder ? (
            <button
              type="button"
              onClick={() => setShowRuleBuilder(true)}
              disabled={availableSourceCols.length === 0 || availableTargetCols.length === 0}
              className="st-btn st-btn-xs st-btn-secondary w-full"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>追加联合匹配条件</span>
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
                <span className="text-xs font-medium text-slate-400">=</span>
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
                  className="st-btn st-btn-xs st-btn-secondary"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || !sourceField || !targetField}
                  className="st-btn st-btn-xs st-btn-primary"
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
