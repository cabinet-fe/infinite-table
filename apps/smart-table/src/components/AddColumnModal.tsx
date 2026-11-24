// 新增列弹窗：按分层模式隔离数据源原始列（支持必填/对齐/格式/单选选项）与 SmartApp 公式派生列

import { useEffect, useMemo, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Database, Sigma, X } from 'lucide-react'
import { validateFormulaExpr } from '../domain/formula-column'
import {
  DECIMAL_PLACES_OPTIONS,
  fromDecimalPlacesChoice,
  toDecimalPlacesChoice,
} from '../shared/number-format'
import {
  mergeSmartColumns,
  type CellTextAlign,
  type RawSmartColumnType,
  type SelectOption,
  type SmartColumn,
} from '../shared/schema'
import { SELECT_COLOR_PRESETS } from './CellEditorPopover'
import { CustomSelect } from './CustomSelect'

export const RAW_COLUMN_TYPE_OPTIONS: { value: RawSmartColumnType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数值 / 金额' },
  { value: 'select', label: '单选标签' },
  { value: 'date', label: '日期' },
  { value: 'checkbox', label: '勾选框' },
  { value: 'person', label: '人员' },
  { value: 'progress', label: '进度条 (0-100)' },
  { value: 'image', label: '图片' },
  { value: 'link', label: '超链接' },
]

export const NUMBER_FORMAT_OPTIONS: {
  value: 'integer' | 'decimal' | 'currency' | 'percent'
  label: string
}[] = [
  { value: 'decimal', label: '两位小数 (1,234.56)' },
  { value: 'integer', label: '整数 (1,235)' },
  { value: 'currency', label: '人民币货币 (¥1,234.56)' },
  { value: 'percent', label: '百分比 (85.0%)' },
]

export const COLUMN_ALIGN_OPTIONS: ReadonlyArray<{
  value: CellTextAlign
  label: string
  icon: typeof AlignLeft
}> = [
  { value: 'left', label: '左对齐', icon: AlignLeft },
  { value: 'center', label: '居中对齐', icon: AlignCenter },
  { value: 'right', label: '右对齐', icon: AlignRight },
]

const DEFAULT_SELECT_OPTIONS: SelectOption[] = [
  { label: '待处理', color: '#f2f3f5', textColor: '#4e5969' },
  { label: '进行中', color: '#ebf1ff', textColor: '#1d4ed8' },
  { label: '已完成', color: '#e8ffea', textColor: '#047857' },
]

/** 生成不与既有列冲突的唯一列 key */
function generateUniqueColumnKey(existingColumns: readonly SmartColumn[]): string {
  const used = new Set(existingColumns.map((col) => col.key))
  const base = `col_${Date.now().toString(36).slice(-5)}`
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

/** 单选标签选项与配色编辑器（新增列与字段管理共用） */
export function SelectOptionsEditor({
  options,
  disabled = false,
  onChange,
}: {
  options: readonly SelectOption[]
  disabled?: boolean
  onChange: (nextOptions: SelectOption[]) => void
}) {
  const [newOptionInput, setNewOptionInput] = useState('')

  function handleAddOption() {
    const label = newOptionInput.trim()
    if (!label) return
    if (options.some((o) => o.label === label)) {
      setNewOptionInput('')
      return
    }
    const preset = SELECT_COLOR_PRESETS[options.length % SELECT_COLOR_PRESETS.length]!
    onChange([...options, { label, ...preset }])
    setNewOptionInput('')
  }

  return (
    <div className="space-y-2">
      <div className="st-scroll max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        {options.map((opt, idx) => (
          <div
            key={`${opt.label}-${idx}`}
            className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5"
          >
            <span
              className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: opt.color, color: opt.textColor }}
            >
              {opt.label}
            </span>
            <div className="flex items-center gap-0.5">
              {SELECT_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.color}
                  type="button"
                  disabled={disabled}
                  className={`h-4 w-4 rounded-full border transition-transform ${
                    opt.color === preset.color ? 'scale-110 ring-2 ring-blue-500/40' : ''
                  }`}
                  style={{
                    backgroundColor: preset.color,
                    borderColor: preset.textColor,
                  }}
                  aria-label={`将选项 ${opt.label} 切换为 ${preset.color}`}
                  onClick={() =>
                    onChange(options.map((item, i) => (i === idx ? { ...item, ...preset } : item)))
                  }
                />
              ))}
              {options.length > 1 && (
                <button
                  type="button"
                  disabled={disabled}
                  className="st-icon-btn st-icon-btn-xs st-icon-btn-danger ml-0.5"
                  aria-label={`移除选项 ${opt.label}`}
                  onClick={() => onChange(options.filter((_, i) => i !== idx))}
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
          disabled={disabled}
          className="st-input st-input-sm flex-1"
          placeholder="输入新选项名称"
          value={newOptionInput}
          onChange={(e) => setNewOptionInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddOption()
            }
          }}
        />
        <button
          type="button"
          className="st-btn st-btn-xs st-btn-secondary"
          disabled={disabled || !newOptionInput.trim()}
          onClick={handleAddOption}
        >
          添加选项
        </button>
      </div>
    </div>
  )
}

export interface AddColumnModalProps {
  mode?: 'datasource' | 'app'
  columns: readonly SmartColumn[]
  derivedColumns?: readonly SmartColumn[]
  onClose: () => void
  onSubmit: (column: SmartColumn) => Promise<void>
}

export function AddColumnModal({
  mode = 'datasource',
  columns,
  derivedColumns,
  onClose,
  onSubmit,
}: AddColumnModalProps) {
  const isAppMode = mode === 'app'
  const [colTitle, setColTitle] = useState('')
  const [colType, setColType] = useState<RawSmartColumnType>('text')
  const [colFormat, setColFormat] = useState<'integer' | 'decimal' | 'currency' | 'percent'>(
    'decimal',
  )
  const [decimalPlaces, setDecimalPlaces] = useState<number | undefined>(undefined)
  const [required, setRequired] = useState(false)
  const [align, setAlign] = useState<CellTextAlign | undefined>(undefined)
  const [formulaExpr, setFormulaExpr] = useState('')
  const [selectOptionsDraft, setSelectOptionsDraft] =
    useState<SelectOption[]>(DEFAULT_SELECT_OPTIONS)
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

  const availableFormulaColumns = useMemo(
    () => (derivedColumns !== undefined ? mergeSmartColumns(columns, derivedColumns) : columns),
    [columns, derivedColumns],
  )

  const formulaValidation = useMemo(() => {
    if (!isAppMode) return { valid: true }
    if (!formulaExpr.trim()) {
      return { valid: false, error: '请输入公式，例如：[累计回款] / [合同金额]' }
    }
    return validateFormulaExpr(formulaExpr, columns, undefined, derivedColumns)
  }, [isAppMode, formulaExpr, columns, derivedColumns])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const title = colTitle.trim()
    if (!title) return
    if (isAppMode && !formulaValidation.valid) return
    if (!isAppMode && colType === 'select' && selectOptionsDraft.length === 0) return

    const key = generateUniqueColumnKey(availableFormulaColumns)
    const nextCol: SmartColumn = isAppMode
      ? {
          key,
          title,
          type: 'formula',
          width: 140,
          numberFormat: colFormat,
          ...(decimalPlaces !== undefined ? { decimalPlaces } : {}),
          formulaExpr: formulaExpr.trim(),
        }
      : {
          key,
          title,
          type: colType,
          width: colType === 'number' ? 140 : 130,
          ...(required ? { required: true } : {}),
          ...(align ? { align } : {}),
          ...(colType === 'number' ? { numberFormat: colFormat } : {}),
          ...((colType === 'number' || colType === 'progress') && decimalPlaces !== undefined
            ? { decimalPlaces }
            : {}),
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
    <div className="st-overlay" onClick={() => !submitting && onClose()}>
      <div
        className="st-modal max-w-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={isAppMode ? '新增公式派生列' : '新增原始字段列'}
      >
        <div className="st-modal-header">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              {isAppMode ? <Sigma className="h-5 w-5" /> : <Database className="h-5 w-5" />}
            </div>
            <div>
              <h2 className="st-modal-title">{isAppMode ? '新增公式派生列' : '新增原始字段列'}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {isAppMode
                  ? '基于源表原始列与关联列动态计算，仅作用于本多维数据台'
                  : '定义数据源表的字段结构与录入校验规则'}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="st-icon-btn"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="st-modal-body st-scroll max-h-[70vh] space-y-4">
            <div className="space-y-1.5">
              <label className="st-label" htmlFor="st-add-col-title">
                列标题
              </label>
              <input
                id="st-add-col-title"
                type="text"
                className="st-input"
                value={colTitle}
                onChange={(e) => setColTitle(e.target.value)}
                placeholder={isAppMode ? '例如：回款达成率 / 毛利额' : '例如：客户名称 / 合同金额'}
                autoFocus
              />
            </div>

            {!isAppMode && (
              <>
                <div className="space-y-1.5">
                  <label className="st-label">字段类型</label>
                  <CustomSelect
                    className="w-full"
                    value={colType}
                    ariaLabel="字段类型"
                    options={RAW_COLUMN_TYPE_OPTIONS}
                    onChange={(val) => setColType(val)}
                  />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="st-checkbox"
                      checked={required}
                      onChange={(e) => setRequired(e.target.checked)}
                    />
                    <span>设为必填</span>
                  </label>

                  <div
                    className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white p-0.5"
                    role="group"
                    aria-label="列对齐"
                  >
                    {COLUMN_ALIGN_OPTIONS.map(({ value, label, icon: Icon }) => {
                      const active = align === value
                      return (
                        <button
                          key={value}
                          type="button"
                          title={label}
                          aria-label={label}
                          aria-pressed={active}
                          onClick={() => setAlign(active ? undefined : value)}
                          className={`rounded p-1 transition-colors ${
                            active
                              ? 'bg-blue-50 text-blue-600'
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {(isAppMode || colType === 'number' || colType === 'progress') && (
              <div className="grid grid-cols-2 gap-3">
                {(isAppMode || colType === 'number') && (
                  <div className="space-y-1.5">
                    <label className="st-label">数值显示格式</label>
                    <CustomSelect
                      className="w-full"
                      value={colFormat}
                      ariaLabel="数值显示格式"
                      options={NUMBER_FORMAT_OPTIONS}
                      onChange={(val) => setColFormat(val)}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="st-label">小数位数</label>
                  <CustomSelect
                    className="w-full"
                    value={toDecimalPlacesChoice(decimalPlaces)}
                    ariaLabel="小数位数"
                    options={DECIMAL_PLACES_OPTIONS}
                    onChange={(val) => setDecimalPlaces(fromDecimalPlacesChoice(val))}
                  />
                </div>
              </div>
            )}

            {!isAppMode && colType === 'select' && (
              <div className="space-y-2">
                <label className="st-label">单选标签选项</label>
                <SelectOptionsEditor
                  options={selectOptionsDraft}
                  disabled={submitting}
                  onChange={setSelectOptionsDraft}
                />
              </div>
            )}

            {isAppMode && (
              <div className="space-y-2">
                <label className="st-label" htmlFor="st-formula-expr">
                  公式表达式（支持 [列名] 引用源表及当前应用派生列）
                </label>
                <input
                  id="st-formula-expr"
                  type="text"
                  className="st-input font-mono"
                  value={formulaExpr}
                  onChange={(e) => setFormulaExpr(e.target.value)}
                  placeholder='例如：=[累计回款] / [合同金额] 或 IF([进度]>=100, "已达标", "进行中")'
                />
                <div className="flex flex-wrap gap-1.5">
                  {availableFormulaColumns.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 font-mono text-xs text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      onClick={() => setFormulaExpr((prev) => `${prev}[${c.title}]`)}
                    >
                      [{c.title}]
                    </button>
                  ))}
                </div>
                <div className="min-h-[20px]">
                  {formulaValidation.valid ? (
                    <div className="text-xs text-emerald-600">公式语法校验通过</div>
                  ) : (
                    <div className="st-alert st-alert-red">{formulaValidation.error}</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="st-modal-footer">
            <button
              type="button"
              className="st-btn st-btn-secondary"
              disabled={submitting}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="st-btn st-btn-primary"
              disabled={
                submitting ||
                !colTitle.trim() ||
                (isAppMode && !formulaValidation.valid) ||
                (!isAppMode && colType === 'select' && selectOptionsDraft.length === 0)
              }
            >
              {submitting ? '保存中...' : isAppMode ? '添加公式列' : '添加列'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
