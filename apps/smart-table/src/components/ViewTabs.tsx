// 视图标签栏：切换表格视图 / 透视分析视图，支持新增、重命名与删除二次确认

import { useState } from 'react'
import type { SmartView } from '../shared/schema'
import { ConfirmModal } from './ConfirmModal'
import { DatabaseIcon, EditIcon, KeyIcon, PivotIcon, PlusIcon, TableIcon, XIcon } from './Icons'

export interface ViewTabsProps {
  views: readonly SmartView[]
  activeViewId: string
  tableName: string
  tableKind: 'normal' | 'advanced'
  primaryKeyField?: string
  sourceSqlTable?: string
  busy?: boolean
  onSelectView: (viewId: string) => void
  onAddView: (type: 'table' | 'pivot') => void
  onRenameView: (viewId: string, nextName: string) => Promise<void>
  onDeleteView: (viewId: string) => Promise<void>
}

export function ViewTabs({
  views,
  activeViewId,
  tableName,
  tableKind,
  primaryKeyField,
  sourceSqlTable,
  busy = false,
  onSelectView,
  onAddView,
  onRenameView,
  onDeleteView,
}: ViewTabsProps) {
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteView, setConfirmDeleteView] = useState<SmartView | null>(null)

  async function commitRename(view: SmartView) {
    const trimmed = renameDraft.trim()
    if (!trimmed || trimmed === view.name) {
      setRenamingViewId(null)
      return
    }
    try {
      await onRenameView(view.id, trimmed)
      setRenamingViewId(null)
    } catch {
      // 保留编辑框，错误由 Toast 提示
    }
  }

  return (
    <header className="st-viewbar">
      <div className="st-table-meta-banner">
        <h1 className="st-table-title">{tableName}</h1>
        {tableKind === 'advanced' ? (
          <span className="st-tag st-tag-sql" title={`物理表: ${sourceSqlTable ?? '-'}`}>
            <DatabaseIcon size={12} />
            <span>SQL 主数据</span>
            <span className="st-tag-sep">·</span>
            <KeyIcon size={11} />
            <span>{primaryKeyField ?? '_id'}</span>
          </span>
        ) : (
          <span className="st-tag st-tag-normal">
            <TableIcon size={12} />
            <span>普通自建表</span>
          </span>
        )}
      </div>

      <div className="st-view-tabs" role="tablist" aria-label="视图切换">
        {views.map((view) => {
          const active = view.id === activeViewId
          const isRenaming = renamingViewId === view.id
          return (
            <div
              key={view.id}
              className={`st-view-tab ${active ? 'is-active' : ''}`}
              role="tab"
              aria-selected={active}
            >
              {isRenaming ? (
                <input
                  type="text"
                  className="st-input st-input-xs st-view-rename-input"
                  value={renameDraft}
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitRename(view)
                    } else if (e.key === 'Escape') {
                      setRenamingViewId(null)
                    }
                  }}
                  onBlur={() => void commitRename(view)}
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="st-view-tab-btn"
                    onClick={() => onSelectView(view.id)}
                    onDoubleClick={() => {
                      setRenamingViewId(view.id)
                      setRenameDraft(view.name)
                    }}
                    title="双击可重命名视图"
                  >
                    {view.type === 'pivot' ? <PivotIcon size={14} /> : <TableIcon size={14} />}
                    <span>{view.name}</span>
                  </button>
                  <button
                    type="button"
                    className="st-view-tab-action"
                    title="重命名视图"
                    aria-label={`重命名视图 ${view.name}`}
                    disabled={busy}
                    onClick={() => {
                      setRenamingViewId(view.id)
                      setRenameDraft(view.name)
                    }}
                  >
                    <EditIcon size={11} />
                  </button>
                  {views.length > 1 && (
                    <button
                      type="button"
                      className="st-view-tab-action st-icon-danger"
                      title="删除视图"
                      aria-label={`删除视图 ${view.name}`}
                      disabled={busy}
                      onClick={() => setConfirmDeleteView(view)}
                    >
                      <XIcon size={12} />
                    </button>
                  )}
                </>
              )}
            </div>
          )
        })}

        <div className="st-view-add-group">
          <button
            type="button"
            className="st-btn st-btn-xs"
            disabled={busy}
            onClick={() => onAddView('table')}
          >
            <PlusIcon size={12} />
            <span>表格视图</span>
          </button>
          <button
            type="button"
            className="st-btn st-btn-xs"
            disabled={busy}
            onClick={() => onAddView('pivot')}
          >
            <PlusIcon size={12} />
            <span>透视视图</span>
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteView !== null}
        title="确认删除视图"
        description={`确定要删除视图「${confirmDeleteView?.name ?? ''}」吗？视图内的筛选与排序配置将一并移除。`}
        confirmText="删除视图"
        busy={busy}
        onCancel={() => setConfirmDeleteView(null)}
        onConfirm={async () => {
          if (!confirmDeleteView) return
          await onDeleteView(confirmDeleteView.id)
          setConfirmDeleteView(null)
        }}
      />
    </header>
  )
}
