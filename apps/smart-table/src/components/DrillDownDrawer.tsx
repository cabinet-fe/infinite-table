// 透视表双向「下钻」抽屉：Tab1 嵌入式明细网格（支持只读态与运维态）；Tab2 按下一维度逐层拆解下钻

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import { SmartGridAdapter, type SmartGridConflictClickInfo } from '../canvas/smart-grid'
import { computeDimensionBreakdown, getAvailableDrillDimensions } from '../domain/drill-engine'
import { scalarToText } from '../domain/utils'
import { formatNumberValue, formatPercentRatio, safeDecimalMul } from '../shared/number-format'
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

  function handleDrillBack() {
    setLevels((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }

  const detailHint = readonly
    ? '当前为只读查看态，可浏览穿透到底层的明细记录。'
    : '可直接在网格内编辑单元格，保存后透视表自动刷新聚合结果。'

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        className="flex h-full w-[400px] max-w-[94vw] shrink-0 flex-col border-l border-slate-200 bg-white shadow-modal animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="透视下钻抽屉"
      >
        <header className="st-drawer-header h-auto px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">透视下钻分析</h2>
            <div className="mt-1.5 flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-slate-500">
              {levels.length > 1 && (
                <button
                  type="button"
                  onClick={handleDrillBack}
                  aria-label="返回上一级"
                  title="返回上一级"
                  className="st-btn st-btn-xs st-btn-ghost"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              )}
              {levels.map((lvl, idx) => {
                const isCurrent = idx === levels.length - 1
                return (
                  <span
                    key={`${lvl.label}-${idx}`}
                    className="inline-flex min-w-0 items-center gap-1"
                  >
                    {idx > 0 && <span className="shrink-0 text-slate-300">/</span>}
                    <button
                      type="button"
                      title={lvl.label}
                      onClick={() => {
                        if (!isCurrent) {
                          setLevels((prev) => prev.slice(0, idx + 1))
                        }
                      }}
                      className={
                        isCurrent
                          ? 'st-chip st-chip-active min-w-0'
                          : 'min-w-0 max-w-36 truncate text-left text-xs text-slate-500 transition-colors hover:text-slate-800'
                      }
                    >
                      {isCurrent ? (
                        <span className="min-w-0 max-w-36 truncate">{lvl.label}</span>
                      ) : (
                        lvl.label
                      )}
                    </button>
                  </span>
                )
              })}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭下钻抽屉" className="st-icon-btn">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-slate-100 px-4">
          <div className="st-segment flex-1">
            <button
              type="button"
              onClick={() => setActiveTab('detail')}
              className={`st-segment-item ${activeTab === 'detail' ? 'st-segment-item-active' : ''}`}
            >
              明细数据（{currentRecords.length} 条）
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dimension')}
              className={`st-segment-item ${activeTab === 'dimension' ? 'st-segment-item-active' : ''}`}
            >
              按下一维度下钻
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'detail' ? (
            <div key="detail" className="flex h-full min-h-0 flex-col gap-2 p-4 pt-3">
              <div className="truncate text-xs leading-5 text-slate-500" title={detailHint}>
                {detailHint}
              </div>
              <div
                ref={gridContainerRef}
                className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200"
              />
            </div>
          ) : (
            <div key="dimension" className="st-scroll h-full space-y-4 overflow-y-auto p-4 pt-3">
              {availableDimensions.length === 0 ? (
                <div className="st-empty">所有可用维度已全部展开。</div>
              ) : (
                <>
                  <div>
                    <div className="st-section-label mb-2">选择拆解维度</div>
                    <div className="flex flex-wrap gap-1.5">
                      {availableDimensions.map((dim) => (
                        <button
                          key={dim.key}
                          type="button"
                          onClick={() => setSelectedDimKey(dim.key)}
                          className={`st-chip ${selectedDimKey === dim.key ? 'st-chip-active' : ''}`}
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
                      const primaryCol = primaryMeasure
                        ? columns.find((col) => col.key === primaryMeasure.field)
                        : undefined
                      const primaryText =
                        primaryMeasure && primaryVal !== null && primaryVal !== undefined
                          ? primaryMeasure.agg === 'count'
                            ? formatNumberValue(primaryVal, 'integer', primaryMeasure.decimalPlaces)
                            : formatNumberValue(
                                primaryVal,
                                primaryCol?.numberFormat,
                                primaryMeasure.decimalPlaces ?? primaryCol?.decimalPlaces,
                              )
                          : null
                      const ratioBarWidth = Math.max(4, Math.round(safeDecimalMul(item.ratio, 100)))
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => handleDrillNext(item.value, item.records)}
                          title="点击继续按此分组下钻"
                          className="st-card w-full p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                            <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
                              {item.value}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-slate-500">
                              <span className="tabular-nums">{item.count} 条</span>
                              {primaryMeasure && primaryText !== null && (
                                <strong className="font-semibold text-slate-800">
                                  {primaryMeasure.title}: {primaryText}
                                </strong>
                              )}
                              <span className="tabular-nums">
                                ({formatPercentRatio(item.ratio)})
                              </span>
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${ratioBarWidth}%` }}
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
