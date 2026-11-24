// 数据录入端主视图（/entries/:tableId）：无视图配置、无 VLOOKUP/分析视图，
// 聚焦 normal 表的快速行内编辑、单行表单抽屉录入/编辑、批量追加导入与 CSV/XLSX 导出，并按权限支持只读浏览。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
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
import { PageHeading } from './PageHeading'
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-white text-slate-900">
      {/* 顶部工具栏：左侧表身份与分享入口，右侧录入主操作 */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        {/* 左：表身份（表名即切换入口） */}
        <div ref={switcherMenuRef} className="flex min-w-0 items-center gap-2">
          <PageHeading
            icon={<Table2 className="h-4 w-4" />}
            meta={`数据录入端 · ${bundle.records.length} 条记录`}
            title={
              onSwitchTable ? (
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
                  className="-ml-1 flex h-7 max-w-64 items-center gap-1 rounded-md px-1.5 text-slate-900 transition-colors hover:bg-slate-100"
                >
                  <span className="min-w-0 flex-1 truncate text-left">{bundle.meta.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                </button>
              ) : (
                bundle.meta.name
              )
            }
          >
            {onSwitchTable && switcherOpen && (
              <div className="st-popover absolute top-full left-8 z-[900] mt-2 w-60">
                <div className="st-scroll max-h-64 overflow-y-auto">
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
                        className={`st-menu-item ${active ? 'st-menu-item-active' : ''}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        {active && <Check className="h-4 w-4 shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </PageHeading>
          {readonly && (
            <span className="st-badge st-badge-gray shrink-0">
              <Eye className="h-3 w-3" />
              <span>只读权限</span>
            </span>
          )}
        </div>

        {/* 右：分享 → 录入工具 → 主操作 → 导出 */}
        <div className="flex shrink-0 items-center gap-0.5">
          {onCopyEntryLink && (
            <button
              type="button"
              onClick={() => void onCopyEntryLink()}
              title="复制当前数据录入页分享链接"
              className="st-tool"
            >
              <Link2 className="h-4 w-4" />
              <span>复制链接</span>
            </button>
          )}
          {canShare && onOpenShare && (
            <button
              type="button"
              disabled={busy}
              onClick={onOpenShare}
              title="创建免登录对外填报分享链接"
              aria-label="对外分享"
              className="st-btn st-btn-secondary st-btn-sm ml-1.5"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>对外分享</span>
            </button>
          )}

          {!readonly && (
            <>
              <div className="st-divider-v mx-1.5" />

              <button
                type="button"
                disabled={busy}
                onClick={() => setShowAppendModal(true)}
                className="st-tool"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>批量追加导入</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDrawerState({ open: true, mode: 'create' })}
                className="st-tool"
              >
                <ClipboardList className="h-4 w-4" />
                <span>表单录入</span>
              </button>
              <button
                type="button"
                disabled={busy || !focusedRecord}
                title="查看或编辑当前选中行的详情表单（也可双击行号打开）"
                aria-label="行详情"
                onClick={() => {
                  if (focusedRecord) {
                    setDrawerState({ open: true, mode: 'edit', recordId: focusedRecord._id })
                  }
                }}
                className="st-tool st-tool-icon"
              >
                <FilePenLine className="h-4 w-4" />
                <span className="sr-only">行详情</span>
              </button>

              {selectedRecordIds.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="st-btn st-btn-danger-soft"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>删除选中 ({selectedRecordIds.length})</span>
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleQuickAddRow()}
                className="st-btn st-btn-primary ml-1.5"
              >
                <Plus className="h-4 w-4" />
                <span>新增行</span>
              </button>
            </>
          )}

          <div ref={exportMenuRef} className="relative ml-1.5">
            <button
              type="button"
              disabled={exporting}
              aria-label="导出"
              title="导出"
              aria-expanded={exportOpen}
              onClick={() => setExportOpen((v) => !v)}
              className="st-tool st-tool-icon"
            >
              <Download className="h-4 w-4" />
              <span className="sr-only">导出</span>
            </button>

            {exportOpen && (
              <div className="st-popover absolute top-full right-0 z-[900] mt-2 w-40">
                <button
                  type="button"
                  onClick={() => void handleExport('csv')}
                  className="st-menu-item"
                >
                  <span className="min-w-0 flex-1">导出 CSV</span>
                  <span className="text-xs text-slate-400">.csv</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport('xlsx')}
                  className="st-menu-item"
                >
                  <span className="min-w-0 flex-1">导出 Excel</span>
                  <span className="text-xs text-slate-400">.xlsx</span>
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
            <div className="st-empty pointer-events-auto max-w-sm p-6">
              <Table2 className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              <div className="text-sm text-slate-500">当前数据表暂无记录</div>
              <div className="mt-1 text-xs text-slate-500">
                {readonly
                  ? '当前为只读权限，暂无可查看的记录。'
                  : '通过表单录入单条数据，或批量追加导入 Excel / CSV 文件。'}
              </div>
              {!readonly && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDrawerState({ open: true, mode: 'create' })}
                    className="st-btn st-btn-sm st-btn-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>表单录入</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setShowAppendModal(true)}
                    className="st-btn st-btn-sm st-btn-secondary"
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
