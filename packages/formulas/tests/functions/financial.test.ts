// 财务函数：PMT / FV / PV / IPMT / PPMT（等额年金，Excel 符号约定）

import { describe, expect, it } from 'vitest'

import { evaluate } from '../../src/index'
import { EMPTY_RESOLVER } from '../testing/fake-resolver'

describe('财务函数', () => {
  it('PMT：等额分期付款额（Excel 对齐值）', () => {
    const pmt = evaluate('PMT(0.05/12, 36, 10000)', EMPTY_RESOLVER)
    expect(pmt).toBeCloseTo(-299.7089710466537, 9)
    // rate=0 退化：-(pv+fv)/nper
    expect(evaluate('PMT(0, 10, 1000)', EMPTY_RESOLVER)).toBe(-100)
    // nper=0 且 rate=0 → #DIV/0!
    expect(evaluate('PMT(0, 0, 1000)', EMPTY_RESOLVER)).toMatchObject({ code: '#DIV/0!' })
  })

  it('FV：年金终值；rate=0 退化', () => {
    // -(pv·(1+r)^n + pmt·((1+r)^n-1)/r)：r=0 → -(pv + pmt·n)
    expect(evaluate('FV(0, 10, -100, -1000)', EMPTY_RESOLVER)).toBe(2000)
    const fv = evaluate('FV(0.05/12, 36, -299.7089710466537, 10000)', EMPTY_RESOLVER)
    expect(fv).toBeCloseTo(0, 4)
  })

  it('PV：年金现值；rate=0 退化', () => {
    expect(evaluate('PV(0, 10, -100, -1000)', EMPTY_RESOLVER)).toBe(2000)
    const pv = evaluate('PV(0.05/12, 36, -299.7089710466537)', EMPTY_RESOLVER)
    expect(pv).toBeCloseTo(10000, 4)
  })

  it('IPMT/PPMT：首期利息 = -pv·rate（期末付款）；本金 = PMT - 利息', () => {
    expect(evaluate('IPMT(0.1, 1, 10, 1000)', EMPTY_RESOLVER)).toBe(-100)
    const ipmt = evaluate('IPMT(0.05/12, 12, 36, 10000)', EMPTY_RESOLVER) as number
    const ppmt = evaluate('PPMT(0.05/12, 12, 36, 10000)', EMPTY_RESOLVER) as number
    const pmt = evaluate('PMT(0.05/12, 36, 10000)', EMPTY_RESOLVER) as number
    expect(ipmt + ppmt).toBeCloseTo(pmt, 9)
  })

  it('per 越界（1..nper 外）→ #VALUE!；type=1 首期无利息', () => {
    expect(evaluate('IPMT(0.1, 11, 10, 1000)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('IPMT(0.1, 0, 10, 1000)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('IPMT(0.1, 1, 10, 1000, 0, 1)', EMPTY_RESOLVER)).toBe(0)
  })
})
