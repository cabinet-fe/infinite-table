// 统一右侧滑出式视图配置抽屉（仅具备视图配置权限的用户可用）：
// 分栏收敛字段显隐与拖拽/上下调序、样式与配色、条件格式、筛选与排序、底部汇总及透视配置。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Calendar,
  Columns3,
  Eye,
  EyeOff,
  Gauge,
  GripVertical,
  Hash,
  Image,
  Link2,
  List,
  Plus,
  Sigma,
  Sparkles,
  SquareCheck,
  Trash2,
  Type,
  User,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { SmartGridSelectionInfo } from '../canvas/smart-grid'
import { scalarToText } from '../domain/utils'
import {
  buildDefaultDashboardConfig,
  buildDefaultKanbanConfig,
  getAvailableSummaryTypes,
  normalizeColumnOrder,
  reorderStringList,
  SUMMARY_LABELS,
  toggleHiddenColumn,
} from '../domain/workspace-helpers'
import type {
  FilterCondition,
  FilterOperator,
  SmartColumnType,
  SmartPivotConfig,
  SmartTableMeta,
  SortRule,
  SummaryType,
  WorkspaceView,
} from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import { type DashboardSelectedItem, DrawerDashboardPanel } from './DrawerDashboardPanel'
import { DrawerKanbanPanel } from './DrawerKanbanPanel'
import { DrawerPivotPanel } from './DrawerPivotPanel'
import { DrawerStylePanel } from './DrawerStylePanel'

export type ConfigDrawerTab = 'fields' | 'styles' | 'data' | 'pivot' | 'kanban' | 'dashboard'

export interface ViewConfigDrawerProps {
  open: boolean
  canConfigure?: boolean
  activeTab: ConfigDrawerTab
  view: WorkspaceView
  tableMeta: SmartTableMeta
  selectionInfo: SmartGridSelectionInfo
  focusedColumnKey?: string
  pivotConfig: SmartPivotConfig
  selectedDashboardItem?: DashboardSelectedItem | null
  busy?: boolean
  onTabChange: (tab: ConfigDrawerTab) => void
  onClose: () => void
  onUpdateView: (patch: Partial<WorkspaceView>) => void
  onSelectDashboardItem?: (item: DashboardSelectedItem | null) => void
  onOpenAddColumn: () => void
  onOpenColumnManager: () => void
  onOpenLookupWizard: () => void
  onExpandAllPivot: () => void
  onCollapseAllPivot: () => void
}

const FILTER_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'gt', label: '大于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lt', label: '小于' },
  { value: 'lte', label: '小于等于' },
  { value: 'is_empty', label: '为空' },
  { value: 'is_not_empty', label: '不为空' },
]

// 字段行左侧的类型图标（16px，装饰性）
const FIELD_TYPE_ICONS: Record<SmartColumnType, LucideIcon> = {
  text: Type,
  number: Hash,
  select: List,
  date: Calendar,
  checkbox: SquareCheck,
  person: User,
  progress: Gauge,
  image: Image,
  link: Link2,
  lookup: ArrowLeftRight,
  formula: Sigma,
}

export function ViewConfigDrawer({
  open,
  canConfigure = true,
  activeTab,
  view,
  tableMeta,
  selectionInfo,
  focusedColumnKey,
  pivotConfig,
  selectedDashboardItem,
  busy = false,
  onTabChange,
  onClose,
  onUpdateView,
  onSelectDashboardItem,
  onOpenAddColumn,
  onOpenColumnManager,
  onOpenLookupWizard,
  onExpandAllPivot,
  onCollapseAllPivot,
}: ViewConfigDrawerProps) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null)
  const [filterDrafts, setFilterDrafts] = useState<Record<string, string>>({})
  const filterTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const cond of view.filterGroup.conditions) {
      next[cond.id] = filterTimersRef.current.has(cond.id)
        ? (filterDrafts[cond.id] ?? scalarToText(cond.value))
        : scalarToText(cond.value)
    }
    setFilterDrafts(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.filterGroup.conditions])

  useEffect(() => {
    return () => {
      for (const timer of filterTimersRef.current.values()) clearTimeout(timer)
      filterTimersRef.current.clear()
    }
  }, [])

  const orderedColumnKeys = useMemo(
    () => normalizeColumnOrder(tableMeta.columns, view.columnOrder),
    [tableMeta.columns, view.columnOrder],
  )
  const colByKey = useMemo(
    () => new Map(tableMeta.columns.map((c) => [c.key, c])),
    [tableMeta.columns],
  )
  const hiddenSet = useMemo(() => new Set(view.hiddenColumns ?? []), [view.hiddenColumns])
  const visibleCount = tableMeta.columns.filter((c) => !hiddenSet.has(c.key)).length

  const tabs: { id: ConfigDrawerTab; label: string }[] = useMemo(() => {
    if (view.type === 'pivot') {
      return [
        { id: 'pivot', label: '透视配置' },
        { id: 'data', label: '筛选与排序' },
      ]
    }
    if (view.type === 'kanban') {
      return [
        { id: 'kanban', label: '看板配置' },
        { id: 'data', label: '筛选与排序' },
      ]
    }
    if (view.type === 'dashboard') {
      return [
        { id: 'dashboard', label: '仪表盘配置' },
        { id: 'data', label: '筛选与排序' },
      ]
    }
    return [
      { id: 'fields', label: '字段' },
      { id: 'styles', label: '样式' },
      { id: 'data', label: '数据' },
    ]
  }, [view.type])

  const effectiveTab = tabs.some((t) => t.id === activeTab) ? activeTab : tabs[0]!.id

  if (!open || !canConfigure) {
    return null
  }

  function handleMoveColumn(fromIdx: number, toIdx: number) {
    const nextOrder = reorderStringList(orderedColumnKeys, fromIdx, toIdx)
    onUpdateView({ columnOrder: nextOrder })
  }

  function handleToggleColVisible(key: string) {
    const nextHidden = toggleHiddenColumn(tableMeta.columns, view.hiddenColumns, key)
    if (nextHidden === null) return
    onUpdateView({ hiddenColumns: nextHidden })
  }

  function toggleQuickField(fieldKey: string) {
    const exists = view.quickFilterFields.includes(fieldKey)
    const nextFields = exists
      ? view.quickFilterFields.filter((f) => f !== fieldKey)
      : [...view.quickFilterFields, fieldKey]
    const nextValues = { ...view.quickFilterValues }
    if (exists) delete nextValues[fieldKey]
    onUpdateView({
      quickFilterFields: nextFields,
      quickFilterValues: nextValues,
    })
  }

  function addFilterCondition() {
    const firstField = tableMeta.columns[0]?.key ?? ''
    if (!firstField) return
    const cond: FilterCondition = {
      id: `flt_${Date.now().toString(36)}`,
      field: firstField,
      operator: 'contains',
      value: '',
    }
    onUpdateView({
      filterGroup: {
        ...view.filterGroup,
        conditions: [...view.filterGroup.conditions, cond],
      },
    })
  }

  function handleFilterTextChange(id: string, text: string) {
    setFilterDrafts((prev) => ({ ...prev, [id]: text }))
    const prevTimer = filterTimersRef.current.get(id)
    if (prevTimer) clearTimeout(prevTimer)
    const timer = setTimeout(() => {
      filterTimersRef.current.delete(id)
      const latest = viewRef.current
      onUpdateView({
        filterGroup: {
          ...latest.filterGroup,
          conditions: latest.filterGroup.conditions.map((c) =>
            c.id === id ? { ...c, value: text } : c,
          ),
        },
      })
    }, 300)
    filterTimersRef.current.set(id, timer)
  }

  function addSortRule() {
    const firstField = tableMeta.columns[0]?.key ?? ''
    if (!firstField) return
    const nextRule: SortRule = { field: firstField, direction: 'desc' }
    onUpdateView({ sortRules: [...view.sortRules, nextRule] })
  }

  const summariesMap = view.summaries ?? tableMeta.summaries
  const columnOptions = tableMeta.columns.map((c) => ({ value: c.key, label: c.title }))

  return (
    <aside
      className="flex h-full w-[400px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-modal"
      aria-label="视图配置抽屉"
    >
      {/* 抽屉头 */}
      <div className="st-drawer-header">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-slate-900">视图配置</h2>
          <p className="truncate text-xs text-slate-500">{view.name}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭视图配置抽屉"
          className="st-icon-btn"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 分栏导航（分段控件） */}
      <div className="st-segment mx-5 mt-4 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`st-segment-item ${effectiveTab === tab.id ? 'st-segment-item-active' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="st-drawer-body st-scroll pt-3">
        {effectiveTab === 'fields' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900">
                字段显示与顺序（{visibleCount}/{tableMeta.columns.length}）
              </span>
              <div className="flex items-center gap-1">
                {hiddenSet.size > 0 && (
                  <button
                    type="button"
                    onClick={() => onUpdateView({ hiddenColumns: [] })}
                    className="st-btn st-btn-xs st-btn-ghost"
                  >
                    全部显示
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onUpdateView({ columnOrder: tableMeta.columns.map((c) => c.key) })}
                  className="st-btn st-btn-xs st-btn-ghost"
                >
                  重置顺序
                </button>
              </div>
            </div>

            <div className="space-y-0.5">
              {orderedColumnKeys.map((key, idx) => {
                const col = colByKey.get(key)
                if (!col) return null
                const isHidden = hiddenSet.has(key)
                const TypeIcon = FIELD_TYPE_ICONS[col.type] ?? Type
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={() => setDraggingKey(key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (!draggingKey || draggingKey === key) return
                      const fromIdx = orderedColumnKeys.indexOf(draggingKey)
                      if (fromIdx >= 0) handleMoveColumn(fromIdx, idx)
                      setDraggingKey(null)
                    }}
                    onDragEnd={() => setDraggingKey(null)}
                    className={`group flex h-9 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-slate-50 ${
                      draggingKey === key ? 'opacity-50' : ''
                    }`}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-slate-300" />
                    <TypeIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span
                      className={`truncate text-sm ${isHidden ? 'text-slate-400' : 'text-slate-800'}`}
                    >
                      {col.title}
                    </span>
                    {col.type === 'lookup' && (
                      <span className="st-badge st-badge-blue">VLOOKUP</span>
                    )}
                    {col.type === 'formula' && (
                      <span className="st-badge st-badge-violet">公式</span>
                    )}
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        disabled={idx === 0}
                        title="上移字段"
                        aria-label={`上移字段 ${col.title}`}
                        onClick={() => handleMoveColumn(idx, idx - 1)}
                        className="st-icon-btn st-icon-btn-xs"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === orderedColumnKeys.length - 1}
                        title="下移字段"
                        aria-label={`下移字段 ${col.title}`}
                        onClick={() => handleMoveColumn(idx, idx + 1)}
                        className="st-icon-btn st-icon-btn-xs"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!isHidden && visibleCount <= 1}
                        title={isHidden ? '显示此列' : '隐藏此列'}
                        aria-label={isHidden ? `显示 ${col.title}` : `隐藏 ${col.title}`}
                        onClick={() => handleToggleColVisible(key)}
                        className={`st-icon-btn st-icon-btn-xs ${isHidden ? 'text-amber-500' : ''}`}
                      >
                        {isHidden ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="space-y-2">
              <div className="st-section-label">表结构快速入口</div>
              <div className="flex flex-wrap gap-2">
                {tableMeta.kind === 'normal' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onOpenAddColumn}
                    className="st-btn st-btn-sm st-btn-secondary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>新增列</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={onOpenLookupWizard}
                  className="st-btn st-btn-sm st-btn-secondary"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>VLOOKUP 向导</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onOpenColumnManager}
                  className="st-btn st-btn-sm st-btn-secondary"
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  <span>重命名/删列</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {effectiveTab === 'styles' && (
          <DrawerStylePanel
            view={view}
            columns={tableMeta.columns}
            selectionInfo={selectionInfo}
            initialColumnKey={focusedColumnKey}
            onUpdateView={onUpdateView}
          />
        )}

        {effectiveTab === 'pivot' && (
          <DrawerPivotPanel
            columns={tableMeta.columns}
            config={pivotConfig}
            onChangeConfig={(nextPivot) => onUpdateView({ pivotConfig: nextPivot })}
            onExpandAll={onExpandAllPivot}
            onCollapseAll={onCollapseAllPivot}
          />
        )}

        {effectiveTab === 'kanban' && (
          <DrawerKanbanPanel
            columns={tableMeta.columns}
            config={view.kanbanConfig ?? buildDefaultKanbanConfig(tableMeta.columns)}
            onChangeConfig={(nextKanban) => onUpdateView({ kanbanConfig: nextKanban })}
          />
        )}

        {effectiveTab === 'dashboard' && (
          <DrawerDashboardPanel
            columns={tableMeta.columns}
            config={view.dashboardConfig ?? buildDefaultDashboardConfig(tableMeta.columns)}
            selectedItem={selectedDashboardItem}
            onSelectItem={onSelectDashboardItem}
            onChangeConfig={(nextDashboard) => onUpdateView({ dashboardConfig: nextDashboard })}
          />
        )}

        {effectiveTab === 'data' && (
          <div className="space-y-5">
            {/* 快捷筛选字段 */}
            <section className="space-y-2">
              <h3 className="st-section-label">工具栏快捷筛选字段</h3>
              <div className="flex flex-wrap gap-1.5">
                {tableMeta.columns.map((col) => {
                  const active = view.quickFilterFields.includes(col.key)
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => toggleQuickField(col.key)}
                      className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors ${
                        active
                          ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {col.title}
                    </button>
                  )
                })}
              </div>
            </section>

            {/* 条件筛选 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="st-section-label">条件筛选</h3>
                <CustomSelect
                  size="xs"
                  value={view.filterGroup.conjunction}
                  ariaLabel="逻辑关系"
                  options={[
                    { value: 'and', label: '满足所有 (AND)' },
                    { value: 'or', label: '满足任一 (OR)' },
                  ]}
                  onChange={(val) =>
                    onUpdateView({
                      filterGroup: { ...view.filterGroup, conjunction: val },
                    })
                  }
                />
              </div>

              <div className="space-y-1.5">
                {view.filterGroup.conditions.length === 0 ? (
                  <div className="st-empty py-3">暂无固定筛选条件</div>
                ) : (
                  view.filterGroup.conditions.map((cond) => (
                    <div key={cond.id} className="group flex items-center gap-1">
                      <CustomSelect
                        size="xs"
                        className="w-24 shrink-0"
                        value={cond.field}
                        ariaLabel="筛选字段"
                        options={columnOptions}
                        onChange={(val) =>
                          onUpdateView({
                            filterGroup: {
                              ...view.filterGroup,
                              conditions: view.filterGroup.conditions.map((c) =>
                                c.id === cond.id ? { ...c, field: val } : c,
                              ),
                            },
                          })
                        }
                      />
                      <CustomSelect
                        size="xs"
                        className="w-24 shrink-0"
                        value={cond.operator}
                        ariaLabel="筛选操作符"
                        options={FILTER_OPERATORS}
                        onChange={(val) =>
                          onUpdateView({
                            filterGroup: {
                              ...view.filterGroup,
                              conditions: view.filterGroup.conditions.map((c) =>
                                c.id === cond.id ? { ...c, operator: val } : c,
                              ),
                            },
                          })
                        }
                      />
                      {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
                        <input
                          type="text"
                          className="st-input st-input-sm min-w-0 flex-1"
                          value={filterDrafts[cond.id] ?? scalarToText(cond.value)}
                          placeholder="值"
                          onChange={(e) => handleFilterTextChange(cond.id, e.target.value)}
                        />
                      )}
                      <button
                        type="button"
                        aria-label="移除筛选条件"
                        onClick={() =>
                          onUpdateView({
                            filterGroup: {
                              ...view.filterGroup,
                              conditions: view.filterGroup.conditions.filter(
                                (c) => c.id !== cond.id,
                              ),
                            },
                          })
                        }
                        className="st-icon-btn st-icon-btn-xs st-icon-btn-danger opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <button
                type="button"
                onClick={addFilterCondition}
                className="st-btn st-btn-xs st-btn-secondary"
              >
                <Plus className="h-3 w-3" />
                <span>添加筛选条件</span>
              </button>
            </section>

            {/* 多级排序 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <h3 className="st-section-label">多级排序</h3>
                <button
                  type="button"
                  onClick={addSortRule}
                  className="st-btn st-btn-xs st-btn-secondary"
                >
                  <Plus className="h-3 w-3" />
                  <span>添加排序</span>
                </button>
              </div>
              {view.sortRules.length === 0 ? (
                <div className="st-empty py-3">默认记录插入顺序</div>
              ) : (
                <div className="space-y-1.5">
                  {view.sortRules.map((rule, idx) => (
                    <div key={`${rule.field}-${idx}`} className="group flex items-center gap-1.5">
                      <CustomSelect
                        size="xs"
                        className="min-w-0 flex-1"
                        value={rule.field}
                        ariaLabel="排序字段"
                        options={columnOptions}
                        onChange={(val) =>
                          onUpdateView({
                            sortRules: view.sortRules.map((r, i) =>
                              i === idx ? { ...r, field: val } : r,
                            ),
                          })
                        }
                      />
                      <CustomSelect
                        size="xs"
                        className="w-24 shrink-0"
                        value={rule.direction}
                        ariaLabel="排序方向"
                        options={[
                          { value: 'asc', label: '升序 A→Z' },
                          { value: 'desc', label: '降序 Z→A' },
                        ]}
                        onChange={(val) =>
                          onUpdateView({
                            sortRules: view.sortRules.map((r, i) =>
                              i === idx ? { ...r, direction: val } : r,
                            ),
                          })
                        }
                      />
                      <button
                        type="button"
                        aria-label="移除排序"
                        onClick={() =>
                          onUpdateView({
                            sortRules: view.sortRules.filter((_, i) => i !== idx),
                          })
                        }
                        className="st-icon-btn st-icon-btn-xs st-icon-btn-danger opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 底部汇总行设置（仅表格视图） */}
            {view.type === 'table' && (
              <section className="space-y-2">
                <h3 className="st-section-label">底部汇总栏配置</h3>
                <div className="space-y-0.5">
                  {tableMeta.columns.map((col) => {
                    const current = summariesMap[col.key] ?? 'none'
                    const available = getAvailableSummaryTypes(col).map((t) => ({
                      value: t,
                      label: SUMMARY_LABELS[t],
                    }))
                    return (
                      <div key={col.key} className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm text-slate-700">{col.title}</span>
                        <CustomSelect
                          size="xs"
                          className="w-28 shrink-0"
                          value={current}
                          ariaLabel={`${col.title} 汇总方式`}
                          options={available}
                          onChange={(nextType: SummaryType) =>
                            onUpdateView({
                              summaries: {
                                ...summariesMap,
                                [col.key]: nextType,
                              },
                            })
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
