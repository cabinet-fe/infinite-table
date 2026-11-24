// 独立无侧栏 /s/:token 访客访问页：完全免登录访问（不触发 /api/auth/me、不渲染 NavRail 与 Sidebar），
// 支持密码门禁校验、失效/过期提示页、app/view 只读多视图交互（含临时筛选排序、透视展开折叠与下钻抽屉）
// 以及 entry 分享的免登录表单/网格填报与匿名数据隔离。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import type { Region } from '@infinitable/render'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  Filter,
  FoldVertical,
  KeyRound,
  Lock,
  Table2,
  UnfoldVertical,
} from 'lucide-react'
import { ApiError, fetchShareAccess, submitShareEntryRecord, verifySharePassword } from '../api'
import { SmartGridAdapter, type SmartGridSelectionInfo } from '../canvas/smart-grid'
import { SmartPivotAdapter } from '../canvas/smart-pivot'
import { runSmartTablePipeline } from '../domain/query-engine'
import { resolveVisibleColumns } from '../domain/style-engine'
import { scalarToText } from '../domain/utils'
import {
  buildDefaultPivotConfig,
  copyTextToClipboard,
  cycleSortRules,
  formatShareTimestamp,
  SHARE_TARGET_LABELS,
  type WorkspaceActionCapabilities,
} from '../domain/workspace-helpers'
import type {
  ShareAccessResponse,
  ShareAccessUnlockedResponse,
  TableBundle,
} from '../shared/api-types'
import {
  filterRawColumns,
  mergeSmartColumns,
  type FilterGroup,
  type SmartColumn,
  type SmartRecord,
  type SortRule,
  type WorkspaceView,
} from '../shared/schema'
import { AppViewTabs } from './AppViewTabs'
import { DashboardView } from './DashboardView'
import { DrillDownDrawer } from './DrillDownDrawer'
import { EntryRecordForm } from './EntryRecordDrawer'
import { GridPopupMenu, type GridMenuActionId, type GridMenuContext } from './GridPopupMenu'
import { KanbanView } from './KanbanView'
import type { ToastType } from './Toast'
import { Toolbar } from './Toolbar'

export interface ShareAccessPageProps {
  token: string
  onNotify?: (type: ToastType, message: string) => void
  onGoHome?: () => void
}

interface ViewLocalOverride {
  filterGroup: FilterGroup
  quickFilterValues: Record<string, string[]>
  sortRules: SortRule[]
}

interface ShareLoadErrorState {
  status: number
  errorStatus?: string
  title: string
  description: string
}

const GUEST_READONLY_CAPABILITIES: WorkspaceActionCapabilities = {
  canView: true,
  canEditRecords: false,
  canConfigure: false,
  canManagePermissions: false,
  canCreateShare: false,
  canManageDataSource: false,
  canAccessDataSources: false,
}

const EMPTY_SELECTION: SmartGridSelectionInfo = {
  ranges: [],
  recordIds: [],
  columnKeys: [],
  focus: null,
}

const noopAsync = async () => {}

function getSessionUnlockKey(token: string): string {
  return `st_share_unlock_${token}`
}

function readCachedUnlockToken(token: string): string | null {
  try {
    return typeof window !== 'undefined'
      ? window.sessionStorage?.getItem(getSessionUnlockKey(token))
      : null
  } catch {
    return null
  }
}

function writeCachedUnlockToken(token: string, accessToken: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(getSessionUnlockKey(token), accessToken)
    }
  } catch {
    // 忽略无 sessionStorage 环境错误
  }
}

function mapApiErrorToShareState(error: unknown): ShareLoadErrorState {
  if (error instanceof ApiError) {
    if (error.status === 410) {
      if (error.errorStatus === 'revoked') {
        return {
          status: 410,
          errorStatus: 'revoked',
          title: '分享链接已失效',
          description: '该分享链接已被创建者或管理员手动失效，无法继续访问。',
        }
      }
      return {
        status: 410,
        errorStatus: 'expired',
        title: '分享链接已过期',
        description: '该分享链接已超过有效期，请联系分享者重新生成链接。',
      }
    }
    if (error.status === 404) {
      return {
        status: 404,
        title: '分享链接不存在',
        description: '该分享地址无效或已被移除，请核对链接是否完整。',
      }
    }
    if (error.status === 403) {
      return {
        status: 403,
        title: '当前分享不可访问',
        description: error.message || '分享创建者的资源访问权限已变更，当前链接暂停访问。',
      }
    }
    return {
      status: error.status,
      title: '分享页面加载失败',
      description: error.message || '请稍后重试。',
    }
  }
  return {
    status: 500,
    title: '分享页面加载失败',
    description: error instanceof Error ? error.message : '网络异常，请稍后重试。',
  }
}

function GuestEntrySubmittedGrid({
  columns,
  records,
}: {
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const adapterRef = useRef<SmartGridAdapter | null>(null)
  const latestRef = useRef({ columns, records })
  latestRef.current = { columns, records }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const adapter = new SmartGridAdapter({
      container,
      columns: latestRef.current.columns,
      records: latestRef.current.records,
      readonly: true,
      showSummaryRow: false,
    })
    adapterRef.current = adapter
    return () => {
      adapter.destroy()
      adapterRef.current = null
    }
  }, [])

  useEffect(() => {
    adapterRef.current?.setData(columns, records)
  }, [columns, records])

  return <div ref={containerRef} className="h-64 w-full" />
}

export function ShareAccessPage({ token, onNotify, onGoHome }: ShareAccessPageProps) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<ShareLoadErrorState | null>(null)
  const [response, setResponse] = useState<ShareAccessResponse | null>(null)
  const [unlockToken, setUnlockToken] = useState<string | null>(() => readCachedUnlockToken(token))

  // 密码门禁表单状态
  const [passwordDraft, setPasswordDraft] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // app / view 只读工作区状态
  const [activeViewId, setActiveViewId] = useState<string>('')
  const [overridesByViewId, setOverridesByViewId] = useState<Record<string, ViewLocalOverride>>({})
  const [drillEvent, setDrillEvent] = useState<PivotCellDrillEvent | null>(null)
  const [popupMenu, setPopupMenu] = useState<GridMenuContext | null>(null)

  // entry 匿名填报状态（严格仅保存本次会话自己提交的记录）
  const [submittedRecords, setSubmittedRecords] = useState<SmartRecord[]>([])

  const requestSeqRef = useRef(0)
  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const gridAdapterRef = useRef<SmartGridAdapter | null>(null)
  const pivotAdapterRef = useRef<SmartPivotAdapter | null>(null)
  const onNotifyRef = useRef(onNotify)
  onNotifyRef.current = onNotify

  const loadShare = useCallback(
    async (explicitUnlockToken?: string | null) => {
      const seq = ++requestSeqRef.current
      setLoading(true)
      setLoadError(null)
      const effectiveUnlock =
        explicitUnlockToken !== undefined ? explicitUnlockToken : readCachedUnlockToken(token)
      try {
        const data = await fetchShareAccess(
          token,
          effectiveUnlock ? { shareToken: effectiveUnlock } : undefined,
        )
        if (seq !== requestSeqRef.current) return
        setResponse(data)
        if (data.unlocked) {
          const firstViewId = data.view?.id ?? data.views?.[0]?.id ?? ''
          setActiveViewId((prev) =>
            prev && (data.views ?? []).some((v) => v.id === prev) ? prev : firstViewId,
          )
        }
      } catch (error) {
        if (seq !== requestSeqRef.current) return
        setResponse(null)
        setLoadError(mapApiErrorToShareState(error))
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false)
        }
      }
    },
    [token],
  )

  useEffect(() => {
    const cached = readCachedUnlockToken(token)
    setUnlockToken(cached)
    setPasswordDraft('')
    setShowPassword(false)
    setPasswordError(null)
    setActiveViewId('')
    setOverridesByViewId({})
    setDrillEvent(null)
    setPopupMenu(null)
    setSubmittedRecords([])
    void loadShare(cached)
  }, [token, loadShare])

  async function handleVerifyPassword(event: React.FormEvent) {
    event.preventDefault()
    if (verifying) return
    if (passwordDraft.trim() === '') {
      setPasswordError('请输入访问密码')
      return
    }
    setVerifying(true)
    setPasswordError(null)
    try {
      const verified = await verifySharePassword(token, passwordDraft)
      writeCachedUnlockToken(token, verified.accessToken)
      setUnlockToken(verified.accessToken)
      setResponse(verified.access)
      setPasswordDraft('')
      const firstViewId = verified.access.view?.id ?? verified.access.views?.[0]?.id ?? ''
      setActiveViewId(firstViewId)
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 410 || error.status === 403 || error.status === 404)
      ) {
        setResponse(null)
        setLoadError(mapApiErrorToShareState(error))
        return
      }
      setPasswordError(error instanceof Error ? error.message : '访问密码校验失败')
    } finally {
      setVerifying(false)
    }
  }

  const unlockedAccess: ShareAccessUnlockedResponse | null =
    response && response.unlocked ? response : null

  const guestViews = useMemo<WorkspaceView[]>(() => {
    if (!unlockedAccess) return []
    if (unlockedAccess.views && unlockedAccess.views.length > 0) {
      return unlockedAccess.views
    }
    return unlockedAccess.view ? [unlockedAccess.view] : []
  }, [unlockedAccess])

  const tablesById = useMemo(() => {
    const map = new Map<string, TableBundle>()
    if (!unlockedAccess) return map
    const list =
      unlockedAccess.tables && unlockedAccess.tables.length > 0
        ? unlockedAccess.tables
        : unlockedAccess.table
          ? [unlockedAccess.table]
          : []
    for (const bundle of list) {
      map.set(bundle.meta.id, bundle)
    }
    return map
  }, [unlockedAccess])

  const activeStoredView = useMemo(() => {
    if (!unlockedAccess || unlockedAccess.share.targetType === 'entry') return undefined
    if (unlockedAccess.share.targetType === 'view') {
      return unlockedAccess.view ?? guestViews[0]
    }
    return guestViews.find((v) => v.id === activeViewId) ?? guestViews[0]
  }, [unlockedAccess, guestViews, activeViewId])

  const effectiveView = useMemo(() => {
    if (!activeStoredView) return undefined
    const override = overridesByViewId[activeStoredView.id]
    if (!override) return activeStoredView
    return {
      ...activeStoredView,
      filterGroup: override.filterGroup,
      quickFilterValues: override.quickFilterValues,
      sortRules: override.sortRules,
    }
  }, [activeStoredView, overridesByViewId])

  const primaryTable = useMemo(() => {
    if (!unlockedAccess) return undefined
    if (effectiveView) {
      return tablesById.get(effectiveView.tableId) ?? unlockedAccess.table
    }
    return unlockedAccess.table
  }, [unlockedAccess, effectiveView, tablesById])

  const activeColumns = useMemo(() => {
    if (!primaryTable) return []
    if (unlockedAccess?.share.targetType === 'entry') {
      return filterRawColumns(primaryTable.meta.columns)
    }
    return mergeSmartColumns(primaryTable.meta.columns, unlockedAccess?.app?.derivedColumns)
  }, [primaryTable, unlockedAccess])

  const effectiveTableMeta = useMemo(
    () => (primaryTable ? { ...primaryTable.meta, columns: activeColumns } : undefined),
    [primaryTable, activeColumns],
  )

  const effectiveTableBundle = useMemo(
    () =>
      primaryTable && effectiveTableMeta
        ? { ...primaryTable, meta: effectiveTableMeta }
        : undefined,
    [primaryTable, effectiveTableMeta],
  )

  const pipeline = useMemo(() => {
    if (!primaryTable || !unlockedAccess || unlockedAccess.share.targetType === 'entry') {
      return {
        allComputedRecords: [] as SmartRecord[],
        displayRecords: [] as SmartRecord[],
        conflictsByRow: new Map(),
        unresolvedConflictCount: 0,
        summaries: {},
      }
    }
    const appContext = unlockedAccess.app
      ? {
          derivedColumns: unlockedAccess.app.derivedColumns ?? [],
          lookupOverrides: unlockedAccess.app.lookupOverrides ?? {},
        }
      : undefined
    return runSmartTablePipeline(
      primaryTable.meta,
      primaryTable.records,
      tablesById,
      effectiveView,
      appContext,
    )
  }, [primaryTable, unlockedAccess, tablesById, effectiveView])

  const visibleColumns = useMemo(
    () => resolveVisibleColumns(activeColumns, effectiveView),
    [activeColumns, effectiveView],
  )

  const updateLocalViewOverride = useCallback(
    (patch: Partial<ViewLocalOverride>) => {
      if (!effectiveView) return
      setOverridesByViewId((prev) => {
        const cur = prev[effectiveView.id] ?? {
          filterGroup: effectiveView.filterGroup,
          quickFilterValues: effectiveView.quickFilterValues ?? {},
          sortRules: effectiveView.sortRules,
        }
        return {
          ...prev,
          [effectiveView.id]: {
            filterGroup: patch.filterGroup ?? cur.filterGroup,
            quickFilterValues: patch.quickFilterValues ?? cur.quickFilterValues,
            sortRules: patch.sortRules ?? cur.sortRules,
          },
        }
      })
    },
    [effectiveView],
  )

  const handleHeaderSort = useCallback(
    (field: string, meta: { additive: boolean }) => {
      if (!effectiveView || effectiveView.type !== 'table') return
      updateLocalViewOverride({
        sortRules: cycleSortRules(effectiveView.sortRules, field, meta.additive),
      })
    },
    [effectiveView, updateLocalViewOverride],
  )

  const buildGuestMenuContext = useCallback(
    (params: {
      region: 'body' | 'col-header' | 'row-header'
      x: number
      y: number
      colIndex: number | null
      column: SmartColumn | null
      record: SmartRecord | null
      selection: SmartGridSelectionInfo
    }): GridMenuContext | null => {
      if (!effectiveView) return null
      return {
        canEditRecords: false,
        canConfigure: false,
        region: params.region,
        x: params.x,
        y: params.y,
        colIndex: params.colIndex,
        column: params.column,
        record: params.record,
        selection: params.selection,
        sortRules: effectiveView.sortRules,
        frozenColCount: effectiveView.frozenColCount ?? 0,
        visibleColumnCount: visibleColumns.length,
        canRenameColumn: false,
        canDeleteColumn: false,
        hasSelectionCellStyles: false,
        isDatasourceMode: false,
      }
    },
    [effectiveView, visibleColumns.length],
  )

  const handlersRef = useRef({
    onHeaderSortClick: handleHeaderSort,
    onHeaderMenuClick: (info: { column: SmartColumn; colIndex: number; rect: Region }) => {
      const sel = gridAdapterRef.current?.getSelectionInfo() ?? EMPTY_SELECTION
      const ctx = buildGuestMenuContext({
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
    onContextMenu: (info: {
      region: 'body' | 'col-header' | 'row-header'
      x: number
      y: number
      colIndex: number | null
      column: SmartColumn | null
      record: SmartRecord | null
      selection: SmartGridSelectionInfo
    }) => {
      const ctx = buildGuestMenuContext(info)
      if (ctx) setPopupMenu(ctx)
    },
    onCellDrill: (ev: PivotCellDrillEvent) => setDrillEvent(ev),
  })
  handlersRef.current = {
    onHeaderSortClick: handleHeaderSort,
    onHeaderMenuClick: (info) => {
      const sel = gridAdapterRef.current?.getSelectionInfo() ?? EMPTY_SELECTION
      const ctx = buildGuestMenuContext({
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
    onContextMenu: (info) => {
      const ctx = buildGuestMenuContext(info)
      if (ctx) setPopupMenu(ctx)
    },
    onCellDrill: (ev) => setDrillEvent(ev),
  }

  const activeCanvasKind: 'grid' | 'pivot' | 'none' = useMemo(() => {
    if (!unlockedAccess || unlockedAccess.share.targetType === 'entry' || !effectiveView) {
      return 'none'
    }
    if (effectiveView.type === 'table') return 'grid'
    if (effectiveView.type === 'pivot') return 'pivot'
    return 'none'
  }, [unlockedAccess, effectiveView])

  const canvasMountKey =
    primaryTable && effectiveView && activeCanvasKind !== 'none'
      ? `${unlockedAccess?.share.id ?? ''}:${effectiveView.id}:${activeCanvasKind}`
      : ''

  const latestCanvasSnapshotRef = useRef({
    primaryTable,
    effectiveView,
    activeColumns,
    pipeline,
  })
  latestCanvasSnapshotRef.current = {
    primaryTable,
    effectiveView,
    activeColumns,
    pipeline,
  }

  useEffect(() => {
    const container = canvasContainerRef.current
    const snap = latestCanvasSnapshotRef.current
    if (!container || !snap.primaryTable || !snap.effectiveView || !canvasMountKey) {
      return
    }

    gridAdapterRef.current?.destroy()
    gridAdapterRef.current = null
    pivotAdapterRef.current?.destroy()
    pivotAdapterRef.current = null

    if (activeCanvasKind === 'grid') {
      const adapter = new SmartGridAdapter({
        container,
        columns: snap.activeColumns,
        records: snap.pipeline.displayRecords,
        conflictsByRow: snap.pipeline.conflictsByRow,
        readonly: true,
        sortRules: snap.effectiveView.sortRules,
        view: snap.effectiveView,
        summaries: snap.effectiveView.summaries ?? snap.primaryTable.meta.summaries,
        summaryResults: snap.pipeline.summaries,
        totalCount: snap.pipeline.allComputedRecords.length,
        onHeaderSortClick: (info) =>
          handlersRef.current.onHeaderSortClick(info.field, { additive: info.additive }),
        onHeaderMenuClick: (info) => handlersRef.current.onHeaderMenuClick(info),
        onContextMenu: (info) => handlersRef.current.onContextMenu(info),
      })
      gridAdapterRef.current = adapter
      return () => {
        adapter.destroy()
        gridAdapterRef.current = null
      }
    }

    if (activeCanvasKind === 'pivot') {
      const pivotConfig =
        snap.effectiveView.pivotConfig ?? buildDefaultPivotConfig(snap.activeColumns)
      const pivotAdapter = new SmartPivotAdapter({
        container,
        columns: snap.activeColumns,
        records: snap.pipeline.displayRecords,
        config: pivotConfig,
        onCellDrill: (ev) => handlersRef.current.onCellDrill(ev),
      })
      pivotAdapterRef.current = pivotAdapter
      return () => {
        pivotAdapter.destroy()
        pivotAdapterRef.current = null
      }
    }
  }, [canvasMountKey, activeCanvasKind])

  useEffect(() => {
    if (!primaryTable || !effectiveView || activeCanvasKind === 'none') return
    if (activeCanvasKind === 'grid') {
      gridAdapterRef.current?.setData(
        activeColumns,
        pipeline.displayRecords,
        pipeline.conflictsByRow,
        effectiveView.sortRules,
        {
          view: effectiveView,
          summaries: effectiveView.summaries ?? primaryTable.meta.summaries,
          summaryResults: pipeline.summaries,
          totalCount: pipeline.allComputedRecords.length,
        },
      )
    } else if (activeCanvasKind === 'pivot') {
      const pivotConfig = effectiveView.pivotConfig ?? buildDefaultPivotConfig(activeColumns)
      pivotAdapterRef.current?.update({
        columns: activeColumns,
        records: pipeline.displayRecords,
        config: pivotConfig,
      })
    }
  }, [
    primaryTable,
    effectiveView,
    activeCanvasKind,
    activeColumns,
    pipeline.displayRecords,
    pipeline.conflictsByRow,
    pipeline.summaries,
    pipeline.allComputedRecords.length,
  ])

  function handleGuestGridMenuAction(action: GridMenuActionId) {
    if (!popupMenu || !effectiveView) return
    const { column, record } = popupMenu
    if (action === 'sort_asc' && column) {
      updateLocalViewOverride({ sortRules: [{ field: column.key, direction: 'asc' }] })
      return
    }
    if (action === 'sort_desc' && column) {
      updateLocalViewOverride({ sortRules: [{ field: column.key, direction: 'desc' }] })
      return
    }
    if (action === 'sort_clear' && column) {
      updateLocalViewOverride({
        sortRules: effectiveView.sortRules.filter((r) => r.field !== column.key),
      })
      return
    }
    if (action === 'copy_cell' && record && column) {
      void copyTextToClipboard(scalarToText(record[column.key]))
      onNotifyRef.current?.('success', '已复制单元格内容')
      return
    }
    if (action === 'copy_row' && record) {
      void copyTextToClipboard(JSON.stringify(record, null, 2))
      onNotifyRef.current?.('success', '已复制整行数据')
      return
    }
    if (action === 'filter_by_cell' && record && column) {
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
      updateLocalViewOverride({
        filterGroup: {
          ...effectiveView.filterGroup,
          conditions: [...effectiveView.filterGroup.conditions, nextCond],
        },
      })
      return
    }
    if (action === 'clear_filters') {
      updateLocalViewOverride({
        filterGroup: { conjunction: 'and', conditions: [] },
        quickFilterValues: {},
      })
    }
  }

  async function handleGuestEntrySubmit(values: Record<string, unknown>) {
    try {
      const created = await submitShareEntryRecord(
        token,
        values,
        unlockToken ? { shareToken: unlockToken } : undefined,
      )
      setSubmittedRecords((prev) => [...prev, created])
      onNotifyRef.current?.('success', '填报成功，数据已提交保存')
    } catch (error) {
      if (error instanceof ApiError && (error.status === 410 || error.status === 403)) {
        setResponse(null)
        setLoadError(mapApiErrorToShareState(error))
      }
      throw error
    }
  }

  // ---------------- 分支 1：加载中 ----------------
  if (loading) {
    return (
      <div
        data-testid="share-access-page"
        className="st-page min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 text-slate-500"
      >
        <div className="st-spinner h-4 w-4" aria-hidden="true" />
        <div className="text-xs">正在加载免登录分享内容...</div>
      </div>
    )
  }

  // ---------------- 分支 2：失效 / 过期 / 不存在 / 无权 ----------------
  if (loadError || !response) {
    const err = loadError ?? {
      status: 500,
      title: '无法打开分享链接',
      description: '请稍后重试或联系分享者。',
    }
    return (
      <div
        data-testid="share-access-page"
        className="st-page min-h-screen flex-col items-center justify-center bg-slate-50 p-6"
      >
        <div
          data-testid="share-access-error"
          data-error-status={String(err.status)}
          data-share-status={err.errorStatus ?? ''}
          className="st-card w-full max-w-md p-8 text-center"
        >
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-base font-semibold text-slate-900">{err.title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">{err.description}</p>
          {onGoHome && (
            <button
              type="button"
              onClick={onGoHome}
              className="st-btn st-btn-secondary mx-auto mt-6"
            >
              前往工作台
            </button>
          )}
        </div>
      </div>
    )
  }

  // ---------------- 分支 3：密码门禁 ----------------
  if (!response.unlocked) {
    return (
      <div
        data-testid="share-access-page"
        className="st-page min-h-screen flex-col items-center justify-center bg-slate-50 p-6"
      >
        <div data-testid="share-password-gate" className="st-card w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-base font-semibold text-slate-900">此分享受访问密码保护</h1>
          <p className="mt-2 text-sm text-slate-500">
            {response.share.targetName} · {SHARE_TARGET_LABELS[response.share.targetType]}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            分享自 {response.share.createdByName} · 有效期{' '}
            {formatShareTimestamp(response.share.expiresAt)}
          </p>

          <form
            onSubmit={(e) => void handleVerifyPassword(e)}
            className="mt-6 space-y-3 text-left"
            noValidate
          >
            <div>
              <label htmlFor="st-share-password" className="st-label">
                访问密码
              </label>
              <div className="relative">
                <input
                  id="st-share-password"
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  disabled={verifying}
                  aria-label="分享访问密码"
                  value={passwordDraft}
                  onChange={(e) => {
                    setPasswordDraft(e.target.value)
                    if (passwordError) setPasswordError(null)
                  }}
                  placeholder="请输入分享密码"
                  className="st-input pr-9"
                />
                <button
                  type="button"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-2 flex items-center text-slate-400 transition-colors duration-150 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {passwordError && (
              <div role="alert" className="st-alert st-alert-red">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <button type="submit" disabled={verifying} className="st-btn st-btn-primary w-full">
              <KeyRound className="h-4 w-4" />
              <span>{verifying ? '校验中...' : '验证并访问'}</span>
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ---------------- 分支 4：entry 免登录数据录入填报 ----------------
  if (response.share.targetType === 'entry') {
    if (!primaryTable) {
      return (
        <div
          data-testid="share-access-page"
          className="st-page min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-sm text-slate-500"
        >
          关联的数据录入表不可用
        </div>
      )
    }

    return (
      <div
        data-testid="share-access-page"
        className="st-page min-h-screen bg-slate-50 text-slate-900"
      >
        <header className="st-page-header">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Table2 className="h-4 w-4" />
          </span>
          <h1 className="truncate text-base font-semibold text-slate-900">
            {primaryTable.meta.name}
          </h1>
          <span className="st-badge st-badge-green shrink-0">免登录数据填报</span>
          <span className="hidden truncate text-xs text-slate-500 sm:inline">
            分享自 {response.share.createdByName} · {formatShareTimestamp(response.share.expiresAt)}
          </span>
          <span className="st-badge st-badge-gray ml-auto shrink-0">
            匿名隔离 · 已填报 {submittedRecords.length} 条
          </span>
        </header>

        <main
          data-testid="share-guest-entry"
          className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-6"
        >
          <section className="st-card overflow-hidden">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">填写并提交记录</h2>
              <p className="mt-1 text-xs text-slate-500">
                带 <span className="text-red-500">*</span> 为必填项；提交后数据立即持久化写入表内。
              </p>
            </div>

            {submittedRecords.length > 0 && (
              <div data-testid="entry-submit-success" className="st-alert st-alert-green mx-6 mt-4">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  本次会话已成功提交 {submittedRecords.length} 条记录，您可以继续填写并提交下一条。
                </span>
              </div>
            )}

            <EntryRecordForm
              mode="create"
              columns={activeColumns}
              resetOnSuccess={true}
              submitLabel="提交填报"
              className="flex flex-col"
              fieldsClassName="grid gap-x-6 gap-y-4 p-6 md:grid-cols-2"
              footerClassName="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4"
              onSubmit={handleGuestEntrySubmit}
            />
          </section>

          <section data-testid="guest-submitted-records" className="st-card overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-900">
                本次已填报记录（{submittedRecords.length}）
              </h2>
              <span className="st-badge st-badge-gray">仅展示本人本次提交</span>
            </div>

            {submittedRecords.length === 0 ? (
              <div className="p-6">
                <div className="st-empty">
                  为保障业务数据安全，历史内部数据对匿名访客严格隔离不可见；提交上方表单后可在此预览您本次提交的记录。
                </div>
              </div>
            ) : (
              <div className="p-4">
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <GuestEntrySubmittedGrid columns={activeColumns} records={submittedRecords} />
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    )
  }

  // ---------------- 分支 5：app / view 只读分享工作区 ----------------
  if (
    !response.app ||
    !primaryTable ||
    !effectiveView ||
    !effectiveTableMeta ||
    !effectiveTableBundle
  ) {
    return (
      <div
        data-testid="share-access-page"
        className="st-page min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-sm text-slate-500"
      >
        该分享暂无可展示的视图内容
      </div>
    )
  }

  const activePivotConfig = effectiveView.pivotConfig ?? buildDefaultPivotConfig(activeColumns)
  const hasActiveFilters =
    effectiveView.filterGroup.conditions.length > 0 ||
    Object.values(effectiveView.quickFilterValues ?? {}).some((v) => v.length > 0)
  const showGridEmptyOverlay = activeCanvasKind === 'grid' && pipeline.displayRecords.length === 0
  const isAppShare = response.share.targetType === 'app'

  return (
    <div
      data-testid="share-access-page"
      className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-900"
    >
      {/* 访客顶部只读信息条（无 NavRail、无 Sidebar、无数据源跳转） */}
      <div data-testid="share-guest-workspace" className="st-page-header">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
          <Table2 className="h-4 w-4" />
        </span>
        <h1 className="truncate text-base font-semibold text-slate-900">
          {response.share.targetName}
        </h1>
        <span className="st-badge st-badge-blue shrink-0">
          <Eye className="h-3 w-3" />
          只读浏览
        </span>
        <span className="hidden truncate text-xs text-slate-500 sm:inline">
          分享自 {response.share.createdByName} · {formatShareTimestamp(response.share.expiresAt)}
        </span>
      </div>

      {/* 应用级分享支持多视图切换（严格只读、不暴露数据源入口） */}
      {isAppShare && guestViews.length > 0 && (
        <AppViewTabs
          canConfigureApp={false}
          canManageDataSource={false}
          canConfigureView={() => false}
          canShareApp={false}
          app={response.app}
          bundle={effectiveTableBundle}
          views={guestViews}
          activeViewId={effectiveView.id}
          onSelectView={(viewId) => {
            setActiveViewId(viewId)
            setDrillEvent(null)
            setPopupMenu(null)
          }}
          onCreateView={noopAsync}
          onRenameView={noopAsync}
          onDeleteView={noopAsync}
          onReorderViews={noopAsync}
        />
      )}

      {/* 只读工具栏（仅保留快捷筛选、临时筛选与导出） */}
      <Toolbar
        capabilities={GUEST_READONLY_CAPABILITIES}
        canCreateApp={false}
        targetKind="app"
        tableMeta={effectiveTableMeta}
        activeView={effectiveView}
        visibleColumns={visibleColumns}
        allComputedRecords={pipeline.allComputedRecords}
        displayRecords={pipeline.displayRecords}
        unresolvedConflictCount={0}
        selectedRecordIds={[]}
        watermarkEnabled={false}
        configDrawerOpen={false}
        onUpdateFilters={(patch) => updateLocalViewOverride(patch)}
        onToggleConfigDrawer={() => {}}
        onAddRow={noopAsync}
        onDeleteSelectedRows={noopAsync}
        onOpenAddColumn={() => {}}
        onOpenColumnManager={() => {}}
        onOpenLookupWizard={() => {}}
        onCreateAppFromTable={() => {}}
        onJumpToFirstConflict={() => {}}
        onToggleWatermark={() => {}}
        onNotify={(type, msg) => onNotifyRef.current?.(type, msg)}
      />

      {/* 主视图画布区 */}
      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        {effectiveView.type === 'kanban' ? (
          <KanbanView
            view={effectiveView}
            columns={activeColumns}
            records={pipeline.displayRecords}
            readonly={true}
            primaryKeyField={primaryTable.meta.primaryKeyField}
            onMoveCard={noopAsync}
            onUpdateRecord={noopAsync}
          />
        ) : effectiveView.type === 'dashboard' ? (
          <DashboardView
            view={effectiveView}
            columns={activeColumns}
            records={pipeline.displayRecords}
            readonly={true}
          />
        ) : (
          <>
            {effectiveView.type === 'pivot' && (
              <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 text-xs">
                <span className="truncate text-slate-500">透视分析 · 双击数据格可下钻查看明细</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => pivotAdapterRef.current?.expandAll()}
                    className="st-btn st-btn-xs st-btn-secondary"
                  >
                    <UnfoldVertical className="h-3 w-3" />
                    <span>展开全部</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => pivotAdapterRef.current?.collapseAll()}
                    className="st-btn st-btn-xs st-btn-secondary"
                  >
                    <FoldVertical className="h-3 w-3" />
                    <span>收起全部</span>
                  </button>
                </div>
              </div>
            )}

            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div ref={canvasContainerRef} className="h-full w-full" />
              {showGridEmptyOverlay && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/75 p-6">
                  <div className="st-card pointer-events-auto flex max-w-sm flex-col items-center p-6 text-center">
                    {pipeline.allComputedRecords.length === 0 ? (
                      <>
                        <Table2 className="mb-2 h-6 w-6 text-slate-400" />
                        <div className="text-sm font-semibold text-slate-900">当前视图暂无记录</div>
                        <div className="mt-1 text-xs text-slate-500">
                          当前分享权限范围内暂无可展示的数据记录。
                        </div>
                      </>
                    ) : (
                      <>
                        <Filter className="mb-2 h-6 w-6 text-slate-400" />
                        <div className="text-sm font-semibold text-slate-900">
                          没有符合筛选条件的记录
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          当前共有 {pipeline.allComputedRecords.length} 条记录被临时筛选条件过滤。
                        </div>
                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={() =>
                              updateLocalViewOverride({
                                filterGroup: { conjunction: 'and', conditions: [] },
                                quickFilterValues: {},
                              })
                            }
                            className="st-btn st-btn-primary mt-4"
                          >
                            清空全部筛选
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {popupMenu && (
        <GridPopupMenu
          context={popupMenu}
          onAction={(action) => handleGuestGridMenuAction(action)}
          onClose={() => setPopupMenu(null)}
        />
      )}

      {drillEvent && effectiveView.type === 'pivot' && (
        <DrillDownDrawer
          drillEvent={drillEvent}
          columns={activeColumns}
          allComputedRecords={pipeline.allComputedRecords}
          conflictsByRow={pipeline.conflictsByRow}
          pivotConfig={activePivotConfig}
          readonly={true}
          onClose={() => setDrillEvent(null)}
          onUpdateRecord={noopAsync}
        />
      )}
    </div>
  )
}
