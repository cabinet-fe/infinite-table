// 行列插删坐标平移（口径迁移自 sheet-core row-col-shift）。sheet 侧的 CellStore /
// MergeManager 随 packages/sheet 迁入，此处把同一平移口径压到 formulas 的
// shiftRange 坐标层验证：单格 ↔ store 格子坐标，区域 ↔ merge 区域（0 基闭区间）。

import { describe, expect, it } from 'vitest'

import { parseCellRef, type CellRef } from '../src/address'
import { shiftRange } from '../src/shift'

type Axis = 'rows' | 'cols'
type Mode = 'insert' | 'delete'

const cell = (text: string): CellRef => parseCellRef(text)!

/** 单格引用平移（start === end，随引用的绝对标记）；broken = 落在删除区间内 */
function shiftCell(ref: CellRef, axis: Axis, at: number, count: number, mode: Mode) {
  return shiftRange(ref, ref, axis, at, count, mode, ref)
}

/** 区域平移（两个 A1 角点，绝对标记取起点引用，同 shiftFormulaText 口径） */
function shiftArea(a: string, b: string, axis: Axis, at: number, count: number, mode: Mode) {
  const start = cell(a)
  return shiftRange(start, cell(b), axis, at, count, mode, start)
}

describe('单格坐标平移（store 口径）', () => {
  // 种子：a=A1(0,0)、b=B3(2,1)、c=D6(5,3)
  const a = cell('A1')
  const b = cell('B3')
  const c = cell('D6')

  it('insertRows：插入点及之后的行整体下移', () => {
    expect(shiftCell(a, 'rows', 2, 2, 'insert').start).toEqual({ row: 0, col: 0 })
    expect(shiftCell(b, 'rows', 2, 2, 'insert').start).toEqual({ row: 4, col: 1 })
    expect(shiftCell(c, 'rows', 2, 2, 'insert').start).toEqual({ row: 7, col: 3 })
  })

  it('insertRows 首行插入：全部下移', () => {
    expect(shiftCell(a, 'rows', 0, 1, 'insert').start).toEqual({ row: 1, col: 0 })
    expect(shiftCell(b, 'rows', 0, 1, 'insert').start).toEqual({ row: 3, col: 1 })
  })

  it('insertRows 表尾插入：坐标不动', () => {
    expect(shiftCell(c, 'rows', 10, 3, 'insert').start).toEqual({ row: 5, col: 3 })
  })

  it('deleteRows：区间内 broken、之后上移、之前不动', () => {
    expect(shiftCell(a, 'rows', 1, 2, 'delete').start).toEqual({ row: 0, col: 0 })
    expect(shiftCell(b, 'rows', 1, 2, 'delete').broken).toBe(true)
    expect(shiftCell(c, 'rows', 1, 2, 'delete').start).toEqual({ row: 3, col: 3 })
  })

  it('deleteRows 删除含坐标行：broken', () => {
    expect(shiftCell(b, 'rows', 2, 1, 'delete').broken).toBe(true)
    expect(shiftCell(c, 'rows', 2, 1, 'delete').start).toEqual({ row: 4, col: 3 })
  })

  it('deleteRows 尾部删除：仅命中者 broken', () => {
    expect(shiftCell(b, 'rows', 4, 3, 'delete').start).toEqual({ row: 2, col: 1 })
    expect(shiftCell(c, 'rows', 4, 3, 'delete').broken).toBe(true)
  })

  it('insertCols / deleteCols：列轴平移与删除', () => {
    expect(shiftCell(a, 'cols', 1, 2, 'insert').start).toEqual({ row: 0, col: 0 })
    const bShifted = shiftCell(b, 'cols', 1, 2, 'insert')
    const cShifted = shiftCell(c, 'cols', 1, 2, 'insert')
    expect(bShifted.start).toEqual({ row: 2, col: 3 })
    expect(cShifted.start).toEqual({ row: 5, col: 5 })
    // 在平移后的坐标上删 col4：b(col3) 保留，c(col5) → col4
    expect(shiftRange(bShifted.start, bShifted.start, 'cols', 4, 1, 'delete').start).toEqual({
      row: 2,
      col: 3,
    })
    expect(shiftRange(cShifted.start, cShifted.start, 'cols', 4, 1, 'delete').start).toEqual({
      row: 5,
      col: 4,
    })
  })

  it('deleteCols：区间内列 broken', () => {
    expect(shiftCell(b, 'cols', 1, 2, 'delete').broken).toBe(true)
    expect(shiftCell(c, 'cols', 1, 2, 'delete').start).toEqual({ row: 5, col: 1 })
  })

  it('插入后再次删除还原坐标（往返一致性）', () => {
    for (const ref of [a, b, c]) {
      const inserted = shiftCell(ref, 'rows', 2, 3, 'insert')
      expect(inserted.broken).toBe(false)
      const restored = shiftRange(inserted.start, inserted.end, 'rows', 2, 3, 'delete')
      expect(restored.broken).toBe(false)
      expect(restored.start).toEqual({ row: ref.row, col: ref.col })
      expect(restored.end).toEqual({ row: ref.row, col: ref.col })
    }
  })
})

describe('区域平移与裁剪（merge 口径）', () => {
  // 种子：B2:D4（row1-3 col1-3）、E6:F7（row5-6 col4-5）
  const first = () => ['B2', 'D4'] as const
  const second = () => ['E6', 'F7'] as const

  it('行插入：区域下方的整体下移', () => {
    expect(shiftArea(...first(), 'rows', 4, 2, 'insert')).toEqual(area(1, 1, 3, 3))
    expect(shiftArea(...second(), 'rows', 4, 2, 'insert')).toEqual(area(7, 4, 8, 5))
  })

  it('行插入：插入点位于区域内部 → 高度扩展', () => {
    expect(shiftArea(...first(), 'rows', 2, 1, 'insert')).toEqual(area(1, 1, 4, 3))
    expect(shiftArea(...second(), 'rows', 2, 1, 'insert')).toEqual(area(6, 4, 7, 5))
  })

  it('行插入：插入点在锚点行 → 整体下移', () => {
    expect(shiftArea(...first(), 'rows', 1, 2, 'insert')).toEqual(area(3, 1, 5, 3))
    expect(shiftArea(...second(), 'rows', 1, 2, 'insert')).toEqual(area(7, 4, 8, 5))
  })

  it('列插入：内部扩展 + 右侧平移', () => {
    expect(shiftArea(...first(), 'cols', 2, 1, 'insert')).toEqual(area(1, 1, 3, 4))
    expect(shiftArea(...second(), 'cols', 2, 1, 'insert')).toEqual(area(5, 5, 6, 6))
  })

  it('行删除：区间下方整体上移，上方不动', () => {
    expect(shiftArea(...first(), 'rows', 7, 1, 'delete')).toEqual(area(1, 1, 3, 3))
    expect(shiftArea(...second(), 'rows', 7, 1, 'delete')).toEqual(area(5, 4, 6, 5))
    expect(shiftArea(...second(), 'rows', 6, 1, 'delete')).toEqual(area(5, 4, 5, 5))
  })

  it('行删除：完全在区间内的区域 broken', () => {
    expect(shiftArea(...first(), 'rows', 1, 3, 'delete').broken).toBe(true)
    expect(shiftArea(...second(), 'rows', 1, 3, 'delete')).toEqual(area(2, 4, 3, 5))
  })

  it('行删除：锚点在区间内 → 收缩（下方行上移填补）', () => {
    expect(shiftArea(...first(), 'rows', 1, 2, 'delete')).toEqual(area(1, 1, 1, 3))
    expect(shiftArea(...second(), 'rows', 1, 2, 'delete')).toEqual(area(3, 4, 4, 5))
  })

  it('行删除：部分裁剪（锚点保留）+ 下方上移', () => {
    expect(shiftArea(...first(), 'rows', 3, 2, 'delete')).toEqual(area(1, 1, 2, 3))
    expect(shiftArea(...second(), 'rows', 3, 2, 'delete')).toEqual(area(3, 4, 4, 5))
  })

  it('行删除：锚点上方 + 下方同时保留（中间被删）', () => {
    expect(shiftArea('A1', 'E5', 'rows', 2, 2, 'delete')).toEqual(area(0, 0, 2, 4))
  })

  it('行删除：裁剪后只剩 1 行保留', () => {
    expect(shiftArea('A1', 'C2', 'rows', 1, 5, 'delete')).toEqual(area(0, 0, 0, 2))
  })

  it('列删除：列轴裁剪与平移', () => {
    expect(shiftArea(...first(), 'cols', 2, 2, 'delete')).toEqual(area(1, 1, 3, 1))
    expect(shiftArea(...second(), 'cols', 2, 2, 'delete')).toEqual(area(5, 2, 6, 3))
  })

  it('插入后再次删除还原区域（往返一致性）', () => {
    // B2:D4 → area(1,1,3,3)；E6:F7 → area(5,4,6,5)
    const seeds = [
      ['B2', 'D4', area(1, 1, 3, 3)],
      ['E6', 'F7', area(5, 4, 6, 5)],
    ] as const
    for (const [a, b, want] of seeds) {
      const inserted = shiftArea(a, b, 'rows', 3, 2, 'insert')
      expect(inserted.broken).toBe(false)
      const restored = shiftRange(inserted.start, inserted.end, 'rows', 3, 2, 'delete')
      expect(restored.broken).toBe(false)
      expect(restored).toEqual(want)
    }
  })
})

/** 0 基角点构造期望区间（start 左上 / end 右下，broken=false） */
function area(
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): { start: { row: number; col: number }; end: { row: number; col: number }; broken: boolean } {
  return {
    start: { row: startRow, col: startCol },
    end: { row: endRow, col: endCol },
    broken: false,
  }
}
