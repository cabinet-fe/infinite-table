// ListTable 几何与滚动查询 API（P0-7）：格视口矩形、命中格、滚动到格、
// 滚动分量 get/set、画布内容区、可视数据格范围（含冻结区语义）、行号列与表头层数

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, ...extra })
  return { host, table }
}

// 缺省几何：行号列 48、列头 36、行高 32、列宽 100；视口 752x564
describe('ListTable 几何/滚动查询 API', () => {
  it('getCellRelativeRect：格视口矩形（CSS 像素），滚动后滚动区随滚动位移', () => {
    const { table } = createTable({ records: rows(100) })
    expect(table.getCellRelativeRect(0, 0)).toEqual({ x: 48, y: 36, width: 100, height: 32 })
    table.setScrollLeft(200)
    // 列 3 左缘内容坐标 300，滚动 200 后层坐标 148
    expect(table.getCellRelativeRect(3, 0)).toEqual({ x: 148, y: 36, width: 100, height: 32 })
    // 窗口外返回 null
    expect(table.getCellRelativeRect(0, 50)).toBeNull()
  })

  it('getCellRelativeRect：冻结区不随滚动位移，滚出窗口的滚动区格返回 null', () => {
    const { table } = createTable({ records: rows(100), frozenColCount: 1, frozenRowCount: 2 })
    table.setScrollLeft(200)
    table.setScrollTop(640)
    expect(table.getCellRelativeRect(0, 0)).toEqual({ x: 48, y: 36, width: 100, height: 32 })
    // scrollLeft 200（可滚动坐标）+ 冻结宽 100 → 滚动窗口列 {3,10}，列 2 已滚出
    expect(table.getCellRelativeRect(2, 0)).toBeNull()
  })

  it('getCellAtRelativePosition：命中格，行列头/空白返回 null', () => {
    const { table } = createTable({ records: rows(3) })
    expect(table.getCellAtRelativePosition(98, 52)).toEqual({ col: 0, row: 0 })
    expect(table.getCellAtRelativePosition(10, 52)).toBeNull() // 行号列
    expect(table.getCellAtRelativePosition(98, 10)).toBeNull() // 列头
    expect(table.getCellAtRelativePosition(98, 142)).toBeNull() // 3 行内容下方空白
  })

  it('scrollToCell：目标格滚动到完整可见（revealAxis 语义）', () => {
    const { table } = createTable({ records: rows(1000) })
    // 行 100 上缘 3200，3210 处半可见
    table.setScrollTop(3210)
    table.scrollToCell({ col: 0, row: 100 })
    expect(table.getScrollTop()).toBe(3200)
    expect(table.getBodyVisibleCellRange().rows).toEqual({ start: 100, end: 118 })
    // 已完整可见不滚动
    table.scrollToCell({ col: 0, row: 101 })
    expect(table.getScrollTop()).toBe(3200)
    // 目标在视口下方：底边对齐（6400+32-564）
    table.setScrollTop(0)
    table.scrollToCell({ col: 5, row: 200 })
    expect(table.getScrollTop()).toBe(5868)
  })

  it('scrollToCell：横向让末列完整可见，冻结轴恒可见跳过滚动', () => {
    const { table } = createTable({ records: rows(100), frozenColCount: 1 })
    table.scrollToCell({ col: 9, row: 0 })
    // 列 9 左缘 900，冻结宽 100 → 可滚动起点 800，视口 652 → 800+100-652=248
    expect(table.getScrollLeft()).toBe(248)
    const rect = table.getCellRelativeRect(9, 0)
    expect(rect).toEqual({ x: 700, y: 36, width: 100, height: 32 })
    // 冻结格恒可见：不产生滚动
    table.scrollToCell({ col: 0, row: 0 })
    expect(table.getScrollState()).toEqual({ left: 248, top: 0 })
  })

  it('getScrollLeft/getScrollTop/setScrollLeft/setScrollTop：单轴读写与越界夹取', () => {
    const { table } = createTable({ records: rows(100) })
    expect(table.getScrollLeft()).toBe(0)
    expect(table.getScrollTop()).toBe(0)
    table.setScrollLeft(150)
    expect(table.getScrollLeft()).toBe(150)
    expect(table.getScrollTop()).toBe(0) // 另一轴不受影响
    table.setScrollTop(5000)
    expect(table.getScrollTop()).toBe(100 * 32 - 564) // 夹取到最大 2636
    table.setScrollLeft(99999)
    expect(table.getScrollLeft()).toBe(1000 - 752) // 夹取到最大 248
  })

  it('getDrawRange：画布内容区矩形（扣除行号列与列头）', () => {
    const { table } = createTable({ records: rows(10) })
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 752, height: 564 })
  })

  it('getBodyVisibleCellRange：扣除表头/行号列，含冻结区语义', () => {
    const { table } = createTable({ records: rows(1000), frozenColCount: 2, frozenRowCount: 3 })
    // 视口 752x564：3 冻结行 + 滚动窗口 15 行；2 冻结列 + 滚动窗口 6 列
    expect(table.getBodyVisibleCellRange()).toEqual({
      rows: { start: 0, end: 18 },
      cols: { start: 0, end: 8 },
    })
    table.setScrollTop(640)
    // 滚动后冻结行仍在范围内：start 恒 0
    expect(table.getBodyVisibleCellRange().rows).toEqual({ start: 0, end: 38 })
  })

  it('isSeriesNumber 与表头层数', () => {
    const { table } = createTable({ records: rows(3) })
    expect(table.isSeriesNumber(-1, 0)).toBe(true)
    expect(table.isSeriesNumber(-1, 2)).toBe(true)
    expect(table.isSeriesNumber(0, 0)).toBe(false)
    expect(table.isSeriesNumber(0, -1)).toBe(false) // 列头
    expect(table.isSeriesNumber(-1, -1)).toBe(false) // 左上角
    expect(table.isSeriesNumber(-1, 99)).toBe(false) // 越出行数
    expect(table.getHeaderLevelCount()).toBe(1)
  })
})

function rows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: `row-${i}` }))
}
