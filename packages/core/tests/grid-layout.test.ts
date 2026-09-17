import { describe, expect, it } from 'vitest'

import {
  computeColOffsets,
  computeColWindow,
  computeRowOffsets,
  computeRowWindow,
  computeRowWindowFromOffsets,
  findColAt,
  findRowAt,
  type WindowRange,
} from '../src/grid-layout'

describe('computeRowWindow', () => {
  it('顶部起点：含底部部分可见行', () => {
    // 视口 100px、行高 32：行 0..3（第 4 行部分可见）
    expect(computeRowWindow(0, 100, 1000, 32)).toEqual({ start: 0, end: 4 })
  })

  it('滚动到中间：含上下边缘部分可见行', () => {
    expect(computeRowWindow(50, 64, 1000, 32)).toEqual({ start: 1, end: 4 })
  })

  it('滚动到底部：夹取到最后一行', () => {
    const maxTop = 1000 * 32 - 100
    expect(computeRowWindow(maxTop, 100, 1000, 32)).toEqual({ start: 996, end: 1000 })
  })

  it('空数据或零尺寸：空窗口', () => {
    expect(computeRowWindow(0, 100, 0, 32)).toEqual({ start: 0, end: 0 })
    expect(computeRowWindow(0, 0, 100, 32)).toEqual({ start: 0, end: 0 })
  })
})

describe('computeColOffsets / computeColWindow', () => {
  it('前缀和：offsets[i] 为第 i 列左缘，末尾为内容总宽', () => {
    expect(computeColOffsets([100, 50, 200])).toEqual([0, 100, 150, 350])
  })

  it('变宽列窗口：含左右边缘部分可见列', () => {
    const offsets = computeColOffsets([100, 50, 200, 100])
    // scrollLeft 120 落在列 1（100..150），视口 200 → 右缘 320 落在列 2（150..350）
    expect(computeColWindow(120, 200, offsets)).toEqual({ start: 1, end: 3 })
  })

  it('首列对齐边界时从 0 开始', () => {
    const offsets = computeColOffsets([100, 100])
    expect(computeColWindow(0, 100, offsets)).toEqual({ start: 0, end: 1 })
  })

  it('空列：空窗口', () => {
    expect(computeColWindow(0, 100, computeColOffsets([]))).toEqual({ start: 0, end: 0 })
  })
})

describe('findRowAt / findColAt', () => {
  it('内容坐标命中行/列；越界与空表返回 -1', () => {
    const rowOffsets = computeRowOffsets(50, 32)
    expect(findRowAt(rowOffsets, 0)).toBe(0)
    expect(findRowAt(rowOffsets, 31.5)).toBe(0)
    expect(findRowAt(rowOffsets, 32)).toBe(1)
    expect(findRowAt(rowOffsets, 50 * 32 - 1)).toBe(49)
    expect(findRowAt(rowOffsets, 50 * 32)).toBe(-1)
    expect(findRowAt(rowOffsets, -1)).toBe(-1)
    expect(findRowAt(computeRowOffsets(0, 32), 0)).toBe(-1)
    expect(findColAt(computeColOffsets([100, 50, 200]), 149)).toBe(1)
    expect(findColAt(computeColOffsets([100, 50, 200]), 350)).toBe(-1)
  })

  it('大表深处命中：二分定位不随行数线性增长', () => {
    const rowOffsets = computeRowOffsets(100000, 32)
    expect(findRowAt(rowOffsets, 99999 * 32 + 16)).toBe(99999)
    expect(findRowAt(rowOffsets, 50000 * 32)).toBe(50000)
    const colOffsets = computeColOffsets(Array.from({ length: 5000 }, () => 80))
    expect(findColAt(colOffsets, 4999 * 80 + 1)).toBe(4999)
  })

  it('并列前缀和（零宽列）：命中取起点不超过坐标的最右索引', () => {
    const offsets = [0, 10, 10, 10, 30]
    expect(findColAt(offsets, 9.5)).toBe(0)
    expect(findColAt(offsets, 10)).toBe(3)
    expect(findColAt(offsets, 29)).toBe(3)
    expect(findColAt(offsets, 30)).toBe(-1)
  })
})

describe('深滚动位置窗口（start 二分定位）', () => {
  /** 旧线性扫描参照（start 自 0 推进 + end 短程扫描），作二分实现的逐点等价基准 */
  function linearWindow(scroll: number, viewport: number, offsets: readonly number[]): WindowRange {
    const count = offsets.length - 1
    let start = 0
    while (start < count - 1 && (offsets[start + 1] ?? 0) <= scroll) {
      start++
    }
    let end = start
    const bound = scroll + viewport
    while (end < count && (offsets[end] ?? 0) < bound) {
      end++
    }
    return { start, end }
  }

  it('大表深处滚动：行窗口与线性扫描逐点等价（顶/中/底/越界）', () => {
    const rowOffsets = computeRowOffsets(100000, 32)
    const scrolls = [
      0,
      1,
      31.9,
      32,
      50000 * 32,
      99999 * 32,
      100000 * 32 - 100,
      100000 * 32,
      100000 * 32 + 500,
      -5,
    ]
    for (const top of scrolls) {
      expect(computeRowWindowFromOffsets(top, 100, rowOffsets)).toEqual(
        linearWindow(top, 100, rowOffsets),
      )
    }
  })

  it('深滚动抽样扫描 10 万行等行高前缀和：全区间与线性扫描等价', () => {
    const rowOffsets = computeRowOffsets(100000, 32)
    const total = 100000 * 32
    for (let top = 0; top <= total; top += 997) {
      expect(computeRowWindowFromOffsets(top, 100, rowOffsets)).toEqual(
        linearWindow(top, 100, rowOffsets),
      )
    }
  })

  it('变宽列与零宽列（并列前缀和）深处：列窗口与线性扫描逐点等价', () => {
    const colWidths = Array.from({ length: 2000 }, (_, i) => (i % 50 === 0 ? 0 : 80))
    const colOffsets = computeColOffsets(colWidths)
    for (let left = 0; left <= 2000 * 80; left += 997) {
      expect(computeColWindow(left, 300, colOffsets)).toEqual(linearWindow(left, 300, colOffsets))
    }
  })
})
