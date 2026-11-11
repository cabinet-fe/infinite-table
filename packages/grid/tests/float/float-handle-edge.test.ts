// floatHandleEdge 测试：8 缩放手柄名 → 共享 8 方向边，逐一锁死（旋转手柄不在映射域）。
import { describe, expect, it } from 'vitest'

import { floatHandleEdge, type FloatTransformHandle } from '../../src/float/float-object-layer'
import { cursorForEdge } from '../../src/interaction/resize-geometry'

const EXPECTED: Record<Exclude<FloatTransformHandle, 'rotate'>, string> = {
  'left-top': 'top-left',
  'center-top': 'top',
  'right-top': 'top-right',
  'left-middle': 'left',
  'right-middle': 'right',
  'left-bottom': 'bottom-left',
  'center-bottom': 'bottom',
  'right-bottom': 'bottom-right',
}

describe('floatHandleEdge（缩放手柄 → 共享 8 方向边）', () => {
  it('8 手柄逐一换算正确', () => {
    for (const [handle, edge] of Object.entries(EXPECTED)) {
      expect(floatHandleEdge(handle as keyof typeof EXPECTED)).toBe(edge)
    }
  })

  it('经 cursorForEdge 还原既有光标口径（对角/正边与旧字面表一致）', () => {
    expect(cursorForEdge(floatHandleEdge('left-top'))).toBe('nwse-resize')
    expect(cursorForEdge(floatHandleEdge('right-bottom'))).toBe('nwse-resize')
    expect(cursorForEdge(floatHandleEdge('right-top'))).toBe('nesw-resize')
    expect(cursorForEdge(floatHandleEdge('left-bottom'))).toBe('nesw-resize')
    expect(cursorForEdge(floatHandleEdge('center-top'))).toBe('ns-resize')
    expect(cursorForEdge(floatHandleEdge('left-middle'))).toBe('ew-resize')
  })
})
