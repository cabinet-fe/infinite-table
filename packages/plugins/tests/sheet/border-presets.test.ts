// 边框预设展开单测：8 预设 × 5 线型映射，逐格 border 片段语义对齐 ultra-ui border-presets
// （差异：不做邻居共享边回写——core 共享边裁决保证单侧设置即正确显示）。

import { describe, expect, it } from 'vitest'

import { borderPresetLine, buildBorderPresetCells } from '../../src/sheet/border-presets'

/** 2 行 × 2 列选区（B2:C3） */
const BOUNDS = { minCol: 1, minRow: 1, maxCol: 2, maxRow: 2 }
const EDGE = { width: 2, color: '#000' }

/** 按坐标索引展开结果 */
function byCell(items: ReturnType<typeof buildBorderPresetCells>) {
  return new Map(items.map((item) => [`${item.col},${item.row}`, item.border]))
}

describe('borderPresetLine 线型映射', () => {
  it('thin/medium/thick → solid 1/2/3px；dashed/dotted 同名线型宽 1', () => {
    expect(borderPresetLine('thin', '#111')).toEqual({ width: 1, color: '#111' })
    expect(borderPresetLine('medium', '#111')).toEqual({ width: 2, color: '#111' })
    expect(borderPresetLine('thick', '#111')).toEqual({ width: 3, color: '#111' })
    expect(borderPresetLine('dashed', '#111')).toEqual({ width: 1, color: '#111', style: 'dashed' })
    expect(borderPresetLine('dotted', '#111')).toEqual({ width: 1, color: '#111', style: 'dotted' })
  })
})

describe('buildBorderPresetCells 预设展开', () => {
  it('all：选区每格四边', () => {
    const items = buildBorderPresetCells(BOUNDS, 'all', EDGE)
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.border).toEqual({ top: EDGE, right: EDGE, bottom: EDGE, left: EDGE })
    }
  })

  it('outer：边界格只写朝外边（角格两边、边中格一边）', () => {
    const cells = byCell(buildBorderPresetCells(BOUNDS, 'outer', EDGE))
    expect(cells.get('1,1')).toEqual({ top: EDGE, left: EDGE })
    expect(cells.get('2,1')).toEqual({ top: EDGE, right: EDGE })
    expect(cells.get('1,2')).toEqual({ bottom: EDGE, left: EDGE })
    expect(cells.get('2,2')).toEqual({ bottom: EDGE, right: EDGE })
  })

  it('inner：非边界格写朝内边；单格选区为空操作', () => {
    const cells = byCell(buildBorderPresetCells(BOUNDS, 'inner', EDGE))
    expect(cells.get('1,1')).toEqual({ right: EDGE, bottom: EDGE })
    expect(cells.get('2,1')).toEqual({ bottom: EDGE, left: EDGE })
    expect(cells.get('1,2')).toEqual({ top: EDGE, right: EDGE })
    expect(cells.get('2,2')).toEqual({ top: EDGE, left: EDGE })
    expect(
      buildBorderPresetCells({ minCol: 0, minRow: 0, maxCol: 0, maxRow: 0 }, 'inner', EDGE),
    ).toEqual([])
  })

  it('top/bottom：边界行写对应边，其余格不产出写入项', () => {
    const top = byCell(buildBorderPresetCells(BOUNDS, 'top', EDGE))
    expect(top.get('1,1')).toEqual({ top: EDGE })
    expect(top.get('2,1')).toEqual({ top: EDGE })
    expect(top.size).toBe(2)
    const bottom = byCell(buildBorderPresetCells(BOUNDS, 'bottom', EDGE))
    expect(bottom.get('1,2')).toEqual({ bottom: EDGE })
    expect(bottom.get('2,2')).toEqual({ bottom: EDGE })
    expect(bottom.size).toBe(2)
  })

  it('left/right：边界列写对应边，其余格不产出写入项', () => {
    const left = byCell(buildBorderPresetCells(BOUNDS, 'left', EDGE))
    expect(left.get('1,1')).toEqual({ left: EDGE })
    expect(left.get('1,2')).toEqual({ left: EDGE })
    expect(left.size).toBe(2)
    const right = byCell(buildBorderPresetCells(BOUNDS, 'right', EDGE))
    expect(right.get('2,1')).toEqual({ right: EDGE })
    expect(right.get('2,2')).toEqual({ right: EDGE })
    expect(right.size).toBe(2)
  })

  it('none：每格 border 为 null（清除边框键），edge 无感知', () => {
    const items = buildBorderPresetCells(BOUNDS, 'none', EDGE)
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.border).toBeNull()
    }
  })
})
