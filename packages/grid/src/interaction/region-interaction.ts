// 格区间区域（region）交互几何（纯函数，不碰 DOM）：右下角手柄命中 + 边缘/角落
// 拖拽命中与应用。宿主画布负责指针事件与提交，宿主 overlay 负责绘制；这里只做
// 几何判定，保证「命中口径」与「拖拽应用口径」可以脱离画布被单元测试锁死。
// 方向语义（边/角词汇、轴向符号、光标）单源于 resize-geometry，与 FloatObjectLayer
// 的变换手柄共用。

import type { CellRange } from '../cell-range'
import { EDGE_SIGN, type ResizeEdge } from './resize-geometry'

/** 视口矩形（与 getCellRelativeRect 同一坐标系） */
export interface RegionRect {
  x: number
  y: number
  width: number
  height: number
}

/** 命中判定输入：区域下标 + 视口矩形 */
export interface RegionHitTarget {
  index: number
  bounds: RegionRect
}

/** 手柄边长（px）：区域右下角单元格内角的可点击小方块 */
export const REGION_HANDLE_SIZE = 10
/** 手柄悬停时的放大边长（px） */
export const REGION_HANDLE_SIZE_ACTIVE = 12
/** 手柄与区域右/下边缘的内缩（px）：手柄整体落在右下角单元格内部，避开骑在角点上的选区填充柄 */
export const REGION_HANDLE_INSET = 3
/** 边缘拖拽命中热区（px） */
export const REGION_EDGE_HIT_PX = 6

/** 网格引擎的最小依赖面：给 col/row 取视口矩形（宿主表格 getTable() 的结构子类型） */
export interface CellRectSource {
  getCellRelativeRect(col: number, row: number): RegionRect | null
}

/** 区域的视口包围盒（四角格取并集；任一角不可见返回 null） */
export function regionBoundsOf(table: CellRectSource, region: CellRange): RegionRect | null {
  const topLeft = table.getCellRelativeRect(region.startCol, region.startRow)
  const bottomRight = table.getCellRelativeRect(region.endCol, region.endRow)
  if (!topLeft || !bottomRight) return null
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x + bottomRight.width - topLeft.x,
    height: bottomRight.y + bottomRight.height - topLeft.y,
  }
}

/** 手柄矩形：右下角单元格内角的小方块（右/下各内缩 REGION_HANDLE_INSET；描边/命中共用同一几何，悬停放大向内扩、不越出区域） */
export function regionHandleRect(bounds: RegionRect, size = REGION_HANDLE_SIZE): RegionRect {
  return {
    x: bounds.x + bounds.width - REGION_HANDLE_INSET - size,
    y: bounds.y + bounds.height - REGION_HANDLE_INSET - size,
    width: size,
    height: size,
  }
}

/** 指针是否落在手柄上（返回区域下标；后画的区域优先——覆盖在手柄上层的那一个） */
export function hitRegionHandle(
  targets: readonly RegionHitTarget[],
  x: number,
  y: number,
): number | undefined {
  for (let i = targets.length - 1; i >= 0; i--) {
    const handle = regionHandleRect(targets[i]!.bounds)
    if (
      x >= handle.x &&
      x <= handle.x + handle.width &&
      y >= handle.y &&
      y <= handle.y + handle.height
    ) {
      return targets[i]!.index
    }
  }
  return undefined
}

/** 指针落在区域边缘热区上（先角后边——角的热区是两边交集，优先级更高） */
export function hitRegionEdge(
  targets: readonly RegionHitTarget[],
  x: number,
  y: number,
): { index: number; edge: ResizeEdge } | undefined {
  const hit = REGION_EDGE_HIT_PX
  for (let i = targets.length - 1; i >= 0; i--) {
    const { bounds } = targets[i]!
    const nearLeft = Math.abs(x - bounds.x) <= hit
    const nearRight = Math.abs(x - (bounds.x + bounds.width)) <= hit
    const nearTop = Math.abs(y - bounds.y) <= hit
    const nearBottom = Math.abs(y - (bounds.y + bounds.height)) <= hit
    // 必须贴边：指针的另一个轴仍要落在区域范围（含热区）内
    const inX = x >= bounds.x - hit && x <= bounds.x + bounds.width + hit
    const inY = y >= bounds.y - hit && y <= bounds.y + bounds.height + hit
    if (!inX || !inY) continue
    let edge: ResizeEdge | undefined
    if (nearTop && nearLeft) edge = 'top-left'
    else if (nearTop && nearRight) edge = 'top-right'
    else if (nearBottom && nearLeft) edge = 'bottom-left'
    else if (nearBottom && nearRight) edge = 'bottom-right'
    else if (nearLeft) edge = 'left'
    else if (nearRight) edge = 'right'
    else if (nearTop) edge = 'top'
    else if (nearBottom) edge = 'bottom'
    if (edge) return { index: targets[i]!.index, edge }
  }
  return undefined
}

/**
 * 拖拽落点应用：按命中的边把指针下的格子地址合入区域矩形（start ≤ end 恒成立，
 * 反向拖过头就夹回单行/单列）。返回要提交给模型写入口径的字段补丁。
 */
export function resizeRegionRect(
  rect: CellRange,
  edge: ResizeEdge,
  addr: { row: number; col: number },
): Partial<CellRange> {
  const { sx, sy } = EDGE_SIGN[edge]
  const patch: Partial<CellRange> = {}
  if (sy < 0) patch.startRow = Math.min(rect.endRow, addr.row)
  if (sy > 0) patch.endRow = Math.max(rect.startRow, addr.row)
  if (sx < 0) patch.startCol = Math.min(rect.endCol, addr.col)
  if (sx > 0) patch.endCol = Math.max(rect.startCol, addr.col)
  return patch
}
