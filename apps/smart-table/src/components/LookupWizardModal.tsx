// 傻瓜式跨表查找（VLOOKUP）三步向导弹窗：选表与模式 -> 联合匹配条件与实时预览 -> 勾选带出列或汇总指标

import { useMemo, useState } from 'react'
import { createLookupColumnsFromWizard, previewLookupStats } from '../domain/lookup-engine'
import type { TableBundle } from '../shared/api-types'
import type {
  LookupMatchRule,
  LookupMode,
  LookupRollupAgg,
  SmartColumn,
  SmartRecord,
} from '../shared/schema'

export interface LookupWizardModalProps {
  sourceTable: TableBundle
  sourceComputedRecords: readonly SmartRecord[]
  allTables: readonly TableBundle[]
  onClose: () => void
  onSubmitColumns: (newColumns: SmartColumn[]) => Promise<void>
}

interface ReturnSelection {
  field: string
  title: string
  checked: boolean
}

const ROLLUP_AGG_OPTIONS: { value: LookupRollupAgg; label: string }[] = [
  { value: 'sum', label: '求和 (SUM)' },
  { value: 'count', label: '计数 (COUNT)' },
  { value: 'avg', label: '平均值 (AVG)' },
  { value: 'max', label: '最大值 (MAX)' },
  { value: 'min', label: '最小值 (MIN)' },
  { value: 'join', label: '文本拼接 (JOIN)' },
]

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
    const sCol = sourceTable.meta.columns.find((c) => c.type !== 'formula')?.key ?? ''
    const tCol = targetCandidates[0]?.meta.columns[0]?.key ?? ''
    return sCol && tCol ? [{ sourceField: sCol, targetField: tCol }] : []
  })

  const [returnSelections, setReturnSelections] = useState<ReturnSelection[]>([])
  const [rollupField, setRollupField] = useState('')
  const [rollupAgg, setRollupAgg] = useState<LookupRollupAgg>('sum')
  const [rollupTitle, setRollupTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 切换目标表时重置规则和带出候选
  function handleSelectTargetTable(nextId: string) {
    setTargetTableId(nextId)
    const nextBundle = targetCandidates.find((t) => t.meta.id === nextId)
    const sCol = sourceTable.meta.columns.find((c) => c.type !== 'formula')?.key ?? ''
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
        cols.slice(0, 6).map((c, idx) => ({
          field: c.key,
          title: c.title,
          checked: idx === 0,
        })),
      )
    }
    if (!rollupField) {
      const numericCol = cols.find((c) => c.type === 'number' || c.type === 'progress') ?? cols[0]
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
    const sCol = sourceTable.meta.columns.find((c) => c.type !== 'formula')?.key ?? ''
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
    setSubmitting(true)
    try {
      const cols = targetBundle.meta.columns
      const newColumns =
        mode === 'one'
          ? createLookupColumnsFromWizard({
              targetTableId: targetBundle.meta.id,
              matchRules,
              mode: 'one',
              returnFields: returnSelections
                .filter((s) => s.checked)
                .map((s) => {
                  const metaCol = cols.find((c) => c.key === s.field)
                  return {
                    field: s.field,
                    title: s.title.trim() || metaCol?.title || s.field,
                    numberFormat: metaCol?.numberFormat,
                    width: metaCol?.width,
                  }
                }),
            })
          : createLookupColumnsFromWizard({
              targetTableId: targetBundle.meta.id,
              matchRules,
              mode: 'rollup',
              returnFields: [
                {
                  field: rollupField,
                  title: rollupTitle.trim() || '关联汇总',
                  rollupAgg,
                  numberFormat:
                    rollupAgg === 'join'
                      ? undefined
                      : (cols.find((c) => c.key === rollupField)?.numberFormat ?? 'decimal'),
                },
              ],
            })

      if (newColumns.length === 0) return
      await onSubmitColumns(newColumns)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit =
    mode === 'one' ? returnSelections.some((s) => s.checked) : Boolean(rollupField && rollupTitle)

  return (
    <div className="st-modal-backdrop" onClick={onClose}>
      <div
        className="st-modal st-modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="跨表关联查找 (VLOOKUP) 向导"
      >
        <div className="st-modal-header">
          <div>
            <h2 className="st-modal-title">✨ 跨表关联查找（VLOOKUP 向导）</h2>
            <p className="st-modal-sub">无需手写公式，3 步完成跨表信息带出或流水汇总</p>
          </div>
          <button type="button" className="st-icon-btn" onClick={onClose} aria-label="关闭">
            ×
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
                        <span className="st-tag">
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
                    + 追加联合条件
                  </button>
                </div>
                <div className="st-rule-list">
                  {matchRules.map((rule, idx) => (
                    <div key={idx} className="st-match-rule-row">
                      <select
                        className="st-select"
                        value={rule.sourceField}
                        onChange={(e) => updateRule(idx, { sourceField: e.target.value })}
                      >
                        {sourceTable.meta.columns
                          .filter((c) => c.type !== 'formula')
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              本表 · {c.title}
                            </option>
                          ))}
                      </select>
                      <span className="st-eq-sign">=</span>
                      <select
                        className="st-select"
                        value={rule.targetField}
                        onChange={(e) => updateRule(idx, { targetField: e.target.value })}
                      >
                        {(targetBundle?.meta.columns ?? []).map((c) => (
                          <option key={c.key} value={c.key}>
                            {targetBundle?.meta.name} · {c.title}
                          </option>
                        ))}
                      </select>
                      {matchRules.length > 1 && (
                        <button
                          type="button"
                          className="st-btn st-btn-xs"
                          onClick={() => removeRule(idx)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="st-preview-stats">
                <div className="st-stat-item is-ok">
                  ✅ 唯一命中 <strong>{stats.matchedRows}</strong> 行
                </div>
                <div className={`st-stat-item ${stats.conflictRows > 0 ? 'is-warn' : ''}`}>
                  ⚠️ 存在重名/多候选 <strong>{stats.conflictRows}</strong> 行
                </div>
                <div className="st-stat-item">
                  ⬜ 未命中 <strong>{stats.unmatchedRows}</strong> 行
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
              <label className="st-label">
                勾选要从「{targetBundle?.meta.name}」带出的列（同一批次共享消歧锁）
              </label>
              <div className="st-return-list">
                {returnSelections.map((item, idx) => (
                  <div key={item.field} className="st-return-item">
                    <label className="st-checkbox-label">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={(e) =>
                          setReturnSelections((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, checked: e.target.checked } : row,
                            ),
                          )
                        }
                      />
                      <span>{item.field}</span>
                    </label>
                    <input
                      type="text"
                      className="st-input st-input-sm"
                      value={item.title}
                      disabled={!item.checked}
                      placeholder="新列显示名称"
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
            </div>
          ) : (
            <div className="st-form-stack">
              <div className="st-field">
                <label className="st-label">目标表汇总字段</label>
                <select
                  className="st-select"
                  value={rollupField}
                  onChange={(e) => {
                    const nextField = e.target.value
                    setRollupField(nextField)
                    const col = targetBundle?.meta.columns.find((c) => c.key === nextField)
                    if (col) {
                      setRollupTitle(`${col.title}汇总`)
                    }
                  }}
                >
                  {(targetBundle?.meta.columns ?? [])
                    .filter((c) => c.key !== '_id')
                    .map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.title}
                      </option>
                    ))}
                </select>
              </div>
              <div className="st-field">
                <label className="st-label">聚合方式</label>
                <select
                  className="st-select"
                  value={rollupAgg}
                  onChange={(e) => setRollupAgg(e.target.value as LookupRollupAgg)}
                >
                  {ROLLUP_AGG_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
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
          <button type="button" className="st-btn" onClick={onClose}>
            取消
          </button>
          <div className="st-row-actions">
            {step > 1 && (
              <button
                type="button"
                className="st-btn"
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
