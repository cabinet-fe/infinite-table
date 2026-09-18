// SheetStore：sheet 能力的参考坐标模型（值 + 格级样式 + 合并区 + 行列尺寸 + 冻结）。
// 定位为参考实现：ultra-ui 替换时由其自家无头模型层（core/）顶替此层。
// 只依赖 core 公开入口：值存储复用 SheetModel（TableModel 形态），asModel() 直挂引擎模型形态。

import {
  SheetModel,
  normalizeCellRange,
  type CellRange,
  type CellStyle,
  type TableModel,
} from '@infinite-table/core'

/** Store 变更事件类型：value 值 / style 格级样式 / geometry 行列尺寸 / freeze 冻结 / merge 合并区 */
export type SheetStoreChangeType = 'value' | 'style' | 'geometry' | 'freeze' | 'merge'

/** Store 变更事件：type 必带；value/geometry 携带受影响坐标（merge/freeze 只带类型） */
export interface SheetStoreChangeEvent {
  type: SheetStoreChangeType
  col?: number
  row?: number
}

export type SheetStoreChangeListener = (event: SheetStoreChangeEvent) => void

/** 冻结配置（数据列/数据行计数，不含行列头） */
export interface SheetFrozen {
  colCount: number
  rowCount: number
}

export interface SheetStoreOptions {
  rowCount: number
  colCount: number
  /** 列宽/行高缺省值（未逐列逐行覆盖时回落） */
  defaultColWidth?: number
  defaultRowHeight?: number
}

/**
 * sheet 参考坐标模型：维度 + 稀疏值/样式 + 行列尺寸覆盖 + 冻结 + 合并区。
 * 引擎接线：asModel() 产出的 TableModel 直挂 ListTableOptions.model；
 * 编辑提交经引擎回写（ModelBinding.writeBack → setCellValue）落 Store，
 * 模型事件在构造时一次性转发为 value 变更广播（引擎 echo 由 core ModelBinding 吞掉，不回环）。
 */
export class SheetStore {
  /** 值存储（复用 core SheetModel：坐标寻址 + TableModel 语义） */
  private readonly values: SheetModel
  private readonly styles = new Map<number, CellStyle>()
  private readonly colWidths = new Map<number, number>()
  private readonly rowHeights = new Map<number, number>()
  private readonly defaultColWidth: number
  private readonly defaultRowHeight: number
  private frozen: SheetFrozen = { colCount: 0, rowCount: 0 }
  private merges: CellRange[] = []
  private readonly listeners = new Set<SheetStoreChangeListener>()

  constructor(private readonly options: SheetStoreOptions) {
    this.values = new SheetModel(options.rowCount, options.colCount)
    this.defaultColWidth = options.defaultColWidth ?? 100
    this.defaultRowHeight = options.defaultRowHeight ?? 32
    // 模型事件（含引擎回写）一次性转发为 Store 的 value 广播；
    // setValue 自身只写模型，不经此转发会重复发事件的路径
    this.values.onCellChange((change) => {
      this.dispatch({ type: 'value', col: change.col, row: change.row })
    })
  }

  /** 行数 */
  getRowCount(): number {
    return this.options.rowCount
  }

  /** 列数 */
  getColCount(): number {
    return this.options.colCount
  }

  // ---- 值 ----

  /** 读格值；越界（含负坐标）返回 undefined */
  getValue(col: number, row: number): unknown {
    return this.values.getCellValue(col, row)
  }

  /** 写格值（越界为空操作）；引擎编辑提交经 asModel().setCellValue 走同一入口并广播 value 事件 */
  setValue(col: number, row: number, value: unknown): void {
    this.values.setCellValue(col, row, value)
  }

  // ---- 格级样式 ----

  /** 读格级样式；未设置返回 undefined */
  getStyle(col: number, row: number): CellStyle | undefined {
    return this.styles.get(this.styleKey(col, row))
  }

  /** 写格级样式（整体替换该格样式） */
  setStyle(col: number, row: number, style: CellStyle): void {
    this.styles.set(this.styleKey(col, row), style)
    this.dispatch({ type: 'style', col, row })
  }

  /** 清除格级样式（回落主题/列级管线） */
  clearStyle(col: number, row: number): void {
    this.styles.delete(this.styleKey(col, row))
    this.dispatch({ type: 'style', col, row })
  }

  /** 样式坐标 key：行 × 列数 + 列（维度构造期固定，行列数内有唯一性） */
  private styleKey(col: number, row: number): number {
    return row * this.options.colCount + col
  }

  // ---- 行列尺寸 ----

  /** 列宽：逐列覆盖优先，缺省回落构造值 */
  getColWidth(col: number): number {
    return this.colWidths.get(col) ?? this.defaultColWidth
  }

  /** 行高：逐行覆盖优先，缺省回落构造值 */
  getRowHeight(row: number): number {
    return this.rowHeights.get(row) ?? this.defaultRowHeight
  }

  setColWidth(col: number, width: number): void {
    this.colWidths.set(col, width)
    this.dispatch({ type: 'geometry', col })
  }

  setRowHeight(row: number, height: number): void {
    this.rowHeights.set(row, height)
    this.dispatch({ type: 'geometry', row })
  }

  /** 全部列宽覆盖（宿主切 sheet 后逐列应用用） */
  getColWidthOverrides(): ReadonlyMap<number, number> {
    return this.colWidths
  }

  /** 全部行高覆盖 */
  getRowHeightOverrides(): ReadonlyMap<number, number> {
    return this.rowHeights
  }

  // ---- 冻结 ----

  getFrozen(): SheetFrozen {
    return { ...this.frozen }
  }

  setFrozen(frozen: SheetFrozen): void {
    this.frozen = { ...frozen }
    this.dispatch({ type: 'freeze' })
  }

  // ---- 合并区 ----

  getMerges(): readonly CellRange[] {
    return this.merges.map(normalizeCellRange)
  }

  setMerges(ranges: readonly CellRange[]): void {
    this.merges = ranges.map(normalizeCellRange)
    this.dispatch({ type: 'merge' })
  }

  // ---- 变更通知 ----

  /** 订阅 Store 变更；返回退订函数 */
  onChange(listener: SheetStoreChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private dispatch(event: SheetStoreChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  // ---- 引擎接线 ----

  /**
   * 产出 core TableModel 兼容对象（可直挂 ListTableOptions.model）：
   * 引擎读值/编辑回写/模型事件订阅全部落在内部 SheetModel 上，
   * echo 防回环由 core ModelBinding 契约负责。
   */
  asModel(): TableModel {
    return this.values
  }
}
