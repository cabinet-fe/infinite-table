// 页眉页脚单测（P2 headless）：三段式渲染 + 占位符求值（页码/共 N 页/日期/时间/标题
// 与页级聚合 pageSum/pageAvg/pageMax/pageMin），未识别占位符原样保留。零 DOM。

import { describe, expect, it } from 'vitest'

import {
  evaluatePlaceholders,
  renderHeaderFooter,
  type PlaceholderContext,
} from '../../src/print/header-footer'

/** 固定上下文工厂（date/time 注入固定文本，断言确定性） */
function makeContext(overrides?: Partial<PlaceholderContext>): PlaceholderContext {
  return {
    page: 2,
    pageCount: 5,
    title: '销售明细',
    date: '2026-10-06',
    time: '14:30',
    columnNumbers: (col) => (col === 1 ? [10, 20, 30, 40] : col === 2 ? [0.1, 0.2] : []),
    ...overrides,
  }
}

describe('evaluatePlaceholders：基础占位符', () => {
  it('{page}/{pageCount}/{date}/{time}/{title} 逐项替换', () => {
    const ctx = makeContext()
    expect(evaluatePlaceholders('第 {page} 页', ctx)).toBe('第 2 页')
    expect(evaluatePlaceholders('共 {pageCount} 页', ctx)).toBe('共 5 页')
    expect(evaluatePlaceholders('{date} {time}', ctx)).toBe('2026-10-06 14:30')
    expect(evaluatePlaceholders('报表：{title}', ctx)).toBe('报表：销售明细')
  })

  it('混合文案一次替换全部占位符', () => {
    expect(evaluatePlaceholders('{title} — 第 {page} 页 / 共 {pageCount} 页', makeContext())).toBe(
      '销售明细 — 第 2 页 / 共 5 页',
    )
  })
})

describe('evaluatePlaceholders：页级聚合', () => {
  it('pageSum/pageAvg/pageMax/pageMin 对页内列数值求值', () => {
    const ctx = makeContext()
    expect(evaluatePlaceholders('小计 {pageSum:1}', ctx)).toBe('小计 100')
    expect(evaluatePlaceholders('均价 {pageAvg:1}', ctx)).toBe('均价 25')
    expect(evaluatePlaceholders('最大 {pageMax:1}', ctx)).toBe('最大 40')
    expect(evaluatePlaceholders('最小 {pageMin:1}', ctx)).toBe('最小 10')
  })

  it('浮点累加尾差消除：0.1 + 0.2 = 0.3', () => {
    expect(evaluatePlaceholders('{pageSum:2}', makeContext())).toBe('0.3')
  })

  it('空数值列：sum 出 0，avg/max/min 出空串', () => {
    const ctx = makeContext()
    expect(evaluatePlaceholders('[{pageSum:0}]', ctx)).toBe('[0]')
    expect(evaluatePlaceholders('[{pageAvg:0}]', ctx)).toBe('[]')
    expect(evaluatePlaceholders('[{pageMax:0}]', ctx)).toBe('[]')
    expect(evaluatePlaceholders('[{pageMin:0}]', ctx)).toBe('[]')
  })
})

describe('evaluatePlaceholders：未识别占位符原样保留', () => {
  it('未知名与非法聚合参数不替换', () => {
    const text = '{foo} {pageSum} {pageSum:abc} {pageSum:-1} {PAGE} {}'
    expect(evaluatePlaceholders(text, makeContext())).toBe(text)
  })
})

describe('renderHeaderFooter：三段式渲染', () => {
  it('left/center/right 三段各占一格，占位符先求值再转义', () => {
    const html = renderHeaderFooter(
      { left: '{title}', center: '第 {page} 页 / 共 {pageCount} 页', right: '{date} <b>粗体</b>' },
      makeContext(),
      'footer',
    )
    expect(html).toContain('<table class="print-footer">')
    expect(html).toContain('<td class="hf-left">销售明细</td>')
    expect(html).toContain('<td class="hf-center">第 2 页 / 共 5 页</td>')
    expect(html).toContain('&lt;b&gt;粗体&lt;/b&gt;')
  })

  it('section 为 null/undefined 返回空串', () => {
    expect(renderHeaderFooter(null, makeContext(), 'header')).toBe('')
    expect(renderHeaderFooter(undefined, makeContext(), 'header')).toBe('')
  })
})
