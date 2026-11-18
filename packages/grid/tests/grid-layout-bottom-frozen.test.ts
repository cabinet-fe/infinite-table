import { describe, expect, it } from 'vitest'

import {
  clampFrozenBottomCount,
  computeMaxScrollTop,
  computeRowOffsets,
  computeScrollableViewportHeight,
  findBottomRowAt,
  resolveBottomCellYFromOffsets,
  resolveBottomFrozenTop,
} from '../src/grid-layout'

describe('clampFrozenBottomCount', () => {
  it('夹取为非负整数', () => {
    expect(clampFrozenBottomCount(2)).toBe(2)
    expect(clampFrozenBottomCount(1.8)).toBe(1)
    expect(clampFrozenBottomCount(-3)).toBe(0)
    expect(clampFrozenBottomCount(Number.NaN)).toBe(0)
    expect(clampFrozenBottomCount(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('computeScrollableViewportHeight / computeMaxScrollTop（扣除底部冻结行高）', () => {
  it('无冻结：等于视口高度与 contentHeight - viewportHeight', () => {
    expect(computeScrollableViewportHeight(500, 0, 0)).toBe(500)
    expect(computeMaxScrollTop(1000, 500, 0, 0)).toBe(500)
  })

  it('同时存在顶部与底部冻结行：正确扣除两段冻结高并夹取非负', () => {
    // 视口 500 = 顶部冻结 64 + 可滚动视口 404 + 底部冻结 32
    expect(computeScrollableViewportHeight(500, 64, 32)).toBe(404)
    // 内容总高 1000（可滚动内容 936），滚动到底时 maxScrollTop = 936 - 404 = 532
    expect(computeMaxScrollTop(1000, 500, 64, 32)).toBe(532)
    // 内容少于可滚动视口时 maxScrollTop 夹取为 0
    expect(computeMaxScrollTop(300, 500, 64, 32)).toBe(0)
    // 极小视口（小于冻结高总和）夹取为 0
    expect(computeScrollableViewportHeight(80, 64, 32)).toBe(0)
    expect(computeMaxScrollTop(300, 80, 64, 32)).toBe(236)
  })
})

describe('resolveBottomFrozenTop / resolveBottomCellYFromOffsets / findBottomRowAt', () => {
  const bottomOffsets = computeRowOffsets(2, 32) // [0, 32, 64]

  it('底部冻结带顶缘钉固于视口底部，极小视口时不压过列头', () => {
    expect(resolveBottomFrozenTop(36, 400, 64)).toBe(36 + 400 - 64)
    expect(resolveBottomFrozenTop(36, 40, 64)).toBe(36)
  })

  it('逐行解析底部冻结行 y 坐标与命中索引', () => {
    // 列头 36 + 视口 400 → 底部冻结带 [372, 436)
    expect(resolveBottomCellYFromOffsets(0, bottomOffsets, 36, 400)).toBe(372)
    expect(resolveBottomCellYFromOffsets(1, bottomOffsets, 36, 400)).toBe(404)

    expect(findBottomRowAt(bottomOffsets, 371.9, 36, 400)).toBe(-1)
    expect(findBottomRowAt(bottomOffsets, 372, 36, 400)).toBe(0)
    expect(findBottomRowAt(bottomOffsets, 403.9, 36, 400)).toBe(0)
    expect(findBottomRowAt(bottomOffsets, 404, 36, 400)).toBe(1)
    expect(findBottomRowAt(bottomOffsets, 435.9, 36, 400)).toBe(1)
    expect(findBottomRowAt(bottomOffsets, 436, 36, 400)).toBe(-1)
  })

  it('无底部冻结行时 findBottomRowAt 恒返回 -1', () => {
    expect(findBottomRowAt([0], 380, 36, 400)).toBe(-1)
  })
})
