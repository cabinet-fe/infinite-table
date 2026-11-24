// 统计仪表盘视图组件：展示极简 BI 风格 KPI 指标卡网格与 Chart.js 多维图表，随筛选条件实时重算；
// 运维态支持画布直接增删/调序及点击卡片（非图例区）联动右侧单卡配置抽屉，查看态严格只读浏览。

import { memo, useCallback, useMemo, useRef } from 'react'
import { ArrowDown, ArrowUp, BarChart3, Eye, LayoutDashboard, Plus, Trash2 } from 'lucide-react'
import { computeDashboardChart, computeDashboardKpi } from '../domain/dashboard-engine'
import { buildDefaultDashboardConfig } from '../domain/workspace-helpers'
import type {
  DashboardChartConfig,
  DashboardConfig,
  DashboardKpiConfig,
  SmartColumn,
  SmartRecord,
  WorkspaceView,
} from '../shared/schema'
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
  className = '',
}: {
  itemLabel: string
  title: string
  index: number
  total: number
  onMove: (toIndex: number) => void
  onDelete: () => void
  className?: string
}) {
  return (
    <div
      className={`flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={index <= 0}
        aria-label={`上移${itemLabel} ${title}`}
        title={`上移${itemLabel}`}
        onClick={() => onMove(index - 1)}
        className="st-icon-btn st-icon-btn-xs"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={index >= total - 1}
        aria-label={`下移${itemLabel} ${title}`}
        title={`下移${itemLabel}`}
        onClick={() => onMove(index + 1)}
        className="st-icon-btn st-icon-btn-xs"
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={`删除${itemLabel} ${title}`}
        title={`删除${itemLabel}`}
        onClick={onDelete}
        className="st-icon-btn st-icon-btn-xs st-icon-btn-danger"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const DashboardKpiCard = memo(function DashboardKpiCard({
  kpiConfig,
  columns,
  records,
  colMap,
  readonly,
  isSelected,
  index,
  total,
  onSelect,
  onMove,
  onRemove,
}: {
  kpiConfig: DashboardKpiConfig
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  colMap: ReadonlyMap<string, SmartColumn>
  readonly: boolean
  isSelected: boolean
  index: number
  total: number
  onSelect: (id: string) => void
  onMove: (fromIdx: number, toIdx: number) => void
  onRemove: (id: string) => void
}) {
  const kpi = useMemo(
    () => computeDashboardKpi(records, columns, kpiConfig),
    [records, columns, kpiConfig],
  )
  const accent = kpi.accentColor ?? '#3370ff'
  const Icon = KPI_ICON_COMPONENTS[kpi.icon]
  const fieldTitle =
    kpi.field === '__count__' || !kpi.field
      ? '全部记录'
      : (colMap.get(kpi.field)?.title ?? kpi.field)
  const kpiMeta = `${fieldTitle} · ${kpi.recordCount} 条样本`

  return (
    <div
      data-kpi-id={kpi.id}
      data-selected={isSelected ? 'true' : undefined}
      onClick={!readonly ? () => onSelect(kpi.id) : undefined}
      className={`st-card group relative @container p-5 transition-shadow duration-150 ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'hover:shadow-card'
      } ${!readonly ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <span
          data-kpi-icon={kpi.icon}
          aria-hidden="true"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          style={{
            backgroundColor: toAlphaColor(accent, 0.1),
            color: accent,
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="truncate text-sm text-slate-600" title={kpi.title}>
          {kpi.title}
        </div>
      </div>

      {!readonly && (
        <CardQuickActions
          className="absolute right-3 bottom-3"
          itemLabel="指标卡"
          title={kpi.title}
          index={index}
          total={total}
          onMove={(toIdx) => onMove(index, toIdx)}
          onDelete={() => onRemove(kpi.id)}
        />
      )}

      <div
        className="mt-3 truncate text-2xl leading-8 font-semibold tracking-tight text-slate-900 tabular-nums @min-[220px]:text-3xl @min-[220px]:leading-9"
        title={kpi.formattedValue}
      >
        {kpi.formattedValue}
      </div>

      <div className="mt-1.5 truncate pr-20 text-xs text-slate-400" title={kpiMeta}>
        {kpiMeta}
      </div>
    </div>
  )
})

const DashboardChartCard = memo(function DashboardChartCard({
  chartConfig,
  columns,
  records,
  colMap,
  readonly,
  isSelected,
  index,
  total,
  onSelect,
  onMove,
  onRemove,
}: {
  chartConfig: DashboardChartConfig
  columns: readonly SmartColumn[]
  records: readonly SmartRecord[]
  colMap: ReadonlyMap<string, SmartColumn>
  readonly: boolean
  isSelected: boolean
  index: number
  total: number
  onSelect: (id: string) => void
  onMove: (fromIdx: number, toIdx: number) => void
  onRemove: (id: string) => void
}) {
  const chart = useMemo(
    () => computeDashboardChart(records, columns, chartConfig),
    [records, columns, chartConfig],
  )
  const dimensionCol = colMap.get(chart.dimensionField)
  const measureCol = colMap.get(chart.measureField)
  const seriesCol = chart.seriesField ? colMap.get(chart.seriesField) : undefined
  const dimTitle = dimensionCol?.title ?? chart.dimensionField
  const measureTitle = chart.agg === 'count' ? '记录数' : (measureCol?.title ?? chart.measureField)

  return (
    <article
      data-chart-id={chart.id}
      data-selected={isSelected ? 'true' : undefined}
      onClick={!readonly ? () => onSelect(chart.id) : undefined}
      className={`st-card group relative flex flex-col p-5 transition-shadow duration-150 ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'hover:shadow-card'
      } ${!readonly ? 'cursor-pointer' : ''} ${chart.span === 2 ? 'lg:col-span-2' : ''}`}
    >
      <header className="mb-3">
        <h3 className="truncate pr-16 text-sm font-semibold text-slate-900">{chart.title}</h3>
        <p className="mt-0.5 truncate pr-16 text-xs text-slate-400">
          维度：{dimTitle}
          {seriesCol ? ` × ${seriesCol.title}` : ''} · 度量：{measureTitle}（
          {CHART_AGG_LABELS[chart.agg] ?? chart.agg}）
        </p>
      </header>

      <div className="absolute top-4 right-4 flex items-center gap-1.5">
        {!readonly && (
          <CardQuickActions
            itemLabel="图表"
            title={chart.title}
            index={index}
            total={total}
            onMove={(toIdx) => onMove(index, toIdx)}
            onDelete={() => onRemove(chart.id)}
          />
        )}
        <span className="text-xs text-slate-400 tabular-nums">{chart.data.length} 组</span>
      </div>

      <DashboardChartBody
        chart={chart}
        dimensionCol={dimensionCol}
        measureCol={measureCol}
        seriesCol={seriesCol}
      />
    </article>
  )
})

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

  const latestRef = useRef({
    config,
    readonly,
    selectedItem,
    onChangeConfig,
    onSelectItem,
  })
  latestRef.current = {
    config,
    readonly,
    selectedItem,
    onChangeConfig,
    onSelectItem,
  }

  const isEmptyConfig = config.kpis.length === 0 && config.charts.length === 0

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

  const handleSelectKpi = useCallback((id: string) => {
    const cur = latestRef.current
    if (cur.readonly) return
    cur.onSelectItem?.({ kind: 'kpi', id })
  }, [])

  const handleMoveKpi = useCallback((fromIdx: number, toIdx: number) => {
    const cur = latestRef.current
    if (cur.readonly) return
    cur.onChangeConfig?.({
      ...cur.config,
      kpis: reorderDashboardItems(cur.config.kpis, fromIdx, toIdx),
    })
  }, [])

  const handleRemoveKpi = useCallback((id: string) => {
    const cur = latestRef.current
    if (cur.readonly) return
    cur.onChangeConfig?.({
      ...cur.config,
      kpis: cur.config.kpis.filter((item) => item.id !== id),
    })
    if (cur.selectedItem?.kind === 'kpi' && cur.selectedItem.id === id) {
      cur.onSelectItem?.(null)
    }
  }, [])

  const handleSelectChart = useCallback((id: string) => {
    const cur = latestRef.current
    if (cur.readonly) return
    cur.onSelectItem?.({ kind: 'chart', id })
  }, [])

  const handleMoveChart = useCallback((fromIdx: number, toIdx: number) => {
    const cur = latestRef.current
    if (cur.readonly) return
    cur.onChangeConfig?.({
      ...cur.config,
      charts: reorderDashboardItems(cur.config.charts, fromIdx, toIdx),
    })
  }, [])

  const handleRemoveChart = useCallback((id: string) => {
    const cur = latestRef.current
    if (cur.readonly) return
    cur.onChangeConfig?.({
      ...cur.config,
      charts: cur.config.charts.filter((item) => item.id !== id),
    })
    if (cur.selectedItem?.kind === 'chart' && cur.selectedItem.id === id) {
      cur.onSelectItem?.(null)
    }
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-st-bg" data-testid="dashboard-view">
      {/* 信息行：规模与画布级操作。「配置仪表盘」与顶部工具栏的视图配置重复，统一走工具栏 */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 px-5">
        <div className="flex min-w-0 items-center gap-2 text-xs text-slate-500">
          <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">
            {config.kpis.length} 个指标卡 · {config.charts.length} 个统计图表 · 当前{' '}
            {records.length} 条记录
          </span>
          {readonly && (
            <span className="st-badge st-badge-gray shrink-0">
              <Eye className="h-3 w-3" />
              <span>只读查看</span>
            </span>
          )}
        </div>

        {!readonly && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={handleAddKpi} className="st-tool">
              <Plus className="h-4 w-4" />
              <span>添加指标卡</span>
            </button>
            <button
              type="button"
              disabled={columns.length === 0}
              onClick={handleAddChart}
              className="st-tool"
            >
              <Plus className="h-4 w-4" />
              <span>添加图表</span>
            </button>
          </div>
        )}
      </div>

      {/* 仪表盘网格画布 */}
      <div className="st-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {isEmptyConfig ? (
          <div className="flex h-full items-center justify-center">
            <div className="st-empty max-w-sm py-5">
              <BarChart3 className="mx-auto mb-2 h-6 w-6 text-slate-400" />
              <div className="text-sm font-medium text-slate-900">尚未配置指标卡或图表</div>
              <p className="mt-1 text-xs text-slate-500">
                {readonly ? '该仪表盘视图暂未配置可视化组件。' : '通过上方按钮添加指标卡与图表。'}
              </p>
              {!readonly && onOpenConfig && (
                <button
                  type="button"
                  onClick={onOpenConfig}
                  className="st-btn st-btn-primary st-btn-sm mt-4"
                >
                  立即配置仪表盘
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-5">
            {/* KPI 指标卡网格 */}
            {config.kpis.length > 0 && (
              <section aria-label="KPI 指标卡">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                  {config.kpis.map((kpiConfig, idx) => (
                    <DashboardKpiCard
                      key={kpiConfig.id}
                      kpiConfig={kpiConfig}
                      columns={columns}
                      records={records}
                      colMap={colMap}
                      readonly={readonly}
                      isSelected={
                        !readonly &&
                        selectedItem?.kind === 'kpi' &&
                        selectedItem.id === kpiConfig.id
                      }
                      index={idx}
                      total={config.kpis.length}
                      onSelect={handleSelectKpi}
                      onMove={handleMoveKpi}
                      onRemove={handleRemoveKpi}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 图表网格 */}
            {config.charts.length > 0 && (
              <section aria-label="统计图表">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
                  {config.charts.map((chartConfig, idx) => (
                    <DashboardChartCard
                      key={chartConfig.id}
                      chartConfig={chartConfig}
                      columns={columns}
                      records={records}
                      colMap={colMap}
                      readonly={readonly}
                      isSelected={
                        !readonly &&
                        selectedItem?.kind === 'chart' &&
                        selectedItem.id === chartConfig.id
                      }
                      index={idx}
                      total={config.charts.length}
                      onSelect={handleSelectChart}
                      onMove={handleMoveChart}
                      onRemove={handleRemoveChart}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
