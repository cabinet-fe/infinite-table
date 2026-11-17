// VLOOKUP 重名冲突消歧浮层：支持点选锁定目标行或追加联合匹配条件，切格同步重置状态且失败保持打开

import { useEffect, useMemo, useState } from 'react'
import type { SmartGridConflictClickInfo } from '../canvas/smart-grid'
import { scalarToText } from '../domain/utils'
import type { TableBundle } from '../shared/api-types'
import type { LookupMatchRule, SmartColumn, SmartRecord } from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import { AlertTriangleIcon, PlusIcon, XIcon } from './Icons'

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

  // 当点击了另一个冲突单元格或同单元格规则变化时，同步重置内部表单状态
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

  // 计算浮层贴靠视口位置，防止溢出边界
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
      // 保持浮层打开，错误提示由 Toast 展现
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
      // 保持浮层打开，错误提示由 Toast 展现
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="st-cell-popover-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="st-disambiguate-popover"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="VLOOKUP 重名记录消歧"
      >
        <div className="st-popover-header">
          <div>
            <div className="st-popover-title">
              <AlertTriangleIcon size={14} className="st-warn-icon" />
              <span>检测到重名候选记录</span>
            </div>
            <div className="st-popover-sub">
              关联目标表「{targetBundle?.meta.name ?? conflict.targetTableId}」，共命中{' '}
              {conflict.candidates.length} 条记录，请选择正确的一条：
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

        <div className="st-candidate-list">
          {conflict.candidates.map((candidate: SmartRecord) => {
            const isSelected = conflict.selectedRecordId === candidate._id
            const pkValue = pkField ? candidate[pkField] : candidate._id
            return (
              <button
                key={candidate._id}
                type="button"
                disabled={submitting}
                className={`st-candidate-card ${isSelected ? 'is-selected' : ''}`}
                onClick={() => void handleChoose(candidate._id)}
              >
                <div className="st-candidate-head">
                  <span className="st-candidate-pk">{scalarToText(pkValue) || candidate._id}</span>
                  {isSelected && (
                    <span className="st-tag st-tag-ok">
                      {conflict.isResolved ? '已锁定' : '当前默认'}
                    </span>
                  )}
                </div>
                <div className="st-candidate-fields">
                  {previewCols.map((col) => (
                    <span key={col.key} className="st-candidate-kv">
                      <em>{col.title}:</em> {scalarToText(candidate[col.key]) || '—'}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>

        <div className="st-popover-footer">
          {!showRuleBuilder ? (
            <button
              type="button"
              className="st-btn-link st-inline-flex-btn"
              onClick={() => setShowRuleBuilder(true)}
              disabled={availableSourceCols.length === 0 || availableTargetCols.length === 0}
            >
              <PlusIcon size={12} />
              <span>追加联合匹配条件（彻底避免重名冲突）</span>
            </button>
          ) : (
            <form className="st-rule-append-form" onSubmit={(e) => void handleAddRule(e)}>
              <div className="st-rule-append-row">
                <CustomSelect
                  size="xs"
                  value={sourceField}
                  ariaLabel="选择本表字段"
                  options={availableSourceCols.map((c) => ({
                    value: c.key,
                    label: `本表 · ${c.title}`,
                  }))}
                  onChange={setSourceField}
                />
                <span className="st-eq-sign">=</span>
                <CustomSelect
                  size="xs"
                  value={targetField}
                  ariaLabel="选择目标表字段"
                  options={availableTargetCols.map((c) => ({
                    value: c.key,
                    label: `目标 · ${c.title}`,
                  }))}
                  onChange={setTargetField}
                />
              </div>
              <div className="st-row-actions">
                <button
                  type="submit"
                  className="st-btn st-btn-primary st-btn-xs"
                  disabled={submitting || !sourceField || !targetField}
                >
                  应用联合条件
                </button>
                <button
                  type="button"
                  className="st-btn st-btn-xs"
                  disabled={submitting}
                  onClick={() => setShowRuleBuilder(false)}
                >
                  取消
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
