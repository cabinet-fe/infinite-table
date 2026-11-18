// 视图配置抽屉 · 仪表盘配置分栏：
// 支持「轻量目录态（未选中卡片）」与「单卡配置态（选中 KPI 或图表）」按需切换编辑，
// 覆盖卡片增删调序、KPI 图标/数字格式/前后缀，以及 6 类图型、二级分组、堆叠与 Top N 截断配置。

import { useCallback, useEffect, useState, type ComponentType } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Award,
  BarChart3,
  ChevronRight,
  Clock,
  DollarSign,
  Hash,
  Info,
  Layers,
  Percent,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { SUMMARY_LABELS } from '../domain/workspace-helpers'
import type {
  DashboardChartConfig,
  DashboardChartType,
  DashboardConfig,
  DashboardKpiAgg,
  DashboardKpiConfig,
  DashboardKpiIcon,
  SmartColumn,
  SmartPivotAgg,
} from '../shared/schema'
import { CustomSelect, type CustomSelectOption } from './CustomSelect'

/** 仪表盘画布与抽屉联动的选中卡片标识 */
export interface DashboardSelectedItem {
  kind: 'kpi' | 'chart'
  id: string
}

export interface DrawerDashboardPanelProps {
  columns: readonly SmartColumn[]
  config: DashboardConfig
  selectedItem?: DashboardSelectedItem | null
  onSelectItem?: (item: DashboardSelectedItem | null) => void
  onChangeConfig: (next: DashboardConfig) => void
}

type NumberFormatChoice = '__auto__' | NonNullable<SmartColumn['numberFormat']>

const KPI_ACCENTS = ['#2563eb', '#0f766e', '#15803d', '#7c3aed', '#d97706', '#dc2626']

const KPI_AGG_OPTIONS: CustomSelectOption<DashboardKpiAgg>[] = [
  { value: 'count', label: SUMMARY_LABELS.count },
  { value: 'sum', label: SUMMARY_LABELS.sum },
  { value: 'avg', label: SUMMARY_LABELS.avg },
  { value: 'max', label: SUMMARY_LABELS.max },
  { value: 'min', label: SUMMARY_LABELS.min },
  { value: 'filled_rate', label: SUMMARY_LABELS.filled_rate },
]

const KPI_NUMBER_FORMAT_OPTIONS: CustomSelectOption<NumberFormatChoice>[] = [
  { value: '__auto__', label: '跟随列设置' },
  { value: 'integer', label: '整数' },
  { value: 'decimal', label: '小数' },
  { value: 'currency', label: '货币' },
  { value: 'percent', label: '百分比' },
]

interface KpiIconMeta {
  value: DashboardKpiIcon
  label: string
  Icon: ComponentType<{ className?: string }>
}

const KPI_ICON_OPTIONS: readonly KpiIconMeta[] = [
  { value: 'auto', label: '自动', Icon: Sparkles },
  { value: 'hash', label: '计数', Icon: Hash },
  { value: 'dollar', label: '金额', Icon: DollarSign },
  { value: 'percent', label: '比例', Icon: Percent },
  { value: 'trending', label: '趋势', Icon: TrendingUp },
  { value: 'award', label: '峰值', Icon: Award },
  { value: 'layers', label: '汇总', Icon: Layers },
  { value: 'clock', label: '时间', Icon: Clock },
]

const CHART_TYPE_LABELS: Record<DashboardChartType, string> = {
  bar: '柱状图',
  horizontalBar: '横向条形图',
  line: '折线图',
  area: '面积图',
  pie: '饼图 / 环形图',
  radar: '雷达图',
}

const CHART_TYPE_OPTIONS: CustomSelectOption<DashboardChartType>[] = (
  Object.keys(CHART_TYPE_LABELS) as DashboardChartType[]
).map((value) => ({
  value,
  label: CHART_TYPE_LABELS[value],
}))

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

function reorderItems<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items]
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved!)
  return next
}

function getColumnTitle(columns: readonly SmartColumn[], fieldKey: string): string {
  if (!fieldKey || fieldKey === '__count__') return '全部记录'
  return columns.find((c) => c.key === fieldKey)?.title ?? fieldKey
}

function DraftTextInput({
  value,
  ariaLabel,
  placeholder,
  allowEmpty = false,
  className = '',
  onCommit,
}: {
  value: string
  ariaLabel: string
  placeholder?: string
  allowEmpty?: boolean
  className?: string
  onCommit: (nextValue: string) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    setDraft(value)
  }, [value])

  function commit() {
    if (allowEmpty) {
      if (draft !== value) {
        onCommit(draft)
      }
      return
    }
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
      className={`h-7 min-w-0 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none ${className}`}
    />
  )
}

function DraftLimitInput({
  value,
  onCommit,
}: {
  value?: number
  onCommit: (nextLimit: number | undefined) => void
}) {
  const formatted = typeof value === 'number' && value > 0 ? String(Math.floor(value)) : ''
  const [draft, setDraft] = useState(formatted)

  useEffect(() => {
    setDraft(formatted)
  }, [formatted])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed === '') {
      if (value !== undefined) onCommit(undefined)
      return
    }
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed) && parsed >= 1) {
      const normalized = Math.floor(parsed)
      setDraft(String(normalized))
      if (normalized !== value) onCommit(normalized)
      return
    }
    setDraft(formatted)
  }

  return (
    <input
      type="number"
      min={1}
      step={1}
      aria-label="展示上限"
      placeholder="不限"
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
      className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
    />
  )
}

function SingleCardHeader({
  kind,
  title,
  index,
  total,
  onBack,
  onMove,
  onDelete,
}: {
  kind: 'kpi' | 'chart'
  title: string
  index: number
  total: number
  onBack: () => void
  onMove: (toIndex: number) => void
  onDelete: () => void
}) {
  const itemLabel = kind === 'kpi' ? '指标卡' : '图表'
  return (
    <div className="space-y-2 border-b border-slate-100 pb-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回目录"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>返回目录</span>
        </button>

        <div className="flex items-center gap-0.5">
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
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              kind === 'kpi' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {kind === 'kpi' ? 'KPI 指标卡' : '统计图表'}
          </span>
          <span className="truncate text-xs font-semibold text-slate-800">{title}</span>
        </div>
        <span className="shrink-0 text-[11px] text-slate-400">
          {index + 1}/{total}
        </span>
      </div>
    </div>
  )
}

function KpiEditorForm({
  kpi,
  columns,
  kpiFieldOptions,
  onUpdate,
}: {
  kpi: DashboardKpiConfig
  columns: readonly SmartColumn[]
  kpiFieldOptions: readonly CustomSelectOption<string>[]
  onUpdate: (patch: Partial<DashboardKpiConfig>) => void
}) {
  const currentIcon: DashboardKpiIcon = kpi.icon ?? 'auto'
  const currentFormat: NumberFormatChoice = kpi.numberFormat ?? '__auto__'

  return (
    <div className="space-y-3.5" data-dashboard-editor="kpi" data-kpi-id={kpi.id}>
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-slate-600">指标标题</span>
        <DraftTextInput
          value={kpi.title}
          ariaLabel="指标卡标题"
          placeholder="指标标题"
          className="font-medium"
          onCommit={(title) => onUpdate({ title })}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-slate-600">指标字段</span>
          <CustomSelect
            size="sm"
            className="w-full"
            value={kpi.field || '__count__'}
            ariaLabel="指标字段"
            options={kpiFieldOptions}
            onChange={(field) => {
              const col = columns.find((c) => c.key === field)
              onUpdate({
                field,
                ...(field === '__count__' ? { agg: 'count' } : {}),
                numberFormat: col?.numberFormat,
              })
            }}
          />
        </div>
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-slate-600">聚合方式</span>
          <CustomSelect
            size="sm"
            className="w-full"
            value={kpi.agg}
            ariaLabel="聚合方式"
            options={
              kpi.field === '__count__' ? [{ value: 'count', label: '已填数' }] : KPI_AGG_OPTIONS
            }
            onChange={(agg) => onUpdate({ agg })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <span className="block text-[11px] font-medium text-slate-600">数字格式</span>
        <CustomSelect
          size="sm"
          className="w-full"
          value={currentFormat}
          ariaLabel="数字格式"
          options={KPI_NUMBER_FORMAT_OPTIONS}
          onChange={(val) =>
            onUpdate({
              numberFormat: val === '__auto__' ? undefined : val,
            })
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-slate-600">数值前缀</span>
          <DraftTextInput
            value={kpi.prefix ?? ''}
            ariaLabel="数值前缀"
            placeholder="如 ¥ / 约"
            allowEmpty
            onCommit={(prefix) => onUpdate({ prefix: prefix === '' ? undefined : prefix })}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-slate-600">数值后缀</span>
          <DraftTextInput
            value={kpi.suffix ?? ''}
            ariaLabel="数值后缀"
            placeholder="如 个 / 万"
            allowEmpty
            onCommit={(suffix) => onUpdate({ suffix: suffix === '' ? undefined : suffix })}
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <span className="block text-[11px] font-medium text-slate-600">图标风格</span>
        <div className="grid grid-cols-4 gap-1.5">
          {KPI_ICON_OPTIONS.map(({ value, label, Icon }) => {
            const active = currentIcon === value
            return (
              <button
                key={value}
                type="button"
                aria-label={`图标 ${label}`}
                aria-pressed={active}
                data-kpi-icon={value}
                onClick={() => onUpdate({ icon: value })}
                className={`flex h-8 items-center justify-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[11px] font-medium text-slate-600">主题色</span>
        <div className="flex items-center gap-1.5">
          {KPI_ACCENTS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`指标色 ${color}`}
              aria-pressed={kpi.accentColor === color}
              onClick={() => onUpdate({ accentColor: color })}
              className={`h-4.5 w-4.5 rounded-full border transition-transform ${
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
  )
}

function ChartEditorForm({
  chart,
  dimensionOptions,
  measureOptions,
  onUpdate,
}: {
  chart: DashboardChartConfig
  dimensionOptions: readonly CustomSelectOption<string>[]
  measureOptions: readonly CustomSelectOption<string>[]
  onUpdate: (patch: Partial<DashboardChartConfig>) => void
}) {
  const isPie = chart.chartType === 'pie'
  const supportsStacked = chart.chartType === 'bar' || chart.chartType === 'horizontalBar'
  const hasSeries = Boolean(chart.seriesField && chart.seriesField.trim() !== '')
  const defaultSort =
    chart.chartType === 'line' || chart.chartType === 'area' ? 'label_asc' : 'value_desc'

  const seriesOptions: CustomSelectOption<string>[] = [
    { value: '', label: '无二级分组' },
    ...dimensionOptions.map((opt) => ({
      ...opt,
      disabled: opt.value === chart.dimensionField,
      hint: opt.value === chart.dimensionField ? '主维度' : undefined,
    })),
  ]

  return (
    <div className="space-y-3.5" data-dashboard-editor="chart" data-chart-id={chart.id}>
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-slate-600">图表标题</span>
        <DraftTextInput
          value={chart.title}
          ariaLabel="图表标题"
          placeholder="图表标题"
          className="font-medium"
          onCommit={(title) => onUpdate({ title })}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-slate-600">图表类型</span>
          <CustomSelect
            size="sm"
            className="w-full"
            value={chart.chartType}
            ariaLabel="图表类型"
            options={CHART_TYPE_OPTIONS}
            onChange={(chartType) =>
              onUpdate({
                chartType,
                ...(chartType === 'pie' && chart.donut === undefined ? { donut: true } : {}),
              })
            }
          />
        </div>
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-slate-600">主分组维度</span>
          <CustomSelect
            size="sm"
            className="w-full"
            value={chart.dimensionField}
            ariaLabel="主分组维度"
            options={dimensionOptions}
            onChange={(dimensionField) =>
              onUpdate({
                dimensionField,
                ...(chart.seriesField === dimensionField ? { seriesField: undefined } : {}),
              })
            }
          />
        </div>
      </div>

      <div className="space-y-1">
        <span className="block text-[11px] font-medium text-slate-600">
          二级分组维度（对比系列）
        </span>
        <CustomSelect
          size="sm"
          className="w-full"
          value={chart.seriesField ?? ''}
          ariaLabel="二级分组维度"
          disabled={isPie}
          options={seriesOptions}
          onChange={(seriesField) =>
            onUpdate({
              seriesField: seriesField || undefined,
              ...(seriesField === '' ? { stacked: false } : {}),
            })
          }
        />
        {isPie && (
          <p
            role="note"
            className="flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700"
          >
            <Info className="h-3 w-3 shrink-0" />
            <span>饼图 / 环形图不支持二级分组，仅按主维度统计占比。</span>
          </p>
        )}
      </div>

      {supportsStacked && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-600">多系列排列</span>
            {!hasSeries && <span className="text-[10px] text-slate-400">选择二级分组后可用</span>}
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              disabled={!hasSeries}
              aria-pressed={!chart.stacked}
              onClick={() => onUpdate({ stacked: false })}
              className={`h-7 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                !chart.stacked
                  ? 'bg-white text-slate-800 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              并列分组
            </button>
            <button
              type="button"
              disabled={!hasSeries}
              aria-pressed={Boolean(chart.stacked)}
              onClick={() => onUpdate({ stacked: true })}
              className={`h-7 rounded-md text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                chart.stacked
                  ? 'bg-white text-blue-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              堆叠
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-slate-600">聚合方式</span>
          <CustomSelect
            size="sm"
            className="w-full"
            value={chart.agg}
            ariaLabel="聚合方式"
            options={CHART_AGG_OPTIONS}
            onChange={(agg) =>
              onUpdate({
                agg,
                measureField:
                  agg === 'count' ? '' : chart.measureField || measureOptions[0]?.value || '',
              })
            }
          />
        </div>
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-slate-600">度量字段</span>
          {chart.agg === 'count' ? (
            <div className="flex h-7 items-center rounded-md border border-slate-200 bg-slate-100 px-2.5 text-xs text-slate-500">
              记录数
            </div>
          ) : (
            <CustomSelect
              size="sm"
              className="w-full"
              value={chart.measureField || measureOptions[0]?.value || ''}
              ariaLabel="度量字段"
              options={measureOptions}
              onChange={(measureField) => onUpdate({ measureField })}
            />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <span className="block text-[11px] font-medium text-slate-600">排序方式</span>
          <CustomSelect
            size="sm"
            className="w-full"
            value={chart.sortBy ?? defaultSort}
            ariaLabel="排序方式"
            options={CHART_SORT_OPTIONS}
            onChange={(sortBy) => onUpdate({ sortBy })}
          />
        </div>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-slate-600">展示上限（Top N）</span>
          <DraftLimitInput value={chart.limit} onCommit={(limit) => onUpdate({ limit })} />
        </label>
      </div>

      <div className="flex items-center gap-4 border-t border-slate-100 pt-2.5 text-xs text-slate-700">
        {isPie && (
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              aria-label="环形图"
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
              checked={Boolean(chart.donut)}
              onChange={(e) => onUpdate({ donut: e.target.checked })}
            />
            <span>环形</span>
          </label>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            aria-label="通栏展示"
            className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
            checked={chart.span === 2}
            onChange={(e) => onUpdate({ span: e.target.checked ? 2 : 1 })}
          />
          <span>通栏展示</span>
        </label>
      </div>
    </div>
  )
}

function DashboardCatalogView({
  columns,
  config,
  onAddKpi,
  onAddChart,
  onSelect,
  onMoveKpi,
  onMoveChart,
  onRemoveKpi,
  onRemoveChart,
}: {
  columns: readonly SmartColumn[]
  config: DashboardConfig
  onAddKpi: () => void
  onAddChart: () => void
  onSelect: (item: DashboardSelectedItem) => void
  onMoveKpi: (fromIdx: number, toIdx: number) => void
  onMoveChart: (fromIdx: number, toIdx: number) => void
  onRemoveKpi: (id: string) => void
  onRemoveChart: (id: string) => void
}) {
  return (
    <div className="space-y-5" data-dashboard-catalog="true">
      <div className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-500">
        点击任意卡片目录项或画布中的卡片，即可进入单卡精细配置。
      </div>

      {/* KPI 指标卡目录 */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">
            KPI 指标卡（{config.kpis.length}）
          </h3>
          <button
            type="button"
            onClick={onAddKpi}
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
          <div className="space-y-1.5">
            {config.kpis.map((kpi, idx) => {
              const fieldTitle = getColumnTitle(columns, kpi.field)
              return (
                <div
                  key={kpi.id}
                  data-catalog-kpi-id={kpi.id}
                  className="flex items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
                >
                  <button
                    type="button"
                    aria-label={`配置指标卡 ${kpi.title}`}
                    onClick={() => onSelect({ kind: 'kpi', id: kpi.id })}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: kpi.accentColor ?? '#2563eb' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-800">{kpi.title}</div>
                      <div className="truncate text-[10px] text-slate-400">
                        {fieldTitle} · {SUMMARY_LABELS[kpi.agg]}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5 border-l border-slate-100 pl-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      aria-label={`上移指标卡 ${kpi.title}`}
                      onClick={() => onMoveKpi(idx, idx - 1)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === config.kpis.length - 1}
                      aria-label={`下移指标卡 ${kpi.title}`}
                      onClick={() => onMoveKpi(idx, idx + 1)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除指标卡 ${kpi.title}`}
                      onClick={() => onRemoveKpi(kpi.id)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 统计图表目录 */}
      <section className="space-y-2.5 border-t border-slate-100 pt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-800">
            统计图表（{config.charts.length}）
          </h3>
          <button
            type="button"
            disabled={columns.length === 0}
            onClick={onAddChart}
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
          <div className="space-y-1.5">
            {config.charts.map((chart, idx) => {
              const dimTitle = getColumnTitle(columns, chart.dimensionField)
              const seriesSummary =
                chart.seriesField && chart.chartType !== 'pie'
                  ? ` × ${getColumnTitle(columns, chart.seriesField)}`
                  : ''
              return (
                <div
                  key={chart.id}
                  data-catalog-chart-id={chart.id}
                  className="flex items-center justify-between gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 transition-colors hover:border-emerald-300 hover:bg-emerald-50/30"
                >
                  <button
                    type="button"
                    aria-label={`配置图表 ${chart.title}`}
                    onClick={() => onSelect({ kind: 'chart', id: chart.id })}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <BarChart3 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-800">
                        {chart.title}
                      </div>
                      <div className="truncate text-[10px] text-slate-400">
                        {CHART_TYPE_LABELS[chart.chartType]} · {dimTitle}
                        {seriesSummary}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5 border-l border-slate-100 pl-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      aria-label={`上移图表 ${chart.title}`}
                      onClick={() => onMoveChart(idx, idx - 1)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === config.charts.length - 1}
                      aria-label={`下移图表 ${chart.title}`}
                      onClick={() => onMoveChart(idx, idx + 1)}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`删除图表 ${chart.title}`}
                      onClick={() => onRemoveChart(chart.id)}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export function DrawerDashboardPanel({
  columns,
  config,
  selectedItem,
  onSelectItem,
  onChangeConfig,
}: DrawerDashboardPanelProps) {
  const isControlled = selectedItem !== undefined
  const [internalSelected, setInternalSelected] = useState<DashboardSelectedItem | null>(null)
  const rawSelected = isControlled ? selectedItem : internalSelected

  const setSelected = useCallback(
    (next: DashboardSelectedItem | null) => {
      if (!isControlled) {
        setInternalSelected(next)
      }
      onSelectItem?.(next)
    },
    [isControlled, onSelectItem],
  )

  const kpiIndex =
    rawSelected?.kind === 'kpi' ? config.kpis.findIndex((item) => item.id === rawSelected.id) : -1
  const chartIndex =
    rawSelected?.kind === 'chart'
      ? config.charts.findIndex((item) => item.id === rawSelected.id)
      : -1
  const activeKpi = kpiIndex >= 0 ? config.kpis[kpiIndex]! : null
  const activeChart = chartIndex >= 0 ? config.charts[chartIndex]! : null

  useEffect(() => {
    if (!isControlled && rawSelected !== null && !activeKpi && !activeChart) {
      setInternalSelected(null)
    }
  }, [isControlled, rawSelected, activeKpi, activeChart])

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

  function moveKpi(fromIdx: number, toIdx: number) {
    onChangeConfig({
      ...config,
      kpis: reorderItems(config.kpis, fromIdx, toIdx),
    })
  }

  function removeKpi(id: string) {
    onChangeConfig({
      ...config,
      kpis: config.kpis.filter((item) => item.id !== id),
    })
    if (activeKpi?.id === id) {
      setSelected(null)
    }
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

  function moveChart(fromIdx: number, toIdx: number) {
    onChangeConfig({
      ...config,
      charts: reorderItems(config.charts, fromIdx, toIdx),
    })
  }

  function removeChart(id: string) {
    onChangeConfig({
      ...config,
      charts: config.charts.filter((item) => item.id !== id),
    })
    if (activeChart?.id === id) {
      setSelected(null)
    }
  }

  if (activeKpi) {
    return (
      <div className="space-y-4">
        <SingleCardHeader
          kind="kpi"
          title={activeKpi.title}
          index={kpiIndex}
          total={config.kpis.length}
          onBack={() => setSelected(null)}
          onMove={(toIdx) => moveKpi(kpiIndex, toIdx)}
          onDelete={() => removeKpi(activeKpi.id)}
        />
        <KpiEditorForm
          kpi={activeKpi}
          columns={columns}
          kpiFieldOptions={kpiFieldOptions}
          onUpdate={(patch) => updateKpi(activeKpi.id, patch)}
        />
      </div>
    )
  }

  if (activeChart) {
    return (
      <div className="space-y-4">
        <SingleCardHeader
          kind="chart"
          title={activeChart.title}
          index={chartIndex}
          total={config.charts.length}
          onBack={() => setSelected(null)}
          onMove={(toIdx) => moveChart(chartIndex, toIdx)}
          onDelete={() => removeChart(activeChart.id)}
        />
        <ChartEditorForm
          chart={activeChart}
          dimensionOptions={dimensionOptions}
          measureOptions={measureOptions}
          onUpdate={(patch) => updateChart(activeChart.id, patch)}
        />
      </div>
    )
  }

  return (
    <DashboardCatalogView
      columns={columns}
      config={config}
      onAddKpi={addKpi}
      onAddChart={addChart}
      onSelect={setSelected}
      onMoveKpi={moveKpi}
      onMoveChart={moveChart}
      onRemoveKpi={removeKpi}
      onRemoveChart={removeChart}
    />
  )
}
