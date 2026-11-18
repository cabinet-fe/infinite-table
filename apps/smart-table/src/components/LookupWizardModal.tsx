// 傻瓜式跨表查找（VLOOKUP）三步向导弹窗：选表与模式 -> 联合匹配条件与实时预览 -> 勾选全量带出列或汇总指标

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, Plus, Sparkles, Trash2, X } from 'lucide-react'
import {
  createLookupColumnsFromWizard,
  getEligibleLookupSourceColumns,
  getEligibleLookupTargetColumns,
  previewLookupStats,
} from '../domain/lookup-engine'
import type { TableBundle } from '../shared/api-types'
import {
  mergeSmartColumns,
  type LookupMatchRule,
  type LookupMode,
  type LookupRollupAgg,
  type SmartColumn,
  type SmartColumnType,
  type SmartRecord,
} from '../shared/schema'
import { CustomSelect } from './CustomSelect'

export interface LookupWizardModalProps {
  sourceTable: TableBundle
  derivedColumns?: readonly SmartColumn[]
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
  derivedColumns,
  sourceComputedRecords,
  allTables,
  onClose,
  onSubmitColumns,
}: LookupWizardModalProps) {
  const targetCandidates = allTables.filter((t) => t.meta.id !== sourceTable.meta.id)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [targetTableId, setTargetTableId] = useState(targetCandidates[0]?.meta.id ?? '')
  const [mode, setMode] = useState<LookupMode>('one')

  const effectiveSourceColumns = useMemo(
    () =>
      derivedColumns !== undefined
        ? mergeSmartColumns(sourceTable.meta.columns, derivedColumns)
        : sourceTable.meta.columns,
    [sourceTable.meta.columns, derivedColumns],
  )
  const targetBundle = targetCandidates.find((t) => t.meta.id === targetTableId)
  const targetRawCols = useMemo(
    () => getEligibleLookupTargetColumns(targetBundle?.meta.columns ?? []),
    [targetBundle],
  )
  const eligibleSourceCols = useMemo(
    () => getEligibleLookupSourceColumns(effectiveSourceColumns),
    [effectiveSourceColumns],
  )

  const [matchRules, setMatchRules] = useState<LookupMatchRule[]>(() => {
    const sCol = eligibleSourceCols[0]?.key ?? ''
    const tCol =
      getEligibleLookupTargetColumns(targetCandidates[0]?.meta.columns ?? [])[0]?.key ?? ''
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
    const sCol = eligibleSourceCols[0]?.key ?? ''
    const tCol = getEligibleLookupTargetColumns(nextBundle?.meta.columns ?? [])[0]?.key ?? ''
    setMatchRules(sCol && tCol ? [{ sourceField: sCol, targetField: tCol }] : [])
    setReturnSelections([])
    setRollupField('')
    setRollupTitle('')
  }

  function prepareStep3Defaults() {
    if (!targetBundle) return
    const cols = targetRawCols.filter((c) => c.key !== '_id')
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
    const usedSourceFields = new Set(matchRules.map((r) => r.sourceField))
    const usedTargetFields = new Set(matchRules.map((r) => r.targetField))
    const sCol =
      eligibleSourceCols.find((c) => c.type !== 'lookup' && !usedSourceFields.has(c.key))?.key ??
      eligibleSourceCols.find((c) => !usedSourceFields.has(c.key))?.key ??
      eligibleSourceCols[0]?.key ??
      ''
    const tCol =
      targetRawCols.find((c) => !usedTargetFields.has(c.key))?.key ?? targetRawCols[0]?.key ?? ''
    if (!sCol || !tCol) return
    setMatchRules((prev) => [...prev, { sourceField: sCol, targetField: tCol }])
  }

  function removeRule(idx: number) {
    if (matchRules.length <= 1) return
    setMatchRules((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleFinish() {
    if (!targetBundle || matchRules.length === 0) return
    const cols = targetRawCols
    const existingKeys = effectiveSourceColumns.map((c) => c.key)

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
        existingKeys,
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
        existingKeys,
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
      // 留在向导内
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

  const sourceColOptions = eligibleSourceCols.map((c) => ({
    value: c.key,
    label: `本表 · ${c.title}`,
    hint: TYPE_TAG_MAP[c.type],
  }))

  const targetColOptions = targetRawCols.map((c) => ({
    value: c.key,
    label: `${targetBundle?.meta.name ?? '目标'} · ${c.title}`,
    hint: TYPE_TAG_MAP[c.type],
  }))

  const rollupFieldOptions = targetRawCols
    .filter((c) => c.key !== '_id')
    .map((c) => ({
      value: c.key,
      label: c.title,
      hint: TYPE_TAG_MAP[c.type],
    }))

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[1px]"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="跨表关联查找 (VLOOKUP) 向导"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <span>跨表关联查找（VLOOKUP 向导）</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              无需手写公式，3 步完成跨表信息带出或流水汇总
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-xs">
          {[
            { num: 1, title: '1. 选目标表与模式' },
            { num: 2, title: '2. 匹配条件与预览' },
            { num: 3, title: `3. ${mode === 'one' ? '选择带出字段' : '配置汇总指标'}` },
          ].map((s) => (
            <div
              key={s.num}
              className={`rounded-md px-2.5 py-1.5 text-center font-medium ${
                step === s.num
                  ? 'bg-blue-600 text-white'
                  : step > s.num
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-white text-slate-500'
              }`}
            >
              {s.title}
            </div>
          ))}
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">
          {targetCandidates.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              暂无其他数据表可关联，请先新建或保留至少两张表。
            </div>
          ) : step === 1 ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  要查找哪张表的数据？
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {targetCandidates.map((t) => (
                    <button
                      key={t.meta.id}
                      type="button"
                      onClick={() => handleSelectTargetTable(t.meta.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        targetTableId === t.meta.id
                          ? 'border-blue-500 bg-blue-50/50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-slate-900">
                          {t.meta.name}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            t.meta.kind === 'advanced'
                              ? 'bg-indigo-50 text-indigo-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {t.meta.kind === 'advanced' ? 'SQL 主数据' : '普通表'}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-slate-500">
                        {t.meta.description ||
                          `${t.records.length} 条记录 · ${getEligibleLookupTargetColumns(t.meta.columns).length} 列`}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">关联方式</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setMode('one')}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      mode === 'one'
                        ? 'border-blue-500 bg-blue-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900">一对一查找带出字段</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      如：根据负责人姓名查工号、部门、职级，一次可勾选带出多列，支持重名消歧
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('rollup')}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      mode === 'rollup'
                        ? 'border-blue-500 bg-blue-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900">
                      一对多汇总计算 (Rollup)
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      如：根据项目编号去回款流水表汇总累计回款总额或回款次数
                    </div>
                  </button>
                </div>
              </div>
            </div>
          ) : step === 2 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">
                    匹配条件（多条件按 AND 联合匹配）
                  </label>
                  <button
                    type="button"
                    onClick={addRule}
                    className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3 w-3" />
                    <span>追加联合条件</span>
                  </button>
                </div>
                <div className="space-y-2">
                  {matchRules.map((rule, idx) => (
                    <div
                      key={`${rule.sourceField}-${rule.targetField}-${idx}`}
                      className="flex items-center gap-2"
                    >
                      <CustomSelect
                        size="sm"
                        className="flex-1"
                        value={rule.sourceField}
                        ariaLabel="本表匹配字段"
                        options={sourceColOptions}
                        onChange={(val) => updateRule(idx, { sourceField: val })}
                      />
                      <span className="text-xs font-semibold text-slate-400">=</span>
                      <CustomSelect
                        size="sm"
                        className="flex-1"
                        value={rule.targetField}
                        ariaLabel="目标表匹配字段"
                        options={targetColOptions}
                        onChange={(val) => updateRule(idx, { targetField: val })}
                      />
                      {matchRules.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRule(idx)}
                          aria-label="删除此匹配条件"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs">
                <div className="flex items-center gap-1.5 text-emerald-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>
                    唯一命中 <strong>{stats.matchedRows}</strong> 行
                  </span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    stats.conflictRows > 0 ? 'text-amber-700' : 'text-slate-500'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    多候选 <strong>{stats.conflictRows}</strong> 行
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-500">
                  <Circle className="h-4 w-4 shrink-0" />
                  <span>
                    未命中 <strong>{stats.unmatchedRows}</strong> 行
                  </span>
                </div>
              </div>

              {stats.conflictRows > 0 && mode === 'one' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-800">
                  检测到 {stats.conflictRows} 行命中多个同名候选（如重名员工）。你可以点击上方「+
                  追加联合条件」（如加上部门一致），或者直接完成创建后在单元格右上角点选消歧义。
                </div>
              )}
            </div>
          ) : mode === 'one' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-700">
                  勾选从「{targetBundle?.meta.name}」带出的列（已选 {checkedCount} /{' '}
                  {returnSelections.length} 列）
                </label>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setReturnSelections((prev) => prev.map((r) => ({ ...r, checked: true })))
                    }
                    className="text-blue-600 hover:underline"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setReturnSelections((prev) => prev.map((r) => ({ ...r, checked: false })))
                    }
                    className="text-slate-500 hover:text-slate-800"
                  >
                    清空
                  </button>
                </div>
              </div>
              <div className="max-h-60 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
                {returnSelections.map((item, idx) => (
                  <div
                    key={item.field}
                    className="flex items-center justify-between gap-3 rounded-md bg-white px-2.5 py-1.5 shadow-2xs"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                        checked={item.checked}
                        onChange={(e) =>
                          setReturnSelections((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, checked: e.target.checked } : row,
                            ),
                          )
                        }
                      />
                      <span className="truncate text-xs font-medium text-slate-800">
                        {item.originalTitle}
                      </span>
                      <span className="text-[11px] text-slate-400">{item.field}</span>
                    </label>
                    <input
                      type="text"
                      className={`h-7 w-44 rounded-md border px-2 text-xs text-slate-800 focus:outline-none ${
                        item.checked && !item.title.trim()
                          ? 'border-red-400 bg-red-50/40'
                          : 'border-slate-200 focus:border-blue-500'
                      }`}
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
              <div className="min-h-[16px] text-xs text-red-600">
                {hasEmptyCheckedTitle ? '已勾选项的新列显示名称不能为空' : ''}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">目标表汇总字段</label>
                <CustomSelect
                  className="w-full"
                  value={rollupField}
                  ariaLabel="选择目标表汇总字段"
                  options={rollupFieldOptions}
                  onChange={(nextField) => {
                    setRollupField(nextField)
                    const col = targetRawCols.find((c) => c.key === nextField)
                    if (col) setRollupTitle(`${col.title}汇总`)
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">聚合方式</label>
                <CustomSelect
                  className="w-full"
                  value={rollupAgg}
                  ariaLabel="选择聚合方式"
                  options={ROLLUP_AGG_OPTIONS}
                  onChange={(val) => setRollupAgg(val)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">生成列标题</label>
                <input
                  type="text"
                  className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-[13px] text-slate-800 focus:border-blue-500 focus:outline-none"
                  value={rollupTitle}
                  onChange={(e) => setRollupTitle(e.target.value)}
                  placeholder="例如：累计回款"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            取消
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                上一步
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                disabled={targetCandidates.length === 0 || (step === 2 && matchRules.length === 0)}
                onClick={() => {
                  if (step === 2) prepareStep3Defaults()
                  setStep((s) => (s === 1 ? 2 : 3))
                }}
                className="h-8 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                下一步
              </button>
            ) : (
              <button
                type="button"
                disabled={submitting || !canSubmit}
                onClick={() => void handleFinish()}
                className="h-8 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
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
