// 填充接线：拖拽结束 → generateFill 生成 → Store 批量写 + batchUpdate 收敛为一次 band 失效。

import type { ListTable } from '@infinite-table/core'

import { bindFillGeneration, type SheetStore } from '@infinite-table/plugins'

/** 填充真实写值接线；返回退订函数 */
export function bindStoreFill(table: ListTable, store: SheetStore): () => void {
  return bindFillGeneration({
    table,
    read: (col, row) => store.getValue(col, row),
    write: (cells) => {
      table.batchUpdate(() => {
        for (const cell of cells) {
          store.setValue(cell.col, cell.row, cell.value)
        }
      })
    },
  })
}
