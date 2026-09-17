// 填充柄交互原语（P0-6）：焦点段右下角方点的几何、命中判定与按下/拖拽结束事件载荷。
// 填充生成算法不在内核——宿主（适配层）据锚定段与拖拽目标范围自行实现 generateFill。

import type { Region } from '@infinite-table/render'

import {
  normalizeRange,
  type RangeBounds,
  type SelectionRange,
  type SelectionSnapshot,
} from './selection'

/** 填充柄方点边长（px） */
export const FILL_HANDLE_SIZE = 8

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
