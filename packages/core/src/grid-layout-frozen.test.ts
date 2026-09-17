import { describe, expect, it } from 'vitest'

import {
  clampFrozenCount,
  computeColOffsets,
  computeScrollableColWindow,
  computeScrollableRowWindow,
  resolveCellX,
  resolveCellY,
} from './grid-layout'

describe('clampFrozenCount', () => {
  it('夹取到 [0, total]', () => {
    expect(clampFrozenCount(2, 10)).toBe(2)
    expect(clampFrozenCount(-1, 10)).toBe(0)
    expect(clampFrozenCount(20, 10)).toBe(10)
  })
})

describe('computeScrollableRowWindow（冻结行下的滚动区行窗口）', () => {
  it('无冻结：退化为 computeRowWindow', () => {
    expect(computeScrollableRowWindow(50, 64, 1000, 32, 0)).toEqual({ start: 1, end: 4 })
  })

  it('冻结 2 行：窗口不含冻结行，随滚动位置滑动', () => {
    // 冻结行高 64；scrollTop 0 时滚动区顶部即行 2
    expect(computeScrollableRowWindow(0, 96, 1000, 32, 2)).toEqual({ start: 2, end: 5 })
    // scrollTop 32：行 2 滚出，窗口从行 3 起
    expect(computeScrollableRowWindow(32, 96, 1000, 32, 2)).toEqual({ start: 3, end: 6 })
  })

  it('滚动位置不超过滚动区：窗口不会回退进冻结行', () => {
    expect(computeScrollableRowWindow(0, 96, 1000, 32, 2).start).toBe(2)
  })
})

describe('computeScrollableColWindow（冻结列下的滚动区列窗口）', () => {
  it('无冻结：退化为 computeColWindow', () => {
    const offsets = computeColOffsets([100, 50, 200, 100])
    expect(computeScrollableColWindow(120, 200, offsets, 0)).toEqual({ start: 1, end: 3 })
  })

  it('冻结 1 列：窗口不含冻结列，滚动位置定义在扣除冻结列的可滚动内容上', () => {
    const offsets = computeColOffsets([100, 50, 200, 100])
    // 冻结列宽 100；scrollLeft 20 落在列 1（可滚动内容 20..70），视口 200 → 右缘 220 落在列 2
    expect(computeScrollableColWindow(20, 200, offsets, 1)).toEqual({ start: 1, end: 3 })
    expect(computeScrollableColWindow(0, 50, offsets, 1)).toEqual({ start: 1, end: 2 })
  })
})

describe('resolveCellX / resolveCellY（冻结区固定、滚动区平移）', () => {
  const offsets = computeColOffsets([100, 100, 100])

  it('冻结列不随 scrollLeft 移动', () => {
    expect(resolveCellX(0, 500, offsets, 1, 48)).toBe(48)
    expect(resolveCellX(1, 500, offsets, 1, 48)).toBe(48 + 100 - 500)
  })

  it('冻结行不随 scrollTop 移动', () => {
    expect(resolveCellY(0, 500, 32, 1, 36)).toBe(36)
    expect(resolveCellY(1, 500, 32, 1, 36)).toBe(36 + 32 - 500)
  })
})
