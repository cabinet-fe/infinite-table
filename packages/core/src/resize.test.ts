import { describe, expect, it } from 'vitest'

import {
  hitResizeHandle,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  ResizeSession,
  type ResizeGeometry,
} from './resize'

const COL_OFFSETS = [0, 100, 200, 300]
const ROW_OFFSETS = [0, 32, 64, 96, 128]

/** 无冻结、无滚动的直通几何 */
function makeGeometry(overrides: Partial<ResizeGeometry> = {}): ResizeGeometry {
  return {
    colOffsets: COL_OFFSETS,
    rowOffsets: ROW_OFFSETS,
    rowHeaderWidth: 48,
    headerHeight: 36,
    toContentX: (x) => x - 48,
    toContentY: (y) => y - 36,
    ...overrides,
  }
}

describe('hitResizeHandle 手柄命中', () => {
  it('列头区列右缘命中列手柄', () => {
    // 第 0 列右缘：视口 x = 48 + 100 = 148，列头带内 y = 10
    expect(hitResizeHandle(148, 10, makeGeometry())).toEqual({ kind: 'col', index: 0 })
    expect(hitResizeHandle(148 + 4, 35, makeGeometry())).toEqual({ kind: 'col', index: 0 })
  })

  it('行号列区行下缘命中行手柄（canResizeRow 能力）', () => {
    // 第 1 行下缘：视口 y = 36 + 64 = 100，行号列带内 x = 20
    expect(hitResizeHandle(20, 100, makeGeometry())).toEqual({ kind: 'row', index: 1 })
  })

  it('超过阈值或未在边缘不命中；数据区不命中', () => {
    expect(hitResizeHandle(148 + 5, 10, makeGeometry())).toBeNull()
    expect(hitResizeHandle(100, 100, makeGeometry())).toBeNull()
  })

  it('canResizeCol/canResizeRow 返回 false 时对应手柄被禁用', () => {
    const geo = makeGeometry()
    expect(hitResizeHandle(148, 10, geo, { canResizeCol: (col) => col !== 0 })).toBeNull()
    expect(hitResizeHandle(148, 10, geo, { canResizeCol: () => true })).toEqual({
      kind: 'col',
      index: 0,
    })
    expect(hitResizeHandle(20, 100, geo, { canResizeRow: (row) => row !== 1 })).toBeNull()
  })

  it('滚动/冻结经 toContent 换算后命中（内容坐标与视口坐标分离）', () => {
    // 横向滚动 50：第 1 列右缘内容 x = 200，视口 x = 48 + 200 - 50 = 198
    const scrolled = makeGeometry({ toContentX: (x) => x - 48 + 50 })
    expect(hitResizeHandle(198, 10, scrolled)).toEqual({ kind: 'col', index: 1 })
  })
})

describe('ResizeSession 尺寸计算', () => {
  it('按指针位移求目标尺寸', () => {
    const session = new ResizeSession({ kind: 'col', index: 0 }, 100, 148)
    expect(session.sizeAt(148 + 30)).toBe(130)
    expect(session.sizeAt(148 - 30)).toBe(70)
  })

  it('夹取到最小尺寸', () => {
    const colSession = new ResizeSession({ kind: 'col', index: 0 }, 100, 148)
    expect(colSession.sizeAt(0)).toBe(MIN_COL_WIDTH)
    const rowSession = new ResizeSession({ kind: 'row', index: 1 }, 32, 100)
    expect(rowSession.sizeAt(0)).toBe(MIN_ROW_HEIGHT)
  })
})
