// 顶部精简工具栏：展示当前视图/数据源上下文、双态模式切换（运维配置态 / 用户查看态）、
// 快捷筛选胶囊、条件筛选浮层（用户态为临时筛选）、CSV/XLSX 导出与运维态配置/写操作入口。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Columns3,
  Database,
  Download,
  Eye,
  Filter,
  KeyRound,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Stamp,
  Table2,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import { formatSmartCellDisplayValue } from '../canvas/smart-grid'
import { isEmptyCellValue, scalarToText } from '../domain/utils'
import {
  buildRecordsXlsxBytes,
  formatRecordsAsCsv,
  triggerBrowserDownload,
  type AppMode,
} from '../domain/workspace-helpers'
import type {
  FilterCondition,
  FilterGroup,
  FilterOperator,
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
  SmartView,
} from '../shared/schema'
import { ConfirmModal } from './ConfirmModal'
import { CustomSelect } from './CustomSelect'
import { ViewTypeIcon } from './Sidebar'
import type { ToastType } from './Toast'

export interface ToolbarProps {
  mode: AppMode
  targetKind: 'view' | 'datasource'
  tableMeta: SmartTableMeta
  activeView?: SmartView
  visibleColumns: readonly SmartColumn[]
  allComputedRecords: readonly SmartRecord[]
  displayRecords: readonly SmartRecord[]
  unresolvedConflictCount: number
  selectedRecordIds: readonly string[]
  watermarkEnabled: boolean
  configDrawerOpen: boolean
  busy?: boolean
  onToggleMode: (nextMode: AppMode) => void
  onUpdateFilters: (patch: {
    filterGroup?: FilterGroup
    quickFilterValues?: Record<string, string[]>
  }) => void
  onToggleConfigDrawer: () => void
  onAddRow: () => Promise<void>
  onDeleteSelectedRows: () => Promise<void>
  onOpenAddColumn: () => void
  onOpenColumnManager: () => void
  onOpenLookupWizard: () => void
  onCreateViewFromTable: () => void
  onJumpToFirstConflict: () => void
  onToggleWatermark: () => void
  onNotify: (type: ToastType, message: string) => void
}

type ToolbarPopover =
  | { kind: 'quick'; field: string }
  | { kind: 'filter' }
  | { kind: 'export' }
  | null

const OPERATOR_OPTIONS: { value: FilterOperator; label: string }[] = [
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

export function Toolbar({
  mode,
  targetKind,
  tableMeta,
  activeView,
  visibleColumns,
  allComputedRecords,
  displayRecords,
  unresolvedConflictCount,
  selectedRecordIds,
  watermarkEnabled,
  configDrawerOpen,
  busy = false,
  onToggleMode,
  onUpdateFilters,
  onToggleConfigDrawer,
  onAddRow,
  onDeleteSelectedRows,
  onOpenAddColumn,
  onOpenColumnManager,
  onOpenLookupWizard,
  onCreateViewFromTable,
  onJumpToFirstConflict,
  onToggleWatermark,
  onNotify,
}: ToolbarProps) {
  const isOperator = mode === 'operator'
  const isDatasource = targetKind === 'datasource'
  const isGridEditableTarget = isDatasource || activeView?.type === 'table'

  const [popover, setPopover] = useState<ToolbarPopover>(null)
  const [confirmDeleteRows, setConfirmDeleteRows] = useState(false)
  const [exporting, setExporting] = useState(false)

  // 筛选条件文本防抖草稿
  const [filterDrafts, setFilterDrafts] = useState<Record<string, string>>({})
  const filterTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const filterGroupRef = useRef<FilterGroup>(
    activeView?.filterGroup ?? { conjunction: 'and', conditions: [] },
  )
  filterGroupRef.current = activeView?.filterGroup ?? { conjunction: 'and', conditions: [] }

  const toolbarRef = useRef<HTMLDivElement | null>(null)

  const contextKey = `${targetKind}:${tableMeta.id}:${activeView?.id ?? ''}`
  useEffect(() => {
    setPopover(null)
    for (const timer of filterTimersRef.current.values()) clearTimeout(timer)
    filterTimersRef.current.clear()
  }, [contextKey])

  useEffect(() => {
    const conditions = activeView?.filterGroup.conditions ?? []
    setFilterDrafts((prev) => {
      const next: Record<string, string> = {}
      for (const cond of conditions) {
        next[cond.id] = filterTimersRef.current.has(cond.id)
          ? (prev[cond.id] ?? scalarToText(cond.value))
          : scalarToText(cond.value)
      }
      return next
    })
  }, [activeView?.filterGroup.conditions])

  useEffect(() => {
    if (!popover) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (toolbarRef.current?.contains(target)) return
      if (target.closest('[data-st-portal-menu="true"]')) return
      setPopover(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popover])

  useEffect(() => {
    return () => {
      for (const timer of filterTimersRef.current.values()) clearTimeout(timer)
      filterTimersRef.current.clear()
    }
  }, [])

  const quickFilterFields = activeView?.quickFilterFields ?? []
  const quickFilterValues = activeView?.quickFilterValues ?? {}
  const filterGroup = activeView?.filterGroup ?? { conjunction: 'and', conditions: [] }

  const quickFieldOptions = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const field of quickFilterFields) {
      const seen = new Set<string>()
      let hasEmpty = false
      for (const rec of allComputedRecords) {
        const raw = rec[field]
        if (isEmptyCellValue(raw)) {
          hasEmpty = true
        } else {
          const text = scalarToText(raw).trim()
          if (text !== '') seen.add(text)
          else hasEmpty = true
        }
      }
      const list = Array.from(seen)
      if (hasEmpty) list.push('(空)')
      map.set(field, list)
    }
    return map
  }, [quickFilterFields, allComputedRecords])

  const columnSelectOptions = useMemo(
    () => tableMeta.columns.map((c) => ({ value: c.key, label: c.title })),
    [tableMeta.columns],
  )

  function toggleQuickValue(field: string, value: string) {
    const current = quickFilterValues[field] ?? []
    const exists = current.includes(value)
    const nextList = exists ? current.filter((v) => v !== value) : [...current, value]
    const nextMap = { ...quickFilterValues }
    if (nextList.length === 0) delete nextMap[field]
    else nextMap[field] = nextList
    onUpdateFilters({ quickFilterValues: nextMap })
  }

  function clearQuickField(field: string) {
    const nextMap = { ...quickFilterValues }
    delete nextMap[field]
    onUpdateFilters({ quickFilterValues: nextMap })
  }

  function addFilterCondition() {
    const firstField = tableMeta.columns[0]?.key ?? ''
    if (!firstField) return
    const nextCondition: FilterCondition = {
      id: `flt_${Date.now().toString(36)}`,
      field: firstField,
      operator: 'contains',
      value: '',
    }
    onUpdateFilters({
      filterGroup: {
        ...filterGroup,
        conditions: [...filterGroup.conditions, nextCondition],
      },
    })
  }

  function updateFilterCondition(id: string, patch: Partial<FilterCondition>) {
    const timer = filterTimersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      filterTimersRef.current.delete(id)
    }
    onUpdateFilters({
      filterGroup: {
        ...filterGroup,
        conditions: filterGroup.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      },
    })
  }

  function handleFilterTextChange(id: string, text: string) {
    setFilterDrafts((prev) => ({ ...prev, [id]: text }))
    const prevTimer = filterTimersRef.current.get(id)
    if (prevTimer) clearTimeout(prevTimer)
    const timer = setTimeout(() => {
      filterTimersRef.current.delete(id)
      const latest = filterGroupRef.current
      onUpdateFilters({
        filterGroup: {
          ...latest,
          conditions: latest.conditions.map((c) => (c.id === id ? { ...c, value: text } : c)),
        },
      })
    }, 300)
    filterTimersRef.current.set(id, timer)
  }

  function removeFilterCondition(id: string) {
    const timer = filterTimersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      filterTimersRef.current.delete(id)
    }
    onUpdateFilters({
      filterGroup: {
        ...filterGroup,
        conditions: filterGroup.conditions.filter((c) => c.id !== id),
      },
    })
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    setPopover(null)
    setExporting(true)
    const baseName = activeView ? `${activeView.name}` : tableMeta.name
    try {
      if (format === 'csv') {
        const csv = formatRecordsAsCsv(visibleColumns, displayRecords, (col, val) =>
          formatSmartCellDisplayValue(col, val),
        )
        triggerBrowserDownload(`${baseName}.csv`, csv, 'text/csv;charset=utf-8')
        onNotify('success', `已导出 ${displayRecords.length} 条记录到 CSV`)
      } else {
        const bytes = await buildRecordsXlsxBytes(
          baseName,
          visibleColumns,
          displayRecords,
          (col, val) => formatSmartCellDisplayValue(col, val),
        )
        triggerBrowserDownload(
          `${baseName}.xlsx`,
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        onNotify('success', `已导出 ${displayRecords.length} 条记录到 Excel`)
      }
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  const filterCount = filterGroup.conditions.length

  return (
    <header
      ref={toolbarRef}
      className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4"
    >
      {/* 左侧：视图/数据源标题 + 快捷筛选 + 条件筛选 */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex min-w-0 items-center gap-2 pr-1">
          {isDatasource ? (
            <>
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                {tableMeta.kind === 'advanced' ? (
                  <Database className="h-3.5 w-3.5 text-indigo-600" />
                ) : (
                  <Table2 className="h-3.5 w-3.5 text-slate-600" />
                )}
              </span>
              <h1 className="truncate text-sm font-semibold text-slate-900">{tableMeta.name}</h1>
              {tableMeta.kind === 'advanced' ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                  <KeyRound className="h-3 w-3" />
                  <span>SQL 主数据 · {tableMeta.primaryKeyField ?? '_id'}</span>
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  原始数据表
                </span>
              )}
            </>
          ) : (
            activeView && (
              <>
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100">
                  <ViewTypeIcon type={activeView.type} className="h-3.5 w-3.5" />
                </span>
                <h1 className="truncate text-sm font-semibold text-slate-900">{activeView.name}</h1>
                <span className="hidden shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500 sm:inline-flex">
                  {tableMeta.kind === 'advanced' ? (
                    <Database className="h-3 w-3 text-indigo-500" />
                  ) : (
                    <Table2 className="h-3 w-3 text-slate-400" />
                  )}
                  <span>{tableMeta.name}</span>
                </span>
              </>
            )
          )}
        </div>

        {/* 快捷筛选胶囊（运维态与用户查看态均可用） */}
        {!isDatasource &&
          quickFilterFields.map((fieldKey) => {
            const col = tableMeta.columns.find((c) => c.key === fieldKey)
            if (!col) return null
            const options = quickFieldOptions.get(fieldKey) ?? []
            const selected = quickFilterValues[fieldKey] ?? []
            const isOpen = popover?.kind === 'quick' && popover.field === fieldKey

            return (
              <div key={fieldKey} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setPopover(isOpen ? null : { kind: 'quick', field: fieldKey })}
                  className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors ${
                    selected.length > 0
                      ? 'border-blue-300 bg-blue-50 font-medium text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>{col.title}</span>
                  {selected.length > 0 && (
                    <span className="max-w-[110px] truncate text-blue-600">
                      : {selected.join(', ')}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="absolute left-0 top-full z-[900] mt-1.5 w-56 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl">
                    <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                      <span>筛选：{col.title}</span>
                      {selected.length > 0 && (
                        <button
                          type="button"
                          onClick={() => clearQuickField(fieldKey)}
                          className="text-[11px] font-normal text-blue-600 hover:underline"
                        >
                          清空
                        </button>
                      )}
                    </div>
                    <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
                      {options.length === 0 ? (
                        <div className="py-3 text-center text-xs text-slate-400">暂无可选值</div>
                      ) : (
                        options.map((opt) => (
                          <label
                            key={opt}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                              checked={selected.includes(opt)}
                              onChange={() => toggleQuickValue(fieldKey, opt)}
                            />
                            <span className={opt === '(空)' ? 'italic text-slate-400' : 'truncate'}>
                              {opt}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

        {/* 条件筛选（用户态为临时筛选，运维态自动持久化） */}
        {!isDatasource && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setPopover(popover?.kind === 'filter' ? null : { kind: 'filter' })}
              className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors ${
                filterCount > 0
                  ? 'border-blue-300 bg-blue-50 font-medium text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>
                {isOperator ? '筛选' : '临时筛选'}
                {filterCount > 0 ? ` (${filterCount})` : ''}
              </span>
            </button>

            {popover?.kind === 'filter' && (
              <div className="absolute left-0 top-full z-[900] mt-1.5 w-[440px] max-w-[90vw] rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <span className="text-xs font-semibold text-slate-800">
                    {isOperator ? '条件筛选（实时保存）' : '临时筛选（仅当前会话生效）'}
                  </span>
                  <CustomSelect
                    size="xs"
                    value={filterGroup.conjunction}
                    ariaLabel="多条件逻辑关系"
                    options={[
                      { value: 'and', label: '满足所有条件 (AND)' },
                      { value: 'or', label: '满足任一条件 (OR)' },
                    ]}
                    onChange={(val) =>
                      onUpdateFilters({
                        filterGroup: { ...filterGroup, conjunction: val },
                      })
                    }
                  />
                </div>
                <div className="max-h-60 space-y-2 overflow-y-auto">
                  {filterGroup.conditions.length === 0 ? (
                    <div className="py-3 text-center text-xs text-slate-400">暂无筛选条件</div>
                  ) : (
                    filterGroup.conditions.map((cond) => (
                      <div key={cond.id} className="flex items-center gap-1.5">
                        <CustomSelect
                          size="xs"
                          className="w-32"
                          value={cond.field}
                          ariaLabel="筛选字段"
                          options={columnSelectOptions}
                          onChange={(val) => updateFilterCondition(cond.id, { field: val })}
                        />
                        <CustomSelect
                          size="xs"
                          className="w-28"
                          value={cond.operator}
                          ariaLabel="筛选操作符"
                          options={OPERATOR_OPTIONS}
                          onChange={(val) => updateFilterCondition(cond.id, { operator: val })}
                        />
                        {cond.operator !== 'is_empty' && cond.operator !== 'is_not_empty' && (
                          <input
                            type="text"
                            className="h-6 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                            value={filterDrafts[cond.id] ?? scalarToText(cond.value)}
                            placeholder="输入值"
                            onChange={(e) => handleFilterTextChange(cond.id, e.target.value)}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => removeFilterCondition(cond.id)}
                          aria-label="移除条件"
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2">
                  <button
                    type="button"
                    onClick={addFilterCondition}
                    className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3 w-3" />
                    <span>添加条件</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPopover(null)}
                    className="h-6 rounded border border-slate-200 bg-white px-2.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    关闭
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 运维态重名消歧提示胶囊 */}
        {isOperator && isGridEditableTarget && unresolvedConflictCount > 0 && (
          <button
            type="button"
            onClick={onJumpToFirstConflict}
            title="点击立即定位到存在重名冲突的单元格进行消歧"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>{unresolvedConflictCount} 处重名待消歧</span>
          </button>
        )}
      </div>

      {/* 右侧：运维写操作/配置入口 + 导出 + 双态模式切换 */}
      <div className="flex shrink-0 items-center gap-1.5">
        {isOperator && isGridEditableTarget && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onAddRow()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新增行</span>
            </button>

            {selectedRecordIds.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDeleteRows(true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>删除选中 ({selectedRecordIds.length})</span>
              </button>
            )}

            {isDatasource && tableMeta.kind === 'normal' && (
              <button
                type="button"
                disabled={busy}
                onClick={onOpenAddColumn}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新增列</span>
              </button>
            )}

            {isDatasource && (
              <button
                type="button"
                disabled={busy}
                onClick={onOpenColumnManager}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Columns3 className="h-3.5 w-3.5" />
                <span>字段管理</span>
              </button>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={onOpenLookupWizard}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>VLOOKUP</span>
            </button>
          </>
        )}

        {isOperator && isDatasource && (
          <button
            type="button"
            disabled={busy}
            onClick={onCreateViewFromTable}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>生成应用视图</span>
          </button>
        )}

        {isOperator && !isDatasource && (
          <button
            type="button"
            onClick={onToggleWatermark}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              watermarkEnabled
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Stamp className="h-3.5 w-3.5" />
            <span>{watermarkEnabled ? '水印: 开' : '水印'}</span>
          </button>
        )}

        {/* CSV / XLSX 导出（运维态与用户态均保留） */}
        <div className="relative">
          <button
            type="button"
            disabled={exporting}
            onClick={() => setPopover(popover?.kind === 'export' ? null : { kind: 'export' })}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" />
            <span>导出</span>
          </button>

          {popover?.kind === 'export' && (
            <div className="absolute right-0 top-full z-[900] mt-1.5 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
              <button
                type="button"
                onClick={() => void handleExport('csv')}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
              >
                <span>导出 CSV</span>
                <span className="text-[10px] text-slate-400">.csv</span>
              </button>
              <button
                type="button"
                onClick={() => void handleExport('xlsx')}
                className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
              >
                <span>导出 Excel</span>
                <span className="text-[10px] text-slate-400">.xlsx</span>
              </button>
            </div>
          )}
        </div>

        {/* 统一视图配置抽屉入口（仅运维配置态 + 应用视图模式可见） */}
        {isOperator && !isDatasource && (
          <button
            type="button"
            onClick={onToggleConfigDrawer}
            aria-expanded={configDrawerOpen}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors ${
              configDrawerOpen
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>视图配置</span>
          </button>
        )}

        {/* 双态切换开关 */}
        <div
          className="ml-1 inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5"
          role="group"
          aria-label="工作模式切换"
        >
          <button
            type="button"
            onClick={() => onToggleMode('operator')}
            aria-pressed={mode === 'operator'}
            className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
              mode === 'operator'
                ? 'bg-white text-blue-700 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Wrench className="h-3 w-3" />
            <span>运维态</span>
          </button>
          <button
            type="button"
            onClick={() => onToggleMode('viewer')}
            aria-pressed={mode === 'viewer'}
            className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
              mode === 'viewer'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Eye className="h-3 w-3" />
            <span>查看态</span>
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmDeleteRows}
        title="确认删除选中记录"
        description={`确定要删除已选中的 ${selectedRecordIds.length} 条记录吗？此操作不可撤销。`}
        confirmText={`删除 ${selectedRecordIds.length} 条记录`}
        busy={busy}
        onCancel={() => setConfirmDeleteRows(false)}
        onConfirm={async () => {
          await onDeleteSelectedRows()
          setConfirmDeleteRows(false)
        }}
      />
    </header>
  )
}
