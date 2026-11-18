// 统计仪表盘视图组件：展示 KPI 指标卡网格与多维交互图表，随当前视图筛选/临时筛选实时重算；
// 运维态支持打开右侧配置抽屉增删与编排指标卡/图表，用户查看态严格只读浏览。

import { useMemo } from 'react'
import { BarChart3, Eye, LayoutDashboard, SlidersHorizontal } from 'lucide-react'
import { computeDashboard } from '../domain/dashboard-engine'
import { buildDefaultDashboardConfig, SUMMARY_LABELS } from '../domain/workspace-helpers'
import type { DashboardConfig, SmartColumn, SmartRecord, WorkspaceView } from '../shared/schema'
import { DashboardChartBody } from './DashboardCharts'

export interface DashboardViewProps {
  view: WorkspaceView
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  readonly: boolean
  onOpenConfig?: () => void
}

const CHART_AGG_LABELS: Record<string, string> = {
  sum: '求和',
  count: '计数',
  avg: '均值',
  min: '最小',
  max: '最大',
}

export function DashboardView({
  view,
  columns,
  records,
  readonly,
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

        {!readonly && onOpenConfig && (
          <button
            type="button"
            onClick={onOpenConfig}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span>配置仪表盘</span>
          </button>
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
                  : '打开右侧「视图配置 → 仪表盘配置」即可添加 KPI 指标卡与柱状图/折线图/饼图。'}
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
                  {result.kpis.map((kpi) => {
                    const accent = kpi.accentColor ?? '#2563eb'
                    const fieldTitle =
                      kpi.field === '__count__' || !kpi.field
                        ? '全部记录'
                        : (colMap.get(kpi.field)?.title ?? kpi.field)
                    return (
                      <div
                        key={kpi.id}
                        data-kpi-id={kpi.id}
                        className="relative overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs"
                      >
                        <div
                          className="absolute inset-x-0 top-0 h-1"
                          style={{ backgroundColor: accent }}
                          aria-hidden="true"
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-slate-500">
                            {kpi.title}
                          </span>
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                            {SUMMARY_LABELS[kpi.agg]}
                          </span>
                        </div>
                        <div className="mt-2 truncate text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
                          {kpi.formattedValue}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
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
                  {result.charts.map((chart) => {
                    const dimensionCol = colMap.get(chart.dimensionField)
                    const measureCol = colMap.get(chart.measureField)
                    const dimTitle = dimensionCol?.title ?? chart.dimensionField
                    const measureTitle =
                      chart.agg === 'count' ? '记录数' : (measureCol?.title ?? chart.measureField)

                    return (
                      <article
                        key={chart.id}
                        data-chart-id={chart.id}
                        className={`flex flex-col rounded-xl border border-slate-200/90 bg-white p-4 shadow-2xs ${
                          chart.span === 2 ? 'lg:col-span-2' : ''
                        }`}
                      >
                        <header className="mb-3 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-slate-900">
                              {chart.title}
                            </h3>
                            <p className="mt-0.5 truncate text-[11px] text-slate-500">
                              维度：{dimTitle} · 度量：{measureTitle}（
                              {CHART_AGG_LABELS[chart.agg] ?? chart.agg}）
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            {chart.data.length} 组
                          </span>
                        </header>

                        <DashboardChartBody
                          chart={chart}
                          dimensionCol={dimensionCol}
                          measureCol={measureCol}
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
