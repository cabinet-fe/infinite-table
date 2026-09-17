import { describe, expect, it } from 'vitest'

import {
  computeRowOffsets,
  computeRowWindowFromOffsets,
  computeScrollableRowWindowFromOffsets,
  findColAt,
  findRowAt,
  resolveCellYFromOffsets,
  unionRegions,
} from '../src/grid-layout'

describe('逐行高度几何（行 resize 产物）', () => {
  it('computeRowOffsets：覆盖行取自定义高，缺省取默认高', () => {
    const offsets = computeRowOffsets(3, 32, new Map([[0, 60]]))
    expect(offsets).toEqual([0, 60, 92, 124])
  })

  it('computeRowWindowFromOffsets：等行高时与等距语义一致，逐行高度按前缀和求窗口', () => {
    const uniform = computeRowOffsets(100, 32)
    expect(computeRowWindowFromOffsets(0, 564, uniform)).toEqual({ start: 0, end: 18 })
    const custom = computeRowOffsets(10, 32, new Map([[0, 500]]))
    // 行 0 高 500：视口 564 还容下行 1（500..532）与部分行 2
    expect(computeRowWindowFromOffsets(0, 564, custom)).toEqual({ start: 0, end: 3 })
    // 空视口/空表
    expect(computeRowWindowFromOffsets(0, 0, uniform)).toEqual({ start: 0, end: 0 })
  })

  it('computeScrollableRowWindowFromOffsets：冻结行固定可见，窗口夹取到滚动区', () => {
    const offsets = computeRowOffsets(100, 32)
    // 冻结 2 行：滚动 0 时滚动区窗口从行 2 起
    const win = computeScrollableRowWindowFromOffsets(0, 564 - 64, offsets, 2)
    expect(win.start).toBe(2)
    // 冻结行高计入滚动换算：scrollTop 32 对应内容 32 + 64 = 96 起
    const scrolled = computeScrollableRowWindowFromOffsets(32, 564 - 64, offsets, 2)
    expect(scrolled.start).toBe(3)
  })

  it('resolveCellYFromOffsets：冻结行不随滚动平移，滚动区叠加 scrollTop', () => {
    const offsets = computeRowOffsets(100, 32, new Map([[0, 60]]))
    expect(resolveCellYFromOffsets(0, 100, offsets, 1, 36)).toBe(36)
    expect(resolveCellYFromOffsets(1, 100, offsets, 1, 36)).toBe(36 + 60 - 100)
  })

  it('findRowAt/findColAt：内容坐标命中行列，越界返回 -1', () => {
    const rowOffsets = computeRowOffsets(3, 32, new Map([[0, 60]]))
    expect(findRowAt(rowOffsets, 59)).toBe(0)
    expect(findRowAt(rowOffsets, 60)).toBe(1)
    expect(findRowAt(rowOffsets, 124)).toBe(-1)
    expect(findRowAt(rowOffsets, -1)).toBe(-1)
    const colOffsets = [0, 100, 200]
    expect(findColAt(colOffsets, 99)).toBe(0)
    expect(findColAt(colOffsets, 100)).toBe(1)
    expect(findColAt(colOffsets, 200)).toBe(-1)
  })

  it('unionRegions：最小包围盒；空数组返回 null', () => {
    expect(
      unionRegions([
        { x: 48, y: 36, width: 100, height: 32 },
        { x: 148, y: 68, width: 100, height: 32 },
      ]),
    ).toEqual({ x: 48, y: 36, width: 200, height: 64 })
    expect(unionRegions([])).toBeNull()
  })
})
