// 仪表盘 Chart.js 图表组件集：按需注册六类图型，支持单/多系列（并列/堆叠）渲染与图例点击隔离。

import { useEffect, useRef } from 'react'
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
  type ChartType,
  type Plugin,
  type TooltipItem,
} from 'chart.js'
import { getRelativePosition } from 'chart.js/helpers'
import type { DashboardChartResult } from '../domain/dashboard-engine'
import { formatSummaryValue } from '../domain/query-engine'
import type { DashboardChartType, SmartColumn } from '../shared/schema'

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  PieController,
  DoughnutController,
  ArcElement,
  RadarController,
  RadialLinearScale,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
)

export type SupportedChartJsType = 'bar' | 'line' | 'pie' | 'doughnut' | 'radar'

export type DashboardChartConfigOutput = ChartConfiguration<SupportedChartJsType, number[], string>

const CHART_PALETTE = [
  '#2563eb',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#e11d48',
  '#0284c7',
  '#059669',
  '#4f46e5',
] as const

const CHART_ARIA_LABELS: Record<Exclude<DashboardChartType, 'pie'>, string> = {
  bar: '柱状图',
  horizontalBar: '横向条形图',
  line: '折线图',
  area: '面积图',
  radar: '雷达图',
}

interface LegendHitBox {
  left: number
  top: number
  width: number
  height: number
}

interface ChartLegendWithHitBoxes {
  left: number
  right: number
  top: number
  bottom: number
  options?: { display?: boolean }
  legendHitBoxes?: readonly LegendHitBox[]
}

function resolveChartAriaLabel(chart: DashboardChartResult): string {
  if (chart.chartType === 'pie') {
    return chart.donut ? '环形图' : '饼图'
  }
  return CHART_ARIA_LABELS[chart.chartType]
}

function toAlphaColor(color: string, alpha: number): string {
  const hex = color.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const r = Number.parseInt(hex.slice(1, 3), 16)
    const g = Number.parseInt(hex.slice(3, 5), 16)
    const b = Number.parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const r = Number.parseInt(hex[1]! + hex[1]!, 16)
    const g = Number.parseInt(hex[2]! + hex[2]!, 16)
    const b = Number.parseInt(hex[3]! + hex[3]!, 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  return color
}

function resolveSeriesColor(
  label: string,
  index: number,
  explicitColor?: string,
  col?: SmartColumn,
): string {
  const opt = col?.options?.find((o) => o.label === label)
  if (opt?.textColor) return opt.textColor
  if (explicitColor) return explicitColor
  return CHART_PALETTE[index % CHART_PALETTE.length]!
}

function formatChartMetric(
  value: number,
  agg: DashboardChartResult['agg'],
  measureCol?: SmartColumn,
): string {
  if (agg === 'count') {
    return `${Math.round(value).toLocaleString('zh-CN')} 条`
  }
  return formatSummaryValue(value, 'sum', measureCol?.numberFormat)
}

function formatAxisTick(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  if (Number.isInteger(value)) return value.toLocaleString('zh-CN')
  return value.toFixed(1)
}

/** 判断点击事件是否命中 Chart.js 图例交互区域（hitBox） */
export function isLegendClick<
  TType extends ChartType = SupportedChartJsType,
  TData = number[],
  TLabel = string,
>(
  chart: Chart<TType, TData, TLabel> | null | undefined,
  event: MouseEvent | React.MouseEvent,
): boolean {
  const legend = chart?.legend as unknown as ChartLegendWithHitBoxes | undefined
  if (!chart || !legend || legend.options?.display === false) return false
  if (chart.width <= 0 || chart.height <= 0) return false

  const nativeEvent = 'nativeEvent' in event ? event.nativeEvent : event
  const pos = getRelativePosition(nativeEvent, chart as unknown as Chart)
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return false

  const inLegendBox =
    pos.x >= legend.left && pos.x <= legend.right && pos.y >= legend.top && pos.y <= legend.bottom
  if (!inLegendBox) return false

  const hitBoxes = legend.legendHitBoxes
  if (!hitBoxes || hitBoxes.length === 0) return false

  return hitBoxes.some(
    (box) =>
      pos.x >= box.left &&
      pos.x <= box.left + box.width &&
      pos.y >= box.top &&
      pos.y <= box.top + box.height,
  )
}

function createDonutCenterPlugin(totalText: string): Plugin<'doughnut'> {
  return {
    id: 'donutCenterText',
    afterDraw(chart) {
      const { ctx, chartArea } = chart
      if (!ctx || !chartArea) return
      const firstArc = chart.getDatasetMeta(0)?.data[0]
      const cx = firstArc ? firstArc.x : (chartArea.left + chartArea.right) / 2
      const cy = firstArc ? firstArc.y : (chartArea.top + chartArea.bottom) / 2

      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#64748b'
      ctx.font = '10px sans-serif'
      ctx.fillText('合计', cx, cy - 8)
      ctx.fillStyle = '#0f172a'
      ctx.font = '700 12px sans-serif'
      ctx.fillText(totalText, cx, cy + 9)
      ctx.restore()
    },
  }
}

function buildTooltipLabel(
  ctx: TooltipItem<SupportedChartJsType>,
  chart: DashboardChartResult,
  hasMultiSeries: boolean,
  measureCol?: SmartColumn,
): string {
  const raw = typeof ctx.raw === 'number' ? ctx.raw : 0
  const formatted = formatChartMetric(raw, chart.agg, measureCol)

  if (chart.chartType === 'pie') {
    const datum = chart.data[ctx.dataIndex]
    const pct = datum ? `${(datum.ratio * 100).toFixed(1)}%` : ''
    const cnt = datum ? `${datum.count} 条` : ''
    const meta = [cnt, pct].filter(Boolean).join(' · ')
    return meta ? `${ctx.label}: ${formatted} (${meta})` : `${ctx.label}: ${formatted}`
  }

  if (hasMultiSeries && chart.series) {
    const series = chart.series[ctx.datasetIndex]
    const count = series?.counts[ctx.dataIndex]
    return count !== undefined
      ? `${series!.name}: ${formatted} (${count} 条)`
      : `${ctx.dataset.label ?? ''}: ${formatted}`
  }

  const datum = chart.data[ctx.dataIndex]
  return datum ? `${formatted} (${datum.count} 条)` : formatted
}

/** 将 DashboardChartResult 映射为 Chart.js 配置对象 */
export function buildChartConfiguration(
  chart: DashboardChartResult,
  dimensionCol?: SmartColumn,
  measureCol?: SmartColumn,
  seriesCol?: SmartColumn,
): DashboardChartConfigOutput {
  const measureLabel =
    chart.agg === 'count' ? '记录数' : (measureCol?.title ?? (chart.measureField || chart.title))
  const hasMultiSeries =
    chart.chartType !== 'pie' && Boolean(chart.series && chart.series.length > 0)
  const labels = hasMultiSeries ? chart.categories : chart.data.map((d) => d.label)

  const legendOptions = {
    display: chart.chartType === 'pie' || hasMultiSeries,
    position: (chart.chartType === 'pie' ? 'right' : 'top') as 'right' | 'top',
    labels: {
      boxWidth: 10,
      boxHeight: 10,
      usePointStyle: true,
      padding: 12,
      color: '#475569',
      font: { size: 11 },
    },
    onHover: (_event: unknown, _item: unknown, legend: { chart: Chart }) => {
      legend.chart.canvas.style.cursor = 'pointer'
    },
    onLeave: (_event: unknown, _item: unknown, legend: { chart: Chart }) => {
      legend.chart.canvas.style.cursor = ''
    },
  }

  const tooltipOptions = {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    padding: 10,
    cornerRadius: 8,
    callbacks: {
      label: (ctx: TooltipItem<SupportedChartJsType>) =>
        buildTooltipLabel(ctx, chart, hasMultiSeries, measureCol),
    },
  }

  if (chart.chartType === 'pie') {
    const type: 'pie' | 'doughnut' = chart.donut ? 'doughnut' : 'pie'
    const datasets: ChartDataset<'pie' | 'doughnut', number[]>[] = [
      {
        label: measureLabel,
        data: chart.data.map((d) => Math.max(0, d.value)),
        backgroundColor: chart.data.map((d, idx) =>
          resolveSeriesColor(d.label, idx, d.color, dimensionCol),
        ),
        borderColor: '#ffffff',
        borderWidth: 2,
        hoverOffset: 6,
      },
    ]

    const totalText = formatChartMetric(chart.totalValue, chart.agg, measureCol)
    return {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: chart.donut ? '58%' : 0,
        plugins: {
          legend: legendOptions,
          tooltip: tooltipOptions,
        },
      },
      ...(chart.donut
        ? { plugins: [createDonutCenterPlugin(totalText) as Plugin<SupportedChartJsType>] }
        : {}),
    } as DashboardChartConfigOutput
  }

  if (chart.chartType === 'radar') {
    const datasets: ChartDataset<'radar', number[]>[] = hasMultiSeries
      ? chart.series!.map((s, idx) => {
          const color = resolveSeriesColor(s.name, idx, s.color, seriesCol)
          return {
            label: s.name,
            data: s.values,
            borderColor: color,
            backgroundColor: toAlphaColor(color, 0.18),
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
          }
        })
      : [
          {
            label: measureLabel,
            data: chart.data.map((d) => d.value),
            borderColor: CHART_PALETTE[0],
            backgroundColor: toAlphaColor(CHART_PALETTE[0], 0.18),
            fill: true,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ]

    return {
      type: 'radar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            grid: { color: '#e2e8f0' },
            angleLines: { color: '#e2e8f0' },
            pointLabels: { color: '#475569', font: { size: 11 } },
            ticks: {
              backdropColor: 'transparent',
              color: '#64748b',
              font: { size: 10 },
              callback: (val) => formatAxisTick(Number(val)),
            },
          },
        },
        plugins: {
          legend: legendOptions,
          tooltip: tooltipOptions,
        },
      },
    } as DashboardChartConfigOutput
  }

  if (chart.chartType === 'line' || chart.chartType === 'area') {
    const isArea = chart.chartType === 'area'
    const tension = isArea ? 0.35 : 0.2
    const datasets: ChartDataset<'line', number[]>[] = hasMultiSeries
      ? chart.series!.map((s, idx) => {
          const color = resolveSeriesColor(s.name, idx, s.color, seriesCol)
          return {
            label: s.name,
            data: s.values,
            borderColor: color,
            backgroundColor: isArea ? toAlphaColor(color, 0.18) : color,
            fill: isArea,
            tension,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
          }
        })
      : [
          {
            label: measureLabel,
            data: chart.data.map((d) => d.value),
            borderColor: CHART_PALETTE[0],
            backgroundColor: isArea ? toAlphaColor(CHART_PALETTE[0], 0.16) : CHART_PALETTE[0],
            fill: isArea,
            tension,
            borderWidth: 2.2,
            pointRadius: 3.5,
            pointHoverRadius: 5.5,
          },
        ]

    return {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: {
              color: '#64748b',
              font: { size: 11 },
              callback: (val) => formatAxisTick(Number(val)),
            },
          },
        },
        plugins: {
          legend: legendOptions,
          tooltip: tooltipOptions,
        },
      },
    } as DashboardChartConfigOutput
  }

  const isHorizontal = chart.chartType === 'horizontalBar'
  const stacked = Boolean(chart.stacked)
  const datasets: ChartDataset<'bar', number[]>[] = hasMultiSeries
    ? chart.series!.map((s, idx) => ({
        label: s.name,
        data: s.values,
        backgroundColor: resolveSeriesColor(s.name, idx, s.color, seriesCol),
        borderRadius: 4,
        maxBarThickness: isHorizontal ? 26 : 36,
      }))
    : [
        {
          label: measureLabel,
          data: chart.data.map((d) => d.value),
          backgroundColor: chart.data.map((d, idx) =>
            resolveSeriesColor(d.label, idx, d.color, dimensionCol),
          ),
          borderRadius: 4,
          maxBarThickness: isHorizontal ? 28 : 40,
        },
      ]

  const categoryAxis = {
    stacked,
    grid: { display: false },
    ticks: { color: '#64748b', font: { size: 11 } },
  }
  const valueAxis = {
    stacked,
    beginAtZero: true,
    grid: { color: '#f1f5f9' },
    ticks: {
      color: '#64748b',
      font: { size: 11 },
      callback: (val: string | number) => formatAxisTick(Number(val)),
    },
  }

  return {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: isHorizontal ? 'y' : 'x',
      scales: isHorizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
      plugins: {
        legend: legendOptions,
        tooltip: tooltipOptions,
      },
    },
  } as DashboardChartConfigOutput
}

export interface DashboardChartBodyProps {
  chart: DashboardChartResult
  dimensionCol?: SmartColumn
  measureCol?: SmartColumn
  seriesCol?: SmartColumn
  onChartBodyClick?: (event: React.MouseEvent<HTMLDivElement>) => void
}

export function DashboardChartBody({
  chart,
  dimensionCol,
  measureCol,
  seriesCol,
  onChartBodyClick,
}: DashboardChartBodyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<Chart<SupportedChartJsType, number[], string> | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || chart.data.length === 0) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const config = buildChartConfiguration(chart, dimensionCol, measureCol, seriesCol)
    const instance = new Chart(canvas, config)
    chartRef.current = instance

    return () => {
      instance.destroy()
      if (chartRef.current === instance) {
        chartRef.current = null
      }
    }
  }, [chart, dimensionCol, measureCol, seriesCol])

  if (chart.data.length === 0) {
    return (
      <div
        onClick={onChartBodyClick}
        className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-400"
      >
        暂无满足当前筛选条件的数据
      </div>
    )
  }

  return (
    <div
      className="relative h-56 w-full"
      onClick={(event) => {
        if (isLegendClick(chartRef.current, event.nativeEvent)) {
          event.stopPropagation()
          return
        }
        onChartBodyClick?.(event)
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={resolveChartAriaLabel(chart)}
        className="h-full w-full"
      />
    </div>
  )
}
