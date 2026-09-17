// 选区状态机：拖选、整行/整列选择、shift 扩展与外部回写防递归。
// 只持有选区模型与变更广播，不参与渲染；渲染方经 snapshot 读取。
// 补丁行为（吸收 sheet-core 选区修正）：shift 扩展与拖选时焦点格始终同步到最新扩展目标。

import type { CellRef } from './types'

/** 选区段：start 为锚点，end 为焦点侧（可反向，读取边界用 normalizeRange） */
export interface SelectionRange {
  start: CellRef
  end: CellRef
}

/** 归一化后的选区边界（min/max 序） */
export interface RangeBounds {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

export interface SelectionSnapshot {
  readonly ranges: readonly SelectionRange[]
  /** 焦点格（键盘导航的活动格）；无选区时为 null */
  readonly focus: CellRef | null
}

export type SelectionListener = (snapshot: SelectionSnapshot) => void

/** 求选区段的 min/max 边界 */
export function normalizeRange(range: SelectionRange): RangeBounds {
  return {
    minCol: Math.min(range.start.col, range.end.col),
    minRow: Math.min(range.start.row, range.end.row),
    maxCol: Math.max(range.start.col, range.end.col),
    maxRow: Math.max(range.start.row, range.end.row),
  }
}

export class SelectionState {
  private ranges: SelectionRange[] = []
  private focus: CellRef | null = null
  private dragging = false
  private readonly listeners = new Set<SelectionListener>()
  /** 广播深度：> 0 期间的变更不再嵌套广播（外部回写/监听内重入防回环） */
  private emitDepth = 0

  get snapshot(): SelectionSnapshot {
    return { ranges: this.ranges, focus: this.focus }
  }

  /** 订阅选区变更；返回退订函数 */
  onChange(listener: SelectionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 选中单格；extend 时以当前锚点扩展到目标格（shift 扩展），焦点同步到目标 */
  selectCell(col: number, row: number, extend = false): void {
    const anchor =
      extend && this.ranges.length > 0 ? this.ranges[this.ranges.length - 1]!.start : { col, row }
    this.ranges = [{ start: anchor, end: { col, row } }]
    this.focus = { col, row }
    this.emit()
  }

  /** 程序化多段选中：整组替换选区段，焦点落在末段焦点格（填充柄挂在焦点段上） */
  selectCells(ranges: readonly SelectionRange[]): void {
    this.ranges = ranges.map((range) => ({
      start: { ...range.start },
      end: { ...range.end },
    }))
    const last = this.ranges[this.ranges.length - 1]
    this.focus = last ? { ...last.end } : null
    this.emit()
  }

  /** 在既有选区上追加一段（ctrlMultiSelect 的 Ctrl/Cmd 点选），焦点同步到新段焦点格 */
  addRange(range: SelectionRange): void {
    this.ranges = [...this.ranges, { start: { ...range.start }, end: { ...range.end } }]
    this.focus = { ...range.end }
    this.emit()
  }

  /** 拖选开始：锚定单格 */
  beginDrag(col: number, row: number): void {
    this.dragging = true
    this.ranges = [{ start: { col, row }, end: { col, row } }]
    this.focus = { col, row }
    this.emit()
  }

  /** 拖选扩展：焦点同步到最新目标格 */
  updateDrag(col: number, row: number): void {
    if (!this.dragging || this.ranges.length === 0) {
      return
    }
    this.ranges[this.ranges.length - 1]!.end = { col, row }
    this.focus = { col, row }
    this.emit()
  }

  endDrag(): void {
    this.dragging = false
  }

  /** 整行选择：选区覆盖整行，焦点落在该行首格 */
  selectRow(row: number, colCount: number): void {
    if (colCount <= 0) {
      return
    }
    this.ranges = [{ start: { col: 0, row }, end: { col: colCount - 1, row } }]
    this.focus = { col: 0, row }
    this.emit()
  }

  /** 整列选择：选区覆盖整列，焦点落在该列首格 */
  selectCol(col: number, rowCount: number): void {
    if (rowCount <= 0) {
      return
    }
    this.ranges = [{ start: { col, row: 0 }, end: { col, row: rowCount - 1 } }]
    this.focus = { col, row: 0 }
    this.emit()
  }

  selectAll(colCount: number, rowCount: number): void {
    if (colCount <= 0 || rowCount <= 0) {
      return
    }
    this.ranges = [{ start: { col: 0, row: 0 }, end: { col: colCount - 1, row: rowCount - 1 } }]
    this.focus = { col: 0, row: 0 }
    this.emit()
  }

  clear(): void {
    if (this.ranges.length === 0 && !this.focus) {
      return
    }
    this.ranges = []
    this.focus = null
    this.emit()
  }

  /** 外部模型回写选区：应用但不广播，防回环 */
  applyExternal(snapshot: SelectionSnapshot): void {
    this.ranges = snapshot.ranges.map((range) => ({
      start: { ...range.start },
      end: { ...range.end },
    }))
    this.focus = snapshot.focus ? { ...snapshot.focus } : null
  }

  private emit(): void {
    if (this.emitDepth > 0) {
      return
    }
    this.emitDepth++
    try {
      const snapshot = this.snapshot
      for (const listener of this.listeners) {
        listener(snapshot)
      }
    } finally {
      this.emitDepth--
    }
  }
}
