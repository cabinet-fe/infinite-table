// 共享 resize 几何测试：方向 → 光标全表（8 方向逐字面锁死）、手柄方块命中边界（半开区间）。
// 纯函数，不挂 DOM——方向语义在这里锁死，FloatObjectLayer 手柄与区域边缘拖拽共用。
import { describe, expect, it } from 'vitest'

import { cursorForEdge, hitSquare } from '../../src/interaction/resize-geometry'

describe('cursorForEdge（边 → 指针样式，全 8 方向）', () => {
  it('正边：横向 ew、纵向 ns', () => {
    expect(cursorForEdge('left')).toBe('ew-resize')
    expect(cursorForEdge('right')).toBe('ew-resize')
    expect(cursorForEdge('top')).toBe('ns-resize')
    expect(cursorForEdge('bottom')).toBe('ns-resize')
  })

  it('对角：主对角线 nwse、副对角线 nesw', () => {
    expect(cursorForEdge('top-left')).toBe('nwse-resize')
    expect(cursorForEdge('bottom-right')).toBe('nwse-resize')
    expect(cursorForEdge('top-right')).toBe('nesw-resize')
    expect(cursorForEdge('bottom-left')).toBe('nesw-resize')
  })
})

describe('hitSquare（手柄方块命中，中心点 + 边长）', () => {
  it('中心命中、边缘内命中', () => {
    expect(hitSquare(50, 50, 50, 50, 8)).toBe(true)
    expect(hitSquare(53, 53, 50, 50, 8)).toBe(true)
    expect(hitSquare(46.5, 49, 50, 50, 8)).toBe(true)
  })

  it('半开区间：右/下边界恰好不命中，左/上边界命中', () => {
    expect(hitSquare(54, 50, 50, 50, 8)).toBe(false)
    expect(hitSquare(50, 54, 50, 50, 8)).toBe(false)
    expect(hitSquare(46, 46, 50, 50, 8)).toBe(true)
  })
})
