// 逐格样式词汇表：样式形态类型（边框/对齐/边距/最终形态），自 core cell-style.ts 随迁。
// 纯类型零行为：主题投影（theme.ts）与共享边裁决（shared-edges.ts）以此词汇为公共语言；
// 样式投影管线（projectCellStyle 等）在消费侧（core/table）。

/** 边框线型；缺省 solid */
export type CellBorderStyle = 'solid' | 'dashed' | 'dotted' | 'double'

/** 单边边框样式 */
export interface CellBorderEdge {
  /** 边线宽（CSS 像素） */
  width: number
  color: string
  /** 线型：solid 实线（缺省）、dashed 长虚线段、dotted 点段、double 双线 */
  style?: CellBorderStyle
  /**
   * 网格派生边标记：true 表示该边由主题 borderColor token 注入（themeCellBase），
   * 非用户显式设置。共享边裁决（shared-edges.ts）据此区分强度档：显式边恒胜网格边。
   * 投影链天然维护语义——projectCellStyle 逐边覆盖时 override 的边（无此标记）整边替换
   * 网格边，未覆盖的边保留网格标记；宿主设置样式时无需也不应自填此字段。
   */
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
