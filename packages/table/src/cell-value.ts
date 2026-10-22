// 取值管线：数据供给三形态合成。
// 基础值优先级：模型 > records 字段；resolveDisplayValue 作用于末端，可与任一形态叠加。

import type { ColumnDefine, DataRecord, ResolveDisplayValue, TableModel } from './types'

export interface CellValuePipelineInit {
  columns: ColumnDefine[]
  records?: readonly DataRecord[]
  model?: TableModel
  resolveDisplayValue?: ResolveDisplayValue
  /** 无 records、模型也未给 rowCount 时的行数兜底 */
  rowCount?: number
}

export class CellValuePipeline {
  private readonly columns: ColumnDefine[]
  private readonly records?: readonly DataRecord[]
  private readonly model?: TableModel
  private readonly resolveDisplayValue?: ResolveDisplayValue
  private fallbackRowCount: number

  constructor(init: CellValuePipelineInit) {
    this.columns = init.columns
    this.records = init.records
    this.model = init.model
    this.resolveDisplayValue = init.resolveDisplayValue
    this.fallbackRowCount = init.rowCount ?? 0
  }

  /**
   * 运行时设置行数兜底（setRowCount 路径）：records/模型给足时兜底不参与；
   * 纯 hook 形态（无 records/模型）据此动态增减行数。
   */
  setRowCountFloor(count: number): void {
    if (Number.isFinite(count)) {
      this.fallbackRowCount = Math.max(0, Math.floor(count))
    }
  }

  get rowCount(): number {
    if (this.model) {
      return Math.max(this.model.rowCount ?? 0, this.fallbackRowCount)
    }
    if (this.records) {
      return this.records.length
    }
    return this.fallbackRowCount
  }

  /** 求单元格最终显示文本（同步 O(1)） */
  resolveText(col: number, row: number): string {
    const value = this.resolveBaseValue(col, row)
    if (this.resolveDisplayValue) {
      return this.resolveDisplayValue(col, row, value)
    }
    return value == null ? '' : String(value)
  }

  /** 求单元格基础值（模型值或 records 字段值，不过 hook；checkbox 态等场景用） */
  resolveValue(col: number, row: number): unknown {
    return this.resolveBaseValue(col, row)
  }

  private resolveBaseValue(col: number, row: number): unknown {
    if (this.model) {
      return this.model.getCellValue(col, row)
    }
    const field = this.columns[col]?.field
    if (field === undefined) {
      return undefined
    }
    return this.records?.[row]?.[field]
  }
}
