// 智能表格应用主壳：串联双态工作模式（运维配置 / 用户查看）、应用视图空间与数据源中心、
// 领域计算管线、Grid/Pivot 画布挂载、统一配置抽屉、三区域右键菜单与汇总轻量菜单。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import type { Region } from '@infinitable/render'
import { Filter, Plus, RotateCcw, Table2 } from 'lucide-react'
import {
  ApiError,
  createRecord,
  createSmartApp,
  createTable,
  createWorkspaceView,
  deleteRecord,
  deleteSmartApp,
  deleteTable,
  deleteWorkspaceView,
  fetchAllApps,
  fetchAllTables,
  fetchAllViews,
  moveKanbanCard,
  reorderSmartApps,
  reorderWorkspaceViews,
  resetDemoSeedWorkspace,
  updateRecord,
  updateSmartApp,
  updateTableMeta,
  updateWorkspaceView,
} from './api'
import {
  SmartGridAdapter,
  type SmartGridConflictClickInfo,
  type SmartGridSelectionInfo,
  type SmartGridSummaryClickInfo,
} from './canvas/smart-grid'
import { SmartPivotAdapter } from './canvas/smart-pivot'
import { AddColumnModal } from './components/AddColumnModal'
import { AppViewTabs } from './components/AppViewTabs'
import { CellEditorPopover, type RichCellEditInfo } from './components/CellEditorPopover'
import { ColumnManagerModal } from './components/ColumnManagerModal'
import { ConfirmModal } from './components/ConfirmModal'
import { DashboardView } from './components/DashboardView'
import { DisambiguatePopover } from './components/DisambiguatePopover'
import type { DashboardSelectedItem } from './components/DrawerDashboardPanel'
import { DrillDownDrawer } from './components/DrillDownDrawer'
import {
  GridPopupMenu,
  type GridMenuActionId,
  type GridMenuContext,
} from './components/GridPopupMenu'
import { ImportExcelModal } from './components/ImportExcelModal'
import { KanbanView } from './components/KanbanView'
import { LookupFieldPanel } from './components/LookupFieldPanel'
import { LookupWizardModal } from './components/LookupWizardModal'
import { Sidebar, type WorkspaceTarget } from './components/Sidebar'
import { SummaryMenuPopover } from './components/SummaryMenuPopover'
import { ToastHost, type ToastItem, type ToastType } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { ViewConfigDrawer, type ConfigDrawerTab } from './components/ViewConfigDrawer'
import { appendMatchRuleToLookupGroup } from './domain/lookup-engine'
import { runSmartTablePipeline } from './domain/query-engine'
import { resolveVisibleColumns } from './domain/style-engine'
import { scalarToText } from './domain/utils'
import {
  applyCellStyleToSelection,
  buildDefaultKanbanConfig,
  buildDefaultPivotConfig,
  buildModeSearchUrl,
  resolveAppModeFromSearch,
  toggleHiddenColumn,
  type AppMode,
} from './domain/workspace-helpers'
import type {
  CreateAppRequest,
  CreateViewRequest,
  TableBundle,
  UpdateViewRequest,
} from './shared/api-types'
import type {
  CellStyleConfig,
  FilterGroup,
  LookupMatchRule,
  SelectOption,
  SmartApp,
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
  SortRule,
  SummaryType,
  WorkspaceView,
} from './shared/schema'

interface ViewerFilterOverride {
  viewId: string
  filterGroup: FilterGroup
  quickFilterValues: Record<string, string[]>
  sortRules: SortRule[]
}

const EMPTY_SELECTION: SmartGridSelectionInfo = {
  ranges: [],
  recordIds: [],
  columnKeys: [],
  focus: null,
}

function resolvePrimaryKeyValue(meta: SmartTableMeta, suffix: string): string {
  if (meta.id === 'tbl_employees') return `EMP-${suffix}`
  if (meta.id === 'tbl_payments') return `PAY-${suffix}`
  return `PK-${suffix}`
}

function buildNewRowPayload(meta: SmartTableMeta): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  const suffix = Date.now().toString(36).slice(-4).toUpperCase()
  const firstTextKey = meta.columns.find(
    (c) => c.type === 'text' && c.key !== meta.primaryKeyField,
  )?.key

  for (const col of meta.columns) {
    if (col.type === 'formula' || col.type === 'lookup') continue
    if (meta.primaryKeyField && col.key === meta.primaryKeyField) {
      row[col.key] = resolvePrimaryKeyValue(meta, suffix)
    } else if (col.type === 'checkbox') {
      row[col.key] = false
    } else if (col.type === 'progress' || col.type === 'number') {
      row[col.key] = 0
    } else if (col.type === 'date') {
      row[col.key] = new Date().toISOString().slice(0, 10)
    } else if (col.type === 'select' && col.options && col.options.length > 0) {
      row[col.key] = col.options[0]!.label
    } else if (
      col.key === 'name' ||
      col.key === 'project_name' ||
      col.key === 'title' ||
      (meta.kind === 'normal' && col.key === firstTextKey)
    ) {
      row[col.key] = `新建记录 ${suffix}`
    } else {
      row[col.key] = ''
    }
  }
  return row
}

/** 列头点击排序循环：该列规则 无→asc→desc→移除；additive 在既有规则上原地循环、不塌缩其它规则 */
export function cycleSortRules(
  rules: readonly SortRule[],
  field: string,
  additive: boolean,
): SortRule[] {
  const index = rules.findIndex((rule) => rule.field === field)
  if (index < 0) {
    return additive ? [...rules, { field, direction: 'asc' }] : [{ field, direction: 'asc' }]
  }
  const current = rules[index]!
  if (additive) {
    return current.direction === 'asc'
      ? rules.map((rule, i) => (i === index ? { field, direction: 'desc' } : rule))
      : rules.filter((_, i) => i !== index)
  }
  return current.direction === 'asc' ? [{ field, direction: 'desc' }] : []
}

function stripDeletedColumnFromMeta(meta: SmartTableMeta, columnKey: string): SmartTableMeta {
  const nextSummaries = { ...meta.summaries }
  delete nextSummaries[columnKey]
  return {
    ...meta,
    columns: meta.columns.filter((c) => c.key !== columnKey),
    summaries: nextSummaries,
  }
}

export function stripDeletedColumnFromView(
  view: WorkspaceView,
  columnKey: string,
): Partial<WorkspaceView> | null {
  let changed = false
  const patch: Partial<WorkspaceView> = {}

  if (view.quickFilterFields.includes(columnKey)) {
    changed = true
    patch.quickFilterFields = view.quickFilterFields.filter((f) => f !== columnKey)
  }
  if (view.quickFilterValues && columnKey in view.quickFilterValues) {
    changed = true
    const nextQv = { ...view.quickFilterValues }
    delete nextQv[columnKey]
    patch.quickFilterValues = nextQv
  }
  if (view.filterGroup.conditions.some((c) => c.field === columnKey)) {
    changed = true
    patch.filterGroup = {
      ...view.filterGroup,
      conditions: view.filterGroup.conditions.filter((c) => c.field !== columnKey),
    }
  }
  if (view.sortRules.some((r) => r.field === columnKey)) {
    changed = true
    patch.sortRules = view.sortRules.filter((r) => r.field !== columnKey)
  }
  if (view.columnOrder?.includes(columnKey)) {
    changed = true
    patch.columnOrder = view.columnOrder.filter((k) => k !== columnKey)
  }
  if (view.hiddenColumns?.includes(columnKey)) {
    changed = true
    patch.hiddenColumns = view.hiddenColumns.filter((k) => k !== columnKey)
  }
  if (view.summaries && columnKey in view.summaries) {
    changed = true
    const nextSum = { ...view.summaries }
    delete nextSum[columnKey]
    patch.summaries = nextSum
  }
  if (view.pivotConfig) {
    const p = view.pivotConfig
    if (
      p.rowDimensions.includes(columnKey) ||
      p.columnDimensions.includes(columnKey) ||
      p.measures.some((m) => m.field === columnKey)
    ) {
      changed = true
      const remainingMeasures = p.measures.filter((m) => m.field !== columnKey)
      patch.pivotConfig = {
        ...p,
        rowDimensions: p.rowDimensions.filter((d) => d !== columnKey),
        columnDimensions: p.columnDimensions.filter((d) => d !== columnKey),
        measures:
          remainingMeasures.length > 0
            ? remainingMeasures
            : [{ key: '__count__', title: '记录数', field: '__count__', agg: 'count', width: 100 }],
      }
    }
  }
  if (view.kanbanConfig) {
    const k = view.kanbanConfig
    if (k.displayFields.includes(columnKey) || k.titleField === columnKey) {
      changed = true
      patch.kanbanConfig = {
        ...k,
        ...(k.titleField === columnKey ? { titleField: undefined } : {}),
        displayFields: k.displayFields.filter((f) => f !== columnKey),
      }
    }
  }
  if (view.dashboardConfig) {
    const d = view.dashboardConfig
    const hasKpiRef = d.kpis.some((kpi) => kpi.field === columnKey)
    const hasChartRef = d.charts.some(
      (c) =>
        c.dimensionField === columnKey ||
        c.measureField === columnKey ||
        c.seriesField === columnKey,
    )
    if (hasKpiRef || hasChartRef) {
      changed = true
      patch.dashboardConfig = {
        kpis: d.kpis.filter((kpi) => kpi.field !== columnKey),
        charts: d.charts
          .filter((c) => c.dimensionField !== columnKey && c.measureField !== columnKey)
          .map((c) => {
            if (c.seriesField !== columnKey) return c
            const next = { ...c }
            delete next.seriesField
            delete next.stacked
            return next
          }),
      }
    }
  }

  return changed ? patch : null
}

function canRenameColInTable(meta: SmartTableMeta, col: SmartColumn): boolean {
  if (meta.kind === 'normal') return true
  return col.type === 'lookup' || col.type === 'formula'
}

function canDeleteColInTable(meta: SmartTableMeta, col: SmartColumn): boolean {
  if (meta.columns.length <= 1) return false
  if (col.isUniqueKey || (meta.primaryKeyField && col.key === meta.primaryKeyField)) return false
  if (meta.kind === 'normal') return true
  return col.type === 'lookup' || col.type === 'formula'
}

export function App() {
  const [mode, setMode] = useState<AppMode>(() =>
    typeof window !== 'undefined' ? resolveAppModeFromSearch(window.location.search) : 'operator',
  )
  const [tables, setTables] = useState<TableBundle[]>([])
  const [apps, setApps] = useState<SmartApp[]>([])
  const [views, setViews] = useState<WorkspaceView[]>([])
  const [activeTarget, setActiveTarget] = useState<WorkspaceTarget>({
    kind: 'app',
    appId: '',
    viewId: '',
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  // 临时状态：用户查看态筛选覆盖、数据源视图临时排序、选中状态、弹窗/抽屉/气泡浮层
  const [viewerFilterOverride, setViewerFilterOverride] = useState<ViewerFilterOverride | null>(
    null,
  )
  const [datasourceSortRules, setDatasourceSortRules] = useState<SortRule[]>([])
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [selectionInfo, setSelectionInfo] = useState<SmartGridSelectionInfo>(EMPTY_SELECTION)
  const [watermarkEnabled, setWatermarkEnabled] = useState(false)

  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  const [configDrawerTab, setConfigDrawerTab] = useState<ConfigDrawerTab>('fields')
  const [focusedStyleColKey, setFocusedStyleColKey] = useState<string | undefined>(undefined)
  const [selectedDashboardItem, setSelectedDashboardItem] = useState<DashboardSelectedItem | null>(
    null,
  )

  const [showLookupWizard, setShowLookupWizard] = useState(false)
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [showColumnManager, setShowColumnManager] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [fieldSettings, setFieldSettings] = useState<{ columnKey: string; rect: Region } | null>(
    null,
  )
  const [activeConflict, setActiveConflict] = useState<SmartGridConflictClickInfo | null>(null)
  const [activeCellEdit, setActiveCellEdit] = useState<RichCellEditInfo | null>(null)
  const [drillEvent, setDrillEvent] = useState<PivotCellDrillEvent | null>(null)
  const [summaryMenu, setSummaryMenu] = useState<SmartGridSummaryClickInfo | null>(null)
  const [popupMenu, setPopupMenu] = useState<GridMenuContext | null>(null)
  const [confirmDeleteCol, setConfirmDeleteCol] = useState<SmartColumn | null>(null)
  const [createAppDraftRequest, setCreateAppDraftRequest] = useState<{
    tableId: string
    nonce: number
  } | null>(null)

  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const gridAdapterRef = useRef<SmartGridAdapter | null>(null)
  const pivotAdapterRef = useRef<SmartPivotAdapter | null>(null)
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingConflictJumpRef = useRef<{ recordId: string; colKey: string } | null>(null)
  const lastViewByAppRef = useRef<Map<string, string>>(new Map())

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      toastTimersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const pushToast = useCallback((type: ToastType, message: string) => {
    const id = `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    setToasts((prev) => [...prev.slice(-3), { id, type, message }])
    const duration = type === 'error' ? 4800 : 2600
    const timer = setTimeout(() => {
      toastTimersRef.current.delete(id)
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
    toastTimersRef.current.set(id, timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of toastTimersRef.current.values()) clearTimeout(timer)
      toastTimersRef.current.clear()
    }
  }, [])

  const loadWorkspace = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [tableList, appList, viewList] = await Promise.all([
        fetchAllTables(),
        fetchAllApps(),
        fetchAllViews(),
      ])
      setTables(tableList)
      setApps(appList)
      setViews(viewList)
      const firstApp = appList[0]
      if (firstApp) {
        const firstView = viewList.find((v) => v.appId === firstApp.id) ?? viewList[0]
        setActiveTarget({
          kind: 'app',
          appId: firstApp.id,
          viewId: firstView?.id ?? '',
        })
      } else if (tableList[0]) {
        setActiveTarget({ kind: 'datasource', tableId: tableList[0].meta.id })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载工作台失败'
      setLoadError(msg)
      pushToast('error', msg)
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const tablesById = useMemo(() => {
    const map = new Map<string, TableBundle>()
    for (const bundle of tables) map.set(bundle.meta.id, bundle)
    return map
  }, [tables])

  const activeApp = useMemo(() => {
    if (activeTarget.kind !== 'app') return undefined
    return apps.find((a) => a.id === activeTarget.appId) ?? apps[0]
  }, [activeTarget, apps])

  const activeAppViews = useMemo(() => {
    if (!activeApp) return []
    return views.filter((v) => v.appId === activeApp.id)
  }, [activeApp, views])

  const activeStoredView = useMemo(() => {
    if (activeTarget.kind !== 'app') return undefined
    return activeAppViews.find((v) => v.id === activeTarget.viewId) ?? activeAppViews[0]
  }, [activeTarget, activeAppViews])

  const activeTable = useMemo(() => {
    if (activeTarget.kind === 'datasource') {
      return tablesById.get(activeTarget.tableId) ?? tables[0]
    }
    if (activeStoredView) {
      return tablesById.get(activeStoredView.tableId) ?? tables[0]
    }
    if (activeApp) {
      return tablesById.get(activeApp.tableId) ?? tables[0]
    }
    return tables[0]
  }, [activeTarget, activeStoredView, activeApp, tablesById, tables])

  // 应用了查看态临时筛选/排序后的有效视图对象
  const effectiveView: WorkspaceView | undefined = useMemo(() => {
    if (!activeStoredView) return undefined
    if (mode === 'viewer' && viewerFilterOverride?.viewId === activeStoredView.id) {
      return {
        ...activeStoredView,
        filterGroup: viewerFilterOverride.filterGroup,
        quickFilterValues: viewerFilterOverride.quickFilterValues,
        sortRules: viewerFilterOverride.sortRules,
      }
    }
    return activeStoredView
  }, [activeStoredView, mode, viewerFilterOverride])

  const pipelineView = useMemo(() => {
    if (activeTarget.kind === 'datasource' && activeTable) {
      return {
        id: `ds_${activeTable.meta.id}`,
        name: activeTable.meta.name,
        type: 'table' as const,
        filterGroup: { conjunction: 'and' as const, conditions: [] },
        quickFilterFields: [],
        sortRules: datasourceSortRules,
        summaries: activeTable.meta.summaries,
      }
    }
    return effectiveView
  }, [activeTarget.kind, activeTable, datasourceSortRules, effectiveView])

  const pipeline = useMemo(() => {
    if (!activeTable) {
      return {
        allComputedRecords: [] as SmartRecord[],
        displayRecords: [] as SmartRecord[],
        conflictsByRow: new Map(),
        unresolvedConflictCount: 0,
        summaries: {},
      }
    }
    return runSmartTablePipeline(activeTable.meta, activeTable.records, tablesById, pipelineView)
  }, [activeTable, tablesById, pipelineView])

  const visibleColumns = useMemo(() => {
    if (!activeTable) return []
    if (activeTarget.kind === 'datasource') return [...activeTable.meta.columns]
    return resolveVisibleColumns(activeTable.meta.columns, effectiveView)
  }, [activeTable, activeTarget.kind, effectiveView])

  const clearTransientOverlays = useCallback(() => {
    setSelectedRecordIds([])
    setSelectionInfo(EMPTY_SELECTION)
    setSelectedDashboardItem(null)
    setActiveConflict(null)
    setActiveCellEdit(null)
    setDrillEvent(null)
    setFieldSettings(null)
    setSummaryMenu(null)
    setPopupMenu(null)
  }, [])

  const handleToggleMode = useCallback(
    (nextMode: AppMode) => {
      if (nextMode === mode) return
      setMode(nextMode)
      if (typeof window !== 'undefined') {
        const nextUrl = buildModeSearchUrl(
          window.location.pathname,
          window.location.search,
          window.location.hash,
          nextMode,
        )
        window.history.replaceState(null, '', nextUrl)
      }
      clearTransientOverlays()
      if (nextMode === 'viewer') {
        setConfigDrawerOpen(false)
        setShowLookupWizard(false)
        setShowAddColumn(false)
        setShowColumnManager(false)
        setShowImportModal(false)
        if (activeTarget.kind === 'datasource') {
          const boundApp = apps.find((a) => a.tableId === activeTarget.tableId) ?? apps[0]
          if (boundApp) {
            const firstView = views.find((v) => v.appId === boundApp.id)
            setActiveTarget({
              kind: 'app',
              appId: boundApp.id,
              viewId: firstView?.id ?? '',
            })
          }
        }
      } else {
        setViewerFilterOverride(null)
      }
    },
    [mode, activeTarget, apps, views, clearTransientOverlays],
  )

  const handleSelectApp = useCallback(
    (appId: string) => {
      const appViews = views.filter((v) => v.appId === appId)
      const rememberedId = lastViewByAppRef.current.get(appId)
      const nextView =
        (rememberedId ? appViews.find((v) => v.id === rememberedId) : undefined) ?? appViews[0]
      setActiveTarget({
        kind: 'app',
        appId,
        viewId: nextView?.id ?? '',
      })
      setViewerFilterOverride(null)
      clearTransientOverlays()
    },
    [views, clearTransientOverlays],
  )

  const handleSelectView = useCallback(
    (viewId: string) => {
      if (!activeApp) return
      lastViewByAppRef.current.set(activeApp.id, viewId)
      setActiveTarget({ kind: 'app', appId: activeApp.id, viewId })
      setViewerFilterOverride(null)
      clearTransientOverlays()
    },
    [activeApp, clearTransientOverlays],
  )

  const handleSelectTable = useCallback(
    (tableId: string) => {
      if (mode === 'viewer') return
      setActiveTarget({ kind: 'datasource', tableId })
      setDatasourceSortRules([])
      setConfigDrawerOpen(false)
      clearTransientOverlays()
    },
    [mode, clearTransientOverlays],
  )

  const handleSaveMeta = useCallback(
    async (tableId: string, nextMeta: SmartTableMeta) => {
      setBusy(true)
      try {
        const saved = await updateTableMeta(tableId, nextMeta)
        setTables((prev) =>
          prev.map((bundle) => (bundle.meta.id === tableId ? { ...bundle, meta: saved } : bundle)),
        )
      } catch (error) {
        const msg = error instanceof ApiError ? error.message : '保存表结构失败'
        pushToast('error', msg)
        throw error
      } finally {
        setBusy(false)
      }
    },
    [pushToast],
  )

  const handlePatchView = useCallback(
    async (viewId: string, patch: UpdateViewRequest) => {
      let snapshot: WorkspaceView | undefined
      setViews((prev) =>
        prev.map((v) => {
          if (v.id !== viewId) return v
          snapshot = v
          const merged = { ...v, ...patch } as WorkspaceView
          for (const key of Object.keys(patch) as Array<keyof UpdateViewRequest>) {
            if (patch[key] === undefined) {
              delete (merged as unknown as Record<string, unknown>)[key as string]
            }
          }
          return merged
        }),
      )

      // 显式传 null 给后端以清除可选配置对象
      const wirePatch: Record<string, unknown> = { ...patch }
      for (const [k, val] of Object.entries(patch)) {
        if (val === undefined) {
          wirePatch[k] = null
        }
      }

      try {
        const saved = await updateWorkspaceView(viewId, wirePatch as UpdateViewRequest)
        setViews((prev) => prev.map((v) => (v.id === viewId ? saved : v)))
      } catch (error) {
        if (snapshot) {
          setViews((prev) => prev.map((v) => (v.id === viewId ? snapshot! : v)))
        }
        const msg = error instanceof ApiError ? error.message : '保存视图配置失败'
        pushToast('error', msg)
      }
    },
    [pushToast],
  )

  const handleUpdateRecord = useCallback(
    async (recordId: string, patch: Record<string, unknown>) => {
      if (!activeTable || mode === 'viewer') return
      const tableId = activeTable.meta.id
      try {
        const updated = await updateRecord(tableId, recordId, patch)
        setTables((prev) =>
          prev.map((bundle) =>
            bundle.meta.id === tableId
              ? {
                  ...bundle,
                  records: bundle.records.map((r) => (r._id === recordId ? updated : r)),
                }
              : bundle,
          ),
        )
        pushToast('success', '已保存')
      } catch (error) {
        const msg = error instanceof ApiError ? error.message : '更新记录失败'
        pushToast('error', msg)
        setTables((prev) =>
          prev.map((bundle) =>
            bundle.meta.id === tableId
              ? { ...bundle, records: bundle.records.map((r) => ({ ...r })) }
              : bundle,
          ),
        )
        throw error
      }
    },
    [activeTable, mode, pushToast],
  )

  const handleMoveKanbanCard = useCallback(
    async (recordId: string, targetLaneKey: string) => {
      if (!activeTable || !activeStoredView || mode === 'viewer') return
      const tableId = activeTable.meta.id
      const kanbanCfg =
        activeStoredView.kanbanConfig ?? buildDefaultKanbanConfig(activeTable.meta.columns)
      const field = kanbanCfg.groupByField
      let previousRecord: SmartRecord | undefined

      setTables((prev) =>
        prev.map((bundle) => {
          if (bundle.meta.id !== tableId) return bundle
          return {
            ...bundle,
            records: bundle.records.map((r) => {
              if (r._id !== recordId) return r
              previousRecord = r
              return { ...r, [field]: targetLaneKey }
            }),
          }
        }),
      )

      try {
        const updated = await moveKanbanCard(activeStoredView.id, recordId, {
          field,
          targetValue: targetLaneKey,
        })
        setTables((prev) =>
          prev.map((bundle) =>
            bundle.meta.id === tableId
              ? {
                  ...bundle,
                  records: bundle.records.map((r) => (r._id === recordId ? updated : r)),
                }
              : bundle,
          ),
        )
        pushToast('success', targetLaneKey ? `已移动至「${targetLaneKey}」` : '已移动至「未分组」')
      } catch (error) {
        if (previousRecord) {
          const rollback = previousRecord
          setTables((prev) =>
            prev.map((bundle) =>
              bundle.meta.id === tableId
                ? {
                    ...bundle,
                    records: bundle.records.map((r) => (r._id === recordId ? rollback : r)),
                  }
                : bundle,
            ),
          )
        }
        const msg = error instanceof ApiError ? error.message : '看板移动写回失败'
        pushToast('error', msg)
      }
    },
    [activeTable, activeStoredView, mode, pushToast],
  )

  const focusAndOpenConflict = useCallback(
    (adapter: SmartGridAdapter, recordId: string, colKey: string) => {
      if (!activeTable) return
      const rec = pipeline.displayRecords.find((r) => r._id === recordId)
      const col = activeTable.meta.columns.find((c) => c.key === colKey)
      const groupId = col?.lookupConfig?.groupId
      const conflict =
        rec && groupId ? pipeline.conflictsByRow.get(rec._id)?.get(groupId) : undefined
      if (!rec || !col || !conflict) return

      adapter.scrollToRecord(rec._id, col.key)
      requestAnimationFrame(() => {
        const rect = adapter.getCellViewportRect(rec._id, col.key) ?? {
          x: 360,
          y: 120,
          width: 120,
          height: 32,
        }
        setActiveConflict({ record: rec, column: col, conflict, rect })
      })
    },
    [activeTable, pipeline.conflictsByRow, pipeline.displayRecords],
  )

  const handleUpdateFilters = useCallback(
    (patch: { filterGroup?: FilterGroup; quickFilterValues?: Record<string, string[]> }) => {
      if (!effectiveView) return
      if (mode === 'viewer') {
        setViewerFilterOverride({
          viewId: effectiveView.id,
          filterGroup: patch.filterGroup ?? effectiveView.filterGroup,
          quickFilterValues: patch.quickFilterValues ?? effectiveView.quickFilterValues ?? {},
          sortRules: effectiveView.sortRules,
        })
        return
      }
      void handlePatchView(effectiveView.id, patch)
    },
    [effectiveView, mode, handlePatchView],
  )

  const handleHeaderColumnSort = useCallback(
    (field: string, meta: { additive: boolean }) => {
      if (activeTarget.kind === 'datasource') {
        setDatasourceSortRules((prev) => cycleSortRules(prev, field, meta.additive))
        return
      }
      if (!effectiveView || effectiveView.type !== 'table') return
      const nextRules = cycleSortRules(effectiveView.sortRules, field, meta.additive)
      if (mode === 'viewer') {
        setViewerFilterOverride({
          viewId: effectiveView.id,
          filterGroup: effectiveView.filterGroup,
          quickFilterValues: effectiveView.quickFilterValues ?? {},
          sortRules: nextRules,
        })
        return
      }
      void handlePatchView(effectiveView.id, { sortRules: nextRules })
    },
    [activeTarget.kind, effectiveView, mode, handlePatchView],
  )

  const buildMenuContext = useCallback(
    (params: {
      region: 'body' | 'col-header' | 'row-header'
      x: number
      y: number
      colIndex: number | null
      column: SmartColumn | null
      record: SmartRecord | null
      selection: SmartGridSelectionInfo
    }): GridMenuContext | null => {
      if (!activeTable) return null
      const meta = activeTable.meta
      const isDs = activeTarget.kind === 'datasource'
      const curSortRules = isDs ? datasourceSortRules : (effectiveView?.sortRules ?? [])
      const frozenColCount = isDs ? 0 : (effectiveView?.frozenColCount ?? 0)
      const cellStyles = effectiveView?.cellStyles
      let hasSelectionCellStyles = false
      if (cellStyles) {
        for (const range of params.selection.ranges) {
          for (const rid of range.recordIds) {
            for (const ckey of range.columnKeys) {
              if (cellStyles[rid]?.[ckey]) {
                hasSelectionCellStyles = true
                break
              }
            }
            if (hasSelectionCellStyles) break
          }
          if (hasSelectionCellStyles) break
        }
        if (!hasSelectionCellStyles && params.record && params.column) {
          hasSelectionCellStyles = Boolean(cellStyles[params.record._id]?.[params.column.key])
        }
      }

      return {
        mode,
        region: params.region,
        x: params.x,
        y: params.y,
        colIndex: params.colIndex,
        column: params.column,
        record: params.record,
        selection: params.selection,
        sortRules: curSortRules,
        frozenColCount,
        visibleColumnCount: visibleColumns.length,
        canRenameColumn: params.column ? canRenameColInTable(meta, params.column) : false,
        canDeleteColumn: params.column ? canDeleteColInTable(meta, params.column) : false,
        hasSelectionCellStyles,
        isDatasourceMode: isDs,
      }
    },
    [
      activeTable,
      activeTarget.kind,
      datasourceSortRules,
      effectiveView,
      mode,
      visibleColumns.length,
    ],
  )

  // 用 ref 持有最新回调，避免重建画布
  const handlersRef = useRef({
    onCellValueChange: handleUpdateRecord,
    onConflictClick: (info: SmartGridConflictClickInfo) => {
      if (mode === 'operator') setActiveConflict(info)
    },
    onRowSelectionChange: (ids: string[]) => setSelectedRecordIds(ids),
    onSelectionInfoChange: (info: SmartGridSelectionInfo) => setSelectionInfo(info),
    onRichCellEdit: (info: RichCellEditInfo) => {
      if (mode === 'operator') setActiveCellEdit(info)
    },
    onValidationError: (msg: string) => pushToast('error', msg),
    onCellDrill: (ev: PivotCellDrillEvent) => setDrillEvent(ev),
    onHeaderSortClick: handleHeaderColumnSort,
    onHeaderMenuClick: (info: { column: SmartColumn; colIndex: number; rect: Region }) => {
      const sel = gridAdapterRef.current?.getSelectionInfo() ?? EMPTY_SELECTION
      const ctx = buildMenuContext({
        region: 'col-header',
        x: info.rect.x,
        y: info.rect.y + info.rect.height + 4,
        colIndex: info.colIndex,
        column: info.column,
        record: null,
        selection: sel,
      })
      if (ctx) setPopupMenu(ctx)
    },
    onSummaryCellClick: (info: SmartGridSummaryClickInfo) => {
      if (mode === 'operator') setSummaryMenu(info)
    },
    onColWidthChange: (info: { columnKey: string; width: number }) => {
      if (mode === 'operator' && activeTarget.kind === 'app' && activeStoredView) {
        void handlePatchView(activeStoredView.id, {
          columnWidths: {
            ...activeStoredView.columnWidths,
            [info.columnKey]: info.width,
          },
        })
      }
    },
    onContextMenu: (info: {
      region: 'body' | 'col-header' | 'row-header'
      x: number
      y: number
      colIndex: number | null
      column: SmartColumn | null
      record: SmartRecord | null
      selection: SmartGridSelectionInfo
    }) => {
      const ctx = buildMenuContext(info)
      if (ctx) setPopupMenu(ctx)
    },
  })
  handlersRef.current = {
    onCellValueChange: handleUpdateRecord,
    onConflictClick: (info) => {
      if (mode === 'operator') setActiveConflict(info)
    },
    onRowSelectionChange: (ids) => setSelectedRecordIds(ids),
    onSelectionInfoChange: (info) => setSelectionInfo(info),
    onRichCellEdit: (info) => {
      if (mode === 'operator') setActiveCellEdit(info)
    },
    onValidationError: (msg) => pushToast('error', msg),
    onCellDrill: (ev) => setDrillEvent(ev),
    onHeaderSortClick: handleHeaderColumnSort,
    onHeaderMenuClick: (info) => {
      const sel = gridAdapterRef.current?.getSelectionInfo() ?? EMPTY_SELECTION
      const ctx = buildMenuContext({
        region: 'col-header',
        x: info.rect.x,
        y: info.rect.y + info.rect.height + 4,
        colIndex: info.colIndex,
        column: info.column,
        record: null,
        selection: sel,
      })
      if (ctx) setPopupMenu(ctx)
    },
    onSummaryCellClick: (info) => {
      if (mode === 'operator') setSummaryMenu(info)
    },
    onColWidthChange: (info) => {
      if (mode === 'operator' && activeTarget.kind === 'app' && activeStoredView) {
        void handlePatchView(activeStoredView.id, {
          columnWidths: {
            ...activeStoredView.columnWidths,
            [info.columnKey]: info.width,
          },
        })
      }
    },
    onContextMenu: (info) => {
      const ctx = buildMenuContext(info)
      if (ctx) setPopupMenu(ctx)
    },
  }

  const activeRenderKind: 'grid' | 'pivot' | 'kanban' | 'dashboard' | 'none' = useMemo(() => {
    if (!activeTable) return 'none'
    if (activeTarget.kind === 'datasource') return 'grid'
    if (!effectiveView) return 'none'
    if (effectiveView.type === 'table') return 'grid'
    if (effectiveView.type === 'pivot') return 'pivot'
    return effectiveView.type
  }, [activeTable, activeTarget.kind, effectiveView])

  const canvasMountKey =
    activeTable && (activeRenderKind === 'grid' || activeRenderKind === 'pivot')
      ? `${activeTarget.kind}:${activeTarget.kind === 'app' ? (effectiveView?.id ?? '') : activeTable.meta.id}:${activeRenderKind}:${mode}`
      : ''

  // 创建/销毁 Grid 或 Pivot 画布实例
  useEffect(() => {
    const container = canvasContainerRef.current
    if (!container || !activeTable || !canvasMountKey) {
      return
    }

    gridAdapterRef.current?.destroy()
    gridAdapterRef.current = null
    pivotAdapterRef.current?.destroy()
    pivotAdapterRef.current = null

    if (activeRenderKind === 'grid') {
      const isDs = activeTarget.kind === 'datasource'
      const curSort = isDs ? datasourceSortRules : (effectiveView?.sortRules ?? [])
      const curSummaries = isDs
        ? activeTable.meta.summaries
        : (effectiveView?.summaries ?? activeTable.meta.summaries)

      const adapter = new SmartGridAdapter({
        container,
        columns: activeTable.meta.columns,
        records: pipeline.displayRecords,
        conflictsByRow: pipeline.conflictsByRow,
        readonly: mode === 'viewer',
        sortRules: curSort,
        view: isDs ? undefined : effectiveView,
        summaries: curSummaries,
        summaryResults: pipeline.summaries,
        totalCount: pipeline.allComputedRecords.length,
        onCellValueChange: (recordId, fieldKey, newValue) => {
          void handlersRef.current
            .onCellValueChange(recordId, { [fieldKey]: newValue })
            .catch(() => {})
        },
        onConflictClick: (info) => handlersRef.current.onConflictClick(info),
        onRowSelectionChange: (ids) => handlersRef.current.onRowSelectionChange(ids),
        onSelectionInfoChange: (info) => handlersRef.current.onSelectionInfoChange(info),
        onRichCellEdit: (info) => handlersRef.current.onRichCellEdit(info),
        onValidationError: (msg) => handlersRef.current.onValidationError(msg),
        onHeaderSortClick: (info) =>
          handlersRef.current.onHeaderSortClick(info.field, { additive: info.additive }),
        onHeaderMenuClick: (info) => handlersRef.current.onHeaderMenuClick(info),
        onSummaryCellClick: (info) => handlersRef.current.onSummaryCellClick(info),
        onColWidthChange: (info) => handlersRef.current.onColWidthChange(info),
        onContextMenu: (info) => handlersRef.current.onContextMenu(info),
      })
      adapter.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 内部数据`)
      gridAdapterRef.current = adapter

      if (pendingConflictJumpRef.current) {
        const pending = pendingConflictJumpRef.current
        pendingConflictJumpRef.current = null
        focusAndOpenConflict(adapter, pending.recordId, pending.colKey)
      }

      return () => {
        adapter.destroy()
        gridAdapterRef.current = null
      }
    }

    if (activeRenderKind === 'pivot' && effectiveView) {
      const pivotConfig =
        effectiveView.pivotConfig ?? buildDefaultPivotConfig(activeTable.meta.columns)
      const pivotAdapter = new SmartPivotAdapter({
        container,
        columns: activeTable.meta.columns,
        records: pipeline.displayRecords,
        config: pivotConfig,
        onCellDrill: (ev) => handlersRef.current.onCellDrill(ev),
      })
      pivotAdapter.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 透视分析`)
      pivotAdapterRef.current = pivotAdapter
      return () => {
        pivotAdapter.destroy()
        pivotAdapterRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasMountKey])

  // 数据/配置变化时原地刷新画布
  useEffect(() => {
    if (!activeTable) return
    if (activeRenderKind === 'grid') {
      const isDs = activeTarget.kind === 'datasource'
      const curSort = isDs ? datasourceSortRules : (effectiveView?.sortRules ?? [])
      const curSummaries = isDs
        ? activeTable.meta.summaries
        : (effectiveView?.summaries ?? activeTable.meta.summaries)
      gridAdapterRef.current?.setData(
        activeTable.meta.columns,
        pipeline.displayRecords,
        pipeline.conflictsByRow,
        curSort,
        {
          view: isDs ? {} : effectiveView,
          summaries: curSummaries,
          summaryResults: pipeline.summaries,
          totalCount: pipeline.allComputedRecords.length,
        },
      )
    } else if (activeRenderKind === 'pivot' && effectiveView) {
      const pivotConfig =
        effectiveView.pivotConfig ?? buildDefaultPivotConfig(activeTable.meta.columns)
      pivotAdapterRef.current?.update({
        columns: activeTable.meta.columns,
        records: pipeline.displayRecords,
        config: pivotConfig,
      })
    }
  }, [
    activeTable,
    activeRenderKind,
    activeTarget.kind,
    effectiveView,
    datasourceSortRules,
    pipeline.displayRecords,
    pipeline.conflictsByRow,
    pipeline.summaries,
    pipeline.allComputedRecords.length,
  ])

  useEffect(() => {
    if (!activeTable) return
    gridAdapterRef.current?.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 内部数据`)
    pivotAdapterRef.current?.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 透视分析`)
  }, [watermarkEnabled, activeTable])

  // ---- 智能表格（SmartApp）CRUD ----
  async function handleCreateApp(payload: CreateAppRequest) {
    setBusy(true)
    try {
      const created = await createSmartApp(payload)
      setApps((prev) => [...prev, created.app])
      setViews((prev) => [...prev, created.defaultView])
      lastViewByAppRef.current.set(created.app.id, created.defaultView.id)
      setActiveTarget({
        kind: 'app',
        appId: created.app.id,
        viewId: created.defaultView.id,
      })
      clearTransientOverlays()
      pushToast('success', `已新建智能表格「${created.app.name}」`)
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '新建智能表格失败'
      pushToast('error', msg)
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function handleRenameApp(appId: string, nextName: string) {
    try {
      const updated = await updateSmartApp(appId, { name: nextName })
      setApps((prev) => prev.map((a) => (a.id === appId ? updated : a)))
      pushToast('success', `智能表格已重命名为「${updated.name}」`)
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '重命名智能表格失败'
      pushToast('error', msg)
      throw error
    }
  }

  async function handleDeleteApp(appId: string) {
    if (apps.length <= 1) return
    setBusy(true)
    try {
      await deleteSmartApp(appId)
      const remainingApps = apps.filter((a) => a.id !== appId)
      const remainingViews = views.filter((v) => v.appId !== appId)
      setApps(remainingApps)
      setViews(remainingViews)
      lastViewByAppRef.current.delete(appId)
      if (activeTarget.kind === 'app' && activeTarget.appId === appId) {
        const nextApp = remainingApps[0]
        if (nextApp) {
          const nextView = remainingViews.find((v) => v.appId === nextApp.id)
          setActiveTarget({
            kind: 'app',
            appId: nextApp.id,
            viewId: nextView?.id ?? '',
          })
        }
      }
      clearTransientOverlays()
      pushToast('success', '智能表格已删除')
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '删除智能表格失败'
      pushToast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleReorderApps(appIds: string[]) {
    try {
      const reordered = await reorderSmartApps(appIds)
      setApps(reordered)
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '智能表格排序失败'
      pushToast('error', msg)
    }
  }

  // ---- 视图 CRUD ----
  async function handleCreateView(payload: CreateViewRequest) {
    setBusy(true)
    try {
      const created = await createWorkspaceView(payload)
      setViews((prev) => [...prev, created])
      lastViewByAppRef.current.set(created.appId, created.id)
      setActiveTarget({ kind: 'app', appId: created.appId, viewId: created.id })
      clearTransientOverlays()
      pushToast('success', `已新建视图「${created.name}」`)
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '新建视图失败'
      pushToast('error', msg)
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function handleRenameView(viewId: string, nextName: string) {
    await handlePatchView(viewId, { name: nextName })
    pushToast('success', `视图已重命名为「${nextName}」`)
  }

  async function handleDeleteView(viewId: string) {
    const targetView = views.find((v) => v.id === viewId)
    if (!targetView) return
    const siblingViews = views.filter((v) => v.appId === targetView.appId)
    if (siblingViews.length <= 1) return
    setBusy(true)
    try {
      await deleteWorkspaceView(viewId)
      const remaining = views.filter((v) => v.id !== viewId)
      setViews(remaining)
      if (activeTarget.kind === 'app' && activeTarget.viewId === viewId) {
        const nextSibling = remaining.find((v) => v.appId === targetView.appId)
        if (nextSibling) {
          lastViewByAppRef.current.set(targetView.appId, nextSibling.id)
          setActiveTarget({
            kind: 'app',
            appId: targetView.appId,
            viewId: nextSibling.id,
          })
        }
      }
      clearTransientOverlays()
      pushToast('success', '视图已删除')
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '删除视图失败'
      pushToast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleReorderViews(viewIds: string[]) {
    try {
      const reordered = await reorderWorkspaceViews(viewIds)
      setViews(reordered)
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '视图排序失败'
      pushToast('error', msg)
    }
  }

  // ---- 数据源表 CRUD ----
  async function handleCreateNormalTable(name: string, description?: string) {
    setBusy(true)
    try {
      const created = await createTable({ name, description })
      setTables((prev) => [...prev, created])
      setActiveTarget({ kind: 'datasource', tableId: created.meta.id })
      clearTransientOverlays()
      pushToast('success', `已创建数据表「${created.meta.name}」`)
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '创建数据表失败'
      pushToast('error', msg)
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function handleRenameTable(tableId: string, nextName: string) {
    const bundle = tablesById.get(tableId)
    if (!bundle) return
    await handleSaveMeta(tableId, { ...bundle.meta, name: nextName })
    pushToast('success', `已重命名为「${nextName}」`)
  }

  function handleImported(bundle: TableBundle) {
    setTables((prev) => [...prev, bundle])
    setActiveTarget({ kind: 'datasource', tableId: bundle.meta.id })
    clearTransientOverlays()
    setShowImportModal(false)
    pushToast('success', `已导入「${bundle.meta.name}」（${bundle.records.length} 行）`)
  }

  async function handleDeleteTable(tableId: string) {
    setBusy(true)
    try {
      await deleteTable(tableId)
      const remainingTables = tables.filter((b) => b.meta.id !== tableId)
      const remainingApps = apps.filter((a) => a.tableId !== tableId)
      const remainingViews = views.filter((v) => v.tableId !== tableId)
      setTables(remainingTables)
      setApps(remainingApps)
      setViews(remainingViews)

      const fallbackToFirstAppOrTable = () => {
        const nextApp = remainingApps[0]
        if (nextApp) {
          const nextView = remainingViews.find((v) => v.appId === nextApp.id)
          setActiveTarget({
            kind: 'app',
            appId: nextApp.id,
            viewId: nextView?.id ?? '',
          })
        } else if (remainingTables[0]) {
          setActiveTarget({ kind: 'datasource', tableId: remainingTables[0].meta.id })
        }
      }

      if (activeTarget.kind === 'datasource' && activeTarget.tableId === tableId) {
        fallbackToFirstAppOrTable()
      } else if (
        activeTarget.kind === 'app' &&
        !remainingApps.some((a) => a.id === activeTarget.appId)
      ) {
        fallbackToFirstAppOrTable()
      }
      clearTransientOverlays()
      pushToast('success', '数据表已删除')
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '删除数据表失败'
      pushToast('error', msg)
      throw error
    } finally {
      setBusy(false)
    }
  }

  async function handleResetSeed() {
    setBusy(true)
    try {
      const fresh = await resetDemoSeedWorkspace()
      setTables(fresh.tables)
      setApps(fresh.apps)
      setViews(fresh.views)
      lastViewByAppRef.current.clear()
      const firstApp = fresh.apps[0]
      if (firstApp) {
        const firstView = fresh.views.find((v) => v.appId === firstApp.id) ?? fresh.views[0]
        setActiveTarget({
          kind: 'app',
          appId: firstApp.id,
          viewId: firstView?.id ?? '',
        })
      } else if (fresh.tables[0]) {
        setActiveTarget({ kind: 'datasource', tableId: fresh.tables[0].meta.id })
      }
      setViewerFilterOverride(null)
      clearTransientOverlays()
      pushToast('success', '已重置为初始演示数据')
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '重置演示数据失败'
      pushToast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  // ---- 记录与列 CRUD ----
  async function handleAddRow(customPayload?: Record<string, unknown>) {
    if (!activeTable || mode === 'viewer') return
    setBusy(true)
    try {
      const created = await createRecord(
        activeTable.meta.id,
        customPayload ?? buildNewRowPayload(activeTable.meta),
      )
      setTables((prev) =>
        prev.map((b) =>
          b.meta.id === activeTable.meta.id ? { ...b, records: [...b.records, created] } : b,
        ),
      )
      pushToast('success', '已新增 1 条记录')
      requestAnimationFrame(() => {
        gridAdapterRef.current?.scrollToRecord(created._id)
      })
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '新增行失败'
      pushToast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteRecords(recordIds: readonly string[]) {
    if (!activeTable || recordIds.length === 0 || mode === 'viewer') return
    const tableId = activeTable.meta.id
    const targetIds = [...recordIds]
    setBusy(true)
    try {
      const results = await Promise.allSettled(targetIds.map((id) => deleteRecord(tableId, id)))
      const succeededIds = new Set<string>()
      let failedCount = 0
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled') succeededIds.add(targetIds[idx]!)
        else failedCount += 1
      })
      if (succeededIds.size > 0) {
        setTables((prev) =>
          prev.map((b) =>
            b.meta.id === tableId
              ? { ...b, records: b.records.filter((r) => !succeededIds.has(r._id)) }
              : b,
          ),
        )
        setSelectedRecordIds((prev) => prev.filter((id) => !succeededIds.has(id)))
      }
      if (failedCount > 0) {
        pushToast(
          'error',
          succeededIds.size > 0
            ? `已删除 ${succeededIds.size} 条，另有 ${failedCount} 条删除失败`
            : `删除失败（${failedCount} 条）`,
        )
      } else {
        pushToast('success', `已删除 ${succeededIds.size} 条记录`)
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleAddColumns(newColumns: SmartColumn[]) {
    if (!activeTable) return
    const nextSummaries = { ...activeTable.meta.summaries }
    for (const col of newColumns) {
      if (!(col.key in nextSummaries)) {
        nextSummaries[col.key] = col.type === 'number' || col.type === 'formula' ? 'sum' : 'none'
      }
    }
    await handleSaveMeta(activeTable.meta.id, {
      ...activeTable.meta,
      columns: [...activeTable.meta.columns, ...newColumns],
      summaries: nextSummaries,
    })
    const hint = newColumns.some((col) => col.type === 'lookup') ? '，右键关联列头可随时编辑' : ''
    pushToast('success', `已添加 ${newColumns.length} 个字段列${hint}`)
  }

  async function handleRenameColumn(columnKey: string, nextTitle: string) {
    if (!activeTable) return
    await handleSaveMeta(activeTable.meta.id, {
      ...activeTable.meta,
      columns: activeTable.meta.columns.map((c) =>
        c.key === columnKey ? { ...c, title: nextTitle } : c,
      ),
    })
    pushToast('success', `列标题已更新为「${nextTitle}」`)
  }

  async function handleDeleteColumn(columnKey: string) {
    if (!activeTable) return
    const tableId = activeTable.meta.id
    const nextMeta = stripDeletedColumnFromMeta(activeTable.meta, columnKey)
    await handleSaveMeta(tableId, nextMeta)
    for (const v of views) {
      if (v.tableId !== tableId) continue
      const patch = stripDeletedColumnFromView(v, columnKey)
      if (patch) void handlePatchView(v.id, patch)
    }
    pushToast('success', '字段列已删除')
  }

  async function handleCreateSelectOption(columnKey: string, option: SelectOption) {
    if (!activeTable) return
    const targetCol = activeTable.meta.columns.find((c) => c.key === columnKey)
    if (!targetCol) return
    const existing = targetCol.options ?? []
    if (existing.some((o) => o.label === option.label)) return
    await handleSaveMeta(activeTable.meta.id, {
      ...activeTable.meta,
      columns: activeTable.meta.columns.map((c) =>
        c.key === columnKey ? { ...c, options: [...existing, option] } : c,
      ),
    })
  }

  async function handleSelectConflictCandidate(
    recordId: string,
    groupId: string,
    targetRecordId: string,
  ) {
    if (!activeTable) return
    const record = activeTable.records.find((r) => r._id === recordId)
    await handleUpdateRecord(recordId, {
      _lookupOverrides: {
        ...record?._lookupOverrides,
        [groupId]: targetRecordId,
      },
    })
  }

  async function handleAppendMatchRule(groupId: string, rule: LookupMatchRule) {
    if (!activeTable) return
    const nextCols = appendMatchRuleToLookupGroup(activeTable.meta.columns, groupId, rule)
    await handleSaveMeta(activeTable.meta.id, { ...activeTable.meta, columns: nextCols })
    pushToast('success', '已追加联合匹配条件')
  }

  async function handleSaveLookupColumns(nextColumns: SmartColumn[]) {
    if (!activeTable) return
    let nextMeta = activeTable.meta
    const nextKeys = new Set(nextColumns.map((c) => c.key))
    for (const col of activeTable.meta.columns) {
      if (!nextKeys.has(col.key)) {
        nextMeta = stripDeletedColumnFromMeta(nextMeta, col.key)
      }
    }
    await handleSaveMeta(activeTable.meta.id, { ...nextMeta, columns: nextColumns })
    pushToast('success', '关联字段设置已保存')
  }

  function handleJumpToFirstConflict() {
    if (!activeTable || mode === 'viewer') return
    for (const rec of pipeline.displayRecords) {
      const rowMap = pipeline.conflictsByRow.get(rec._id)
      if (!rowMap) continue
      for (const [groupId, info] of rowMap.entries()) {
        if (!info.isResolved) {
          const col = activeTable.meta.columns.find(
            (c) => c.type === 'lookup' && c.lookupConfig?.groupId === groupId,
          )
          if (col && gridAdapterRef.current) {
            focusAndOpenConflict(gridAdapterRef.current, rec._id, col.key)
            return
          }
        }
      }
    }
  }

  function handleChangeSummary(columnKey: string, summaryType: SummaryType) {
    if (!activeTable || mode === 'viewer') return
    if (activeTarget.kind === 'datasource') {
      const nextSummaries = { ...activeTable.meta.summaries, [columnKey]: summaryType }
      void handleSaveMeta(activeTable.meta.id, { ...activeTable.meta, summaries: nextSummaries })
      return
    }
    if (activeStoredView) {
      const cur = activeStoredView.summaries ?? activeTable.meta.summaries
      void handlePatchView(activeStoredView.id, {
        summaries: { ...cur, [columnKey]: summaryType },
      })
    }
  }

  function handleGridMenuAction(action: GridMenuActionId, stylePatch?: CellStyleConfig) {
    if (!popupMenu || !activeTable) return
    const { column, record, colIndex, selection, x, y } = popupMenu

    const setSingleSort = (direction: 'asc' | 'desc' | null) => {
      if (!column) return
      const nextRules: SortRule[] = direction ? [{ field: column.key, direction }] : []
      if (activeTarget.kind === 'datasource') {
        setDatasourceSortRules(nextRules)
        return
      }
      if (!effectiveView) return
      if (mode === 'viewer') {
        setViewerFilterOverride({
          viewId: effectiveView.id,
          filterGroup: effectiveView.filterGroup,
          quickFilterValues: effectiveView.quickFilterValues ?? {},
          sortRules: nextRules,
        })
      } else {
        void handlePatchView(effectiveView.id, { sortRules: nextRules })
      }
    }

    switch (action) {
      case 'sort_asc':
        setSingleSort('asc')
        break
      case 'sort_desc':
        setSingleSort('desc')
        break
      case 'sort_clear':
        if (column) {
          const filtered = (
            activeTarget.kind === 'datasource'
              ? datasourceSortRules
              : (effectiveView?.sortRules ?? [])
          ).filter((r) => r.field !== column.key)
          if (activeTarget.kind === 'datasource') setDatasourceSortRules(filtered)
          else if (effectiveView) {
            if (mode === 'viewer') {
              setViewerFilterOverride({
                viewId: effectiveView.id,
                filterGroup: effectiveView.filterGroup,
                quickFilterValues: effectiveView.quickFilterValues ?? {},
                sortRules: filtered,
              })
            } else {
              void handlePatchView(effectiveView.id, { sortRules: filtered })
            }
          }
        }
        break
      case 'freeze_to_col':
        if (activeStoredView && colIndex !== null) {
          void handlePatchView(activeStoredView.id, { frozenColCount: colIndex + 1 })
        }
        break
      case 'unfreeze_all':
        if (activeStoredView) {
          void handlePatchView(activeStoredView.id, { frozenColCount: 0 })
        }
        break
      case 'hide_col':
        if (activeStoredView && column) {
          const nextHidden = toggleHiddenColumn(
            activeTable.meta.columns,
            activeStoredView.hiddenColumns,
            column.key,
          )
          if (nextHidden) void handlePatchView(activeStoredView.id, { hiddenColumns: nextHidden })
        }
        break
      case 'open_col_style':
        if (column) {
          setFocusedStyleColKey(column.key)
          setConfigDrawerTab('styles')
          setConfigDrawerOpen(true)
        }
        break
      case 'edit_lookup_col':
        if (column) {
          setFieldSettings({
            columnKey: column.key,
            rect: { x, y, width: 120, height: 32 },
          })
        }
        break
      case 'rename_col':
        setShowColumnManager(true)
        break
      case 'delete_col':
        if (column) setConfirmDeleteCol(column)
        break
      case 'copy_cell':
        if (record && column) {
          const txt = scalarToText(record[column.key])
          void navigator.clipboard?.writeText(txt).catch(() => {})
          pushToast('success', '已复制单元格内容')
        }
        break
      case 'copy_row':
        if (record) {
          const txt = JSON.stringify(record, null, 2)
          void navigator.clipboard?.writeText(txt).catch(() => {})
          pushToast('success', '已复制整行数据')
        }
        break
      case 'filter_by_cell':
        if (record && column && effectiveView) {
          const rawVal = record[column.key]
          const nextCond = {
            id: `flt_${Date.now().toString(36)}`,
            field: column.key,
            operator:
              rawVal === null || rawVal === undefined || rawVal === ''
                ? ('is_empty' as const)
                : ('eq' as const),
            value: rawVal ?? '',
          }
          handleUpdateFilters({
            filterGroup: {
              ...effectiveView.filterGroup,
              conditions: [...effectiveView.filterGroup.conditions, nextCond],
            },
          })
        }
        break
      case 'clear_filters':
        handleUpdateFilters({
          filterGroup: { conjunction: 'and', conditions: [] },
          quickFilterValues: {},
        })
        break
      case 'edit_cell':
        if (record && column) {
          const rect = gridAdapterRef.current?.getCellViewportRect(record._id, column.key) ?? {
            x,
            y,
            width: column.width,
            height: 38,
          }
          if (column.type === 'select' || column.type === 'date') {
            setActiveCellEdit({ record, column, rect, value: record[column.key] })
          } else if (column.type === 'lookup' && column.lookupConfig?.mode === 'one') {
            const groupId = column.lookupConfig.groupId
            const conflict = pipeline.conflictsByRow.get(record._id)?.get(groupId)
            if (conflict && conflict.candidates.length > 1) {
              setActiveConflict({ record, column, conflict, rect })
            }
          } else if (column.type === 'checkbox') {
            void handleUpdateRecord(record._id, { [column.key]: !record[column.key] })
          } else {
            gridAdapterRef.current?.startEditCell(record._id, column.key)
          }
        }
        break
      case 'apply_selection_style':
      case 'clear_selection_style':
        if (activeStoredView) {
          const targetSelection: SmartGridSelectionInfo =
            selection.ranges.length > 0
              ? selection
              : record && column
                ? {
                    ranges: [
                      {
                        start: { col: 0, row: 0 },
                        end: { col: 0, row: 0 },
                        recordIds: [record._id],
                        columnKeys: [column.key],
                      },
                    ],
                    recordIds: [record._id],
                    columnKeys: [column.key],
                    focus: null,
                  }
                : EMPTY_SELECTION
          const nextCellStyles = applyCellStyleToSelection(
            activeStoredView.cellStyles,
            targetSelection,
            action === 'clear_selection_style' ? null : (stylePatch ?? null),
          )
          void handlePatchView(activeStoredView.id, { cellStyles: nextCellStyles })
        }
        break
      case 'open_selection_style':
        setConfigDrawerTab('styles')
        setConfigDrawerOpen(true)
        break
      case 'add_row':
        void handleAddRow()
        break
      case 'duplicate_row':
        if (record) {
          const copy: Record<string, unknown> = {}
          for (const col of activeTable.meta.columns) {
            if (col.type === 'formula' || col.type === 'lookup') continue
            if (activeTable.meta.primaryKeyField && col.key === activeTable.meta.primaryKeyField) {
              copy[col.key] = resolvePrimaryKeyValue(
                activeTable.meta,
                Date.now().toString(36).slice(-4).toUpperCase(),
              )
            } else {
              copy[col.key] = record[col.key]
            }
          }
          void handleAddRow(copy)
        }
        break
      case 'delete_row':
        if (record) {
          const ids =
            selectedRecordIds.includes(record._id) && selectedRecordIds.length > 1
              ? selectedRecordIds
              : [record._id]
          void handleDeleteRecords(ids)
        }
        break
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50 text-slate-500">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
          aria-hidden="true"
        />
        <div className="text-xs">正在加载智能表格工作台...</div>
      </div>
    )
  }

  if (!activeTable) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="flex max-w-sm flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <Table2 className="mb-3 h-7 w-7 text-slate-400" />
          <div className="text-sm font-semibold text-slate-900">未加载到数据表</div>
          <div className="mt-1 text-xs text-slate-500">
            {loadError || '请确认后端服务已启动并可正常访问。'}
          </div>
          <button
            type="button"
            onClick={() => void loadWorkspace()}
            className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>重试加载</span>
          </button>
        </div>
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  const activePivotConfig =
    effectiveView?.pivotConfig ?? buildDefaultPivotConfig(activeTable.meta.columns)
  const hasActiveFilters = Boolean(
    effectiveView &&
    (effectiveView.filterGroup.conditions.length > 0 ||
      Object.values(effectiveView.quickFilterValues ?? {}).some((v) => v.length > 0)),
  )
  const showGridEmptyOverlay = activeRenderKind === 'grid' && pipeline.displayRecords.length === 0

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900">
      <ToastHost toasts={toasts} onDismiss={dismissToast} />

      <Sidebar
        mode={mode}
        apps={apps}
        views={views}
        tables={tables}
        activeTarget={activeTarget}
        busy={busy}
        createAppDraftRequest={createAppDraftRequest}
        onSelectApp={handleSelectApp}
        onCreateApp={handleCreateApp}
        onRenameApp={handleRenameApp}
        onDeleteApp={handleDeleteApp}
        onReorderApps={handleReorderApps}
        onSelectTable={handleSelectTable}
        onCreateNormalTable={handleCreateNormalTable}
        onRenameTable={handleRenameTable}
        onDeleteTable={handleDeleteTable}
        onOpenImport={() => setShowImportModal(true)}
        onResetSeed={handleResetSeed}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {activeTarget.kind === 'app' && activeApp && (
          <AppViewTabs
            mode={mode}
            app={activeApp}
            bundle={activeTable}
            views={activeAppViews}
            activeViewId={activeStoredView?.id ?? ''}
            busy={busy}
            onSelectView={handleSelectView}
            onCreateView={handleCreateView}
            onRenameView={handleRenameView}
            onDeleteView={handleDeleteView}
            onReorderViews={handleReorderViews}
            onJumpToDatasource={mode === 'operator' ? handleSelectTable : undefined}
          />
        )}

        <Toolbar
          mode={mode}
          targetKind={activeTarget.kind}
          tableMeta={activeTable.meta}
          activeView={effectiveView}
          visibleColumns={visibleColumns}
          allComputedRecords={pipeline.allComputedRecords}
          displayRecords={pipeline.displayRecords}
          unresolvedConflictCount={pipeline.unresolvedConflictCount}
          selectedRecordIds={selectedRecordIds}
          watermarkEnabled={watermarkEnabled}
          configDrawerOpen={configDrawerOpen}
          busy={busy}
          onToggleMode={handleToggleMode}
          onUpdateFilters={handleUpdateFilters}
          onToggleConfigDrawer={() => {
            if (activeStoredView?.type === 'pivot') {
              setConfigDrawerTab('pivot')
            } else if (activeStoredView?.type === 'kanban') {
              setConfigDrawerTab('kanban')
            } else if (activeStoredView?.type === 'dashboard') {
              setConfigDrawerTab('dashboard')
            } else if (
              configDrawerTab === 'pivot' ||
              configDrawerTab === 'kanban' ||
              configDrawerTab === 'dashboard'
            ) {
              setConfigDrawerTab('fields')
            }
            setConfigDrawerOpen((v) => !v)
          }}
          onAddRow={() => handleAddRow()}
          onDeleteSelectedRows={() => handleDeleteRecords(selectedRecordIds)}
          onOpenAddColumn={() => setShowAddColumn(true)}
          onOpenColumnManager={() => setShowColumnManager(true)}
          onOpenLookupWizard={() => setShowLookupWizard(true)}
          onCreateAppFromTable={() =>
            setCreateAppDraftRequest({ tableId: activeTable.meta.id, nonce: Date.now() })
          }
          onJumpToFirstConflict={handleJumpToFirstConflict}
          onToggleWatermark={() => setWatermarkEnabled((v) => !v)}
          onNotify={pushToast}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 工作区主画布 */}
          <div className="relative min-w-0 flex-1 overflow-hidden bg-white">
            {activeRenderKind === 'kanban' && effectiveView ? (
              <KanbanView
                view={effectiveView}
                columns={activeTable.meta.columns}
                records={pipeline.displayRecords}
                readonly={mode === 'viewer'}
                primaryKeyField={activeTable.meta.primaryKeyField}
                onMoveCard={handleMoveKanbanCard}
                onUpdateRecord={handleUpdateRecord}
                onAddCard={mode === 'operator' ? () => handleAddRow() : undefined}
                onOpenConfig={
                  mode === 'operator'
                    ? () => {
                        setConfigDrawerTab('kanban')
                        setConfigDrawerOpen(true)
                      }
                    : undefined
                }
              />
            ) : activeRenderKind === 'dashboard' && effectiveView ? (
              <DashboardView
                view={effectiveView}
                columns={activeTable.meta.columns}
                records={pipeline.displayRecords}
                readonly={mode === 'viewer'}
                selectedItem={mode === 'operator' ? selectedDashboardItem : null}
                onSelectItem={
                  mode === 'operator'
                    ? (item) => {
                        setSelectedDashboardItem(item)
                        if (item) {
                          setConfigDrawerTab('dashboard')
                          setConfigDrawerOpen(true)
                        }
                      }
                    : undefined
                }
                onChangeConfig={
                  mode === 'operator'
                    ? (nextDashboard) =>
                        void handlePatchView(effectiveView.id, { dashboardConfig: nextDashboard })
                    : undefined
                }
                onOpenConfig={
                  mode === 'operator'
                    ? () => {
                        setConfigDrawerTab('dashboard')
                        setConfigDrawerOpen(true)
                      }
                    : undefined
                }
              />
            ) : (
              <>
                <div ref={canvasContainerRef} className="h-full w-full" />
                {showGridEmptyOverlay && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/75 p-6">
                    <div className="pointer-events-auto flex max-w-sm flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                      {pipeline.allComputedRecords.length === 0 ? (
                        <>
                          <Table2 className="mb-2.5 h-7 w-7 text-slate-400" />
                          <div className="text-sm font-semibold text-slate-900">
                            当前数据表暂无记录
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {mode === 'operator'
                              ? '添加第一条数据以开始管理与跨表关联计算。'
                              : '当前视图暂无可展示的数据记录。'}
                          </div>
                          {mode === 'operator' && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleAddRow()}
                              className="mt-4 inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>添加第一条记录</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <Filter className="mb-2.5 h-6 w-6 text-slate-400" />
                          <div className="text-sm font-semibold text-slate-900">
                            没有符合筛选条件的记录
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            当前共有 {pipeline.allComputedRecords.length} 条记录被筛选条件过滤。
                          </div>
                          {hasActiveFilters && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleUpdateFilters({
                                  filterGroup: { conjunction: 'and', conditions: [] },
                                  quickFilterValues: {},
                                })
                              }
                              className="mt-4 h-8 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
                            >
                              清空全部筛选
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 统一右侧滑出式视图配置抽屉（仅运维配置态 + 智能表格视图模式） */}
          {mode === 'operator' && activeTarget.kind === 'app' && activeStoredView && (
            <ViewConfigDrawer
              open={configDrawerOpen}
              activeTab={configDrawerTab}
              view={activeStoredView}
              tableMeta={activeTable.meta}
              selectionInfo={selectionInfo}
              focusedColumnKey={focusedStyleColKey}
              pivotConfig={activePivotConfig}
              selectedDashboardItem={selectedDashboardItem}
              busy={busy}
              onTabChange={setConfigDrawerTab}
              onClose={() => {
                setConfigDrawerOpen(false)
                setSelectedDashboardItem(null)
              }}
              onUpdateView={(patch) => void handlePatchView(activeStoredView.id, patch)}
              onSelectDashboardItem={setSelectedDashboardItem}
              onOpenAddColumn={() => setShowAddColumn(true)}
              onOpenColumnManager={() => setShowColumnManager(true)}
              onOpenLookupWizard={() => setShowLookupWizard(true)}
              onExpandAllPivot={() => pivotAdapterRef.current?.expandAll()}
              onCollapseAllPivot={() => pivotAdapterRef.current?.collapseAll()}
            />
          )}
        </div>
      </main>

      {/* 底部汇总格轻量统计菜单 */}
      {mode === 'operator' && summaryMenu && (
        <SummaryMenuPopover
          info={summaryMenu}
          onSelect={handleChangeSummary}
          onClose={() => setSummaryMenu(null)}
        />
      )}

      {/* 列头按钮气泡与三区域右键菜单 */}
      {popupMenu && (
        <GridPopupMenu
          context={popupMenu}
          onAction={handleGridMenuAction}
          onClose={() => setPopupMenu(null)}
        />
      )}

      {/* 运维弹窗与浮层 */}
      {mode === 'operator' && showAddColumn && (
        <AddColumnModal
          columns={activeTable.meta.columns}
          onClose={() => setShowAddColumn(false)}
          onSubmit={(col) => handleAddColumns([col])}
        />
      )}

      {mode === 'operator' && showColumnManager && (
        <ColumnManagerModal
          tableKind={activeTable.meta.kind}
          primaryKeyField={activeTable.meta.primaryKeyField}
          columns={activeTable.meta.columns}
          busy={busy}
          onClose={() => setShowColumnManager(false)}
          onRenameColumn={handleRenameColumn}
          onDeleteColumn={handleDeleteColumn}
          onEditLookupColumn={(columnKey, anchor) =>
            setFieldSettings({ columnKey, rect: anchor.getBoundingClientRect() })
          }
        />
      )}

      {mode === 'operator' && showLookupWizard && (
        <LookupWizardModal
          sourceTable={activeTable}
          sourceComputedRecords={pipeline.allComputedRecords}
          allTables={tables}
          onClose={() => setShowLookupWizard(false)}
          onSubmitColumns={handleAddColumns}
        />
      )}

      {mode === 'operator' &&
        fieldSettings &&
        activeTable.meta.columns.some(
          (col) => col.key === fieldSettings.columnKey && col.type === 'lookup',
        ) && (
          <LookupFieldPanel
            columnKey={fieldSettings.columnKey}
            rect={fieldSettings.rect}
            sourceTable={activeTable}
            sourceComputedRecords={pipeline.allComputedRecords}
            allTables={tables}
            onClose={() => setFieldSettings(null)}
            onSave={handleSaveLookupColumns}
            onDeleteColumn={handleDeleteColumn}
          />
        )}

      {mode === 'operator' && showImportModal && (
        <ImportExcelModal
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
          onError={(msg) => pushToast('error', msg)}
        />
      )}

      {drillEvent && activeRenderKind === 'pivot' && (
        <DrillDownDrawer
          drillEvent={drillEvent}
          columns={activeTable.meta.columns}
          allComputedRecords={pipeline.allComputedRecords}
          conflictsByRow={pipeline.conflictsByRow}
          pivotConfig={activePivotConfig}
          readonly={mode === 'viewer'}
          hasActiveOverlay={Boolean(activeConflict || activeCellEdit)}
          onClose={() => setDrillEvent(null)}
          onUpdateRecord={handleUpdateRecord}
          onConflictClick={(info) => {
            if (mode === 'operator') setActiveConflict(info)
          }}
          onRichCellEdit={(info) => {
            if (mode === 'operator') setActiveCellEdit(info)
          }}
          onValidationError={(msg) => pushToast('error', msg)}
        />
      )}

      {mode === 'operator' && activeConflict && (
        <DisambiguatePopover
          conflictInfo={activeConflict}
          sourceColumns={activeTable.meta.columns}
          targetBundle={tablesById.get(activeConflict.conflict.targetTableId)}
          onClose={() => setActiveConflict(null)}
          onSelectCandidate={handleSelectConflictCandidate}
          onAppendMatchRule={handleAppendMatchRule}
        />
      )}

      {mode === 'operator' && activeCellEdit && (
        <CellEditorPopover
          editInfo={activeCellEdit}
          allowCreateSelectOption={activeTable.meta.kind === 'normal'}
          onClose={() => setActiveCellEdit(null)}
          onCommit={(recordId, fieldKey, value) =>
            handleUpdateRecord(recordId, { [fieldKey]: value })
          }
          onCreateSelectOption={handleCreateSelectOption}
        />
      )}

      <ConfirmModal
        open={confirmDeleteCol !== null}
        title="确认删除字段列"
        description={`确定要删除字段「${confirmDeleteCol?.title ?? ''}」吗？相关筛选、排序与汇总配置将同步移除。`}
        confirmText="删除字段"
        busy={busy}
        onCancel={() => setConfirmDeleteCol(null)}
        onConfirm={async () => {
          if (!confirmDeleteCol) return
          await handleDeleteColumn(confirmDeleteCol.key)
          setConfirmDeleteCol(null)
        }}
      />
    </div>
  )
}
