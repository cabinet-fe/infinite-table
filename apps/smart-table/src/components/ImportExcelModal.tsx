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
    <div className="st-overlay" onClick={() => !submitting && onClose()}>
      <div
        className="st-modal max-w-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="导入 Excel / CSV"
      >
        <div className="st-modal-header">
          <div className="min-w-0">
            <h2 className="st-modal-title flex items-center gap-2">
              <Table2 className="h-4 w-4 shrink-0 text-blue-600" />
              <span>导入 Excel / CSV</span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">本地解析，先预览列类型，确认后一键建表</p>
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
                    ? `${preview.totalRows} 行 · ${preview.columns.length} 列 · 点击可重新选择文件`
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
                  支持 .xlsx / .csv，最大 5000 行 × 50 列
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
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{previewError}</span>
            </div>
          )}

          {preview && (
            <>
              <div>
                <label className="st-label" htmlFor="st-import-name">
                  表名
                </label>
                <input
                  id="st-import-name"
                  type="text"
                  className="st-input"
                  value={tableName}
                  disabled={submitting}
                  onChange={(e) => setTableName(e.target.value)}
                />
              </div>

              <div>
                <label className="st-label">存储形态</label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setKind('normal')}
                    className={`st-choice ${kind === 'normal' ? 'st-choice-active' : ''}`}
                  >
                    <div className="text-sm font-medium text-slate-900">普通自建表</div>
                    <div className="st-help mt-1">
                      Excel 式灵活编辑，可自由增删行列、视图与公式列
                    </div>
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setKind('advanced')}
                    className={`st-choice ${kind === 'advanced' ? 'st-choice-active' : ''}`}
                  >
                    <div className="text-sm font-medium text-slate-900">SQL 物理表</div>
                    <div className="st-help mt-1">
                      落库为 SQLite 物理表，首列数据列作为主键，适合作为主数据被跨表引用
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="st-label">列配置（{columns.length} 列）</label>
                <div className="st-scroll max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/50 p-2">
                  {columns.map((column) => (
                    <div key={column.key} className="flex items-center gap-2">
                      <input
                        type="text"
                        className="st-input st-input-sm min-w-0 flex-1"
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
                        className="w-28 shrink-0"
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
                  <span className="st-label-sm mb-0">数据预览</span>
                  <span className="text-xs text-slate-500">
                    共 {preview.totalRows} 行
                    {!preview.truncated && ` · 展示前 ${PREVIEW_DISPLAY_ROWS} 行`}
                  </span>
                </div>
                {preview.truncated && (
                  <div className="st-alert st-alert-amber">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>文件超出 5000 行 × 50 列上限，超出部分不会导入</span>
                  </div>
                )}
                <div className="st-scroll max-h-44 overflow-auto rounded-lg border border-slate-200">
                  <table className="st-table text-xs">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {columns.map((column) => (
                          <th key={column.key} className="st-th px-2">
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, PREVIEW_DISPLAY_ROWS).map((row, rowIndex) => (
                        <tr key={rowIndex} className="hover:bg-slate-50/70">
                          {columns.map((column, colIndex) => (
                            <td
                              key={column.key}
                              className="st-td h-8 max-w-[160px] truncate px-2 text-xs text-slate-700"
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
            disabled={submitting || previewing || !preview || !tableName.trim()}
            onClick={() => void handleImport()}
            className="st-btn st-btn-primary"
          >
            {submitting ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
