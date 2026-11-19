// 独立数据录入端单行详情表单抽屉：支持新建与编辑原始字段，展示必填星标并执行单源校验与就地高亮提示

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Save, X } from 'lucide-react'
import { isEmptyCellValue, scalarToText, toFiniteNumber } from '../domain/utils'
import { validateRecordForCreate } from '../shared/record-validation'
import { filterRawColumns, type SmartColumn, type SmartRecord } from '../shared/schema'
import { CustomSelect } from './CustomSelect'

export interface EntryRecordFormProps {
  mode: 'create' | 'edit'
  record?: SmartRecord | null
  columns: readonly SmartColumn[]
  busy?: boolean
  resetKey?: string | number
  resetOnSuccess?: boolean
  submitLabel?: string
  cancelLabel?: string
  onCancel?: () => void
  onSubmit: (values: Record<string, unknown>, recordId?: string) => Promise<void>
  className?: string
  fieldsClassName?: string
  footerClassName?: string
}

export interface EntryRecordDrawerProps {
  open: boolean
  mode: 'create' | 'edit'
  record?: SmartRecord | null
  columns: readonly SmartColumn[]
  busy?: boolean
  onClose: () => void
  onSubmit: (values: Record<string, unknown>, recordId?: string) => Promise<void>
}

function extractLinkUrl(val: unknown): string {
  if (val && typeof val === 'object' && 'url' in val) {
    return scalarToText((val as { url?: unknown }).url).trim()
  }
  return scalarToText(val).trim()
}

function buildInitialDrafts(
  columns: readonly SmartColumn[],
  record?: SmartRecord | null,
): Record<string, unknown> {
  const drafts: Record<string, unknown> = {}
  for (const col of columns) {
    const val = record?.[col.key]
    if (col.type === 'checkbox') {
      drafts[col.key] = Boolean(val)
    } else if (col.type === 'link') {
      drafts[col.key] = extractLinkUrl(val)
    } else if (col.type === 'number' || col.type === 'progress') {
      const num = toFiniteNumber(val)
      drafts[col.key] = num !== null ? String(num) : ''
    } else {
      drafts[col.key] = isEmptyCellValue(val) ? '' : scalarToText(val)
    }
  }
  return drafts
}

function buildCandidateRecord(
  columns: readonly SmartColumn[],
  drafts: Readonly<Record<string, unknown>>,
  existingRecord?: SmartRecord | null,
): Record<string, unknown> {
  const candidate: Record<string, unknown> = {}
  for (const col of columns) {
    const rawDraft = drafts[col.key]
    if (col.type === 'checkbox') {
      candidate[col.key] = Boolean(rawDraft)
      continue
    }
    if (col.type === 'number' || col.type === 'progress') {
      const str = typeof rawDraft === 'string' ? rawDraft.trim() : scalarToText(rawDraft).trim()
      candidate[col.key] = str === '' ? null : str
      continue
    }
    if (col.type === 'link') {
      const url = typeof rawDraft === 'string' ? rawDraft.trim() : scalarToText(rawDraft).trim()
      const prevVal = existingRecord?.[col.key]
      if (
        prevVal &&
        typeof prevVal === 'object' &&
        'text' in prevVal &&
        typeof (prevVal as { text?: unknown }).text === 'string' &&
        url !== ''
      ) {
        candidate[col.key] = { url, text: (prevVal as { text: string }).text }
      } else {
        candidate[col.key] = url
      }
      continue
    }
    candidate[col.key] = typeof rawDraft === 'string' ? rawDraft : scalarToText(rawDraft)
  }
  return candidate
}

const TYPE_HINTS: Record<string, string> = {
  text: '文本',
  number: '数值',
  date: '日期',
  select: '单选',
  checkbox: '勾选',
  person: '人员',
  progress: '进度',
  image: '图片',
  link: '链接',
}

/** 可复用的原始字段录入/编辑表单（支持必填标星、单源类型校验与就地高亮提示） */
export function EntryRecordForm({
  mode,
  record = null,
  columns,
  busy = false,
  resetKey,
  resetOnSuccess = false,
  submitLabel,
  cancelLabel = '取消',
  onCancel,
  onSubmit,
  className = 'flex min-h-0 flex-1 flex-col',
  fieldsClassName = 'flex-1 space-y-3.5 overflow-y-auto px-5 py-4',
  footerClassName = 'flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3',
}: EntryRecordFormProps) {
  const rawColumns = useMemo(() => filterRawColumns(columns), [columns])
  const [drafts, setDrafts] = useState<Record<string, unknown>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const recordIdentity = mode === 'edit' ? (record?._id ?? '') : '__create__'
  useEffect(() => {
    setDrafts(buildInitialDrafts(rawColumns, mode === 'edit' ? record : null))
    setFieldErrors({})
    setSubmitError(null)
  }, [resetKey, mode, recordIdentity, record, rawColumns])

  const disabled = busy || submitting

  function updateField(key: string, value: unknown) {
    setDrafts((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setSubmitError(null)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (disabled) return

    const candidate = buildCandidateRecord(rawColumns, drafts, mode === 'edit' ? record : null)
    const validation = validateRecordForCreate(rawColumns, candidate)
    if (!validation.valid) {
      const nextErrors: Record<string, string> = {}
      for (const err of validation.errors) {
        if (!nextErrors[err.field]) {
          nextErrors[err.field] = err.message
        }
      }
      setFieldErrors(nextErrors)
      setSubmitError(`请修正 ${validation.errors.length} 处表单校验错误后再提交`)
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      await onSubmit(validation.record, mode === 'edit' ? record?._id : undefined)
      if (resetOnSuccess) {
        setDrafts(buildInitialDrafts(rawColumns, null))
        setFieldErrors({})
        setSubmitError(null)
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '提交失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const resolvedSubmitLabel = submitLabel ?? (mode === 'create' ? '提交录入' : '保存修改')

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className={className}>
      <div className={fieldsClassName}>
        {submitError && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        {rawColumns.map((col) => {
          const errMsg = fieldErrors[col.key]
          const hasErr = Boolean(errMsg)
          const inputBorderClass = hasErr
            ? 'border-red-400 bg-red-50/40 focus:border-red-500'
            : 'border-slate-200 bg-white focus:border-blue-500'
          const inputId = `st-entry-field-${col.key}`

          return (
            <div
              key={col.key}
              data-field-key={col.key}
              data-field-error={hasErr ? 'true' : undefined}
              className="space-y-1"
            >
              <div className="flex items-center justify-between text-xs">
                <label htmlFor={inputId} className="font-medium text-slate-700">
                  <span>{col.title}</span>
                  {col.required && (
                    <span className="ml-0.5 text-red-500" aria-label="必填">
                      *
                    </span>
                  )}
                </label>
                <span className="text-[10px] text-slate-400">
                  {TYPE_HINTS[col.type] ?? col.type}
                </span>
              </div>

              {col.type === 'select' && col.options && col.options.length > 0 ? (
                <div className={hasErr ? 'rounded-md ring-1 ring-red-400' : ''}>
                  <CustomSelect
                    size="sm"
                    className="w-full"
                    value={scalarToText(drafts[col.key])}
                    ariaLabel={col.title}
                    disabled={disabled}
                    options={[
                      { value: '', label: '(未设置)' },
                      ...col.options.map((opt) => ({ value: opt.label, label: opt.label })),
                    ]}
                    onChange={(val) => updateField(col.key, val)}
                  />
                </div>
              ) : col.type === 'checkbox' ? (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-700">
                  <input
                    id={inputId}
                    type="checkbox"
                    disabled={disabled}
                    aria-invalid={hasErr || undefined}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    checked={Boolean(drafts[col.key])}
                    onChange={(e) => updateField(col.key, e.target.checked)}
                  />
                  <span>{drafts[col.key] ? '是' : '否'}</span>
                </label>
              ) : col.type === 'progress' ? (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    disabled={disabled}
                    value={Number(drafts[col.key] || 0)}
                    onChange={(e) => updateField(col.key, e.target.value)}
                    className="flex-1 accent-blue-600"
                  />
                  <input
                    id={inputId}
                    type="number"
                    min={0}
                    max={100}
                    disabled={disabled}
                    aria-label={col.title}
                    aria-invalid={hasErr || undefined}
                    value={scalarToText(drafts[col.key])}
                    onChange={(e) => updateField(col.key, e.target.value)}
                    className={`h-8 w-16 rounded-md border px-2 text-right text-xs text-slate-800 focus:outline-none ${inputBorderClass}`}
                  />
                  <span className="text-xs text-slate-500">%</span>
                </div>
              ) : col.type === 'number' ? (
                <input
                  id={inputId}
                  type="text"
                  inputMode="decimal"
                  disabled={disabled}
                  aria-label={col.title}
                  aria-invalid={hasErr || undefined}
                  placeholder="输入数值"
                  value={scalarToText(drafts[col.key])}
                  onChange={(e) => updateField(col.key, e.target.value)}
                  className={`h-8 w-full rounded-md border px-2.5 text-xs text-slate-800 focus:outline-none ${inputBorderClass}`}
                />
              ) : col.type === 'date' ? (
                <input
                  id={inputId}
                  type="date"
                  disabled={disabled}
                  aria-label={col.title}
                  aria-invalid={hasErr || undefined}
                  value={scalarToText(drafts[col.key])}
                  onChange={(e) => updateField(col.key, e.target.value)}
                  className={`h-8 w-full rounded-md border px-2.5 text-xs text-slate-800 focus:outline-none ${inputBorderClass}`}
                />
              ) : col.type === 'image' ? (
                <div className="space-y-1.5">
                  <input
                    id={inputId}
                    type="text"
                    disabled={disabled}
                    aria-label={col.title}
                    aria-invalid={hasErr || undefined}
                    placeholder="输入图片地址 (URL)"
                    value={scalarToText(drafts[col.key])}
                    onChange={(e) => updateField(col.key, e.target.value)}
                    className={`h-8 w-full rounded-md border px-2.5 text-xs text-slate-800 focus:outline-none ${inputBorderClass}`}
                  />
                  {scalarToText(drafts[col.key]).trim() !== '' && (
                    <div className="rounded-md border border-slate-100 bg-slate-50 p-1.5">
                      <img
                        src={scalarToText(drafts[col.key]).trim()}
                        alt={col.title}
                        className="h-12 rounded object-contain"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <input
                  id={inputId}
                  type="text"
                  disabled={disabled}
                  aria-label={col.title}
                  aria-invalid={hasErr || undefined}
                  placeholder={
                    col.type === 'link'
                      ? '输入链接地址 (https://...)'
                      : col.type === 'person'
                        ? '输入人员姓名'
                        : `输入${col.title}`
                  }
                  value={scalarToText(drafts[col.key])}
                  onChange={(e) => updateField(col.key, e.target.value)}
                  className={`h-8 w-full rounded-md border px-2.5 text-xs text-slate-800 focus:outline-none ${inputBorderClass}`}
                />
              )}

              {hasErr && (
                <p role="alert" className="text-[11px] text-red-600">
                  {errMsg}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className={footerClassName}>
        {onCancel && (
          <button
            type="button"
            disabled={disabled}
            onClick={onCancel}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          <span>{submitting ? '提交中...' : resolvedSubmitLabel}</span>
        </button>
      </div>
    </form>
  )
}

export function EntryRecordDrawer({
  open,
  mode,
  record = null,
  columns,
  busy = false,
  onClose,
  onSubmit,
}: EntryRecordDrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[1050] flex justify-end bg-slate-900/30"
      onClick={() => !busy && onClose()}
    >
      <aside
        className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={mode === 'create' ? '新建录入记录' : '编辑记录详情'}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  mode === 'create' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                }`}
              >
                {mode === 'create' ? '表单录入' : '编辑详情'}
              </span>
              {mode === 'edit' && record && (
                <span className="truncate font-mono text-[11px] text-slate-400">{record._id}</span>
              )}
            </div>
            <h2 className="mt-1 truncate text-sm font-semibold text-slate-900">
              {mode === 'create' ? '新增数据记录' : '编辑记录详情'}
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="关闭表单抽屉"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <EntryRecordForm
          mode={mode}
          record={record}
          columns={columns}
          busy={busy}
          resetKey={open ? `open-${mode}-${record?._id ?? 'new'}` : 'closed'}
          onCancel={onClose}
          onSubmit={async (values, recordId) => {
            await onSubmit(values, recordId)
            onClose()
          }}
        />
      </aside>
    </div>
  )
}
