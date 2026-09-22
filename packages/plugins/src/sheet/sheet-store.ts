// SheetStore：sheet 能力的参考坐标模型（值 + 格级/列级样式 + cell meta + 合并区 + 行列尺寸 + 冻结）。
// 定位为参考实现：ultra-ui 替换时由其自家无头模型层（core/）顶替此层。
// 只依赖 core 公开入口：值存储复用 SheetModel（TableModel 形态），asModel() 直挂引擎模型形态。

import {
  SheetModel,
  normalizeCellRange,
  projectCellStyle,
  type CellRange,
  type CellStyle,
  type TableModel,
} from '@infinite-table/core'

/** Store 变更事件类型：value 值 / style 样式（格级或列级） / geometry 行列尺寸 / freeze 冻结 / merge 合并区 */
export type SheetStoreChangeType = 'value' | 'style' | 'geometry' | 'freeze' | 'merge'

/** Store 变更事件：type 必带；value/style(格级) 携带格坐标，style(列级)/geometry(列) 只带 col，geometry(行) 只带 row（merge/freeze 只带类型） */
export interface SheetStoreChangeEvent {
  type: SheetStoreChangeType
  col?: number
  row?: number
}

export type SheetStoreChangeListener = (event: SheetStoreChangeEvent) => void

/** cell meta 枚举条目（entriesCellMeta 产物） */
export interface SheetCellMetaEntry<T = unknown> {
  col: number
  row: number
  value: T
}

/** cell meta 变更事件：ns 必带；单格写/清携带格坐标，命名空间整体清空只带 ns */
export interface SheetStoreMetaChangeEvent {
  /** 命名空间标识（宿主按用途自定，如 'binding' / 'validations'） */
  ns: string
  col?: number
  row?: number
}

export type SheetStoreMetaChangeListener = (event: SheetStoreMetaChangeEvent) => void

/**
 * 显示值解析函数（resolveDisplayValue 式：col/row/value 入参，返回显示形态）。
 * 形态对齐 core ListTableOptions.resolveDisplayValue，宿主可直接把引擎显示链注入 Store。
 */
export type SheetDisplayResolver = (col: number, row: number, value: unknown) => unknown

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
  /** 基础样式片段（getEffectiveStyle 合成的最底层；未给为空片段） */
  baseStyle?: CellStyle
  /** 显示值解析注入（getDisplayValue 显示链；缺省回落原始值口径） */
  resolveDisplayValue?: SheetDisplayResolver
}

/**
 * sheet 参考坐标模型：维度 + 稀疏值/样式 + cell meta 命名空间 + 行列尺寸覆盖 + 冻结 + 合并区。
 * 引擎接线：asModel() 产出的 TableModel 直挂 ListTableOptions.model；
 * 编辑提交经引擎回写（ModelBinding.writeBack → setCellValue）落 Store，
 * 模型事件在构造时一次性转发为 value 变更广播（引擎 echo 由 core ModelBinding 吞掉，不回环）。
 */
export class SheetStore {
  /** 值存储（复用 core SheetModel：坐标寻址 + TableModel 语义） */
  private readonly values: SheetModel
  private readonly styles = new Map<number, CellStyle>()
  private readonly colStyles = new Map<number, CellStyle>()
  /** 命名空间 → 格 key → meta 值（命名空间之间隔离） */
  private readonly cellMeta = new Map<string, Map<number, unknown>>()
  private readonly colWidths = new Map<number, number>()
  private readonly rowHeights = new Map<number, number>()
  private readonly defaultColWidth: number
  private readonly defaultRowHeight: number
  /** 基础样式片段（构造归一为空片段，合成路径恒有底） */
  private readonly baseStyle: CellStyle
  private readonly resolveDisplayValue: SheetDisplayResolver | undefined
  private frozen: SheetFrozen = { colCount: 0, rowCount: 0 }
  private merges: CellRange[] = []
  private readonly listeners = new Set<SheetStoreChangeListener>()
  private readonly metaListeners = new Set<SheetStoreMetaChangeListener>()

  constructor(private readonly options: SheetStoreOptions) {
    this.values = new SheetModel(options.rowCount, options.colCount)
    this.defaultColWidth = options.defaultColWidth ?? 100
    this.defaultRowHeight = options.defaultRowHeight ?? 32
    this.baseStyle = options.baseStyle ?? {}
    this.resolveDisplayValue = options.resolveDisplayValue
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

  /**
   * 显示值读取（模型侧）：raw = getValue(col, row)，经显示链产出展示形态。
   * 显示链支持宿主注入：构造注入 resolveDisplayValue 时显示链 = resolveDisplayValue(col, row, raw)；
   * 缺省注入回落原始值口径：原样返回 raw（越界同 getValue 返回 undefined）。
   */
  getDisplayValue(col: number, row: number): unknown {
    const raw = this.values.getCellValue(col, row)
    return this.resolveDisplayValue ? this.resolveDisplayValue(col, row, raw) : raw
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

  /** styleKey 反解格坐标（互逆） */
  private fromCellKey(key: number): { col: number; row: number } {
    return {
      col: key % this.options.colCount,
      row: Math.floor(key / this.options.colCount),
    }
  }

  /** 越界判定（含负坐标） */
  private outOfRange(col: number, row: number): boolean {
    return (
      col < 0 || row < 0 || col >= this.options.colCount || row >= this.options.rowCount
    )
  }

  // ---- 列级样式片段 ----

  /** 读列级样式片段；未设置返回 undefined */
  getColumnStyle(col: number): CellStyle | undefined {
    return this.colStyles.get(col)
  }

  /** 写列级样式片段（getEffectiveStyle 合成中层，整列生效）；广播 style 事件（仅 col） */
  setColumnStyle(col: number, style: CellStyle): void {
    this.colStyles.set(col, style)
    this.dispatch({ type: 'style', col })
  }

  /** 清除列级样式片段（该列回落基础样式）；广播 style 事件（仅 col） */
  clearColumnStyle(col: number): void {
    this.colStyles.delete(col)
    this.dispatch({ type: 'style', col })
  }

  /**
   * 有效样式（模型侧组合读取）：基础样式 → 列级片段 → 格级样式，逐字段合成，
   * 上层给出该字段则覆盖下层；边框逐边独立合成（上层只给一边时下层其余边保留）。
   * 口径 = core projectCellStyle 两级投影：projectCellStyle(projectCellStyle(base, 列级), 格级)，
   * 未设置的层等价空片段跳过，合成顺序固定故结果确定。返回新对象，不别名任何已存片段；
   * 无任何片段时返回空样式（字段全 undefined）。越界（含负坐标）返回 undefined。
   */
  getEffectiveStyle(col: number, row: number): CellStyle | undefined {
    if (this.outOfRange(col, row)) {
      return undefined
    }
    const columnStyle = this.colStyles.get(col)
    const base = columnStyle ? projectCellStyle(this.baseStyle, columnStyle) : this.baseStyle
    const cellStyle = this.styles.get(this.styleKey(col, row))
    return cellStyle ? projectCellStyle(base, cellStyle) : { ...base }
  }

  // ---- cell meta（命名空间） ----

  /**
   * 写命名空间下格 meta（值类型由调用方参数化，存储不区分类型；越界为空操作）。
   * 广播 meta-change（ns + 格坐标）。
   */
  setCellMeta<T>(ns: string, col: number, row: number, value: T): void {
    if (this.outOfRange(col, row)) {
      return
    }
    this.metaMap(ns).set(this.styleKey(col, row), value)
    this.dispatchMeta({ ns, col, row })
  }

  /** 读命名空间下格 meta；未写或越界（含负坐标，防 styleKey 回绕串格）返回 undefined（命名空间之间隔离） */
  getCellMeta<T = unknown>(ns: string, col: number, row: number): T | undefined {
    if (this.outOfRange(col, row)) {
      return undefined
    }
    return this.cellMeta.get(ns)?.get(this.styleKey(col, row)) as T | undefined
  }

  /** 枚举命名空间全部格 meta，按行主序（行升序、行内列升序）确定性返回；空命名空间返回 [] */
  entriesCellMeta<T = unknown>(ns: string): SheetCellMetaEntry<T>[] {
    const map = this.cellMeta.get(ns)
    if (!map) {
      return []
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([key, value]) => ({ ...this.fromCellKey(key), value: value as T }))
  }

  /**
   * 清 meta：带坐标清单格（广播 ns + 格坐标；越界含负坐标为空操作，不删不广播，
   * 防 styleKey 回绕误删其它合法格），不带坐标清整个命名空间（广播仅 ns）。
   * 有效清路径调用即广播（无论清前是否有值）。
   */
  clearCellMeta(ns: string, col?: number, row?: number): void {
    if (col !== undefined && row !== undefined) {
      if (this.outOfRange(col, row)) {
        return
      }
      this.cellMeta.get(ns)?.delete(this.styleKey(col, row))
      this.dispatchMeta({ ns, col, row })
      return
    }
    this.cellMeta.delete(ns)
    this.dispatchMeta({ ns })
  }

  /** 命名空间存储（惰性建） */
  private metaMap(ns: string): Map<number, unknown> {
    let map = this.cellMeta.get(ns)
    if (!map) {
      map = new Map()
      this.cellMeta.set(ns, map)
    }
    return map
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

  /** 订阅 cell meta 变更（独立于 onChange 的事件面，命名为 meta-change）；返回退订函数 */
  onMetaChange(listener: SheetStoreMetaChangeListener): () => void {
    this.metaListeners.add(listener)
    return () => this.metaListeners.delete(listener)
  }

  private dispatch(event: SheetStoreChangeEvent): void {
    this.notify(this.listeners, event)
  }

  private dispatchMeta(event: SheetStoreMetaChangeEvent): void {
    this.notify(this.metaListeners, event)
  }

  private notify<E>(listeners: Set<(event: E) => void>, event: E): void {
    for (const listener of listeners) {
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
