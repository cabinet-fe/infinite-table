// Excel/CSV 导入弹窗：浏览器端解析（hucre）即预览（表名/列推断/数据样例）→ 可编辑列配置后建表落库。
// 普通表走既有建表 API 携带初始行一次落库；SQL 物理表走导入提交端点。

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, Table2, Upload, X } from 'lucide-react'
import { createTable, importCommit } from '../api'
import { buildImportRecords, parseImportFile } from '../shared/import-parse'
import type {
  ImportColumnType,
  ImportPreviewColumn,
  ImportPreviewResponse,
  TableBundle,
} from '../shared/api-types'
import type { TableKind } from '../shared/schema'
import { CustomSelect } from './CustomSelect'

const IMPORT_TYPE_OPTIONS: { value: ImportColumnType; label: string }[] = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数值' },
  { value: 'date', label: '日期' },
]

/** 数据预览展示行数（preview.rows 为全量数据，仅取前几行渲染） */
const PREVIEW_DISPLAY_ROWS = 8

/** 列配置编辑：按 key 更新 label/type（key 保持稳定，重命名不产生标识符冲突） */
export function updateImportColumn(
  columns: readonly ImportPreviewColumn[],
  key: string,
  patch: Partial<Pick<ImportPreviewColumn, 'label' | 'type'>>,
): ImportPreviewColumn[] {
  return columns.map((column) => (column.key === key ? { ...column, ...patch } : column))
}

export interface ImportExcelModalProps {
  onClose: () => void
  onImported: (bundle: TableBundle) => void
  onError: (message: string) => void
}

export function ImportExcelModal({ onClose, onImported, onError }: ImportExcelModalProps) {
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [tableName, setTableName] = useState('')
  const [kind, setKind] = useState<TableKind>('normal')
  const [columns, setColumns] = useState<ImportPreviewColumn[]>([])
  const [submitting, setSubmitting] = useState(false)
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
    setColumns([])
    setPreviewError(null)
    setPreviewing(true)
    try {
      const data = await parseImportFile(file)
      setPreview(data)
      setTableName(data.suggestedName)
      setColumns(data.columns)
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

  async function handleImport() {
    if (!preview) return
    setSubmitting(true)
    try {
      const bundle =
        kind === 'normal'
          ? await createTable({
              name: tableName.trim(),
              columns: columns.map((column) => ({
                key: column.key,
                title: column.label,
                type: column.type,
                width: 140,
              })),
              records: buildImportRecords(columns, preview.rows),
            })
          : await importCommit({
              kind,
              tableName: tableName.trim(),
              columns,
              rows: preview.rows,
            })
      onImported(bundle)
    } catch (error) {
      onError(error instanceof Error ? error.message : '导入失败')
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
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="导入 Excel / CSV"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Table2 className="h-4 w-4 text-blue-600" />
              <span>导入 Excel / CSV</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              文件在浏览器本地解析，先预览列类型，确认后一键建表
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

        <div className="max-h-[72vh] space-y-4 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">
              选择文件（.xlsx / .csv，支持拖拽）
            </label>
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
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-4 transition-colors ${
                dragActive
                  ? 'border-blue-500 bg-blue-50/70'
                  : fileName
                    ? 'border-blue-200 bg-blue-50/30'
                    : 'border-slate-200 bg-slate-50/60 hover:border-slate-300'
              }`}
            >
              {fileName ? (
                <>
                  <FileSpreadsheet className="h-6 w-6 shrink-0 text-blue-600" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-slate-800" title={fileName}>
                      {fileName}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {preview
                        ? `${preview.totalRows} 行 · ${preview.columns.length} 列 · 点击可重新选择文件`
                        : previewing
                          ? '正在本地解析...'
                          : '解析失败，点击重新选择'}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-slate-700">
                      拖拽文件到此处，或点击选择
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      支持 .xlsx / .csv，最大 5000 行 × 50 列，文件不会上传服务器
                    </div>
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
              onChange={(e) => handleFileChange(e)}
            />
            {previewError && <div className="text-xs text-red-600">{previewError}</div>}
          </div>

          {preview && (
            <>
              <div className="space-y-1.5">
                <label
                  className="block text-xs font-medium text-slate-700"
                  htmlFor="st-import-name"
                >
                  表名
                </label>
                <input
                  id="st-import-name"
                  type="text"
                  className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-[13px] text-slate-800 focus:border-blue-500 focus:outline-none"
                  value={tableName}
                  disabled={submitting}
                  onChange={(e) => setTableName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">存储形态</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setKind('normal')}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      kind === 'normal'
                        ? 'border-blue-500 bg-blue-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900">普通自建表</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Excel 式灵活编辑，可自由增删行列、视图与公式列
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setKind('advanced')}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      kind === 'advanced'
                        ? 'border-blue-500 bg-blue-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900">SQL 物理表</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      落库为 SQLite 物理表，首列数据列作为主键，适合作为主数据被跨表引用
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  列配置（{columns.length} 列）
                </label>
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
                  {columns.map((column) => (
                    <div key={column.key} className="flex items-center gap-2">
                      <input
                        type="text"
                        className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                        value={column.label}
                        aria-label={`列「${column.label}」标题`}
                        disabled={submitting}
                        onChange={(e) =>
                          setColumns((prev) =>
                            updateImportColumn(prev, column.key, { label: e.target.value }),
                          )
                        }
                      />
                      <CustomSelect
                        value={column.type}
                        options={IMPORT_TYPE_OPTIONS}
                        size="sm"
                        className="w-28"
                        ariaLabel={`列「${column.label}」类型`}
                        disabled={submitting}
                        onChange={(type) =>
                          setColumns((prev) => updateImportColumn(prev, column.key, { type }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">数据预览</label>
                  <span className="text-[11px] text-slate-500">
                    共 {preview.totalRows} 行
                    {!preview.truncated && ` · 展示前 ${PREVIEW_DISPLAY_ROWS} 行`}
                  </span>
                </div>
                {preview.truncated && (
                  <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>文件超出 5000 行 × 50 列上限，超出部分不会导入</span>
                  </div>
                )}
                <div className="max-h-44 overflow-auto rounded-lg border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-slate-600">
                      <tr>
                        {columns.map((column) => (
                          <th
                            key={column.key}
                            className="border-b border-r border-slate-200 px-2.5 py-1.5 font-medium last:border-r-0"
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.rows.slice(0, PREVIEW_DISPLAY_ROWS).map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-slate-50/70">
                          {columns.map((column, colIndex) => (
                            <td
                              key={column.key}
                              className="max-w-[160px] truncate border-r border-slate-100 px-2.5 py-1.5 text-slate-700 last:border-r-0"
                            >
                              {row[colIndex] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting || previewing || !preview || !tableName.trim()}
            onClick={() => void handleImport()}
            className="h-8 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {submitting ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
