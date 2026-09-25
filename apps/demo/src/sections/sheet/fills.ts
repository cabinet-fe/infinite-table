// 填充接线：拖拽结束/双击柄 → generateFill 生成 → Store 批量写 + batchUpdate 收敛为一次 band 失效。
// 双击柄（autoComplete）按相邻列连续数据块末行自动向下填充（Excel 语义）。
// 填充写值经 applyValueWrites 落撤销栈（一次填充 = 一条组合值命令）。

import type { ListTable } from '@infinite-table/core'

import { bindFillGeneration, type SheetStore, type UndoStack } from '@infinite-table/plugins'

import { applyValueWrites } from './undo-writes'

/** 填充真实写值接线；返回退订函数 */
export function bindStoreFill(table: ListTable, store: SheetStore, stack: UndoStack): () => void {
  return bindFillGeneration({
    table,
    read: (col, row) => store.getValue(col, row),
    write: (cells) => {
      table.batchUpdate(() => {
        applyValueWrites(
          store,
          stack,
          cells.map((cell) => ({ col: cell.col, row: cell.row, value: cell.value })),
        )
      })
    },
    autoComplete: { rowCount: () => store.getRowCount() },
  })
}
