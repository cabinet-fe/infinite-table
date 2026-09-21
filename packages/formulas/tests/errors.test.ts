// 错误值体系：7 种错误码 / 标记构造与判定

import { describe, expect, it } from 'vitest'

import { FORMULA_ERROR_CODES, formulaError, isFormulaError, isFormulaErrorCode } from '../src/index'

describe('错误值体系', () => {
  it('7 种错误码枚举齐全', () => {
    expect([...FORMULA_ERROR_CODES]).toEqual([
      '#DIV/0!',
      '#VALUE!',
      '#NAME?',
      '#REF!',
      '#N/A',
      '#ERROR!',
      '#CYCLE!',
    ])
  })

  it('formulaError / isFormulaError / isFormulaErrorCode', () => {
    const error = formulaError('#REF!')
    expect(error.code).toBe('#REF!')
    expect(isFormulaError(error)).toBe(true)
    expect(isFormulaError({ code: '#REF!' })).toBe(false) // 无品牌标记
    expect(isFormulaError(null)).toBe(false)
    expect(isFormulaError('#REF!')).toBe(false)
    expect(isFormulaErrorCode('#CYCLE!')).toBe(true)
    expect(isFormulaErrorCode('#FOO')).toBe(false)
    expect(isFormulaErrorCode(42)).toBe(false)
  })
})
