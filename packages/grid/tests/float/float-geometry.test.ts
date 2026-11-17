import { describe, expect, it } from 'vitest'

import {
  computeRotatedDeg,
  computeScaledBounds,
  createFloatRotateState,
  createFloatScaleState,
  floatHandleEdge,
  layoutFloatBounds,
  MIN_FLOAT_TRANSFORM_SIZE,
  normalizeDeg,
  resolveAnchorAt,
  rotatedLocalCover,
  SCALE_HANDLES,
  scaleHandleCenter,
  toLocalFloatPoint,
  type FloatAnchor,
  type FloatGeometry,
} from '../../src/float/float-geometry'
import { cursorForEdge } from '../../src/interaction/resize-geometry'

function makeGeometry(scroll = { left: 0, top: 0 }): FloatGeometry {
  return {
    cellOrigin: (col, row) => ({
      x: col * 100 - scroll.left,
      y: row * 32 - scroll.top,
    }),
    cellSize: () => ({ width: 100, height: 32 }),
    cellAtPoint: (x, y) =>
      x < 0 || y < 0
        ? null
        : { col: Math.floor((x + scroll.left) / 100), row: Math.floor((y + scroll.top) / 32) },
  }
}

describe('float-geometry 浮动几何与变换纯数学', () => {
  it('normalizeDeg 与 rotatedLocalCover 计算准确', () => {
    expect(normalizeDeg(-90)).toBe(270)
    expect(normalizeDeg(360)).toBe(0)
    expect(normalizeDeg(405)).toBe(45)

    expect(rotatedLocalCover(100, 40, 0)).toEqual({ x: 0, y: 0, width: 100, height: 40 })
    const rotated90 = rotatedLocalCover(100, 40, 90)
    expect(rotated90.x).toBeCloseTo(30, 6)
    expect(rotated90.y).toBeCloseTo(-30, 6)
    expect(rotated90.width).toBeCloseTo(40, 6)
    expect(rotated90.height).toBeCloseTo(100, 6)
  })

  it('floatHandleEdge 与 scaleHandleCenter 覆盖全部 8 个缩放手柄', () => {
    expect(SCALE_HANDLES).toHaveLength(8)
    expect(cursorForEdge(floatHandleEdge('left-top'))).toBe('nwse-resize')
    expect(cursorForEdge(floatHandleEdge('center-top'))).toBe('ns-resize')
    expect(cursorForEdge(floatHandleEdge('right-middle'))).toBe('ew-resize')
    expect(scaleHandleCenter(1, 1, 200, 60)).toEqual([200, 60])
    expect(scaleHandleCenter(0, -1, 200, 60)).toEqual([100, 0])
  })

  it('layoutFloatBounds 与 resolveAnchorAt 双向换算一致', () => {
    const geo = makeGeometry()
    const anchor: FloatAnchor = {
      from: { col: 1, row: 2 },
      to: { col: 2, row: 3 },
      offsetX: 4,
      offsetY: 8,
    }

    expect(layoutFloatBounds(anchor, undefined, geo)).toEqual({
      x: 104,
      y: 72,
      width: 196,
      height: 56,
    })
    expect(layoutFloatBounds(anchor, { width: 120, height: 80 }, geo)).toEqual({
      x: 104,
      y: 72,
      width: 120,
      height: 80,
    })

    // 平移到 (210, 100) -> col 2, row 3, offset (10, 4)，to 保持 1x1 跨度
    expect(resolveAnchorAt(anchor, 210, 100, geo)).toEqual({
      from: { col: 2, row: 3 },
      to: { col: 3, row: 4 },
      offsetX: 10,
      offsetY: 4,
    })
    // 落在表头带（负坐标）回退原锚点
    expect(resolveAnchorAt(anchor, -10, 10, geo)).toBe(anchor)
  })

  it('toLocalFloatPoint 正确逆旋转指针坐标', () => {
    const bounds = { x: 104, y: 72, width: 196, height: 56 }
    // 中心 (202, 100)，旋转 90° 后 left-top (104, 72) 映射到 (230, 2)
    const local = toLocalFloatPoint(230, 2, bounds, 90)
    expect(local.x).toBeCloseTo(104, 6)
    expect(local.y).toBeCloseTo(72, 6)
  })

  it('createFloatScaleState / computeScaledBounds 支持自由缩放、等比缩放、旋转缩放与最小夹取', () => {
    const bounds = { x: 104, y: 72, width: 196, height: 56 }
    const scaleBottomRight = createFloatScaleState('right-bottom', bounds, 0, 300, 128)!
    expect(computeScaledBounds(scaleBottomRight, 330, 148, false)).toEqual({
      x: 104,
      y: 72,
      width: 226,
      height: 76,
    })
    // 最小尺寸夹取
    expect(computeScaledBounds(scaleBottomRight, 0, 0, false)).toEqual({
      x: 104,
      y: 72,
      width: MIN_FLOAT_TRANSFORM_SIZE,
      height: MIN_FLOAT_TRANSFORM_SIZE,
    })

    // Shift 等比缩放（取两轴较大比例）
    const square = createFloatScaleState(
      'right-bottom',
      { x: 0, y: 0, width: 100, height: 50 },
      0,
      100,
      50,
    )!
    expect(computeScaledBounds(square, 150, 50, true)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 75,
    })
  })

  it('createFloatRotateState / computeRotatedDeg 支持旋转与 Shift 15° 吸附', () => {
    const bounds = { x: 100, y: 50, width: 100, height: 100 }
    // 中心 (150, 100)，起始点击正上方 (150, 30)
    const state = createFloatRotateState(bounds, 0, 150, 30)
    // 移到正右方 (220, 100) -> +90°
    expect(computeRotatedDeg(state, 220, 100, false)).toBe(90)
    // 移到略偏角度并按 Shift -> 吸附到 15° 倍数
    expect(computeRotatedDeg(state, 210, 60, true)).toBe(60)
  })
})
