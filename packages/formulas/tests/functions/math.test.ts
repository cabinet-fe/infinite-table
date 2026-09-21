// 数学函数：SUM / ROUND / ABS / RAND / RANDBETWEEN（精确计算对齐 @cat-kit/core）

import { describe, expect, it } from 'vitest'

import { evaluate } from '../../src/index'
import { EMPTY_RESOLVER, createFakeResolver } from '../testing/fake-resolver'

const DATA = createFakeResolver({
  Sheet1: { A1: 1, A2: 2, A3: 3, A4: '文本', B1: 10, B2: 20 },
})

describe('SUM', () => {
  it('区域忽略文本与空格；直接参数强转', () => {
    expect(evaluate('SUM(A1:A4)', DATA)).toBe(6)
    expect(evaluate('SUM(1, "2", TRUE)', EMPTY_RESOLVER)).toBe(4)
    expect(evaluate('SUM(A1:B2)', DATA)).toBe(33)
  })

  it('精确累加（0.1+0.2 观感）', () => {
    expect(evaluate('SUM(0.1, 0.2)', EMPTY_RESOLVER)).toBe(0.3)
  })

  it('区域内错误格传播', () => {
    expect(evaluate('SUM(A1, 1/0)', DATA)).toMatchObject({ code: '#DIV/0!' })
  })
})

describe('ROUND', () => {
  it('半进位精确（1.005→1.01）；负数向远离零进位', () => {
    expect(evaluate('ROUND(1.005, 2)', EMPTY_RESOLVER)).toBe(1.01)
    expect(evaluate('ROUND(2.5, 0)', EMPTY_RESOLVER)).toBe(3)
    expect(evaluate('ROUND(-2.5, 0)', EMPTY_RESOLVER)).toBe(-3)
  })

  it('负位数 / 超精度恒等 / 位数截断', () => {
    expect(evaluate('ROUND(1234, -2)', EMPTY_RESOLVER)).toBe(1200)
    expect(evaluate('ROUND(1.23, 99)', EMPTY_RESOLVER)).toBe(1.23)
    expect(evaluate('ROUND(2.567, 1.9)', EMPTY_RESOLVER)).toBe(2.6)
  })
})

describe('ABS', () => {
  it('精确取绝对值', () => {
    expect(evaluate('ABS(-3)', EMPTY_RESOLVER)).toBe(3)
    expect(evaluate('ABS(0.1-0.3)', EMPTY_RESOLVER)).toBe(0.2)
    expect(evaluate('ABS(0)', EMPTY_RESOLVER)).toBe(0)
  })
})

describe('RAND / RANDBETWEEN（易失）', () => {
  it('RAND 落在 [0,1)', () => {
    for (let index = 0; index < 20; index++) {
      const value = evaluate('RAND()', EMPTY_RESOLVER)
      expect(typeof value).toBe('number')
      expect(value as number).toBeGreaterThanOrEqual(0)
      expect(value as number).toBeLessThan(1)
    }
  })

  it('RANDBETWEEN：闭区间整数；lo>hi → #VALUE!；非整数截断', () => {
    for (let index = 0; index < 20; index++) {
      const between = evaluate('RANDBETWEEN(1, 6)', EMPTY_RESOLVER) as number
      expect(Number.isInteger(between)).toBe(true)
      expect(between).toBeGreaterThanOrEqual(1)
      expect(between).toBeLessThanOrEqual(6)
    }
    expect(evaluate('RANDBETWEEN(6, 1)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('RANDBETWEEN(1.9, 1.1)', EMPTY_RESOLVER)).toBe(1)
  })
})
