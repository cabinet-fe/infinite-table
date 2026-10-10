// ListTable 内部协作模块共享的常量与纯辅助。
// 仅供包内 list-table 协作模块（scene/media/interaction）与主类使用，不进入公共入口。

import type { CellRange, MergeCellMap } from './cell-range'
import {
  normalizeRange,
  type RangeBounds,
  type SelectionRange,
  type SelectionSnapshot,
} from './selection'

/** 行号列/表头节点用 -1 标记非数据格坐标 */
export const HEADER_COORD = -1

/**
 * 格索引数值 key：唯一定义在 cell-range.ts（无依赖底层模块，避免 import 成环），
 * 此处转出以维持协作模块的既有 import 路径。
 */
export { cellKey } from './cell-range'

/**
 * 合并区模型越界校验（构造期语义，运行时合并/几何变更同样适用）：
 * 行列范围越出表格（负坐标或越界）的合并区抛错，调用方保持原状；
 * 横跨冻结边界线的合并区合法——场景侧按主格冻结带归属钉固、整块绘制在
 * 滚动内容之上（见 list-table-scene 的跨边界主格重挂）。
 */
export function assertMergesWithinTable(
  ranges: readonly CellRange[],
  colCount: number,
  rowCount: number,
): void {
  for (const range of ranges) {
    if (
      range.startCol < 0 ||
      range.startRow < 0 ||
      range.endCol >= colCount ||
      range.endRow >= rowCount
    ) {
      throw new Error(
        `merge range [${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}] ` +
          'is outside the table bounds',
      )
    }
  }
}

/**
 * 表头高亮判定输入：选区快照、全表尺寸与合并区一次装配，行号/列头两种判定共用。
 * 建格装配与选区变化重涂两条路径传同一来源，保证两条路径观感一致。
 */
export interface HeaderHighlightInput {
  snapshot: SelectionSnapshot
  /** 全表列数：整行形态段（列范围盖满全表）判定用 */
  colCount: number
  /** 全表行数：整列形态段（行范围盖满全表）判定用 */
  rowCount: number
  /** 合并区模型：选区段边界按合并盒扩展用；缺省视为无合并区 */
  merges?: MergeCellMap | null
}

/**
 * 选区段边界按合并区扩展：端点格落在合并区内时包围盒并上整块合并盒。
 * 交互拖选与外部回写的选区段本就合并盒对齐，此处兜底程序化选段（selectCell
 * 点在覆盖格）——合并格是选区原子单元，表头覆盖按整块点亮。
 */
function expandedBounds(input: HeaderHighlightInput, range: SelectionRange): RangeBounds {
  const bounds = normalizeRange(range)
  const merges = input.merges
  if (!merges) {
    return bounds
  }
  let { minCol, minRow, maxCol, maxRow } = bounds
  for (const ref of [range.start, range.end]) {
    const master = merges.masterOf(ref.col, ref.row)
    const box = master ? merges.rangeAt(master.col, master.row) : null
    if (box) {
      minCol = Math.min(minCol, box.startCol)
      minRow = Math.min(minRow, box.startRow)
      maxCol = Math.max(maxCol, box.endCol)
      maxRow = Math.max(maxRow, box.endRow)
    }
  }
  return { minCol, minRow, maxCol, maxRow }
}

/**
 * 行号格 row 是否高亮：选区段（合并盒扩展后）覆盖该行即高亮——Excel/WPS 语义，
 * 框选多格时行号带点亮整个覆盖区间而非仅焦点行；唯一例外是整列形态段
 * （行跨度满 × 列跨度非满，selectCol 形态）不跨轴点亮行号带。
 * 多段选区取并集。
 */
export function isRowHeaderHighlighted(input: HeaderHighlightInput, row: number): boolean {
  return input.snapshot.ranges.some((range) => {
    const bounds = expandedBounds(input, range)
    if (row < bounds.minRow || row > bounds.maxRow) {
      return false
    }
    const colspanFull = bounds.minCol === 0 && bounds.maxCol >= input.colCount - 1
    const rowspanFull = bounds.minRow === 0 && bounds.maxRow >= input.rowCount - 1
    // 行跨度非满（普通选区/整行）或双跨度满（全选）点亮；整列形态（行满×列非满）不跨轴
    return !rowspanFull || colspanFull
  })
}

/**
 * 列头格 col 是否高亮：选区段（合并盒扩展后）覆盖该列即高亮，语义同
 * isRowHeaderHighlighted（整行形态段不跨轴点亮列头）；多段选区取并集。
 */
export function isColHeaderHighlighted(input: HeaderHighlightInput, col: number): boolean {
  return input.snapshot.ranges.some((range) => {
    const bounds = expandedBounds(input, range)
    if (col < bounds.minCol || col > bounds.maxCol) {
      return false
    }
    const colspanFull = bounds.minCol === 0 && bounds.maxCol >= input.colCount - 1
    const rowspanFull = bounds.minRow === 0 && bounds.maxRow >= input.rowCount - 1
    // 列跨度非满（普通选区/整列）或双跨度满（全选）点亮；整行形态（列满×行非满）不跨轴
    return !colspanFull || rowspanFull
  })
}
