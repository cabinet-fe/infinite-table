// Excel/CSV 导入弹窗：浏览器端解析（hucre）即预览（表名/列推断/数据样例）→ 可编辑列配置后建表落库。
// 普通表走既有建表 API 携带初始行一次落库；SQL 物理表走导入提交端点。

import { useEffect, useRef, useState } from 'react'
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
import { AlertTriangleIcon, FileIcon, TableIcon, UploadIcon, XIcon } from './Icons'

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
  /** commit 成功：返回建好的表捆绑数据，由 App 刷新列表并切换激活 */
  onImported: (bundle: TableBundle) => void
  /** commit 失败：错误消息走 Toast */
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
    <div className="st-modal-backdrop" onClick={() => !submitting && onClose()}>
      <div
        className="st-modal st-modal-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="导入 Excel / CSV"
      >
        <div className="st-modal-header">
          <div>
            <h2 className="st-modal-title st-title-with-icon">
              <TableIcon size={16} className="st-primary-icon" />
              <span>导入 Excel / CSV</span>
            </h2>
            <p className="st-modal-sub">文件在浏览器本地解析，先预览列类型，确认后一键建表</p>
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

        <div className="st-modal-body">
          <div className="st-form-stack">
            <div className="st-field">
              <label className="st-label">选择文件（.xlsx / .csv，支持拖拽）</label>
              <div
                role="button"
                tabIndex={0}
                aria-label="点击选择或拖拽 Excel / CSV 文件到此处"
                className={`st-import-dropzone ${dragActive ? 'is-active' : ''} ${fileName ? 'has-file' : ''}`}
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
              >
                {fileName ? (
                  <>
                    <FileIcon size={20} className="st-import-file-icon" />
                    <div className="st-import-file-meta">
                      <div className="st-import-file-name" title={fileName}>
                        {fileName}
                      </div>
                      <div className="st-import-file-sub">
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
                    <UploadIcon size={20} className="st-import-file-icon" />
                    <div className="st-import-file-meta">
                      <div className="st-import-file-name">拖拽文件到此处，或点击选择</div>
                      <div className="st-import-file-sub">
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
                className="st-import-file-hidden"
                disabled={previewing || submitting}
                onChange={(e) => handleFileChange(e)}
              />
              {previewError && <div className="st-fixed-msg is-err">{previewError}</div>}
            </div>

            {preview && (
              <>
                <div className="st-field">
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

                <div className="st-field">
                  <label className="st-label">存储形态</label>
                  <div className="st-card-grid">
                    <button
                      type="button"
                      className={`st-choice-card ${kind === 'normal' ? 'is-selected' : ''}`}
                      disabled={submitting}
                      onClick={() => setKind('normal')}
                    >
                      <div className="st-choice-title">普通自建表</div>
                      <div className="st-choice-desc">
                        Excel 式灵活编辑，可自由增删行列、视图与公式列
                      </div>
                    </button>
                    <button
                      type="button"
                      className={`st-choice-card ${kind === 'advanced' ? 'is-selected' : ''}`}
                      disabled={submitting}
                      onClick={() => setKind('advanced')}
                    >
                      <div className="st-choice-title">SQL 物理表</div>
                      <div className="st-choice-desc">
                        落库为 SQLite 物理表，首列数据列作为主键，适合作为主数据被跨表引用
                      </div>
                    </button>
                  </div>
                </div>

                <div className="st-field">
                  <label className="st-label">列配置（{columns.length} 列）</label>
                  <div className="st-import-columns">
                    {columns.map((column) => (
                      <div key={column.key} className="st-import-column-row">
                        <input
                          type="text"
                          className="st-input st-input-sm"
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

                <div className="st-field">
                  <div className="st-field-head">
                    <label className="st-label">数据预览</label>
                    <span className="st-import-meta">
                      共 {preview.totalRows} 行
                      {!preview.truncated && ` · 展示前 ${PREVIEW_DISPLAY_ROWS} 行`}
                    </span>
                  </div>
                  {preview.truncated && (
                    <div className="st-import-truncated">
                      <AlertTriangleIcon size={13} className="st-warn-icon" />
                      文件超出 5000 行 × 50 列上限，超出部分不会导入
                    </div>
                  )}
                  <div className="st-import-preview-wrap">
                    <table className="st-import-preview">
                      <thead>
                        <tr>
                          {columns.map((column) => (
                            <th key={column.key}>{column.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, PREVIEW_DISPLAY_ROWS).map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {columns.map((column, colIndex) => (
                              <td key={column.key}>{row[colIndex] ?? ''}</td>
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
        </div>

        <div className="st-modal-footer">
          <button type="button" className="st-btn" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="st-btn st-btn-primary"
            disabled={submitting || previewing || !preview || !tableName.trim()}
            onClick={() => void handleImport()}
          >
            {submitting ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  )
}
