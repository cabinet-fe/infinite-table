// 日期与时间函数：TODAY / NOW（1900 系统序列数，易失）

import { describe, expect, it } from 'vitest'

import { evaluate, isVolatileFormulaFunction } from '../../src/index'
import { EMPTY_RESOLVER } from '../testing/fake-resolver'

describe('TODAY / NOW', () => {
  it('TODAY 返回当日整数序列数（含伪闰日修正，远大于 40000）', () => {
    const today = evaluate('TODAY()', EMPTY_RESOLVER)
    expect(typeof today).toBe('number')
    expect(Number.isInteger(today as number)).toBe(true)
    expect(today as number).toBeGreaterThan(40000)
  })

  it('NOW 含时间小数部分且 ≥ TODAY', () => {
    const now = evaluate('NOW()', EMPTY_RESOLVER)
    const today = evaluate('TODAY()', EMPTY_RESOLVER)
    expect(typeof now).toBe('number')
    expect(now as number).toBeGreaterThanOrEqual(today as number)
    expect(now as number).toBeLessThan((today as number) + 1)
  })

  it('易失性标记可查询', () => {
    expect(isVolatileFormulaFunction('today')).toBe(true)
    expect(isVolatileFormulaFunction('NOW')).toBe(true)
  })
})
