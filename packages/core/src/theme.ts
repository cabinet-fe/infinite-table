// 主题系统：默认主题全套 token（颜色/字体/边框/行高/交互浮层/外框）+ extends 深覆盖派生。
// 派生主题经 ListTableOptions.theme 接入样式管线；显式 options（rowHeight 等）仍优先于主题。

import type {
  CellBorder,
  CellBorderEdge,
  CellPadding,
  CellStyle,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
} from './cell-style'

/**
 * 单元格样式 token（body 数据格与行列头各一份；corner 与行号列有独立分区，缺省随 header 派生）。
 * 字段名与 CellStyle 对齐：token 经样式解析链路落入格样式，被列级/按格 hook 逐字段覆盖。
 */
export interface CellStyleTokens {
  font: string
  color: string
  background: string
  /** 网格线色：投影为每格右/下 1px 默认网格边（收入本格，对齐 VTable cellBorderClipDirection: 'bottom-right'） */
  borderColor: string
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
  /** 超宽文本处理；缺省数据格保持 Excel 式溢出，行列头由表侧兜底 ellipsis */
  textOverflow?: CellTextOverflow
  /** 格内边距 [上,右,下,左]；缺省 [0, 8, 0, 8] */
  padding?: CellPadding
  /** 逐边边框（各边 width/color/线型 style 独立）；缺省的边不绘制 */
  border?: CellBorder
}

/** 交互浮层样式 token：选区/hover/填充柄/resize 拖拽线的唯一颜色与宽度来源 */
export interface InteractionTokens {
  /** 选区段填充色 */
  selectionFill: string
  /** 选区段边框色 */
  selectionBorder: string
  /** 选区段边框宽（CSS 像素） */
  selectionBorderWidth: number
  /** 填充柄方点颜色 */
  fillHandle: string
  /** hover 格填充色 */
  hoverCell: string
  /** hover 行/列带填充色 */
  hoverBand: string
  /** resize 拖拽指示线颜色 */
  resizeLine: string
  /** resize 拖拽指示线宽（CSS 像素） */
  resizeLineWidth: number
  /** 整行/整列选区覆盖时行号格/列头格的高亮背景 */
  headerHighlight: string
}

/** 表格外框样式 token */
export interface FrameStyle {
  /** 外框线宽（CSS 像素）；0 不绘制 */
  lineWidth: number
  /** 外框线色 */
  color: string
  /** 是否绘制外框阴影 */
  shadow: boolean
}

/** 表格主题：几何尺寸 + 数据格/行列头样式 + 交互/外框 token */
export interface TableTheme {
  rowHeight: number
  headerHeight: number
  rowHeaderWidth: number
  defaultColWidth: number
  body: CellStyleTokens
  header: CellStyleTokens
  /** 行号列样式分区（缺省随生效 header 派生） */
  rowHeader: CellStyleTokens
  /** 左上角样式分区（缺省随生效 header 派生） */
  corner: CellStyleTokens
  /** 数据区底色：格背景之下铺设（数据区外空白处直接可见） */
  underlayBackgroundColor: string
  /** 交互浮层 token */
  interaction: InteractionTokens
  /** 表格外框 */
  frameStyle: FrameStyle
}

/** extends 入参：token 全可选，嵌套对象按键深覆盖 */
export interface ThemeOverride {
  rowHeight?: number
  headerHeight?: number
  rowHeaderWidth?: number
  defaultColWidth?: number
  body?: Partial<CellStyleTokens>
  header?: Partial<CellStyleTokens>
  /** 缺省随生效 header 派生；给定的键覆盖派生值 */
  rowHeader?: Partial<CellStyleTokens>
  /** 缺省随生效 header 派生；给定的键覆盖派生值 */
  corner?: Partial<CellStyleTokens>
  underlayBackgroundColor?: string
  interaction?: Partial<InteractionTokens>
  frameStyle?: Partial<FrameStyle>
}

/** 默认主题：开箱可用（interaction 各值与既有交互浮层视觉一致） */
export const defaultTheme: TableTheme = {
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  body: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#ffffff',
    borderColor: '#e5e6eb',
  },
  header: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#f5f6f7',
    borderColor: '#e5e6eb',
  },
  rowHeader: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#f5f6f7',
    borderColor: '#e5e6eb',
  },
  corner: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#f5f6f7',
    borderColor: '#e5e6eb',
  },
  underlayBackgroundColor: '#ffffff',
  interaction: {
    selectionFill: 'rgba(46, 106, 219, 0.08)',
    selectionBorder: '#2e6adb',
    selectionBorderWidth: 2,
    fillHandle: '#2e6adb',
    hoverCell: 'rgba(31, 35, 41, 0.08)',
    hoverBand: 'rgba(31, 35, 41, 0.04)',
    resizeLine: '#2e6adb',
    resizeLineWidth: 2,
    headerHighlight: 'rgba(46, 106, 219, 0.18)',
  },
  frameStyle: {
    lineWidth: 0,
    color: '#e5e6eb',
    shadow: false,
  },
}

/**
 * 基于 base（缺省默认主题）派生主题：覆盖键生效，未覆盖的 token 继承 base。
 * rowHeader/corner 随「生效 header」（base+override 合并结果）派生，分区显式覆盖键最后生效——
 * 与拆分前行号列/角落直接沿用 header 样式的行为逐点一致。
 */
export function extendsTheme(
  override: ThemeOverride = {},
  base: TableTheme = defaultTheme,
): TableTheme {
  const header = { ...base.header, ...override.header }
  return {
    rowHeight: override.rowHeight ?? base.rowHeight,
    headerHeight: override.headerHeight ?? base.headerHeight,
    rowHeaderWidth: override.rowHeaderWidth ?? base.rowHeaderWidth,
    defaultColWidth: override.defaultColWidth ?? base.defaultColWidth,
    body: { ...base.body, ...override.body },
    header,
    rowHeader: { ...header, ...override.rowHeader },
    corner: { ...header, ...override.corner },
    underlayBackgroundColor: override.underlayBackgroundColor ?? base.underlayBackgroundColor,
    interaction: { ...base.interaction, ...override.interaction },
    frameStyle: { ...base.frameStyle, ...override.frameStyle },
  }
}

/**
 * 分区 token → 格样式基底（样式投影链的 base）：borderColor token 转右/下 1px
 * 默认网格边（收入本格，与逐格边框经 projectCellStyle 逐边合并——用户给了的边
 * 覆盖网格边，未给的边保留网格线）；显式 border token 逐边优先于网格边。
 */
export function themeCellBase(tokens: CellStyleTokens): CellStyle {
  const { borderColor, border, ...style } = tokens
  const grid: CellBorderEdge = { width: 1, color: borderColor }
  return {
    ...style,
    border: { ...border, right: border?.right ?? grid, bottom: border?.bottom ?? grid },
  }
}
