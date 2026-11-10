// 快照内容包围盒（自 print-form-designer app 下沉）：无限画布（SheetGrid growOnScroll）
// 的行列数只是引擎扩容噪声，真正的「版面有多大」由内容自己决定。宿主在序列化模板、
// 打印取数、参考线分页等场景共用这一份口径。
//
// 这是一组只看 SheetSnapshot 与数据块序列的纯变换：不碰模型实例，也不进 undo。
//
// 口径：
// - 包围盒 = cells / meta / merges（首尾） / images（anchor.from 与 to） / rowHeights /
//   colWidths / rowStyles / colStyles / regions 的最大行列为界 + 1；
// - 空内容回落 { rows: 1, cols: 1 }——引擎与打印内核都要求至少一行一列，返回 0 会
//   在两条链路上都炸；
// - 不尊重 sheet.cols「已声明但没内容」的宽度：包围盒即最终口径（无限画布下声明列数
//   本身就是扩容产物，留着会让模板随滚动不断变胖）。

import type { CellAddress, CellRange } from './address'
import type { SheetSnapshot } from './sheet'

/** 内容包围盒（行/列数，等价于最大下标 + 1） */
export interface ContentBounds {
  rows: number
  cols: number
}

/** 至少一行一列（引擎与打印的共同下限） */
const MIN_BOUNDS: ContentBounds = { rows: 1, cols: 1 }

/** 累积器：记录最大行/列下标（初始 -1 表示「还没有内容」） */
interface Extent {
  maxRow: number
  maxCol: number
}

function touch(extent: Extent, row: number, col: number): void {
  if (Number.isFinite(row) && row > extent.maxRow) extent.maxRow = row
  if (Number.isFinite(col) && col > extent.maxCol) extent.maxCol = col
}

function touchRange(extent: Extent, range: CellRange): void {
  touch(extent, range.start.row, range.start.col)
  touch(extent, range.end.row, range.end.col)
}

/** 参与包围盒计数的数据块矩形（结构子集；只要行列范围，宿主数据块类型的字段子集即可） */
interface RegionRect {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
}

/**
 * 快照内容包围盒：给定快照与数据块序列，返回版面实际占用的行列数。
 * `regions` 参与计数——数据块可以圈住尚无内容的空行（用户刚框出来还没填字），
 * 此时那块矩形仍属于版面。
 */
export function snapshotContentBounds(
  snapshot: SheetSnapshot,
  regions: readonly RegionRect[],
): ContentBounds {
  const extent: Extent = { maxRow: -1, maxCol: -1 }

  for (const cell of snapshot.cells) touch(extent, cell.row, cell.col)
  for (const item of snapshot.meta ?? []) touch(extent, item.row, item.col)
  for (const range of snapshot.merges) touchRange(extent, range)
  for (const image of snapshot.images ?? []) {
    touch(extent, image.anchor.from.row, image.anchor.from.col)
    if (image.anchor.to) touch(extent, image.anchor.to.row, image.anchor.to.col)
  }
  for (const [row] of snapshot.rowHeights ?? []) touch(extent, row, -1)
  for (const [col] of snapshot.colWidths ?? []) touch(extent, -1, col)
  for (const [row] of snapshot.rowStyles ?? []) touch(extent, row, -1)
  for (const [col] of snapshot.colStyles ?? []) touch(extent, -1, col)
  for (const region of regions) {
    touch(extent, region.endRow, region.endCol)
    touch(extent, region.startRow, region.startCol)
  }

  return {
    rows: Math.max(MIN_BOUNDS.rows, extent.maxRow + 1),
    cols: Math.max(MIN_BOUNDS.cols, extent.maxCol + 1),
  }
}

/** 坐标是否落在包围盒内（[0, rows) × [0, cols)） */
function inside(addr: CellAddress, bounds: ContentBounds): boolean {
  return addr.row >= 0 && addr.row < bounds.rows && addr.col >= 0 && addr.col < bounds.cols
}

/** 区间是否整体落在包围盒内（起止都必须在内，跨界即弃） */
function rangeInside(range: CellRange, bounds: ContentBounds): boolean {
  return inside(range.start, bounds) && inside(range.end, bounds)
}

/**
 * 把快照裁到包围盒：cells / meta / rowHeights / colWidths / rowStyles / colStyles
 * 逐项按下标过滤，merges 与 images 起止越界即整条丢弃（裁半个合并区/图片没有合法语义）。
 * 尺寸字段改写为包围盒本身，使「模板 JSON 的行列数 = 内容尺寸」，round-trip 幂等。
 *
 * styles 池原样保留：样式 id 是池内下标，重排会打乱所有引用。
 * 选区（selection）也原样保留：它是运行态视图状态，不参与版面尺寸，裁掉反而会
 * 让「加载后光标位置」无故丢失。
 */
export function clampSnapshotToBounds(
  snapshot: SheetSnapshot,
  bounds: ContentBounds,
): SheetSnapshot {
  return {
    ...snapshot,
    rows: bounds.rows,
    cols: bounds.cols,
    cells: snapshot.cells.filter((cell) => inside(cell, bounds)),
    ...(snapshot.meta ? { meta: snapshot.meta.filter((item) => inside(item, bounds)) } : {}),
    merges: snapshot.merges.filter((range) => rangeInside(range, bounds)),
    ...(snapshot.images
      ? {
          images: snapshot.images.filter(
            (image) =>
              inside(image.anchor.from, bounds) &&
              (image.anchor.to ? inside(image.anchor.to, bounds) : true),
          ),
        }
      : {}),
    ...(snapshot.rowHeights
      ? { rowHeights: snapshot.rowHeights.filter(([row]) => row >= 0 && row < bounds.rows) }
      : {}),
    ...(snapshot.colWidths
      ? { colWidths: snapshot.colWidths.filter(([col]) => col >= 0 && col < bounds.cols) }
      : {}),
    ...(snapshot.rowStyles
      ? { rowStyles: snapshot.rowStyles.filter(([row]) => row >= 0 && row < bounds.rows) }
      : {}),
    ...(snapshot.colStyles
      ? { colStyles: snapshot.colStyles.filter(([col]) => col >= 0 && col < bounds.cols) }
      : {}),
  }
}
