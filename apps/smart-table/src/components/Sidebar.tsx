// 左侧数据表导航栏：区分「普通自建表」与「进阶数据源表」，支持新建普通表与重置演示数据

import { useState } from 'react'
import type { TableBundle } from '../shared/api-types'

export interface SidebarProps {
  tables: readonly TableBundle[]
  activeTableId: string
  busy?: boolean
  onSelectTable: (tableId: string) => void
  onCreateNormalTable: (name: string, description?: string) => Promise<void>
  onResetSeed: () => Promise<void>
}

export function Sidebar({
  tables,
  activeTableId,
  busy = false,
  onSelectTable,
  onCreateNormalTable,
  onResetSeed,
}: SidebarProps) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const normalTables = tables.filter((t) => t.meta.kind === 'normal')
  const advancedTables = tables.filter((t) => t.meta.kind === 'advanced')

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) {
      return
    }
    await onCreateNormalTable(trimmed, newDesc.trim() || undefined)
    setNewName('')
    setNewDesc('')
    setCreating(false)
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
            <span>普通自建表</span>
            <button
              type="button"
              className="st-icon-btn"
              disabled={busy}
              onClick={() => setCreating((v) => !v)}
              title="新建普通自建表"
            >
              + 新建
            </button>
          </div>

          {creating && (
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

          <ul className="st-table-list">
            {normalTables.map((bundle) => {
              const active = bundle.meta.id === activeTableId
              return (
                <li key={bundle.meta.id}>
                  <button
                    type="button"
                    className={`st-table-item ${active ? 'is-active' : ''}`}
                    onClick={() => onSelectTable(bundle.meta.id)}
                  >
                    <span className="st-table-item-main">
                      <span className="st-table-icon" aria-hidden="true">
                        ⊞
                      </span>
                      <span className="st-table-name">{bundle.meta.name}</span>
                    </span>
                    <span className="st-badge-count">{bundle.records.length}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="st-nav-group">
          <div className="st-nav-group-title">
            <span>进阶数据源表</span>
            <span className="st-tag st-tag-sql">SQL</span>
          </div>
          <ul className="st-table-list">
            {advancedTables.map((bundle) => {
              const active = bundle.meta.id === activeTableId
              return (
                <li key={bundle.meta.id}>
                  <button
                    type="button"
                    className={`st-table-item ${active ? 'is-active' : ''}`}
                    onClick={() => onSelectTable(bundle.meta.id)}
                  >
                    <span className="st-table-item-main">
                      <span className="st-table-icon" aria-hidden="true">
                        🔑
                      </span>
                      <span className="st-table-name">{bundle.meta.name}</span>
                    </span>
                    <span className="st-badge-count">{bundle.records.length}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <div className="st-sidebar-footer">
        <button
          type="button"
          className="st-btn st-btn-ghost st-btn-full"
          disabled={busy}
          onClick={() => void onResetSeed()}
        >
          ↺ 重置演示数据
        </button>
      </div>
    </aside>
  )
}
