// 智能表格应用主壳：串联数据加载、领域计算管线、Grid/Pivot 双画布挂载与全量交互闭环

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import {
  ApiError,
  createRecord,
  createTable,
  deleteRecord,
  fetchAllTables,
  resetDemoSeed,
  updateRecord,
  updateTableMeta,
} from './api'
import { SmartGridAdapter, type SmartGridConflictClickInfo } from './canvas/smart-grid'
import { SmartPivotAdapter } from './canvas/smart-pivot'
import { DisambiguatePopover } from './components/DisambiguatePopover'
import { DrillDownDrawer } from './components/DrillDownDrawer'
import { LookupWizardModal } from './components/LookupWizardModal'
import { PivotConfigBar } from './components/PivotConfigBar'
import { Sidebar } from './components/Sidebar'
import { SummaryFooter } from './components/SummaryFooter'
import { Toolbar } from './components/Toolbar'
import { ViewTabs } from './components/ViewTabs'
import { appendMatchRuleToLookupGroup } from './domain/lookup-engine'
import { runSmartTablePipeline } from './domain/query-engine'
import type { TableBundle } from './shared/api-types'
import type {
  LookupMatchRule,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
  SmartTableMeta,
  SmartView,
  SummaryType,
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

function buildNewRowPayload(meta: SmartTableMeta): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  const suffix = Date.now().toString(36).slice(-4).toUpperCase()
  for (const col of meta.columns) {
    if (col.type === 'formula' || col.type === 'lookup') continue
    if (meta.primaryKeyField && col.key === meta.primaryKeyField) {
      row[col.key] = meta.id === 'tbl_employees' ? `EMP-${suffix}` : `PK-${suffix}`
    } else if (col.type === 'checkbox') {
      row[col.key] = false
    } else if (col.type === 'progress') {
      row[col.key] = 0
    } else if (col.type === 'number') {
      row[col.key] = 0
    } else if (col.type === 'date') {
      row[col.key] = new Date().toISOString().slice(0, 10)
    } else if (col.type === 'select' && col.options && col.options.length > 0) {
      row[col.key] = col.options[0]!.label
    } else {
      row[col.key] = col.key === 'name' || col.key === 'project_name' ? `新建记录 ${suffix}` : ''
    }
  }
  return row
}

export function App() {
  const [tables, setTables] = useState<TableBundle[]>([])
  const [activeTableId, setActiveTableId] = useState('')
  const [activeViewId, setActiveViewId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [watermarkEnabled, setWatermarkEnabled] = useState(false)
  const [showLookupWizard, setShowLookupWizard] = useState(false)
  const [activeConflict, setActiveConflict] = useState<SmartGridConflictClickInfo | null>(null)
  const [drillEvent, setDrillEvent] = useState<PivotCellDrillEvent | null>(null)

  const canvasContainerRef = useRef<HTMLDivElement | null>(null)
  const gridAdapterRef = useRef<SmartGridAdapter | null>(null)
  const pivotAdapterRef = useRef<SmartPivotAdapter | null>(null)

  const loadInitialTables = useCallback(async () => {
    setLoading(true)
    setErrorMsg(null)
    try {
      const list = await fetchAllTables()
      setTables(list)
      const firstTable = list[0]
      if (firstTable) {
        setActiveTableId(firstTable.meta.id)
        setActiveViewId(firstTable.meta.views[0]?.id ?? '')
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '加载数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

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

  const handleSelectTable = useCallback(
    (tableId: string) => {
      const target = tablesById.get(tableId)
      setActiveTableId(tableId)
      setActiveViewId(target?.meta.views[0]?.id ?? '')
      setSelectedRecordIds([])
      setActiveConflict(null)
      setDrillEvent(null)
    },
    [tablesById],
  )

  const handleSaveMeta = useCallback(async (tableId: string, nextMeta: SmartTableMeta) => {
    setBusy(true)
    setErrorMsg(null)
    try {
      const saved = await updateTableMeta(tableId, nextMeta)
      setTables((prev) =>
        prev.map((bundle) => (bundle.meta.id === tableId ? { ...bundle, meta: saved } : bundle)),
      )
    } catch (error) {
      setErrorMsg(error instanceof ApiError ? error.message : '保存表结构失败')
    } finally {
      setBusy(false)
    }
  }, [])

  const handleUpdateRecord = useCallback(
    async (recordId: string, patch: Record<string, unknown>) => {
      if (!activeTable) return
      const tableId = activeTable.meta.id
      setErrorMsg(null)
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
      } catch (error) {
        setErrorMsg(error instanceof ApiError ? error.message : '更新记录失败')
        // 发生冲突（如 SQLite 主键唯一索引 409）时重新同步画布，回滚未落库的值
        if (gridAdapterRef.current && activeTable) {
          gridAdapterRef.current.setData(
            activeTable.meta.columns,
            pipeline.displayRecords,
            pipeline.conflictsByRow,
          )
        }
      }
    },
    [activeTable, pipeline.conflictsByRow, pipeline.displayRecords],
  )

  // 用 ref 持有最新回调，避免重挂载 Canvas 画布
  const handlersRef = useRef({
    onCellValueChange: handleUpdateRecord,
    onConflictClick: (info: SmartGridConflictClickInfo) => setActiveConflict(info),
    onRowSelectionChange: (ids: string[]) => setSelectedRecordIds(ids),
    onCellDrill: (ev: PivotCellDrillEvent) => setDrillEvent(ev),
  })
  handlersRef.current = {
    onCellValueChange: handleUpdateRecord,
    onConflictClick: (info: SmartGridConflictClickInfo) => setActiveConflict(info),
    onRowSelectionChange: (ids: string[]) => setSelectedRecordIds(ids),
    onCellDrill: (ev: PivotCellDrillEvent) => setDrillEvent(ev),
  }

  // 当切换表或视图类型时创建/销毁对应画布实例
  const viewKey = activeTable && activeView ? `${activeTable.meta.id}:${activeView.type}` : ''

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
        onCellValueChange: (recordId, fieldKey, newValue) => {
          void handlersRef.current.onCellValueChange(recordId, { [fieldKey]: newValue })
        },
        onConflictClick: (info) => handlersRef.current.onConflictClick(info),
        onRowSelectionChange: (ids) => handlersRef.current.onRowSelectionChange(ids),
      })
      adapter.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 内部数据`)
      gridAdapterRef.current = adapter
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
    // 仅在切换数据表或切换表格/透视类型时重建实例
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
  }, [activeTable, activeView, pipeline.displayRecords, pipeline.conflictsByRow])

  // 水印开关同步到当前激活画布
  useEffect(() => {
    if (!activeTable) return
    gridAdapterRef.current?.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 内部数据`)
    pivotAdapterRef.current?.setWatermark(watermarkEnabled, `${activeTable.meta.name} · 透视分析`)
  }, [watermarkEnabled, activeTable])

  async function handleCreateNormalTable(name: string, description?: string) {
    setBusy(true)
    setErrorMsg(null)
    try {
      const created = await createTable({ name, description })
      setTables((prev) => [...prev, created])
      setActiveTableId(created.meta.id)
      setActiveViewId(created.meta.views[0]?.id ?? '')
    } catch (error) {
      setErrorMsg(error instanceof ApiError ? error.message : '创建数据表失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleResetSeed() {
    setBusy(true)
    setErrorMsg(null)
    try {
      const fresh = await resetDemoSeed()
      setTables(fresh)
      setActiveTableId(fresh[0]?.meta.id ?? '')
      setActiveViewId(fresh[0]?.meta.views[0]?.id ?? '')
      setSelectedRecordIds([])
      setActiveConflict(null)
      setDrillEvent(null)
    } catch (error) {
      setErrorMsg(error instanceof ApiError ? error.message : '重置演示数据失败')
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
  }

  async function handleDeleteView(viewId: string) {
    if (!activeTable || activeTable.meta.views.length <= 1) return
    const remaining = activeTable.meta.views.filter((v) => v.id !== viewId)
    await handleSaveMeta(activeTable.meta.id, { ...activeTable.meta, views: remaining })
    if (activeViewId === viewId) {
      setActiveViewId(remaining[0]?.id ?? '')
    }
  }

  async function handleAddRow() {
    if (!activeTable) return
    setBusy(true)
    setErrorMsg(null)
    try {
      const created = await createRecord(activeTable.meta.id, buildNewRowPayload(activeTable.meta))
      setTables((prev) =>
        prev.map((b) =>
          b.meta.id === activeTable.meta.id ? { ...b, records: [...b.records, created] } : b,
        ),
      )
    } catch (error) {
      setErrorMsg(error instanceof ApiError ? error.message : '新增行失败')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSelectedRows() {
    if (!activeTable || selectedRecordIds.length === 0) return
    setBusy(true)
    setErrorMsg(null)
    try {
      for (const id of selectedRecordIds) {
        await deleteRecord(activeTable.meta.id, id)
      }
      const deletedSet = new Set(selectedRecordIds)
      setTables((prev) =>
        prev.map((b) =>
          b.meta.id === activeTable.meta.id
            ? { ...b, records: b.records.filter((r) => !deletedSet.has(r._id)) }
            : b,
        ),
      )
      setSelectedRecordIds([])
    } catch (error) {
      setErrorMsg(error instanceof ApiError ? error.message : '删除选中行失败')
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
            setActiveConflict({
              record: rec,
              column: col,
              conflict: info,
              rect: { x: 360, y: 120, width: 120, height: 32 },
            })
            return
          }
        }
      }
    }
  }

  function handleOpenPrintPreview() {
    if (!activeTable) return
    if (activeView?.type === 'pivot') {
      void pivotAdapterRef.current?.openPrintPreview({
        headerFooter: { header: { center: `${activeTable.meta.name} - 透视分析` } },
      })
    } else {
      void gridAdapterRef.current?.openPrintPreview({
        headerFooter: { header: { center: activeTable.meta.name } },
      })
    }
  }

  if (loading) {
    return <div className="st-loading-screen">正在加载智能表格工作台...</div>
  }

  if (!activeTable || !activeView) {
    return (
      <div className="st-loading-screen">
        <div>未找到数据表，请检查后端服务是否已启动。</div>
        {errorMsg && <div className="st-err-inline">{errorMsg}</div>}
      </div>
    )
  }

  const activePivotConfig =
    activeView.pivotConfig ?? buildDefaultPivotConfig(activeTable.meta.columns)

  return (
    <div className="st-app">
      <Sidebar
        tables={tables}
        activeTableId={activeTable.meta.id}
        busy={busy}
        onSelectTable={handleSelectTable}
        onCreateNormalTable={handleCreateNormalTable}
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
          onSelectView={(viewId) => {
            setActiveViewId(viewId)
            setDrillEvent(null)
          }}
          onAddView={(type) => void handleAddView(type)}
          onDeleteView={(viewId) => void handleDeleteView(viewId)}
        />

        {/* 固定高度错误通知槽，避免触发布局抖动 */}
        {errorMsg && (
          <div className="st-error-banner" role="alert">
            <span>⚠️ {errorMsg}</span>
            <button type="button" className="st-icon-btn" onClick={() => setErrorMsg(null)}>
              ×
            </button>
          </div>
        )}

        <Toolbar
          tableKind={activeTable.meta.kind}
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
          onOpenLookupWizard={() => setShowLookupWizard(true)}
          onJumpToFirstConflict={handleJumpToFirstConflict}
          onToggleWatermark={() => setWatermarkEnabled((v) => !v)}
          onOpenPrintPreview={handleOpenPrintPreview}
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

        <div className="st-canvas-stage" ref={canvasContainerRef} />

        {activeView.type === 'table' && (
          <SummaryFooter
            columns={activeTable.meta.columns}
            rowCount={pipeline.displayRecords.length}
            totalCount={pipeline.allComputedRecords.length}
            summaries={activeTable.meta.summaries}
            computedSummaries={pipeline.summaries}
            onChangeColumnSummary={(colKey, summaryType: SummaryType) => {
              void handleSaveMeta(activeTable.meta.id, {
                ...activeTable.meta,
                summaries: { ...activeTable.meta.summaries, [colKey]: summaryType },
              })
            }}
          />
        )}
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

      {drillEvent && activeView.type === 'pivot' && (
        <DrillDownDrawer
          drillEvent={drillEvent}
          columns={activeTable.meta.columns}
          allComputedRecords={pipeline.allComputedRecords}
          conflictsByRow={pipeline.conflictsByRow}
          pivotConfig={activePivotConfig}
          onClose={() => setDrillEvent(null)}
          onUpdateRecord={handleUpdateRecord}
        />
      )}
    </div>
  )
}
