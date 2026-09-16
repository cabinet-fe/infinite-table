// 网格几何：行列偏移与虚拟滚动窗口计算（纯函数，便于单测）

/** 窗口区间 [start, end) */
export interface WindowRange {
  start: number;
  end: number;
}

/** 等行高下按滚动位置求可见行窗口（含边缘部分可见行） */
export function computeRowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
): WindowRange {
  if (rowCount <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0 };
  }
  const start = Math.min(Math.max(Math.floor(scrollTop / rowHeight), 0), rowCount - 1);
  const end = Math.min(
    Math.max(Math.ceil((scrollTop + viewportHeight) / rowHeight), start),
    rowCount,
  );
  return { start, end };
}

/** 列宽前缀和：offsets[i] 为第 i 列左缘的内容坐标，length = 列数 + 1 */
export function computeColOffsets(colWidths: readonly number[]): number[] {
  const offsets: number[] = [0];
  for (const width of colWidths) {
    offsets.push((offsets[offsets.length - 1] ?? 0) + width);
  }
  return offsets;
}

/** 按滚动位置求可见列窗口（含边缘部分可见列）；列数有限，线性扫描即可 */
export function computeColWindow(
  scrollLeft: number,
  viewportWidth: number,
  colOffsets: readonly number[],
): WindowRange {
  const colCount = colOffsets.length - 1;
  if (colCount <= 0 || viewportWidth <= 0) {
    return { start: 0, end: 0 };
  }
  let start = 0;
  while (start < colCount - 1 && (colOffsets[start + 1] ?? 0) <= scrollLeft) {
    start++;
  }
  const right = scrollLeft + viewportWidth;
  let end = start;
  while (end < colCount && (colOffsets[end] ?? 0) < right) {
    end++;
  }
  return { start, end };
}
