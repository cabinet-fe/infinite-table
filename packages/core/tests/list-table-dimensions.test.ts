// 行列数运行时可变（setRowCount/setColCount）与滚动缓冲（overscanRows/Cols）：
// 无限滚动形态的引擎基础——增长扩大滚动边界并即时重建窗口；收缩钳选区/冻结并丢
// 越界合并区；增出列头标题回落 resolveColTitle；overscan 只扩场景装配窗口，
// 不改变滚动边界。

import { describe, expect, it } from 'vitest'

import { cellKey } from '../src/cell-range'
import { ListTable } from '../src/list-table'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions, TableModel } from '../src/types'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 5 }, (_, i) => ({ field: `f${i}`, title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function rows(count: number): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({ f0: `r${i}` }))
}

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  // 列定义逐表克隆：setColCount 原地增删 columns，共享数组会跨用例污染
  const table = new ListTable({
    ...BASE_OPTIONS,
    columns: BASE_OPTIONS.columns.map((column) => ({ ...column })),
    host,
    records: rows(20),
    ...extra,
  })
  return { host, table }
}

/** rowCount 可变的动态模型（增长由宿主写模型后调 setRowCount 触发引擎重算） */
class GrowingModel implements TableModel {
  constructor(
    private state: { rows: number },
    readonly data = new Map<string, unknown>(),
  ) {}
  get rowCount(): number {
    return this.state.rows
  }
  getCellValue(col: number, row: number): unknown {
    return this.data.get(`${col}:${row}`)
  }
  onCellChange(): () => void {
    return () => {}
  }
}

describe('setRowCount：运行时行数增长', () => {
  it('纯 hook 形态：增长扩大滚动边界，滚动到底可见末行，行号头随窗口装配', () => {
    const { host, table } = createTable({ records: undefined, rowCount: 20 })
    expect(table.rowCount).toBe(20)
    // 20 行 × 32 = 640，5 列不满宽（无下缘预留）→ 视口高 564，maxTop = 76
    table.setScrollTop(Number.MAX_SAFE_INTEGER)
    expect(table.getScrollTop()).toBe(20 * 32 - 564)
    // 增长到 60 行：滚动边界扩大，滚到底可见末行、末行行号头装配
    table.setRowCount(60)
    expect(table.rowCount).toBe(60)
    table.setScrollTop(Number.MAX_SAFE_INTEGER)
    expect(table.getScrollTop()).toBe(60 * 32 - 564)
    expect(table.getVisibleRange().rows).toEqual({ start: 60 - Math.ceil(564 / 32), end: 60 })
    expect(table.rowHeaderNodes.has(59)).toBe(true)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })
  })

  it('模型形态：模型 rowCount 增长后 setRowCount 重算布局（同值幂等）', () => {
    const state = { rows: 20 }
    const model = new GrowingModel(state)
    const { table } = createTable({ records: undefined, model })
    expect(table.rowCount).toBe(20)
    state.rows = 50
    // 模型行数变了但引擎未重算前仍按旧布局滚动
    table.setScrollTop(Number.MAX_SAFE_INTEGER)
    expect(table.getScrollTop()).toBe(20 * 32 - 564)
    table.setRowCount(50)
    expect(table.rowCount).toBe(50)
    table.setScrollTop(Number.MAX_SAFE_INTEGER)
    expect(table.getScrollTop()).toBe(50 * 32 - 564)
    // 同值再调为幂等空操作
    const before = table.getScrollState()
    table.setRowCount(50)
    expect(table.getScrollState()).toEqual(before)
  })

  it('records 形态：行数恒等于 records.length，setRowCount 增长无效', () => {
    const { table } = createTable()
    table.setRowCount(500)
    expect(table.rowCount).toBe(20)
  })

  it('收缩：选区钳到新界、越界合并区丢弃、冻结行数夹取（hook 形态）', () => {
    const { table } = createTable({
      records: undefined,
      rowCount: 20,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 1 }],
      frozenRowCount: 2,
    })
    table.selectCell(4, 15)
    table.setRowCount(5)
    expect(table.rowCount).toBe(5)
    // 选区钳制到新界（不广播，快照直接反映）
    expect(table.getSelection().focus).toEqual({ col: 4, row: 4 })
    // 越界合并区（行 1 ≤ 4 未越界，保留）；再造一个越界的
    expect(table.mergeCells.ranges).toHaveLength(1)
    table.setRowCount(1)
    expect(table.mergeCells.ranges).toHaveLength(0)
    expect(table.frozenRowCount).toBe(1)
  })
})

describe('setColCount：运行时列数增减', () => {
  it('增长：默认列宽追加，列头标题回落 resolveColTitle，滚动可达新列', () => {
    const { host, table } = createTable({
      resolveColTitle: (col) => `L${col}`,
    })
    expect(table.colCount).toBe(5)
    table.setColCount(8)
    expect(table.colCount).toBe(8)
    // 新列宽 = defaultColWidth（100），列偏移随之延长
    expect(table.getColWidth(7)).toBe(100)
    expect(table.contentWidth).toBe(800)
    // 增出列的列头标题走 resolveColTitle（既有列仍用列定义 title）
    expect(table.colHeaderNodes.get(4)?.text).toBe('C4')
    expect(table.colHeaderNodes.get(7)?.text).toBe('L7')
    // 滚动到最右：新列进入窗口、列头装配
    table.setScrollLeft(Number.MAX_SAFE_INTEGER)
    expect(table.getVisibleRange().cols.end).toBe(8)
    expect(table.colHeaderNodes.has(7)).toBe(true)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })
  })

  it('增长模板：template 提供增出列的列宽与定义片段', () => {
    const { table } = createTable()
    table.setColCount(7, { width: 60, title: 'T' })
    expect(table.getColWidth(6)).toBe(60)
    expect(table.colHeaderNodes.get(6)?.text).toBe('T')
  })

  it('收缩：截断列宽/偏移、清越界列样式缓存、选区钳制、越界合并区丢弃', () => {
    const { table } = createTable({
      records: rows(20),
      mergeCells: [{ startCol: 2, startRow: 0, endCol: 4, endRow: 1 }],
    })
    table.selectCell(4, 3)
    table.setColCount(2)
    expect(table.colCount).toBe(2)
    expect(table.getColWidth(2)).toBe(0)
    expect(table.contentWidth).toBe(200)
    expect(table.getSelection().focus).toEqual({ col: 1, row: 3 })
    expect(table.mergeCells.ranges).toHaveLength(0)
    expect(table.colHeaderNodes.has(4)).toBe(false)
  })
})

describe('滚动缓冲（overscan）', () => {
  it('窗口两端扩 overscan（场景预建缓冲行列），滚动边界不变', () => {
    const { table } = createTable({ overscanRows: 4, overscanCols: 2 })
    // 视口高 564（5 列不满宽无下缘预留）：可见行 [0,18) 扩 4 行；5 列全可见扩后仍 [0,5)
    expect(table.getVisibleRange()).toEqual({
      rows: { start: 0, end: 20 },
      cols: { start: 0, end: 5 },
    })
    // 滚动边界按真实视口（不含缓冲）：maxTop = 640 − 564 = 76
    table.setScrollTop(Number.MAX_SAFE_INTEGER)
    expect(table.getScrollTop()).toBe(20 * 32 - 564)
    // 滚到底：窗口夹到行数上界（20 < 18+4），缓冲上方到达表首
    expect(table.getVisibleRange().rows).toEqual({ start: 0, end: 20 })
  })

  it('缓冲行预建场景节点（视口外窗口内的行有节点可画）', () => {
    const { table } = createTable({ overscanRows: 4 })
    // 可见行 [0,18)、窗口 [0,20)（钳到行数）：缓冲行 19 不可见但节点/行号头已预建
    expect(table.cellNodes.has(cellKey(0, 19))).toBe(true)
    expect(table.rowHeaderNodes.has(19)).toBe(true)
  })

  it('窗口夹取：缓冲不越过行列数上界', () => {
    const { table } = createTable({ overscanRows: 50, overscanCols: 50 })
    expect(table.getVisibleRange()).toEqual({
      rows: { start: 0, end: 20 },
      cols: { start: 0, end: 5 },
    })
  })
})
