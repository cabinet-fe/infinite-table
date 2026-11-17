// 行列数运行时可变（setRowCount/setColCount）与滚动缓冲（overscanRows/Cols）：
// 无限滚动形态的引擎基础——增长扩大滚动边界并即时重建窗口；收缩钳选区/冻结并丢
// 越界合并区；增出列头标题回落 resolveColTitle；overscan 只扩场景装配窗口，
// 不改变滚动边界。

import { describe, expect, it, vi } from 'vitest'

import { cellKey } from '@infinitable/grid'
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
    expect(table.sceneState.rowHeaderNodes.has(59)).toBe(true)
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
    expect(table.geometryState.mergeCells.ranges).toHaveLength(1)
    table.setRowCount(1)
    expect(table.geometryState.mergeCells.ranges).toHaveLength(0)
    expect(table.geometryState.frozenRowCount).toBe(1)
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
    expect(table.sceneState.colHeaderNodes.get(4)?.text).toBe('C4')
    expect(table.sceneState.colHeaderNodes.get(7)?.text).toBe('L7')
    // 滚动到最右：新列进入窗口、列头装配
    table.setScrollLeft(Number.MAX_SAFE_INTEGER)
    expect(table.getVisibleRange().cols.end).toBe(8)
    expect(table.sceneState.colHeaderNodes.has(7)).toBe(true)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })
  })

  it('增长模板：template 提供增出列的列宽与定义片段', () => {
    const { table } = createTable()
    table.setColCount(7, { width: 60, title: 'T' })
    expect(table.getColWidth(6)).toBe(60)
    expect(table.sceneState.colHeaderNodes.get(6)?.text).toBe('T')
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
    expect(table.geometryState.mergeCells.ranges).toHaveLength(0)
    expect(table.sceneState.colHeaderNodes.has(4)).toBe(false)
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
    expect(table.sceneState.cellNodes.has(cellKey(0, 19))).toBe(true)
    expect(table.sceneState.rowHeaderNodes.has(19)).toBe(true)
  })

  it('窗口夹取：缓冲不越过行列数上界', () => {
    const { table } = createTable({ overscanRows: 50, overscanCols: 50 })
    expect(table.getVisibleRange()).toEqual({
      rows: { start: 0, end: 20 },
      cols: { start: 0, end: 5 },
    })
  })
})

describe('几何批处理与行高/列宽完整 API（Stage 2.1）', () => {
  it('options.rowHeights：支持 Map/Iterable/Record，构造前生效并钳制最小行高与过滤默认/非法值', () => {
    const fromMap = createTable({
      rowHeights: new Map([
        [0, 60],
        [1, 8], // 正数小于 MIN_ROW_HEIGHT(20) → 钳制为 20
        [2, 32], // 等于默认 rowHeight(32) → 跳过入表
        [3, -10], // 非正 → 跳过
        [4, Number.NaN], // 非有限 → 跳过
      ]),
    })
    expect(fromMap.table.getRowHeight(0)).toBe(60)
    expect(fromMap.table.getRowHeight(1)).toBe(20)
    expect(fromMap.table.getRowHeight(2)).toBe(32)
    expect(fromMap.table.geometryState.rowHeights.has(2)).toBe(false)
    expect(fromMap.table.getRowHeight(3)).toBe(32)
    expect(fromMap.table.getRowHeight(4)).toBe(32)
    expect(fromMap.table.geometryState.rowOffsets[2]).toBe(80)
    expect(fromMap.table.contentHeight).toBe(60 + 20 + 18 * 32)

    const fromRecord = createTable({ rowHeights: { 0: 48, 2: 52 } })
    expect(fromRecord.table.getRowHeight(0)).toBe(48)
    expect(fromRecord.table.getRowHeight(2)).toBe(52)

    const fromIterable = createTable({ rowHeights: [[1, 44]] })
    expect(fromIterable.table.getRowHeight(1)).toBe(44)
  })

  it('setColWidth / setRowHeight 相等短路，恢复默认行高清理 rowHeights 条目', () => {
    const { host, table } = createTable()
    host.submitted.length = 0
    const spy = vi.spyOn(table, 'applyGeometryChange')

    // 初始 col 0 = 100, row 0 = 32 → 同值调用不触发几何重建
    table.setColWidth(0, 100)
    table.setRowHeight(0, 32)
    expect(spy).not.toHaveBeenCalled()
    expect(host.submitted).toEqual([])

    table.setRowHeight(0, 50)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(table.geometryState.rowHeights.get(0)).toBe(50)

    // 同覆盖值再次设置短路
    table.setRowHeight(0, 50)
    expect(spy).toHaveBeenCalledTimes(1)

    // 设回默认行高 32 → 删除条目并触发一次重建
    table.setRowHeight(0, 32)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(table.geometryState.rowHeights.has(0)).toBe(false)
  })

  it('clearRowHeight / resetRowHeights：按需清理与空状态短路', () => {
    const { table } = createTable({ rowHeights: { 0: 48, 2: 64 } })
    const spy = vi.spyOn(table, 'applyGeometryChange')

    table.clearRowHeight(1) // 无覆盖 → 短路
    expect(spy).not.toHaveBeenCalled()

    table.clearRowHeight(0)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(table.getRowHeight(0)).toBe(32)
    expect(table.getRowHeight(2)).toBe(64)

    table.resetRowHeights()
    expect(spy).toHaveBeenCalledTimes(2)
    expect(table.geometryState.rowHeights.size).toBe(0)
    expect(table.getRowHeight(2)).toBe(32)

    table.resetRowHeights() // 已空 → 短路
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('setColWidths / setRowHeights：批内合并为单次 applyGeometryChange（全等值空操作）', () => {
    const { host, table } = createTable()
    host.submitted.length = 0
    const spy = vi.spyOn(table, 'applyGeometryChange')

    // 全等值不触发重建
    table.setColWidths({ 0: 100, 1: 100 })
    table.setRowHeights(new Map([[0, 32]]))
    expect(spy).not.toHaveBeenCalled()
    expect(host.submitted).toEqual([])

    table.setColWidths(
      new Map([
        [0, 140],
        [1, 160],
        [2, 120],
      ]),
    )
    expect(spy).toHaveBeenCalledTimes(1)
    expect(table.getColWidth(0)).toBe(140)
    expect(table.getColWidth(1)).toBe(160)
    expect(table.getColWidth(2)).toBe(120)
    expect(table.contentWidth).toBe(140 + 160 + 120 + 200)

    table.setRowHeights([
      [0, 40],
      [1, 50],
    ])
    expect(spy).toHaveBeenCalledTimes(2)
    expect(table.getRowHeight(0)).toBe(40)
    expect(table.getRowHeight(1)).toBe(50)
  })

  it('batchUpdate 延迟重算 colOffsets/rowOffsets 并合并为单次 applyGeometryChange（含嵌套与 rowHeightAt 即时可读）', () => {
    const { host, table } = createTable({ records: undefined, rowCount: 20 })
    host.submitted.length = 0
    const spy = vi.spyOn(table, 'applyGeometryChange')
    const initialRowOffsets = table.geometryState.rowOffsets
    const initialColOffsets = table.geometryState.colOffsets

    table.batchUpdate(() => {
      table.setColWidth(0, 150)
      table.setRowHeight(0, 60)
      table.batchUpdate(() => {
        table.setColCount(6)
        table.setRowCount(25)
        table.setFrozenRowCount(1)
      })
      // 批内 rowHeightAt / getColWidth 即时可读，而偏移前缀和与 applyGeometryChange 尚未执行
      expect(table.rowHeightAt(0)).toBe(60)
      expect(table.getColWidth(0)).toBe(150)
      expect(table.geometryState.rowOffsets).toBe(initialRowOffsets)
      expect(table.geometryState.colOffsets).toBe(initialColOffsets)
      expect(spy).not.toHaveBeenCalled()
    })

    // 仅最外层结束时重算一次偏移并执行一次 applyGeometryChange
    expect(spy).toHaveBeenCalledTimes(1)
    expect(table.geometryState.colOffsets).toEqual([0, 150, 250, 350, 450, 550, 650])
    expect(table.geometryState.rowOffsets[0]).toBe(0)
    expect(table.geometryState.rowOffsets[1]).toBe(60)
    expect(table.geometryState.rowOffsets[25]).toBe(60 + 24 * 32)
    expect(table.geometryState.frozenRowsHeight).toBe(60)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'full' } },
      { kind: 'sky', inv: { type: 'full' } },
    ])
  })
})
