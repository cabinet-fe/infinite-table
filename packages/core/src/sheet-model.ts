// 内置 sheet 式内存坐标模型：按 (col,row) 存取的二维内存表格，实现 TableModel 接口。
// 下游不准备 records 也能开箱编辑；undo 由宿主基于 CellChangeEvent 的 oldValue/newValue 实现。

import type { CellChangeEvent, TableModel } from './types'

/** 内置内存坐标模型：坐标寻址存取，写值同步通知订阅者 */
export class SheetModel implements TableModel {
  private rows: unknown[][]
  private colCount: number
  private readonly listeners = new Set<(change: CellChangeEvent) => void>()

  /** 按行列数构造：初始全为空格 */
  constructor(rowCount: number, colCount: number)
  /** 按初始二维数组构造（内部拷贝一份） */
  constructor(initialCells: readonly (readonly unknown[])[])
  constructor(rowCountOrCells: number | readonly (readonly unknown[])[], colCount?: number) {
    if (typeof rowCountOrCells === 'number') {
      const cols = colCount ?? 0
      this.rows = Array.from({ length: rowCountOrCells }, () => Array.from({ length: cols }))
      this.colCount = cols
    } else {
      this.rows = rowCountOrCells.map((row) => [...row])
      this.colCount = this.rows.reduce((max, row) => Math.max(max, row.length), 0)
    }
  }

  /** 行数（响应式）：随 setRowCount 即时生效，下游按需读取 */
  get rowCount(): number {
    return this.rows.length
  }

  /** 变更行数：扩大补空行，缩小截断 */
  setRowCount(rowCount: number): void {
    if (rowCount < this.rows.length) {
      this.rows.length = rowCount
      return
    }
    while (this.rows.length < rowCount) {
      this.rows.push(Array.from({ length: this.colCount }))
    }
  }

  /** 越界（含负坐标）返回 undefined */
  getCellValue(col: number, row: number): unknown {
    return this.rows[row]?.[col]
  }

  /** 写值并同步通知订阅者；越界（含负坐标）为空操作。无订阅者时跳过事件构造（批量灌数热路径免逐写分配） */
  setCellValue(col: number, row: number, value: unknown): void {
    const cells = this.rows[row]
    if (!cells || col < 0 || col >= cells.length) {
      return
    }
    if (this.listeners.size === 0) {
      cells[col] = value
      return
    }
    const oldValue = cells[col]
    cells[col] = value
    for (const listener of this.listeners) {
      listener({ col, row, oldValue, newValue: value })
    }
  }

  /** 订阅变更事件，返回退订函数 */
  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
