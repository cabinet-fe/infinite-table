// 字段绑定预设的纯逻辑测试：区域类型 + 字段名 + 作用方式 → 路径与 aggregate。
// 不挂 DOM、不引 React——这层只该是纯映射（UI 只负责调用）。
import { describe, expect, test } from 'bun:test'

import {
  boundColumnOf,
  buildBindingPreset,
  detectAggregateMode,
} from '../../src/designer/binding-presets'

describe('绑定预设：点字段即生成路径与聚合', () => {
  test('明细区 + 字段 → 按行取值、无聚合', () => {
    expect(buildBindingPreset(true, 'item_name', 'first')).toEqual({
      path: '[].item_name',
      aggregate: undefined,
    })
  })

  test('明细区传了聚合 → 聚合被忽略', () => {
    for (const mode of ['sum', 'avg', 'count', 'max', 'min'] as const) {
      expect(buildBindingPreset(true, 'qty', mode)).toEqual({
        path: '[].qty',
        aggregate: undefined,
      })
    }
  })

  test('非明细区 + 取第 1 条 → [0] 单值、无聚合', () => {
    expect(buildBindingPreset(false, 'order_no', 'first')).toEqual({
      path: '[0].order_no',
      aggregate: undefined,
    })
  })

  test('非明细区 + 求和 → []. 列 + aggregate sum', () => {
    expect(buildBindingPreset(false, 'qty', 'sum')).toEqual({
      path: '[].qty',
      aggregate: 'sum',
    })
  })

  test('非明细区 + 计数 / 平均 / 最大 / 最小 各自正确', () => {
    expect(buildBindingPreset(false, 'amount', 'count')).toEqual({
      path: '[].amount',
      aggregate: 'count',
    })
    expect(buildBindingPreset(false, 'amount', 'avg')).toEqual({
      path: '[].amount',
      aggregate: 'avg',
    })
    expect(buildBindingPreset(false, 'amount', 'max')).toEqual({
      path: '[].amount',
      aggregate: 'max',
    })
    expect(buildBindingPreset(false, 'amount', 'min')).toEqual({
      path: '[].amount',
      aggregate: 'min',
    })
  })
})

describe('绑定预设：从既有绑定反推 UI 状态', () => {
  test('detectAggregateMode：明细区恒为取第 1 条语义', () => {
    expect(detectAggregateMode(true, undefined)).toBe('first')
    expect(detectAggregateMode(true, { datasetId: 'd', path: '[].qty', aggregate: 'sum' })).toBe(
      'first',
    )
  })

  test('detectAggregateMode：非明细区按 aggregate 反推，无聚合即取第 1 条', () => {
    expect(detectAggregateMode(false, undefined)).toBe('first')
    expect(detectAggregateMode(false, { datasetId: 'd', path: '[0].qty' })).toBe('first')
    expect(detectAggregateMode(false, { datasetId: 'd', path: '[].qty', aggregate: 'avg' })).toBe(
      'avg',
    )
  })

  test('boundColumnOf：直绑路径能反推字段名，嵌套路径不点亮 chip', () => {
    expect(boundColumnOf(undefined)).toBeUndefined()
    expect(boundColumnOf({ datasetId: 'd', path: '[].order_no' })).toBe('order_no')
    expect(boundColumnOf({ datasetId: 'd', path: '[0].qty' })).toBe('qty')
    expect(boundColumnOf({ datasetId: 'd', path: '[0].items[].price' })).toBeUndefined()
    expect(boundColumnOf({ datasetId: 'd', path: 'customer.name' })).toBeUndefined()
  })
})
