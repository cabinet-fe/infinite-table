import { describe, expect, it } from 'vitest'
import {
  computeDashboard,
  computeDashboardChart,
  computeDashboardKpi,
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
})
