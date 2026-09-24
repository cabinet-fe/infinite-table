// 网格几何：行列偏移与虚拟滚动窗口计算（纯函数，便于单测）

import type { Region } from '@infinite-table/render'

/** 窗口区间 [start, end) */
export interface WindowRange {
  start: number
  end: number
}

/** 等行高下按滚动位置求可见行窗口（含边缘部分可见行） */
export function computeRowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
): WindowRange {
  if (rowCount <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0 }
  }
  const start = Math.min(Math.max(Math.floor(scrollTop / rowHeight), 0), rowCount - 1)
  const end = Math.min(
    Math.max(Math.ceil((scrollTop + viewportHeight) / rowHeight), start),
    rowCount,
  )
  return { start, end }
}

/** 列宽前缀和：offsets[i] 为第 i 列左缘的内容坐标，length = 列数 + 1 */
export function computeColOffsets(colWidths: readonly number[]): number[] {
  const offsets: number[] = [0]
  for (const width of colWidths) {
    offsets.push((offsets[offsets.length - 1] ?? 0) + width)
  }
  return offsets
}

/** 夹取冻结数量到 [0, total] */
export function clampFrozenCount(count: number, total: number): number {
  return Math.min(Math.max(count, 0), total)
}

/** 按滚动位置求可见列窗口（含边缘部分可见列）；start 二分定位，end 短程扫描 */
export function computeColWindow(
  scrollLeft: number,
  viewportWidth: number,
  colOffsets: readonly number[],
): WindowRange {
  const colCount = colOffsets.length - 1
  if (colCount <= 0 || viewportWidth <= 0) {
    return { start: 0, end: 0 }
  }
  const start = lowerBoundIndex(colOffsets, scrollLeft)
  const right = scrollLeft + viewportWidth
  let end = start
  while (end < colCount && (colOffsets[end] ?? 0) < right) {
    end++
  }
  return { start, end }
}

/** 行高前缀和：支持逐行高度覆盖（行 resize 产物），length = 行数 + 1 */
export function computeRowOffsets(
  rowCount: number,
  defaultRowHeight: number,
  rowHeights?: ReadonlyMap<number, number>,
): number[] {
  const offsets: number[] = [0]
  for (let row = 0; row < rowCount; row++) {
    offsets.push((offsets[offsets.length - 1] ?? 0) + (rowHeights?.get(row) ?? defaultRowHeight))
  }
  return offsets
}

/** 按行高前缀和求可见行窗口（含边缘部分可见行），语义同 computeRowWindow */
export function computeRowWindowFromOffsets(
  scrollTop: number,
  viewportHeight: number,
  rowOffsets: readonly number[],
): WindowRange {
  const rowCount = rowOffsets.length - 1
  if (rowCount <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0 }
  }
  const start = lowerBoundIndex(rowOffsets, scrollTop)
  const bottom = scrollTop + viewportHeight
  let end = start
  while (end < rowCount && (rowOffsets[end] ?? 0) < bottom) {
    end++
  }
  return { start, end }
}

/**
 * 二分下界共享内核（窗口 start 定位与命中定位共用）：在单调不减前缀和 offsets 中
 * 求满足 offsets[i] <= target 的最大 i（夹取到 [0, count-1]）。
 * 滚动帧窗口计算与 pointermove 命中均为 O(log n)，不随滚动深度线性增长；
 * 含并列前缀和（零宽列/零高行）时取右端，与线性扫描语义逐点等价。
 */
function lowerBoundIndex(offsets: readonly number[], target: number): number {
  const count = offsets.length - 1
  // 不变式：offsets[lo] <= target（target 为负时与线性扫描同样停在 0）；取上中位保证 lo=mid 时区间仍收缩
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = lo + ((hi - lo + 1) >> 1)
    if ((offsets[mid] ?? 0) <= target) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo
}

/**
 * 命中定位共享内核：在单调不减前缀和 offsets 中求内容坐标命中的索引——
 * 返回满足 offsets[i] <= content 的最大 i（夹取到 [0, count-1]）。
 * 二分实现（复用 lowerBoundIndex）；越界与空表返回 -1。
 */
function findIndexAt(offsets: readonly number[], content: number): number {
  const count = offsets.length - 1
  if (count <= 0 || content < 0 || content >= (offsets[count] ?? 0)) {
    return -1
  }
  return lowerBoundIndex(offsets, content)
}

/** 内容坐标 y 命中的行；未命中（越界）返回 -1 */
export function findRowAt(rowOffsets: readonly number[], contentY: number): number {
  return findIndexAt(rowOffsets, contentY)
}

/** 内容坐标 x 命中的列；未命中（越界）返回 -1 */
export function findColAt(colOffsets: readonly number[], contentX: number): number {
  return findIndexAt(colOffsets, contentX)
}

// ---- 冻结：冻结行/列的区域划分（冻结区固定，滚动区随滚动位置平移） ----

/**
 * 非冻结行的可见窗口（数据行索引区间）。
 * 滚动位置定义在「可滚动内容」（总内容扣除冻结区）上，换算回全量内容坐标后复用
 * computeRowWindow，再把窗口夹取到滚动区（不含冻结行）。
 */
export function computeScrollableRowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  frozenRowCount: number,
): WindowRange {
  if (frozenRowCount === 0) {
    return computeRowWindow(scrollTop, viewportHeight, rowCount, rowHeight)
  }
  const window = computeRowWindow(
    scrollTop + frozenRowCount * rowHeight,
    viewportHeight,
    rowCount,
    rowHeight,
  )
  return {
    start: Math.max(window.start, frozenRowCount),
    end: Math.max(window.end, frozenRowCount),
  }
}

/** 非冻结列的可见窗口（列索引区间），语义同 computeScrollableRowWindow */
export function computeScrollableColWindow(
  scrollLeft: number,
  viewportWidth: number,
  colOffsets: readonly number[],
  frozenColCount: number,
): WindowRange {
  if (frozenColCount === 0) {
    return computeColWindow(scrollLeft, viewportWidth, colOffsets)
  }
  const frozenWidth = colOffsets[frozenColCount] ?? 0
  const window = computeColWindow(scrollLeft + frozenWidth, viewportWidth, colOffsets)
  return {
    start: Math.max(window.start, frozenColCount),
    end: Math.max(window.end, frozenColCount),
  }
}

/** 数据列左缘的层坐标 x：冻结列固定，非冻结列随 scrollLeft 平移 */
export function resolveCellX(
  col: number,
  scrollLeft: number,
  colOffsets: readonly number[],
  frozenColCount: number,
  rowHeaderWidth: number,
): number {
  return rowHeaderWidth + (colOffsets[col] ?? 0) - (col < frozenColCount ? 0 : scrollLeft)
}

/** 数据行上缘的层坐标 y：冻结行固定，非冻结行随 scrollTop 平移 */
export function resolveCellY(
  row: number,
  scrollTop: number,
  rowHeight: number,
  frozenRowCount: number,
  headerHeight: number,
): number {
  return headerHeight + row * rowHeight - (row < frozenRowCount ? 0 : scrollTop)
}

/**
 * 非冻结行的可见窗口（逐行高度版）：语义同 computeScrollableRowWindow，
 * 滚动位置定义在「可滚动内容」上，换算时冻结区高度取行高前缀和。
 */
export function computeScrollableRowWindowFromOffsets(
  scrollTop: number,
  viewportHeight: number,
  rowOffsets: readonly number[],
  frozenRowCount: number,
): WindowRange {
  if (frozenRowCount === 0) {
    return computeRowWindowFromOffsets(scrollTop, viewportHeight, rowOffsets)
  }
  const window = computeRowWindowFromOffsets(
    scrollTop + (rowOffsets[frozenRowCount] ?? 0),
    viewportHeight,
    rowOffsets,
  )
  return {
    start: Math.max(window.start, frozenRowCount),
    end: Math.max(window.end, frozenRowCount),
  }
}

/** 数据行上缘的层坐标 y（逐行高度版）：冻结行固定，非冻结行随 scrollTop 平移 */
export function resolveCellYFromOffsets(
  row: number,
  scrollTop: number,
  rowOffsets: readonly number[],
  frozenRowCount: number,
  headerHeight: number,
): number {
  return headerHeight + (rowOffsets[row] ?? 0) - (row < frozenRowCount ? 0 : scrollTop)
}

/**
 * 合并区整块跨度尺寸（层坐标像素，前缀和差值一次得出）：与冻结列/行计数无关——
 * 跨冻结边界线的合并区主格按其自身坐标的冻结带归属钉固（resolveCellX/
 * resolveCellYFromOffsets 的冻结分支），尺寸恒取整块跨度，冻结计数变化只改变
 * 钉固归属、不错切包围盒。场景建格与交互合并包围盒共用，两处不再各算一遍。
 */
export function spanWidth(colOffsets: readonly number[], startCol: number, endCol: number): number {
  return (colOffsets[endCol + 1] ?? 0) - (colOffsets[startCol] ?? 0)
}

export function spanHeight(
  rowOffsets: readonly number[],
  startRow: number,
  endRow: number,
): number {
  return (rowOffsets[endRow + 1] ?? 0) - (rowOffsets[startRow] ?? 0)
}

/** 多个矩形的最小包围盒；空数组返回 null（批量更新合并失效用） */
export function unionRegions(regions: readonly Region[]): Region | null {
  if (regions.length === 0) {
    return null
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const region of regions) {
    minX = Math.min(minX, region.x)
    minY = Math.min(minY, region.y)
    maxX = Math.max(maxX, region.x + region.width)
    maxY = Math.max(maxY, region.y + region.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
