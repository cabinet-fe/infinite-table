// 模型事件订阅绑定：外部模型变更 → 表格局部刷新；
// 表格回驱（writeBack）期间模型同步 echo 回来的事件被吞掉，防回环。

import type { CellChangeEvent, TableModel } from './types'

export class ModelBinding {
  /** 回驱深度：> 0 期间收到的事件视为 echo，一律吞掉 */
  private echoDepth = 0
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
        return
      }
      this.onExternalChange(change)
    })
  }

  /**
   * 表格回驱模型的唯一入口：写期间模型 echo 回来的事件被吞掉。
   * 模型未提供 setCellValue 或正处于回驱/echo 链路中（重入）时拒绝写入。
   */
  writeBack(col: number, row: number, value: unknown): void {
    if (!this.model.setCellValue || this.echoDepth > 0) {
      return
    }
    this.echoDepth++
    try {
      this.model.setCellValue(col, row, value)
    } finally {
      this.echoDepth--
    }
  }

  dispose(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }
}
