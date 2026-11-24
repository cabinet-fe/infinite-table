// 视图配置抽屉 · 透视分析分栏（原 PivotConfigBar 收敛至此）：
// 管理行/列维度（互斥防重 + 保留至少 1 个行维度）、指标与聚合方式、总计与折叠开关。

import { Lightbulb, Lock, X } from 'lucide-react'
import { columnsToPivotFields } from '../canvas/smart-pivot'
import {
  DECIMAL_PLACES_OPTIONS,
  fromDecimalPlacesChoice,
  toDecimalPlacesChoice,
} from '../shared/number-format'
import type {
  SmartColumn,
  SmartPivotAgg,
  SmartPivotConfig,
  SmartPivotMeasureConfig,
} from '../shared/schema'
import { CustomSelect, type CustomSelectOption } from './CustomSelect'

export interface DrawerPivotPanelProps {
  columns: readonly SmartColumn[]
  config: SmartPivotConfig
  onChangeConfig: (next: SmartPivotConfig) => void
  onExpandAll: () => void
  onCollapseAll: () => void
}

const AGG_LABELS: Record<SmartPivotAgg, string> = {
  sum: '求和',
  count: '计数',
  avg: '均值',
  min: '最小',
  max: '最大',
}

const AGG_OPTIONS: CustomSelectOption<SmartPivotAgg>[] = (
  Object.keys(AGG_LABELS) as SmartPivotAgg[]
).map((agg) => ({
  value: agg,
  label: AGG_LABELS[agg],
}))

function isCountRecordMeasure(fieldKey: string): boolean {
  return fieldKey === '' || fieldKey === '__count__'
}

function colTitleOf(columns: readonly SmartColumn[], fieldKey: string): string {
  if (isCountRecordMeasure(fieldKey)) {
    return '记录数'
  }
  return columns.find((c) => c.key === fieldKey)?.title ?? fieldKey
}

export function DrawerPivotPanel({
  columns,
  config,
  onChangeConfig,
  onExpandAll,
  onCollapseAll,
}: DrawerPivotPanelProps) {
  const { dimensions, measures } = columnsToPivotFields(columns)

  const usedDims = new Set([...config.rowDimensions, ...config.columnDimensions])
  const availableDimOptions: CustomSelectOption<string>[] = dimensions
    .filter((d) => !usedDims.has(d.key))
    .map((d) => ({ value: d.key, label: d.title }))

  const measureOptions: CustomSelectOption<string>[] = measures.map((m) => ({
    value: m.key,
    label: m.title,
  }))

  function addDimension(target: 'row' | 'col', key: string) {
    if (!key || usedDims.has(key)) return
    if (target === 'row') {
      onChangeConfig({ ...config, rowDimensions: [...config.rowDimensions, key] })
    } else {
      onChangeConfig({ ...config, columnDimensions: [...config.columnDimensions, key] })
    }
  }

  function removeDimension(target: 'row' | 'col', key: string) {
    if (target === 'row') {
      if (config.rowDimensions.length <= 1) return
      onChangeConfig({
        ...config,
        rowDimensions: config.rowDimensions.filter((k) => k !== key),
      })
    } else {
      onChangeConfig({
        ...config,
        columnDimensions: config.columnDimensions.filter((k) => k !== key),
      })
    }
  }

  function addMeasure(fieldKey: string) {
    const candidate = measures.find((m) => m.key === fieldKey)
    if (!candidate) return
    const nextMeasure: SmartPivotMeasureConfig = {
      key: `${candidate.field}_${Date.now().toString(36).slice(-4)}`,
      title: candidate.title,
      field: candidate.field,
      agg: isCountRecordMeasure(candidate.field) ? 'count' : candidate.agg,
      width: candidate.width,
    }
    onChangeConfig({
      ...config,
      measures: [...config.measures, nextMeasure],
    })
  }

  function updateMeasureAgg(measureKey: string, agg: SmartPivotAgg) {
    onChangeConfig({
      ...config,
      measures: config.measures.map((m) => {
        if (m.key !== measureKey || isCountRecordMeasure(m.field)) {
          return m
        }
        const next: SmartPivotMeasureConfig = {
          ...m,
          agg,
          title: `${colTitleOf(columns, m.field)}(${AGG_LABELS[agg]})`,
        }
        if (agg === 'count') {
          delete next.decimalPlaces
        }
        return next
      }),
    })
  }

  function updateMeasureDecimalPlaces(measureKey: string, choice: string) {
    const decimalPlaces = fromDecimalPlacesChoice(choice)
    onChangeConfig({
      ...config,
      measures: config.measures.map((m) => {
        if (m.key !== measureKey || isCountRecordMeasure(m.field)) {
          return m
        }
        const next: SmartPivotMeasureConfig = { ...m }
        if (decimalPlaces === undefined) {
          delete next.decimalPlaces
        } else {
          next.decimalPlaces = decimalPlaces
        }
        return next
      }),
    })
  }

  function removeMeasure(measureKey: string) {
    if (config.measures.length <= 1) return
    onChangeConfig({
      ...config,
      measures: config.measures.filter((m) => m.key !== measureKey),
    })
  }

  const rowDimLocked = config.rowDimensions.length <= 1

  return (
    <div className="space-y-5">
      {/* 行维度 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="st-section-label">行维度</h3>
          {availableDimOptions.length > 0 && (
            <CustomSelect
              size="xs"
              value=""
              triggerLabel="+ 添加行维度"
              ariaLabel="添加行维度"
              options={availableDimOptions}
              onChange={(key) => addDimension('row', key)}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {config.rowDimensions.map((key) => {
            const label = colTitleOf(columns, key)
            return (
              <span key={key} className="st-pill st-pill-blue">
                <span>{label}</span>
                <button
                  type="button"
                  disabled={rowDimLocked}
                  title={rowDimLocked ? '至少保留 1 个行维度' : `移除行维度 ${label}`}
                  aria-label={`移除行维度 ${label}`}
                  onClick={() => removeDimension('row', key)}
                  className="-mr-1 rounded-full p-0.5 transition-colors hover:bg-blue-100 disabled:pointer-events-none disabled:opacity-40"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      </section>

      {/* 列维度 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="st-section-label">列维度</h3>
          {availableDimOptions.length > 0 && (
            <CustomSelect
              size="xs"
              value=""
              triggerLabel="+ 添加列维度"
              ariaLabel="添加列维度"
              options={availableDimOptions}
              onChange={(key) => addDimension('col', key)}
            />
          )}
        </div>
        {config.columnDimensions.length === 0 ? (
          <div className="text-xs text-slate-500">未设置列维度（按行维度平铺汇总）</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {config.columnDimensions.map((key) => {
              const label = colTitleOf(columns, key)
              return (
                <span key={key} className="st-pill st-pill-violet">
                  <span>{label}</span>
                  <button
                    type="button"
                    title={`移除列维度 ${label}`}
                    aria-label={`移除列维度 ${label}`}
                    onClick={() => removeDimension('col', key)}
                    className="-mr-1 rounded-full p-0.5 transition-colors hover:bg-indigo-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </section>

      {/* 度量指标 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="st-section-label">汇总指标</h3>
          <CustomSelect
            size="xs"
            value=""
            triggerLabel="+ 添加指标"
            ariaLabel="添加汇总指标"
            options={measureOptions}
            onChange={addMeasure}
          />
        </div>
        <div className="space-y-1.5">
          {config.measures.map((m) => {
            const isCount = isCountRecordMeasure(m.field)
            const displayName = colTitleOf(columns, m.field)
            return (
              <div key={m.key} className="st-card group space-y-1.5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                    {displayName}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {isCount ? (
                      <span className="st-pill st-pill-gray" title="记录数仅支持计数">
                        <Lock className="h-3 w-3 shrink-0" />
                        <span>计数</span>
                      </span>
                    ) : (
                      <CustomSelect
                        size="xs"
                        variant="pill"
                        value={m.agg}
                        options={AGG_OPTIONS}
                        ariaLabel={`${displayName} 聚合方式`}
                        onChange={(agg) => updateMeasureAgg(m.key, agg)}
                      />
                    )}
                    {config.measures.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMeasure(m.key)}
                        aria-label={`移除指标 ${displayName}`}
                        className="st-icon-btn st-icon-btn-xs st-icon-btn-danger opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {!isCount && m.agg !== 'count' && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">小数位数</span>
                    <CustomSelect
                      size="xs"
                      variant="pill"
                      value={toDecimalPlacesChoice(m.decimalPlaces)}
                      options={DECIMAL_PLACES_OPTIONS}
                      ariaLabel={`${displayName} 小数位数`}
                      onChange={(val) => updateMeasureDecimalPlaces(m.key, val)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* 总计与折叠选项 */}
      <section className="space-y-2.5">
        <h3 className="st-section-label">显示与展开控制</h3>
        <div className="space-y-1">
          <label className="flex cursor-pointer items-center justify-between gap-3 px-2 py-1">
            <span className="text-sm text-slate-700">显示总计行</span>
            <input
              type="checkbox"
              className="st-checkbox"
              checked={config.showGrandTotal ?? true}
              onChange={(e) => onChangeConfig({ ...config, showGrandTotal: e.target.checked })}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between gap-3 px-2 py-1">
            <span className="text-sm text-slate-700">树形分组折叠</span>
            <input
              type="checkbox"
              className="st-checkbox"
              checked={config.collapsible ?? true}
              onChange={(e) => onChangeConfig({ ...config, collapsible: e.target.checked })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onExpandAll} className="st-btn st-btn-sm st-btn-secondary">
            全部展开
          </button>
          <button
            type="button"
            onClick={onCollapseAll}
            className="st-btn st-btn-sm st-btn-secondary"
          >
            全部收起
          </button>
        </div>

        <div className="st-alert st-alert-amber">
          <Lightbulb className="h-3.5 w-3.5 shrink-0" />
          <span>双击任意透视汇总格可打开明细下钻抽屉</span>
        </div>
      </section>
    </div>
  )
}
