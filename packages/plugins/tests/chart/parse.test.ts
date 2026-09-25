// 单元格图表声明解析单测：四类声明规范化 + 非法声明显式容错（不抛裸异常）。

import { describe, expect, it } from 'vitest'

import { parseChartDeclaration } from '../../src/chart/parse'
import type { ChartParseResult } from '../../src/chart/types'

/** 断言解析失败并返回原因（收窄 + 取值一步完成，避免条件式 expect） */
function expectInvalid(result: ChartParseResult): string {
  expect(result.ok).toBe(false)
  return result.ok ? '' : result.reason
}

describe('parseChartDeclaration 四类声明规范化', () => {
  it('柱状图：labels + 多数据集 → bar spec', () => {
    const result = parseChartDeclaration({
      type: 'bar',
      labels: ['Q1', 'Q2', 'Q3'],
      datasets: [
        { label: '收入', data: [10, 20, 30] },
        { label: '成本', data: [5, 8, 12] },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.type).toBe('bar')
    expect(result.spec.labels).toEqual(['Q1', 'Q2', 'Q3'])
    expect(result.spec.datasets).toEqual([
      { label: '收入', data: [10, 20, 30], fill: false },
      { label: '成本', data: [5, 8, 12], fill: false },
    ])
  })

  it('折线图：缺省 labels → null（按数据序号）', () => {
    const result = parseChartDeclaration({
      type: 'line',
      datasets: [{ data: [1, null, 3] }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.type).toBe('line')
    expect(result.spec.labels).toBeNull()
    expect(result.spec.datasets[0]?.label).toBe('')
    expect(result.spec.datasets[0]?.data).toEqual([1, null, 3])
  })

  it('面积图：归一为 line + fill', () => {
    const result = parseChartDeclaration({
      type: 'area',
      labels: ['a', 'b'],
      datasets: [{ label: 42, data: [1.5, 2.5] }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.type).toBe('line')
    expect(result.spec.datasets[0]?.fill).toBe(true)
    expect(result.spec.datasets[0]?.label).toBe('42')
  })

  it('饼图：只保留第一个数据集', () => {
    const result = parseChartDeclaration({
      type: 'pie',
      labels: ['直接', '间接'],
      datasets: [
        { label: '占比', data: [60, 40] },
        { label: '多余', data: [1, 2] },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.type).toBe('pie')
    expect(result.spec.datasets).toHaveLength(1)
    expect(result.spec.datasets[0]?.data).toEqual([60, 40])
    expect(result.spec.datasets[0]?.fill).toBe(false)
  })

  it('labels 空数组归一为 null；null 标签落空串占位', () => {
    const result = parseChartDeclaration({
      type: 'bar',
      labels: ['x', null],
      datasets: [{ data: [1, 2] }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.labels).toEqual(['x', ''])
  })
})

describe('parseChartDeclaration 非法声明容错', () => {
  it('非对象声明返回 ok:false 并给出原因', () => {
    for (const bad of [null, undefined, 42, 'bar', true, [], [{ type: 'bar' }]]) {
      expect(expectInvalid(parseChartDeclaration(bad))).toContain('图表声明必须是对象')
    }
  })

  it('类型缺失或未知返回 ok:false', () => {
    expect(parseChartDeclaration({ datasets: [{ data: [1] }] }).ok).toBe(false)
    const unknown = parseChartDeclaration({ type: 'radar', datasets: [{ data: [1] }] })
    expect(expectInvalid(unknown)).toContain('图表类型非法')
  })

  it('datasets 缺省/空/非数组返回 ok:false', () => {
    expect(parseChartDeclaration({ type: 'bar' }).ok).toBe(false)
    expect(parseChartDeclaration({ type: 'bar', datasets: [] }).ok).toBe(false)
    expect(parseChartDeclaration({ type: 'bar', datasets: 'nope' }).ok).toBe(false)
  })

  it('数据集非对象或 data 非数组返回 ok:false', () => {
    expect(parseChartDeclaration({ type: 'bar', datasets: [42] }).ok).toBe(false)
    expect(parseChartDeclaration({ type: 'bar', datasets: [{ data: '1,2' }] }).ok).toBe(false)
  })

  it('数据点非有限数值返回 ok:false（字符串数字不隐式转换）', () => {
    for (const point of ['3', NaN, Infinity, -Infinity, undefined, {}]) {
      const result = parseChartDeclaration({ type: 'bar', datasets: [{ data: [point] }] })
      expect(expectInvalid(result)).toContain('数据点必须是有限数值或 null')
    }
  })

  it('labels 非数组返回 ok:false', () => {
    const result = parseChartDeclaration({
      type: 'line',
      labels: 'a,b',
      datasets: [{ data: [1] }],
    })
    expect(expectInvalid(result)).toContain('labels 必须是数组')
  })

  it('任意垃圾输入不抛裸异常（只返回 ok:false）', () => {
    const garbage: unknown[] = [
      new Date(),
      () => 'bar',
      Symbol('x'),
      { type: 'bar', datasets: [{ data: [1] }, 'junk'] },
      { type: 'pie', labels: {}, datasets: [{ data: [{ v: 1 }] }] },
    ]
    for (const input of garbage) {
      expect(() => parseChartDeclaration(input)).not.toThrow()
    }
  })
})
