// 快照行平移纯函数测试（模块自 print-form-designer app 下沉后补的直接覆盖；此前 app
// 侧只有经 FormDoc 数据块行数调整的间接覆盖）：插行/删行后 cells（值/公式原文/样式）/
// meta / merges / 行高与行默认样式的映射，以及行数改写与不可变性。
// 公式引用不平移是模块文档声明的历史口径，此处按实际行为锁死（见 snapshot-rows.ts 头注释）。
import { describe, expect, it } from 'vitest'

import type { CellRange } from '../../src/core/address'
import { deleteSnapshotRows, insertSnapshotRows } from '../../src/core/snapshot-rows'
import type { SheetSnapshot } from '../../src/core/sheet'

/** 矩形区间（左上 → 右下，含端点） */
const RANGE = (r1: number, c1: number, r2: number, c2: number): CellRange => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 },
})

/** 最小快照（各字段按需覆盖） */
function snapshot(patch: Partial<SheetSnapshot> = {}): SheetSnapshot {
  return {
    cells: [],
    styles: [],
    merges: [],
    frozen: { rows: 0, cols: 0 },
    rows: 0,
    cols: 0,
    ...patch,
  }
}

describe('insertSnapshotRows', () => {
  it('at 及下方内容下移 count 行、上方不动，行数 +count', () => {
    const next = insertSnapshotRows(
      snapshot({
        rows: 4,
        cells: [
          { row: 0, col: 0, v: '上' },
          { row: 1, col: 0, v: '边界' },
          { row: 2, col: 1, v: '下' },
        ],
      }),
      1,
      2,
    )
    expect(next.rows).toBe(6)
    expect(next.cells).toEqual([
      { row: 0, col: 0, v: '上' },
      { row: 3, col: 0, v: '边界' },
      { row: 4, col: 1, v: '下' },
    ])
  })

  it('公式原文与样式引用随格平移、引用文本不改写（有意不平移公式引用）', () => {
    const next = insertSnapshotRows(
      snapshot({
        rows: 3,
        cells: [{ row: 2, col: 0, v: 3, f: 'SUM(A1:A2)', s: 1 }],
      }),
      0,
      1,
    )
    expect(next.cells).toEqual([{ row: 3, col: 0, v: 3, f: 'SUM(A1:A2)', s: 1 }])
  })

  it('meta / rowHeights / rowStyles 随行平移；colWidths / colStyles / styles 池不动', () => {
    const styles = [{ font: { bold: true } }]
    const next = insertSnapshotRows(
      snapshot({
        rows: 3,
        styles,
        meta: [{ row: 2, col: 0, namespace: 'x', payload: 1 }],
        rowHeights: [
          [0, 28],
          [2, 40],
        ],
        rowStyles: [[2, 0]],
        colWidths: [[0, 90]],
        colStyles: [[1, 0]],
      }),
      2,
      1,
    )
    expect(next.meta).toEqual([{ row: 3, col: 0, namespace: 'x', payload: 1 }])
    expect(next.rowHeights).toEqual([
      [0, 28],
      [3, 40],
    ])
    expect(next.rowStyles).toEqual([[3, 0]])
    expect(next.colWidths).toEqual([[0, 90]])
    expect(next.colStyles).toEqual([[1, 0]])
    expect(next.styles).toBe(styles)
  })

  it('合并区首尾行同步下移', () => {
    const next = insertSnapshotRows(snapshot({ rows: 4, merges: [RANGE(1, 0, 3, 1)] }), 1, 2)
    expect(next.merges).toEqual([RANGE(3, 0, 5, 1)])
  })
})

describe('deleteSnapshotRows', () => {
  it('删除区间内条目移除、下方上移 count 行，行数 -count', () => {
    const next = deleteSnapshotRows(
      snapshot({
        rows: 5,
        cells: [
          { row: 0, col: 0, v: '上' },
          { row: 1, col: 0, v: '删' },
          { row: 3, col: 1, v: '下' },
        ],
        meta: [
          { row: 2, col: 0, namespace: 'x', payload: 1 },
          { row: 4, col: 0, namespace: 'x', payload: 2 },
        ],
      }),
      1,
      2,
    )
    expect(next.rows).toBe(3)
    expect(next.cells).toEqual([
      { row: 0, col: 0, v: '上' },
      { row: 1, col: 1, v: '下' },
    ])
    expect(next.meta).toEqual([{ row: 2, col: 0, namespace: 'x', payload: 2 }])
  })

  it('行数不足时夹取到 0，不为负', () => {
    expect(deleteSnapshotRows(snapshot({ rows: 2 }), 0, 5).rows).toBe(0)
  })

  it('合并区整体落在删除区间 → 丢弃；部分跨越 → 随存活行收缩', () => {
    const next = deleteSnapshotRows(
      snapshot({
        rows: 6,
        merges: [
          RANGE(1, 0, 2, 1), // 整段被删
          RANGE(0, 2, 3, 3), // 跨删除带：start 上方保留、end 上移收缩
          RANGE(4, 4, 5, 5), // 完全在下方：整体上移
        ],
      }),
      1,
      2,
    )
    expect(next.merges).toEqual([RANGE(0, 2, 1, 3), RANGE(2, 4, 3, 5)])
  })

  it('合并区一端被删（另一端存活）→ 整条丢弃', () => {
    const next = deleteSnapshotRows(
      snapshot({ rows: 4, merges: [RANGE(1, 0, 3, 1)] }),
      1,
      1,
    )
    expect(next.merges).toEqual([])
  })

  it('rowHeights / rowStyles 随行平移并剔除被删行', () => {
    const next = deleteSnapshotRows(
      snapshot({
        rows: 4,
        rowHeights: [
          [0, 28],
          [1, 40],
          [3, 32],
        ],
        rowStyles: [
          [1, 0],
          [2, 1],
        ],
      }),
      1,
      1,
    )
    expect(next.rowHeights).toEqual([
      [0, 28],
      [2, 32],
    ])
    expect(next.rowStyles).toEqual([[1, 1]])
  })

  it('纯变换：输入快照的各数组不被就地修改', () => {
    const source = snapshot({
      rows: 3,
      cells: [{ row: 2, col: 0, v: 'a' }],
      merges: [RANGE(0, 0, 2, 1)],
      rowHeights: [[2, 40]],
    })
    const inserted = insertSnapshotRows(source, 0, 1)
    const deleted = deleteSnapshotRows(source, 0, 1)
    expect(source.cells).toEqual([{ row: 2, col: 0, v: 'a' }])
    expect(source.merges).toEqual([RANGE(0, 0, 2, 1)])
    expect(source.rowHeights).toEqual([[2, 40]])
    expect(source.rows).toBe(3)
    expect(inserted.cells[0]).toEqual({ row: 3, col: 0, v: 'a' })
    expect(deleted.cells).toEqual([{ row: 1, col: 0, v: 'a' }])
  })
})
