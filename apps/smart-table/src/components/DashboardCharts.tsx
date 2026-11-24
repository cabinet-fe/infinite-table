// 仪表盘 Chart.js 图表组件集：按需注册六类图型，支持单/多系列（并列/堆叠）渲染与图例点击隔离。

import { memo, useEffect, useRef } from 'react'
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
import {
  formatCompactAxisTick,
  formatNumberValue,
  formatPercentRatio,
} from '../shared/number-format'
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

// 分类色板：品牌蓝优先、低饱和和谐，全部图表共用同一顺序
const CHART_PALETTE = [
  '#3370ff',
  '#22b573',
  '#ff8800',
  '#f54a45',
  '#7f3bf5',
  '#14b8c4',
  '#f6bd16',
  '#8f959e',
] as const

/** 「(空)」等空值分组统一灰色 */
const EMPTY_GROUP_COLOR = '#cdd1d8'

// chart.js 全局默认：字体、字号与文字色与设计规范对齐
Chart.defaults.font.family =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"
Chart.defaults.font.size = 12
Chart.defaults.color = '#646a73'

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

/** 将颜色值转换为带透明度的 rgba 字符串（仅处理 hex，其余原样返回） */
export function toAlphaColor(color: string, alpha: number): string {
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
  if (label === '(空)' || label === '') return EMPTY_GROUP_COLOR
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
    return `${formatNumberValue(value, 'integer')} 条`
  }
  return formatNumberValue(value, measureCol?.numberFormat, measureCol?.decimalPlaces)
}

function formatAxisTick(value: number): string {
  return formatCompactAxisTick(value)
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

function createDonutCenterPlugin(getTotalText: () => string): Plugin<'doughnut'> {
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
      ctx.fillStyle = '#646a73'
      ctx.font = '10px sans-serif'
      ctx.fillText('合计', cx, cy - 8)
      ctx.fillStyle = '#1f2329'
      ctx.font = '600 12px sans-serif'
      ctx.fillText(getTotalText(), cx, cy + 9)
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
    const pct = datum ? formatPercentRatio(datum.ratio) : ''
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
  getDonutTotalText?: () => string,
  getTooltipContext?: () => { chart: DashboardChartResult; measureCol?: SmartColumn },
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
      boxWidth: 8,
      boxHeight: 8,
      usePointStyle: true,
      padding: 12,
    },
    onHover: (_event: unknown, _item: unknown, legend: { chart: Chart }) => {
      legend.chart.canvas.style.cursor = 'pointer'
    },
    onLeave: (_event: unknown, _item: unknown, legend: { chart: Chart }) => {
      legend.chart.canvas.style.cursor = ''
    },
  }

  const tooltipOptions = {
    backgroundColor: '#ffffff',
    titleColor: '#1f2329',
    bodyColor: '#646a73',
    borderColor: '#e5e7ea',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    callbacks: {
      label: (ctx: TooltipItem<SupportedChartJsType>) => {
        const latest = getTooltipContext?.()
        const activeChart = latest?.chart ?? chart
        const activeMeasureCol = latest ? latest.measureCol : measureCol
        const activeMulti =
          activeChart.chartType !== 'pie' &&
          Boolean(activeChart.series && activeChart.series.length > 0)
        return buildTooltipLabel(ctx, activeChart, activeMulti, activeMeasureCol)
      },
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
        cutout: chart.donut ? '62%' : 0,
        plugins: {
          legend: legendOptions,
          tooltip: tooltipOptions,
        },
      },
      ...(chart.donut
        ? {
            plugins: [
              createDonutCenterPlugin(
                getDonutTotalText ?? (() => totalText),
              ) as Plugin<SupportedChartJsType>,
            ],
          }
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
            backgroundColor: toAlphaColor(color, 0.12),
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
            backgroundColor: toAlphaColor(CHART_PALETTE[0], 0.12),
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
            grid: { color: '#eef0f3' },
            angleLines: { color: '#eef0f3' },
            pointLabels: { color: '#646a73' },
            ticks: {
              backdropColor: 'transparent',
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
            backgroundColor: isArea ? toAlphaColor(color, 0.12) : color,
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
            backgroundColor: isArea ? toAlphaColor(CHART_PALETTE[0], 0.12) : CHART_PALETTE[0],
            fill: isArea,
            tension,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 5,
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
          },
          y: {
            beginAtZero: true,
            grid: { color: '#eef0f3' },
            ticks: {
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
        barPercentage: 0.7,
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
          barPercentage: 0.7,
          maxBarThickness: isHorizontal ? 28 : 40,
        },
      ]

  const categoryAxis = {
    stacked,
    grid: { display: false },
  }
  const valueAxis = {
    stacked,
    beginAtZero: true,
    grid: { color: '#eef0f3' },
    ticks: {
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

function resolveChartInstanceKey(chart: DashboardChartResult): string {
  if (chart.chartType === 'pie') {
    return chart.donut ? 'doughnut' : 'pie'
  }
  if (chart.chartType === 'horizontalBar') return 'bar:y'
  if (chart.chartType === 'bar') return 'bar:x'
  if (chart.chartType === 'area' || chart.chartType === 'line') return 'line'
  return chart.chartType
}

function buildChartRenderSignature(
  config: DashboardChartConfigOutput,
  instanceKey: string,
  donutTotalText: string,
): string {
  return JSON.stringify({
    instanceKey,
    labels: config.data.labels,
    datasets: config.data.datasets,
    donutTotalText,
    options: {
      indexAxis: config.options?.indexAxis,
      cutout: (config.options as { cutout?: unknown } | undefined)?.cutout,
      scales: config.options?.scales,
      legend: config.options?.plugins?.legend
        ? {
            display: config.options.plugins.legend.display,
            position: config.options.plugins.legend.position,
          }
        : undefined,
    },
  })
}

export const DashboardChartBody = memo(function DashboardChartBody({
  chart,
  dimensionCol,
  measureCol,
  seriesCol,
  onChartBodyClick,
}: DashboardChartBodyProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<Chart<SupportedChartJsType, number[], string> | null>(null)
  const instanceKeyRef = useRef<string | null>(null)
  const signatureRef = useRef<string | null>(null)
  const totalTextRef = useRef<string>('')
  const tooltipCtxRef = useRef<{ chart: DashboardChartResult; measureCol?: SmartColumn }>({
    chart,
    measureCol,
  })

  const totalText =
    chart.chartType === 'pie' && chart.donut
      ? formatChartMetric(chart.totalValue, chart.agg, measureCol)
      : ''
  totalTextRef.current = totalText
  tooltipCtxRef.current = { chart, measureCol }

  useEffect(() => {
    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
      instanceKeyRef.current = null
      signatureRef.current = null
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || chart.data.length === 0) {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
        instanceKeyRef.current = null
        signatureRef.current = null
      }
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const instanceKey = resolveChartInstanceKey(chart)
    const config = buildChartConfiguration(
      chart,
      dimensionCol,
      measureCol,
      seriesCol,
      () => totalTextRef.current,
      () => tooltipCtxRef.current,
    )
    const nextSignature = buildChartRenderSignature(config, instanceKey, totalTextRef.current)

    if (chartRef.current && instanceKeyRef.current === instanceKey) {
      if (signatureRef.current === nextSignature) {
        return
      }
      chartRef.current.data = config.data as never
      if (config.options) {
        chartRef.current.options = config.options as never
      }
      signatureRef.current = nextSignature
      chartRef.current.update()
      return
    }

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const instance = new Chart(canvas, config)
    chartRef.current = instance
    instanceKeyRef.current = instanceKey
    signatureRef.current = nextSignature
  }, [chart, dimensionCol, measureCol, seriesCol])

  if (chart.data.length === 0) {
    return (
      <div onClick={onChartBodyClick} className="st-empty flex h-56 items-center justify-center">
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
})
