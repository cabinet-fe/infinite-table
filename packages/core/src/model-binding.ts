// 模型事件订阅绑定：外部模型变更 → 表格局部刷新；
// 表格回驱（writeBack）期间模型同步 echo 回来的事件不再丢弃：按格坐标收集去重，
// 随返回值交调用方在窗口结束后统一刷新——防回环的同时不丢同步重算的派生格通知。

import { cellKey } from './cell-range'
import type { CellChangeEvent, TableModel } from './types'

export class ModelBinding {
  /** 回驱深度：> 0 期间收到的事件视为 echo，收集进当前回驱窗口 */
  private echoDepth = 0
  /** 当前回驱窗口内收集的 echo 事件（按格坐标去重，保持首次顺序） */
  private collected: CellChangeEvent[] = []
  private collectedKeys = new Set<number>()
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly model: TableModel,
    private readonly onExternalChange: (change: CellChangeEvent) => void,
  ) {}

  /** 开始订阅模型变更；重复调用幂等 */
  attach(): void {
    if (this.unsubscribe) {
      return
    }
    this.unsubscribe = this.model.onCellChange((change) => {
      if (this.echoDepth > 0) {
        const key = cellKey(change.col, change.row)
        if (!this.collectedKeys.has(key)) {
          this.collectedKeys.add(key)
          this.collected.push(change)
        }
        return
      }
      this.onExternalChange(change)
    })
  }

  /**
   * 表格回驱模型的唯一入口：写期间模型 echo 回来的事件不转发（防回环），
   * 去重收集后随返回值交调用方在窗口结束后统一逐格刷新。
   * 模型未提供 setCellValue 或正处于回驱/echo 链路中（重入）时拒绝写入并返回空。
   */
  writeBack(col: number, row: number, value: unknown): readonly CellChangeEvent[] {
    if (!this.model.setCellValue || this.echoDepth > 0) {
      return []
    }
    this.echoDepth++
    try {
      this.model.setCellValue(col, row, value)
    } finally {
      this.echoDepth--
    }
    const collected = this.collected
    this.collected = []
    this.collectedKeys.clear()
    return collected
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
