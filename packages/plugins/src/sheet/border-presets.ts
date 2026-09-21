// 边框预设展开（纯函数）：「全边框/外边框/内边框/单侧边框/无边框」8 预设 × 5 线型 × 调色板
// 颜色，展开为选区每格应写的 border 片段集合，供工具栏边框面板一次写入（SheetStore.setStyle）。
// 语义参照 ultra-ui sheet-core border-presets，但不做邻居共享边回写：
// core 共享边裁决（shared-edges.ts，写入侧无需感知）已保证单侧设置即正确显示——
// 共享边由左/上格（所有者）统一绘制并并入邻居对侧强边，双侧双写不再必要也不会叠画。

import type { CellBorder, CellBorderEdge, RangeBounds } from '@infinite-table/core'

/** 边框预设 */
export type BorderPreset = 'outer' | 'inner' | 'all' | 'top' | 'bottom' | 'left' | 'right' | 'none'

/** 边框线型：thin/medium/thick 为 solid 各宽度（1/2/3），dashed/dotted 同名线型 */
export type BorderLineStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted'

/** 预设展开后的逐格写入项：border 为该格应写的整体边框片段；null 表示清除该格边框键 */
export interface BorderPresetCell {
  col: number
  row: number
  border: CellBorder | null
}

/** 线型 + 颜色 → 边定义（thin=1/medium=2/thick=3 solid；dashed/dotted 宽 1 同名线型） */
export function borderPresetLine(style: BorderLineStyle, color: string): CellBorderEdge {
  switch (style) {
    case 'medium':
      return { width: 2, color }
    case 'thick':
      return { width: 3, color }
    case 'dashed':
      return { width: 1, color, style: 'dashed' }
    case 'dotted':
      return { width: 1, color, style: 'dotted' }
    default:
      return { width: 1, color }
  }
}

/**
 * 边框预设 → 选区逐格 border 片段集合。
 * - all：每格四边；outer：边界格写朝外边；inner：非边界格写朝内边（单格选区 = 空集合）；
 * - top/bottom/left/right：对应边界行/列写该边；
 * - none：每格 border 为 null（调用方清除边框键），edge 参数无感知。
 */
export function buildBorderPresetCells(
  bounds: RangeBounds,
  preset: BorderPreset,
  edge: CellBorderEdge,
): BorderPresetCell[] {
  const items: BorderPresetCell[] = []
  for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      if (preset === 'none') {
        items.push({ col, row, border: null })
        continue
      }
      const atTop = row === bounds.minRow
      const atBottom = row === bounds.maxRow
      const atLeft = col === bounds.minCol
      const atRight = col === bounds.maxCol
      const border: CellBorder = {}
      if (preset === 'all' || ((preset === 'outer' || preset === 'top') && atTop)) {
        border.top = edge
      }
      if (preset === 'all' || ((preset === 'outer' || preset === 'right') && atRight)) {
        border.right = edge
      }
      if (preset === 'all' || ((preset === 'outer' || preset === 'bottom') && atBottom)) {
        border.bottom = edge
      }
      if (preset === 'all' || ((preset === 'outer' || preset === 'left') && atLeft)) {
        border.left = edge
      }
      // 内边框：非边界侧 = 内部共享边（裁决后由左/上格呈现，此处双侧写同边语义等价）
      if (preset === 'inner') {
        if (!atTop) {
          border.top = edge
        }
        if (!atBottom) {
          border.bottom = edge
        }
        if (!atLeft) {
          border.left = edge
        }
        if (!atRight) {
          border.right = edge
        }
      }
      // 无边可写（如单格选区的 inner = 空操作）不产出写入项
      if (Object.keys(border).length > 0) {
        items.push({ col, row, border })
      }
    }
  }
  return items
}
