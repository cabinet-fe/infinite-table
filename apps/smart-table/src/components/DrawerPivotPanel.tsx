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
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">行维度</h3>
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
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
              >
                <span>{label}</span>
                <button
                  type="button"
                  disabled={rowDimLocked}
                  title={rowDimLocked ? '至少保留 1 个行维度' : `移除行维度 ${label}`}
                  aria-label={`移除行维度 ${label}`}
                  onClick={() => removeDimension('row', key)}
                  className="rounded-full p-0.5 hover:bg-blue-100 disabled:opacity-40"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      </section>

      {/* 列维度 */}
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">列维度</h3>
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
          <div className="text-xs text-slate-400">未设置列维度（按行维度平铺汇总）</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {config.columnDimensions.map((key) => {
              const label = colTitleOf(columns, key)
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700"
                >
                  <span>{label}</span>
                  <button
                    type="button"
                    aria-label={`移除列维度 ${label}`}
                    onClick={() => removeDimension('col', key)}
                    className="rounded-full p-0.5 hover:bg-violet-100"
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
      <section className="space-y-2 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">汇总指标</h3>
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
              <div
                key={m.key}
                className="space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">
                    {displayName}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isCount ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] text-slate-600"
                        title="记录数仅支持计数"
                      >
                        <Lock className="h-2.5 w-2.5" />
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
                        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {!isCount && m.agg !== 'count' && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">小数位数</span>
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
      <section className="space-y-3 border-t border-slate-100 pt-4">
        <h3 className="text-xs font-semibold text-slate-800">显示与展开控制</h3>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
            <span>显示总计行</span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
              checked={config.showGrandTotal ?? true}
              onChange={(e) => onChangeConfig({ ...config, showGrandTotal: e.target.checked })}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
            <span>树形分组折叠</span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
              checked={config.collapsible ?? true}
              onChange={(e) => onChangeConfig({ ...config, collapsible: e.target.checked })}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onExpandAll}
            className="h-7 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            全部展开
          </button>
          <button
            type="button"
            onClick={onCollapseAll}
            className="h-7 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            全部收起
          </button>
        </div>

        <div className="flex items-center gap-1.5 rounded-lg bg-amber-50/70 px-3 py-2 text-[11px] text-amber-800">
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>提示：双击任意透视汇总格可打开明细下钻抽屉</span>
        </div>
      </section>
    </div>
  )
}
