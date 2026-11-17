import { describe, expect, it } from 'vitest'

import {
  computeDimensionBreakdown,
  getAvailableDrillDimensions,
} from '../../src/domain/drill-engine'
import type { SmartColumn, SmartPivotMeasureConfig, SmartRecord } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'status', title: '状态', type: 'select', width: 100 },
  { key: 'dept', title: '部门', type: 'lookup', width: 120 },
  { key: 'owner', title: '负责人', type: 'person', width: 100 },
  { key: 'pay_date', title: '日期', type: 'date', width: 100 },
  { key: 'verified', title: '已核验', type: 'checkbox', width: 80 },
  { key: 'code', title: '编号', type: 'text', width: 100 },
  { key: 'amount', title: '金额', type: 'number', width: 120 },
  { key: 'progress', title: '进度', type: 'progress', width: 120 },
  { key: 'img', title: '图片', type: 'image', width: 100 },
  { key: 'doc', title: '链接', type: 'link', width: 120 },
  { key: 'rate', title: '达成率', type: 'formula', width: 100 },
]

describe('drill-engine', () => {
  it('getAvailableDrillDimensions 排除已用维度及非维度展示列', () => {
    const available = getAvailableDrillDimensions(COLUMNS, ['dept'], ['status'])
    expect(available.map((c) => c.key)).toEqual(['owner', 'pay_date', 'verified', 'code'])
  })

  it('computeDimensionBreakdown 分组计算多度量指标、降序排列并计算占比', () => {
    const records: SmartRecord[] = [
      { _id: '1', dept: '研发部', amount: 300, score: 80 },
      { _id: '2', dept: '研发部', amount: 100, score: 100 },
      { _id: '3', dept: '销售部', amount: 600, score: 90 },
      { _id: '4', dept: null, amount: 0, score: null },
    ]
    const measures: SmartPivotMeasureConfig[] = [
      { key: 'm_sum', title: '金额合计', field: 'amount', agg: 'sum' },
      { key: 'm_cnt', title: '数量', field: '', agg: 'count' },
      { key: 'm_avg', title: '均分', field: 'score', agg: 'avg' },
      { key: 'm_min', title: '最小金额', field: 'amount', agg: 'min' },
      { key: 'm_max', title: '最大金额', field: 'amount', agg: 'max' },
    ]

    const items = computeDimensionBreakdown(records, 'dept', measures)
    expect(items.map((item) => item.value)).toEqual(['销售部', '研发部', '(空)'])

    // 销售部 600 / 1000 = 0.6
    expect(items[0]!.count).toBe(1)
    expect(items[0]!.metrics).toEqual({
      m_sum: 600,
      m_cnt: 1,
      m_avg: 90,
      m_min: 600,
      m_max: 600,
    })
    expect(items[0]!.ratio).toBe(0.6)

    // 研发部 400 / 1000 = 0.4
    expect(items[1]!.count).toBe(2)
    expect(items[1]!.metrics['m_avg']).toBe(90)
    expect(items[1]!.ratio).toBe(0.4)

    // (空)
    expect(items[2]!.metrics['m_avg']).toBeNull()
    expect(items[2]!.ratio).toBe(0)
  })

  it('主指标总和为 0 或无数值时，ratio 回退按记录数占比计算', () => {
    const records: SmartRecord[] = [
      { _id: '1', dept: 'A', amount: 0 },
      { _id: '2', dept: 'A', amount: 0 },
      { _id: '3', dept: 'B', amount: 0 },
      { _id: '4', dept: 'B', amount: 0 },
    ]
    const items = computeDimensionBreakdown(records, 'dept', [
      { key: 'm_sum', title: '金额', field: 'amount', agg: 'sum' },
    ])
    expect(items[0]!.ratio).toBe(0.5)
    expect(items[1]!.ratio).toBe(0.5)

    // 无度量配置时按记录数降序
    const noMeasureItems = computeDimensionBreakdown(
      [
        { _id: '1', dept: 'X' },
        { _id: '2', dept: 'Y' },
        { _id: '3', dept: 'Y' },
      ],
      'dept',
      [],
    )
    expect(noMeasureItems[0]!.value).toBe('Y')
    expect(noMeasureItems[0]!.ratio).toBeCloseTo(2 / 3)
  })

  it('getAvailableDrillDimensions 排除 rollup lookup 列，非可加聚合与负值不扭曲 ratio', () => {
    const colsWithLookup: SmartColumn[] = [
      ...COLUMNS,
      {
        key: 'lookup_one',
        title: '一对一部门',
        type: 'lookup',
        width: 100,
        lookupConfig: {
          groupId: 'g1',
          targetTableId: 't2',
          matchRules: [{ sourceField: 'owner', targetField: 'name' }],
          targetReturnField: 'dept',
          mode: 'one',
        },
      },
      {
        key: 'lookup_rollup',
        title: '回款汇总',
        type: 'lookup',
        width: 100,
        lookupConfig: {
          groupId: 'g2',
          targetTableId: 't3',
          matchRules: [{ sourceField: 'code', targetField: 'code' }],
          targetReturnField: 'amount',
          mode: 'rollup',
          rollupAgg: 'sum',
        },
      },
    ]
    const dims = getAvailableDrillDimensions(colsWithLookup, [], [])
    expect(dims.some((c) => c.key === 'lookup_one')).toBe(true)
    expect(dims.some((c) => c.key === 'lookup_rollup')).toBe(false)

    // 非可加主指标（avg）返回 ratio: 0
    const avgItems = computeDimensionBreakdown(
      [
        { _id: '1', dept: 'A', score: 90 },
        { _id: '2', dept: 'B', score: 60 },
      ],
      'dept',
      [{ key: 'm_avg', title: '均分', field: 'score', agg: 'avg' }],
    )
    expect(avgItems.map((item) => item.ratio)).toEqual([0, 0])

    // 负值与正值混合 sum：负值组 ratio 为 0 且不冲减正值分母
    const mixedItems = computeDimensionBreakdown(
      [
        { _id: '1', dept: 'A', amount: 300 },
        { _id: '2', dept: 'B', amount: 100 },
        { _id: '3', dept: 'C', amount: -200 },
      ],
      'dept',
      [{ key: 'm_sum', title: '金额', field: 'amount', agg: 'sum' }],
    )
    expect(mixedItems[0]!.ratio).toBe(0.75)
    expect(mixedItems[1]!.ratio).toBe(0.25)
    expect(mixedItems[2]!.ratio).toBe(0)
  })
})
