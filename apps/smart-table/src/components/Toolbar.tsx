// 工作台页头的第二段——静音工具栏：快捷筛选、条件筛选浮层（不可配置时为临时筛选）、CSV/XLSX 导出，
// 以及按真实权限能力快照裁剪的写操作、字段管理与视图配置入口（无前端伪模式开关）。
// 数据源模式下在工具栏上方多渲染一行页头（表名 + 表类型 + 新建多维数据台 / 对外分享），与多维数据台页头同构。
// 除「新增行」外一律无边框无底色；应用视图模式的分享入口在页头（AppViewTabs），工具栏不再重复提供。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Columns3,
  Database,
  Download,
  ExternalLink,
  Eye,
  Filter,
  KeyRound,
  Link2,
  Plus,
  Share2,
  SlidersHorizontal,
  Sigma,
  Sparkles,
  Stamp,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { formatSmartCellDisplayValue } from '../canvas/smart-grid'
import { buildAbsoluteRouteUrl } from '../domain/router'
import { isEmptyCellValue, scalarToText } from '../domain/utils'
import {
  buildRecordsXlsxBytes,
  formatRecordsAsCsv,
  triggerBrowserDownload,
  type WorkspaceActionCapabilities,
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
import { PageHeading } from './PageHeading'
import type { ToastType } from './Toast'

/** 导出当前可见列与记录为 CSV / XLSX 文件（供主工作台 Toolbar 与独立录入端共用） */
export async function exportRecordsAsFile(
  format: 'csv' | 'xlsx',
  baseName: string,
  columns: readonly SmartColumn[],
  records: readonly SmartRecord[],
): Promise<string> {
  if (format === 'csv') {
    const csv = formatRecordsAsCsv(columns, records, (col, val) =>
      formatSmartCellDisplayValue(col, val),
    )
    triggerBrowserDownload(`${baseName}.csv`, csv, 'text/csv;charset=utf-8')
    return `已导出 ${records.length} 条记录到 CSV`
  }
  const bytes = await buildRecordsXlsxBytes(baseName, columns, records, (col, val) =>
    formatSmartCellDisplayValue(col, val),
  )
  triggerBrowserDownload(
    `${baseName}.xlsx`,
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  return `已导出 ${records.length} 条记录到 Excel`
}

export interface ToolbarProps {
  capabilities: WorkspaceActionCapabilities
  canCreateApp?: boolean
  targetKind: 'app' | 'datasource'
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
  onCreateAppFromTable: () => void
  onJumpToFirstConflict: () => void
  onToggleWatermark: () => void
  onOpenEntryPage?: () => void
  onCopyEntryLink?: () => Promise<void> | void
  onOpenShare?: () => void
  onJumpToDatasource?: (tableId: string) => void
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
  capabilities,
  canCreateApp = false,
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
  onUpdateFilters,
  onToggleConfigDrawer,
  onAddRow,
  onDeleteSelectedRows,
  onOpenAddColumn,
  onOpenColumnManager,
  onOpenLookupWizard,
  onCreateAppFromTable,
  onJumpToFirstConflict,
  onToggleWatermark,
  onOpenEntryPage,
  onCopyEntryLink,
  onOpenShare,
  onJumpToDatasource,
  onNotify,
}: ToolbarProps) {
  const { canEditRecords, canConfigure, canManageDataSource, canCreateShare } = capabilities
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
      const msg = await exportRecordsAsFile(format, baseName, visibleColumns, displayRecords)
      onNotify('success', msg)
    } catch (error) {
      onNotify('error', error instanceof Error ? error.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  function handleOpenEntryPage() {
    if (onOpenEntryPage) {
      onOpenEntryPage()
      return
    }
    const url = buildAbsoluteRouteUrl(window.location.href, {
      kind: 'entries',
      tableId: tableMeta.id,
    })
    window.open(url, '_blank', 'noopener')
  }

  async function handleCopyEntryLink() {
    if (onCopyEntryLink) {
      await onCopyEntryLink()
      return
    }
    const url = buildAbsoluteRouteUrl(window.location.href, {
      kind: 'entries',
      tableId: tableMeta.id,
    })
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      }
      onNotify('success', '已复制数据录入链接')
    } catch {
      onNotify('error', '复制失败，请手动复制录入链接')
    }
  }

  const filterCount = filterGroup.conditions.length

  return (
    <div ref={toolbarRef} className="flex shrink-0 flex-col">
      {/* 数据源模式页头：表名 + 表类型，右侧为建台与分享 */}
      {isDatasource && (
        <header className="flex h-12 shrink-0 items-center gap-3 px-4">
          <PageHeading
            icon={
              tableMeta.kind === 'advanced' ? (
                <KeyRound className="h-4 w-4" />
              ) : (
                <Table2 className="h-4 w-4" />
              )
            }
            title={tableMeta.name}
            meta={
              tableMeta.kind === 'advanced'
                ? `SQL 主数据 · ${tableMeta.primaryKeyField ?? '_id'}`
                : '原始数据表'
            }
          />
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {canCreateApp && (
              <button
                type="button"
                disabled={busy}
                onClick={onCreateAppFromTable}
                className="st-btn st-btn-secondary st-btn-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新建多维数据台</span>
              </button>
            )}
            {canCreateShare && onOpenShare && tableMeta.kind === 'normal' && (
              <button
                type="button"
                disabled={busy}
                onClick={onOpenShare}
                aria-label="对外分享"
                title="创建免登录对外填报分享链接"
                className="st-btn st-btn-secondary st-btn-sm"
              >
                <Share2 className="h-3.5 w-3.5" />
                <span>对外分享</span>
              </button>
            )}
          </div>
        </header>
      )}

      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        {/* 左侧：快捷筛选 + 条件筛选 + 重名提示（数据源模式无筛选，留空） */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5">
          {/* 快捷筛选胶囊（所有有查看权限的用户均可交互） */}
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
                    aria-expanded={isOpen}
                    onClick={() => setPopover(isOpen ? null : { kind: 'quick', field: fieldKey })}
                    className={`st-tool shrink-0 ${selected.length > 0 ? 'st-tool-active' : ''}`}
                  >
                    <span className="truncate">{col.title}</span>
                    {selected.length > 0 && (
                      <span className="max-w-28 truncate opacity-80">· {selected.join(', ')}</span>
                    )}
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </button>

                  {isOpen && (
                    <div className="st-popover absolute left-0 top-full z-[900] mt-2 w-56">
                      <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1.5 text-xs font-medium text-slate-700">
                        <span>筛选：{col.title}</span>
                        {selected.length > 0 && (
                          <button
                            type="button"
                            onClick={() => clearQuickField(fieldKey)}
                            className="st-btn st-btn-xs st-btn-ghost"
                          >
                            清空
                          </button>
                        )}
                      </div>
                      <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto p-1">
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
                                className="st-checkbox"
                                checked={selected.includes(opt)}
                                onChange={() => toggleQuickValue(fieldKey, opt)}
                              />
                              <span
                                className={opt === '(空)' ? 'italic text-slate-400' : 'truncate'}
                              >
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

          {/* 条件筛选（无配置权时为会话内临时筛选，具备配置权时自动持久化） */}
          {!isDatasource && (
            <div className="relative shrink-0">
              <button
                type="button"
                aria-expanded={popover?.kind === 'filter'}
                onClick={() => setPopover(popover?.kind === 'filter' ? null : { kind: 'filter' })}
                className={`st-tool shrink-0 ${filterCount > 0 ? 'st-tool-active' : ''}`}
              >
                <Filter className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {canConfigure ? '筛选' : '临时筛选'}
                  {filterCount > 0 ? ` (${filterCount})` : ''}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
              </button>

              {popover?.kind === 'filter' && (
                <div className="st-popover absolute left-0 top-full z-[900] mt-2 w-[480px] max-w-[90vw] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <span className="shrink-0 text-sm font-semibold whitespace-nowrap text-slate-900">
                      {canConfigure ? '条件筛选（实时保存）' : '临时筛选（仅当前会话生效）'}
                    </span>
                    <CustomSelect
                      size="xs"
                      className="w-56 shrink-0"
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
                  <div className="st-scroll max-h-60 space-y-2 overflow-y-auto">
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
                              className="st-input st-input-sm min-w-0 flex-1"
                              value={filterDrafts[cond.id] ?? scalarToText(cond.value)}
                              placeholder="输入值"
                              onChange={(e) => handleFilterTextChange(cond.id, e.target.value)}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => removeFilterCondition(cond.id)}
                            aria-label="移除条件"
                            className="st-icon-btn st-icon-btn-xs st-icon-btn-danger"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                    <button
                      type="button"
                      onClick={addFilterCondition}
                      className="st-btn st-btn-xs st-btn-secondary"
                    >
                      <Plus className="h-3 w-3" />
                      <span>添加条件</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPopover(null)}
                      className="st-btn st-btn-xs st-btn-secondary"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 重名消歧提示胶囊（仅具备应用配置权时可交互消歧） */}
          {canConfigure && isGridEditableTarget && unresolvedConflictCount > 0 && (
            <button
              type="button"
              onClick={onJumpToFirstConflict}
              title="点击立即定位到存在重名冲突的单元格进行消歧"
              className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md bg-amber-50 px-2 text-xs font-medium whitespace-nowrap text-amber-700 transition-colors hover:bg-amber-100"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{unresolvedConflictCount} 处重名</span>
              <span className="sr-only">待消歧</span>
            </button>
          )}
        </div>

        {/* 右侧：字段与工具（静音） → 主操作 → 视图配置 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {canEditRecords && isGridEditableTarget && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAddRow()}
                className="st-btn st-btn-primary"
              >
                <Plus className="h-4 w-4" />
                <span>新增行</span>
              </button>

              {selectedRecordIds.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDeleteRows(true)}
                  className="st-btn st-btn-danger-soft"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>删除选中 ({selectedRecordIds.length})</span>
                </button>
              )}

              <div className="st-divider-v" />
            </>
          )}

          {canConfigure && !isDatasource && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onOpenAddColumn}
                title="新增公式列"
                className="st-tool st-tool-icon"
              >
                <Sigma className="h-4 w-4" />
                <span className="sr-only">新增公式列</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onOpenColumnManager}
                title="派生列管理"
                className="st-tool st-tool-icon"
              >
                <Columns3 className="h-4 w-4" />
                <span className="sr-only">派生列管理</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onOpenLookupWizard}
                title="VLOOKUP 关联查询"
                className="st-tool"
              >
                <Sparkles className="h-4 w-4" />
                <span>VLOOKUP</span>
              </button>
            </>
          )}

          {canConfigure && isDatasource && tableMeta.kind === 'normal' && (
            <button type="button" disabled={busy} onClick={onOpenAddColumn} className="st-tool">
              <Plus className="h-4 w-4" />
              <span>新增列</span>
            </button>
          )}

          {canConfigure && isDatasource && (
            <button
              type="button"
              disabled={busy}
              onClick={onOpenColumnManager}
              title="字段管理"
              className="st-tool st-tool-icon"
            >
              <Columns3 className="h-4 w-4" />
              <span className="sr-only">字段管理</span>
            </button>
          )}

          {canManageDataSource && isDatasource && tableMeta.kind === 'normal' && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleOpenEntryPage}
                className="st-tool"
              >
                <ExternalLink className="h-4 w-4" />
                <span>打开录入页</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCopyEntryLink()}
                title="复制录入链接"
                className="st-tool st-tool-icon"
              >
                <Link2 className="h-4 w-4" />
                <span className="sr-only">复制录入链接</span>
              </button>
            </>
          )}

          {canConfigure && isDatasource && <div className="st-divider-v" />}

          {canManageDataSource && !isDatasource && onJumpToDatasource && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onJumpToDatasource(tableMeta.id)}
              title="查看并管理底层数据源"
              className="st-tool st-tool-icon"
            >
              <Database className="h-4 w-4" />
              <span className="sr-only">数据源</span>
            </button>
          )}

          {canConfigure && !isDatasource && (
            <button
              type="button"
              onClick={onToggleWatermark}
              title="切换水印显示"
              className={`st-tool st-tool-icon ${watermarkEnabled ? 'st-tool-active' : ''}`}
            >
              <Stamp className="h-4 w-4" />
              <span className="sr-only">{watermarkEnabled ? '水印: 开' : '水印'}</span>
            </button>
          )}

          {/* CSV / XLSX 导出（所有有权查看的用户均保留） */}
          <div className="relative">
            <button
              type="button"
              disabled={exporting}
              onClick={() => setPopover(popover?.kind === 'export' ? null : { kind: 'export' })}
              title="导出"
              aria-expanded={popover?.kind === 'export'}
              className="st-tool st-tool-icon"
            >
              <Download className="h-4 w-4" />
              <span className="sr-only">导出</span>
            </button>

            {popover?.kind === 'export' && (
              <div className="st-popover absolute right-0 top-full z-[900] mt-2 w-44">
                <button
                  type="button"
                  onClick={() => void handleExport('csv')}
                  className="st-menu-item"
                >
                  <span>导出 CSV</span>
                  <span className="ml-auto text-xs text-slate-400">.csv</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport('xlsx')}
                  className="st-menu-item"
                >
                  <span>导出 Excel</span>
                  <span className="ml-auto text-xs text-slate-400">.xlsx</span>
                </button>
              </div>
            )}
          </div>

          {canConfigure && !isDatasource && <div className="st-divider-v" />}

          {/* 统一视图配置抽屉入口（仅具备视图配置权 + 应用视图模式可见） */}
          {canConfigure && !isDatasource && (
            <button
              type="button"
              onClick={onToggleConfigDrawer}
              aria-expanded={configDrawerOpen}
              className={`st-tool ${configDrawerOpen ? 'st-tool-active' : ''}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>视图配置</span>
            </button>
          )}

          {!canEditRecords && (
            <span className="st-badge st-badge-gray">
              <Eye className="h-3 w-3" />
              <span>只读权限</span>
            </span>
          )}
        </div>
      </header>

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
    </div>
  )
}
