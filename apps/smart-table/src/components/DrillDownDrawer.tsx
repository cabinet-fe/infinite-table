// 透视表双向「下钻」抽屉：Tab1 嵌入式明细网格（支持只读态与运维态）；Tab2 按下一维度逐层拆解下钻

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import { SmartGridAdapter, type SmartGridConflictClickInfo } from '../canvas/smart-grid'
import { computeDimensionBreakdown, getAvailableDrillDimensions } from '../domain/drill-engine'
import { scalarToText } from '../domain/utils'
import type {
  LookupConflictInfo,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
} from '../shared/schema'
import type { RichCellEditInfo } from './CellEditorPopover'

export interface DrillLevel {
  label: string
  dimensionKey?: string
  recordIds: string[]
}

export interface DrillDownDrawerProps {
  drillEvent: PivotCellDrillEvent
  columns: readonly SmartColumn[]
  allComputedRecords: readonly SmartRecord[]
  conflictsByRow: Map<string, Map<string, LookupConflictInfo>>
  pivotConfig: SmartPivotConfig
  readonly?: boolean
  hasActiveOverlay?: boolean
  onClose: () => void
  onUpdateRecord: (recordId: string, patch: Record<string, unknown>) => Promise<void>
  onConflictClick?: (info: SmartGridConflictClickInfo) => void
  onRichCellEdit?: (info: RichCellEditInfo) => void
  onValidationError?: (message: string) => void
}

export function DrillDownDrawer({
  drillEvent,
  columns,
  allComputedRecords,
  conflictsByRow,
  pivotConfig,
  readonly = false,
  hasActiveOverlay = false,
  onClose,
  onUpdateRecord,
  onConflictClick,
  onRichCellEdit,
  onValidationError,
}: DrillDownDrawerProps) {
  const [activeTab, setActiveTab] = useState<'detail' | 'dimension'>('detail')
  const [levels, setLevels] = useState<DrillLevel[]>(() => [
    {
      label: `汇总格 (${drillEvent.records.length} 条)`,
      recordIds: drillEvent.records.map((r) => scalarToText(r._id)).filter(Boolean),
    },
  ])

  const prevDrillEventRef = useRef(drillEvent)
  useEffect(() => {
    if (prevDrillEventRef.current === drillEvent) {
      return
    }
    prevDrillEventRef.current = drillEvent
    setLevels([
      {
        label: `汇总格 (${drillEvent.records.length} 条)`,
        recordIds: drillEvent.records.map((r) => scalarToText(r._id)).filter(Boolean),
      },
    ])
  }, [drillEvent])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hasActiveOverlay) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasActiveOverlay, onClose])

  const currentLevel = levels[levels.length - 1]!
  const recordById = useMemo(() => {
    const map = new Map<string, SmartRecord>()
    for (const r of allComputedRecords) map.set(r._id, r)
    return map
  }, [allComputedRecords])

  const currentRecords = useMemo(() => {
    const list: SmartRecord[] = []
    for (const id of currentLevel.recordIds) {
      const rec = recordById.get(id)
      if (rec) list.push(rec)
    }
    return list
  }, [currentLevel.recordIds, recordById])

  const drilledDimensions = useMemo(
    () => levels.map((l) => l.dimensionKey).filter((k): k is string => Boolean(k)),
    [levels],
  )
  const availableDimensions = useMemo(
    () =>
      getAvailableDrillDimensions(
        columns,
        [...pivotConfig.rowDimensions, ...drilledDimensions],
        pivotConfig.columnDimensions,
      ),
    [columns, pivotConfig.rowDimensions, pivotConfig.columnDimensions, drilledDimensions],
  )

  const [selectedDimKey, setSelectedDimKey] = useState(availableDimensions[0]?.key ?? '')
  useEffect(() => {
    if (!availableDimensions.some((d) => d.key === selectedDimKey)) {
      setSelectedDimKey(availableDimensions[0]?.key ?? '')
    }
  }, [availableDimensions, selectedDimKey])

  const breakdown = useMemo(() => {
    if (!selectedDimKey) return []
    return computeDimensionBreakdown(currentRecords, selectedDimKey, pivotConfig.measures)
  }, [currentRecords, selectedDimKey, pivotConfig.measures])

  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const gridAdapterRef = useRef<SmartGridAdapter | null>(null)
  const latestDataRef = useRef({ columns, currentRecords, conflictsByRow, currentLevel })
  latestDataRef.current = { columns, currentRecords, conflictsByRow, currentLevel }
  const syncedDataRef = useRef<{
    columns: readonly SmartColumn[]
    records: readonly SmartRecord[]
    conflictsByRow: Map<string, Map<string, LookupConflictInfo>>
    level: DrillLevel
  } | null>(null)
  const handlersRef = useRef({
    onUpdateRecord,
    onConflictClick,
    onRichCellEdit,
    onValidationError,
  })
  handlersRef.current = {
    onUpdateRecord,
    onConflictClick,
    onRichCellEdit,
    onValidationError,
  }

  useEffect(() => {
    const container = gridContainerRef.current
    if (activeTab !== 'detail' || !container) {
      return
    }
    const latest = latestDataRef.current
    const adapter = new SmartGridAdapter({
      container,
      columns: latest.columns,
      records: latest.currentRecords,
      conflictsByRow: latest.conflictsByRow,
      readonly,
      showSummaryRow: false,
      onCellValueChange: (recordId, fieldKey, newValue) => {
        void handlersRef.current.onUpdateRecord(recordId, { [fieldKey]: newValue }).catch(() => {})
      },
      onConflictClick: (info) => handlersRef.current.onConflictClick?.(info),
      onRichCellEdit: (info) => handlersRef.current.onRichCellEdit?.(info),
      onValidationError: (msg) => handlersRef.current.onValidationError?.(msg),
    })
    gridAdapterRef.current = adapter
    syncedDataRef.current = {
      columns: latest.columns,
      records: latest.currentRecords,
      conflictsByRow: latest.conflictsByRow,
      level: latest.currentLevel,
    }
    return () => {
      adapter.destroy()
      gridAdapterRef.current = null
      syncedDataRef.current = null
    }
  }, [activeTab, readonly])

  useEffect(() => {
    const adapter = gridAdapterRef.current
    if (!adapter) {
      return
    }
    const prev = syncedDataRef.current
    if (
      prev &&
      prev.columns === columns &&
      prev.records === currentRecords &&
      prev.conflictsByRow === conflictsByRow &&
      prev.level === currentLevel
    ) {
      return
    }
    const levelChanged = prev?.level !== currentLevel
    syncedDataRef.current = {
      columns,
      records: currentRecords,
      conflictsByRow,
      level: currentLevel,
    }
    adapter.setData(columns, currentRecords, conflictsByRow)
    if (levelChanged) {
      adapter.getTable().scrollTo(0, 0)
    }
  }, [columns, currentRecords, conflictsByRow, currentLevel])

  function handleDrillNext(valueLabel: string, subRecords: readonly SmartRecord[]) {
    if (!selectedDimKey) return
    const dimTitle = columns.find((c) => c.key === selectedDimKey)?.title ?? selectedDimKey
    setLevels((prev) => [
      ...prev,
      {
        label: `${dimTitle}: ${valueLabel}`,
        dimensionKey: selectedDimKey,
        recordIds: subRecords.map((r) => r._id),
      },
    ])
  }

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="透视下钻抽屉"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">透视下钻分析</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
              {levels.map((lvl, idx) => (
                <span key={`${lvl.label}-${idx}`} className="inline-flex items-center gap-1">
                  {idx > 0 && <span className="text-slate-300">/</span>}
                  <button
                    type="button"
                    onClick={() => {
                      if (idx < levels.length - 1) {
                        setLevels((prev) => prev.slice(0, idx + 1))
                      }
                    }}
                    className={`rounded px-1.5 py-0.5 transition-colors ${
                      idx === levels.length - 1
                        ? 'bg-blue-50 font-medium text-blue-700'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    }`}
                  >
                    {lvl.label}
                  </button>
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭下钻抽屉"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 gap-4 border-b border-slate-200 px-5">
          <button
            type="button"
            onClick={() => setActiveTab('detail')}
            className={`border-b-2 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'detail'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            明细数据（{currentRecords.length} 条）
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('dimension')}
            className={`border-b-2 py-2.5 text-xs font-medium transition-colors ${
              activeTab === 'dimension'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            按下一维度下钻
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-4">
          {activeTab === 'detail' ? (
            <div key="detail" className="flex h-full min-h-0 flex-col gap-2.5">
              <div className="shrink-0 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {readonly
                  ? '当前为只读查看态，可浏览穿透到底层的明细记录。'
                  : '支持直接在明细网格内编辑单元格或处理消歧，保存后主透视表将自动重新聚合刷新。'}
              </div>
              <div
                ref={gridContainerRef}
                className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200"
              />
            </div>
          ) : (
            <div key="dimension" className="h-full space-y-4 overflow-y-auto">
              {availableDimensions.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  所有可用维度已全部展开。
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-slate-500">选择拆解维度</span>
                    <div className="flex flex-wrap gap-1.5">
                      {availableDimensions.map((dim) => (
                        <button
                          key={dim.key}
                          type="button"
                          onClick={() => setSelectedDimKey(dim.key)}
                          className={`h-7 rounded-full border px-3 text-xs transition-colors ${
                            selectedDimKey === dim.key
                              ? 'border-blue-300 bg-blue-50 font-medium text-blue-700'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {dim.title}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {breakdown.map((item) => {
                      const primaryMeasure = pivotConfig.measures[0]
                      const primaryVal = primaryMeasure
                        ? item.metrics[primaryMeasure.key]
                        : undefined
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => handleDrillNext(item.value, item.records)}
                          title="点击继续按此分组下钻"
                          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-900">{item.value}</span>
                            <span className="flex items-center gap-2.5 text-slate-500">
                              <span>{item.count} 条</span>
                              {primaryMeasure &&
                                primaryVal !== null &&
                                primaryVal !== undefined && (
                                  <strong className="font-semibold text-slate-800">
                                    {primaryMeasure.title}:{' '}
                                    {Number.isInteger(primaryVal)
                                      ? primaryVal.toLocaleString('zh-CN')
                                      : primaryVal.toLocaleString('zh-CN', {
                                          maximumFractionDigits: 2,
                                        })}
                                  </strong>
                                )}
                              <span>({(item.ratio * 100).toFixed(1)}%)</span>
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${Math.max(4, Math.round(item.ratio * 100))}%` }}
                            />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
