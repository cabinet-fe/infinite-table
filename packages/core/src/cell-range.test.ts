import { describe, expect, it } from 'vitest'

import { MergeCellMap, normalizeCellRange, rangeContains, rangeCrossesBoundary } from './cell-range'

describe('normalizeCellRange / rangeContains', () => {
  it('归一化：start/end 乱序时交换', () => {
    expect(normalizeCellRange({ startCol: 3, startRow: 2, endCol: 1, endRow: 0 })).toEqual({
      startCol: 1,
      startRow: 0,
      endCol: 3,
      endRow: 2,
    })
  })

  it('rangeContains：闭区间含边界', () => {
    const range = { startCol: 1, startRow: 1, endCol: 3, endRow: 2 }
    expect(rangeContains(range, 1, 1)).toBe(true)
    expect(rangeContains(range, 3, 2)).toBe(true)
    expect(rangeContains(range, 0, 1)).toBe(false)
    expect(rangeContains(range, 2, 3)).toBe(false)
  })
})

describe('rangeCrossesBoundary', () => {
  it('跨越冻结列或冻结行边界判定为跨界', () => {
    const cross = { startCol: 0, startRow: 0, endCol: 2, endRow: 0 }
    expect(rangeCrossesBoundary(cross, 1, 0)).toBe(true)
    expect(rangeCrossesBoundary(cross, 0, 0)).toBe(false)
    expect(rangeCrossesBoundary(cross, 3, 0)).toBe(false)
    const crossRow = { startCol: 0, startRow: 0, endCol: 0, endRow: 2 }
    expect(rangeCrossesBoundary(crossRow, 0, 1)).toBe(true)
  })
})

describe('MergeCellMap', () => {
  it('覆盖查询与主格判定', () => {
    const map = new MergeCellMap([{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }])
    expect(map.rangeAt(2, 1)?.startCol).toBe(1)
    expect(map.rangeAt(4, 1)).toBeNull()
    expect(map.masterOf(3, 2)).toEqual({ col: 1, row: 1 })
    expect(map.masterOf(0, 0)).toBeNull()
    expect(map.isMaster(1, 1)).toBe(true)
    expect(map.isMaster(2, 1)).toBe(false)
    expect(map.isMaster(0, 0)).toBe(false)
  })

  it('乱序区间构造时归一化', () => {
    const map = new MergeCellMap([{ startCol: 3, startRow: 2, endCol: 1, endRow: 1 }])
    expect(map.ranges).toEqual([{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }])
    expect(map.isMaster(1, 1)).toBe(true)
  })

  it('重叠合并区构造即抛错', () => {
    expect(
      () =>
        new MergeCellMap([
          { startCol: 1, startRow: 1, endCol: 3, endRow: 2 },
          { startCol: 3, startRow: 2, endCol: 5, endRow: 4 },
        ]),
    ).toThrow(/overlap/)
  })

  it('单格区间不算合并（忽略）', () => {
    const map = new MergeCellMap([{ startCol: 1, startRow: 1, endCol: 1, endRow: 1 }])
    expect(map.ranges).toEqual([])
    expect(map.rangeAt(1, 1)).toBeNull()
  })
})
