// 新增列弹窗（支持普通列、单选标签选项配置与公式计算列）

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { validateFormulaExpr } from '../domain/formula-column'
import type { SelectOption, SmartColumn, SmartColumnType } from '../shared/schema'
import { SELECT_COLOR_PRESETS } from './CellEditorPopover'
import { CustomSelect } from './CustomSelect'

const COLUMN_TYPE_OPTIONS: { value: Exclude<SmartColumnType, 'lookup'>; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数值 / 金额' },
  { value: 'select', label: '单选标签' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '勾选框' },
  { value: 'person', label: '人员' },
  { value: 'progress', label: '进度条 (0-100)' },
  { value: 'image', label: '图片' },
  { value: 'link', label: '超链接' },
  { value: 'formula', label: '计算公式列' },
]

const NUMBER_FORMAT_OPTIONS: {
  value: 'integer' | 'decimal' | 'currency' | 'percent'
  label: string
}[] = [
  { value: 'decimal', label: '两位小数 (1,234.56)' },
  { value: 'integer', label: '整数 (1,235)' },
  { value: 'currency', label: '人民币货币 (¥1,234.56)' },
  { value: 'percent', label: '百分比 (85.0%)' },
]

const DEFAULT_SELECT_OPTIONS: SelectOption[] = [
  { label: '待处理', color: '#f2f3f5', textColor: '#4e5969' },
  { label: '进行中', color: '#ebf1ff', textColor: '#1d4ed8' },
  { label: '已完成', color: '#e8ffea', textColor: '#047857' },
]

export interface AddColumnModalProps {
  columns: readonly SmartColumn[]
  onClose: () => void
  onSubmit: (column: SmartColumn) => Promise<void>
}

export function AddColumnModal({ columns, onClose, onSubmit }: AddColumnModalProps) {
  const [colTitle, setColTitle] = useState('')
  const [colType, setColType] = useState<Exclude<SmartColumnType, 'lookup'>>('text')
  const [colFormat, setColFormat] = useState<'integer' | 'decimal' | 'currency' | 'percent'>(
    'decimal',
  )
  const [formulaExpr, setFormulaExpr] = useState('')
  const [selectOptionsDraft, setSelectOptionsDraft] =
    useState<SelectOption[]>(DEFAULT_SELECT_OPTIONS)
  const [newOptionInput, setNewOptionInput] = useState('')
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

  const formulaValidation = useMemo(() => {
    if (colType !== 'formula') return { valid: true }
    if (!formulaExpr.trim()) {
      return { valid: false, error: '请输入公式，例如：[累计回款] / [合同金额]' }
    }
    return validateFormulaExpr(formulaExpr, columns)
  }, [colType, formulaExpr, columns])

  function handleAddSelectOptionDraft() {
    const label = newOptionInput.trim()
    if (!label) return
    if (selectOptionsDraft.some((o) => o.label === label)) {
      setNewOptionInput('')
      return
    }
    const preset = SELECT_COLOR_PRESETS[selectOptionsDraft.length % SELECT_COLOR_PRESETS.length]!
    setSelectOptionsDraft((prev) => [...prev, { label, ...preset }])
    setNewOptionInput('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const title = colTitle.trim()
    if (!title) return
    if (colType === 'formula' && !formulaValidation.valid) return
    if (colType === 'select' && selectOptionsDraft.length === 0) return

    const key = `col_${Date.now().toString(36).slice(-5)}`
    const nextCol: SmartColumn = {
      key,
      title,
      type: colType,
      width: colType === 'formula' || colType === 'number' ? 140 : 130,
      ...(colType === 'number' || colType === 'formula' ? { numberFormat: colFormat } : {}),
      ...(colType === 'formula' ? { formulaExpr: formulaExpr.trim() } : {}),
      ...(colType === 'select' ? { options: selectOptionsDraft } : {}),
    }

    setSubmitting(true)
    try {
      await onSubmit(nextCol)
      onClose()
    } catch {
      // 保留草稿，错误由 Toast 展现
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[1px]"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="新增字段列"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">新增列（普通列 / 公式列）</h2>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="max-h-[70vh] space-y-3.5 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">列标题</label>
              <input
                type="text"
                className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                value={colTitle}
                onChange={(e) => setColTitle(e.target.value)}
                placeholder="例如：毛利金额 / 回款进度"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">字段类型</label>
              <CustomSelect
                className="w-full"
                value={colType}
                ariaLabel="字段类型"
                options={COLUMN_TYPE_OPTIONS}
                onChange={(val) => setColType(val)}
              />
            </div>

            {(colType === 'number' || colType === 'formula') && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">数值显示格式</label>
                <CustomSelect
                  className="w-full"
                  value={colFormat}
                  ariaLabel="数值显示格式"
                  options={NUMBER_FORMAT_OPTIONS}
                  onChange={(val) => setColFormat(val)}
                />
              </div>
            )}

            {colType === 'select' && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">单选标签选项</label>
                <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
                  {selectOptionsDraft.map((opt, idx) => (
                    <div
                      key={`${opt.label}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5 shadow-2xs"
                    >
                      <span
                        className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: opt.color, color: opt.textColor }}
                      >
                        {opt.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {SELECT_COLOR_PRESETS.map((preset) => (
                          <button
                            key={preset.color}
                            type="button"
                            className={`h-4 w-4 rounded-full border transition-transform ${
                              opt.color === preset.color ? 'scale-110 ring-2 ring-blue-500/40' : ''
                            }`}
                            style={{
                              backgroundColor: preset.color,
                              borderColor: preset.textColor,
                            }}
                            aria-label="切换标签颜色"
                            onClick={() =>
                              setSelectOptionsDraft((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, ...preset } : item)),
                              )
                            }
                          />
                        ))}
                        {selectOptionsDraft.length > 1 && (
                          <button
                            type="button"
                            className="ml-1 rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={`移除选项 ${opt.label}`}
                            onClick={() =>
                              setSelectOptionsDraft((prev) => prev.filter((_, i) => i !== idx))
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="h-7 flex-1 rounded-md border border-slate-200 px-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                    placeholder="输入新选项名称后按添加..."
                    value={newOptionInput}
                    onChange={(e) => setNewOptionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddSelectOptionDraft()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    disabled={!newOptionInput.trim()}
                    onClick={handleAddSelectOptionDraft}
                  >
                    添加选项
                  </button>
                </div>
              </div>
            )}

            {colType === 'formula' && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  公式表达式（支持 [列名] 引用同表字段）
                </label>
                <input
                  type="text"
                  className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                  value={formulaExpr}
                  onChange={(e) => setFormulaExpr(e.target.value)}
                  placeholder='例如：=[累计回款] / [合同金额] 或 IF([进度]>=100, "已达标", "进行中")'
                />
                <div className="flex flex-wrap gap-1.5">
                  {columns.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      onClick={() => setFormulaExpr((prev) => `${prev}[${c.title}]`)}
                    >
                      [{c.title}]
                    </button>
                  ))}
                </div>
                <div
                  className={`min-h-[18px] text-xs ${
                    formulaValidation.valid ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {formulaValidation.valid ? '公式语法校验通过' : formulaValidation.error}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <button
              type="button"
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="h-8 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              disabled={
                submitting ||
                !colTitle.trim() ||
                (colType === 'formula' && !formulaValidation.valid) ||
                (colType === 'select' && selectOptionsDraft.length === 0)
              }
            >
              {submitting ? '保存中...' : '添加列'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
