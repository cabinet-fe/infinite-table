// 文本函数：CONCATENATE / LEN / LEFT / RIGHT / MID / UPPER / LOWER / TRIM / EXACT / SUBSTITUTE / REPLACE

import { describe, expect, it } from 'vitest'

import { evaluate } from '../../src/index'
import { EMPTY_RESOLVER, createFakeResolver } from '../testing/fake-resolver'

describe('拼接与长度', () => {
  it('CONCATENATE：多参连接（数字/布尔强转文本；区域逐格）', () => {
    expect(evaluate('CONCATENATE("a", "b", 1, TRUE)', EMPTY_RESOLVER)).toBe('ab1TRUE')
    const resolver = createFakeResolver({ Sheet1: { A1: 'x', A2: 'y' } })
    expect(evaluate('CONCATENATE(A1:A2, "!")', resolver)).toBe('xy!')
  })

  it('LEN：字符个数（数字转文本）', () => {
    expect(evaluate('LEN("hello")', EMPTY_RESOLVER)).toBe(5)
    expect(evaluate('LEN(123)', EMPTY_RESOLVER)).toBe(3)
    expect(evaluate('LEN("")', EMPTY_RESOLVER)).toBe(0)
  })
})

describe('截取（LEFT/RIGHT/MID）', () => {
  it('LEFT/RIGHT：缺省 1 个字符；count<0 → #VALUE!；超出长度取全串', () => {
    expect(evaluate('LEFT("hello")', EMPTY_RESOLVER)).toBe('h')
    expect(evaluate('LEFT("hello", 2)', EMPTY_RESOLVER)).toBe('he')
    expect(evaluate('RIGHT("hello", 2)', EMPTY_RESOLVER)).toBe('lo')
    expect(evaluate('LEFT("hi", 99)', EMPTY_RESOLVER)).toBe('hi')
    expect(evaluate('RIGHT("hi", 99)', EMPTY_RESOLVER)).toBe('hi')
    expect(evaluate('LEFT("hello", -1)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('RIGHT("hello", -1)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
  })

  it('MID：1 基起点；start<1 或 count<0 → #VALUE!', () => {
    expect(evaluate('MID("hello", 2, 3)', EMPTY_RESOLVER)).toBe('ell')
    expect(evaluate('MID("hello", 4, 99)', EMPTY_RESOLVER)).toBe('lo')
    expect(evaluate('MID("hello", 0, 1)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('MID("hello", 1, -1)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
  })
})

describe('大小写与比较', () => {
  it('UPPER / LOWER / TRIM / EXACT', () => {
    expect(evaluate('UPPER("aBc")', EMPTY_RESOLVER)).toBe('ABC')
    expect(evaluate('LOWER("aBc")', EMPTY_RESOLVER)).toBe('abc')
    expect(evaluate('TRIM("  a   b  ")', EMPTY_RESOLVER)).toBe('a b')
    expect(evaluate('EXACT("Abc", "Abc")', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('EXACT("Abc", "abc")', EMPTY_RESOLVER)).toBe(false)
  })
})

describe('替换（SUBSTITUTE/REPLACE）', () => {
  it('SUBSTITUTE：缺省全替换；指定第几次出现；不出现原样返回；old 为空原样返回', () => {
    expect(evaluate('SUBSTITUTE("a-b-a", "a", "x")', EMPTY_RESOLVER)).toBe('x-b-x')
    expect(evaluate('SUBSTITUTE("a-b-a", "a", "x", 2)', EMPTY_RESOLVER)).toBe('a-b-x')
    expect(evaluate('SUBSTITUTE("a-b-a", "a", "x", 9)', EMPTY_RESOLVER)).toBe('a-b-a')
    expect(evaluate('SUBSTITUTE("abc", "", "x")', EMPTY_RESOLVER)).toBe('abc')
    expect(evaluate('SUBSTITUTE("abc", "b", "x", 0)', EMPTY_RESOLVER)).toMatchObject({
      code: '#VALUE!',
    })
  })

  it('REPLACE：按位置替换；start<1 或 count<0 → #VALUE!', () => {
    expect(evaluate('REPLACE("hello", 2, 3, "EL")', EMPTY_RESOLVER)).toBe('hELo')
    expect(evaluate('REPLACE("hello", 1, 0, ">>")', EMPTY_RESOLVER)).toBe('>>hello')
    expect(evaluate('REPLACE("hello", 0, 1, "x")', EMPTY_RESOLVER)).toMatchObject({
      code: '#VALUE!',
    })
  })
})
