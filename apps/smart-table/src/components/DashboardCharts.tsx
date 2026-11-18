// 仪表盘交互式 SVG 图表组件集：柱状图、折线图、饼图/环形图，支持悬停数值提示与图例联动高亮。

import { useState } from 'react'
import type { DashboardChartDatum, DashboardChartResult } from '../domain/dashboard-engine'
import { formatSummaryValue } from '../domain/query-engine'
import type { SmartColumn } from '../shared/schema'

const CHART_PALETTE = [
  '#2563eb',
  '#0d9488',
  '#d97706',
  '#7c3aed',
  '#e11d48',
  '#0284c7',
  '#059669',
  '#4f46e5',
]

function resolveSeriesColor(
  datum: DashboardChartDatum,
  index: number,
  dimensionCol?: SmartColumn,
): string {
  const opt = dimensionCol?.options?.find((o) => o.label === datum.label)
  if (opt?.textColor) return opt.textColor
  if (datum.color) return datum.color
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

function truncateLabel(text: string, maxLen = 9): string {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text
}

function formatAxisTick(value: number): string {
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (Math.abs(value) >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  if (Number.isInteger(value)) return value.toLocaleString('zh-CN')
  return value.toFixed(1)
}

export interface DashboardChartBodyProps {
  chart: DashboardChartResult
  dimensionCol?: SmartColumn
  measureCol?: SmartColumn
}

export function DashboardChartBody({ chart, dimensionCol, measureCol }: DashboardChartBodyProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  if (chart.data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-400">
        暂无满足当前筛选条件的数据
      </div>
    )
  }

  const hoveredDatum = hoveredIdx !== null ? chart.data[hoveredIdx] : undefined
  const activeColor =
    hoveredIdx !== null && hoveredDatum
      ? resolveSeriesColor(hoveredDatum, hoveredIdx, dimensionCol)
      : '#2563eb'

  return (
    <div className="relative" onMouseLeave={() => setHoveredIdx(null)}>
      {hoveredDatum && (
        <div
          data-chart-tooltip="true"
          className="pointer-events-none absolute right-2 top-1 z-10 rounded-lg border border-slate-200 bg-slate-900/95 px-2.5 py-1.5 text-[11px] text-white shadow-lg"
        >
          <div className="flex items-center gap-1.5 font-medium">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: activeColor }}
            />
            <span>{hoveredDatum.label}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2.5 text-slate-200">
            <strong className="font-semibold text-white">
              {formatChartMetric(hoveredDatum.value, chart.agg, measureCol)}
            </strong>
            <span>{hoveredDatum.count} 条</span>
            <span>{(hoveredDatum.ratio * 100).toFixed(1)}%</span>
          </div>
        </div>
      )}

      {chart.chartType === 'bar' && (
        <BarChartSvg
          data={chart.data}
          dimensionCol={dimensionCol}
          hoveredIdx={hoveredIdx}
          onHover={setHoveredIdx}
        />
      )}

      {chart.chartType === 'line' && (
        <LineChartSvg data={chart.data} hoveredIdx={hoveredIdx} onHover={setHoveredIdx} />
      )}

      {chart.chartType === 'pie' && (
        <PieChartSvg
          chart={chart}
          dimensionCol={dimensionCol}
          measureCol={measureCol}
          hoveredIdx={hoveredIdx}
          onHover={setHoveredIdx}
        />
      )}
    </div>
  )
}

function BarChartSvg({
  data,
  dimensionCol,
  hoveredIdx,
  onHover,
}: {
  data: readonly DashboardChartDatum[]
  dimensionCol?: SmartColumn
  hoveredIdx: number | null
  onHover: (idx: number | null) => void
}) {
  const width = 480
  const height = 224
  const pad = { top: 18, right: 16, bottom: 42, left: 54 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const maxVal = Math.max(1, ...data.map((d) => Math.max(0, d.value)))
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const step = plotW / Math.max(1, data.length)
  const barW = Math.min(40, Math.max(12, step * 0.56))

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-56 w-full select-none"
      role="img"
      aria-label="柱状图"
    >
      {ticks.map((ratio) => {
        const y = pad.top + plotH * (1 - ratio)
        return (
          <g key={ratio}>
            <line
              x1={pad.left}
              y1={y}
              x2={width - pad.right}
              y2={y}
              stroke={ratio === 0 ? '#cbd5e1' : '#f1f5f9'}
              strokeWidth={1}
            />
            <text x={pad.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#64748b">
              {formatAxisTick(maxVal * ratio)}
            </text>
          </g>
        )
      })}

      {data.map((datum, idx) => {
        const val = Math.max(0, datum.value)
        const barH = (val / maxVal) * plotH
        const cx = pad.left + step * idx + step / 2
        const x = cx - barW / 2
        const y = pad.top + plotH - barH
        const color = resolveSeriesColor(datum, idx, dimensionCol)
        const isHovered = hoveredIdx === idx

        return (
          <g
            key={`${datum.label}-${idx}`}
            onMouseEnter={() => onHover(idx)}
            className="cursor-pointer"
          >
            <rect
              x={pad.left + step * idx}
              y={pad.top}
              width={step}
              height={plotH}
              fill="transparent"
            />
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(2, barH)}
              rx={4}
              fill={color}
              fillOpacity={hoveredIdx === null || isHovered ? 0.92 : 0.45}
            />
            <text
              x={cx}
              y={height - 18}
              textAnchor="middle"
              fontSize={10}
              fill={isHovered ? '#0f172a' : '#64748b'}
              fontWeight={isHovered ? 600 : 400}
            >
              {truncateLabel(datum.label, data.length > 7 ? 6 : 9)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function LineChartSvg({
  data,
  hoveredIdx,
  onHover,
}: {
  data: readonly DashboardChartDatum[]
  hoveredIdx: number | null
  onHover: (idx: number | null) => void
}) {
  const width = 480
  const height = 224
  const pad = { top: 20, right: 20, bottom: 42, left: 54 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const maxVal = Math.max(1, ...data.map((d) => Math.max(0, d.value)))
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  const points = data.map((datum, idx) => {
    const x =
      data.length === 1 ? pad.left + plotW / 2 : pad.left + (idx / (data.length - 1)) * plotW
    const y = pad.top + plotH - (Math.max(0, datum.value) / maxVal) * plotH
    return { x, y, datum, idx }
  })

  const linePath = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1]!.x.toFixed(1)} ${(pad.top + plotH).toFixed(1)} L ${points[0]!.x.toFixed(1)} ${(pad.top + plotH).toFixed(1)} Z`
      : ''

  const labelStep = Math.max(1, Math.ceil(data.length / 8))

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-56 w-full select-none"
      role="img"
      aria-label="折线图"
    >
      {ticks.map((ratio) => {
        const y = pad.top + plotH * (1 - ratio)
        return (
          <g key={ratio}>
            <line
              x1={pad.left}
              y1={y}
              x2={width - pad.right}
              y2={y}
              stroke={ratio === 0 ? '#cbd5e1' : '#f1f5f9'}
              strokeWidth={1}
            />
            <text x={pad.left - 8} y={y + 3} textAnchor="end" fontSize={10} fill="#64748b">
              {formatAxisTick(maxVal * ratio)}
            </text>
          </g>
        )
      })}

      {areaPath && <path d={areaPath} fill="#2563eb" fillOpacity={0.09} />}
      {points.length > 1 && (
        <path
          d={linePath}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}

      {points.map((pt) => {
        const isHovered = hoveredIdx === pt.idx
        const showLabel = pt.idx % labelStep === 0 || pt.idx === points.length - 1
        const hitW = plotW / Math.max(1, points.length)
        return (
          <g
            key={`${pt.datum.label}-${pt.idx}`}
            onMouseEnter={() => onHover(pt.idx)}
            className="cursor-pointer"
          >
            {isHovered && (
              <line
                x1={pt.x}
                y1={pad.top}
                x2={pt.x}
                y2={pad.top + plotH}
                stroke="#93c5fd"
                strokeDasharray="3 3"
              />
            )}
            <rect x={pt.x - hitW / 2} y={pad.top} width={hitW} height={plotH} fill="transparent" />
            <circle
              cx={pt.x}
              cy={pt.y}
              r={isHovered ? 5.5 : 3.5}
              fill="#ffffff"
              stroke="#2563eb"
              strokeWidth={isHovered ? 2.5 : 2}
            />
            {(showLabel || isHovered) && (
              <text
                x={pt.x}
                y={height - 18}
                textAnchor="middle"
                fontSize={10}
                fill={isHovered ? '#0f172a' : '#64748b'}
                fontWeight={isHovered ? 600 : 400}
              >
                {truncateLabel(pt.datum.label, 8)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function describePieSlicePath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const x1 = cx + outerR * Math.cos(startAngle)
  const y1 = cy + outerR * Math.sin(startAngle)
  const x2 = cx + outerR * Math.cos(endAngle)
  const y2 = cy + outerR * Math.sin(endAngle)
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

  if (innerR <= 0) {
    return `M ${cx} ${cy} L ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} Z`
  }

  const x3 = cx + innerR * Math.cos(endAngle)
  const y3 = cy + innerR * Math.sin(endAngle)
  const x4 = cx + innerR * Math.cos(startAngle)
  const y4 = cy + innerR * Math.sin(startAngle)
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

function PieChartSvg({
  chart,
  dimensionCol,
  measureCol,
  hoveredIdx,
  onHover,
}: {
  chart: DashboardChartResult
  dimensionCol?: SmartColumn
  measureCol?: SmartColumn
  hoveredIdx: number | null
  onHover: (idx: number | null) => void
}) {
  const positiveItems = chart.data
    .map((datum, idx) => ({ datum, idx }))
    .filter((item) => item.datum.ratio > 0)

  const cx = 104
  const cy = 104
  const outerR = 84
  const innerR = chart.donut ? 48 : 0

  let currentAngle = -Math.PI / 2

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <svg
        viewBox="0 0 208 208"
        className="h-52 w-52 shrink-0 select-none"
        role="img"
        aria-label={chart.donut ? '环形图' : '饼图'}
      >
        {positiveItems.length === 0 ? (
          <circle cx={cx} cy={cy} r={outerR} fill="#e2e8f0" />
        ) : positiveItems.length === 1 ? (
          (() => {
            const only = positiveItems[0]!
            const color = resolveSeriesColor(only.datum, only.idx, dimensionCol)
            return (
              <g onMouseEnter={() => onHover(only.idx)} className="cursor-pointer">
                <circle cx={cx} cy={cy} r={outerR} fill={color} />
                {innerR > 0 && <circle cx={cx} cy={cy} r={innerR} fill="#ffffff" />}
              </g>
            )
          })()
        ) : (
          positiveItems.map((item) => {
            const sweep = item.datum.ratio * Math.PI * 2
            const start = currentAngle
            const end = currentAngle + sweep
            currentAngle = end
            const color = resolveSeriesColor(item.datum, item.idx, dimensionCol)
            const isHovered = hoveredIdx === item.idx
            return (
              <path
                key={`${item.datum.label}-${item.idx}`}
                d={describePieSlicePath(
                  cx,
                  cy,
                  isHovered ? outerR + 4 : outerR,
                  innerR,
                  start,
                  end,
                )}
                fill={color}
                fillOpacity={hoveredIdx === null || isHovered ? 0.94 : 0.45}
                stroke="#ffffff"
                strokeWidth={1.5}
                onMouseEnter={() => onHover(item.idx)}
                className="cursor-pointer transition-opacity"
              />
            )
          })
        )}

        {chart.donut && (
          <g pointerEvents="none">
            <text x={cx} y={cy - 4} textAnchor="middle" fontSize={10} fill="#64748b">
              合计
            </text>
            <text
              x={cx}
              y={cy + 13}
              textAnchor="middle"
              fontSize={12}
              fontWeight={700}
              fill="#0f172a"
            >
              {formatChartMetric(chart.totalValue, chart.agg, measureCol)}
            </text>
          </g>
        )}
      </svg>

      {/* 交互图例 */}
      <div className="min-w-0 flex-1 space-y-1.5 self-stretch overflow-y-auto py-1">
        {chart.data.map((datum, idx) => {
          const color = resolveSeriesColor(datum, idx, dimensionCol)
          const isHovered = hoveredIdx === idx
          return (
            <div
              key={`${datum.label}-${idx}`}
              onMouseEnter={() => onHover(idx)}
              className={`flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors ${
                isHovered ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-600'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-xs"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate">{datum.label}</span>
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                {formatChartMetric(datum.value, chart.agg, measureCol)} ·{' '}
                {(datum.ratio * 100).toFixed(1)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
