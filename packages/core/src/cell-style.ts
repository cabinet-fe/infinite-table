// 逐格样式：hook 投影（含逐边边框）。纯函数，便于单测。
// 基础样式由表格侧给出（默认主题接入前用常量兜底），hook 返回值逐字段覆盖。

/** 单边边框样式 */
export interface CellBorderEdge {
  /** 边线宽（CSS 像素） */
  width: number
  color: string
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
  border?: CellBorder
}

/**
 * 按格样式 hook：纯函数、同步、O(1)。
 * 返回 null 表示该格沿用基础样式。
 */
export type ResolveCellStyle = (col: number, row: number) => CellStyle | null

const BORDER_EDGES = ['top', 'right', 'bottom', 'left'] as const

const DEFAULT_FONT = '12px sans-serif'

/**
 * 结构化字体字段 → CSS font 串（font-style font-weight font-size font-family 顺序）。
 * 任一分量给出即走组装，缺省分量补 12px/sans-serif；全未给出回退 font 简写或默认字体。
 */
export function cellStyleFont(style: CellStyle): string {
  if (
    style.fontStyle === undefined &&
    style.fontWeight === undefined &&
    style.fontSize === undefined &&
    style.fontFamily === undefined
  ) {
    return style.font ?? DEFAULT_FONT
  }
  const parts: string[] = [
    style.fontStyle,
    style.fontWeight?.toString(),
    `${style.fontSize ?? 12}px`,
    style.fontFamily ?? 'sans-serif',
  ].filter((part): part is string => part !== undefined)
  return parts.join(' ')
}

/**
 * 样式投影：override 逐字段覆盖 base；边框逐边独立合并
 * （override 只给左边框时，base 的其余三边仍保留）。返回新对象，不改入参。
 */
export function projectCellStyle(
  base: CellStyle,
  override: CellStyle | null | undefined,
): CellStyle {
  const result: CellStyle = {
    background: override?.background ?? base.background,
    color: override?.color ?? base.color,
    font: override?.font ?? base.font,
    textAlign: override?.textAlign ?? base.textAlign,
    verticalAlign: override?.verticalAlign ?? base.verticalAlign,
    fontWeight: override?.fontWeight ?? base.fontWeight,
    fontStyle: override?.fontStyle ?? base.fontStyle,
    fontSize: override?.fontSize ?? base.fontSize,
    fontFamily: override?.fontFamily ?? base.fontFamily,
    underline: override?.underline ?? base.underline,
    lineThrough: override?.lineThrough ?? base.lineThrough,
    textWrap: override?.textWrap ?? base.textWrap,
  }
  let border: CellBorder | undefined
  for (const edge of BORDER_EDGES) {
    const style = override?.border?.[edge] ?? base.border?.[edge]
    if (style) {
      border = border ?? {}
      border[edge] = style
    }
  }
  if (border) {
    result.border = border
  }
  return result
}
