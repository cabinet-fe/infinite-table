import { describe, expect, it } from 'vitest'

import { createFormulaDisplay } from '../../src/sheet/formula-display'

describe('createFormulaDisplay 公式感知显示', () => {
  it('非公式值复刻管线缺省渲染（null→空串、原样字符串化）', () => {
    const display = createFormulaDisplay({ evaluate: () => 'x' })
    expect(display(0, 0, 42)).toBe('42')
    expect(display(0, 0, 'plain')).toBe('plain')
    expect(display(0, 0, undefined)).toBe('')
    expect(display(0, 0, null)).toBe('')
  })

  it('公式值经求值器渲染；数值结果转字符串', () => {
    const display = createFormulaDisplay({ evaluate: (formula) => (formula === 'A1+1' ? 3 : null) })
    expect(display(0, 0, '=A1+1')).toBe('3')
    expect(display(0, 0, '=SUM(A:A)')).toBe('=SUM(A:A)')
  })

  it('未注入求值器 / 返回 null / 抛错：回落 = 原文', () => {
    const noEvaluator = createFormulaDisplay()
    expect(noEvaluator(0, 0, '=B2*2')).toBe('=B2*2')

    const nullResult = createFormulaDisplay({ evaluate: () => null })
    expect(nullResult(0, 0, '=B2*2')).toBe('=B2*2')

    const throwing = createFormulaDisplay({
      evaluate: () => {
        throw new Error('boom')
      },
    })
    expect(throwing(0, 0, '=B2*2')).toBe('=B2*2')
  })

  it('求值器收到公式体（不含 =）与目标格坐标', () => {
    const calls: [string, number, number][] = []
    const display = createFormulaDisplay({
      evaluate: (formula, col, row) => {
        calls.push([formula, col, row])
        return 'ok'
      },
    })
    expect(display(2, 5, '=X1')).toBe('ok')
    expect(calls).toEqual([['X1', 2, 5]])
  })
})
