// resize 持久化：拖拽结束的列宽/行高落 Store（切 sheet 后由 SheetBook.applyGeometry 还原）。

import type { ListTable } from '@infinite-table/core'

import type { SheetStore } from '@infinite-table/plugins'

/** 行列尺寸持久化接线；返回退订函数集合（表格销毁前无需手动解绑） */
export function bindResizePersistence(table: ListTable, store: SheetStore): () => void {
  const offCol = table.onColResizeEnd((event) => {
    store.setColWidth(event.col, event.width)
  })
  const offRow = table.onRowResizeEnd((event) => {
    store.setRowHeight(event.row, event.height)
  })
  return () => {
    offCol()
    offRow()
  }
}
