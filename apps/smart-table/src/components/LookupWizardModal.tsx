// 傻瓜式跨表查找（VLOOKUP）三步向导弹窗：选表与模式 -> 联合匹配条件与实时预览 -> 勾选全量带出列或汇总指标

import { useEffect, useMemo, useState } from 'react'
import { createLookupColumnsFromWizard, previewLookupStats } from '../domain/lookup-engine'
import type { TableBundle } from '../shared/api-types'
import type {
  LookupMatchRule,
  LookupMode,
  LookupRollupAgg,
  SmartColumn,
  SmartColumnType,
  SmartRecord,
} from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CircleIcon,
  PlusIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from './Icons'

export interface LookupWizardModalProps {
  sourceTable: TableBundle
  sourceComputedRecords: readonly SmartRecord[]
  allTables: readonly TableBundle[]
  onClose: () => void
  onSubmitColumns: (newColumns: SmartColumn[]) => Promise<void>
}

interface ReturnSelection {
  field: string
  originalTitle: string
  title: string
  checked: boolean
}

/** Rollup 聚合方式选项（向导与关联管理弹窗共用） */
export const ROLLUP_AGG_OPTIONS: { value: LookupRollupAgg; label: string }[] = [
  { value: 'sum', label: '求和 (SUM)' },
  { value: 'count', label: '计数 (COUNT)' },
  { value: 'avg', label: '平均值 (AVG)' },
  { value: 'max', label: '最大值 (MAX)' },
  { value: 'min', label: '最小值 (MIN)' },
  { value: 'join', label: '文本拼接 (JOIN)' },
]

const TYPE_TAG_MAP: Record<SmartColumnType, string> = {
  text: '文本',
  number: '数值',
  select: '单选',
  date: '日期',
  checkbox: '勾选',
  person: '人员',
  progress: '进度',
  image: '图片',
  link: '链接',
  lookup: '关联列',
  formula: '计算列',
}

export function LookupWizardModal({
  sourceTable,
  sourceComputedRecords,
  allTables,
  onClose,
  onSubmitColumns,
}: LookupWizardModalProps) {
  const targetCandidates = allTables.filter((t) => t.meta.id !== sourceTable.meta.id)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [targetTableId, setTargetTableId] = useState(targetCandidates[0]?.meta.id ?? '')
  const [mode, setMode] = useState<LookupMode>('one')

  const targetBundle = targetCandidates.find((t) => t.meta.id === targetTableId)

  const [matchRules, setMatchRules] = useState<LookupMatchRule[]>(() => {
    const sCol = sourceTable.meta.columns[0]?.key ?? ''
    const tCol = targetCandidates[0]?.meta.columns[0]?.key ?? ''
    return sCol && tCol ? [{ sourceField: sCol, targetField: tCol }] : []
  })

  const [returnSelections, setReturnSelections] = useState<ReturnSelection[]>([])
  const [rollupField, setRollupField] = useState('')
  const [rollupAgg, setRollupAgg] = useState<LookupRollupAgg>('sum')
  const [rollupTitle, setRollupTitle] = useState('')
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

  function handleSelectTargetTable(nextId: string) {
    setTargetTableId(nextId)
    const nextBundle = targetCandidates.find((t) => t.meta.id === nextId)
    const sCol = sourceTable.meta.columns[0]?.key ?? ''
    const tCol = nextBundle?.meta.columns[0]?.key ?? ''
    setMatchRules(sCol && tCol ? [{ sourceField: sCol, targetField: tCol }] : [])
    setReturnSelections([])
    setRollupField('')
    setRollupTitle('')
  }

  function prepareStep3Defaults() {
    if (!targetBundle) return
    const cols = targetBundle.meta.columns.filter((c) => c.key !== '_id')
    if (returnSelections.length === 0) {
      setReturnSelections(
        cols.map((c, idx) => ({
          field: c.key,
          originalTitle: c.title,
          title: c.title,
          checked: idx === 0,
        })),
      )
    }
    if (!rollupField) {
      const numericCol =
        cols.find((c) => c.type === 'number' || c.type === 'progress' || c.type === 'formula') ??
        cols[0]
      if (numericCol) {
        setRollupField(numericCol.key)
        setRollupTitle(`${numericCol.title}汇总`)
      }
    }
  }

  const stats = useMemo(() => {
    if (!targetBundle) {
      return { matchedRows: 0, conflictRows: 0, unmatchedRows: sourceComputedRecords.length }
    }
    return previewLookupStats(sourceComputedRecords, targetBundle.records, matchRules)
  }, [sourceComputedRecords, targetBundle, matchRules])

  function updateRule(idx: number, patch: Partial<LookupMatchRule>) {
    setMatchRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function addRule() {
    const sCol = sourceTable.meta.columns[0]?.key ?? ''
    const tCol = targetBundle?.meta.columns[0]?.key ?? ''
    if (!sCol || !tCol) return
    setMatchRules((prev) => [...prev, { sourceField: sCol, targetField: tCol }])
  }

  function removeRule(idx: number) {
    if (matchRules.length <= 1) return
    setMatchRules((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleFinish() {
    if (!targetBundle || matchRules.length === 0) return
    const cols = targetBundle.meta.columns

    let newColumns: SmartColumn[] = []
    if (mode === 'one') {
      const checkedItems = returnSelections.filter((s) => s.checked)
      if (checkedItems.length === 0 || checkedItems.some((s) => s.title.trim() === '')) {
        return
      }
      newColumns = createLookupColumnsFromWizard({
        targetTableId: targetBundle.meta.id,
        matchRules,
        mode: 'one',
        returnFields: checkedItems.map((s) => {
          const metaCol = cols.find((c) => c.key === s.field)
          return {
            field: s.field,
            title: s.title.trim(),
            numberFormat: metaCol?.numberFormat,
            width: metaCol?.width,
          }
        }),
      })
    } else {
      const trimmedTitle = rollupTitle.trim()
      if (!rollupField || !trimmedTitle) {
        return
      }
      const numberFormat =
        rollupAgg === 'count'
          ? 'integer'
          : rollupAgg === 'join'
            ? undefined
            : (cols.find((c) => c.key === rollupField)?.numberFormat ?? 'decimal')

      newColumns = createLookupColumnsFromWizard({
        targetTableId: targetBundle.meta.id,
        matchRules,
        mode: 'rollup',
        returnFields: [
          {
            field: rollupField,
            title: trimmedTitle,
            rollupAgg,
            numberFormat,
          },
        ],
      })
    }

    if (newColumns.length === 0) return
    setSubmitting(true)
    try {
      await onSubmitColumns(newColumns)
      onClose()
    } catch {
      // 提交失败留在向导内，错误由 Toast 展现
    } finally {
      setSubmitting(false)
    }
  }

  const checkedCount = returnSelections.filter((s) => s.checked).length
  const hasEmptyCheckedTitle = returnSelections.some((s) => s.checked && s.title.trim() === '')
  const canSubmit =
    mode === 'one'
      ? checkedCount > 0 && !hasEmptyCheckedTitle
      : Boolean(rollupField && rollupTitle.trim())

  const sourceColOptions = sourceTable.meta.columns.map((c) => ({
    value: c.key,
    label: `本表 · ${c.title}`,
    hint: TYPE_TAG_MAP[c.type],
  }))

  const targetColOptions = (targetBundle?.meta.columns ?? []).map((c) => ({
    value: c.key,
    label: `${targetBundle?.meta.name ?? '目标'} · ${c.title}`,
    hint: TYPE_TAG_MAP[c.type],
  }))

  const rollupFieldOptions = (targetBundle?.meta.columns ?? [])
    .filter((c) => c.key !== '_id')
    .map((c) => ({
      value: c.key,
      label: c.title,
      hint: TYPE_TAG_MAP[c.type],
    }))

  return (
    <div className="st-modal-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="st-modal st-modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="跨表关联查找 (VLOOKUP) 向导"
      >
        <div className="st-modal-header">
          <div>
            <h2 className="st-modal-title st-title-with-icon">
              <SparklesIcon size={16} className="st-primary-icon" />
              <span>跨表关联查找（VLOOKUP 向导）</span>
            </h2>
            <p className="st-modal-sub">无需手写公式，3 步完成跨表信息带出或流水汇总</p>
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

        <div className="st-wizard-steps">
          <span className={`st-step ${step === 1 ? 'is-active' : step > 1 ? 'is-done' : ''}`}>
            1. 选目标表与模式
          </span>
          <span className={`st-step ${step === 2 ? 'is-active' : step > 2 ? 'is-done' : ''}`}>
            2. 匹配条件与预览
          </span>
          <span className={`st-step ${step === 3 ? 'is-active' : ''}`}>
            3. {mode === 'one' ? '选择带出字段' : '配置汇总指标'}
          </span>
        </div>

        <div className="st-modal-body">
          {targetCandidates.length === 0 ? (
            <div className="st-empty-state">暂无其他数据表可关联，请先新建或保留至少两张表。</div>
          ) : step === 1 ? (
            <div className="st-form-stack">
              <div className="st-field">
                <label className="st-label">要查找哪张表的数据？</label>
                <div className="st-card-grid">
                  {targetCandidates.map((t) => (
                    <button
                      key={t.meta.id}
                      type="button"
                      className={`st-choice-card ${targetTableId === t.meta.id ? 'is-selected' : ''}`}
                      onClick={() => handleSelectTargetTable(t.meta.id)}
                    >
                      <div className="st-choice-title">
                        <span>{t.meta.name}</span>
                        <span
                          className={`st-tag ${t.meta.kind === 'advanced' ? 'st-tag-sql' : ''}`}
                        >
                          {t.meta.kind === 'advanced' ? 'SQL 主数据' : '普通表'}
                        </span>
                      </div>
                      <div className="st-choice-desc">
                        {t.meta.description ||
                          `${t.records.length} 条记录 · ${t.meta.columns.length} 列`}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="st-field">
                <label className="st-label">关联方式</label>
                <div className="st-card-grid">
                  <button
                    type="button"
                    className={`st-choice-card ${mode === 'one' ? 'is-selected' : ''}`}
                    onClick={() => setMode('one')}
                  >
                    <div className="st-choice-title">一对一查找带出字段</div>
                    <div className="st-choice-desc">
                      如：根据负责人姓名查工号、部门、职级，一次可勾选带出多列，支持重名消歧
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`st-choice-card ${mode === 'rollup' ? 'is-selected' : ''}`}
                    onClick={() => setMode('rollup')}
                  >
                    <div className="st-choice-title">一对多汇总计算 (Rollup)</div>
                    <div className="st-choice-desc">
                      如：根据项目编号去回款流水表汇总累计回款总额或回款次数
                    </div>
                  </button>
                </div>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="st-form-stack">
              <div className="st-field">
                <div className="st-field-head">
                  <label className="st-label">匹配条件（多条件按 AND 联合匹配）</label>
                  <button type="button" className="st-btn st-btn-xs" onClick={addRule}>
                    <PlusIcon size={12} />
                    <span>追加联合条件</span>
                  </button>
                </div>
                <div className="st-rule-list">
                  {matchRules.map((rule, idx) => (
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
                        onChange={(val) => updateRule(idx, { sourceField: val })}
                      />
                      <span className="st-eq-sign">=</span>
                      <CustomSelect
                        size="sm"
                        className="st-flex-1"
                        value={rule.targetField}
                        ariaLabel="目标表匹配字段"
                        options={targetColOptions}
                        onChange={(val) => updateRule(idx, { targetField: val })}
                      />
                      {matchRules.length > 1 && (
                        <button
                          type="button"
                          className="st-icon-btn st-icon-danger"
                          onClick={() => removeRule(idx)}
                          aria-label="删除此匹配条件"
                          title="删除"
                        >
                          <TrashIcon size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="st-preview-stats">
                <div className="st-stat-item is-ok">
                  <CheckCircleIcon size={14} />
                  <span>
                    唯一命中 <strong>{stats.matchedRows}</strong> 行
                  </span>
                </div>
                <div className={`st-stat-item ${stats.conflictRows > 0 ? 'is-warn' : ''}`}>
                  <AlertTriangleIcon size={14} />
                  <span>
                    存在重名/多候选 <strong>{stats.conflictRows}</strong> 行
                  </span>
                </div>
                <div className="st-stat-item">
                  <CircleIcon size={14} />
                  <span>
                    未命中 <strong>{stats.unmatchedRows}</strong> 行
                  </span>
                </div>
              </div>

              {stats.conflictRows > 0 && mode === 'one' && (
                <div className="st-tip-box">
                  检测到 {stats.conflictRows} 行命中多个同名候选（如重名员工）。你可以点击上方「+
                  追加联合条件」（如加上部门一致），或者直接完成创建后在单元格右上角点选消歧义。
                </div>
              )}
            </div>
          ) : mode === 'one' ? (
            <div className="st-form-stack">
              <div className="st-field-head">
                <label className="st-label">
                  勾选从「{targetBundle?.meta.name}」带出的列（已选 {checkedCount} /{' '}
                  {returnSelections.length} 列）
                </label>
                <div className="st-row-actions">
                  <button
                    type="button"
                    className="st-btn-link"
                    onClick={() =>
                      setReturnSelections((prev) => prev.map((r) => ({ ...r, checked: true })))
                    }
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="st-btn-link"
                    onClick={() =>
                      setReturnSelections((prev) => prev.map((r) => ({ ...r, checked: false })))
                    }
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="st-return-list">
                {returnSelections.map((item, idx) => (
                  <div key={item.field} className="st-return-item">
                    <label className="st-checkbox-label st-return-check">
                      <input
                        type="checkbox"
                        className="st-checkbox"
                        checked={item.checked}
                        onChange={(e) =>
                          setReturnSelections((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, checked: e.target.checked } : row,
                            ),
                          )
                        }
                      />
                      <span className="st-return-col-meta">
                        <span className="st-return-col-title">{item.originalTitle}</span>
                        <span className="st-key-hint">{item.field}</span>
                      </span>
                    </label>
                    <input
                      type="text"
                      className={`st-input st-input-sm ${item.checked && !item.title.trim() ? 'is-invalid' : ''}`}
                      value={item.title}
                      disabled={!item.checked}
                      placeholder="新列显示名称（必填）"
                      onChange={(e) =>
                        setReturnSelections((prev) =>
                          prev.map((row, i) =>
                            i === idx ? { ...row, title: e.target.value } : row,
                          ),
                        )
                      }
                    />
                  </div>
                ))}
              </div>
              <div className={`st-fixed-msg ${hasEmptyCheckedTitle ? 'is-err' : ''}`}>
                {hasEmptyCheckedTitle ? '已勾选项的新列显示名称不能为空' : ''}
              </div>
            </div>
          ) : (
            <div className="st-form-stack">
              <div className="st-field">
                <label className="st-label">目标表汇总字段</label>
                <CustomSelect
                  value={rollupField}
                  ariaLabel="选择目标表汇总字段"
                  options={rollupFieldOptions}
                  onChange={(nextField) => {
                    setRollupField(nextField)
                    const col = targetBundle?.meta.columns.find((c) => c.key === nextField)
                    if (col) {
                      setRollupTitle(`${col.title}汇总`)
                    }
                  }}
                />
              </div>
              <div className="st-field">
                <label className="st-label">聚合方式</label>
                <CustomSelect
                  value={rollupAgg}
                  ariaLabel="选择聚合方式"
                  options={ROLLUP_AGG_OPTIONS}
                  onChange={(val) => setRollupAgg(val)}
                />
              </div>
              <div className="st-field">
                <label className="st-label">生成列标题</label>
                <input
                  type="text"
                  className="st-input"
                  value={rollupTitle}
                  onChange={(e) => setRollupTitle(e.target.value)}
                  placeholder="例如：累计回款"
                />
              </div>
            </div>
          )}
        </div>

        <div className="st-modal-footer">
          <button type="button" className="st-btn" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <div className="st-row-actions">
            {step > 1 && (
              <button
                type="button"
                className="st-btn"
                disabled={submitting}
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
              >
                上一步
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                className="st-btn st-btn-primary"
                disabled={targetCandidates.length === 0 || (step === 2 && matchRules.length === 0)}
                onClick={() => {
                  if (step === 2) {
                    prepareStep3Defaults()
                  }
                  setStep((s) => (s === 1 ? 2 : 3))
                }}
              >
                下一步
              </button>
            ) : (
              <button
                type="button"
                className="st-btn st-btn-primary"
                disabled={submitting || !canSubmit}
                onClick={() => void handleFinish()}
              >
                {submitting ? '生成中...' : '完成并添加列'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
