// 视图标签栏：切换表格视图 / 透视分析视图，支持新增与删除视图

import type { SmartView } from '../shared/schema'

export interface ViewTabsProps {
  views: readonly SmartView[]
  activeViewId: string
  tableName: string
  tableKind: 'normal' | 'advanced'
  primaryKeyField?: string
  sourceSqlTable?: string
  onSelectView: (viewId: string) => void
  onAddView: (type: 'table' | 'pivot') => void
  onDeleteView: (viewId: string) => void
}

export function ViewTabs({
  views,
  activeViewId,
  tableName,
  tableKind,
  primaryKeyField,
  sourceSqlTable,
  onSelectView,
  onAddView,
  onDeleteView,
}: ViewTabsProps) {
  return (
    <header className="st-viewbar">
      <div className="st-table-meta-banner">
        <h1 className="st-table-title">{tableName}</h1>
        {tableKind === 'advanced' ? (
          <span className="st-tag st-tag-sql" title={`物理表: ${sourceSqlTable ?? '-'}`}>
            SQL 主数据 · 主键 {primaryKeyField ?? '_id'}
          </span>
        ) : (
          <span className="st-tag st-tag-normal">普通自建表</span>
        )}
      </div>

      <div className="st-view-tabs" role="tablist" aria-label="视图切换">
        {views.map((view) => {
          const active = view.id === activeViewId
          return (
            <div
              key={view.id}
              className={`st-view-tab ${active ? 'is-active' : ''}`}
              role="tab"
              aria-selected={active}
            >
              <button
                type="button"
                className="st-view-tab-btn"
                onClick={() => onSelectView(view.id)}
              >
                <span aria-hidden="true">{view.type === 'pivot' ? '📊' : '▦'}</span>
                <span>{view.name}</span>
              </button>
              {views.length > 1 && (
                <button
                  type="button"
                  className="st-view-tab-close"
                  title="删除视图"
                  aria-label={`删除视图 ${view.name}`}
                  onClick={() => onDeleteView(view.id)}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}

        <div className="st-view-add-group">
          <button type="button" className="st-btn st-btn-xs" onClick={() => onAddView('table')}>
            + 表格视图
          </button>
          <button type="button" className="st-btn st-btn-xs" onClick={() => onAddView('pivot')}>
            + 透视视图
          </button>
        </div>
      </div>
    </header>
  )
}
