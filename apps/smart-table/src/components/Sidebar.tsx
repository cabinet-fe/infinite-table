// 左侧数据表导航栏：支持分组折叠、普通表增删改名、Excel 导入入口、进阶自建表删除与重置演示数据二次确认

import { useState } from 'react'
import type { TableBundle } from '../shared/api-types'
import { ConfirmModal } from './ConfirmModal'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  DatabaseIcon,
  EditIcon,
  PlusIcon,
  RotateCcwIcon,
  TableIcon,
  TrashIcon,
} from './Icons'

export interface SidebarProps {
  tables: readonly TableBundle[]
  activeTableId: string
  busy?: boolean
  onSelectTable: (tableId: string) => void
  onCreateNormalTable: (name: string, description?: string) => Promise<void>
  onRenameTable: (tableId: string, nextName: string) => Promise<void>
  onDeleteTable: (tableId: string) => Promise<void>
  onOpenImport: () => void
  onResetSeed: () => Promise<void>
}

export function Sidebar({
  tables,
  activeTableId,
  busy = false,
  onSelectTable,
  onCreateNormalTable,
  onRenameTable,
  onDeleteTable,
  onOpenImport,
  onResetSeed,
}: SidebarProps) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const [normalCollapsed, setNormalCollapsed] = useState(false)
  const [advancedCollapsed, setAdvancedCollapsed] = useState(false)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const [confirmDeleteTable, setConfirmDeleteTable] = useState<TableBundle | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const normalTables = tables.filter((t) => t.meta.kind === 'normal')
  const advancedTables = tables.filter((t) => t.meta.kind === 'advanced')

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    try {
      await onCreateNormalTable(trimmed, newDesc.trim() || undefined)
      setNewName('')
      setNewDesc('')
      setCreating(false)
    } catch {
      // 保留草稿输入，错误由 Toast 提示
    }
  }

  async function commitRename(tableId: string, originalName: string) {
    const trimmed = renameDraft.trim()
    if (!trimmed || trimmed === originalName) {
      setRenamingId(null)
      return
    }
    try {
      await onRenameTable(tableId, trimmed)
      setRenamingId(null)
    } catch {
      // 保留编辑态以便重试
    }
  }

  return (
    <aside className="st-sidebar" aria-label="数据表列表">
      <div className="st-sidebar-header">
        <div className="st-brand">
          <span className="st-brand-dot" aria-hidden="true" />
          <span className="st-brand-title">智能表格</span>
        </div>
        <span className="st-brand-sub">Smart Table</span>
      </div>

      <div className="st-sidebar-scroll">
        <section className="st-nav-group">
          <div className="st-nav-group-title">
            <button
              type="button"
              className="st-group-toggle"
              onClick={() => setNormalCollapsed((v) => !v)}
              aria-expanded={!normalCollapsed}
            >
              {normalCollapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
              <span>普通自建表</span>
              <span className="st-group-count">{normalTables.length}</span>
            </button>
            <div className="st-row-actions">
              <button
                type="button"
                className="st-icon-btn st-btn-inline-add"
                disabled={busy}
                onClick={() => {
                  setNormalCollapsed(false)
                  setCreating((v) => !v)
                }}
                title="新建普通自建表"
              >
                <PlusIcon size={13} />
                <span>新建</span>
              </button>
              <button
                type="button"
                className="st-icon-btn st-btn-inline-add"
                disabled={busy}
                onClick={onOpenImport}
                title="从 Excel / CSV 文件导入建表"
              >
                <TableIcon size={13} />
                <span>导入</span>
              </button>
            </div>
          </div>

          {creating && !normalCollapsed && (
            <form className="st-create-table-form" onSubmit={(e) => void handleCreateSubmit(e)}>
              <input
                type="text"
                className="st-input"
                placeholder="输入表名，如：客户跟进表"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
              <input
                type="text"
                className="st-input"
                placeholder="可选描述"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <div className="st-row-actions">
                <button
                  type="submit"
                  className="st-btn st-btn-primary st-btn-xs"
                  disabled={busy || !newName.trim()}
                >
                  创建
                </button>
                <button
                  type="button"
                  className="st-btn st-btn-xs"
                  onClick={() => {
                    setCreating(false)
                    setNewName('')
                    setNewDesc('')
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          )}

          {!normalCollapsed && (
            <ul className="st-table-list">
              {normalTables.map((bundle) => {
                const active = bundle.meta.id === activeTableId
                const isRenaming = renamingId === bundle.meta.id
                return (
                  <li key={bundle.meta.id} className="st-table-li">
                    {isRenaming ? (
                      <div className="st-table-rename-row">
                        <input
                          type="text"
                          className="st-input st-input-xs"
                          value={renameDraft}
                          autoFocus
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void commitRename(bundle.meta.id, bundle.meta.name)
                            } else if (e.key === 'Escape') {
                              setRenamingId(null)
                            }
                          }}
                          onBlur={() => void commitRename(bundle.meta.id, bundle.meta.name)}
                        />
                      </div>
                    ) : (
                      <div className={`st-table-item-wrap ${active ? 'is-active' : ''}`}>
                        <button
                          type="button"
                          className={`st-table-item ${active ? 'is-active' : ''}`}
                          onClick={() => onSelectTable(bundle.meta.id)}
                          onDoubleClick={() => {
                            setRenamingId(bundle.meta.id)
                            setRenameDraft(bundle.meta.name)
                          }}
                        >
                          <span className="st-table-item-main">
                            <TableIcon size={14} className="st-table-icon" />
                            <span className="st-table-name" title={bundle.meta.name}>
                              {bundle.meta.name}
                            </span>
                          </span>
                          <span className="st-badge-count">{bundle.records.length}</span>
                        </button>
                        <div className="st-table-item-actions">
                          <button
                            type="button"
                            className="st-icon-btn st-icon-btn-xs"
                            title="重命名数据表"
                            aria-label={`重命名 ${bundle.meta.name}`}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation()
                              setRenamingId(bundle.meta.id)
                              setRenameDraft(bundle.meta.name)
                            }}
                          >
                            <EditIcon size={12} />
                          </button>
                          {tables.length > 1 && (
                            <button
                              type="button"
                              className="st-icon-btn st-icon-btn-xs st-icon-danger"
                              title="删除数据表"
                              aria-label={`删除 ${bundle.meta.name}`}
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation()
                                setConfirmDeleteTable(bundle)
                              }}
                            >
                              <TrashIcon size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="st-nav-group">
          <div className="st-nav-group-title">
            <button
              type="button"
              className="st-group-toggle"
              onClick={() => setAdvancedCollapsed((v) => !v)}
              aria-expanded={!advancedCollapsed}
            >
              {advancedCollapsed ? <ChevronRightIcon size={13} /> : <ChevronDownIcon size={13} />}
              <span>进阶 SQL 主数据</span>
              <span className="st-group-count">{advancedTables.length}</span>
            </button>
            <span className="st-tag st-tag-sql">SQL</span>
          </div>

          {!advancedCollapsed && (
            <ul className="st-table-list">
              {advancedTables.map((bundle) => {
                const active = bundle.meta.id === activeTableId
                return (
                  <li key={bundle.meta.id} className="st-table-li">
                    <div className={`st-table-item-wrap ${active ? 'is-active' : ''}`}>
                      <button
                        type="button"
                        className={`st-table-item ${active ? 'is-active' : ''}`}
                        onClick={() => onSelectTable(bundle.meta.id)}
                      >
                        <span className="st-table-item-main">
                          <DatabaseIcon size={14} className="st-table-icon" />
                          <span className="st-table-name" title={bundle.meta.name}>
                            {bundle.meta.name}
                          </span>
                        </span>
                        <span className="st-badge-count">{bundle.records.length}</span>
                      </button>
                      {/* 用户自建进阶表可删（连带 DROP 物理表）；system 种子表不提供删除 */}
                      {!bundle.meta.system && (
                        <div className="st-table-item-actions">
                          <button
                            type="button"
                            className="st-icon-btn st-icon-btn-xs st-icon-danger"
                            title="删除数据表"
                            aria-label={`删除 ${bundle.meta.name}`}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmDeleteTable(bundle)
                            }}
                          >
                            <TrashIcon size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="st-sidebar-footer">
        <button
          type="button"
          className="st-btn st-btn-ghost st-btn-full"
          disabled={busy}
          onClick={() => setConfirmResetOpen(true)}
        >
          <RotateCcwIcon size={13} />
          <span>重置演示数据</span>
        </button>
      </div>

      <ConfirmModal
        open={confirmDeleteTable !== null}
        title="确认删除数据表"
        description={
          confirmDeleteTable?.meta.kind === 'advanced'
            ? `确定要删除进阶表「${confirmDeleteTable?.meta.name ?? ''}」及其物理表与全部 ${confirmDeleteTable?.records.length ?? 0} 条记录吗？此操作不可撤销。`
            : `确定要删除普通表「${confirmDeleteTable?.meta.name ?? ''}」及其全部 ${confirmDeleteTable?.records.length ?? 0} 条记录吗？此操作不可撤销。`
        }
        confirmText="删除数据表"
        busy={busy}
        onCancel={() => setConfirmDeleteTable(null)}
        onConfirm={async () => {
          if (!confirmDeleteTable) return
          const targetId = confirmDeleteTable.meta.id
          await onDeleteTable(targetId)
          setConfirmDeleteTable(null)
        }}
      />

      <ConfirmModal
        open={confirmResetOpen}
        title="重置演示数据"
        description="将清空当前所有自定义表、视图与修改记录，并恢复到初始预置演示数据。确认继续吗？"
        confirmText="确认重置"
        busy={busy}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={async () => {
          await onResetSeed()
          setConfirmResetOpen(false)
        }}
      />
    </aside>
  )
}
