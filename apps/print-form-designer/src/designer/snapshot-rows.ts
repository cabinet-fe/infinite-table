// 快照行平移纯函数：区域（band）结构编辑与行高列宽撤销共用的底座。
//
// 为什么独立成文件：这些函数只依赖 SheetSnapshot 数据结构、不碰 FormDoc 的事件与撤销门面，
// 是纯变换；抽出来让 form-doc.ts 专注「文档 + 撤销链」编排，两边都维持在单文件行数上限内。

import type { SheetSnapshot } from '@infinitable/sheet'

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
