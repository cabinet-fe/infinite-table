// ListTable 内部协作模块共享的常量与纯辅助。
// 仅供包内 list-table 协作模块（scene/media/interaction）与主类使用，不进入公共入口。

import { rangeCrossesBoundary, type CellRange } from './cell-range'

/** 行号列/表头节点用 -1 标记非数据格坐标 */
export const HEADER_COORD = -1

/**
 * 格索引数值 key：唯一定义在 cell-range.ts（无依赖底层模块，避免 import 成环），
 * 此处转出以维持协作模块的既有 import 路径。
 */
export { cellKey } from './cell-range'

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
