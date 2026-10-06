// 打印分页引擎单测（P1 headless 内核）：fitpage 行区间 / 单行超高独占一页 / fixrows
// （含 headerRepeatRows=2 与末页补空行）/ 分组换页 / fit-width 缩放 / 纸张方向可用区域。
// 断言落在分页纯数据结果上（Page { rowRange, headerRows, blankRows, scale }），零 DOM。

import { describe, expect, it } from 'vitest'

import { derivePrintableArea, mmToPx, resolvePaperSizeMm } from '../../src/print/paper'
import { paginate, type PrintPage, type PrintRowRange } from '../../src/print/paginate'
import type { PrintConfig, PrintSource } from '../../src/print/types'

/** 测试数据源工厂：行高/列宽数组 + 行主序值矩阵（cellValue/displayValue 同源） */
function makeSource(options: {
  rowHeights: number[]
  colWidths: number[]
  values?: unknown[][]
}): PrintSource {
  const { rowHeights, colWidths, values = [] } = options
  return {
    name: '测试表',
    rowCount: rowHeights.length,
    colCount: colWidths.length,
    rowHeight: (row) => rowHeights[row] ?? 0,
    colWidth: (col) => colWidths[col] ?? 0,
    merges: () => [],
    cellValue: (col, row) => values[row]?.[col],
    cellStyle: () => undefined,
    displayValue: (col, row) => values[row]?.[col],
  }
}

/**
 * 固定测试纸张：254mm = 960px（96dpi 精确换算），边距 20px → 可用 920×920px。
 * 断言边界均留 ≥ 20px 余量，不受 mm→px 浮点尾差影响。
 */
const PAPER_254: PrintConfig = {
  paperSize: { widthMm: 254, heightMm: 254 },
  margin: 20,
}

/** 提取各页数据行区间，便于逐页断言 */
function rowRanges(pages: PrintPage[]): PrintRowRange[] {
  return pages.map((page) => page.rowRange)
}

/** 每页是否都带 [0, end) 的重复表头行区间 */
function everyPageHasHeader(pages: PrintPage[], end: number): boolean {
  return pages.every(
    (page) =>
      page.headerRows !== null && page.headerRows.start === 0 && page.headerRows.end === end,
  )
}

describe('derivePrintableArea：纸张 / 方向 / 边距 / 页眉页脚', () => {
  it('A 系列预设尺寸：A3 > A4 > A5（portrait 口径 mm）', () => {
    expect(resolvePaperSizeMm('A3', 'portrait')).toEqual({ widthMm: 297, heightMm: 420 })
    expect(resolvePaperSizeMm('A4', 'portrait')).toEqual({ widthMm: 210, heightMm: 297 })
    expect(resolvePaperSizeMm('A5', 'portrait')).toEqual({ widthMm: 148, heightMm: 210 })
    expect(resolvePaperSizeMm('Letter', 'portrait')).toEqual({ widthMm: 215.9, heightMm: 279.4 })
  })

  it('landscape 交换宽高：可用页宽变大、可用页高变小', () => {
    const portrait = derivePrintableArea({ paperSize: 'A4', orientation: 'portrait', margin: 20 })
    const landscape = derivePrintableArea({ paperSize: 'A4', orientation: 'landscape', margin: 20 })
    expect(landscape.pageWidth).toBeCloseTo(mmToPx(297))
    expect(landscape.pageHeight).toBeCloseTo(mmToPx(210))
    expect(landscape.width).toBeGreaterThan(portrait.width)
    expect(landscape.height).toBeLessThan(portrait.height)
  })

  it('mm→px 换算（96dpi）：Letter = 816×1056px', () => {
    const area = derivePrintableArea({ paperSize: 'Letter', margin: 0 })
    expect(area.pageWidth).toBeCloseTo(816)
    expect(area.pageHeight).toBeCloseTo(1056)
  })

  it('边距扣除：单值四边同距 / 四边独立 / 缺省回落 48px', () => {
    const single = derivePrintableArea({ paperSize: 'Letter', margin: 20 })
    expect(single.width).toBeCloseTo(816 - 40)
    const sides = derivePrintableArea({ paperSize: 'Letter', margin: { left: 30, right: 10 } })
    expect(sides.width).toBeCloseTo(816 - 40)
    expect(sides.margin.left).toBe(30)
    expect(sides.margin.top).toBe(48)
    const clamped = derivePrintableArea({ paperSize: 'Letter', margin: 5000 })
    expect(clamped.width).toBe(0)
    expect(clamped.height).toBe(0)
  })

  it('页眉页脚预留高：section 存在即预留 32px，显式高覆盖；可用页高随之收窄', () => {
    const none = derivePrintableArea({ paperSize: 'Letter', margin: 0 })
    const both = derivePrintableArea({
      paperSize: 'Letter',
      margin: 0,
      headerFooter: { header: { center: '标题' }, footer: { center: '页脚' } },
    })
    expect(both.height).toBeCloseTo(none.height - 64)
    expect(both.headerHeight).toBe(32)
    expect(both.footerHeight).toBe(32)
    const custom = derivePrintableArea({
      paperSize: 'Letter',
      margin: 0,
      headerFooter: { header: { center: '标题' }, headerHeight: 50 },
    })
    expect(custom.height).toBeCloseTo(none.height - 50 - 0)
    expect(custom.headerHeight).toBe(50)
  })

  it('非法纸张配置快速失败：未知预设 / 非正数自定义尺寸', () => {
    const unknownPreset = 'B5' as unknown as Parameters<typeof resolvePaperSizeMm>[0]
    expect(() => resolvePaperSizeMm(unknownPreset, 'portrait')).toThrow(/未知纸张预设/)
    expect(() => resolvePaperSizeMm({ widthMm: 0, heightMm: 100 }, 'portrait')).toThrow(/正数/)
  })
})

describe('paginate：fitpage 按行高累加分页', () => {
  it('行高累加至放不下即换页：920px 页高 × 100px 行高 = 每页 9 行', () => {
    const source = makeSource({
      rowHeights: Array.from({ length: 20 }, () => 100),
      colWidths: [100],
    })
    const pages = paginate(source, PAPER_254)
    expect(rowRanges(pages)).toEqual([
      { start: 0, end: 9 },
      { start: 9, end: 18 },
      { start: 18, end: 20 },
    ])
    expect(
      pages.every((page) => page.blankRows === 0 && page.scale === 1 && page.headerRows === null),
    ).toBe(true)
  })

  it('单行高超可用页高：该行独占一页按原样输出（不截断）', () => {
    const source = makeSource({ rowHeights: [500, 1300, 100], colWidths: [100] })
    const pages = paginate(source, PAPER_254)
    expect(rowRanges(pages)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ])
  })

  it('重复表头每页占高：表头 120px 后每页 8 个 90px 数据行，各页带表头行区间', () => {
    const source = makeSource({
      rowHeights: [120, ...Array.from({ length: 10 }, () => 90)],
      colWidths: [100],
    })
    const pages = paginate(source, { ...PAPER_254, headerRepeatRows: 1 })
    expect(rowRanges(pages)).toEqual([
      { start: 1, end: 9 },
      { start: 9, end: 11 },
    ])
    expect(everyPageHasHeader(pages, 1)).toBe(true)
  })

  it('空表（无数据行）返回空页列表', () => {
    const source = makeSource({ rowHeights: [120], colWidths: [100] })
    expect(paginate(source, { ...PAPER_254, headerRepeatRows: 1 })).toEqual([])
  })
})

describe('paginate：fixrows 固定行数分页', () => {
  const CONFIG: PrintConfig = { ...PAPER_254, paging: 'fixrows', fixRows: 5, headerRepeatRows: 2 }

  it('每页数据行数 = fixRows − headerRepeatRows；末页补空行；各页带表头区间', () => {
    const source = makeSource({
      rowHeights: Array.from({ length: 10 }, () => 28),
      colWidths: [100],
    })
    const pages = paginate(source, CONFIG)
    expect(pages).toHaveLength(3)
    expect(rowRanges(pages)).toEqual([
      { start: 2, end: 5 },
      { start: 5, end: 8 },
      { start: 8, end: 10 },
    ])
    expect(pages.map((page) => page.blankRows)).toEqual([0, 0, 1])
    expect(everyPageHasHeader(pages, 2)).toBe(true)
  })

  it('配置错误快速失败：fixRows 缺省 / ≤ headerRepeatRows', () => {
    const source = makeSource({ rowHeights: [28, 28, 28], colWidths: [100] })
    expect(() => paginate(source, { ...PAPER_254, paging: 'fixrows' })).toThrow(/fixRows/)
    expect(() =>
      paginate(source, { ...PAPER_254, paging: 'fixrows', fixRows: 2, headerRepeatRows: 2 }),
    ).toThrow(/必须大于/)
  })
})

describe('paginate：分组换页（groupBreakBy 与两模式正交）', () => {
  it('fitpage：列值变化处强制换页（单页本可容纳全部）', () => {
    const source = makeSource({
      rowHeights: Array.from({ length: 5 }, () => 100),
      colWidths: [100],
      values: [['A'], ['A'], ['B'], ['B'], ['C']],
    })
    const pages = paginate(source, { ...PAPER_254, groupBreakBy: 0 })
    expect(rowRanges(pages)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 5 },
    ])
  })

  it('fixrows：分组提前换页的中间页同样补空行，各页行数一致（套打行栅格）', () => {
    const source = makeSource({
      rowHeights: Array.from({ length: 5 }, () => 28),
      colWidths: [100],
      values: [['A'], ['A'], ['B'], ['B'], ['B']],
    })
    const pages = paginate(source, { ...PAPER_254, paging: 'fixrows', fixRows: 4, groupBreakBy: 0 })
    expect(pages).toHaveLength(2)
    expect(rowRanges(pages)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 5 },
    ])
    // 每页数据行 + 空行 = 配额 4：[2+2, 3+1]，两页行栅格一致
    expect(pages.map((page) => page.blankRows)).toEqual([2, 1])
  })

  it('多列分组键：任一列值变化即换页', () => {
    const source = makeSource({
      rowHeights: Array.from({ length: 4 }, () => 28),
      colWidths: [100, 100],
      values: [
        ['甲', 1],
        ['甲', 1],
        ['甲', 2],
        ['乙', 2],
      ],
    })
    const pages = paginate(source, { paperSize: 'A4', groupBreakBy: [0, 1] })
    expect(rowRanges(pages)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ])
  })
})

describe('paginate：fit-width 缩放', () => {
  /** 内容宽 1840px（10 列 × 184）超 920px 可用页宽 → 系数 0.5 */
  const WIDE_SOURCE = makeSource({
    rowHeights: Array.from({ length: 20 }, () => 100),
    colWidths: Array.from({ length: 10 }, () => 184),
  })

  it('系数 = 可用页宽 / 内容宽，只缩不放；origin 恒 1', () => {
    const fitted = paginate(WIDE_SOURCE, { ...PAPER_254, scale: 'fit-width' })
    expect(fitted[0]!.scale).toBeCloseTo(0.5)
    const narrow = paginate(makeSource({ rowHeights: [100], colWidths: [200] }), {
      ...PAPER_254,
      scale: 'fit-width',
    })
    expect(narrow[0]!.scale).toBe(1)
    const origin = paginate(WIDE_SOURCE, PAPER_254)
    expect(origin[0]!.scale).toBe(1)
  })

  it('行高按系数折算后再累加：0.5 系数下每页容纳 18 个 100px 行（原尺寸 9 行）', () => {
    const pages = paginate(WIDE_SOURCE, { ...PAPER_254, scale: 'fit-width' })
    expect(rowRanges(pages)).toEqual([
      { start: 0, end: 18 },
      { start: 18, end: 20 },
    ])
    const unscaled = paginate(WIDE_SOURCE, PAPER_254)
    expect(unscaled[0]!.rowRange.end).toBe(9)
  })
})
