// 统一右侧滑出式视图配置抽屉（仅运维配置态可用）：
// 分栏收敛字段显隐与拖拽/上下调序、样式与配色、条件格式、筛选与排序、底部汇总及透视配置。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type { SmartGridSelectionInfo } from '../canvas/smart-grid'
import { scalarToText } from '../domain/utils'
import {
  getAvailableSummaryTypes,
  normalizeColumnOrder,
  reorderStringList,
  SUMMARY_LABELS,
  toggleHiddenColumn,
} from '../domain/workspace-helpers'
import type {
  FilterCondition,
  FilterOperator,
  SmartPivotConfig,
  SmartTableMeta,
  SortRule,
  SummaryType,
  WorkspaceView,
} from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import { DrawerPivotPanel } from './DrawerPivotPanel'
import { DrawerStylePanel } from './DrawerStylePanel'

export type ConfigDrawerTab = 'fields' | 'styles' | 'data' | 'pivot'

export interface ViewConfigDrawerProps {
  open: boolean
  activeTab: ConfigDrawerTab
  view: WorkspaceView
  tableMeta: SmartTableMeta
  selectionInfo: SmartGridSelectionInfo
  focusedColumnKey?: string
  pivotConfig: SmartPivotConfig
  busy?: boolean
  onTabChange: (tab: ConfigDrawerTab) => void
  onClose: () => void
  onUpdateView: (patch: Partial<WorkspaceView>) => void
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

export function ViewConfigDrawer({
  open,
  activeTab,
  view,
  tableMeta,
  selectionInfo,
  focusedColumnKey,
  pivotConfig,
  busy = false,
  onTabChange,
  onClose,
  onUpdateView,
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
    if (view.type === 'kanban' || view.type === 'dashboard') {
      return [{ id: 'data', label: '筛选与基础' }]
    }
    return [
      { id: 'fields', label: '字段' },
      { id: 'styles', label: '样式' },
      { id: 'data', label: '数据' },
    ]
  }, [view.type])

  const effectiveTab = tabs.some((t) => t.id === activeTab) ? activeTab : tabs[0]!.id

  if (!open) {
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
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-sm"
      aria-label="视图配置抽屉"
    >
      {/* 抽屉头 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="min-w-0">
          <h2 className="truncate text-xs font-semibold text-slate-900">视图配置 · {view.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭视图配置抽屉"
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 分栏导航 */}
      <div className="shrink-0 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
        <div
          className="grid gap-1 rounded-lg bg-slate-200/70 p-0.5"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`h-7 rounded-md text-xs font-medium transition-colors ${
                effectiveTab === tab.id
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {effectiveTab === 'fields' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                字段显示与顺序（{visibleCount}/{tableMeta.columns.length}）
              </span>
              <div className="flex items-center gap-2">
                {hiddenSet.size > 0 && (
                  <button
                    type="button"
                    onClick={() => onUpdateView({ hiddenColumns: [] })}
                    className="text-[11px] text-blue-600 hover:underline"
                  >
                    全部显示
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onUpdateView({ columnOrder: tableMeta.columns.map((c) => c.key) })}
                  className="text-[11px] text-slate-500 hover:text-slate-800"
                >
                  重置顺序
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {orderedColumnKeys.map((key, idx) => {
                const col = colByKey.get(key)
                if (!col) return null
                const isHidden = hiddenSet.has(key)
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
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                      isHidden
                        ? 'border-slate-200/70 bg-slate-50/50 text-slate-400'
                        : 'border-slate-200 bg-white text-slate-800'
                    } ${draggingKey === key ? 'opacity-50' : ''}`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300" />
                      <span className="truncate text-xs font-medium">{col.title}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1 py-0.2 text-[10px] text-slate-400">
                        {col.type}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        title="上移字段"
                        aria-label={`上移字段 ${col.title}`}
                        onClick={() => handleMoveColumn(idx, idx - 1)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === orderedColumnKeys.length - 1}
                        title="下移字段"
                        aria-label={`下移字段 ${col.title}`}
                        onClick={() => handleMoveColumn(idx, idx + 1)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={!isHidden && visibleCount <= 1}
                        title={isHidden ? '显示此列' : '隐藏此列'}
                        aria-label={isHidden ? `显示 ${col.title}` : `隐藏 ${col.title}`}
                        onClick={() => handleToggleColVisible(key)}
                        className={`rounded p-1 transition-colors ${
                          isHidden
                            ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                            : 'text-blue-600 hover:bg-blue-50'
                        } disabled:opacity-30`}
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

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <div className="text-[11px] font-medium text-slate-500">表结构快速入口</div>
              <div className="flex flex-wrap gap-2">
                {tableMeta.kind === 'normal' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onOpenAddColumn}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>新增列</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={onOpenLookupWizard}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs text-blue-700 hover:bg-blue-100"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>VLOOKUP 向导</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onOpenColumnManager}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-700 hover:bg-slate-50"
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

        {effectiveTab === 'data' && (
          <div className="space-y-5">
            {(view.type === 'kanban' || view.type === 'dashboard') && (
              <div className="rounded-lg border border-blue-200 bg-blue-50/70 px-3 py-2 text-xs text-blue-800">
                {view.type === 'kanban'
                  ? '看板视图主画布及泳道配置将在 P6 接入；下方筛选与排序已生效并持久化。'
                  : '仪表盘视图主画布及图表配置将在 P6 接入；下方筛选与排序已生效并持久化。'}
              </div>
            )}

            {/* 快捷筛选字段 */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-800">工具栏快捷筛选字段</h3>
              <div className="flex flex-wrap gap-1.5">
                {tableMeta.columns.map((col) => {
                  const active = view.quickFilterFields.includes(col.key)
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => toggleQuickField(col.key)}
                      className={`h-6 rounded-full border px-2.5 text-[11px] transition-colors ${
                        active
                          ? 'border-blue-300 bg-blue-50 font-medium text-blue-700'
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
            <section className="space-y-2.5 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-800">条件筛选</h3>
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
                  <div className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
                    暂无固定筛选条件
                  </div>
                ) : (
                  view.filterGroup.conditions.map((cond) => (
                    <div key={cond.id} className="flex items-center gap-1">
                      <CustomSelect
                        size="xs"
                        className="w-24"
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
                        className="w-24"
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
                          className="h-6 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
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
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <button
                type="button"
                onClick={addFilterCondition}
                className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3 w-3" />
                <span>添加筛选条件</span>
              </button>
            </section>

            {/* 多级排序 */}
            <section className="space-y-2.5 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-800">多级排序</h3>
                <button
                  type="button"
                  onClick={addSortRule}
                  className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3 w-3" />
                  <span>添加排序</span>
                </button>
              </div>
              {view.sortRules.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
                  默认记录插入顺序
                </div>
              ) : (
                <div className="space-y-1.5">
                  {view.sortRules.map((rule, idx) => (
                    <div key={`${rule.field}-${idx}`} className="flex items-center gap-1.5">
                      <CustomSelect
                        size="xs"
                        className="flex-1"
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
                        className="w-24"
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
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 底部汇总行设置（仅表格视图） */}
            {view.type === 'table' && (
              <section className="space-y-2 border-t border-slate-100 pt-4">
                <h3 className="text-xs font-semibold text-slate-800">底部汇总栏配置</h3>
                <div className="space-y-1.5">
                  {tableMeta.columns.map((col) => {
                    const current = summariesMap[col.key] ?? 'none'
                    const available = getAvailableSummaryTypes(col).map((t) => ({
                      value: t,
                      label: SUMMARY_LABELS[t],
                    }))
                    return (
                      <div key={col.key} className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-slate-600">{col.title}</span>
                        <CustomSelect
                          size="xs"
                          className="w-28"
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
