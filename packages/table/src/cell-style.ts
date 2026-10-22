// 逐格样式：hook 投影（含逐边边框）。纯函数，便于单测。
// 基础样式由表格侧给出（默认主题接入前用常量兜底），hook 返回值逐字段覆盖。
// 样式词汇类型（CellBorder/CellStyle 等）定义在 @infinitable/grid（主题投影与共享边
// 裁决的公共语言），此处转出以维持协作模块的既有 import 路径。

import type { CellBorder, CellStyle } from '@infinitable/grid'

export type {
  CellBorder,
  CellBorderStyle,
  CellBorderEdge,
  CellPadding,
  CellStyle,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
} from '@infinitable/grid'

/** 四边边框线宽（以生效边框为口径的几何内缩输入：媒体格绘制内缩、编辑浮层内缩） */
export interface BorderInset {
  top: number
  right: number
  bottom: number
  left: number
}

/** 生效绘制边框的四边线宽（未设置的边为 0） */
export function borderInset(border: CellBorder | null | undefined): BorderInset {
  return {
    top: border?.top?.width ?? 0,
    right: border?.right?.width ?? 0,
    bottom: border?.bottom?.width ?? 0,
    left: border?.left?.width ?? 0,
  }
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
    textOverflow: override?.textOverflow ?? base.textOverflow,
    padding: override?.padding ?? base.padding,
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
