// 快照内容包围盒纯函数测试（自 print-form-designer app tests/designer 随模块下沉，
// bun:test → vitest）：覆盖 cells / meta / merges / images / 行高列宽 / 行列默认样式 /
// 数据块七类来源的最大行列，空内容回落 1×1；以及按包围盒裁剪快照（越界合并与图片
// 整条丢弃）。
import { describe, expect, it } from 'vitest'

import type { CellRange } from '../../src/core/address'
import { clampSnapshotToBounds, snapshotContentBounds } from '../../src/core/snapshot-bounds'
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

describe('snapshotContentBounds', () => {
  it('空快照回落 1 行 1 列（引擎与打印都要求至少 1）', () => {
    expect(snapshotContentBounds(snapshot(), [])).toEqual({ rows: 1, cols: 1 })
  })

  it('cells 取最大行列 + 1', () => {
    expect(
      snapshotContentBounds(
        snapshot({
          cells: [
            { row: 0, col: 0, v: 'a' },
            { row: 4, col: 2, v: 'b' },
          ],
        }),
        [],
      ),
    ).toEqual({ rows: 5, cols: 3 })
  })

  it('meta（绑定 sidecar）参与计数：只有绑定没有值的格也算内容', () => {
    expect(
      snapshotContentBounds(
        snapshot({
          meta: [{ row: 2, col: 6, namespace: 'form-binding', payload: { path: 'a' } }],
        }),
        [],
      ),
    ).toEqual({ rows: 3, cols: 7 })
  })

  it('merges 取区间终点（起点在内不影响结果）', () => {
    expect(snapshotContentBounds(snapshot({ merges: [RANGE(1, 1, 6, 4)] }), [])).toEqual({
      rows: 7,
      cols: 5,
    })
  })

  it('images 的 anchor.from 与 to 都参与计数', () => {
    const image = {
      id: 'i1',
      data: new Uint8Array(),
      type: 'png' as const,
      anchor: { from: { row: 1, col: 1 }, to: { row: 8, col: 3 } },
    }
    expect(snapshotContentBounds(snapshot({ images: [image] }), [])).toEqual({ rows: 9, cols: 4 })
    // 没有 to 时只按 from 算
    expect(
      snapshotContentBounds(
        snapshot({ images: [{ ...image, anchor: { from: { row: 2, col: 5 } } }] }),
        [],
      ),
    ).toEqual({ rows: 3, cols: 6 })
  })

  it('行高/列宽与行列默认样式各自撑起一个方向', () => {
    expect(snapshotContentBounds(snapshot({ rowHeights: [[9, 40]] }), [])).toEqual({
      rows: 10,
      cols: 1,
    })
    expect(snapshotContentBounds(snapshot({ colWidths: [[3, 120]] }), [])).toEqual({
      rows: 1,
      cols: 4,
    })
    expect(snapshotContentBounds(snapshot({ rowStyles: [[6, 1]] }), [])).toEqual({
      rows: 7,
      cols: 1,
    })
    expect(snapshotContentBounds(snapshot({ colStyles: [[2, 1]] }), [])).toEqual({
      rows: 1,
      cols: 3,
    })
  })

  it('regions 参与计数：刚框出来还没内容那块也算版面', () => {
    expect(
      snapshotContentBounds(snapshot(), [{ startRow: 3, endRow: 7, startCol: 0, endCol: 9 }]),
    ).toEqual({ rows: 8, cols: 10 })
  })

  it('不尊重 sheet.cols 的声明宽度（包围盒即最终口径）', () => {
    expect(snapshotContentBounds(snapshot({ rows: 100, cols: 26 }), [])).toEqual({
      rows: 1,
      cols: 1,
    })
  })
})

describe('clampSnapshotToBounds', () => {
  const bounds = { rows: 3, cols: 2 }

  it('cells / meta / 行高列宽 / 行列样式按下标过滤，尺寸改写为包围盒', () => {
    const clamped = clampSnapshotToBounds(
      snapshot({
        rows: 100,
        cols: 26,
        cells: [
          { row: 0, col: 0, v: '留' },
          { row: 5, col: 1, v: '丢' },
        ],
        meta: [
          { row: 1, col: 1, namespace: 'x', payload: 1 },
          { row: 9, col: 0, namespace: 'x', payload: 2 },
        ],
        rowHeights: [
          [1, 40],
          [7, 40],
        ],
        colWidths: [
          [1, 90],
          [5, 90],
        ],
        rowStyles: [
          [2, 3],
          [4, 3],
        ],
        colStyles: [
          [0, 3],
          [2, 3],
        ],
      }),
      bounds,
    )
    expect(clamped.rows).toBe(3)
    expect(clamped.cols).toBe(2)
    expect(clamped.cells).toEqual([{ row: 0, col: 0, v: '留' }])
    expect(clamped.meta).toEqual([{ row: 1, col: 1, namespace: 'x', payload: 1 }])
    expect(clamped.rowHeights).toEqual([[1, 40]])
    expect(clamped.colWidths).toEqual([[1, 90]])
    expect(clamped.rowStyles).toEqual([[2, 3]])
    expect(clamped.colStyles).toEqual([[0, 3]])
  })

  it('merges 起止越界整条丢弃（不裁半个合并区）', () => {
    const clamped = clampSnapshotToBounds(
      snapshot({
        merges: [RANGE(0, 0, 1, 1), RANGE(2, 0, 4, 1)],
      }),
      bounds,
    )
    expect(clamped.merges).toEqual([RANGE(0, 0, 1, 1)])
  })

  it('images 任一端越界整条丢弃', () => {
    const inside = {
      id: 'in',
      data: new Uint8Array(),
      type: 'png' as const,
      anchor: { from: { row: 0, col: 0 }, to: { row: 2, col: 1 } },
    }
    const outside = {
      ...inside,
      id: 'out',
      anchor: { from: { row: 0, col: 0 }, to: { row: 9, col: 1 } },
    }
    const clamped = clampSnapshotToBounds(snapshot({ images: [inside, outside] }), bounds)
    expect(clamped.images?.map((image) => image.id)).toEqual(['in'])
  })

  it('styles 池原样保留（样式 id 是池内下标，重排会打乱引用）', () => {
    const styles = [{ font: { bold: true } }, { fill: { color: '#fff' } }]
    const clamped = clampSnapshotToBounds(snapshot({ styles, cells: [{ row: 9, col: 9 }] }), bounds)
    expect(clamped.styles).toEqual(styles)
    expect(clamped.cells).toEqual([])
  })

  it('可选字段原本不存在时不会被补成空数组', () => {
    const clamped = clampSnapshotToBounds(snapshot(), bounds)
    expect('meta' in clamped).toBe(false)
    expect('images' in clamped).toBe(false)
    expect('rowHeights' in clamped).toBe(false)
  })
})
