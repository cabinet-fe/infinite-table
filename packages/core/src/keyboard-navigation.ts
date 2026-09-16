// 键盘导航：方向键/Tab 移动活动格与滚动跟随（纯函数，便于单测）

import type { CellRef } from './types';

/**
 * 按按键求下一个活动格；无法处理的键返回 null。
 * 方向键四向移动一格；Tab 右移、Shift+Tab 左移；越界夹取到表格边缘。
 */
export function nextActiveCell(
  key: string,
  current: CellRef,
  colCount: number,
  rowCount: number,
  shiftKey = false,
): CellRef | null {
  if (colCount <= 0 || rowCount <= 0) {
    return null;
  }
  const clampCol = (col: number) => Math.min(Math.max(col, 0), colCount - 1);
  const clampRow = (row: number) => Math.min(Math.max(row, 0), rowCount - 1);
  switch (key) {
    case 'ArrowUp':
      return { col: current.col, row: clampRow(current.row - 1) };
    case 'ArrowDown':
      return { col: current.col, row: clampRow(current.row + 1) };
    case 'ArrowLeft':
      return { col: clampCol(current.col - 1), row: current.row };
    case 'ArrowRight':
      return { col: clampCol(current.col + 1), row: current.row };
    case 'Tab':
      return shiftKey
        ? { col: clampCol(current.col - 1), row: current.row }
        : { col: clampCol(current.col + 1), row: current.row };
    default:
      return null;
  }
}

/**
 * 单轴滚动跟随：求让区间 [start, start+size) 完整进入视口所需的最小滚动位置；
 * 已完整可见时返回原滚动位置（调用方据此判断是否广播滚动）。
 */
export function revealAxis(
  scrollPos: number,
  viewportSize: number,
  start: number,
  size: number,
): number {
  if (start < scrollPos) {
    return start;
  }
  if (start + size > scrollPos + viewportSize) {
    return start + size - viewportSize;
  }
  return scrollPos;
}
