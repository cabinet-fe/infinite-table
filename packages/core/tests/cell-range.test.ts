import { describe, expect, it, vi } from 'vitest'

import {
  MergeCellMap,
  MergeOverlapError,
  normalizeCellRange,
  rangeContains,
  rangeCrossesBoundary,
  sanitizeMerges,
  warnMergeConflicts,
} from '../src/cell-range'

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

  it('重叠合并区构造抛 MergeOverlapError（携带冲突坐标与两条区间原文）', () => {
    let caught: unknown = null
    try {
      new MergeCellMap([
        { startCol: 1, startRow: 1, endCol: 3, endRow: 2 },
        { startCol: 3, startRow: 2, endCol: 5, endRow: 4 },
      ])
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(MergeOverlapError)
    const error = caught as MergeOverlapError
    expect(error.name).toBe('MergeOverlapError')
    expect(error.message).toMatch(/overlap/)
    expect(error.coord).toEqual({ col: 3, row: 2 })
    expect(error.existing).toEqual({ startCol: 1, startRow: 1, endCol: 3, endRow: 2 })
    expect(error.range).toEqual({ startCol: 3, startRow: 2, endCol: 5, endRow: 4 })
  })

  it('单格区间不算合并（忽略）', () => {
    const map = new MergeCellMap([{ startCol: 1, startRow: 1, endCol: 1, endRow: 1 }])
    expect(map.ranges).toEqual([])
    expect(map.rangeAt(1, 1)).toBeNull()
  })
})

describe('sanitizeMerges', () => {
  it('无重叠输入直通（归一化 + 丢弃单格），conflicts 为空', () => {
    const result = sanitizeMerges([
      { startCol: 3, startRow: 2, endCol: 1, endRow: 1 },
      { startCol: 0, startRow: 0, endCol: 0, endRow: 0 },
    ])
    expect(result.ranges).toEqual([{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }])
    expect(result.conflicts).toEqual([])
  })

  it('重叠保留先声明、整体丢弃后到冲突项（含完全重复），逐条上报冲突', () => {
    const first = { startCol: 1, startRow: 1, endCol: 3, endRow: 2 }
    const result = sanitizeMerges([
      first,
      { startCol: 3, startRow: 2, endCol: 5, endRow: 4 },
      { ...first },
      { startCol: 10, startRow: 10, endCol: 11, endRow: 11 },
    ])
    expect(result.ranges).toEqual([first, { startCol: 10, startRow: 10, endCol: 11, endRow: 11 }])
    expect(result.conflicts).toEqual([
      {
        coord: { col: 3, row: 2 },
        range: { startCol: 3, startRow: 2, endCol: 5, endRow: 4 },
        existing: first,
      },
      { coord: { col: 1, row: 1 }, range: first, existing: first },
    ])
  })

  it('warnMergeConflicts：报出来源与两条区间，同一冲突签名只提示一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const conflicts = sanitizeMerges([
        { startCol: 0, startRow: 20, endCol: 1, endRow: 20 },
        { startCol: 1, startRow: 20, endCol: 2, endRow: 20 },
      ]).conflicts
      warnMergeConflicts(conflicts, 'test-source')
      warnMergeConflicts(conflicts, 'test-source')
      expect(warn).toHaveBeenCalledTimes(1)
      const message = String(warn.mock.calls[0]?.[0])
      expect(message).toContain('test-source')
      expect(message).toContain('[0,20 ~ 1,20]')
      expect(message).toContain('[1,20 ~ 2,20]')
    } finally {
      warn.mockRestore()
    }
  })
})
