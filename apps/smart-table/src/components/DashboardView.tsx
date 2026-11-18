// 统计仪表盘视图组件：展示极简 BI 风格 KPI 指标卡网格与 Chart.js 多维图表，随筛选条件实时重算；
// 运维态支持画布直接增删/调序及点击卡片（非图例区）联动右侧单卡配置抽屉，查看态严格只读浏览。

import { useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Eye,
  LayoutDashboard,
  Plus,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { computeDashboard } from '../domain/dashboard-engine'
import { buildDefaultDashboardConfig, SUMMARY_LABELS } from '../domain/workspace-helpers'
import type { DashboardConfig, SmartColumn, SmartRecord, WorkspaceView } from '../shared/schema'
import { DashboardChartBody, toAlphaColor } from './DashboardCharts'
import {
  createNextChartConfig,
  createNextKpiConfig,
  type DashboardSelectedItem,
  KPI_ICON_COMPONENTS,
  reorderDashboardItems,
} from './DrawerDashboardPanel'

export interface DashboardViewProps {
  view: WorkspaceView
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  readonly: boolean
  selectedItem?: DashboardSelectedItem | null
  onSelectItem?: (item: DashboardSelectedItem | null) => void
  onChangeConfig?: (next: DashboardConfig) => void
  onOpenConfig?: () => void
}

const CHART_AGG_LABELS: Record<string, string> = {
  sum: '求和',
  count: '计数',
  avg: '均值',
  min: '最小',
  max: '最大',
}

function CardQuickActions({
  itemLabel,
  title,
  index,
  total,
  onMove,
  onDelete,
}: {
  itemLabel: string
  title: string
  index: number
  total: number
  onMove: (toIndex: number) => void
  onDelete: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={index <= 0}
        aria-label={`上移${itemLabel} ${title}`}
        title={`上移${itemLabel}`}
        onClick={() => onMove(index - 1)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={index >= total - 1}
        aria-label={`下移${itemLabel} ${title}`}
        title={`下移${itemLabel}`}
        onClick={() => onMove(index + 1)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={`删除${itemLabel} ${title}`}
        title={`删除${itemLabel}`}
        onClick={onDelete}
        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function DashboardView({
  view,
  columns,
  records,
  readonly,
  selectedItem,
  onSelectItem,
  onChangeConfig,
  onOpenConfig,
}: DashboardViewProps) {
  const config: DashboardConfig = useMemo(
    () => view.dashboardConfig ?? buildDefaultDashboardConfig(columns),
    [view.dashboardConfig, columns],
  )

  const colMap = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])

  const result = useMemo(
    () => computeDashboard(records, columns, config),
    [records, columns, config],
  )

  const isEmptyConfig = result.kpis.length === 0 && result.charts.length === 0

  function handleAddKpi() {
    if (readonly) return
    const nextKpi = createNextKpiConfig(columns, config.kpis.length)
    onChangeConfig?.({ ...config, kpis: [...config.kpis, nextKpi] })
  }

  function handleAddChart() {
    if (readonly) return
    const nextChart = createNextChartConfig(columns)
    if (!nextChart) return
    onChangeConfig?.({ ...config, charts: [...config.charts, nextChart] })
  }

  function handleMoveKpi(fromIdx: number, toIdx: number) {
    if (readonly) return
    onChangeConfig?.({
      ...config,
      kpis: reorderDashboardItems(config.kpis, fromIdx, toIdx),
    })
  }

  function handleRemoveKpi(id: string) {
    if (readonly) return
    onChangeConfig?.({
      ...config,
      kpis: config.kpis.filter((item) => item.id !== id),
    })
    if (selectedItem?.kind === 'kpi' && selectedItem.id === id) {
      onSelectItem?.(null)
    }
  }

  function handleMoveChart(fromIdx: number, toIdx: number) {
    if (readonly) return
    onChangeConfig?.({
      ...config,
      charts: reorderDashboardItems(config.charts, fromIdx, toIdx),
    })
  }

  function handleRemoveChart(id: string) {
    if (readonly) return
    onChangeConfig?.({
      ...config,
      charts: config.charts.filter((item) => item.id !== id),
    })
    if (selectedItem?.kind === 'chart' && selectedItem.id === id) {
      onSelectItem?.(null)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-slate-50/80" data-testid="dashboard-view">
      {/* 仪表盘状态条 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white px-4 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2 text-slate-600">
          <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>
            {result.kpis.length} 个指标卡 · {result.charts.length} 个统计图表 · 实时联动当前{' '}
            <strong className="font-semibold text-slate-800">{records.length}</strong> 条筛选记录
          </span>
          {readonly && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              <Eye className="h-3 w-3" />
              <span>只读查看（支持悬停图表查看数值）</span>
            </span>
          )}
        </div>

        {!readonly && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleAddKpi}
              className="inline-flex h-6 items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            >
              <Plus className="h-3 w-3" />
              <span>添加指标卡</span>
            </button>
            <button
              type="button"
              disabled={columns.length === 0}
              onClick={handleAddChart}
              className="inline-flex h-6 items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              <span>添加图表</span>
            </button>
            {onOpenConfig && (
              <button
                type="button"
                onClick={onOpenConfig}
                className="inline-flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>配置仪表盘</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 仪表盘网格画布 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {isEmptyConfig ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xs">
              <BarChart3 className="mx-auto mb-2.5 h-7 w-7 text-slate-400" />
              <div className="text-sm font-semibold text-slate-900">尚未配置指标卡或图表</div>
              <p className="mt-1 text-xs text-slate-500">
                {readonly
                  ? '该仪表盘视图暂未配置可视化组件。'
                  : '点击上方「添加指标卡 / 添加图表」或打开「配置仪表盘」即可快速搭建可视化视图。'}
              </p>
              {!readonly && onOpenConfig && (
                <button
                  type="button"
                  onClick={onOpenConfig}
                  className="mt-4 h-8 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  立即配置仪表盘
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-5">
            {/* KPI 指标卡网格 */}
            {result.kpis.length > 0 && (
              <section aria-label="KPI 指标卡">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {result.kpis.map((kpi, idx) => {
                    const accent = kpi.accentColor ?? '#2563eb'
                    const Icon = KPI_ICON_COMPONENTS[kpi.icon]
                    const isSelected =
                      !readonly && selectedItem?.kind === 'kpi' && selectedItem.id === kpi.id
                    const fieldTitle =
                      kpi.field === '__count__' || !kpi.field
                        ? '全部记录'
                        : (colMap.get(kpi.field)?.title ?? kpi.field)
                    return (
                      <div
                        key={kpi.id}
                        data-kpi-id={kpi.id}
                        data-selected={isSelected ? 'true' : undefined}
                        onClick={
                          !readonly ? () => onSelectItem?.({ kind: 'kpi', id: kpi.id }) : undefined
                        }
                        className={`rounded-xl border bg-white p-4 shadow-2xs transition-all duration-150 ${
                          isSelected
                            ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
                            : 'border-slate-200/90 hover:border-slate-300 hover:shadow-sm'
                        } ${!readonly ? 'cursor-pointer' : ''}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span
                              data-kpi-icon={kpi.icon}
                              aria-hidden="true"
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                              style={{
                                backgroundColor: toAlphaColor(accent, 0.12),
                                color: accent,
                              }}
                            >
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-xs font-medium text-slate-600">
                                {kpi.title}
                              </div>
                              <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                {SUMMARY_LABELS[kpi.agg]}
                              </span>
                            </div>
                          </div>

                          {!readonly && (
                            <CardQuickActions
                              itemLabel="指标卡"
                              title={kpi.title}
                              index={idx}
                              total={result.kpis.length}
                              onMove={(toIdx) => handleMoveKpi(idx, toIdx)}
                              onDelete={() => handleRemoveKpi(kpi.id)}
                            />
                          )}
                        </div>

                        <div className="mt-3 truncate text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                          {kpi.formattedValue}
                        </div>

                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                          <span className="truncate">{fieldTitle}</span>
                          <span className="shrink-0">{kpi.recordCount} 条样本</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* 图表网格 */}
            {result.charts.length > 0 && (
              <section aria-label="统计图表">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {result.charts.map((chart, idx) => {
                    const dimensionCol = colMap.get(chart.dimensionField)
                    const measureCol = colMap.get(chart.measureField)
                    const seriesCol = chart.seriesField ? colMap.get(chart.seriesField) : undefined
                    const dimTitle = dimensionCol?.title ?? chart.dimensionField
                    const measureTitle =
                      chart.agg === 'count' ? '记录数' : (measureCol?.title ?? chart.measureField)
                    const isSelected =
                      !readonly && selectedItem?.kind === 'chart' && selectedItem.id === chart.id

                    return (
                      <article
                        key={chart.id}
                        data-chart-id={chart.id}
                        data-selected={isSelected ? 'true' : undefined}
                        onClick={
                          !readonly
                            ? () => onSelectItem?.({ kind: 'chart', id: chart.id })
                            : undefined
                        }
                        className={`flex flex-col rounded-xl border bg-white p-4 shadow-2xs transition-all duration-150 ${
                          isSelected
                            ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-sm'
                            : 'border-slate-200/90 hover:border-slate-300 hover:shadow-sm'
                        } ${!readonly ? 'cursor-pointer' : ''} ${
                          chart.span === 2 ? 'lg:col-span-2' : ''
                        }`}
                      >
                        <header className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-slate-900">
                              {chart.title}
                            </h3>
                            <p className="mt-0.5 truncate text-[11px] text-slate-500">
                              维度：{dimTitle}
                              {seriesCol ? ` × ${seriesCol.title}` : ''} · 度量：{measureTitle}（
                              {CHART_AGG_LABELS[chart.agg] ?? chart.agg}）
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                              {chart.data.length} 组
                            </span>
                            {!readonly && (
                              <CardQuickActions
                                itemLabel="图表"
                                title={chart.title}
                                index={idx}
                                total={result.charts.length}
                                onMove={(toIdx) => handleMoveChart(idx, toIdx)}
                                onDelete={() => handleRemoveChart(chart.id)}
                              />
                            )}
                          </div>
                        </header>

                        <DashboardChartBody
                          chart={chart}
                          dimensionCol={dimensionCol}
                          measureCol={measureCol}
                          seriesCol={seriesCol}
                        />
                      </article>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
