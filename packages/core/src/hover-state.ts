// hover 状态：行列/格悬停跟踪与变更广播（渲染由订阅方负责）

import type { CellRef } from './types'

export type HoverListener = (hover: CellRef | null) => void

export class HoverState {
  /** true 时悬停跟踪整体短路：set/clear 均为无操作、不再广播（hover 显式开关的落点） */
  private readonly disabled: boolean

  private current: CellRef | null = null
  private readonly listeners = new Set<HoverListener>()

  constructor(disabled = false) {
    this.disabled = disabled
  }

  get cell(): CellRef | null {
    return this.current
  }

  onChange(listener: HoverListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 悬停到指定格；地址未变时不广播 */
  set(col: number, row: number): void {
    if (this.disabled) {
      return
    }
    if (this.current && this.current.col === col && this.current.row === row) {
      return
    }
    this.current = { col, row }
    this.emit()
  }

  clear(): void {
    if (this.disabled || !this.current) {
      return
    }
    this.current = null
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.current)
    }
  }
}
