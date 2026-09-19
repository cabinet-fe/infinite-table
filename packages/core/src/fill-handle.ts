// 填充柄交互原语（P0-6）：焦点段右下角方点的几何、命中判定与按下/拖拽结束事件载荷。
// 填充生成算法不在内核——宿主（适配层）据锚定段与拖拽目标范围自行实现 generateFill。

import type { Region } from '@infinite-table/render'

import type { CellRef } from './types'

import {
  normalizeRange,
  type RangeBounds,
  type SelectionRange,
  type SelectionSnapshot,
} from './selection'

/** 填充柄方点边长（px） */
export const FILL_HANDLE_SIZE = 8

/** 填充柄拖拽会话：柄所在选区段、起点（锚定段右下角格）与轴锁定后的终点格、最新指针位置与边缘自动滚动速度 */
export interface FillDragState {
  /** 柄所在的选区段 */
  range: SelectionRange
  /** 拖拽起点（锚定段右下角格） */
  origin: CellRef
  /** 轴锁定后的当前终点格 */
  current: CellRef
  /** 最新指针位置（视口坐标；边缘驻留时帧循环据此续算终点） */
  pointer: { x: number; y: number }
  /** 边缘自动滚动速度（px/帧；指针不在边缘区为 0） */
  edge: { dx: number; dy: number }
}

/**
 * 焦点段：包含焦点格的选区段（填充柄挂在它的右下角）；焦点不在任何段内时取末段。
 * 无选区返回 null。
 */
export function resolveFocusRange(snapshot: SelectionSnapshot): SelectionRange | null {
  const { ranges, focus } = snapshot
  if (ranges.length === 0) {
    return null
  }
  if (focus) {
    const hit = ranges.find((range) => {
      const bounds = normalizeRange(range)
      return (
        focus.col >= bounds.minCol &&
        focus.col <= bounds.maxCol &&
        focus.row >= bounds.minRow &&
        focus.row <= bounds.maxRow
      )
    })
    if (hit) {
      return hit
    }
  }
  return ranges[ranges.length - 1]!
}

/**
 * 填充柄方点矩形：骑在锚定段右下角格（min/max 序的 maxCol/maxRow 格）的右下角点上，
 * 向格内、格外各伸出一半边长。入参为该格在视口中的矩形。
 */
export function fillHandleRect(cellRect: Region): Region {
  const half = FILL_HANDLE_SIZE / 2
  return {
    x: cellRect.x + cellRect.width - half,
    y: cellRect.y + cellRect.height - half,
    width: FILL_HANDLE_SIZE,
    height: FILL_HANDLE_SIZE,
  }
}

/** 填充柄命中判定：点落在柄方点矩形内（入参同 fillHandleRect，为锚定段右下角格矩形） */
export function hitFillHandle(x: number, y: number, cellRect: Region): boolean {
  const rect = fillHandleRect(cellRect)
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

/** 填充柄按下事件：携带柄所在的选区段（start 锚点 / end 焦点，可反向） */
export interface FillHandleDownEvent {
  range: SelectionRange
}

/** 填充柄拖拽结束事件：锚定段范围与拖拽目标格范围（均为 min/max 序边界） */
export interface FillDragEndEvent {
  /** 柄所在选区段的归一化边界 */
  anchor: RangeBounds
  /** 拖拽扫过的目标格范围：从锚定段右下角格起算到拖拽终点格（min/max 序） */
  target: RangeBounds
}

export type FillHandleDownListener = (event: FillHandleDownEvent) => void

export type FillDragEndListener = (event: FillDragEndEvent) => void

/**
 * 轴锁定后的拖拽目标范围：行/列位移绝对值大者为主轴（相等取纵向），
 * 副轴夹回锚定段跨度内——柄方点骑在角点上，裸命中会落到右/下一格，
 * 且拖拽中的横向漂移不应产生侧向填充。目标始终为 origin..current 的 min/max 序。
 */
export function resolveFillTarget(
  anchor: RangeBounds,
  origin: CellRef,
  current: CellRef,
): RangeBounds {
  let col = current.col
  let row = current.row
  if (Math.abs(current.row - origin.row) >= Math.abs(current.col - origin.col)) {
    col = Math.min(Math.max(col, anchor.minCol), anchor.maxCol)
  } else {
    row = Math.min(Math.max(row, anchor.minRow), anchor.maxRow)
  }
  return {
    minCol: Math.min(origin.col, col),
    minRow: Math.min(origin.row, row),
    maxCol: Math.max(origin.col, col),
    maxRow: Math.max(origin.row, row),
  }
}

/** 拖拽预览区（target 减去锚定段重叠后的纯扩展区）；无扩展返回 null */
export function resolveFillPreview(anchor: RangeBounds, target: RangeBounds): RangeBounds | null {
  if (target.maxRow > anchor.maxRow) {
    return {
      minCol: anchor.minCol,
      minRow: anchor.maxRow + 1,
      maxCol: anchor.maxCol,
      maxRow: target.maxRow,
    }
  }
  if (target.minRow < anchor.minRow) {
    return {
      minCol: anchor.minCol,
      minRow: target.minRow,
      maxCol: anchor.maxCol,
      maxRow: anchor.minRow - 1,
    }
  }
  if (target.maxCol > anchor.maxCol) {
    return {
      minCol: anchor.maxCol + 1,
      minRow: anchor.minRow,
      maxCol: target.maxCol,
      maxRow: anchor.maxRow,
    }
  }
  if (target.minCol < anchor.minCol) {
    return {
      minCol: target.minCol,
      minRow: anchor.minRow,
      maxCol: anchor.minCol - 1,
      maxRow: anchor.maxRow,
    }
  }
  return null
}
