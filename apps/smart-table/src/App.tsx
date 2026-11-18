// 智能表格应用主壳：串联数据加载、领域计算管线、Grid/Pivot 双画布挂载、Toast 通知与全量交互闭环

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import type { Region } from '@infinitable/render'
import {
  ApiError,
  createRecord,
  createTable,
  deleteRecord,
  deleteTable,
  fetchAllTables,
  resetDemoSeed,
  updateRecord,
  updateTableMeta,
} from './api'
import { SmartGridAdapter, type SmartGridConflictClickInfo } from './canvas/smart-grid'
import { SmartPivotAdapter } from './canvas/smart-pivot'
import { CellEditorPopover, type RichCellEditInfo } from './components/CellEditorPopover'
import { DisambiguatePopover } from './components/DisambiguatePopover'
import { DrillDownDrawer } from './components/DrillDownDrawer'
import { FilterIcon, PlusIcon, RotateCcwIcon, TableIcon } from './components/Icons'
import { ImportExcelModal } from './components/ImportExcelModal'
import { LookupFieldPanel } from './components/LookupFieldPanel'
import { LookupWizardModal } from './components/LookupWizardModal'
import { PivotConfigBar } from './components/PivotConfigBar'
import { Sidebar } from './components/Sidebar'
import { ToastHost, type ToastItem, type ToastType } from './components/Toast'
import { Toolbar } from './components/Toolbar'
import { ViewTabs } from './components/ViewTabs'
import { appendMatchRuleToLookupGroup } from './domain/lookup-engine'
import { runSmartTablePipeline } from './domain/query-engine'
import type { TableBundle } from './shared/api-types'
import type {
  LookupMatchRule,
  SelectOption,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
  SmartTableMeta,
  SmartView,
  SortRule,
} from './shared/schema'

function buildDefaultPivotConfig(columns: readonly SmartColumn[]): SmartPivotConfig {
  const rowDim = columns.find(
    (c) => c.type === 'select' || c.type === 'text' || c.type === 'lookup',
  )
  const colDim = columns.find(
    (c) =>
      c.key !== rowDim?.key && (c.type === 'person' || c.type === 'select' || c.type === 'lookup'),
  )
  const numCol = columns.find(
    (c) => c.type === 'number' || c.type === 'formula' || c.type === 'progress',
  )
  return {
    rowDimensions: rowDim ? [rowDim.key] : [],
    columnDimensions: colDim ? [colDim.key] : [],
    measures: numCol
      ? [{ key: numCol.key, title: numCol.title, field: numCol.key, agg: 'sum', width: 120 }]
      : [{ key: '__count__', title: '记录数', field: '__count__', agg: 'count', width: 100 }],
    showGrandTotal: true,
    collapsible: true,
  }
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

  const nextViews = meta.views.map((view) => {
    const nextQuickFields = view.quickFilterFields.filter((f) => f !== columnKey)
    const nextQuickValues = view.quickFilterValues ? { ...view.quickFilterValues } : undefined
    if (nextQuickValues) {
      delete nextQuickValues[columnKey]
    }
    const nextFilterGroup = {
      ...view.filterGroup,
      conditions: view.filterGroup.conditions.filter((c) => c.field !== columnKey),
    }
    const nextSortRules = view.sortRules.filter((r) => r.field !== columnKey)

    let nextPivot = view.pivotConfig
    if (nextPivot) {
      const remainingMeasures = nextPivot.measures.filter((m) => m.field !== columnKey)
      nextPivot = {
        ...nextPivot,
        rowDimensions: nextPivot.rowDimensions.filter((d) => d !== columnKey),
        columnDimensions: nextPivot.columnDimensions.filter((d) => d !== columnKey),
        measures:
          remainingMeasures.length > 0
            ? remainingMeasures
            : [{ key: '__count__', title: '记录数', field: '__count__', agg: 'count', width: 100 }],
      }
    }

    return {
      ...view,
      quickFilterFields: nextQuickFields,
      ...(nextQuickValues ? { quickFilterValues: nextQuickValues } : {}),
      filterGroup: nextFilterGroup,
      sortRules: nextSortRules,
      ...(nextPivot ? { pivotConfig: nextPivot } : {}),
    }
  })

  return {
    ...meta,
    columns: meta.columns.filter((c) => c.key !== columnKey),
    summaries: nextSummaries,
    views: nextViews,
  }
}

export function App() {
  const [tables, setTables] = useState<TableBundle[]>([])
  const [activeTableId, setActiveTableId] = useState('')
  const [activeViewId, setActiveViewId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [watermarkEnabled, setWatermarkEnabled] = useState(false)
  const [showLookupWizard, setShowLookupWizard] = useState(false)
  const [fieldSettings, setFieldSettings] = useState<{ columnKey: string; rect: Region } | null>(
    null,
  )
  const [showImportModal, setShowImportModal] = useState(false)
  const [activeConflict, setActiveConflict] = useState<SmartGridConflictClickInfo | null>(null)
  const [activeCellEdit, setActiveCellEdit] = useState<RichCellEditInfo | null>(null)
  const [drillEvent, setDrillEvent] = useState<PivotCellDrillEvent | null>(null)

  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const gridAdapterRef = useRef<SmartGridAdapter | null>(null)
  const pivotAdapterRef = useRef<SmartPivotAdapter | null>(null)
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const pendingConflictJumpRef = useRef<{ recordId: string; colKey: string } | null>(null)

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
      for (const timer of toastTimersRef.current.values()) {
        clearTimeout(timer)
      }
      toastTimersRef.current.clear()
    }
  }, [])

  const loadInitialTables = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const list = await fetchAllTables()
      setTables(list)
      const firstTable = list[0]
      if (firstTable) {
        setActiveTableId(firstTable.meta.id)
        setActiveViewId(firstTable.meta.views[0]?.id ?? '')
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '加载数据失败'
      setLoadError(msg)
      pushToast('error', msg)
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    void loadInitialTables()
  }, [loadInitialTables])

  const tablesById = useMemo(() => {
    const map = new Map<string, TableBundle>()
    for (const bundle of tables) {
      map.set(bundle.meta.id, bundle)
    }
    return map
  }, [tables])

  const activeTable = useMemo(
    () => tablesById.get(activeTableId) ?? tables[0],
    [tablesById, activeTableId, tables],
  )

  const activeView = useMemo(() => {
    if (!activeTable) return undefined
    return activeTable.meta.views.find((v) => v.id === activeViewId) ?? activeTable.meta.views[0]
  }, [activeTable, activeViewId])

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
    return runSmartTablePipeline(activeTable.meta, activeTable.records, tablesById, activeView)
  }, [activeTable, tablesById, activeView])

  const clearViewTransientState = useCallback(() => {
    setSelectedRecordIds([])
    setActiveConflict(null)
    setActiveCellEdit(null)
    setDrillEvent(null)
    setFieldSettings(null)
  }, [])

  const handleSelectTable = useCallback(
    (tableId: string) => {
      const target = tablesById.get(tableId)
      setActiveTableId(tableId)
      setActiveViewId(target?.meta.views[0]?.id ?? '')
      clearViewTransientState()
    },
    [tablesById, clearViewTransientState],
  )

  const handleSelectView = useCallback(
    (viewId: string) => {
      setActiveViewId(viewId)
      clearViewTransientState()
    },
    [clearViewTransientState],
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

  const handleUpdateRecord = useCallback(
    async (recordId: string, patch: Record<string, unknown>) => {
      if (!activeTable) return
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
        // 克隆 records 触发 pipeline 重算，强制主画布与下钻抽屉同步回滚未落库的值
        setTables((prev) =>
          prev.map((bundle) =>
            bundle.meta.id === tableId
              ? {
                  ...bundle,
                  records: bundle.records.map((r) => ({ ...r })),
                }
              : bundle,
          ),
        )
        throw error
      }
    },
    [activeTable, pushToast],
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
        setActiveConflict({
          record: rec,
          column: col,
          conflict,
          rect,
        })
      })
    },
    [activeTable, pipeline.conflictsByRow, pipeline.displayRecords],
  )

  // 用 ref 持有最新回调，避免重挂载 Canvas 画布
  const handlersRef = useRef({
    onCellValueChange: handleUpdateRecord,
    onConflictClick: (info: SmartGridConflictClickInfo) => setActiveConflict(info),
    onRowSelectionChange: (ids: string[]) => setSelectedRecordIds(ids),
    onRichCellEdit: (info: RichCellEditInfo) => setActiveCellEdit(info),
    onValidationError: (msg: string) => pushToast('error', msg),
    onCellDrill: (ev: PivotCellDrillEvent) => setDrillEvent(ev),
    onHeaderColumnSort: (field: string, meta: { additive: boolean }) =>
      handleHeaderColumnSort(field, meta),
    onHeaderContextMenu: (info: { column: SmartColumn; rect: Region }) => {
      if (info.column.type === 'lookup') {
        setFieldSettings({ columnKey: info.column.key, rect: info.rect })
      }
    },
  })
  handlersRef.current = {
    onCellValueChange: handleUpdateRecord,
    onConflictClick: (info: SmartGridConflictClickInfo) => setActiveConflict(info),
    onRowSelectionChange: (ids: string[]) => setSelectedRecordIds(ids),
    onRichCellEdit: (info: RichCellEditInfo) => setActiveCellEdit(info),
    onValidationError: (msg: string) => pushToast('error', msg),
    onCellDrill: (ev: PivotCellDrillEvent) => setDrillEvent(ev),
    onHeaderColumnSort: (field: string, meta: { additive: boolean }) =>
      handleHeaderColumnSort(field, meta),
    onHeaderContextMenu: (info: { column: SmartColumn; rect: Region }) => {
      if (info.column.type === 'lookup') {
        setFieldSettings({ columnKey: info.column.key, rect: info.rect })
      }
    },
  }

  const viewIdentity = activeTable && activeView ? `${activeTable.meta.id}:${activeView.id}` : ''
  const viewKey = activeView ? `${viewIdentity}:${activeView.type}` : ''

  // 视图标识变化时清空瞬态选中与浮层状态
  useEffect(() => {
    clearViewTransientState()
  }, [viewIdentity, clearViewTransientState])

  // 当切换表或视图类型时创建/销毁对应画布实例
  useEffect(() => {
    const container = canvasContainerRef.current
    if (!container || !activeTable || !activeView) {
      return
    }

    gridAdapterRef.current?.destroy()
    gridAdapterRef.current = null
    pivotAdapterRef.current?.destroy()
    pivotAdapterRef.current = null

    if (activeView.type === 'table') {
      const adapter = new SmartGridAdapter({
        container,
        columns: activeTable.meta.columns,
        records: pipeline.displayRecords,
        conflictsByRow: pipeline.conflictsByRow,
        sortRules: activeView.sortRules,
        view: activeView,
        summaries: activeView.summaries ?? activeTable.meta.summaries,
        summaryResults: pipeline.summaries,
        totalCount: pipeline.allComputedRecords.length,
        onCellValueChange: (recordId, fieldKey, newValue) => {
          void handlersRef.current
            .onCellValueChange(recordId, { [fieldKey]: newValue })
            .catch(() => {})
        },
        onConflictClick: (info) => handlersRef.current.onConflictClick(info),
        onRowSelectionChange: (ids) => handlersRef.current.onRowSelectionChange(ids),
        onRichCellEdit: (info) => handlersRef.current.onRichCellEdit(info),
        onValidationError: (msg) => handlersRef.current.onValidationError(msg),
        onHeaderSortClick: (info) =>
          handlersRef.current.onHeaderColumnSort(info.field, { additive: info.additive }),
        onContextMenu: (info) => {
          if (info.region === 'col-header' && info.column) {
            handlersRef.current.onHeaderContextMenu({ column: info.column, rect: info.rect })
          }
        },
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

    const pivotConfig = activeView.pivotConfig ?? buildDefaultPivotConfig(activeTable.meta.columns)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey])

  // 数据/配置变化时原地刷新画布，不闪烁重建
  useEffect(() => {
    if (!activeTable || !activeView) return
    if (activeView.type === 'table') {
      gridAdapterRef.current?.setData(
        activeTable.meta.columns,
        pipeline.displayRecords,
        pipeline.conflictsByRow,
        activeView.sortRules,
        {
          view: activeView,
          summaries: activeView.summaries ?? activeTable.meta.summaries,
          summaryResults: pipeline.summaries,
          totalCount: pipeline.allComputedRecords.length,
        },
      )
    } else if (activeView.type === 'pivot') {
      const pivotConfig =
        activeView.pivotConfig ?? buildDefaultPivotConfig(activeTable.meta.columns)
      pivotAdapterRef.current?.update({
        columns: activeTable.meta.columns,
        records: pipeline.displayRecords,
        config: pivotConfig,
      })
    }
  }, [
    activeTable,
    activeView,
    pipeline.displayRecords,
    pipeline.conflictsByRow,
    pipeline.summaries,
    pipeline.allComputedRecords.length,
  ])

  // 水印开关同步到当前激活画布
  useEffect(() => {
    if (!activeTable) return
    gridAdapterRef.current?.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 内部数据`)
    pivotAdapterRef.current?.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 透视分析`)
  }, [watermarkEnabled, activeTable])

  async function handleCreateNormalTable(name: string, description?: string) {
    setBusy(true)
    try {
      const created = await createTable({ name, description })
      setTables((prev) => [...prev, created])
      setActiveTableId(created.meta.id)
      setActiveViewId(created.meta.views[0]?.id ?? '')
      clearViewTransientState()
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

  /** Excel/CSV 导入成功：并入表列表、切到新表默认视图并关弹窗（对齐建表成功行为） */
  function handleImported(bundle: TableBundle) {
    setTables((prev) => [...prev, bundle])
    setActiveTableId(bundle.meta.id)
    setActiveViewId(bundle.meta.views[0]?.id ?? '')
    clearViewTransientState()
    setShowImportModal(false)
    pushToast('success', `已导入「${bundle.meta.name}」（${bundle.records.length} 行）`)
  }

  async function handleDeleteTable(tableId: string) {
    setBusy(true)
    try {
      await deleteTable(tableId)
      const remaining = tables.filter((b) => b.meta.id !== tableId)
      setTables(remaining)
      if (activeTableId === tableId || !remaining.some((b) => b.meta.id === activeTableId)) {
        const fallback = remaining[0]
        setActiveTableId(fallback?.meta.id ?? '')
        setActiveViewId(fallback?.meta.views[0]?.id ?? '')
        clearViewTransientState()
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
      const fresh = await resetDemoSeed()
      setTables(fresh)
      setActiveTableId(fresh[0]?.meta.id ?? '')
      setActiveViewId(fresh[0]?.meta.views[0]?.id ?? '')
      clearViewTransientState()
      pushToast('success', '已重置为初始演示数据')
    } catch (error) {
      const msg = error instanceof ApiError ? error.message : '重置演示数据失败'
      pushToast('error', msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdateView(nextView: SmartView) {
    if (!activeTable) return
    const nextMeta: SmartTableMeta = {
      ...activeTable.meta,
      views: activeTable.meta.views.map((v) => (v.id === nextView.id ? nextView : v)),
    }
    await handleSaveMeta(activeTable.meta.id, nextMeta)
  }

  async function handleAddView(type: 'table' | 'pivot') {
    if (!activeTable) return
    const count = activeTable.meta.views.filter((v) => v.type === type).length + 1
    const nextView: SmartView = {
      id: `view_${Date.now().toString(36).slice(-5)}`,
      name: type === 'pivot' ? `透视分析 ${count}` : `表格视图 ${count}`,
      type,
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: [],
      sortRules: [],
      ...(type === 'pivot'
        ? { pivotConfig: buildDefaultPivotConfig(activeTable.meta.columns) }
        : {}),
    }
    const nextMeta: SmartTableMeta = {
      ...activeTable.meta,
      views: [...activeTable.meta.views, nextView],
    }
    await handleSaveMeta(activeTable.meta.id, nextMeta)
    setActiveViewId(nextView.id)
    pushToast('success', `已新建视图「${nextView.name}」`)
  }

  async function handleRenameView(viewId: string, nextName: string) {
    if (!activeTable) return
    const target = activeTable.meta.views.find((v) => v.id === viewId)
    if (!target) return
    await handleUpdateView({ ...target, name: nextName })
    pushToast('success', `视图已重命名为「${nextName}」`)
  }

  async function handleDeleteView(viewId: string) {
    if (!activeTable || activeTable.meta.views.length <= 1) return
    const remaining = activeTable.meta.views.filter((v) => v.id !== viewId)
    await handleSaveMeta(activeTable.meta.id, { ...activeTable.meta, views: remaining })
    if (activeViewId === viewId) {
      setActiveViewId(remaining[0]?.id ?? '')
    }
    pushToast('success', '视图已删除')
  }

  async function handleAddRow() {
    if (!activeTable) return
    setBusy(true)
    try {
      const created = await createRecord(activeTable.meta.id, buildNewRowPayload(activeTable.meta))
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

  async function handleDeleteSelectedRows() {
    if (!activeTable || selectedRecordIds.length === 0) return
    const tableId = activeTable.meta.id
    const targetIds = [...selectedRecordIds]
    setBusy(true)
    try {
      const results = await Promise.allSettled(targetIds.map((id) => deleteRecord(tableId, id)))
      const succeededIds = new Set<string>()
      let failedCount = 0
      results.forEach((res, idx) => {
        if (res.status === 'fulfilled') {
          succeededIds.add(targetIds[idx]!)
        } else {
          failedCount += 1
        }
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
    const nextMeta = stripDeletedColumnFromMeta(activeTable.meta, columnKey)
    await handleSaveMeta(activeTable.meta.id, nextMeta)
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
    const nextOverrides = {
      ...record?._lookupOverrides,
      [groupId]: targetRecordId,
    }
    await handleUpdateRecord(recordId, { _lookupOverrides: nextOverrides })
  }

  async function handleAppendMatchRule(groupId: string, rule: LookupMatchRule) {
    if (!activeTable) return
    const nextCols = appendMatchRuleToLookupGroup(activeTable.meta.columns, groupId, rule)
    await handleSaveMeta(activeTable.meta.id, {
      ...activeTable.meta,
      columns: nextCols,
    })
    pushToast('success', '已追加联合匹配条件')
  }

  /** 关联字段设置保存：nextColumns 已含删改增结果，被删列同步清理视图/汇总配置 */
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
    if (!activeTable) return
    for (const rec of pipeline.displayRecords) {
      const rowMap = pipeline.conflictsByRow.get(rec._id)
      if (!rowMap) continue
      for (const [groupId, info] of rowMap.entries()) {
        if (!info.isResolved) {
          const col = activeTable.meta.columns.find(
            (c) => c.type === 'lookup' && c.lookupConfig?.groupId === groupId,
          )
          if (col) {
            if (activeView?.type === 'pivot') {
              const firstTableView = activeTable.meta.views.find((v) => v.type === 'table')
              if (firstTableView) {
                pendingConflictJumpRef.current = { recordId: rec._id, colKey: col.key }
                setActiveViewId(firstTableView.id)
                return
              }
            }
            if (gridAdapterRef.current) {
              focusAndOpenConflict(gridAdapterRef.current, rec._id, col.key)
            }
            return
          }
        }
      }
    }
  }

  /** 列头点击排序（仅表格视图；透视视图列头语义不同）。复用 SmartView.sortRules 走 handleUpdateView 持久化 */
  function handleHeaderColumnSort(field: string, meta: { additive: boolean }) {
    if (!activeView || activeView.type !== 'table') return
    void handleUpdateView({
      ...activeView,
      sortRules: cycleSortRules(activeView.sortRules, field, meta.additive),
    })
  }

  function handleClearAllFilters() {
    if (!activeView) return
    void handleUpdateView({
      ...activeView,
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterValues: {},
    })
  }

  if (loading) {
    return (
      <div className="st-loading-screen">
        <div className="st-loading-spinner" aria-hidden="true" />
        <div>正在加载智能表格工作台...</div>
      </div>
    )
  }

  if (!activeTable || !activeView) {
    return (
      <div className="st-loading-screen">
        <div className="st-empty-card">
          <TableIcon size={28} className="st-empty-icon" />
          <div className="st-empty-title">未加载到数据表</div>
          <div className="st-empty-desc">{loadError || '请确认后端服务已启动并可正常访问。'}</div>
          <button
            type="button"
            className="st-btn st-btn-primary"
            onClick={() => void loadInitialTables()}
          >
            <RotateCcwIcon size={13} />
            <span>重试加载</span>
          </button>
        </div>
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </div>
    )
  }

  const activePivotConfig =
    activeView.pivotConfig ?? buildDefaultPivotConfig(activeTable.meta.columns)

  const hasActiveFilters =
    activeView.filterGroup.conditions.length > 0 ||
    Object.values(activeView.quickFilterValues ?? {}).some((v) => v.length > 0)

  const showTableEmptyOverlay = activeView.type === 'table' && pipeline.displayRecords.length === 0

  return (
    <div className="st-app">
      <ToastHost toasts={toasts} onDismiss={dismissToast} />

      <Sidebar
        tables={tables}
        activeTableId={activeTable.meta.id}
        busy={busy}
        onSelectTable={handleSelectTable}
        onCreateNormalTable={handleCreateNormalTable}
        onRenameTable={handleRenameTable}
        onDeleteTable={handleDeleteTable}
        onOpenImport={() => setShowImportModal(true)}
        onResetSeed={handleResetSeed}
      />

      <main className="st-main">
        <ViewTabs
          views={activeTable.meta.views}
          activeViewId={activeView.id}
          tableName={activeTable.meta.name}
          tableKind={activeTable.meta.kind}
          primaryKeyField={activeTable.meta.primaryKeyField}
          sourceSqlTable={activeTable.meta.sourceSqlTable}
          busy={busy}
          onSelectView={handleSelectView}
          onAddView={(type) => void handleAddView(type)}
          onRenameView={handleRenameView}
          onDeleteView={handleDeleteView}
        />

        <Toolbar
          tableId={activeTable.meta.id}
          tableKind={activeTable.meta.kind}
          primaryKeyField={activeTable.meta.primaryKeyField}
          columns={activeTable.meta.columns}
          allComputedRecords={pipeline.allComputedRecords}
          activeView={activeView}
          unresolvedConflictCount={pipeline.unresolvedConflictCount}
          selectedRecordIds={selectedRecordIds}
          watermarkEnabled={watermarkEnabled}
          busy={busy}
          onUpdateView={handleUpdateView}
          onAddRow={handleAddRow}
          onDeleteSelectedRows={handleDeleteSelectedRows}
          onAddColumn={(col) => handleAddColumns([col])}
          onRenameColumn={handleRenameColumn}
          onDeleteColumn={handleDeleteColumn}
          onOpenLookupWizard={() => setShowLookupWizard(true)}
          onEditLookupColumn={(columnKey, anchor) =>
            setFieldSettings({ columnKey, rect: anchor.getBoundingClientRect() })
          }
          onJumpToFirstConflict={handleJumpToFirstConflict}
          onToggleWatermark={() => setWatermarkEnabled((v) => !v)}
        />

        {activeView.type === 'pivot' && (
          <PivotConfigBar
            columns={activeTable.meta.columns}
            config={activePivotConfig}
            onChangeConfig={(nextPivot) => {
              void handleUpdateView({ ...activeView, pivotConfig: nextPivot })
            }}
            onExpandAll={() => pivotAdapterRef.current?.expandAll()}
            onCollapseAll={() => pivotAdapterRef.current?.collapseAll()}
          />
        )}

        <div className="st-canvas-stage">
          <div ref={canvasContainerRef} className="st-canvas-mount" />

          {showTableEmptyOverlay && (
            <div className="st-canvas-empty-overlay">
              <div className="st-empty-card">
                {pipeline.allComputedRecords.length === 0 ? (
                  <>
                    <TableIcon size={28} className="st-empty-icon" />
                    <div className="st-empty-title">当前数据表暂无记录</div>
                    <div className="st-empty-desc">添加第一条数据以开始管理与跨表关联计算。</div>
                    <button
                      type="button"
                      className="st-btn st-btn-primary"
                      disabled={busy}
                      onClick={() => void handleAddRow()}
                    >
                      <PlusIcon size={13} />
                      <span>添加第一条记录</span>
                    </button>
                  </>
                ) : (
                  <>
                    <FilterIcon size={26} className="st-empty-icon" />
                    <div className="st-empty-title">没有符合筛选条件的记录</div>
                    <div className="st-empty-desc">
                      当前共有 {pipeline.allComputedRecords.length} 条记录被筛选条件过滤。
                    </div>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        className="st-btn st-btn-primary"
                        disabled={busy}
                        onClick={handleClearAllFilters}
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
      </main>

      {showLookupWizard && (
        <LookupWizardModal
          sourceTable={activeTable}
          sourceComputedRecords={pipeline.allComputedRecords}
          allTables={tables}
          onClose={() => setShowLookupWizard(false)}
          onSubmitColumns={handleAddColumns}
        />
      )}

      {fieldSettings &&
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

      {showImportModal && (
        <ImportExcelModal
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
          onError={(msg) => pushToast('error', msg)}
        />
      )}

      {drillEvent && activeView.type === 'pivot' && (
        <DrillDownDrawer
          drillEvent={drillEvent}
          columns={activeTable.meta.columns}
          allComputedRecords={pipeline.allComputedRecords}
          conflictsByRow={pipeline.conflictsByRow}
          pivotConfig={activePivotConfig}
          hasActiveOverlay={Boolean(activeConflict || activeCellEdit)}
          onClose={() => setDrillEvent(null)}
          onUpdateRecord={handleUpdateRecord}
          onConflictClick={(info) => setActiveConflict(info)}
          onRichCellEdit={(info) => setActiveCellEdit(info)}
          onValidationError={(msg) => pushToast('error', msg)}
        />
      )}

      {activeConflict && (
        <DisambiguatePopover
          conflictInfo={activeConflict}
          sourceColumns={activeTable.meta.columns}
          targetBundle={tablesById.get(activeConflict.conflict.targetTableId)}
          onClose={() => setActiveConflict(null)}
          onSelectCandidate={handleSelectConflictCandidate}
          onAppendMatchRule={handleAppendMatchRule}
        />
      )}

      {activeCellEdit && (
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
    </div>
  )
}
