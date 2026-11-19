// 多维数据台主壳：串联 History 路由单源、会话认证门禁、最左 NavRail + 二级目录双栏架构、
// 真实两层权限能力裁剪、领域计算管线、Grid/Pivot/Kanban/Dashboard 视图及独立数据录入端。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import type { Region } from '@infinitable/render'
import { AlertTriangle, ArrowLeft, Filter, Lock, Plus, Share2, Table2 } from 'lucide-react'
import {
  ApiError,
  batchAppendRecords,
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
  fetchDemoAccounts,
  fetchMe,
  fetchTableBundle,
  login,
  logout,
  moveKanbanCard,
  reorderSmartApps,
  reorderWorkspaceViews,
  resetDemoSeedWorkspace,
  setUnauthorizedHandler,
  updateRecord,
  updateSmartApp,
  updateTableMeta,
  updateWorkspaceView,
  type RecordWriteContext,
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
import { EntryWorkspace } from './components/EntryWorkspace'
import {
  GridPopupMenu,
  type GridMenuActionId,
  type GridMenuContext,
} from './components/GridPopupMenu'
import { ImportExcelModal } from './components/ImportExcelModal'
import { KanbanView } from './components/KanbanView'
import { LoginPage } from './components/LoginPage'
import { LookupFieldPanel } from './components/LookupFieldPanel'
import { LookupWizardModal } from './components/LookupWizardModal'
import { NavRail } from './components/NavRail'
import { PermissionsPage } from './components/PermissionsPage'
import { Sidebar, type SidebarSection } from './components/Sidebar'
import { SummaryMenuPopover } from './components/SummaryMenuPopover'
import { ToastHost, type ToastItem, type ToastType } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { ViewConfigDrawer, type ConfigDrawerTab } from './components/ViewConfigDrawer'
import { appendMatchRuleToLookupGroup, getBlockedLookupSourceKeys } from './domain/lookup-engine'
import { computeUserCapabilities } from './domain/permissions'
import { runSmartTablePipeline } from './domain/query-engine'
import {
  buildAbsoluteRouteUrl,
  buildRoutePath,
  getNavSectionForRoute,
  navigateToRoute,
  parseRouteFromLocation,
  readCurrentRoute,
  subscribeRouteChange,
  type AppRoute,
  type NavSection,
} from './domain/router'
import { resolveVisibleColumns } from './domain/style-engine'
import { scalarToText } from './domain/utils'
import {
  applyCellStyleToSelection,
  buildDefaultKanbanConfig,
  buildDefaultPivotConfig,
  canConfigureAppItem,
  canConfigureViewItem,
  canEditEntryTableItem,
  resolveWorkspaceActionCapabilities,
  toggleHiddenColumn,
} from './domain/workspace-helpers'
import type {
  AuthSessionResponse,
  CreateAppRequest,
  CreateViewRequest,
  TableBundle,
  UpdateAppRequest,
  UpdateViewRequest,
} from './shared/api-types'
import {
  filterRawColumns,
  isDerivedColumn,
  mergeSmartColumns,
  type CellStyleConfig,
  type DemoAccountInfo,
  type FilterGroup,
  type LookupMatchRule,
  type SelectOption,
  type SmartApp,
  type SmartColumn,
  type SmartRecord,
  type SmartTableMeta,
  type SortRule,
  type SummaryType,
  type WorkspaceView,
} from './shared/schema'

interface LocalFilterOverride {
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
  const rawColumns = filterRawColumns(meta.columns)
  const firstTextKey = rawColumns.find(
    (c) => c.type === 'text' && c.key !== meta.primaryKeyField,
  )?.key

  for (const col of rawColumns) {
    if (meta.primaryKeyField && col.key === meta.primaryKeyField) {
      row[col.key] = resolvePrimaryKeyValue(meta, suffix)
    } else if (col.type === 'checkbox') {
      row[col.key] = false
    } else if (col.type === 'progress' || col.type === 'number') {
      row[col.key] = 0
    } else if (col.type === 'date') {
      row[col.key] = new Date().toISOString().slice(0, 10)
    } else if (col.type === 'select') {
      if (col.options && col.options.length > 0) {
        row[col.key] = col.options[0]!.label
      } else {
        row[col.key] = col.required ? '待选择' : ''
      }
    } else if (col.type === 'link') {
      row[col.key] = col.required ? { url: 'https://example.com', text: '待补充' } : ''
    } else if (col.type === 'image') {
      row[col.key] = col.required ? 'https://example.com/placeholder.png' : ''
    } else if (
      col.key === 'name' ||
      col.key === 'project_name' ||
      col.key === 'title' ||
      (meta.kind === 'normal' && col.key === firstTextKey)
    ) {
      row[col.key] = `新建记录 ${suffix}`
    } else if (col.required) {
      row[col.key] = `${col.title || '记录'} ${suffix}`
    } else {
      row[col.key] = ''
    }
  }
  return row
}

function pruneOrphanedLookupOverrides(
  overrides: Record<string, Record<string, string>> | undefined,
  derivedColumns: readonly SmartColumn[],
): { nextOverrides: Record<string, Record<string, string>>; changed: boolean } {
  if (!overrides) return { nextOverrides: {}, changed: false }
  const activeGroupIds = new Set(
    derivedColumns
      .filter((col) => col.type === 'lookup' && col.lookupConfig?.mode === 'one')
      .map((col) => col.lookupConfig!.groupId),
  )
  let changed = false
  const nextOverrides: Record<string, Record<string, string>> = {}
  for (const [recordId, groupMap] of Object.entries(overrides)) {
    const nextGroupMap: Record<string, string> = {}
    for (const [groupId, targetId] of Object.entries(groupMap)) {
      if (activeGroupIds.has(groupId)) {
        nextGroupMap[groupId] = targetId
      } else {
        changed = true
      }
    }
    if (Object.keys(nextGroupMap).length > 0) {
      nextOverrides[recordId] = nextGroupMap
    } else if (Object.keys(groupMap).length > 0) {
      changed = true
    }
  }
  return { nextOverrides, changed }
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

function canRenameColInTable(
  meta: SmartTableMeta,
  col: SmartColumn,
  targetKind: 'app' | 'datasource',
): boolean {
  if (targetKind === 'app') {
    return isDerivedColumn(col)
  }
  return !isDerivedColumn(col) && meta.kind === 'normal'
}

function canDeleteColInTable(
  meta: SmartTableMeta,
  col: SmartColumn,
  targetKind: 'app' | 'datasource',
): boolean {
  if (targetKind === 'app') {
    return isDerivedColumn(col)
  }
  if (isDerivedColumn(col)) return false
  if (filterRawColumns(meta.columns).length <= 1) return false
  if (col.isUniqueKey || (meta.primaryKeyField && col.key === meta.primaryKeyField)) return false
  return meta.kind === 'normal'
}

interface RouteStatusCardProps {
  icon: React.ReactNode
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondaryAction?: () => void
  testId?: string
}

function RouteStatusCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondaryAction,
  testId,
}: RouteStatusCardProps) {
  return (
    <div
      data-testid={testId}
      className="flex h-full w-full flex-col items-center justify-center bg-slate-50 p-6"
    >
      <div className="flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mb-3">{icon}</div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{description}</p>
        {(actionLabel || secondaryLabel) && (
          <div className="mt-4 flex items-center gap-2">
            {actionLabel && onAction && (
              <button
                type="button"
                onClick={onAction}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>{actionLabel}</span>
              </button>
            )}
            {secondaryLabel && onSecondaryAction && (
              <button
                type="button"
                onClick={onSecondaryAction}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <span>{secondaryLabel}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => readCurrentRoute().route)
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(
    () => (readCurrentRoute().route.kind === 'share' ? 'unauthenticated' : 'checking'),
  )
  const [session, setSession] = useState<AuthSessionResponse | null>(null)
  const [demoAccounts, setDemoAccounts] = useState<DemoAccountInfo[]>([])
  const [loadingDemoAccounts, setLoadingDemoAccounts] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)

  const [tables, setTables] = useState<TableBundle[]>([])
  const [apps, setApps] = useState<SmartApp[]>([])
  const [views, setViews] = useState<WorkspaceView[]>([])
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  // 未收录在 tables 中的 entryTableId 探测结果（用于精确呈现 403/404 不可用原因）
  const [probedEntryState, setProbedEntryState] = useState<{
    tableId: string
    loading: boolean
    error: string | null
  } | null>(null)

  // 临时状态：不可配置用户的本地筛选/排序覆盖、数据源视图临时排序、选中状态、弹窗/抽屉/气泡浮层
  const [localFilterOverride, setLocalFilterOverride] = useState<LocalFilterOverride | null>(null)
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
  const lastEntryTableIdRef = useRef<string | undefined>(undefined)
  const lastDatasourceTableIdRef = useRef<string | undefined>(undefined)
  const probedEntryIdRef = useRef<string | null>(null)
  const routeRef = useRef<AppRoute>(route)
  routeRef.current = route
  const authStatusRef = useRef(authStatus)
  authStatusRef.current = authStatus

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

  const resetAllWorkspaceState = useCallback(() => {
    setTables([])
    setApps([])
    setViews([])
    setWorkspaceLoaded(false)
    setLoadError(null)
    setProbedEntryState(null)
    setLocalFilterOverride(null)
    setDatasourceSortRules([])
    setConfigDrawerOpen(false)
    setShowLookupWizard(false)
    setShowAddColumn(false)
    setShowColumnManager(false)
    setShowImportModal(false)
    setConfirmDeleteCol(null)
    lastViewByAppRef.current.clear()
    lastEntryTableIdRef.current = undefined
    lastDatasourceTableIdRef.current = undefined
    probedEntryIdRef.current = null
    clearTransientOverlays()
  }, [clearTransientOverlays])

  const navigate = useCallback(
    (nextRoute: AppRoute, options?: { replace?: boolean }) => {
      navigateToRoute(nextRoute, options)
      setRoute(nextRoute)
      clearTransientOverlays()
    },
    [clearTransientOverlays],
  )

  // 订阅浏览器前进/后退
  useEffect(() => {
    return subscribeRouteChange((nextRoute) => {
      setRoute(nextRoute)
      clearTransientOverlays()
      setConfigDrawerOpen(false)
    })
  }, [clearTransientOverlays])

  // 加载内置演示账号清单
  const ensureDemoAccountsLoaded = useCallback(async () => {
    setLoadingDemoAccounts(true)
    try {
      const list = await fetchDemoAccounts()
      setDemoAccounts(list)
    } catch {
      // 忽略演示列表拉取失败，仍允许账号密码登录
    } finally {
      setLoadingDemoAccounts(false)
    }
  }, [])

  // 注册全局 401 会话失效处理器
  useEffect(() => {
    return setUnauthorizedHandler(() => {
      if (authStatusRef.current === 'unauthenticated') return
      const curRoute = routeRef.current
      if (curRoute.kind === 'share') return
      setSession(null)
      setAuthStatus('unauthenticated')
      resetAllWorkspaceState()
      void ensureDemoAccountsLoaded()
      pushToast('error', '登录会话已过期，请重新登录')
      if (curRoute.kind !== 'login') {
        const redirectTo = buildRoutePath(curRoute)
        navigate({ kind: 'login', redirectTo }, { replace: true })
      }
    })
  }, [ensureDemoAccountsLoaded, navigate, pushToast, resetAllWorkspaceState])

  // 会话初始化校验（仅非 /s/:token 路由执行）
  useEffect(() => {
    if (route.kind === 'share') return
    if (authStatus !== 'checking') return
    let cancelled = false
    void (async () => {
      try {
        const me = await fetchMe({ skipUnauthorizedNotify: true })
        if (cancelled) return
        setSession(me)
        setAuthStatus('authenticated')
        void ensureDemoAccountsLoaded()
        if (routeRef.current.kind === 'login') {
          const target = routeRef.current.redirectTo
            ? parseRouteFromLocation(routeRef.current.redirectTo)
            : { kind: 'apps' as const }
          navigate(target, { replace: true })
        }
      } catch {
        if (cancelled) return
        setSession(null)
        setAuthStatus('unauthenticated')
        void ensureDemoAccountsLoaded()
        if (routeRef.current.kind !== 'login') {
          const redirectTo = buildRoutePath(routeRef.current)
          navigate({ kind: 'login', redirectTo }, { replace: true })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authStatus, ensureDemoAccountsLoaded, navigate, route.kind])

  // 已登录访问 /login 自动跳回工作台或原目标路径；未登录访问受保护路由自动跳转 /login
  useEffect(() => {
    if (route.kind === 'share') return
    if (authStatus === 'authenticated' && route.kind === 'login') {
      const target = route.redirectTo
        ? parseRouteFromLocation(route.redirectTo)
        : { kind: 'apps' as const }
      navigate(target, { replace: true })
    } else if (authStatus === 'unauthenticated' && route.kind !== 'login') {
      const redirectTo = buildRoutePath(route)
      navigate({ kind: 'login', redirectTo }, { replace: true })
    }
  }, [authStatus, navigate, route])

  // 加载或同步工作台元数据与记录列表
  const syncWorkspaceSnapshot = useCallback(
    async (options?: { initial?: boolean }) => {
      const isInitial = options?.initial ?? false
      if (isInitial) {
        setLoading(true)
        setLoadError(null)
      }
      try {
        const [tableList, appList, viewList] = await Promise.all([
          fetchAllTables(),
          fetchAllApps(),
          fetchAllViews(),
        ])
        setTables(tableList)
        setApps(appList)
        setViews(viewList)
        setWorkspaceLoaded(true)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return
        }
        const msg = error instanceof Error ? error.message : '加载工作台失败'
        if (isInitial) {
          setLoadError(msg)
        }
        pushToast('error', msg)
      } finally {
        if (isInitial) {
          setLoading(false)
        }
      }
    },
    [pushToast],
  )

  const loadWorkspace = useCallback(
    () => syncWorkspaceSnapshot({ initial: true }),
    [syncWorkspaceSnapshot],
  )
  const refreshWorkspaceData = useCallback(() => syncWorkspaceSnapshot(), [syncWorkspaceSnapshot])

  useEffect(() => {
    if (
      authStatus === 'authenticated' &&
      route.kind !== 'login' &&
      route.kind !== 'share' &&
      !workspaceLoaded &&
      !loading
    ) {
      void loadWorkspace()
    }
  }, [authStatus, route.kind, workspaceLoaded, loading, loadWorkspace])

  const handleLoginSubmit = useCallback(
    async (username: string, password: string) => {
      setBusy(true)
      setLoginError(null)
      try {
        const res = await login({ username, password })
        resetAllWorkspaceState()
        setSession(res)
        setAuthStatus('authenticated')
        void ensureDemoAccountsLoaded()
        const target =
          routeRef.current.kind === 'login' && routeRef.current.redirectTo
            ? parseRouteFromLocation(routeRef.current.redirectTo)
            : { kind: 'apps' as const }
        navigate(target, { replace: true })
        pushToast('success', `欢迎回来，${res.user.displayName}`)
      } catch (error) {
        const msg = error instanceof Error ? error.message : '登录失败，请检查账号和密码'
        setLoginError(msg)
        throw error
      } finally {
        setBusy(false)
      }
    },
    [ensureDemoAccountsLoaded, navigate, pushToast, resetAllWorkspaceState],
  )

  const handleLogout = useCallback(async () => {
    setBusy(true)
    try {
      await logout().catch(() => {})
      setSession(null)
      setAuthStatus('unauthenticated')
      setLoginError(null)
      resetAllWorkspaceState()
      void ensureDemoAccountsLoaded()
      navigate({ kind: 'login' }, { replace: true })
      pushToast('info', '已退出登录')
    } finally {
      setBusy(false)
    }
  }, [ensureDemoAccountsLoaded, navigate, pushToast, resetAllWorkspaceState])

  const handleSwitchAccount = useCallback(
    async (account: DemoAccountInfo) => {
      setBusy(true)
      try {
        const res = await login({ username: account.username, password: account.password })
        resetAllWorkspaceState()
        setSession(res)
        setAuthStatus('authenticated')
        navigate({ kind: 'apps' }, { replace: true })
        pushToast('success', `已切换为「${res.user.displayName}」`)
      } catch (error) {
        const msg = error instanceof Error ? error.message : '切换账号失败'
        pushToast('error', msg)
      } finally {
        setBusy(false)
      }
    },
    [navigate, pushToast, resetAllWorkspaceState],
  )

  const userCapabilities = useMemo(() => {
    if (session?.capabilities) return session.capabilities
    if (session?.user) return computeUserCapabilities(session.user)
    return {
      canAccessDataSources: false,
      canCreateTable: false,
      canCreateApp: false,
      canManagePermissions: false,
      canManageShares: false,
      canResetSeed: false,
    }
  }, [session])

  const tablesById = useMemo(() => {
    const map = new Map<string, TableBundle>()
    for (const bundle of tables) map.set(bundle.meta.id, bundle)
    return map
  }, [tables])

  const normalEntryTables = useMemo(
    () =>
      tables
        .filter((bundle) => bundle.meta.kind === 'normal')
        .map((bundle) => ({ id: bundle.meta.id, name: bundle.meta.name })),
    [tables],
  )

  const entryRouteTableId = route.kind === 'entries' ? route.tableId : undefined
  const hasEntryTableInState = entryRouteTableId ? tablesById.has(entryRouteTableId) : false

  // /entries/:tableId 找不到表时尝试单表探测以获取精准 403/404 原因
  useEffect(() => {
    if (!entryRouteTableId || !workspaceLoaded) {
      return
    }
    if (hasEntryTableInState) {
      probedEntryIdRef.current = null
      setProbedEntryState(null)
      return
    }
    if (probedEntryIdRef.current === entryRouteTableId) {
      return
    }
    probedEntryIdRef.current = entryRouteTableId
    let cancelled = false
    setProbedEntryState({ tableId: entryRouteTableId, loading: true, error: null })
    void fetchTableBundle(entryRouteTableId)
      .then((bundle) => {
        if (cancelled) return
        setTables((prev) =>
          prev.some((b) => b.meta.id === bundle.meta.id) ? prev : [...prev, bundle],
        )
        setProbedEntryState(null)
      })
      .catch((error) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) return
        const msg =
          error instanceof Error ? error.message : `数据表「${entryRouteTableId}」不存在或无法访问`
        setProbedEntryState({ tableId: entryRouteTableId, loading: false, error: msg })
      })
    return () => {
      cancelled = true
    }
  }, [entryRouteTableId, workspaceLoaded, hasEntryTableInState])

  // 默认落点与未指定 ID 路由规范化
  const activeApp = useMemo(() => {
    if (route.kind !== 'apps') return undefined
    if (route.appId) {
      return apps.find((a) => a.id === route.appId) ?? apps[0]
    }
    return apps[0]
  }, [route, apps])

  const activeAppViews = useMemo(() => {
    if (!activeApp) return []
    return views.filter((v) => v.appId === activeApp.id)
  }, [activeApp, views])

  const activeStoredView = useMemo(() => {
    if (route.kind !== 'apps' || !activeApp) return undefined
    if (route.viewId) {
      const exact = activeAppViews.find((v) => v.id === route.viewId)
      if (exact) return exact
    }
    const remembered = lastViewByAppRef.current.get(activeApp.id)
    if (remembered) {
      const found = activeAppViews.find((v) => v.id === remembered)
      if (found) return found
    }
    return activeAppViews[0]
  }, [route, activeApp, activeAppViews])

  useEffect(() => {
    if (authStatus !== 'authenticated' || !workspaceLoaded) return

    if (route.kind === 'apps' && activeApp && activeStoredView) {
      lastViewByAppRef.current.set(activeApp.id, activeStoredView.id)
      if (route.appId !== activeApp.id || route.viewId !== activeStoredView.id) {
        navigate(
          { kind: 'apps', appId: activeApp.id, viewId: activeStoredView.id },
          { replace: true },
        )
      }
      return
    }

    if (route.kind === 'entries') {
      if (route.tableId) {
        lastEntryTableIdRef.current = route.tableId
      } else if (normalEntryTables[0]) {
        navigate({ kind: 'entries', tableId: normalEntryTables[0].id }, { replace: true })
      }
      return
    }

    if (route.kind === 'datasources' && userCapabilities.canAccessDataSources) {
      if (route.tableId) {
        lastDatasourceTableIdRef.current = route.tableId
      } else if (tables[0]) {
        navigate({ kind: 'datasources', tableId: tables[0].meta.id }, { replace: true })
      }
    }
  }, [
    authStatus,
    workspaceLoaded,
    route,
    activeApp,
    activeStoredView,
    normalEntryTables,
    tables,
    userCapabilities.canAccessDataSources,
    navigate,
  ])

  const targetKind: 'app' | 'datasource' = route.kind === 'datasources' ? 'datasource' : 'app'

  const activeTable = useMemo(() => {
    if (route.kind === 'datasources') {
      if (!userCapabilities.canAccessDataSources) return undefined
      if (route.tableId) return tablesById.get(route.tableId)
      return tables[0]
    }
    if (route.kind === 'apps') {
      if (activeStoredView) return tablesById.get(activeStoredView.tableId)
      if (activeApp) return tablesById.get(activeApp.tableId)
    }
    return undefined
  }, [
    route,
    userCapabilities.canAccessDataSources,
    tablesById,
    tables,
    activeStoredView,
    activeApp,
  ])

  const actionCapabilities = useMemo(
    () =>
      resolveWorkspaceActionCapabilities({
        user: session?.user,
        userCapabilities,
        targetKind,
        app: targetKind === 'app' ? activeApp : undefined,
        view: targetKind === 'app' ? activeStoredView : undefined,
        table: activeTable?.meta,
        allApps: apps,
        allViews: views,
      }),
    [
      session?.user,
      userCapabilities,
      targetKind,
      activeApp,
      activeStoredView,
      activeTable,
      apps,
      views,
    ],
  )

  const activeAppDerivedColumns = useMemo(
    () => (targetKind === 'app' ? (activeApp?.derivedColumns ?? []) : []),
    [targetKind, activeApp?.derivedColumns],
  )

  const activeColumns = useMemo(() => {
    if (!activeTable) return []
    if (targetKind === 'datasource') {
      return filterRawColumns(activeTable.meta.columns)
    }
    return mergeSmartColumns(activeTable.meta.columns, activeAppDerivedColumns)
  }, [activeTable, targetKind, activeAppDerivedColumns])

  const effectiveTableMeta = useMemo(
    () => (activeTable ? { ...activeTable.meta, columns: activeColumns } : undefined),
    [activeTable, activeColumns],
  )

  const effectiveTableBundle = useMemo(
    () =>
      activeTable && effectiveTableMeta ? { ...activeTable, meta: effectiveTableMeta } : undefined,
    [activeTable, effectiveTableMeta],
  )

  // 无视图配置权时，临时筛选与排序保留在会话内存而不回写视图接口
  const effectiveView: WorkspaceView | undefined = useMemo(() => {
    if (!activeStoredView) return undefined
    if (!actionCapabilities.canConfigure && localFilterOverride?.viewId === activeStoredView.id) {
      return {
        ...activeStoredView,
        filterGroup: localFilterOverride.filterGroup,
        quickFilterValues: localFilterOverride.quickFilterValues,
        sortRules: localFilterOverride.sortRules,
      }
    }
    return activeStoredView
  }, [activeStoredView, actionCapabilities.canConfigure, localFilterOverride])

  const pipelineView = useMemo(() => {
    if (targetKind === 'datasource' && activeTable) {
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
  }, [targetKind, activeTable, datasourceSortRules, effectiveView])

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
    const appContext =
      targetKind === 'app' && activeApp
        ? {
            derivedColumns: activeAppDerivedColumns,
            lookupOverrides: activeApp.lookupOverrides ?? {},
          }
        : undefined
    return runSmartTablePipeline(
      activeTable.meta,
      activeTable.records,
      tablesById,
      pipelineView,
      appContext,
    )
  }, [activeTable, targetKind, activeApp, activeAppDerivedColumns, tablesById, pipelineView])

  const visibleColumns = useMemo(() => {
    if (!activeTable) return []
    if (targetKind === 'datasource') return [...activeColumns]
    return resolveVisibleColumns(activeColumns, effectiveView)
  }, [activeTable, targetKind, activeColumns, effectiveView])

  // 权限收窄时自动关闭配置浮层
  useEffect(() => {
    if (!actionCapabilities.canConfigure) {
      setConfigDrawerOpen(false)
      setShowLookupWizard(false)
      setShowAddColumn(false)
      setShowColumnManager(false)
      setFieldSettings(null)
      setActiveConflict(null)
      setSummaryMenu(null)
    }
    if (!actionCapabilities.canEditRecords) {
      setActiveCellEdit(null)
    }
  }, [actionCapabilities.canConfigure, actionCapabilities.canEditRecords])

  // ---- 统一表记录变更（工作台与录入端共用）----
  const updateRecordInTable = useCallback(
    async (
      tableId: string,
      recordId: string,
      patch: Record<string, unknown>,
      context?: RecordWriteContext,
    ): Promise<SmartRecord> => {
      try {
        const updated = await updateRecord(tableId, recordId, patch, context)
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
        return updated
      } catch (error) {
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
    [],
  )

  const deleteRecordsInTable = useCallback(
    async (tableId: string, recordIds: readonly string[], context?: RecordWriteContext) => {
      if (recordIds.length === 0) return
      const targetIds = [...recordIds]
      setBusy(true)
      try {
        const results = await Promise.allSettled(
          targetIds.map((id) => deleteRecord(tableId, id, context)),
        )
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
          const msg =
            succeededIds.size > 0
              ? `已删除 ${succeededIds.size} 条，另有 ${failedCount} 条删除失败`
              : `删除失败（${failedCount} 条）`
          pushToast('error', msg)
          throw new Error(msg)
        }
      } finally {
        setBusy(false)
      }
    },
    [pushToast],
  )

  const activeWriteContext = useMemo<RecordWriteContext | undefined>(() => {
    if (targetKind === 'app' && activeApp) {
      return {
        appId: activeApp.id,
        ...(activeStoredView ? { viewId: activeStoredView.id } : {}),
      }
    }
    return undefined
  }, [targetKind, activeApp, activeStoredView])

  // ---- 导航与路由切换 ----
  const handleNavSection = useCallback(
    (section: NavSection) => {
      switch (section) {
        case 'apps': {
          const fallbackApp = activeApp ?? apps[0]
          if (fallbackApp) {
            const rememberedViewId = lastViewByAppRef.current.get(fallbackApp.id)
            const appViews = views.filter((v) => v.appId === fallbackApp.id)
            const viewId =
              (rememberedViewId
                ? appViews.find((v) => v.id === rememberedViewId)?.id
                : undefined) ?? appViews[0]?.id
            if (viewId) {
              navigate({ kind: 'apps', appId: fallbackApp.id, viewId })
              return
            }
          }
          navigate({ kind: 'apps' })
          return
        }
        case 'entries': {
          const targetId =
            (lastEntryTableIdRef.current && tablesById.has(lastEntryTableIdRef.current)
              ? lastEntryTableIdRef.current
              : undefined) ?? normalEntryTables[0]?.id
          navigate(targetId ? { kind: 'entries', tableId: targetId } : { kind: 'entries' })
          return
        }
        case 'datasources': {
          const targetId =
            (lastDatasourceTableIdRef.current && tablesById.has(lastDatasourceTableIdRef.current)
              ? lastDatasourceTableIdRef.current
              : undefined) ?? tables[0]?.meta.id
          navigate(targetId ? { kind: 'datasources', tableId: targetId } : { kind: 'datasources' })
          return
        }
        case 'shares':
          navigate({ kind: 'shares' })
          return
        case 'permissions':
          navigate({ kind: 'permissions' })
          return
      }
    },
    [activeApp, apps, views, tablesById, normalEntryTables, tables, navigate],
  )

  const handleSelectApp = useCallback(
    (appId: string) => {
      const appViews = views.filter((v) => v.appId === appId)
      const rememberedId = lastViewByAppRef.current.get(appId)
      const nextView =
        (rememberedId ? appViews.find((v) => v.id === rememberedId) : undefined) ?? appViews[0]
      setLocalFilterOverride(null)
      navigate({
        kind: 'apps',
        appId,
        ...(nextView ? { viewId: nextView.id } : {}),
      })
    },
    [views, navigate],
  )

  const handleSelectView = useCallback(
    (viewId: string) => {
      if (!activeApp) return
      lastViewByAppRef.current.set(activeApp.id, viewId)
      setLocalFilterOverride(null)
      navigate({ kind: 'apps', appId: activeApp.id, viewId })
    },
    [activeApp, navigate],
  )

  const handleSelectTable = useCallback(
    (tableId: string) => {
      if (!userCapabilities.canAccessDataSources) return
      setDatasourceSortRules([])
      setConfigDrawerOpen(false)
      setShowAddColumn(false)
      setShowColumnManager(false)
      setShowLookupWizard(false)
      navigate({ kind: 'datasources', tableId })
    },
    [userCapabilities.canAccessDataSources, navigate],
  )

  const handleEnterTableEntry = useCallback(
    (tableId: string) => {
      navigate({ kind: 'entries', tableId })
    },
    [navigate],
  )

  const handleOpenEntryNewTab = useCallback((tableId: string) => {
    if (typeof window === 'undefined') return
    const url = buildAbsoluteRouteUrl(window.location.href, { kind: 'entries', tableId })
    window.open(url, '_blank', 'noopener')
  }, [])

  const handleCopyEntryLink = useCallback(
    async (tableId: string) => {
      if (typeof window === 'undefined') return
      const url = buildAbsoluteRouteUrl(window.location.href, { kind: 'entries', tableId })
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url)
        }
        pushToast('success', '已复制数据录入链接')
      } catch {
        pushToast('error', '复制失败，请手动复制录入链接')
      }
    },
    [pushToast],
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

  const handleSaveSmartApp = useCallback(
    async (appId: string, patch: UpdateAppRequest, successToast?: string): Promise<SmartApp> => {
      setBusy(true)
      try {
        const saved = await updateSmartApp(appId, patch)
        setApps((prev) => prev.map((a) => (a.id === appId ? saved : a)))
        if (successToast) {
          pushToast('success', successToast)
        }
        return saved
      } catch (error) {
        const msg = error instanceof ApiError ? error.message : '保存智能表格配置失败'
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
      if (!activeTable || !actionCapabilities.canEditRecords) return
      try {
        await updateRecordInTable(activeTable.meta.id, recordId, patch, activeWriteContext)
        pushToast('success', '已保存')
      } catch (error) {
        const msg = error instanceof ApiError ? error.message : '更新记录失败'
        pushToast('error', msg)
        throw error
      }
    },
    [
      activeTable,
      actionCapabilities.canEditRecords,
      updateRecordInTable,
      activeWriteContext,
      pushToast,
    ],
  )

  const handleMoveKanbanCard = useCallback(
    async (recordId: string, targetLaneKey: string) => {
      if (!activeTable || !activeStoredView || !actionCapabilities.canEditRecords) return
      const tableId = activeTable.meta.id
      const kanbanCfg = activeStoredView.kanbanConfig ?? buildDefaultKanbanConfig(activeColumns)
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
    [activeTable, activeStoredView, actionCapabilities.canEditRecords, activeColumns, pushToast],
  )

  const focusAndOpenConflict = useCallback(
    (adapter: SmartGridAdapter, recordId: string, colKey: string) => {
      if (!activeTable || targetKind !== 'app') return
      const rec = pipeline.displayRecords.find((r) => r._id === recordId)
      const col = activeColumns.find((c) => c.key === colKey)
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
    [activeTable, targetKind, activeColumns, pipeline.conflictsByRow, pipeline.displayRecords],
  )

  const handleUpdateFilters = useCallback(
    (patch: { filterGroup?: FilterGroup; quickFilterValues?: Record<string, string[]> }) => {
      if (!effectiveView) return
      if (!actionCapabilities.canConfigure) {
        setLocalFilterOverride({
          viewId: effectiveView.id,
          filterGroup: patch.filterGroup ?? effectiveView.filterGroup,
          quickFilterValues: patch.quickFilterValues ?? effectiveView.quickFilterValues ?? {},
          sortRules: effectiveView.sortRules,
        })
        return
      }
      void handlePatchView(effectiveView.id, patch)
    },
    [effectiveView, actionCapabilities.canConfigure, handlePatchView],
  )

  const handleHeaderColumnSort = useCallback(
    (field: string, meta: { additive: boolean }) => {
      if (targetKind === 'datasource') {
        setDatasourceSortRules((prev) => cycleSortRules(prev, field, meta.additive))
        return
      }
      if (!effectiveView || effectiveView.type !== 'table') return
      const nextRules = cycleSortRules(effectiveView.sortRules, field, meta.additive)
      if (!actionCapabilities.canConfigure) {
        setLocalFilterOverride({
          viewId: effectiveView.id,
          filterGroup: effectiveView.filterGroup,
          quickFilterValues: effectiveView.quickFilterValues ?? {},
          sortRules: nextRules,
        })
        return
      }
      void handlePatchView(effectiveView.id, { sortRules: nextRules })
    },
    [targetKind, effectiveView, actionCapabilities.canConfigure, handlePatchView],
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
      const isDs = targetKind === 'datasource'
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
        canEditRecords: actionCapabilities.canEditRecords,
        canConfigure: actionCapabilities.canConfigure,
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
        canRenameColumn: params.column
          ? canRenameColInTable(meta, params.column, targetKind)
          : false,
        canDeleteColumn: params.column
          ? canDeleteColInTable(meta, params.column, targetKind)
          : false,
        hasSelectionCellStyles,
        isDatasourceMode: isDs,
      }
    },
    [
      activeTable,
      targetKind,
      datasourceSortRules,
      effectiveView,
      actionCapabilities.canEditRecords,
      actionCapabilities.canConfigure,
      visibleColumns.length,
    ],
  )

  const handleColWidthChange = useCallback(
    (info: { columnKey: string; width: number }) => {
      if (!actionCapabilities.canConfigure) return
      if (targetKind === 'app' && activeStoredView) {
        void handlePatchView(activeStoredView.id, {
          columnWidths: {
            ...activeStoredView.columnWidths,
            [info.columnKey]: info.width,
          },
        })
        return
      }
      if (targetKind === 'datasource' && activeTable) {
        const nextColumns = filterRawColumns(activeTable.meta.columns).map((col) =>
          col.key === info.columnKey ? { ...col, width: info.width } : col,
        )
        void handleSaveMeta(activeTable.meta.id, {
          ...activeTable.meta,
          columns: nextColumns,
        }).catch(() => {})
      }
    },
    [
      actionCapabilities.canConfigure,
      targetKind,
      activeStoredView,
      activeTable,
      handlePatchView,
      handleSaveMeta,
    ],
  )

  const handlersRef = useRef({
    onCellValueChange: handleUpdateRecord,
    onConflictClick: (info: SmartGridConflictClickInfo) => {
      if (actionCapabilities.canConfigure) setActiveConflict(info)
    },
    onRowSelectionChange: (ids: string[]) => setSelectedRecordIds(ids),
    onSelectionInfoChange: (info: SmartGridSelectionInfo) => setSelectionInfo(info),
    onRichCellEdit: (info: RichCellEditInfo) => {
      if (actionCapabilities.canEditRecords) setActiveCellEdit(info)
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
      if (actionCapabilities.canConfigure) setSummaryMenu(info)
    },
    onColWidthChange: handleColWidthChange,
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
      if (actionCapabilities.canConfigure) setActiveConflict(info)
    },
    onRowSelectionChange: (ids) => setSelectedRecordIds(ids),
    onSelectionInfoChange: (info) => setSelectionInfo(info),
    onRichCellEdit: (info) => {
      if (actionCapabilities.canEditRecords) setActiveCellEdit(info)
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
      if (actionCapabilities.canConfigure) setSummaryMenu(info)
    },
    onColWidthChange: handleColWidthChange,
    onContextMenu: (info) => {
      const ctx = buildMenuContext(info)
      if (ctx) setPopupMenu(ctx)
    },
  }

  const activeRenderKind: 'grid' | 'pivot' | 'kanban' | 'dashboard' | 'none' = useMemo(() => {
    if (route.kind !== 'apps' && route.kind !== 'datasources') return 'none'
    if (!activeTable) return 'none'
    if (targetKind === 'datasource') return 'grid'
    if (!effectiveView) return 'none'
    if (effectiveView.type === 'table') return 'grid'
    if (effectiveView.type === 'pivot') return 'pivot'
    return effectiveView.type
  }, [route.kind, activeTable, targetKind, effectiveView])

  const canvasMountKey =
    activeTable && (activeRenderKind === 'grid' || activeRenderKind === 'pivot')
      ? `${targetKind}:${targetKind === 'app' ? (effectiveView?.id ?? '') : activeTable.meta.id}:${activeRenderKind}:${actionCapabilities.canEditRecords ? 'rw' : 'ro'}:${actionCapabilities.canConfigure ? 'cfg' : 'nocfg'}`
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
      const isDs = targetKind === 'datasource'
      const curSort = isDs ? datasourceSortRules : (effectiveView?.sortRules ?? [])
      const curSummaries = isDs
        ? activeTable.meta.summaries
        : (effectiveView?.summaries ?? activeTable.meta.summaries)

      const adapter = new SmartGridAdapter({
        container,
        columns: activeColumns,
        records: pipeline.displayRecords,
        conflictsByRow: pipeline.conflictsByRow,
        readonly: !actionCapabilities.canEditRecords,
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
      const pivotConfig = effectiveView.pivotConfig ?? buildDefaultPivotConfig(activeColumns)
      const pivotAdapter = new SmartPivotAdapter({
        container,
        columns: activeColumns,
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
    if (!activeTable || (activeRenderKind !== 'grid' && activeRenderKind !== 'pivot')) return
    if (activeRenderKind === 'grid') {
      const isDs = targetKind === 'datasource'
      const curSort = isDs ? datasourceSortRules : (effectiveView?.sortRules ?? [])
      const curSummaries = isDs
        ? activeTable.meta.summaries
        : (effectiveView?.summaries ?? activeTable.meta.summaries)
      gridAdapterRef.current?.setData(
        activeColumns,
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
      const pivotConfig = effectiveView.pivotConfig ?? buildDefaultPivotConfig(activeColumns)
      pivotAdapterRef.current?.update({
        columns: activeColumns,
        records: pipeline.displayRecords,
        config: pivotConfig,
      })
    }
  }, [
    activeTable,
    activeColumns,
    activeRenderKind,
    targetKind,
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
      navigate({ kind: 'apps', appId: created.app.id, viewId: created.defaultView.id })
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
      if (route.kind === 'apps' && activeApp?.id === appId) {
        const nextApp = remainingApps[0]
        if (nextApp) {
          const nextView = remainingViews.find((v) => v.appId === nextApp.id)
          navigate(
            {
              kind: 'apps',
              appId: nextApp.id,
              ...(nextView ? { viewId: nextView.id } : {}),
            },
            { replace: true },
          )
        }
      }
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
      navigate({ kind: 'apps', appId: created.appId, viewId: created.id })
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
      if (route.kind === 'apps' && activeStoredView?.id === viewId) {
        const nextSibling = remaining.find((v) => v.appId === targetView.appId)
        if (nextSibling) {
          lastViewByAppRef.current.set(targetView.appId, nextSibling.id)
          navigate(
            { kind: 'apps', appId: targetView.appId, viewId: nextSibling.id },
            { replace: true },
          )
        }
      }
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
      navigate({ kind: 'datasources', tableId: created.meta.id })
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
    setShowImportModal(false)
    navigate({ kind: 'datasources', tableId: bundle.meta.id })
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

      if (route.kind === 'datasources' && route.tableId === tableId) {
        if (remainingTables[0]) {
          navigate({ kind: 'datasources', tableId: remainingTables[0].meta.id }, { replace: true })
        } else {
          navigate({ kind: 'apps' }, { replace: true })
        }
      } else if (route.kind === 'apps' && activeApp && activeApp.tableId === tableId) {
        const nextApp = remainingApps[0]
        if (nextApp) {
          const nextView = remainingViews.find((v) => v.appId === nextApp.id)
          navigate(
            { kind: 'apps', appId: nextApp.id, ...(nextView ? { viewId: nextView.id } : {}) },
            { replace: true },
          )
        } else {
          navigate({ kind: 'apps' }, { replace: true })
        }
      }
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
      setLocalFilterOverride(null)
      const firstApp = fresh.apps[0]
      if (firstApp) {
        const firstView = fresh.views.find((v) => v.appId === firstApp.id) ?? fresh.views[0]
        navigate(
          {
            kind: 'apps',
            appId: firstApp.id,
            ...(firstView ? { viewId: firstView.id } : {}),
          },
          { replace: true },
        )
      }
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
    if (!activeTable || !actionCapabilities.canEditRecords) return
    setBusy(true)
    try {
      const created = await createRecord(
        activeTable.meta.id,
        customPayload ?? buildNewRowPayload(activeTable.meta),
        activeWriteContext,
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
    if (!activeTable || recordIds.length === 0 || !actionCapabilities.canEditRecords) return
    try {
      await deleteRecordsInTable(activeTable.meta.id, recordIds, activeWriteContext)
      pushToast('success', `已删除 ${recordIds.length} 条记录`)
    } catch {
      // deleteRecordsInTable 已推送 Toast
    }
  }

  function cleanupViewsForDeletedColumns(
    targetViews: readonly WorkspaceView[],
    deletedKeys: readonly string[],
  ) {
    for (const view of targetViews) {
      let current = view
      let dirty = false
      const combinedPatch: Partial<WorkspaceView> = {}
      for (const columnKey of deletedKeys) {
        const patch = stripDeletedColumnFromView(current, columnKey)
        if (patch) {
          dirty = true
          Object.assign(combinedPatch, patch)
          current = { ...current, ...patch } as WorkspaceView
        }
      }
      if (dirty) {
        void handlePatchView(view.id, combinedPatch)
      }
    }
  }

  async function handleAddColumns(newColumns: SmartColumn[]) {
    if (!activeTable || !actionCapabilities.canConfigure) return
    if (targetKind === 'app') {
      if (!activeApp) return
      const validDerived = newColumns.filter(isDerivedColumn)
      if (validDerived.length === 0) return
      const nextDerived = [...(activeApp.derivedColumns ?? []), ...validDerived]
      const hint = validDerived.some((col) => col.type === 'lookup')
        ? '，右键关联列头可随时编辑'
        : ''
      await handleSaveSmartApp(
        activeApp.id,
        { derivedColumns: nextDerived },
        `已添加 ${validDerived.length} 个派生列${hint}`,
      )
      return
    }

    if (activeTable.meta.kind !== 'normal') {
      pushToast('error', '进阶 SQL 主数据表禁止新增原始字段列')
      return
    }
    const validRaw = filterRawColumns(newColumns)
    if (validRaw.length === 0) return
    const nextSummaries = { ...activeTable.meta.summaries }
    for (const col of validRaw) {
      if (!(col.key in nextSummaries)) {
        nextSummaries[col.key] = col.type === 'number' ? 'sum' : 'none'
      }
    }
    await handleSaveMeta(activeTable.meta.id, {
      ...activeTable.meta,
      columns: [...filterRawColumns(activeTable.meta.columns), ...validRaw],
      summaries: nextSummaries,
    })
    pushToast('success', `已添加 ${validRaw.length} 个字段列`)
  }

  async function handleUpdateRawColumn(columnKey: string, patch: Partial<SmartColumn>) {
    if (!activeTable || targetKind !== 'datasource' || !actionCapabilities.canConfigure) return
    const nextColumns = filterRawColumns(activeTable.meta.columns).map((col) => {
      if (col.key !== columnKey) return col
      const updated: SmartColumn = { ...col, ...patch }
      if ('align' in patch && patch.align === undefined) {
        delete updated.align
      }
      if ('required' in patch && !patch.required) {
        delete updated.required
      }
      if ('decimalPlaces' in patch && patch.decimalPlaces === undefined) {
        delete updated.decimalPlaces
      }
      return updated
    })
    await handleSaveMeta(activeTable.meta.id, {
      ...activeTable.meta,
      columns: nextColumns,
    })
    pushToast('success', '字段配置已更新')
  }

  async function handleUpdateDerivedColumn(columnKey: string, patch: Partial<SmartColumn>) {
    if (!activeApp || targetKind !== 'app' || !actionCapabilities.canConfigure) return
    const nextDerived = (activeApp.derivedColumns ?? []).map((col) => {
      if (col.key !== columnKey) return col
      const updated: SmartColumn = { ...col, ...patch }
      if ('decimalPlaces' in patch && patch.decimalPlaces === undefined) {
        delete updated.decimalPlaces
      }
      return updated
    })
    await handleSaveSmartApp(activeApp.id, { derivedColumns: nextDerived }, '派生列配置已更新')
  }

  async function handleRenameColumn(columnKey: string, nextTitle: string) {
    if (!activeTable || !actionCapabilities.canConfigure) return
    if (targetKind === 'app') {
      if (!activeApp || !activeAppDerivedColumns.some((c) => c.key === columnKey)) {
        pushToast('error', '智能表格不可修改数据源原始字段，请前往数据源中心操作')
        return
      }
      await handleUpdateDerivedColumn(columnKey, { title: nextTitle })
      return
    }
    if (activeTable.meta.kind !== 'normal') {
      pushToast('error', '进阶 SQL 主数据表禁止重命名物理列')
      return
    }
    await handleSaveMeta(activeTable.meta.id, {
      ...activeTable.meta,
      columns: filterRawColumns(activeTable.meta.columns).map((c) =>
        c.key === columnKey ? { ...c, title: nextTitle } : c,
      ),
    })
    pushToast('success', `列标题已更新为「${nextTitle}」`)
  }

  async function handleDeleteColumn(columnKey: string) {
    if (!activeTable || !actionCapabilities.canConfigure) return
    if (targetKind === 'app') {
      if (!activeApp || !activeAppDerivedColumns.some((c) => c.key === columnKey)) {
        pushToast('error', '智能表格不可删除数据源原始字段，请前往数据源中心操作')
        return
      }
      const nextDerived = activeAppDerivedColumns.filter((c) => c.key !== columnKey)
      const { nextOverrides, changed } = pruneOrphanedLookupOverrides(
        activeApp.lookupOverrides,
        nextDerived,
      )
      await handleSaveSmartApp(
        activeApp.id,
        {
          derivedColumns: nextDerived,
          ...(changed ? { lookupOverrides: nextOverrides } : {}),
        },
        '派生列已删除',
      )
      cleanupViewsForDeletedColumns(
        views.filter((v) => v.appId === activeApp.id),
        [columnKey],
      )
      return
    }

    if (activeTable.meta.kind !== 'normal') {
      pushToast('error', '进阶 SQL 主数据表禁止删除物理列')
      return
    }
    const tableId = activeTable.meta.id
    const nextMeta = stripDeletedColumnFromMeta(activeTable.meta, columnKey)
    await handleSaveMeta(tableId, nextMeta)
    cleanupViewsForDeletedColumns(
      views.filter((v) => v.tableId === tableId),
      [columnKey],
    )
    pushToast('success', '字段列已删除')
  }

  async function handleCreateSelectOption(columnKey: string, option: SelectOption) {
    if (
      !activeTable ||
      targetKind !== 'datasource' ||
      activeTable.meta.kind !== 'normal' ||
      !actionCapabilities.canConfigure
    ) {
      return
    }
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
    if (!activeApp || targetKind !== 'app' || !actionCapabilities.canConfigure) return
    const currentOverrides = activeApp.lookupOverrides ?? {}
    const nextOverrides: Record<string, Record<string, string>> = {
      ...currentOverrides,
      [recordId]: {
        ...currentOverrides[recordId],
        [groupId]: targetRecordId,
      },
    }
    await handleSaveSmartApp(activeApp.id, { lookupOverrides: nextOverrides }, '已锁定关联目标行')
  }

  async function handleAppendMatchRule(groupId: string, rule: LookupMatchRule) {
    if (!activeApp || targetKind !== 'app' || !actionCapabilities.canConfigure) return
    if (getBlockedLookupSourceKeys(activeColumns, groupId).has(rule.sourceField)) {
      const msg = '不能将关联带出字段或公式字段作为匹配条件'
      pushToast('error', msg)
      throw new Error(msg)
    }
    const nextCols = appendMatchRuleToLookupGroup(activeColumns, groupId, rule)
    const nextDerived = nextCols.filter(isDerivedColumn)
    await handleSaveSmartApp(activeApp.id, { derivedColumns: nextDerived }, '已追加联合匹配条件')
  }

  async function handleSaveLookupColumns(nextColumns: SmartColumn[]) {
    if (!activeApp || targetKind !== 'app' || !actionCapabilities.canConfigure) return
    const prevDerived = activeAppDerivedColumns
    const nextDerived = nextColumns.filter(isDerivedColumn)
    const nextKeys = new Set(nextDerived.map((c) => c.key))
    const deletedKeys = prevDerived.filter((c) => !nextKeys.has(c.key)).map((c) => c.key)
    const { nextOverrides, changed } = pruneOrphanedLookupOverrides(
      activeApp.lookupOverrides,
      nextDerived,
    )
    await handleSaveSmartApp(
      activeApp.id,
      {
        derivedColumns: nextDerived,
        ...(changed ? { lookupOverrides: nextOverrides } : {}),
      },
      '关联字段设置已保存',
    )
    if (deletedKeys.length > 0) {
      cleanupViewsForDeletedColumns(
        views.filter((v) => v.appId === activeApp.id),
        deletedKeys,
      )
    }
  }

  function handleJumpToFirstConflict() {
    if (!activeTable || targetKind !== 'app' || !actionCapabilities.canConfigure) return
    for (const rec of pipeline.displayRecords) {
      const rowMap = pipeline.conflictsByRow.get(rec._id)
      if (!rowMap) continue
      for (const [groupId, info] of rowMap.entries()) {
        if (!info.isResolved) {
          const col = activeColumns.find(
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
    if (!activeTable || !actionCapabilities.canConfigure) return
    if (targetKind === 'datasource') {
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
      if (targetKind === 'datasource') {
        setDatasourceSortRules(nextRules)
        return
      }
      if (!effectiveView) return
      if (!actionCapabilities.canConfigure) {
        setLocalFilterOverride({
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
            targetKind === 'datasource' ? datasourceSortRules : (effectiveView?.sortRules ?? [])
          ).filter((r) => r.field !== column.key)
          if (targetKind === 'datasource') setDatasourceSortRules(filtered)
          else if (effectiveView) {
            if (!actionCapabilities.canConfigure) {
              setLocalFilterOverride({
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
        if (actionCapabilities.canConfigure && activeStoredView && colIndex !== null) {
          void handlePatchView(activeStoredView.id, { frozenColCount: colIndex + 1 })
        }
        break
      case 'unfreeze_all':
        if (actionCapabilities.canConfigure && activeStoredView) {
          void handlePatchView(activeStoredView.id, { frozenColCount: 0 })
        }
        break
      case 'hide_col':
        if (actionCapabilities.canConfigure && activeStoredView && column) {
          const nextHidden = toggleHiddenColumn(
            activeColumns,
            activeStoredView.hiddenColumns,
            column.key,
          )
          if (nextHidden) void handlePatchView(activeStoredView.id, { hiddenColumns: nextHidden })
        }
        break
      case 'open_col_style':
        if (actionCapabilities.canConfigure && column) {
          setFocusedStyleColKey(column.key)
          setConfigDrawerTab('styles')
          setConfigDrawerOpen(true)
        }
        break
      case 'edit_lookup_col':
        if (actionCapabilities.canConfigure && column) {
          setFieldSettings({
            columnKey: column.key,
            rect: { x, y, width: 120, height: 32 },
          })
        }
        break
      case 'rename_col':
        if (actionCapabilities.canConfigure) {
          setShowColumnManager(true)
        }
        break
      case 'delete_col':
        if (actionCapabilities.canConfigure && column) setConfirmDeleteCol(column)
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
          if (column.type === 'lookup' && column.lookupConfig?.mode === 'one') {
            if (!actionCapabilities.canConfigure) return
            const groupId = column.lookupConfig.groupId
            const conflict = pipeline.conflictsByRow.get(record._id)?.get(groupId)
            if (conflict && conflict.candidates.length > 1) {
              setActiveConflict({ record, column, conflict, rect })
            }
          } else if (actionCapabilities.canEditRecords) {
            if (column.type === 'select' || column.type === 'date') {
              setActiveCellEdit({ record, column, rect, value: record[column.key] })
            } else if (column.type === 'checkbox') {
              void handleUpdateRecord(record._id, { [column.key]: !record[column.key] })
            } else {
              gridAdapterRef.current?.startEditCell(record._id, column.key)
            }
          }
        }
        break
      case 'apply_selection_style':
      case 'clear_selection_style':
        if (actionCapabilities.canConfigure && activeStoredView) {
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
        if (actionCapabilities.canConfigure) {
          setConfigDrawerTab('styles')
          setConfigDrawerOpen(true)
        }
        break
      case 'add_row':
        if (actionCapabilities.canEditRecords) void handleAddRow()
        break
      case 'duplicate_row':
        if (actionCapabilities.canEditRecords && record) {
          const copy: Record<string, unknown> = {}
          for (const col of filterRawColumns(activeTable.meta.columns)) {
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
        if (actionCapabilities.canEditRecords && record) {
          const ids =
            selectedRecordIds.includes(record._id) && selectedRecordIds.length > 1
              ? selectedRecordIds
              : [record._id]
          void handleDeleteRecords(ids)
        }
        break
    }
  }

  // ---------------- 分支一：/s/:token 独立无侧栏免登录访客路由（待 P7 挂载 ShareAccessPage） ----------------
  if (route.kind === 'share') {
    return (
      <>
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
        <RouteStatusCard
          testId="share-route-placeholder"
          icon={<Share2 className="h-8 w-8 text-blue-600" />}
          title="对外分享访问视图"
          description={`正在访问免登录分享链接（Token：${route.token}），完整访客查看与填报交互将在后续阶段接入。`}
          actionLabel="返回工作台"
          onAction={() => {
            setAuthStatus(session ? 'authenticated' : 'checking')
            navigate({ kind: 'apps' })
          }}
        />
      </>
    )
  }

  // ---------------- 分支二：正在检查会话或独立无侧栏 /login 登录页 ----------------
  if (authStatus === 'checking') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50 text-slate-500">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
          aria-hidden="true"
        />
        <div className="text-xs">正在验证登录会话...</div>
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  if (route.kind === 'login' || authStatus !== 'authenticated' || !session) {
    return (
      <>
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
        <LoginPage
          demoAccounts={demoAccounts}
          loadingAccounts={loadingDemoAccounts}
          busy={busy}
          errorMessage={loginError}
          redirectTo={route.kind === 'login' ? route.redirectTo : undefined}
          onSubmit={handleLoginSubmit}
        />
      </>
    )
  }

  const currentUser = session.user
  const navSection = getNavSectionForRoute(route)
  const sidebarSection: SidebarSection | null =
    route.kind === 'apps' || route.kind === 'entries' || route.kind === 'datasources'
      ? route.kind
      : null

  const goHome = () => handleNavSection('apps')

  // 渲染受保护工作台右侧主区内容
  function renderMainContent() {
    if (loading && !workspaceLoaded) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-50 text-slate-500">
          <div
            className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
            aria-hidden="true"
          />
          <div className="text-xs">正在加载智能表格工作台...</div>
        </div>
      )
    }

    if (loadError && !workspaceLoaded) {
      return (
        <RouteStatusCard
          icon={<Table2 className="h-7 w-7 text-slate-400" />}
          title="工作台加载失败"
          description={loadError}
          secondaryLabel="重试加载"
          onSecondaryAction={() => void loadWorkspace()}
        />
      )
    }

    if (route.kind === 'shares') {
      if (!userCapabilities.canManageShares) {
        return (
          <RouteStatusCard
            testId="shares-forbidden"
            icon={<Lock className="h-7 w-7 text-amber-500" />}
            title="无权访问分享管理"
            description="普通成员无权创建或管理对外分享链接，请联系管理员或负责人处理。"
            actionLabel="返回工作台"
            onAction={goHome}
          />
        )
      }
      return (
        <RouteStatusCard
          testId="shares-route-placeholder"
          icon={<Share2 className="h-8 w-8 text-blue-600" />}
          title="分享链接管理"
          description="集中查看与管理应用、视图和录入表的对外分享链接状态与有效期。"
          actionLabel="返回工作台"
          onAction={goHome}
        />
      )
    }

    if (route.kind === 'permissions') {
      return (
        <PermissionsPage
          currentUser={currentUser}
          userCapabilities={userCapabilities}
          onPermissionsChanged={refreshWorkspaceData}
          onBackToWorkbench={goHome}
          onNotify={pushToast}
        />
      )
    }

    if (route.kind === 'entries') {
      const targetTableId = route.tableId ?? normalEntryTables[0]?.id
      if (!targetTableId) {
        return (
          <RouteStatusCard
            icon={<Table2 className="h-7 w-7 text-slate-400" />}
            title="暂无可录入的数据表"
            description="当前账号下没有可用的普通自建数据表。"
            actionLabel="返回工作台"
            onAction={goHome}
          />
        )
      }

      if (probedEntryState?.tableId === targetTableId && probedEntryState.loading) {
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-50 text-slate-500">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600"
              aria-hidden="true"
            />
            <div className="text-xs">正在加载数据录入端...</div>
          </div>
        )
      }

      const entryBundle = tablesById.get(targetTableId)
      if (!entryBundle || entryBundle.meta.kind !== 'normal') {
        const reason = !entryBundle
          ? (probedEntryState?.tableId === targetTableId && probedEntryState.error) ||
            `数据表「${targetTableId}」不存在或无法访问。`
          : `数据表「${entryBundle.meta.name}」为 SQL 主数据表，不支持数据录入端，请前往数据源中心维护。`
        return (
          <RouteStatusCard
            icon={<AlertTriangle className="h-7 w-7 text-amber-500" />}
            title="数据录入端不可用"
            description={reason}
            actionLabel="返回工作台"
            onAction={goHome}
          />
        )
      }

      const canEditEntry = canEditEntryTableItem(currentUser, entryBundle.meta, apps, views)
      return (
        <EntryWorkspace
          bundle={entryBundle}
          busy={busy}
          readonly={!canEditEntry}
          switchableTables={normalEntryTables}
          onSwitchTable={handleEnterTableEntry}
          onCopyEntryLink={() => handleCopyEntryLink(entryBundle.meta.id)}
          onCreateRecord={async (record) => {
            if (!canEditEntry) return
            setBusy(true)
            try {
              const created = await createRecord(entryBundle.meta.id, record)
              setTables((prev) =>
                prev.map((b) =>
                  b.meta.id === entryBundle.meta.id
                    ? { ...b, records: [...b.records, created] }
                    : b,
                ),
              )
              return created
            } finally {
              setBusy(false)
            }
          }}
          onUpdateRecord={async (recordId, patch) => {
            if (!canEditEntry) return
            return updateRecordInTable(entryBundle.meta.id, recordId, patch)
          }}
          onDeleteRecords={async (recordIds) => {
            if (!canEditEntry) return
            await deleteRecordsInTable(entryBundle.meta.id, recordIds)
          }}
          onBatchAppendRecords={async (records) => {
            if (!canEditEntry) return
            setBusy(true)
            try {
              const res = await batchAppendRecords(entryBundle.meta.id, records)
              setTables((prev) =>
                prev.map((b) =>
                  b.meta.id === entryBundle.meta.id
                    ? { ...b, records: [...b.records, ...res.records] }
                    : b,
                ),
              )
            } finally {
              setBusy(false)
            }
          }}
          onBackToWorkbench={goHome}
          onNotify={pushToast}
        />
      )
    }

    if (route.kind === 'datasources' && !userCapabilities.canAccessDataSources) {
      return (
        <RouteStatusCard
          testId="datasources-forbidden"
          icon={<Lock className="h-7 w-7 text-amber-500" />}
          title="无权访问数据源中心"
          description="普通成员仅可在智能表格工作台或授权录入表中浏览与协作，无法管理底层数据源。"
          actionLabel="返回工作台"
          onAction={goHome}
        />
      )
    }

    if (!activeTable) {
      return (
        <RouteStatusCard
          icon={<Table2 className="h-7 w-7 text-slate-400" />}
          title={route.kind === 'datasources' ? '未找到指定数据源表' : '暂无可访问的智能表格'}
          description={
            route.kind === 'datasources'
              ? '目标数据源表不存在或当前账号暂无访问权限。'
              : '当前账号暂无可见的多维智能表格应用，请联系管理员授权或新建应用。'
          }
          actionLabel={route.kind === 'datasources' && tables[0] ? '查看首个数据源' : undefined}
          onAction={
            route.kind === 'datasources' && tables[0]
              ? () => handleSelectTable(tables[0]!.meta.id)
              : undefined
          }
          secondaryLabel={normalEntryTables[0] ? '前往数据录入' : undefined}
          onSecondaryAction={normalEntryTables[0] ? () => handleNavSection('entries') : undefined}
        />
      )
    }

    const activePivotConfig = effectiveView?.pivotConfig ?? buildDefaultPivotConfig(activeColumns)
    const hasActiveFilters = Boolean(
      effectiveView &&
      (effectiveView.filterGroup.conditions.length > 0 ||
        Object.values(effectiveView.quickFilterValues ?? {}).some((v) => v.length > 0)),
    )
    const showGridEmptyOverlay = activeRenderKind === 'grid' && pipeline.displayRecords.length === 0
    const workbenchTableMeta = effectiveTableMeta ?? activeTable.meta
    const workbenchTableBundle = effectiveTableBundle ?? activeTable

    return (
      <>
        {targetKind === 'app' && activeApp && (
          <AppViewTabs
            canConfigureApp={canConfigureAppItem(currentUser, activeApp)}
            canManageDataSource={actionCapabilities.canManageDataSource}
            canConfigureView={(view) => canConfigureViewItem(currentUser, view, activeApp)}
            app={activeApp}
            bundle={workbenchTableBundle}
            views={activeAppViews}
            activeViewId={activeStoredView?.id ?? ''}
            busy={busy}
            onSelectView={handleSelectView}
            onCreateView={handleCreateView}
            onRenameView={handleRenameView}
            onDeleteView={handleDeleteView}
            onReorderViews={handleReorderViews}
            onJumpToDatasource={
              actionCapabilities.canManageDataSource ? handleSelectTable : undefined
            }
          />
        )}

        <Toolbar
          capabilities={actionCapabilities}
          canCreateApp={userCapabilities.canCreateApp}
          targetKind={targetKind}
          tableMeta={workbenchTableMeta}
          activeView={effectiveView}
          visibleColumns={visibleColumns}
          allComputedRecords={pipeline.allComputedRecords}
          displayRecords={pipeline.displayRecords}
          unresolvedConflictCount={pipeline.unresolvedConflictCount}
          selectedRecordIds={selectedRecordIds}
          watermarkEnabled={watermarkEnabled}
          configDrawerOpen={configDrawerOpen}
          busy={busy}
          onUpdateFilters={handleUpdateFilters}
          onToggleConfigDrawer={() => {
            if (!actionCapabilities.canConfigure) return
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
          onCreateAppFromTable={() => {
            setCreateAppDraftRequest({ tableId: activeTable.meta.id, nonce: Date.now() })
            navigate({ kind: 'apps' })
          }}
          onJumpToFirstConflict={handleJumpToFirstConflict}
          onToggleWatermark={() => setWatermarkEnabled((v) => !v)}
          onOpenEntryPage={() => {
            if (activeTable.meta.kind !== 'normal') return
            handleOpenEntryNewTab(activeTable.meta.id)
          }}
          onCopyEntryLink={() => {
            if (activeTable.meta.kind !== 'normal') return
            return handleCopyEntryLink(activeTable.meta.id)
          }}
          onJumpToDatasource={
            actionCapabilities.canManageDataSource ? handleSelectTable : undefined
          }
          onNotify={pushToast}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="relative min-w-0 flex-1 overflow-hidden bg-white">
            {activeRenderKind === 'kanban' && effectiveView ? (
              <KanbanView
                view={effectiveView}
                columns={activeColumns}
                records={pipeline.displayRecords}
                readonly={!actionCapabilities.canEditRecords}
                primaryKeyField={activeTable.meta.primaryKeyField}
                onMoveCard={handleMoveKanbanCard}
                onUpdateRecord={handleUpdateRecord}
                onAddCard={actionCapabilities.canEditRecords ? () => handleAddRow() : undefined}
                onOpenConfig={
                  actionCapabilities.canConfigure
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
                columns={activeColumns}
                records={pipeline.displayRecords}
                readonly={!actionCapabilities.canConfigure}
                selectedItem={actionCapabilities.canConfigure ? selectedDashboardItem : null}
                onSelectItem={
                  actionCapabilities.canConfigure
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
                  actionCapabilities.canConfigure
                    ? (nextDashboard) =>
                        void handlePatchView(effectiveView.id, { dashboardConfig: nextDashboard })
                    : undefined
                }
                onOpenConfig={
                  actionCapabilities.canConfigure
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
                            {actionCapabilities.canEditRecords
                              ? '添加第一条数据以开始管理与跨表关联计算。'
                              : '当前视图暂无可展示的数据记录。'}
                          </div>
                          {actionCapabilities.canEditRecords && (
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

          {actionCapabilities.canConfigure && targetKind === 'app' && activeStoredView && (
            <ViewConfigDrawer
              open={configDrawerOpen}
              canConfigure={actionCapabilities.canConfigure}
              activeTab={configDrawerTab}
              view={activeStoredView}
              tableMeta={workbenchTableMeta}
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
      </>
    )
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900">
      <ToastHost toasts={toasts} onDismiss={dismissToast} />

      <NavRail
        user={currentUser}
        userCapabilities={userCapabilities}
        activeSection={navSection}
        demoAccounts={demoAccounts}
        busy={busy}
        onNavigate={handleNavSection}
        onLogout={handleLogout}
        onSwitchAccount={handleSwitchAccount}
        onOpenLoginSwitch={handleLogout}
      />

      {sidebarSection && (
        <Sidebar
          section={sidebarSection}
          currentUser={currentUser}
          userCapabilities={userCapabilities}
          apps={apps}
          views={views}
          tables={tables}
          activeAppId={activeApp?.id}
          activeEntryTableId={route.kind === 'entries' ? route.tableId : undefined}
          activeDatasourceTableId={route.kind === 'datasources' ? route.tableId : undefined}
          busy={busy}
          createAppDraftRequest={createAppDraftRequest}
          onSelectApp={handleSelectApp}
          onCreateApp={handleCreateApp}
          onRenameApp={handleRenameApp}
          onDeleteApp={handleDeleteApp}
          onReorderApps={handleReorderApps}
          onSelectTable={handleSelectTable}
          onEnterTableEntry={handleEnterTableEntry}
          onOpenTableEntryNewTab={handleOpenEntryNewTab}
          onCopyTableEntryLink={handleCopyEntryLink}
          onCreateNormalTable={handleCreateNormalTable}
          onRenameTable={handleRenameTable}
          onDeleteTable={handleDeleteTable}
          onOpenImport={() => setShowImportModal(true)}
          onResetSeed={handleResetSeed}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{renderMainContent()}</main>

      {/* 底部汇总格轻量统计菜单 */}
      {actionCapabilities.canConfigure && summaryMenu && (
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

      {/* 配置弹窗与浮层 */}
      {actionCapabilities.canConfigure &&
        activeTable &&
        showAddColumn &&
        (targetKind === 'app' || activeTable.meta.kind === 'normal') && (
          <AddColumnModal
            mode={targetKind}
            columns={filterRawColumns(activeTable.meta.columns)}
            derivedColumns={targetKind === 'app' ? activeAppDerivedColumns : undefined}
            onClose={() => setShowAddColumn(false)}
            onSubmit={(col) => handleAddColumns([col])}
          />
        )}

      {actionCapabilities.canConfigure && activeTable && showColumnManager && (
        <ColumnManagerModal
          mode={targetKind}
          tableKind={activeTable.meta.kind}
          primaryKeyField={activeTable.meta.primaryKeyField}
          columns={filterRawColumns(activeTable.meta.columns)}
          derivedColumns={targetKind === 'app' ? activeAppDerivedColumns : undefined}
          busy={busy}
          onClose={() => setShowColumnManager(false)}
          onRenameColumn={handleRenameColumn}
          onUpdateColumn={targetKind === 'datasource' ? handleUpdateRawColumn : undefined}
          onDeleteColumn={handleDeleteColumn}
          onEditLookupColumn={(columnKey, anchor) =>
            setFieldSettings({ columnKey, rect: anchor.getBoundingClientRect() })
          }
          onUpdateDerivedColumn={targetKind === 'app' ? handleUpdateDerivedColumn : undefined}
          onOpenAddFormula={targetKind === 'app' ? () => setShowAddColumn(true) : undefined}
          onOpenLookupWizard={targetKind === 'app' ? () => setShowLookupWizard(true) : undefined}
          onJumpToDatasource={
            targetKind === 'app' && actionCapabilities.canManageDataSource
              ? () => handleSelectTable(activeTable.meta.id)
              : undefined
          }
        />
      )}

      {actionCapabilities.canConfigure &&
        activeTable &&
        targetKind === 'app' &&
        showLookupWizard && (
          <LookupWizardModal
            sourceTable={activeTable}
            derivedColumns={activeAppDerivedColumns}
            sourceComputedRecords={pipeline.allComputedRecords}
            allTables={tables}
            onClose={() => setShowLookupWizard(false)}
            onSubmitColumns={handleAddColumns}
          />
        )}

      {actionCapabilities.canConfigure &&
        activeTable &&
        targetKind === 'app' &&
        fieldSettings &&
        activeAppDerivedColumns.some(
          (col) => col.key === fieldSettings.columnKey && col.type === 'lookup',
        ) && (
          <LookupFieldPanel
            columnKey={fieldSettings.columnKey}
            rect={fieldSettings.rect}
            sourceTable={activeTable}
            derivedColumns={activeAppDerivedColumns}
            sourceComputedRecords={pipeline.allComputedRecords}
            allTables={tables}
            onClose={() => setFieldSettings(null)}
            onSave={handleSaveLookupColumns}
            onDeleteColumn={handleDeleteColumn}
          />
        )}

      {userCapabilities.canCreateTable && showImportModal && (
        <ImportExcelModal
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
          onError={(msg) => pushToast('error', msg)}
        />
      )}

      {drillEvent && activeRenderKind === 'pivot' && (
        <DrillDownDrawer
          drillEvent={drillEvent}
          columns={activeColumns}
          allComputedRecords={pipeline.allComputedRecords}
          conflictsByRow={pipeline.conflictsByRow}
          pivotConfig={effectiveView?.pivotConfig ?? buildDefaultPivotConfig(activeColumns)}
          readonly={!actionCapabilities.canEditRecords}
          hasActiveOverlay={Boolean(activeConflict || activeCellEdit)}
          onClose={() => setDrillEvent(null)}
          onUpdateRecord={handleUpdateRecord}
          onConflictClick={(info) => {
            if (actionCapabilities.canConfigure) setActiveConflict(info)
          }}
          onRichCellEdit={(info) => {
            if (actionCapabilities.canEditRecords) setActiveCellEdit(info)
          }}
          onValidationError={(msg) => pushToast('error', msg)}
        />
      )}

      {actionCapabilities.canConfigure && targetKind === 'app' && activeConflict && (
        <DisambiguatePopover
          conflictInfo={activeConflict}
          sourceColumns={activeColumns}
          targetBundle={tablesById.get(activeConflict.conflict.targetTableId)}
          onClose={() => setActiveConflict(null)}
          onSelectCandidate={handleSelectConflictCandidate}
          onAppendMatchRule={handleAppendMatchRule}
        />
      )}

      {actionCapabilities.canEditRecords && activeTable && activeCellEdit && (
        <CellEditorPopover
          editInfo={activeCellEdit}
          allowCreateSelectOption={
            actionCapabilities.canConfigure &&
            targetKind === 'datasource' &&
            activeTable.meta.kind === 'normal'
          }
          onClose={() => setActiveCellEdit(null)}
          onCommit={(recordId, fieldKey, value) =>
            handleUpdateRecord(recordId, { [fieldKey]: value })
          }
          onCreateSelectOption={handleCreateSelectOption}
        />
      )}

      <ConfirmModal
        open={confirmDeleteCol !== null}
        title={targetKind === 'app' ? '确认删除派生列' : '确认删除字段列'}
        description={
          targetKind === 'app'
            ? `确定要删除当前智能表格的派生列「${confirmDeleteCol?.title ?? ''}」吗？当前应用各视图中的引用将同步清理，不会影响底层数据源表。`
            : `确定要删除字段「${confirmDeleteCol?.title ?? ''}」吗？相关筛选、排序与汇总配置将同步移除。`
        }
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
