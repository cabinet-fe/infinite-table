// 逐格样式：hook 投影（含逐边边框）。纯函数，便于单测。
// 基础样式由表格侧给出（默认主题接入前用常量兜底），hook 返回值逐字段覆盖。

/** 单边边框样式 */
export interface CellBorderEdge {
  /** 边线宽（CSS 像素） */
  width: number;
  color: string;
}

/** 四边独立边框；缺省的边不绘制 */
export interface CellBorder {
  top?: CellBorderEdge;
  right?: CellBorderEdge;
  bottom?: CellBorderEdge;
  left?: CellBorderEdge;
}

/** 单元格样式（逐格投影的最终形态） */
export interface CellStyle {
  background?: string;
  color?: string;
  font?: string;
  border?: CellBorder;
}

/**
 * 按格样式 hook：纯函数、同步、O(1)。
 * 返回 null 表示该格沿用基础样式。
 */
export type ResolveCellStyle = (col: number, row: number) => CellStyle | null;

const BORDER_EDGES = ['top', 'right', 'bottom', 'left'] as const;

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
  };
  let border: CellBorder | undefined;
  for (const edge of BORDER_EDGES) {
    const style = override?.border?.[edge] ?? base.border?.[edge];
    if (style) {
      border = border ?? {};
      border[edge] = style;
    }
  }
  if (border) {
    result.border = border;
  }
  return result;
}
