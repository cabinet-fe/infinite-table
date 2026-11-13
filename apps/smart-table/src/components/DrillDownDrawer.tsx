// 透视表双向「下钻」抽屉：Tab1 嵌入式明细网格可编辑同步回写；Tab2 按下一维度逐层拆解下钻

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import { SmartGridAdapter } from '../canvas/smart-grid'
import { computeDimensionBreakdown, getAvailableDrillDimensions } from '../domain/drill-engine'
import { scalarToText } from '../domain/utils'
import type {
  LookupConflictInfo,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
} from '../shared/schema'

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
  onClose: () => void
  onUpdateRecord: (recordId: string, patch: Record<string, unknown>) => Promise<void>
}

export function DrillDownDrawer({
  drillEvent,
  columns,
  allComputedRecords,
  conflictsByRow,
  pivotConfig,
  onClose,
  onUpdateRecord,
}: DrillDownDrawerProps) {
  const [activeTab, setActiveTab] = useState<'detail' | 'dimension'>('detail')
  const [levels, setLevels] = useState<DrillLevel[]>(() => [
    {
      label: `汇总格 (${drillEvent.records.length} 条)`,
      recordIds: drillEvent.records.map((r) => scalarToText(r._id)).filter(Boolean),
    },
  ])

  // 当重新双击新透视格时重置下钻栈
  useEffect(() => {
    setLevels([
      {
        label: `汇总格 (${drillEvent.records.length} 条)`,
        recordIds: drillEvent.records.map((r) => scalarToText(r._id)).filter(Boolean),
      },
    ])
  }, [drillEvent])

  const currentLevel = levels[levels.length - 1]!
  const recordById = useMemo(() => {
    const map = new Map<string, SmartRecord>()
    for (const r of allComputedRecords) {
      map.set(r._id, r)
    }
    return map
  }, [allComputedRecords])

  const currentRecords = useMemo(() => {
    const list: SmartRecord[] = []
    for (const id of currentLevel.recordIds) {
      const rec = recordById.get(id)
      if (rec) {
        list.push(rec)
      }
    }
    return list
  }, [currentLevel.recordIds, recordById])

  const drilledDimensions = levels.map((l) => l.dimensionKey).filter((k): k is string => Boolean(k))
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

  // Tab1: 挂载只读+可编辑嵌套 SmartGridAdapter
  const gridContainerRef = useRef<HTMLDivElement | null>(null)
  const gridAdapterRef = useRef<SmartGridAdapter | null>(null)
  const onUpdateRef = useRef(onUpdateRecord)
  onUpdateRef.current = onUpdateRecord

  useEffect(() => {
    if (activeTab !== 'detail' || !gridContainerRef.current) {
      return
    }
    const adapter = new SmartGridAdapter({
      container: gridContainerRef.current,
      columns,
      records: currentRecords,
      conflictsByRow,
      onCellValueChange: (recordId, fieldKey, newValue) => {
        void onUpdateRef.current(recordId, { [fieldKey]: newValue })
      },
    })
    gridAdapterRef.current = adapter
    return () => {
      adapter.destroy()
      gridAdapterRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  useEffect(() => {
    gridAdapterRef.current?.setData(columns, currentRecords, conflictsByRow)
  }, [columns, currentRecords, conflictsByRow])

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
    <div className="st-drawer-backdrop" onClick={onClose}>
      <aside
        className="st-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="透视下钻抽屉"
      >
        <div className="st-drawer-header">
          <div>
            <h2 className="st-modal-title">透视下钻分析</h2>
            <div className="st-breadcrumb">
              {levels.map((lvl, idx) => (
                <span key={idx} className="st-breadcrumb-item">
                  {idx > 0 && <span className="st-breadcrumb-sep">/</span>}
                  <button
                    type="button"
                    className={`st-breadcrumb-btn ${idx === levels.length - 1 ? 'is-current' : ''}`}
                    onClick={() => setLevels((prev) => prev.slice(0, idx + 1))}
                  >
                    {lvl.label}
                  </button>
                </span>
              ))}
            </div>
          </div>
          <button type="button" className="st-icon-btn" onClick={onClose} aria-label="关闭下钻抽屉">
            ×
          </button>
        </div>

        <div className="st-drawer-tabs">
          <button
            type="button"
            className={`st-drawer-tab ${activeTab === 'detail' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('detail')}
          >
            明细数据（{currentRecords.length} 条）
          </button>
          <button
            type="button"
            className={`st-drawer-tab ${activeTab === 'dimension' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('dimension')}
          >
            按下一维度下钻
          </button>
        </div>

        <div className="st-drawer-body">
          {activeTab === 'detail' ? (
            <div className="st-drawer-grid-wrap">
              <div className="st-drawer-tip">
                支持直接在明细网格内编辑单元格，保存后主透视表将自动重新聚合刷新。
              </div>
              <div ref={gridContainerRef} className="st-drawer-grid-canvas" />
            </div>
          ) : (
            <div className="st-drill-breakdown">
              {availableDimensions.length === 0 ? (
                <div className="st-empty-state">所有可用维度已全部展开。</div>
              ) : (
                <>
                  <div className="st-drill-dim-bar">
                    <span className="st-slot-label">选择拆解维度</span>
                    <div className="st-pill-list">
                      {availableDimensions.map((dim) => (
                        <button
                          key={dim.key}
                          type="button"
                          className={`st-chip ${selectedDimKey === dim.key ? 'is-active' : ''}`}
                          onClick={() => setSelectedDimKey(dim.key)}
                        >
                          {dim.title}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="st-breakdown-list">
                    {breakdown.map((item) => {
                      const primaryMeasure = pivotConfig.measures[0]
                      const primaryVal = primaryMeasure
                        ? item.metrics[primaryMeasure.key]
                        : undefined
                      return (
                        <button
                          key={item.value}
                          type="button"
                          className="st-breakdown-item"
                          onClick={() => handleDrillNext(item.value, item.records)}
                          title="点击继续按此分组下钻"
                        >
                          <div className="st-breakdown-head">
                            <span className="st-breakdown-name">{item.value}</span>
                            <span className="st-breakdown-nums">
                              <span>{item.count} 条</span>
                              {primaryMeasure &&
                                primaryVal !== null &&
                                primaryVal !== undefined && (
                                  <strong>
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
                          <div className="st-ratio-track">
                            <div
                              className="st-ratio-fill"
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
