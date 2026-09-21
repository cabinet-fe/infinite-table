// 逻辑函数：IF（短路）/ AND / OR / NOT / XOR / IFERROR / TRUE / FALSE

import { describe, expect, it } from 'vitest'

import { evaluate } from '../../src/index'
import { EMPTY_RESOLVER, createFakeResolver } from '../testing/fake-resolver'

describe('IF（lazy 短路）', () => {
  it('按条件取分支；未选分支的错误不产生', () => {
    expect(evaluate('IF(TRUE, 1, 2)', EMPTY_RESOLVER)).toBe(1)
    expect(evaluate('IF(FALSE, 1, 2)', EMPTY_RESOLVER)).toBe(2)
    expect(evaluate('IF(FALSE, 1/0, 2)', EMPTY_RESOLVER)).toBe(2)
    expect(evaluate('IF(1=1, "是", "否")', EMPTY_RESOLVER)).toBe('是')
  })

  it('省略第三参：条件假 → FALSE；条件强转（数字≠0 为真）', () => {
    expect(evaluate('IF(0, 1)', EMPTY_RESOLVER)).toBe(false)
    expect(evaluate('IF(2, 1)', EMPTY_RESOLVER)).toBe(1)
  })

  it('条件错误传播', () => {
    expect(evaluate('IF(1/0, 1, 2)', EMPTY_RESOLVER)).toMatchObject({ code: '#DIV/0!' })
  })
})

describe('AND / OR / NOT / XOR', () => {
  it('常规真值语义', () => {
    expect(evaluate('AND(TRUE, 1, "TRUE")', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('AND(TRUE, FALSE)', EMPTY_RESOLVER)).toBe(false)
    expect(evaluate('OR(FALSE, 0, 3)', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('OR(FALSE, 0)', EMPTY_RESOLVER)).toBe(false)
    expect(evaluate('NOT(TRUE)', EMPTY_RESOLVER)).toBe(false)
    expect(evaluate('NOT(0)', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('XOR(TRUE, FALSE, TRUE)', EMPTY_RESOLVER)).toBe(false)
    expect(evaluate('XOR(TRUE, FALSE)', EMPTY_RESOLVER)).toBe(true)
  })

  it('区域内只取布尔格；无布尔 → #VALUE!', () => {
    const resolver = createFakeResolver({ Sheet1: { A1: true, A2: 5, A3: 'x' } })
    expect(evaluate('AND(A1:A3)', resolver)).toBe(true)
    expect(evaluate('AND(A2:A3)', resolver)).toMatchObject({ code: '#VALUE!' })
  })

  it('非法文本强转布尔 → #VALUE!', () => {
    expect(evaluate('AND("x")', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('NOT("x")', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
  })
})

describe('IFERROR / TRUE / FALSE', () => {
  it('IFERROR：错误（含 #N/A）回落替代值；非错误透传', () => {
    expect(evaluate('IFERROR(1/0, "兜底")', EMPTY_RESOLVER)).toBe('兜底')
    expect(evaluate('IFERROR(#N/A, 7)', EMPTY_RESOLVER)).toBe(7)
    expect(evaluate('IFERROR(42, "兜底")', EMPTY_RESOLVER)).toBe(42)
  })

  it('TRUE()/FALSE() 字面函数', () => {
    expect(evaluate('TRUE()', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('FALSE()', EMPTY_RESOLVER)).toBe(false)
    expect(evaluate('IF(TRUE(), 1, 0)', EMPTY_RESOLVER)).toBe(1)
  })
})
