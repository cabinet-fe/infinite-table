// 协议层纯结构网格值类型与读写能力面（零运行时代码，不依赖 @infinitable/grid）。
// 样式与区间类型与 @infinitable/grid 保持结构等价，使引擎与插件无需拉取 grid 实现包
// 即可完成类型检查与契约消费。

/** 边框线型；缺省 solid */
export type CellBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double'

/** 单边边框样式 */
export interface CellBorderEdge {
  /** 边线宽（CSS 像素） */
  width: number
  color: string
  /** 线型：solid 实线（缺省）、dashed 长虚线段、dotted 点段、double 双线 */
  style?: CellBorderStyle
  /** 网格派生边标记：true 表示该边由主题 borderColor token 注入 */
  grid?: boolean
}

/** 四边独立边框；缺省的边不绘制 */
export interface CellBorder {
  top?: CellBorderEdge
  right?: CellBorderEdge
  bottom?: CellBorderEdge
  left?: CellBorderEdge
}

/** 水平对齐 */
export type CellTextAlign = 'left' | 'center' | 'right'

/** 垂直对齐 */
export type CellVerticalAlign = 'top' | 'middle' | 'bottom'

/** 超宽文本处理；缺省保持 Excel 式溢出到右侧空格 */
export type CellTextOverflow = 'ellipsis' | 'clip'

/** 格内边距 [上,右,下,左]（CSS 像素） */
export type CellPadding = [top: number, right: number, bottom: number, left: number]

/** 单元格样式（逐格投影的最终形态） */
export interface CellStyle {
  background?: string
  color?: string
  font?: string
  /** 水平对齐；缺省 left */
  textAlign?: CellTextAlign
  /** 垂直对齐；缺省 middle */
  verticalAlign?: CellVerticalAlign
  /** 字重（CSS font-weight：数值 100~900 或 bold 等关键字） */
  fontWeight?: number | string
  /** 字形（CSS font-style：italic 等） */
  fontStyle?: string
  /** 字号（CSS 像素数值） */
  fontSize?: number
  /** 字族（CSS font-family 串） */
  fontFamily?: string
  /** 下划线 */
  underline?: boolean
  /** 删除线 */
  lineThrough?: boolean
  /** 文本自动换行：开启后超宽文本在格内断行，不向右侧空格溢出 */
  textWrap?: boolean
  /** 超宽文本处理：ellipsis 以省略号截断、clip 直接裁剪；缺省 Excel 式溢出到右侧空格 */
  textOverflow?: CellTextOverflow
  /** 格内边距 [上,右,下,左]；缺省 [0, 8, 0, 8] */
  padding?: CellPadding
  border?: CellBorder
}

/** 单元格区间（闭区间，归一化后 start ≤ end） */
export interface CellRange {
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 模型单元格变更事件（协议数据面的变更通知词汇） */
export interface CellChangeEvent {
  col: number
  row: number
  /** 变更前取值（外部模型给不出时为 undefined） */
  oldValue: unknown
  /** 变更后取值 */
  newValue: unknown
}

/**
 * 网格只读视图（统一旧 EngineReadView 与 PrintSource）：
 * 导出类插件（print / 图片导出等）读取引擎有效数据、样式、几何、合并区与图片引用的窄接口。
 */
export interface GridReadView {
  /** 可选视图名称（如工作表名） */
  readonly name?: string
  /** 数据行数（动态模型实时反映） */
  readonly rowCount: number
  /** 数据列数 */
  readonly colCount: number
  /** 行高读取（CSS 像素，含逐行覆盖） */
  getRowHeight(row: number): number
  /** 列宽读取（CSS 像素） */
  getColWidth(col: number): number
  /** 单元格有效显示文本（经取值管线；被合并覆盖的格取主格文本） */
  getCellText(col: number, row: number): string
  /** 单元格原始值（数据面口径，未经显示链） */
  getCellValue(col: number, row: number): unknown
  /** 有效格样式（无样式引擎返回 undefined） */
  getCellStyle(col: number, row: number): CellStyle | undefined
  /** 合并区集合（闭区间几何语言；无合并语义的引擎返回空数组） */
  getMergeRanges(): readonly CellRange[]
  /** 可选单元格图片资源引用（URL / dataURI 等） */
  getCellImage?(col: number, row: number): string | null | undefined
}

/** 只读网格数据模型能力面 */
export interface GridDataModel {
  /** 数据行数（动态模型实时反映） */
  readonly rowCount: number
  /** 可选数据列数 */
  readonly colCount?: number
  /** 单元格原始值读取（数据面口径） */
  getCellValue(col: number, row: number): unknown
  /** 订阅数据变更（返回退订函数） */
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}

/** 可写网格数据模型能力面 */
export interface WritableGridDataModel extends GridDataModel {
  /** 回驱数据源并触发派生格刷新 */
  updateCell(col: number, row: number, value: unknown): void
}
