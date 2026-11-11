// 区域交互几何测试：手柄命中、边缘/角落命中与热区、拖拽应用（start ≤ end 恒成立）。
// 纯函数，不挂 DOM——命中口径与拖拽口径在这里锁死。
import { describe, expect, test } from 'vitest'

import {
  REGION_HANDLE_INSET,
  REGION_HANDLE_SIZE,
  REGION_HANDLE_SIZE_ACTIVE,
  hitRegionEdge,
  hitRegionHandle,
  regionBoundsOf,
  regionHandleRect,
  resizeRegionRect,
  type RegionHitTarget,
} from '../../src/interaction/region-interaction'

/** 100×50 的区域矩形（左上 20,10） */
const BOUNDS = { x: 20, y: 10, width: 100, height: 50 }
const TARGETS: RegionHitTarget[] = [{ index: 3, bounds: BOUNDS }]

describe('区域包围盒与手柄矩形', () => {
  test('四角格取并集（任一角不可见 → null）', () => {
    const table = {
      getCellRelativeRect: (col: number, row: number) =>
        col === 0 && row === 0
          ? { x: 20, y: 10, width: 40, height: 20 }
          : col === 2 && row === 1
            ? { x: 80, y: 40, width: 40, height: 20 }
            : null,
    }
    expect(regionBoundsOf(table, { startRow: 0, endRow: 1, startCol: 0, endCol: 2 })).toEqual(
      BOUNDS,
    )
    expect(regionBoundsOf(table, { startRow: 0, endRow: 5, startCol: 0, endCol: 2 })).toBeNull()
  })

  test('手柄矩形贴右下角单元格内角（右/下各内缩，不骑角点）', () => {
    const handle = regionHandleRect(BOUNDS)
    expect(handle).toEqual({
      x: 120 - REGION_HANDLE_INSET - REGION_HANDLE_SIZE,
      y: 60 - REGION_HANDLE_INSET - REGION_HANDLE_SIZE,
      width: REGION_HANDLE_SIZE,
      height: REGION_HANDLE_SIZE,
    })
  })

  test('悬停放大向内扩（右/下内缩不变，不越出区域）', () => {
    const handle = regionHandleRect(BOUNDS, REGION_HANDLE_SIZE_ACTIVE)
    expect(handle).toEqual({
      x: 120 - REGION_HANDLE_INSET - REGION_HANDLE_SIZE_ACTIVE,
      y: 60 - REGION_HANDLE_INSET - REGION_HANDLE_SIZE_ACTIVE,
      width: REGION_HANDLE_SIZE_ACTIVE,
      height: REGION_HANDLE_SIZE_ACTIVE,
    })
  })
})

describe('手柄命中', () => {
  test('命中右下角内角手柄热区（内缩方块 [107,117]×[47,57]）', () => {
    expect(hitRegionHandle(TARGETS, 110, 52)).toBe(3)
    expect(hitRegionHandle(TARGETS, 107, 47)).toBe(3)
    expect(hitRegionHandle(TARGETS, 117, 57)).toBe(3)
  })

  test('右下角点、中心与其它角落不命中', () => {
    // 角点 (120,60) 是选区填充柄的位置，区域手柄已内缩让位
    expect(hitRegionHandle(TARGETS, 120, 60)).toBeUndefined()
    expect(hitRegionHandle(TARGETS, 70, 35)).toBeUndefined()
    expect(hitRegionHandle(TARGETS, 20, 10)).toBeUndefined()
  })
})

describe('边缘/角落命中', () => {
  test('四角优先（两轴都贴边）', () => {
    expect(hitRegionEdge(TARGETS, 20, 10)?.edge).toBe('top-left')
    expect(hitRegionEdge(TARGETS, 120, 10)?.edge).toBe('top-right')
    expect(hitRegionEdge(TARGETS, 20, 60)?.edge).toBe('bottom-left')
    expect(hitRegionEdge(TARGETS, 120, 60)?.edge).toBe('bottom-right')
  })

  test('四边命中（另一轴须在范围内）', () => {
    expect(hitRegionEdge(TARGETS, 70, 10)?.edge).toBe('top')
    expect(hitRegionEdge(TARGETS, 70, 60)?.edge).toBe('bottom')
    expect(hitRegionEdge(TARGETS, 20, 35)?.edge).toBe('left')
    expect(hitRegionEdge(TARGETS, 120, 35)?.edge).toBe('right')
    // 另一轴出界（含热区）→ 不命中
    expect(hitRegionEdge(TARGETS, 70, 75)).toBeUndefined()
    expect(hitRegionEdge(TARGETS, 130, 35)).toBeUndefined()
  })

  test('区域内部不命中（离边超过热区）', () => {
    expect(hitRegionEdge(TARGETS, 70, 30)).toBeUndefined()
  })
})

describe('拖拽应用（resizeRegionRect）', () => {
  const RECT = { startRow: 2, endRow: 5, startCol: 1, endCol: 4 }

  test('按边合入指针地址', () => {
    expect(resizeRegionRect(RECT, 'bottom', { row: 9, col: 0 })).toEqual({ endRow: 9 })
    expect(resizeRegionRect(RECT, 'top', { row: 0, col: 0 })).toEqual({ startRow: 0 })
    expect(resizeRegionRect(RECT, 'left', { row: 0, col: 2 })).toEqual({ startCol: 2 })
    expect(resizeRegionRect(RECT, 'right', { row: 0, col: 8 })).toEqual({ endCol: 8 })
  })

  test('反向拖过头夹回单行/单列（start ≤ end 恒成立）', () => {
    expect(resizeRegionRect(RECT, 'bottom', { row: 0, col: 0 })).toEqual({ endRow: 2 })
    expect(resizeRegionRect(RECT, 'top', { row: 99, col: 0 })).toEqual({ startRow: 5 })
    expect(resizeRegionRect(RECT, 'bottom-right', { row: 0, col: 0 })).toEqual({
      endRow: 2,
      endCol: 1,
    })
  })

  test('角同时合入两轴', () => {
    expect(resizeRegionRect(RECT, 'top-left', { row: 0, col: 0 })).toEqual({
      startRow: 0,
      startCol: 0,
    })
  })
})
