// ListTable 内部协作模块共享的常量与纯辅助。
// 仅供包内 list-table 协作模块（scene/media/interaction）与主类使用，不进入公共入口。

import { rangeCrossesBoundary, type CellRange } from './cell-range'

/** 行号列/表头节点用 -1 标记非数据格坐标 */
export const HEADER_COORD = -1

/**
 * 格索引数值 key：`row * 2^21 + col`，替代模板串 key 消除滚动热路径上的字符串分配。
 * 边界：col < 2^21（约 209 万列）、row < 2^32（约 42 亿行）内编码唯一精确；
 * 行列坐标为非负数据格坐标（表头/行号格 -1 坐标不入索引）。
 */
const CELL_KEY_COL_BITS = 21

export function cellKey(col: number, row: number): number {
  return row * 2 ** CELL_KEY_COL_BITS + col
}

/** 「合并不跨冻结边界」校验（构造期语义，运行时冻结/合并变更同样适用）；违规抛错，调用方保持原状 */
export function assertMergesWithinBoundary(
  ranges: readonly CellRange[],
  frozenColCount: number,
  frozenRowCount: number,
): void {
  for (const range of ranges) {
    if (rangeCrossesBoundary(range, frozenColCount, frozenRowCount)) {
      throw new Error(
        `merge range [${range.startCol},${range.startRow} ~ ${range.endCol},${range.endRow}] ` +
          'crosses the frozen boundary',
      )
    }
  }
}
