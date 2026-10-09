import { describe, expect, it } from 'vitest'

import { cellKey, parseRange } from '../../../src/core/address'
import {
  buildBorderPresetItems,
  type BorderPreset,
  type BorderPresetItem,
} from '../../../src/core/style/border-presets'
import type { BorderEdge, CellStyle, CellStylePatch } from '../../../src/core/style/types'

// 纯函数部分：选区内补丁与邻居同步。
// 「边框预设 × SetCellStyleCommand（Sheet 集成）」describe 依赖 sheet.ts 模型
// （setCellStyle/setCellStyles/undo/redo），随 P4 模型层迁入后补回。

const EDGE: BorderEdge = { style: 'thin', width: 1, color: '#000000' }

/** 无任何样式的 getStyle（邻居 null 边只在确有该边时生成） */
const noStyle = (): CellStyle | undefined => undefined

/** 每格四边都有的 getStyle（验证邻居同步全量 null 边） */
const fullStyle = (): CellStyle => ({
  border: { top: { ...EDGE }, right: { ...EDGE }, bottom: { ...EDGE }, left: { ...EDGE } },
})

/** items → Map<cellKey, border patch> 便于按格断言 */
function borderPatchMap(
  items: BorderPresetItem[],
): Map<number, NonNullable<CellStylePatch['border']>> {
  const map = new Map<number, NonNullable<CellStylePatch['border']>>()
  for (const item of items) map.set(cellKey(item.addr), item.patch.border ?? {})
  return map
}

function build(rangeText: string, preset: BorderPreset, getStyle = noStyle) {
  return buildBorderPresetItems(parseRange(rangeText)!, preset, EDGE, getStyle)
}

describe('buildBorderPresetItems：选区内补丁', () => {
  it('1x1：全边框 = 四边写入；外边框同；下边框仅 bottom；内边框空；无边框四边 null', () => {
    const all = borderPatchMap(build('B2', 'all'))
    expect(all.get(cellKey({ row: 1, col: 1 }))).toEqual({
      top: EDGE,
      right: EDGE,
      bottom: EDGE,
      left: EDGE,
    })
    expect(all.size).toBe(1)

    const outer = borderPatchMap(build('B2', 'outer'))
    expect(outer.get(cellKey({ row: 1, col: 1 }))).toEqual({
      top: EDGE,
      right: EDGE,
      bottom: EDGE,
      left: EDGE,
    })
    expect(outer.size).toBe(1)

    const bottom = borderPatchMap(build('B2', 'bottom'))
    expect(bottom.get(cellKey({ row: 1, col: 1 }))).toEqual({ bottom: EDGE })

    expect(build('B2', 'inner')).toHaveLength(0)

    const none = borderPatchMap(build('B2', 'none'))
    expect(none.get(cellKey({ row: 1, col: 1 }))).toEqual({
      top: null,
      right: null,
      bottom: null,
      left: null,
    })
  })

  it('2x2 外边框：每格只写包围盒外缘边', () => {
    const map = borderPatchMap(build('A1:B2', 'outer'))
    expect(map.size).toBe(4)
    expect(map.get(cellKey({ row: 0, col: 0 }))).toEqual({ top: EDGE, left: EDGE })
    expect(map.get(cellKey({ row: 0, col: 1 }))).toEqual({ top: EDGE, right: EDGE })
    expect(map.get(cellKey({ row: 1, col: 0 }))).toEqual({ bottom: EDGE, left: EDGE })
    expect(map.get(cellKey({ row: 1, col: 1 }))).toEqual({ bottom: EDGE, right: EDGE })
  })

  it('3x3 外边框：中心格无补丁，边格一边、角格两边', () => {
    const map = borderPatchMap(build('A1:C3', 'outer'))
    expect(map.size).toBe(8)
    expect(map.has(cellKey({ row: 1, col: 1 }))).toBe(false) // 中心格
    expect(map.get(cellKey({ row: 0, col: 1 }))).toEqual({ top: EDGE })
    expect(map.get(cellKey({ row: 1, col: 0 }))).toEqual({ left: EDGE })
    expect(map.get(cellKey({ row: 1, col: 2 }))).toEqual({ right: EDGE })
    expect(map.get(cellKey({ row: 2, col: 1 }))).toEqual({ bottom: EDGE })
    expect(map.get(cellKey({ row: 0, col: 0 }))).toEqual({ top: EDGE, left: EDGE })
    expect(map.get(cellKey({ row: 2, col: 2 }))).toEqual({ bottom: EDGE, right: EDGE })
  })

  it('单行 / 单列外边框：每格写上下（或左右）+ 端点边', () => {
    const row = borderPatchMap(build('A1:C1', 'outer'))
    expect(row.size).toBe(3)
    expect(row.get(cellKey({ row: 0, col: 0 }))).toEqual({ top: EDGE, bottom: EDGE, left: EDGE })
    expect(row.get(cellKey({ row: 0, col: 1 }))).toEqual({ top: EDGE, bottom: EDGE })
    expect(row.get(cellKey({ row: 0, col: 2 }))).toEqual({ top: EDGE, bottom: EDGE, right: EDGE })

    const col = borderPatchMap(build('A1:A3', 'outer'))
    expect(col.size).toBe(3)
    expect(col.get(cellKey({ row: 0, col: 0 }))).toEqual({ top: EDGE, left: EDGE, right: EDGE })
    expect(col.get(cellKey({ row: 1, col: 0 }))).toEqual({ left: EDGE, right: EDGE })
    expect(col.get(cellKey({ row: 2, col: 0 }))).toEqual({ bottom: EDGE, left: EDGE, right: EDGE })
  })

  it('全边框：共享边双写一致（相邻格对侧边同一样式），不触碰选区外', () => {
    const items = build('A1:B2', 'all', fullStyle)
    const map = borderPatchMap(items)
    expect(map.size).toBe(4) // 仅选区 4 格，无邻居补丁
    for (const border of map.values()) {
      expect(border).toEqual({ top: EDGE, right: EDGE, bottom: EDGE, left: EDGE })
    }
    // 竖向共享边：A1.right 与 B1.left 同一样式
    expect(map.get(cellKey({ row: 0, col: 0 }))?.right).toEqual(
      map.get(cellKey({ row: 0, col: 1 }))?.left,
    )
  })

  it('下边框：仅底行写 bottom（多行选区只作用底行）', () => {
    const map = borderPatchMap(build('A1:C3', 'bottom'))
    expect(map.size).toBe(3)
    for (let col = 0; col <= 2; col++) {
      expect(map.get(cellKey({ row: 2, col }))).toEqual({ bottom: EDGE })
    }
  })

  it('上边框：仅顶行写 top（多行选区只作用顶行）', () => {
    const map = borderPatchMap(build('A1:C3', 'top'))
    expect(map.size).toBe(3)
    for (let col = 0; col <= 2; col++) {
      expect(map.get(cellKey({ row: 0, col }))).toEqual({ top: EDGE })
    }
  })

  it('左边框：仅左列写 left（多列选区只作用左列）', () => {
    const map = borderPatchMap(build('A1:C3', 'left'))
    expect(map.size).toBe(3)
    for (let row = 0; row <= 2; row++) {
      expect(map.get(cellKey({ row, col: 0 }))).toEqual({ left: EDGE })
    }
  })

  it('右边框：仅右列写 right（多列选区只作用右列）', () => {
    const map = borderPatchMap(build('A1:C3', 'right'))
    expect(map.size).toBe(3)
    for (let row = 0; row <= 2; row++) {
      expect(map.get(cellKey({ row, col: 2 }))).toEqual({ right: EDGE })
    }
  })

  it('内边框：共享边双写一致，不写外缘；单格选区 = 空操作', () => {
    expect(build('B2', 'inner')).toHaveLength(0)

    const map = borderPatchMap(build('A1:B2', 'inner'))
    expect(map.size).toBe(4)
    // 竖向共享边：A1.right ↔ B1.left；横向共享边：A1.bottom ↔ A2.top
    expect(map.get(cellKey({ row: 0, col: 0 }))).toEqual({ right: EDGE, bottom: EDGE })
    expect(map.get(cellKey({ row: 0, col: 1 }))).toEqual({ left: EDGE, bottom: EDGE })
    expect(map.get(cellKey({ row: 1, col: 0 }))).toEqual({ right: EDGE, top: EDGE })
    expect(map.get(cellKey({ row: 1, col: 1 }))).toEqual({ left: EDGE, top: EDGE })
    expect(map.get(cellKey({ row: 0, col: 0 }))?.right).toEqual(
      map.get(cellKey({ row: 0, col: 1 }))?.left,
    )
  })

  it('3x3 内边框：中心格四边、边格三边、角格两边；无外缘边', () => {
    const map = borderPatchMap(build('A1:C3', 'inner'))
    expect(map.size).toBe(9)
    expect(map.get(cellKey({ row: 1, col: 1 }))).toEqual({
      top: EDGE,
      right: EDGE,
      bottom: EDGE,
      left: EDGE,
    })
    expect(map.get(cellKey({ row: 0, col: 1 }))).toEqual({ right: EDGE, bottom: EDGE, left: EDGE })
    expect(map.get(cellKey({ row: 0, col: 0 }))).toEqual({ right: EDGE, bottom: EDGE })
    // 外缘边不写
    expect(map.get(cellKey({ row: 0, col: 0 }))).not.toHaveProperty('top')
    expect(map.get(cellKey({ row: 0, col: 0 }))).not.toHaveProperty('left')
  })

  it('单行 / 单列内边框：只产生内部竖边 / 横边', () => {
    const row = borderPatchMap(build('A1:C1', 'inner'))
    expect(row.size).toBe(3)
    expect(row.get(cellKey({ row: 0, col: 0 }))).toEqual({ right: EDGE })
    expect(row.get(cellKey({ row: 0, col: 1 }))).toEqual({ left: EDGE, right: EDGE })
    expect(row.get(cellKey({ row: 0, col: 2 }))).toEqual({ left: EDGE })

    const col = borderPatchMap(build('A1:A3', 'inner'))
    expect(col.size).toBe(3)
    expect(col.get(cellKey({ row: 0, col: 0 }))).toEqual({ bottom: EDGE })
    expect(col.get(cellKey({ row: 1, col: 0 }))).toEqual({ top: EDGE, bottom: EDGE })
    expect(col.get(cellKey({ row: 2, col: 0 }))).toEqual({ top: EDGE })
  })
})

describe('buildBorderPresetItems：邻居同步（共享边置空）', () => {
  it('外边框：选区外一圈邻居的对侧边写 null（确有该边才生成）', () => {
    const items = build('B2:C3', 'outer', fullStyle)
    const map = borderPatchMap(items)
    // 选区 4 格 + 邻居 8 格（四侧各 2 格）
    expect(map.size).toBe(12)
    // 上缘邻居（第 1 行）bottom: null
    expect(map.get(cellKey({ row: 0, col: 1 }))).toEqual({ bottom: null })
    expect(map.get(cellKey({ row: 0, col: 2 }))).toEqual({ bottom: null })
    // 下缘邻居（第 4 行）top: null
    expect(map.get(cellKey({ row: 3, col: 1 }))).toEqual({ top: null })
    expect(map.get(cellKey({ row: 3, col: 2 }))).toEqual({ top: null })
    // 左缘邻居（A 列）right: null
    expect(map.get(cellKey({ row: 1, col: 0 }))).toEqual({ right: null })
    expect(map.get(cellKey({ row: 2, col: 0 }))).toEqual({ right: null })
    // 右缘邻居（D 列）left: null
    expect(map.get(cellKey({ row: 1, col: 3 }))).toEqual({ left: null })
    expect(map.get(cellKey({ row: 2, col: 3 }))).toEqual({ left: null })
  })

  it('邻居无对应边时不生成补丁（noStyle → 无邻居项）', () => {
    expect(build('B2:C3', 'outer', noStyle)).toHaveLength(4)
    expect(build('B2:C3', 'none', noStyle)).toHaveLength(4)
    expect(build('B2:C3', 'bottom', noStyle)).toHaveLength(2)
    expect(build('B2:C3', 'top', noStyle)).toHaveLength(2)
    expect(build('B2:C3', 'left', noStyle)).toHaveLength(2)
    expect(build('B2:C3', 'right', noStyle)).toHaveLength(2)
    expect(build('B2:C3', 'inner', noStyle)).toHaveLength(4)
  })

  it('下边框：只同步底行下一行邻居的 top', () => {
    const items = build('B2:C3', 'bottom', fullStyle)
    const map = borderPatchMap(items)
    // 底行 2 格 + 下一行邻居 2 格（无其他侧邻居）
    expect(map.size).toBe(4)
    expect(map.get(cellKey({ row: 3, col: 1 }))).toEqual({ top: null })
    expect(map.get(cellKey({ row: 3, col: 2 }))).toEqual({ top: null })
  })

  it('上边框：只同步顶行上一行邻居的 bottom', () => {
    const items = build('B2:C3', 'top', fullStyle)
    const map = borderPatchMap(items)
    // 顶行 2 格 + 上一行邻居 2 格
    expect(map.size).toBe(4)
    expect(map.get(cellKey({ row: 0, col: 1 }))).toEqual({ bottom: null })
    expect(map.get(cellKey({ row: 0, col: 2 }))).toEqual({ bottom: null })
  })

  it('左边框：只同步左列左侧邻居的 right', () => {
    const items = build('B2:C3', 'left', fullStyle)
    const map = borderPatchMap(items)
    // 左列 2 格 + 左侧邻居 2 格
    expect(map.size).toBe(4)
    expect(map.get(cellKey({ row: 1, col: 0 }))).toEqual({ right: null })
    expect(map.get(cellKey({ row: 2, col: 0 }))).toEqual({ right: null })
  })

  it('右边框：只同步右列右侧邻居的 left', () => {
    const items = build('B2:C3', 'right', fullStyle)
    const map = borderPatchMap(items)
    // 右列 2 格 + 右侧邻居 2 格
    expect(map.size).toBe(4)
    expect(map.get(cellKey({ row: 1, col: 3 }))).toEqual({ left: null })
    expect(map.get(cellKey({ row: 2, col: 3 }))).toEqual({ left: null })
  })

  it('内边框：不触碰选区外邻居（即使邻居有边）', () => {
    const items = build('B2:C3', 'inner', fullStyle)
    const map = borderPatchMap(items)
    // 仅选区 4 格，无邻居补丁
    expect(map.size).toBe(4)
    expect(map.has(cellKey({ row: 0, col: 1 }))).toBe(false)
    expect(map.has(cellKey({ row: 3, col: 1 }))).toBe(false)
    expect(map.has(cellKey({ row: 1, col: 0 }))).toBe(false)
    expect(map.has(cellKey({ row: 1, col: 3 }))).toBe(false)
  })

  it('无边框：选区四边 null + 选区外一圈邻居对侧边 null', () => {
    const items = build('B2:C3', 'none', fullStyle)
    const map = borderPatchMap(items)
    expect(map.size).toBe(12)
    expect(map.get(cellKey({ row: 1, col: 1 }))).toEqual({
      top: null,
      right: null,
      bottom: null,
      left: null,
    })
    expect(map.get(cellKey({ row: 0, col: 1 }))).toEqual({ bottom: null })
    expect(map.get(cellKey({ row: 1, col: 3 }))).toEqual({ left: null })
  })

  it('选区贴表格边缘（A1 起）：越界侧不产生邻居补丁', () => {
    const items = build('A1:B1', 'outer', fullStyle)
    const map = borderPatchMap(items)
    // 选区 2 格 + 下缘邻居 2 格 + 右缘邻居 1 格（上/左越界）
    expect(map.size).toBe(5)
    expect(map.get(cellKey({ row: 1, col: 0 }))).toEqual({ top: null })
    expect(map.get(cellKey({ row: 0, col: 2 }))).toEqual({ left: null })
  })
})
