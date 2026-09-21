// 统计函数：AVERAGE / MAX / MIN / COUNT / COUNTA / COUNTIF / COUNTBLANK / MEDIAN / LARGE / SMALL / RANK

import { describe, expect, it } from 'vitest'

import { evaluate } from '../../src/index'
import { EMPTY_RESOLVER, createFakeResolver } from '../testing/fake-resolver'

// A1:B2 = 1, 10 / 2, 20（先行后列）；A3=3；A4='文本'
const DATA = createFakeResolver({
  Sheet1: { A1: 1, A2: 2, A3: 3, A4: '文本', B1: 10, B2: 20 },
})

describe('聚合（AVERAGE/MAX/MIN/COUNT/COUNTA）', () => {
  it('AVERAGE：精确除法；空集 → #DIV/0!', () => {
    expect(evaluate('AVERAGE(A1:A3)', DATA)).toBe(2)
    expect(evaluate('AVERAGE(0.1, 0.2)', EMPTY_RESOLVER)).toBe(0.15)
    expect(evaluate('AVERAGE(C1:C3)', DATA)).toMatchObject({ code: '#DIV/0!' })
  })

  it('MAX/MIN：空集为 0；区域内文本忽略', () => {
    expect(evaluate('MAX(A1:A4)', DATA)).toBe(3)
    expect(evaluate('MIN(A1:A4)', DATA)).toBe(1)
    expect(evaluate('MAX(C1:C2)', DATA)).toBe(0)
    expect(evaluate('MIN(C1:C2)', DATA)).toBe(0)
  })

  it('COUNT：只计数字（区域内文本/布尔忽略；直接参数可强转即计）', () => {
    expect(evaluate('COUNT(A1:A4)', DATA)).toBe(3)
    expect(evaluate('COUNT(1, "2", "x", TRUE)', EMPTY_RESOLVER)).toBe(3)
  })

  it('COUNTA：非空即计（含区域内文本）', () => {
    expect(evaluate('COUNTA(A1:A4)', DATA)).toBe(4)
    expect(evaluate('COUNTA(A1:C2)', DATA)).toBe(4)
  })
})

describe('条件与次序统计', () => {
  it('COUNTIF：数值比较 / 文本相等不区分大小写 / 布尔 / 运算符前缀', () => {
    expect(evaluate('COUNTIF(A1:B2, ">2")', DATA)).toBe(2) // 10, 20
    expect(evaluate('COUNTIF(A1:A4, "文本")', DATA)).toBe(1)
    expect(evaluate('COUNTIF(A1:A4, ">=2")', DATA)).toBe(2)
    expect(evaluate('COUNTIF(A1:A4, "<>1")', DATA)).toBe(2) // 2, 3（文本不参与数值 criteria）
    const bools = createFakeResolver({ Sheet1: { A1: true, A2: false } })
    expect(evaluate('COUNTIF(A1:A2, TRUE)', bools)).toBe(1)
  })

  it('COUNTBLANK：按区域几何推算空白（含未存储格）', () => {
    expect(evaluate('COUNTBLANK(A1:C2)', DATA)).toBe(2) // C1/C2 空
    expect(evaluate('COUNTBLANK(D5)', DATA)).toBe(1)
    expect(evaluate('COUNTBLANK(1+1)', DATA)).toMatchObject({ code: '#VALUE!' })
  })

  it('MEDIAN：奇数取中位，偶数取中间两数均值（精确）；空集 → #VALUE!', () => {
    expect(evaluate('MEDIAN(3, 1, 2)', EMPTY_RESOLVER)).toBe(2)
    expect(evaluate('MEDIAN(0.1, 0.2)', EMPTY_RESOLVER)).toBe(0.15)
    expect(evaluate('MEDIAN(C1:C2)', DATA)).toMatchObject({ code: '#VALUE!' })
  })

  it('LARGE/SMALL：第 k 个极值；k 越界 → #VALUE!', () => {
    expect(evaluate('LARGE(A1:B2, 2)', DATA)).toBe(10)
    expect(evaluate('SMALL(A1:B2, 1)', DATA)).toBe(1)
    expect(evaluate('LARGE(A1:B2, 99)', DATA)).toMatchObject({ code: '#VALUE!' })
  })

  it('RANK：竞赛排名（同值同名次）；order 非 0 升序；不在集合 → #N/A', () => {
    const tied = createFakeResolver({ Sheet1: { A1: 10, A2: 30, A3: 20, A4: 30 } })
    expect(evaluate('RANK(30, A1:A4)', tied)).toBe(1)
    expect(evaluate('RANK(20, A1:A4)', tied)).toBe(3)
    expect(evaluate('RANK(30, A1:A4, 1)', tied)).toBe(3)
    expect(evaluate('RANK(99, A1:A4)', tied)).toMatchObject({ code: '#N/A' })
  })
})
