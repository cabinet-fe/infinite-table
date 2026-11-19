// 数据录入端主视图（/entries/:tableId）：无视图配置、无 VLOOKUP/分析视图，
// 聚焦 normal 表的快速行内编辑、单行表单抽屉录入/编辑、批量追加导入与 CSV/XLSX 导出，并按权限支持只读浏览。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ClipboardList,
  Download,
  Eye,
  FilePenLine,
  FileSpreadsheet,
  Link2,
  Plus,
  Share2,
  Table2,
  Trash2,
} from 'lucide-react'
import {
  SmartGridAdapter,
  type SmartGridRichEditInfo,
  type SmartGridSelectionInfo,
} from '../canvas/smart-grid'
import { runSmartTablePipeline } from '../domain/query-engine'
import type { TableBundle } from '../shared/api-types'
import { validateAndCoerceCellValue } from '../shared/record-validation'
import { filterRawColumns, type SmartRecord, type SmartView, type SortRule } from '../shared/schema'
import { AppendImportModal } from './AppendImportModal'
import { CellEditorPopover } from './CellEditorPopover'
import { ConfirmModal } from './ConfirmModal'
import { EntryRecordDrawer } from './EntryRecordDrawer'
import type { ToastType } from './Toast'
import { exportRecordsAsFile } from './Toolbar'

export interface EntryWorkspaceProps {
  bundle: TableBundle
  busy?: boolean
  readonly?: boolean
  canShare?: boolean
  switchableTables?: readonly { id: string; name: string }[]
  onSwitchTable?: (tableId: string) => void
  onLoadSwitchableTables?: () => Promise<void> | void
  onCopyEntryLink?: () => void | Promise<void>
  onOpenShare?: () => void
  onCreateRecord: (record: Record<string, unknown>) => Promise<SmartRecord | void>
  onUpdateRecord: (recordId: string, patch: Record<string, unknown>) => Promise<SmartRecord | void>
  onDeleteRecords: (recordIds: string[]) => Promise<void>
  onBatchAppendRecords: (records: Record<string, unknown>[]) => Promise<void>
  onBackToWorkbench?: () => void
  onNotify?: (type: ToastType, message: string) => void
}

function nextLocalSortRules(
  prev: readonly SortRule[],
  field: string,
  additive: boolean,
): SortRule[] {
  const existing = prev.find((r) => r.field === field)
  const nextDir = !existing ? 'asc' : existing.direction === 'asc' ? 'desc' : null
  if (!additive) {
    return nextDir ? [{ field, direction: nextDir }] : []
  }
  const rest = prev.filter((r) => r.field !== field)
  return nextDir ? [...rest, { field, direction: nextDir }] : rest
}

export function EntryWorkspace({
  bundle,
  busy = false,
  readonly = false,
  canShare = false,
  switchableTables,
  onSwitchTable,
  onLoadSwitchableTables,
  onCopyEntryLink,
  onOpenShare,
  onCreateRecord,
  onUpdateRecord,
  onDeleteRecords,
  onBatchAppendRecords,
  onBackToWorkbench,
  onNotify,
}: EntryWorkspaceProps) {
  const rawColumns = useMemo(() => filterRawColumns(bundle.meta.columns), [bundle.meta.columns])
  const hasRequiredColumns = useMemo(
    () => rawColumns.some((col) => Boolean(col.required)),
    [rawColumns],
  )

  const [sortRules, setSortRules] = useState<SortRule[]>([])
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null)
  const [drawerState, setDrawerState] = useState<
    | { open: false }
    | { open: true; mode: 'create' }
    | { open: true; mode: 'edit'; recordId: string }
  >({ open: false })
  const [showAppendModal, setShowAppendModal] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [richEditInfo, setRichEditInfo] = useState<SmartGridRichEditInfo | null>(null)

  const switcherMenuRef = useRef<HTMLDivElement | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const gridAdapterRef = useRef<SmartGridAdapter | null>(null)

  const switcherOptions = useMemo(() => {
    const list = switchableTables && switchableTables.length > 0 ? [...switchableTables] : []
    if (!list.some((item) => item.id === bundle.meta.id)) {
      list.unshift({ id: bundle.meta.id, name: bundle.meta.name })
    }
    return list
  }, [switchableTables, bundle.meta.id, bundle.meta.name])

  useEffect(() => {
    setSortRules([])
    setSelectedRecordIds([])
    setFocusedRecordId(null)
    setDrawerState({ open: false })
    setShowAppendModal(false)
    setConfirmDeleteOpen(false)
    setSwitcherOpen(false)
    setExportOpen(false)
    setRichEditInfo(null)
  }, [bundle.meta.id])

  useEffect(() => {
    if (readonly) {
      setDrawerState({ open: false })
      setShowAppendModal(false)
      setConfirmDeleteOpen(false)
      setRichEditInfo(null)
    }
  }, [readonly])

  const sortView = useMemo<SmartView>(
    () => ({
      id: '__entry_view__',
      name: bundle.meta.name,
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: [],
      sortRules,
      summaries: bundle.meta.summaries,
    }),
    [bundle.meta.name, bundle.meta.summaries, sortRules],
  )

  const pipeline = useMemo(
    () =>
      runSmartTablePipeline(
        { ...bundle.meta, columns: rawColumns },
        bundle.records,
        new Map(),
        sortView,
      ),
    [bundle.meta, rawColumns, bundle.records, sortView],
  )

  const focusedRecord = useMemo(() => {
    const targetId = focusedRecordId ?? selectedRecordIds[0] ?? null
    if (!targetId) return null
    return pipeline.displayRecords.find((r) => r._id === targetId) ?? null
  }, [focusedRecordId, selectedRecordIds, pipeline.displayRecords])

  const editingRecord = useMemo(() => {
    if (!drawerState.open || drawerState.mode !== 'edit') return null
    return bundle.records.find((r) => r._id === drawerState.recordId) ?? null
  }, [drawerState, bundle.records])

  const handlersRef = useRef({
    displayRecords: pipeline.displayRecords,
    onUpdateRecord,
    onNotify,
  })
  handlersRef.current = {
    displayRecords: pipeline.displayRecords,
    onUpdateRecord,
    onNotify,
  }

  useEffect(() => {
    if (!exportOpen && !switcherOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (target && exportMenuRef.current?.contains(target)) return
      if (target && switcherMenuRef.current?.contains(target)) return
      setExportOpen(false)
      setSwitcherOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportOpen(false)
        setSwitcherOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [exportOpen, switcherOpen])

  useEffect(() => {
    const container = gridContainerRef.current
    if (!container) return

    const adapter = new SmartGridAdapter({
      container,
      columns: rawColumns,
      records: pipeline.displayRecords,
      readonly,
      sortRules,
      summaries: bundle.meta.summaries,
      summaryResults: pipeline.summaries,
      totalCount: bundle.records.length,
      onCellValueChange: (recordId, fieldKey, newValue) => {
        if (readonly) return
        void handlersRef.current
          .onUpdateRecord(recordId, { [fieldKey]: newValue })
          .catch((error) => {
            const msg = error instanceof Error ? error.message : '单元格保存失败'
            handlersRef.current.onNotify?.('error', msg)
          })
      },
      onRichCellEdit: (info) => {
        if (!readonly) setRichEditInfo(info)
      },
      onValidationError: (msg) => handlersRef.current.onNotify?.('error', msg),
      onRowSelectionChange: (ids) => setSelectedRecordIds(ids),
      onSelectionInfoChange: (info: SmartGridSelectionInfo) => {
        const focusRow = info.focus?.row
        const fromFocus =
          focusRow !== undefined ? handlersRef.current.displayRecords[focusRow]?._id : undefined
        setFocusedRecordId(fromFocus ?? info.recordIds[0] ?? null)
      },
      onHeaderSortClick: (info) =>
        setSortRules((prev) => nextLocalSortRules(prev, info.field, info.additive)),
    })

    const onRowHeaderDblClick = (event: MouseEvent) => {
      if (readonly) return
      const rect = container.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const table = adapter.getTable()
      if (x < 0 || x >= table.rowHeaderWidth || y < table.headerHeight) return
      const hit = table.getCellAtRelativePosition(table.rowHeaderWidth + 1, y)
      if (!hit) return
      const targetRecord = handlersRef.current.displayRecords[hit.row]
      if (targetRecord) {
        setDrawerState({ open: true, mode: 'edit', recordId: targetRecord._id })
      }
    }

    container.addEventListener('dblclick', onRowHeaderDblClick)
    gridAdapterRef.current = adapter
    return () => {
      container.removeEventListener('dblclick', onRowHeaderDblClick)
      adapter.destroy()
      gridAdapterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.meta.id, readonly])

  useEffect(() => {
    gridAdapterRef.current?.setData(rawColumns, pipeline.displayRecords, undefined, sortRules, {
      summaries: bundle.meta.summaries,
      summaryResults: pipeline.summaries,
      totalCount: bundle.records.length,
    })
  }, [
    rawColumns,
    pipeline.displayRecords,
    pipeline.summaries,
    sortRules,
    bundle.meta.summaries,
    bundle.records.length,
  ])

  async function handleQuickAddRow() {
    if (readonly) return
    if (hasRequiredColumns) {
      setDrawerState({ open: true, mode: 'create' })
      return
    }
    try {
      await onCreateRecord({})
      onNotify?.('success', '已新增空白记录行')
    } catch (error) {
      onNotify?.('error', error instanceof Error ? error.message : '新增行失败')
    }
  }

  async function handleDrawerSubmit(values: Record<string, unknown>, recordId?: string) {
    if (readonly) return
    if (recordId) {
      await onUpdateRecord(recordId, values)
      onNotify?.('success', '记录修改已保存')
    } else {
      await onCreateRecord(values)
      onNotify?.('success', '新记录已录入')
    }
  }

  async function handleExport(format: 'csv' | 'xlsx') {
    setExportOpen(false)
    setExporting(true)
    try {
      const msg = await exportRecordsAsFile(
        format,
        bundle.meta.name,
        rawColumns,
        pipeline.displayRecords,
      )
      onNotify?.('success', msg)
    } catch (error) {
      onNotify?.('error', error instanceof Error ? error.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  async function handleRichCommit(recordId: string, fieldKey: string, value: unknown) {
    if (readonly) return
    const col = rawColumns.find((c) => c.key === fieldKey)
    if (col) {
      const check = validateAndCoerceCellValue(col, value)
      if (!check.valid) {
        onNotify?.('error', check.message)
        throw new Error(check.message)
      }
      await onUpdateRecord(recordId, { [fieldKey]: check.value })
      return
    }
    await onUpdateRecord(recordId, { [fieldKey]: value })
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50 text-slate-900">
      {/* 数据录入端精简顶部工具栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {onBackToWorkbench && (
            <button
              type="button"
              onClick={onBackToWorkbench}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>工作台</span>
            </button>
          )}
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ClipboardList className="h-4 w-4" />
          </span>
          {onSwitchTable ? (
            <div ref={switcherMenuRef} className="relative min-w-0">
              <button
                type="button"
                aria-label="切换数据录入表"
                aria-expanded={switcherOpen}
                onClick={() => {
                  const nextOpen = !switcherOpen
                  setSwitcherOpen(nextOpen)
                  if (nextOpen) {
                    void onLoadSwitchableTables?.()
                  }
                }}
                className="inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-md border border-transparent px-2 text-sm font-semibold text-slate-900 hover:border-slate-200 hover:bg-slate-50"
              >
                <span className="truncate">{bundle.meta.name}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </button>

              {switcherOpen && (
                <div className="absolute left-0 top-full z-[900] mt-1.5 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    切换数据录入表
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {switcherOptions.map((item) => {
                      const active = item.id === bundle.meta.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setSwitcherOpen(false)
                            if (item.id !== bundle.meta.id) {
                              onSwitchTable(item.id)
                            }
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ${
                            active
                              ? 'bg-emerald-50 font-semibold text-emerald-700'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          <span className="truncate">{item.name}</span>
                          {active && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <h1 className="truncate text-sm font-semibold text-slate-900">{bundle.meta.name}</h1>
          )}
          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            数据录入端
          </span>
          {readonly && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              <Eye className="h-3 w-3" />
              <span>只读</span>
            </span>
          )}
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {bundle.records.length} 条记录
          </span>
          {onCopyEntryLink && (
            <button
              type="button"
              onClick={() => void onCopyEntryLink()}
              title="复制当前数据录入页分享链接"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>复制链接</span>
            </button>
          )}
          {canShare && onOpenShare && (
            <button
              type="button"
              disabled={busy}
              onClick={onOpenShare}
              title="创建免登录对外填报分享链接"
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>对外分享</span>
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!readonly && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleQuickAddRow()}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>新增行</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => setDrawerState({ open: true, mode: 'create' })}
                className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>表单录入</span>
              </button>

              <button
                type="button"
                disabled={busy || !focusedRecord}
                title="查看或编辑当前选中行的详情表单（也可双击行号打开）"
                onClick={() => {
                  if (focusedRecord) {
                    setDrawerState({ open: true, mode: 'edit', recordId: focusedRecord._id })
                  }
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <FilePenLine className="h-3.5 w-3.5" />
                <span>行详情</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => setShowAppendModal(true)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                <span>批量追加导入</span>
              </button>

              {selectedRecordIds.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>删除选中 ({selectedRecordIds.length})</span>
                </button>
              )}
            </>
          )}

          <div ref={exportMenuRef} className="relative">
            <button
              type="button"
              disabled={exporting}
              onClick={() => setExportOpen((v) => !v)}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              <span>导出</span>
            </button>

            {exportOpen && (
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
        </div>
      </header>

      {/* 主画布区：仅渲染底层原始字段网格 */}
      <main className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <div ref={gridContainerRef} className="h-full w-full" />
        {bundle.records.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/75 p-6">
            <div className="pointer-events-auto flex max-w-sm flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              <Table2 className="mb-2.5 h-7 w-7 text-slate-400" />
              <div className="text-sm font-semibold text-slate-900">当前数据表暂无记录</div>
              <div className="mt-1 text-xs text-slate-500">
                {readonly
                  ? '当前为只读权限，暂无可查看的记录。'
                  : '点击下方按钮通过表单录入单条数据，或批量追加导入 Excel / CSV 文件。'}
              </div>
              {!readonly && (
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDrawerState({ open: true, mode: 'create' })}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>表单录入</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowAppendModal(true)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    <span>批量追加导入</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {!readonly && (
        <EntryRecordDrawer
          open={drawerState.open}
          mode={drawerState.open ? drawerState.mode : 'create'}
          record={editingRecord}
          columns={rawColumns}
          busy={busy}
          onClose={() => setDrawerState({ open: false })}
          onSubmit={handleDrawerSubmit}
        />
      )}

      {!readonly && showAppendModal && (
        <AppendImportModal
          tableName={bundle.meta.name}
          columns={rawColumns}
          onClose={() => setShowAppendModal(false)}
          onSubmitBatch={async (records) => {
            await onBatchAppendRecords(records)
            onNotify?.('success', `成功追加导入 ${records.length} 条记录`)
          }}
        />
      )}

      {!readonly && richEditInfo && (
        <CellEditorPopover
          editInfo={richEditInfo}
          allowCreateSelectOption={false}
          onClose={() => setRichEditInfo(null)}
          onCommit={handleRichCommit}
        />
      )}

      <ConfirmModal
        open={confirmDeleteOpen}
        title="确认删除选中记录"
        description={`确定要删除已选中的 ${selectedRecordIds.length} 条记录吗？此操作不可撤销。`}
        confirmText={`删除 ${selectedRecordIds.length} 条记录`}
        busy={busy}
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={async () => {
          await onDeleteRecords(selectedRecordIds)
          setSelectedRecordIds([])
          setConfirmDeleteOpen(false)
          onNotify?.('success', `已删除 ${selectedRecordIds.length} 条记录`)
        }}
      />
    </div>
  )
}
