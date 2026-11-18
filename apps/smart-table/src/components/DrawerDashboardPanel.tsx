// 视图配置抽屉 · 仪表盘配置分栏：管理 KPI 指标卡与统计图表（柱状图/折线图/饼图）的增删、聚合维度/度量配置。

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { SUMMARY_LABELS } from '../domain/workspace-helpers'
import type {
  DashboardChartConfig,
  DashboardChartType,
  DashboardConfig,
  DashboardKpiAgg,
  DashboardKpiConfig,
  SmartColumn,
  SmartPivotAgg,
} from '../shared/schema'
import { CustomSelect, type CustomSelectOption } from './CustomSelect'

export interface DrawerDashboardPanelProps {
  columns: readonly SmartColumn[]
  config: DashboardConfig
  onChangeConfig: (next: DashboardConfig) => void
}

const KPI_ACCENTS = ['#2563eb', '#0f766e', '#15803d', '#7c3aed', '#d97706', '#dc2626']

const KPI_AGG_OPTIONS: CustomSelectOption<DashboardKpiAgg>[] = [
  { value: 'count', label: SUMMARY_LABELS.count },
  { value: 'sum', label: SUMMARY_LABELS.sum },
  { value: 'avg', label: SUMMARY_LABELS.avg },
  { value: 'max', label: SUMMARY_LABELS.max },
  { value: 'min', label: SUMMARY_LABELS.min },
  { value: 'filled_rate', label: SUMMARY_LABELS.filled_rate },
]

const CHART_TYPE_OPTIONS: CustomSelectOption<DashboardChartType>[] = [
  { value: 'bar', label: '柱状图' },
  { value: 'line', label: '折线图' },
  { value: 'pie', label: '饼图 / 环形图' },
]

const CHART_AGG_OPTIONS: CustomSelectOption<SmartPivotAgg>[] = [
  { value: 'count', label: '计数' },
  { value: 'sum', label: '求和' },
  { value: 'avg', label: '均值' },
  { value: 'max', label: '最大' },
  { value: 'min', label: '最小' },
]

const CHART_SORT_OPTIONS: CustomSelectOption<'value_desc' | 'value_asc' | 'label_asc'>[] = [
  { value: 'value_desc', label: '数值降序' },
  { value: 'value_asc', label: '数值升序' },
  { value: 'label_asc', label: '维度升序' },
]

function isNumericColumn(col: SmartColumn): boolean {
  return (
    col.type === 'number' ||
    col.type === 'formula' ||
    col.type === 'progress' ||
    (col.type === 'lookup' &&
      (col.lookupConfig?.mode === 'rollup' || col.numberFormat !== undefined))
  )
}

function DraftTextInput({
  value,
  ariaLabel,
  placeholder,
  onCommit,
}: {
  value: string
  ariaLabel: string
  placeholder?: string
  onCommit: (nextValue: string) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onCommit(trimmed)
    } else if (!trimmed) {
      setDraft(value)
    }
  }

  return (
    <input
      type="text"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
    />
  )
}

export function DrawerDashboardPanel({
  columns,
  config,
  onChangeConfig,
}: DrawerDashboardPanelProps) {
  const numericCols = columns.filter(isNumericColumn)
  const kpiFieldOptions: CustomSelectOption<string>[] = [
    { value: '__count__', label: '全部记录数', hint: '通用' },
    ...columns.map((c) => ({ value: c.key, label: c.title })),
  ]
  const dimensionOptions: CustomSelectOption<string>[] = columns.map((c) => ({
    value: c.key,
    label: c.title,
  }))
  const measureOptions: CustomSelectOption<string>[] = (
    numericCols.length > 0 ? numericCols : columns
  ).map((c) => ({
    value: c.key,
    label: c.title,
  }))

  function addKpi() {
    const primaryNum = numericCols[0]
    const nextKpi: DashboardKpiConfig = primaryNum
      ? {
          id: `kpi_${Date.now().toString(36)}`,
          title: `${primaryNum.title}合计`,
          field: primaryNum.key,
          agg: 'sum',
          numberFormat: primaryNum.numberFormat,
          accentColor: KPI_ACCENTS[config.kpis.length % KPI_ACCENTS.length],
        }
      : {
          id: `kpi_${Date.now().toString(36)}`,
          title: '记录总数',
          field: '__count__',
          agg: 'count',
          accentColor: KPI_ACCENTS[config.kpis.length % KPI_ACCENTS.length],
        }
    onChangeConfig({ ...config, kpis: [...config.kpis, nextKpi] })
  }

  function updateKpi(id: string, patch: Partial<DashboardKpiConfig>) {
    onChangeConfig({
      ...config,
      kpis: config.kpis.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })
  }

  function removeKpi(id: string) {
    onChangeConfig({
      ...config,
      kpis: config.kpis.filter((item) => item.id !== id),
    })
  }

  function addChart() {
    const dimCol =
      columns.find((c) => c.type === 'select') ??
      columns.find((c) => c.type === 'text' || c.type === 'lookup') ??
      columns[0]
    const primaryNum = numericCols[0]
    if (!dimCol) return
    const nextChart: DashboardChartConfig = {
      id: `chart_${Date.now().toString(36)}`,
      title: primaryNum ? `按${dimCol.title}统计${primaryNum.title}` : `按${dimCol.title}分布`,
      chartType: 'bar',
      dimensionField: dimCol.key,
      measureField: primaryNum?.key ?? '',
      agg: primaryNum ? 'sum' : 'count',
      sortBy: 'value_desc',
    }
    onChangeConfig({ ...config, charts: [...config.charts, nextChart] })
  }

  function updateChart(id: string, patch: Partial<DashboardChartConfig>) {
    onChangeConfig({
      ...config,
      charts: config.charts.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })
  }

  function removeChart(id: string) {
    onChangeConfig({
      ...config,
      charts: config.charts.filter((item) => item.id !== id),
    })
  }

  return (
    <div className="space-y-5">
      {/* KPI 指标卡管理 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">
            KPI 指标卡（{config.kpis.length}）
          </h3>
          <button
            type="button"
            onClick={addKpi}
            className="inline-flex h-6 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
          >
            <Plus className="h-3 w-3" />
            <span>添加指标卡</span>
          </button>
        </div>

        {config.kpis.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
            暂无 KPI 指标卡
          </div>
        ) : (
          <div className="space-y-2.5">
            {config.kpis.map((kpi) => (
              <div
                key={kpi.id}
                className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <DraftTextInput
                    value={kpi.title}
                    ariaLabel={`指标卡标题 ${kpi.title}`}
                    placeholder="指标标题"
                    onCommit={(title) => updateKpi(kpi.id, { title })}
                  />
                  <button
                    type="button"
                    aria-label={`删除指标卡 ${kpi.title}`}
                    onClick={() => removeKpi(kpi.id)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <CustomSelect
                    size="xs"
                    className="w-full"
                    value={kpi.field || '__count__'}
                    ariaLabel={`${kpi.title} 指标字段`}
                    options={kpiFieldOptions}
                    onChange={(field) => {
                      const col = columns.find((c) => c.key === field)
                      updateKpi(kpi.id, {
                        field,
                        ...(field === '__count__' ? { agg: 'count' } : {}),
                        numberFormat: col?.numberFormat,
                      })
                    }}
                  />
                  <CustomSelect
                    size="xs"
                    className="w-full"
                    value={kpi.agg}
                    ariaLabel={`${kpi.title} 聚合方式`}
                    options={
                      kpi.field === '__count__'
                        ? [{ value: 'count', label: '已填数' }]
                        : KPI_AGG_OPTIONS
                    }
                    onChange={(agg) => updateKpi(kpi.id, { agg })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">主题色</span>
                  <div className="flex items-center gap-1">
                    {KPI_ACCENTS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`指标色 ${color}`}
                        onClick={() => updateKpi(kpi.id, { accentColor: color })}
                        className={`h-4 w-4 rounded-full border transition-transform ${
                          kpi.accentColor === color
                            ? 'scale-110 border-slate-900 ring-1 ring-slate-400'
                            : 'border-white'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 图表编排管理 */}
      <section className="space-y-2.5 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">
            统计图表（{config.charts.length}）
          </h3>
          <button
            type="button"
            disabled={columns.length === 0}
            onClick={addChart}
            className="inline-flex h-6 items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            <span>添加图表</span>
          </button>
        </div>

        {config.charts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
            暂无统计图表
          </div>
        ) : (
          <div className="space-y-2.5">
            {config.charts.map((chart) => (
              <div
                key={chart.id}
                className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5"
              >
                <div className="flex items-center gap-1.5">
                  <DraftTextInput
                    value={chart.title}
                    ariaLabel={`图表标题 ${chart.title}`}
                    placeholder="图表标题"
                    onCommit={(title) => updateChart(chart.id, { title })}
                  />
                  <button
                    type="button"
                    aria-label={`删除图表 ${chart.title}`}
                    onClick={() => removeChart(chart.id)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <CustomSelect
                    size="xs"
                    className="w-full"
                    value={chart.chartType}
                    ariaLabel={`${chart.title} 图表类型`}
                    options={CHART_TYPE_OPTIONS}
                    onChange={(chartType) =>
                      updateChart(chart.id, {
                        chartType,
                        ...(chartType === 'pie' && chart.donut === undefined
                          ? { donut: true }
                          : {}),
                      })
                    }
                  />
                  <CustomSelect
                    size="xs"
                    className="w-full"
                    value={chart.dimensionField}
                    ariaLabel={`${chart.title} 分组维度`}
                    options={dimensionOptions}
                    onChange={(dimensionField) => updateChart(chart.id, { dimensionField })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <CustomSelect
                    size="xs"
                    className="w-full"
                    value={chart.agg}
                    ariaLabel={`${chart.title} 聚合方式`}
                    options={CHART_AGG_OPTIONS}
                    onChange={(agg) =>
                      updateChart(chart.id, {
                        agg,
                        measureField:
                          agg === 'count'
                            ? ''
                            : chart.measureField || measureOptions[0]?.value || '',
                      })
                    }
                  />
                  {chart.agg === 'count' ? (
                    <div className="flex h-6 items-center rounded-md border border-slate-200 bg-slate-100 px-2 text-[11px] text-slate-500">
                      度量：记录数
                    </div>
                  ) : (
                    <CustomSelect
                      size="xs"
                      className="w-full"
                      value={chart.measureField || measureOptions[0]?.value || ''}
                      ariaLabel={`${chart.title} 度量字段`}
                      options={measureOptions}
                      onChange={(measureField) => updateChart(chart.id, { measureField })}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <CustomSelect
                    size="xs"
                    className="w-28"
                    value={
                      chart.sortBy ?? (chart.chartType === 'line' ? 'label_asc' : 'value_desc')
                    }
                    ariaLabel={`${chart.title} 排序`}
                    options={CHART_SORT_OPTIONS}
                    onChange={(sortBy) => updateChart(chart.id, { sortBy })}
                  />

                  <div className="flex items-center gap-2 text-[11px] text-slate-600">
                    {chart.chartType === 'pie' && (
                      <label className="inline-flex cursor-pointer items-center gap-1">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                          checked={Boolean(chart.donut)}
                          onChange={(e) => updateChart(chart.id, { donut: e.target.checked })}
                        />
                        <span>环形</span>
                      </label>
                    )}
                    <label className="inline-flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                        checked={chart.span === 2}
                        onChange={(e) => updateChart(chart.id, { span: e.target.checked ? 2 : 1 })}
                      />
                      <span>通栏</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
