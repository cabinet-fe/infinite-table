// 主题系统：默认主题全套 token（颜色/字体/边框/行高）+ extends 深覆盖派生。
// 派生主题经 ListTableOptions.theme 接入样式管线；显式 options（rowHeight 等）仍优先于主题。

import type {
  CellBorder,
  CellPadding,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
} from './cell-style'

/**
 * 单元格样式 token（body 数据格与 header 行列头各一份；corner 与行号列沿用 header 分区）。
 * 字段名与 CellStyle 对齐：token 经样式解析链路落入格样式，被列级/按格 hook 逐字段覆盖。
 */
export interface CellStyleTokens {
  font: string
  color: string
  background: string
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

/** 表格主题：几何尺寸 + 数据格/行列头样式 */
export interface TableTheme {
  rowHeight: number
  headerHeight: number
  rowHeaderWidth: number
  defaultColWidth: number
  body: CellStyleTokens
  header: CellStyleTokens
}

/** extends 入参：token 全可选，嵌套对象按键深覆盖 */
export interface ThemeOverride {
  rowHeight?: number
  headerHeight?: number
  rowHeaderWidth?: number
  defaultColWidth?: number
  body?: Partial<CellStyleTokens>
  header?: Partial<CellStyleTokens>
}

/** 默认主题：开箱可用 */
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
}

/** 基于 base（缺省默认主题）派生主题：覆盖键生效，未覆盖的 token 继承 base */
export function extendsTheme(
  override: ThemeOverride = {},
  base: TableTheme = defaultTheme,
): TableTheme {
  return {
    rowHeight: override.rowHeight ?? base.rowHeight,
    headerHeight: override.headerHeight ?? base.headerHeight,
    rowHeaderWidth: override.rowHeaderWidth ?? base.rowHeaderWidth,
    defaultColWidth: override.defaultColWidth ?? base.defaultColWidth,
    body: { ...base.body, ...override.body },
    header: { ...base.header, ...override.header },
  }
}
