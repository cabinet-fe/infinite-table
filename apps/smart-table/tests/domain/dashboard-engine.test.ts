import { describe, expect, it } from 'vitest'
import {
  MAX_CHART_SERIES,
  computeDashboard,
  computeDashboardChart,
  computeDashboardKpi,
  resolveKpiIcon,
} from '../../src/domain/dashboard-engine'
import type { DashboardConfig, SmartColumn, SmartRecord } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 100 },
  {
    key: 'region',
    title: '大区',
    type: 'select',
    width: 110,
    options: [
      { label: '华南', color: '#dcfce7', textColor: '#15803d' },
      { label: '华东', color: '#dbeafe', textColor: '#1d4ed8' },
    ],
  },
  { key: 'month', title: '月份', type: 'text', width: 90 },
  { key: 'amount', title: '金额', type: 'number', width: 120, numberFormat: 'currency' },
  { key: 'rate', title: '达成率', type: 'formula', width: 100, numberFormat: 'percent' },
  { key: 'verified', title: '核验', type: 'checkbox', width: 80 },
]

const RECORDS: SmartRecord[] = [
  { _id: '1', code: 'A', region: '华南', month: '02月', amount: 300, rate: 0.6, verified: true },
  { _id: '2', code: 'B', region: '华东', month: '01月', amount: 500, rate: 0.8, verified: true },
  { _id: '3', code: 'C', region: '华南', month: '01月', amount: 200, rate: 0.4, verified: false },
  { _id: '4', code: '', region: '', month: '03月', amount: null, rate: null, verified: false },
]

describe('dashboard-engine', () => {
  it('computeDashboardKpi 支持 count/sum/avg/max/min/filled_rate 与前缀后缀', () => {
    const totalCount = computeDashboardKpi(RECORDS, COLUMNS, {
      id: 'k1',
      title: '全部记录',
      field: '__count__',
      agg: 'count',
      suffix: '条',
    })
    expect(totalCount.value).toBe(4)
    expect(totalCount.formattedValue).toBe('4条')

    const nonEmptyCode = computeDashboardKpi(RECORDS, COLUMNS, {
      id: 'k2',
      title: '有效编号',
      field: 'code',
      agg: 'count',
    })
    expect(nonEmptyCode.value).toBe(3)

    const sumAmount = computeDashboardKpi(RECORDS, COLUMNS, {
      id: 'k3',
      title: '总金额',
      field: 'amount',
      agg: 'sum',
    })
    expect(sumAmount.value).toBe(1000)
    expect(sumAmount.formattedValue).toBe('¥1,000')

    const verifiedRate = computeDashboardKpi(RECORDS, COLUMNS, {
      id: 'k4',
      title: '核验率',
      field: 'verified',
      agg: 'filled_rate',
    })
    expect(verifiedRate.value).toBe(0.5)
    expect(verifiedRate.formattedValue).toBe('50%')
  })

  it('computeDashboardChart 支持柱状/饼图降序与折线图标签升序、选项配色与占比', () => {
    const barChart = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c1',
      title: '大区金额',
      chartType: 'bar',
      dimensionField: 'region',
      measureField: 'amount',
      agg: 'sum',
      sortBy: 'value_desc',
    })
    expect(barChart.totalValue).toBe(1000)
    expect(barChart.data).toEqual([
      { label: '华东', value: 500, count: 1, ratio: 0.5, color: '#dbeafe' },
      { label: '华南', value: 500, count: 2, ratio: 0.5, color: '#dcfce7' },
      { label: '(空)', value: 0, count: 1, ratio: 0 },
    ])

    const lineChart = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c2',
      title: '月度趋势',
      chartType: 'line',
      dimensionField: 'month',
      measureField: '',
      agg: 'count',
      limit: 2,
    })
    expect(lineChart.data.map((d) => [d.label, d.value])).toEqual([
      ['01月', 2],
      ['02月', 1],
    ])
  })

  it('computeDashboard 批量聚合空数据集时不抛错', () => {
    const config: DashboardConfig = {
      kpis: [{ id: 'k1', title: '均值', field: 'amount', agg: 'avg' }],
      charts: [
        {
          id: 'c1',
          title: '分布',
          chartType: 'pie',
          dimensionField: 'region',
          measureField: '',
          agg: 'count',
          donut: true,
        },
      ],
    }
    const result = computeDashboard([], COLUMNS, config)
    expect(result.kpis[0]!.value).toBeNull()
    expect(result.kpis[0]!.formattedValue).toBe('-')
    expect(result.charts[0]!.data).toEqual([])
    expect(result.charts[0]!.totalValue).toBe(0)
  })

  it('computeDashboardChart 支持二级分组多系列聚合、stacked 透传与 limit 截断', () => {
    const chart = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c_multi',
      title: '各大区月度金额',
      chartType: 'horizontalBar',
      dimensionField: 'region',
      seriesField: 'month',
      stacked: true,
      measureField: 'amount',
      agg: 'sum',
      sortBy: 'value_desc',
      limit: 2,
    })

    expect(chart.seriesField).toBe('month')
    expect(chart.stacked).toBe(true)
    expect(chart.categories).toEqual(['华东', '华南'])
    expect(chart.data.map((d) => [d.label, d.value])).toEqual([
      ['华东', 500],
      ['华南', 500],
    ])
    expect(chart.series).toEqual([
      { name: '01月', values: [500, 200], counts: [1, 1], totalValue: 700 },
      { name: '02月', values: [0, 300], counts: [0, 1], totalValue: 300 },
    ])

    const areaChart = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c_area',
      title: '月度各大区趋势',
      chartType: 'area',
      dimensionField: 'month',
      seriesField: 'region',
      stacked: true,
      measureField: 'amount',
      agg: 'sum',
    })
    // area 默认按维度标签升序，非柱状/条形不透传 stacked
    expect(areaChart.categories).toEqual(['01月', '02月', '03月'])
    expect(areaChart.stacked).toBeUndefined()
    expect(areaChart.series?.find((s) => s.name === '华南')).toEqual({
      name: '华南',
      values: [200, 300, 0],
      counts: [1, 1, 0],
      totalValue: 500,
      color: '#dcfce7',
    })
  })

  it('computeDashboardChart 超过 8 个系列时按总值降序截断为 MAX_CHART_SERIES', () => {
    expect(MAX_CHART_SERIES).toBe(8)
    const manySeriesRecords: SmartRecord[] = Array.from({ length: 10 }, (_, idx) => ({
      _id: `r_${idx}`,
      region: idx % 2 === 0 ? '华东' : '华南',
      month: `S${String(idx + 1).padStart(2, '0')}`,
      amount: (idx + 1) * 100,
    }))

    const result = computeDashboardChart(manySeriesRecords, COLUMNS, {
      id: 'c_cap',
      title: '系列截断校验',
      chartType: 'bar',
      dimensionField: 'region',
      seriesField: 'month',
      measureField: 'amount',
      agg: 'sum',
    })

    expect(result.series).toHaveLength(8)
    expect(result.series?.map((s) => s.name)).toEqual([
      'S10',
      'S09',
      'S08',
      'S07',
      'S06',
      'S05',
      'S04',
      'S03',
    ])
  })

  it('computeDashboardChart 饼图自动忽略 seriesField 与 stacked 按单系列输出', () => {
    const pie = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c_pie_ignore',
      title: '大区占比',
      chartType: 'pie',
      dimensionField: 'region',
      seriesField: 'month',
      stacked: true,
      measureField: 'amount',
      agg: 'sum',
      donut: true,
    })

    expect(pie.seriesField).toBeUndefined()
    expect(pie.series).toBeUndefined()
    expect(pie.stacked).toBeUndefined()
    expect(pie.categories).toEqual(['华东', '华南', '(空)'])
    expect(pie.data).toHaveLength(3)
  })

  it('resolveKpiIcon 与 computeDashboardKpi 支持自动匹配与手动覆盖', () => {
    const progressCol: SmartColumn = { key: 'prog', title: '进度', type: 'progress', width: 100 }
    const dateCol: SmartColumn = { key: 'due', title: '截止日', type: 'date', width: 110 }
    const amountCol = COLUMNS.find((c) => c.key === 'amount')!
    const codeCol = COLUMNS.find((c) => c.key === 'code')!

    expect(resolveKpiIcon({ agg: 'count' }, amountCol)).toBe('hash')
    expect(resolveKpiIcon({ agg: 'filled_rate' }, codeCol)).toBe('percent')
    expect(resolveKpiIcon({ agg: 'sum' }, amountCol)).toBe('dollar')
    expect(resolveKpiIcon({ agg: 'avg' }, progressCol)).toBe('percent')
    expect(resolveKpiIcon({ agg: 'max' }, dateCol)).toBe('clock')
    expect(resolveKpiIcon({ agg: 'max' }, codeCol)).toBe('award')
    expect(resolveKpiIcon({ agg: 'avg' }, codeCol)).toBe('trending')
    expect(resolveKpiIcon({ agg: 'min' }, codeCol)).toBe('clock')
    expect(resolveKpiIcon({ agg: 'sum' }, codeCol)).toBe('layers')
    expect(resolveKpiIcon({ agg: 'sum', icon: 'auto' }, amountCol)).toBe('dollar')
    expect(resolveKpiIcon({ agg: 'sum', icon: 'award' }, amountCol)).toBe('award')

    const kpiAuto = computeDashboardKpi(RECORDS, COLUMNS, {
      id: 'k_auto',
      title: '总金额',
      field: 'amount',
      agg: 'sum',
    })
    expect(kpiAuto.icon).toBe('dollar')

    const kpiManual = computeDashboardKpi(RECORDS, COLUMNS, {
      id: 'k_manual',
      title: '最高金额',
      field: 'amount',
      agg: 'max',
      icon: 'award',
    })
    expect(kpiManual.icon).toBe('award')
  })

  it('KPI decimalPlaces 优先于列配置，未设时回退列 decimalPlaces 且 0.1+0.2 无漂移', () => {
    const decimalCols: SmartColumn[] = [
      {
        key: 'amount',
        title: '金额',
        type: 'number',
        width: 120,
        numberFormat: 'currency',
        decimalPlaces: 3,
      },
    ]
    const decimalRecs: SmartRecord[] = [
      { _id: '1', region: '华东', amount: 0.1 },
      { _id: '2', region: '华南', amount: 0.2 },
    ]

    const fallbackKpi = computeDashboardKpi(decimalRecs, decimalCols, {
      id: 'k_fallback',
      title: '回退列小数位',
      field: 'amount',
      agg: 'sum',
    })
    expect(fallbackKpi.value).toBe(0.3)
    expect(fallbackKpi.formattedValue).toBe('¥0.300')

    const overrideKpi = computeDashboardKpi(decimalRecs, decimalCols, {
      id: 'k_override',
      title: 'KPI 覆盖小数位',
      field: 'amount',
      agg: 'avg',
      decimalPlaces: 4,
    })
    expect(overrideKpi.value).toBe(0.15)
    expect(overrideKpi.formattedValue).toBe('¥0.1500')

    const chart = computeDashboardChart(decimalRecs, decimalCols, {
      id: 'c_ratio',
      title: '占比',
      chartType: 'pie',
      dimensionField: 'region',
      measureField: 'amount',
      agg: 'sum',
    })
    expect(chart.totalValue).toBe(0.3)
    expect(chart.data.find((d) => d.label === '华南')?.ratio).toBeCloseTo(2 / 3)
  })
})
