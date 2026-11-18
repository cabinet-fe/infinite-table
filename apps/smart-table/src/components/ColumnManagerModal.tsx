// 字段管理弹窗：管理数据源表列定义（重命名、删除非主键自定义列、快捷进入关联列设置）

import { useEffect, useState } from 'react'
import { Lock, Settings, Trash2, X } from 'lucide-react'
import type { SmartColumn, TableKind } from '../shared/schema'
import { ConfirmModal } from './ConfirmModal'

export interface ColumnManagerModalProps {
  tableKind: TableKind
  primaryKeyField?: string
  columns: readonly SmartColumn[]
  busy?: boolean
  onClose: () => void
  onRenameColumn: (columnKey: string, nextTitle: string) => Promise<void>
  onDeleteColumn: (columnKey: string) => Promise<void>
  onEditLookupColumn: (columnKey: string, anchor: HTMLElement) => void
}

export function ColumnManagerModal({
  tableKind,
  primaryKeyField,
  columns,
  busy = false,
  onClose,
  onRenameColumn,
  onDeleteColumn,
  onEditLookupColumn,
}: ColumnManagerModalProps) {
  const [colTitleDrafts, setColTitleDrafts] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const c of columns) map[c.key] = c.title
    return map
  })
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<SmartColumn | null>(null)

  useEffect(() => {
    const map: Record<string, string> = {}
    for (const c of columns) map[c.key] = c.title
    setColTitleDrafts(map)
  }, [columns])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDeleteCol) {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmDeleteCol, onClose])

  function canRenameColumn(col: SmartColumn): boolean {
    if (tableKind === 'normal') return true
    return col.type === 'lookup' || col.type === 'formula'
  }

  function canDeleteColumn(col: SmartColumn): boolean {
    if (columns.length <= 1) return false
    if (col.isUniqueKey || (primaryKeyField && col.key === primaryKeyField)) return false
    if (tableKind === 'normal') return true
    return col.type === 'lookup' || col.type === 'formula'
  }

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="字段管理"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">数据源字段管理</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {tableKind === 'advanced'
                ? 'SQL 主数据物理列受架构锁定，可管理自定义关联列与公式列'
                : '可重命名列标题或删除非主键自定义列'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
          {columns.map((col) => {
            const renameable = canRenameColumn(col)
            const deletable = canDeleteColumn(col)
            const draftTitle = colTitleDrafts[col.key] ?? col.title
            const dirty = draftTitle.trim() !== '' && draftTitle.trim() !== col.title

            return (
              <div
                key={col.key}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200/80 bg-slate-50/50 px-3 py-2"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  {renameable ? (
                    <input
                      type="text"
                      className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                      value={draftTitle}
                      aria-label={`列 ${col.title} 名称`}
                      onChange={(e) =>
                        setColTitleDrafts((prev) => ({
                          ...prev,
                          [col.key]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && dirty) {
                          e.preventDefault()
                          void onRenameColumn(col.key, draftTitle.trim())
                        }
                      }}
                    />
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      <Lock className="h-3 w-3 text-slate-400" />
                      <span className="truncate">{col.title}</span>
                    </div>
                  )}
                  <div className="text-[11px] text-slate-400">
                    {col.key} · {col.type}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {renameable && dirty && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onRenameColumn(col.key, draftTitle.trim())}
                      className="h-6 rounded bg-blue-600 px-2 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                    >
                      保存名称
                    </button>
                  )}
                  {col.type === 'lookup' && (
                    <button
                      type="button"
                      disabled={busy}
                      title={`设置关联列 ${col.title}`}
                      aria-label={`设置关联列 ${col.title}`}
                      onClick={(e) => {
                        onClose()
                        onEditLookupColumn(col.key, e.currentTarget)
                      }}
                      className="rounded-md p-1.5 text-slate-500 hover:bg-white hover:text-blue-600"
                    >
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {deletable && (
                    <button
                      type="button"
                      disabled={busy}
                      title={`删除列 ${col.title}`}
                      aria-label={`删除列 ${col.title}`}
                      onClick={() => setConfirmDeleteCol(col)}
                      className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex justify-end border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <button
            type="button"
            className="h-8 rounded-md border border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            完成
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteCol !== null}
        title="确认删除字段列"
        description={`确定要删除字段「${confirmDeleteCol?.title ?? ''}」吗？相关筛选、排序与汇总配置将同步移除。`}
        confirmText="删除字段"
        busy={busy}
        onCancel={() => setConfirmDeleteCol(null)}
        onConfirm={async () => {
          if (!confirmDeleteCol) return
          await onDeleteColumn(confirmDeleteCol.key)
          setConfirmDeleteCol(null)
        }}
      />
    </div>
  )
}
