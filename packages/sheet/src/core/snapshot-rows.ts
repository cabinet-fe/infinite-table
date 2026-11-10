// 快照行平移纯函数（自 print-form-designer app 下沉）：数据块（band）结构编辑与
// 行高列宽撤销共用的底座——只依赖 SheetSnapshot 数据结构的纯变换，不进 undo、不发事件。
//
// 语义口径（有意分叉，勿「顺手统一」）：
// 本模块是**快照级静默变换**：cells 的值/公式原文随行平移，但**不平移公式引用**——
// 公式格里的引用文本（如 =A1）不改写，平移后可能与引用目标错位。它与
// Sheet.applyStructureChange 的**命令级变换**语义不同：后者除数据/合并/行高平移外，
// 还经 prepareFormulaShift 平移全表公式引用文本（被删区间引用 → #REF!），并维护
// 依赖图与 undo 历史。两条链路各有归宿：交互插删行列走命令系统（公式正确性由引擎
// 保证）；宿主对快照做整体重排后静默 restore（如设计器数据块行数调整，撤销由宿主
// 自管快照条目承载）用本模块，公式引用不重写是宿主既有取舍，属有意分叉。
//
// 合并区：首尾行独立映射，映射后区间坍缩（起点越过终点）视为被删丢弃——与
// MergeManager.shiftRowsInsert/shiftRowsDelete 同一口径的快照版。

import type { SheetSnapshot } from './sheet'

/** 行映射函数：返回目标行号；null = 该行删除 */
type RowMap = (row: number) => number | null

/**
 * 按行映射重写快照（值/样式/合并/meta/行高列宽/行默认样式随行平移）。
 * 仅本文件内部使用，不导出。
 */
function mapSnapshotRows(snapshot: SheetSnapshot, map: RowMap, rows: number): SheetSnapshot {
  return {
    ...snapshot,
    rows,
    cells: snapshot.cells.flatMap(({ row, col, ...data }) => {
      const next = map(row)
      return next === null ? [] : [{ row: next, col, ...data }]
    }),
    meta: snapshot.meta?.flatMap((item) => {
      const next = map(item.row)
      return next === null ? [] : [{ ...item, row: next }]
    }),
    merges: snapshot.merges.flatMap((range) => {
      // 合并区首尾行独立映射；映射后区间坍缩（起点越过终点）视为被删丢弃
      const start = map(range.start.row)
      const end = map(range.end.row)
      if (start === null || end === null || start > end) return []
      return [{ ...range, start: { ...range.start, row: start }, end: { ...range.end, row: end } }]
    }),
    rowHeights: snapshot.rowHeights?.flatMap(([row, height]) => {
      const next = map(row)
      return next === null ? [] : ([[next, height]] as [number, number][])
    }),
    rowStyles: snapshot.rowStyles?.flatMap(([row, id]) => {
      const next = map(row)
      return next === null ? [] : ([[next, id]] as [number, number][])
    }),
  }
}

/** 在 at 行处插入 count 行空白（下方内容下移） */
export function insertSnapshotRows(
  snapshot: SheetSnapshot,
  at: number,
  count: number,
): SheetSnapshot {
  return mapSnapshotRows(snapshot, (row) => (row >= at ? row + count : row), snapshot.rows + count)
}

/** 删除 [at, at+count) 行（下方内容上移） */
export function deleteSnapshotRows(
  snapshot: SheetSnapshot,
  at: number,
  count: number,
): SheetSnapshot {
  const end = at + count
  return mapSnapshotRows(
    snapshot,
    (row) => (row < at ? row : row >= end ? row - count : null),
    Math.max(0, snapshot.rows - count),
  )
}
