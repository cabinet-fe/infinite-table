// 追加导入弹窗：向已有 normal 数据源表追加 Excel/CSV 记录，支持表头自动匹配、手动切换列映射（含跳过导入）、
// 提交前全量必填/类型校验、错误行整批拦截高亮及服务端行级错误展示。

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react'
import type { BatchImportRowError, ImportPreviewResponse } from '../shared/api-types'
import {
  buildMappedImportRecords,
  matchImportColumns,
  parseImportFile,
  type ImportColumnMapping,
} from '../shared/import-parse'
import { validateBatchRecords } from '../shared/record-validation'
import { filterRawColumns, type SmartColumn } from '../shared/schema'
import { CustomSelect, type CustomSelectOption } from './CustomSelect'

const SKIP_IMPORT_VALUE = '__skip__'
const PREVIEW_ROW_LIMIT = 50

export interface AppendImportModalProps {
  tableName: string
  columns: readonly SmartColumn[]
  onClose: () => void
  onSubmitBatch: (records: Record<string, unknown>[]) => Promise<void>
}

/** 更新单条导入列映射的目标字段（null 表示跳过导入） */
export function updateImportColumnMapping(
  mappings: readonly ImportColumnMapping[],
  sourceIndex: number,
  targetField: string | null,
): ImportColumnMapping[] {
  return mappings.map((item) =>
    item.sourceIndex === sourceIndex ? { ...item, targetField } : item,
  )
}

/** 从异常对象中提取批导入错误消息与行级错误明细 */
export function extractBatchImportErrors(error: unknown): {
  message: string
  errors: BatchImportRowError[]
} {
  const fallbackMsg = error instanceof Error ? error.message : '追加导入失败'
  if (typeof error !== 'object' || error === null) {
    return { message: fallbackMsg, errors: [] }
  }
  const rawErrors = (error as { errors?: unknown }).errors
  if (!Array.isArray(rawErrors)) {
    return { message: fallbackMsg, errors: [] }
  }
  const errors = rawErrors.filter(
    (item): item is BatchImportRowError =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as BatchImportRowError).rowIndex === 'number' &&
      typeof (item as BatchImportRowError).field === 'string' &&
      typeof (item as BatchImportRowError).message === 'string',
  )
  return { message: fallbackMsg, errors }
}

export function AppendImportModal({
  tableName,
  columns,
  onClose,
  onSubmitBatch,
}: AppendImportModalProps) {
  const rawTargetColumns = useMemo(() => filterRawColumns(columns), [columns])
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [mappings, setMappings] = useState<ImportColumnMapping[]>([])
  const [serverErrors, setServerErrors] = useState<BatchImportRowError[]>([])
  const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [onlyShowErrorRows, setOnlyShowErrorRows] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  async function loadFile(file: File) {
    setFileName(file.name)
    setPreview(null)
    setMappings([])
    setPreviewError(null)
    setServerErrors([])
    setSubmitErrorMsg(null)
    setOnlyShowErrorRows(false)
    setPreviewing(true)
    try {
      const data = await parseImportFile(file)
      setPreview(data)
      setMappings(matchImportColumns(data.columns, rawTargetColumns))
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : '文件解析失败')
    } finally {
      setPreviewing(false)
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void loadFile(file)
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragActive(false)
    if (submitting || previewing) return
    const file = event.dataTransfer.files?.[0]
    if (file) void loadFile(file)
  }

  const mappedRecords = useMemo(() => {
    if (!preview) return []
    return buildMappedImportRecords(mappings, rawTargetColumns, preview.rows)
  }, [preview, mappings, rawTargetColumns])

  const clientValidation = useMemo(() => {
    if (!preview) {
      return {
        valid: true,
        records: [] as Record<string, unknown>[],
        errors: [] as BatchImportRowError[],
      }
    }
    return validateBatchRecords(rawTargetColumns, mappedRecords)
  }, [preview, rawTargetColumns, mappedRecords])

  const activeErrors = serverErrors.length > 0 ? serverErrors : clientValidation.errors

  const errorsByRow = useMemo(() => {
    const map = new Map<number, BatchImportRowError[]>()
    for (const err of activeErrors) {
      const list = map.get(err.rowIndex)
      if (list) list.push(err)
      else map.set(err.rowIndex, [err])
    }
    return map
  }, [activeErrors])

  const targetSelectOptions = useMemo<CustomSelectOption<string>[]>(
    () => [
      { value: SKIP_IMPORT_VALUE, label: '跳过导入' },
      ...rawTargetColumns.map((col) => ({
        value: col.key,
        label: col.required ? `${col.title} *` : col.title,
        hint: col.type,
      })),
    ],
    [rawTargetColumns],
  )

  const mappedTargetKeys = useMemo(
    () => new Set(mappings.map((m) => m.targetField).filter((v): v is string => v !== null)),
    [mappings],
  )

  const missingRequiredColumns = useMemo(
    () => rawTargetColumns.filter((col) => col.required && !mappedTargetKeys.has(col.key)),
    [rawTargetColumns, mappedTargetKeys],
  )

  const visibleRowIndices = useMemo(() => {
    if (!preview) return []
    const total = preview.rows.length
    if (onlyShowErrorRows) {
      return Array.from(errorsByRow.keys()).sort((a, b) => a - b)
    }
    if (total <= PREVIEW_ROW_LIMIT) {
      return Array.from({ length: total }, (_, idx) => idx)
    }
    const baseSet = new Set<number>()
    for (let i = 0; i < 20; i++) baseSet.add(i)
    for (const errIdx of errorsByRow.keys()) baseSet.add(errIdx)
    return Array.from(baseSet).sort((a, b) => a - b)
  }, [preview, onlyShowErrorRows, errorsByRow])

  async function handleSubmit() {
    if (!preview || preview.rows.length === 0 || submitting) return
    setServerErrors([])
    setSubmitErrorMsg(null)

    const validation = validateBatchRecords(rawTargetColumns, mappedRecords)
    if (!validation.valid) {
      setSubmitErrorMsg(
        `共发现 ${validation.errors.length} 处校验错误（涉及 ${errorsByRow.size} 行），已阻止本次批量提交`,
      )
      return
    }

    setSubmitting(true)
    try {
      await onSubmitBatch(validation.records)
      onClose()
    } catch (error) {
      const extracted = extractBatchImportErrors(error)
      setServerErrors(extracted.errors)
      setSubmitErrorMsg(extracted.message)
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
        aria-label={`向 ${tableName} 追加导入 Excel / CSV`}
      >
        <div className="st-modal-header">
          <div className="min-w-0">
            <h2 className="st-modal-title flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-blue-600" />
              <span className="truncate">批量追加导入（{tableName}）</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">本地解析，逐行校验通过后批量写入</p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="关闭"
            className="st-icon-btn"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="st-modal-body st-scroll max-h-[70vh] space-y-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="点击选择或拖拽 Excel / CSV 文件到此处"
            onClick={() => !submitting && !previewing && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (!submitting && !previewing) setDragActive(true)
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-center transition-colors ${
              dragActive
                ? 'border-blue-400 bg-blue-50/40'
                : fileName
                  ? 'border-blue-200 bg-blue-50/30'
                  : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            {fileName ? (
              <>
                <FileSpreadsheet className="h-6 w-6 shrink-0 text-blue-600" />
                <div
                  className="max-w-full truncate px-6 text-sm font-medium text-slate-700"
                  title={fileName}
                >
                  {fileName}
                </div>
                <div className="px-6 text-xs text-slate-500">
                  {preview
                    ? `${preview.totalRows} 行数据 · ${preview.columns.length} 列 · 点击可重新选择文件`
                    : previewing
                      ? '正在本地解析...'
                      : '解析失败，点击重新选择'}
                </div>
              </>
            ) : (
              <>
                <Upload className="h-6 w-6 shrink-0 text-slate-400" />
                <div className="text-sm text-slate-600">拖拽文件到此处，或点击选择</div>
                <div className="text-xs text-slate-500">
                  支持 .xlsx / .csv，自动按表头匹配已有列
                </div>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            disabled={previewing || submitting}
            onChange={handleFileChange}
          />
          {previewError && (
            <div role="alert" className="st-alert st-alert-red">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{previewError}</span>
            </div>
          )}

          {preview && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="st-label-sm mb-0">字段映射（导入列 → 目标列）</span>
                  <span className="text-xs text-slate-500">
                    已映射 {mappedTargetKeys.size} / {rawTargetColumns.length} 个目标列
                  </span>
                </div>
                <div className="st-scroll max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
                  {mappings.map((mapping) => (
                    <div
                      key={mapping.sourceIndex}
                      className="flex items-center justify-between gap-3 rounded-md bg-white px-2.5 py-1.5 shadow-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-800">
                          {mapping.sourceLabel}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          样例：{preview.rows[0]?.[mapping.sourceIndex] || '(空)'}
                        </div>
                      </div>
                      <span className="text-xs text-slate-400">→</span>
                      <CustomSelect
                        size="sm"
                        className="w-44 shrink-0"
                        value={mapping.targetField ?? SKIP_IMPORT_VALUE}
                        ariaLabel={`导入列 ${mapping.sourceLabel} 映射目标`}
                        options={targetSelectOptions}
                        disabled={submitting}
                        onChange={(val) => {
                          const nextTarget = val === SKIP_IMPORT_VALUE ? null : val
                          setMappings((prev) =>
                            updateImportColumnMapping(prev, mapping.sourceIndex, nextTarget),
                          )
                          setServerErrors([])
                          setSubmitErrorMsg(null)
                        }}
                      />
                    </div>
                  ))}
                </div>
                {missingRequiredColumns.length > 0 && (
                  <div className="st-alert st-alert-amber">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      以下必填字段尚未映射：
                      {missingRequiredColumns.map((c) => c.title).join('、')}
                    </span>
                  </div>
                )}
              </div>

              {preview.truncated && (
                <div className="st-alert st-alert-amber">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>文件超出 5000 行 × 50 列上限，超出部分不会导入</span>
                </div>
              )}

              {(activeErrors.length > 0 || submitErrorMsg) && (
                <div role="alert" className="st-alert st-alert-red">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="font-medium">
                      {submitErrorMsg ??
                        `校验未通过：共 ${activeErrors.length} 处错误（涉及 ${errorsByRow.size} 行），请修正后提交`}
                    </div>
                    {activeErrors.length > 0 && (
                      <ul className="st-scroll max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4">
                        {activeErrors.slice(0, 20).map((err, idx) => (
                          <li key={`${err.rowIndex}-${err.field}-${idx}`}>
                            第 {err.rowIndex + 1} 行 [{err.columnTitle}]：{err.message}
                          </li>
                        ))}
                        {activeErrors.length > 20 && (
                          <li>
                            另有 {activeErrors.length - 20} 条错误，请在下方预览表中查看高亮行
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {activeErrors.length === 0 && preview.rows.length > 0 && (
                <div className="st-alert st-alert-slate">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>全量 {preview.rows.length} 行校验通过，可确认追加导入</span>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="st-label-sm mb-0">
                    校验预览（共 {preview.rows.length} 行
                    {errorsByRow.size > 0 ? ` · ${errorsByRow.size} 行异常` : ''}）
                  </span>
                  {errorsByRow.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setOnlyShowErrorRows((v) => !v)}
                      className="text-xs font-medium text-blue-600 hover:underline"
                    >
                      {onlyShowErrorRows ? '显示全部预览' : `仅看异常行 (${errorsByRow.size})`}
                    </button>
                  )}
                </div>

                <div className="st-scroll max-h-52 overflow-auto rounded-lg border border-slate-200">
                  <table className="st-table text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        <th className="st-th px-2">行号</th>
                        {mappings
                          .filter((m) => m.targetField !== null)
                          .map((mapping) => {
                            const targetCol = rawTargetColumns.find(
                              (c) => c.key === mapping.targetField,
                            )
                            return (
                              <th key={mapping.sourceIndex} className="st-th px-2">
                                {targetCol?.title ?? mapping.targetField}
                                {targetCol?.required && (
                                  <span className="ml-0.5 text-red-500">*</span>
                                )}
                              </th>
                            )
                          })}
                        <th className="st-th px-2">校验结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRowIndices.map((rowIndex) => {
                        const row = preview.rows[rowIndex] ?? []
                        const rowErrors = errorsByRow.get(rowIndex) ?? []
                        const hasRowErr = rowErrors.length > 0
                        const errFields = new Set(rowErrors.map((e) => e.field))

                        return (
                          <tr
                            key={rowIndex}
                            data-row-index={rowIndex}
                            data-row-error={hasRowErr ? 'true' : undefined}
                            className={
                              hasRowErr ? 'bg-red-50/80 text-red-900' : 'hover:bg-slate-50/70'
                            }
                          >
                            <td className="st-td h-8 px-2 font-mono text-xs text-slate-500">
                              {rowIndex + 1}
                            </td>
                            {mappings
                              .filter((m) => m.targetField !== null)
                              .map((mapping) => {
                                const cellErr =
                                  mapping.targetField !== null && errFields.has(mapping.targetField)
                                return (
                                  <td
                                    key={mapping.sourceIndex}
                                    className={`st-td h-8 max-w-[150px] truncate px-2 text-xs ${
                                      cellErr ? 'bg-red-100/80 font-medium text-red-700' : ''
                                    }`}
                                  >
                                    {row[mapping.sourceIndex] ?? ''}
                                  </td>
                                )
                              })}
                            <td className="st-td h-8 px-2 text-xs">
                              {hasRowErr ? (
                                <span className="font-medium text-red-600">
                                  {rowErrors
                                    .map((e) => `${e.columnTitle}: ${e.message}`)
                                    .join('；')}
                                </span>
                              ) : (
                                <span className="text-emerald-600">通过</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="st-modal-footer">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="st-btn st-btn-secondary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting || previewing || !preview || preview.rows.length === 0}
            onClick={() => void handleSubmit()}
            className="st-btn st-btn-primary"
          >
            {submitting
              ? '导入中...'
              : preview
                ? `确认追加导入 (${preview.rows.length} 行)`
                : '确认追加导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
