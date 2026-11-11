// 聚合执行器测试：按声明序求值、多数据集形参注入、函数体（多语句 + return）求值、
// 后序聚合经 agg 访问前序结果、未取数的数据集按空数组入参、错误带「聚合「名」」前缀；
// 空数据试跑（probeAggregationType）：返回形态判定（array/value）、抛错与防御式写法引导。
import { describe, expect, test } from 'vitest'

import { probeAggregationType, runAggregations } from '../../src/domain/aggregation'
import type { FormAggregation } from '../../src/shared/template-schema'

const ORDERS = [
  { no: 'A', customer: '甲' },
  { no: 'B', customer: '乙' },
]
const LINES = [
  { no: 'A', qty: 2 },
  { no: 'A', qty: 1 },
  { no: 'B', qty: 5 },
]

const rowsByDataset = new Map<string, typeof ORDERS | typeof LINES>([
  ['orders', ORDERS],
  ['lines', LINES],
])

describe('runAggregations', () => {
  test('多数据集形参注入：形参名收各自的原始行数组', () => {
    const aggregations: FormAggregation[] = [
      {
        name: 'totals',
        type: 'value',
        params: [
          { datasetId: 'orders', varName: 'o' },
          { datasetId: 'lines', varName: 'l' },
        ],
        expression: 'return { orders: o.length, qty: l.reduce((t, r) => t + r.qty, 0) }',
      },
    ]
    expect(runAggregations(aggregations, rowsByDataset)).toEqual({ totals: { orders: 2, qty: 8 } })
  })

  test('函数体支持多语句（for 循环 + return）', () => {
    const aggregations: FormAggregation[] = [
      {
        name: 'byNo',
        type: 'value',
        params: [{ datasetId: 'lines', varName: 'l' }],
        expression:
          'const groups = {}\nfor (const r of l) (groups[r.no] ??= []).push(r)\nreturn groups',
      },
    ]
    expect(runAggregations(aggregations, rowsByDataset)).toEqual({
      byNo: {
        A: [
          { no: 'A', qty: 2 },
          { no: 'A', qty: 1 },
        ],
        B: [{ no: 'B', qty: 5 }],
      },
    })
  })

  test('按声明序求值：后序聚合经 agg 访问前序结果（链式加工）', () => {
    const aggregations: FormAggregation[] = [
      {
        name: 'byOrder',
        type: 'value',
        params: [{ datasetId: 'lines', varName: 'l' }],
        expression: 'return Object.groupBy(l, (r) => r.no)',
      },
      {
        name: 'orderCount',
        type: 'value',
        params: [],
        expression: 'return Object.keys(agg.byOrder).length',
      },
    ]
    const agg = runAggregations(aggregations, rowsByDataset)
    expect(agg.orderCount).toBe(2)
    expect((agg.byOrder as Record<string, unknown[]>)['A']).toHaveLength(2)
  })

  test('未取数的数据集按空数组入参（形状契约稳定）', () => {
    const aggregations: FormAggregation[] = [
      {
        name: 'n',
        type: 'value',
        params: [{ datasetId: 'missing', varName: 'r' }],
        expression: 'return r.length',
      },
    ]
    expect(runAggregations(aggregations, new Map())).toEqual({ n: 0 })
  })

  test('错误带聚合名前缀，快速定位', () => {
    const aggregations: FormAggregation[] = [
      {
        name: 'bad',
        type: 'value',
        params: [],
        expression: 'return null.x',
      },
    ]
    expect(() => runAggregations(aggregations, new Map())).toThrow('聚合「bad」')
  })
})

describe('probeAggregationType（空数据试跑）', () => {
  test('每个入参数据集传 []、agg 传 {}：返回数组 → array，其余（对象/数字/undefined）→ value', () => {
    expect(probeAggregationType([{ varName: 'l' }], 'return l')).toEqual({
      ok: true,
      returns: 'array',
    })
    expect(probeAggregationType([{ varName: 'l' }], 'return l.filter((r) => r.qty > 1)')).toEqual({
      ok: true,
      returns: 'array',
    })
    expect(probeAggregationType([{ varName: 'l' }], 'return { n: l.length }')).toEqual({
      ok: true,
      returns: 'value',
    })
    expect(
      probeAggregationType([{ varName: 'l' }], 'return l.reduce((t, r) => t + r.qty, 0)'),
    ).toEqual({
      ok: true,
      returns: 'value',
    })
    expect(probeAggregationType([{ varName: 'l' }], 'return l[0]')).toEqual({
      ok: true,
      returns: 'value',
    })
    expect(probeAggregationType([], 'return agg')).toEqual({ ok: true, returns: 'value' })
  })

  test('多入参按序注入空数组（形参名各自生效）', () => {
    expect(
      probeAggregationType([{ varName: 'o' }, { varName: 'l' }], 'return o.length + l.length'),
    ).toEqual({ ok: true, returns: 'value' })
  })

  test('链式引用在空 agg 下抛错：ok false，原因带相位且引导防御式写法', () => {
    const probe = probeAggregationType([], "return agg.台账['x']")
    expect(probe).toMatchObject({ ok: false })
    if (probe.ok) throw new Error('应失败但成功')
    expect(probe.error).toContain('求值失败')
    expect(probe.error).toContain('防御式')
    expect(probe.error).toContain("(agg.台账 ?? {})['x'] ?? 0")
  })

  test('防御式写法通过空数据试跑（链式引用不断链）', () => {
    expect(probeAggregationType([], "return (agg.台账 ?? {})['x'] ?? 0")).toEqual({
      ok: true,
      returns: 'value',
    })
    expect(probeAggregationType([], 'return (agg.台账 ?? []).slice(0, 1)')).toEqual({
      ok: true,
      returns: 'array',
    })
  })

  test('语法错误归类为编译失败（不带防御式引导）', () => {
    const probe = probeAggregationType([{ varName: 'l' }], 'return l.filter((')
    expect(probe).toMatchObject({ ok: false })
    if (probe.ok) throw new Error('应失败但成功')
    expect(probe.error).toContain('编译失败')
    expect(probe.error).not.toContain('防御式')
  })
})
