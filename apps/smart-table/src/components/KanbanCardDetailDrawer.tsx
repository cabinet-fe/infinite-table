// 看板卡片详情抽屉：展示单条记录全字段详情；运维态支持编辑可写字段并持久化，用户查看态严格只读。

import { useEffect, useState } from 'react'
import { ExternalLink, Lock, Save, X } from 'lucide-react'
import { formatSmartCellDisplayValue } from '../canvas/smart-grid'
import { isEmptyCellValue, scalarToText, toFiniteNumber } from '../domain/utils'
import type { SmartColumn, SmartRecord } from '../shared/schema'
import { CustomSelect } from './CustomSelect'

export interface KanbanCardDetailDrawerProps {
  record: SmartRecord | null
  columns: readonly SmartColumn[]
  readonly: boolean
  primaryKeyField?: string
  onClose: () => void
  onSaveRecord: (recordId: string, patch: Record<string, unknown>) => Promise<void>
}

function extractLinkUrl(val: unknown): string {
  if (val && typeof val === 'object' && 'url' in val) {
    return scalarToText((val as { url?: unknown }).url).trim()
  }
  return scalarToText(val).trim()
}

function toDraftMap(record: SmartRecord, columns: readonly SmartColumn[]): Record<string, unknown> {
  const drafts: Record<string, unknown> = {}
  for (const col of columns) {
    const val = record[col.key]
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

export function KanbanCardDetailDrawer({
  record,
  columns,
  readonly,
  primaryKeyField,
  onClose,
  onSaveRecord,
}: KanbanCardDetailDrawerProps) {
  const [drafts, setDrafts] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!record) return
    setDrafts(toDraftMap(record, columns))
  }, [record, columns])

  useEffect(() => {
    if (!record) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [record, saving, onClose])

  if (!record) {
    return null
  }

  const titleCol =
    columns.find((c) => c.type === 'text' && !c.isUniqueKey) ??
    columns.find((c) => c.type === 'text') ??
    columns[0]
  const drawerTitle =
    titleCol && !isEmptyCellValue(record[titleCol.key])
      ? scalarToText(record[titleCol.key])
      : record._id

  function isFieldEditable(col: SmartColumn): boolean {
    if (readonly) return false
    if (col.type === 'lookup' || col.type === 'formula') return false
    if (primaryKeyField && col.key === primaryKeyField) return false
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!record || readonly) return

    const patch: Record<string, unknown> = {}
    for (const col of columns) {
      if (!isFieldEditable(col)) continue
      const nextRaw = drafts[col.key]
      const prevRaw = record[col.key]

      if (col.type === 'checkbox') {
        const nextBool = Boolean(nextRaw)
        if (nextBool !== Boolean(prevRaw)) {
          patch[col.key] = nextBool
        }
      } else if (col.type === 'number' || col.type === 'progress') {
        const str = typeof nextRaw === 'string' ? nextRaw.trim() : ''
        const nextNum = str === '' ? null : Number(str)
        if (nextNum !== null && !Number.isFinite(nextNum)) continue
        const clamped =
          col.type === 'progress' && nextNum !== null
            ? Math.max(0, Math.min(100, nextNum))
            : nextNum
        const prevNum = toFiniteNumber(prevRaw)
        if (clamped !== prevNum) {
          patch[col.key] = clamped
        }
      } else if (col.type === 'link') {
        const str = typeof nextRaw === 'string' ? nextRaw.trim() : ''
        const prevUrl = extractLinkUrl(prevRaw)
        if (str !== prevUrl) {
          if (
            prevRaw &&
            typeof prevRaw === 'object' &&
            'text' in prevRaw &&
            typeof (prevRaw as { text?: unknown }).text === 'string' &&
            str !== ''
          ) {
            patch[col.key] = { url: str, text: (prevRaw as { text: string }).text }
          } else {
            patch[col.key] = str
          }
        }
      } else {
        const str = typeof nextRaw === 'string' ? nextRaw : scalarToText(nextRaw)
        const prevStr = isEmptyCellValue(prevRaw) ? '' : scalarToText(prevRaw)
        if (str !== prevStr) {
          patch[col.key] = str
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }

    setSaving(true)
    try {
      await onSaveRecord(record._id, patch)
      onClose()
    } catch {
      // 错误提示由上层 Toast 展示
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex justify-end bg-slate-900/30"
      onClick={() => !saving && onClose()}
    >
      <aside
        className="flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="卡片详情"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                {readonly ? '只读详情' : '编辑卡片'}
              </span>
              <span className="truncate font-mono text-[11px] text-slate-400">{record._id}</span>
            </div>
            <h2 className="mt-1 truncate text-sm font-semibold text-slate-900">{drawerTitle}</h2>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="关闭卡片详情"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
            {columns.map((col) => {
              const editable = isFieldEditable(col)
              const rawVal = record[col.key]
              const displayStr = formatSmartCellDisplayValue(col, rawVal)

              return (
                <div key={col.key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-medium text-slate-700">{col.title}</label>
                    {(col.type === 'lookup' || col.type === 'formula') && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                        <Lock className="h-2.5 w-2.5" />
                        <span>{col.type === 'lookup' ? '跨表关联' : '公式计算'}</span>
                      </span>
                    )}
                    {primaryKeyField === col.key && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500">
                        <Lock className="h-2.5 w-2.5" />
                        <span>业务主键</span>
                      </span>
                    )}
                  </div>

                  {!editable ? (
                    <ReadOnlyFieldValue col={col} rawVal={rawVal} displayStr={displayStr} />
                  ) : col.type === 'select' && col.options && col.options.length > 0 ? (
                    <CustomSelect
                      size="sm"
                      className="w-full"
                      value={scalarToText(drafts[col.key])}
                      ariaLabel={col.title}
                      options={[
                        { value: '', label: '(未设置)' },
                        ...col.options.map((opt) => ({ value: opt.label, label: opt.label })),
                      ]}
                      onChange={(val) => setDrafts((prev) => ({ ...prev, [col.key]: val }))}
                    />
                  ) : col.type === 'checkbox' ? (
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        checked={Boolean(drafts[col.key])}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [col.key]: e.target.checked }))
                        }
                      />
                      <span>{drafts[col.key] ? '是' : '否'}</span>
                    </label>
                  ) : col.type === 'progress' ? (
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Number(drafts[col.key] || 0)}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [col.key]: e.target.value }))
                        }
                        className="flex-1 accent-blue-600"
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        aria-label={col.title}
                        value={scalarToText(drafts[col.key])}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [col.key]: e.target.value }))
                        }
                        className="h-8 w-16 rounded-md border border-slate-200 px-2 text-right text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">%</span>
                    </div>
                  ) : col.type === 'number' ? (
                    <input
                      type="number"
                      step="any"
                      aria-label={col.title}
                      value={scalarToText(drafts[col.key])}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [col.key]: e.target.value }))
                      }
                      className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                    />
                  ) : col.type === 'date' ? (
                    <input
                      type="date"
                      aria-label={col.title}
                      value={scalarToText(drafts[col.key])}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [col.key]: e.target.value }))
                      }
                      className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                    />
                  ) : (
                    <input
                      type="text"
                      aria-label={col.title}
                      value={scalarToText(drafts[col.key])}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [col.key]: e.target.value }))
                      }
                      className="h-8 w-full rounded-md border border-slate-200 px-2.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                    />
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {readonly ? '关闭' : '取消'}
            </button>
            {!readonly && (
              <button
                type="submit"
                disabled={saving}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? '保存中...' : '保存修改'}</span>
              </button>
            )}
          </div>
        </form>
      </aside>
    </div>
  )
}

function ReadOnlyFieldValue({
  col,
  rawVal,
  displayStr,
}: {
  col: SmartColumn
  rawVal: unknown
  displayStr: string
}) {
  if (col.type === 'select' && col.options) {
    const label = scalarToText(rawVal).trim()
    const opt = col.options.find((o) => o.label === label)
    if (opt) {
      return (
        <div className="py-0.5">
          <span
            className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: opt.color, color: opt.textColor }}
          >
            {opt.label}
          </span>
        </div>
      )
    }
  }

  if (col.type === 'progress') {
    const num = Math.max(0, Math.min(100, Math.round(toFiniteNumber(rawVal) ?? 0)))
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-blue-600" style={{ width: `${num}%` }} />
        </div>
        <span className="text-xs font-medium text-slate-700">{num}%</span>
      </div>
    )
  }

  if (col.type === 'link') {
    const url = extractLinkUrl(rawVal)
    if (url) {
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs text-blue-600 hover:underline"
        >
          <span className="truncate">{displayStr || url}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      )
    }
  }

  if (col.type === 'image') {
    const src = scalarToText(rawVal).trim()
    if (src) {
      return (
        <div className="rounded-md border border-slate-100 bg-slate-50 p-2">
          <img src={src} alt={col.title} className="h-14 rounded object-contain" />
        </div>
      )
    }
  }

  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">
      {displayStr || '-'}
    </div>
  )
}
