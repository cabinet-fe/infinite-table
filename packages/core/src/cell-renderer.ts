// 单元格渲染：内置 text/checkbox 类型渲染 + 自定义渲染 hook。
// 渲染器拿到的 ctx 已平移到格内局部原点；text/value 是取值管线的产物，
// 自定义渲染器可以完全不用它们（与取值管线解耦，凭 col/row 自渲染任意内容）。

import type { RenderContext } from '@infinite-table/render';

import type { CellStyle } from './cell-style';

/** 内置单元格类型 */
export type CellType = 'text' | 'checkbox';

/** 渲染器入参：格几何 + 管线产物 + 投影后样式 */
export interface CellRenderTarget {
  ctx: RenderContext;
  col: number;
  row: number;
  width: number;
  height: number;
  /** 取值管线最终显示文本 */
  text: string;
  /** 取值管线基础值（模型值或 records 字段值），checkbox 据此判定勾选态 */
  value: unknown;
  style: CellStyle;
}

/** 单元格渲染器：在格内局部坐标系绘制内容（背景与边框由节点负责） */
export type CellRenderer = (target: CellRenderTarget) => void;

/**
 * 自定义渲染 hook：纯函数、同步、O(1)。
 * 返回渲染器即接管该格内容绘制；返回 null 走内置 cellType 渲染。
 */
export type ResolveCellRenderer = (col: number, row: number) => CellRenderer | null;

const TEXT_PADDING_X = 8;
const CHECKBOX_SIZE = 14;
const CHECKBOX_BORDER_COLOR = '#8f959e';
const CHECKBOX_CHECK_COLOR = '#3370ff';

/** 内置 text 渲染：左对齐垂直居中 */
export const renderTextCell: CellRenderer = ({ ctx, height, text, style }) => {
  if (!text) {
    return;
  }
  ctx.fillStyle = style.color ?? '#1f2329';
  ctx.font = style.font ?? '12px sans-serif';
  ctx.fillText(text, TEXT_PADDING_X, height / 2 + 4);
};

/** 内置 checkbox 渲染：方框（fillRect 细线保证像素对齐）+ 勾选态实心块；value 即状态，不绘制取值文本 */
export const renderCheckboxCell: CellRenderer = ({ ctx, height, value }) => {
  const size = Math.min(CHECKBOX_SIZE, height - 8);
  const x = TEXT_PADDING_X;
  const y = (height - size) / 2;
  ctx.fillStyle = CHECKBOX_BORDER_COLOR;
  ctx.fillRect(x, y, size, 1);
  ctx.fillRect(x, y + size - 1, size, 1);
  ctx.fillRect(x, y, 1, size);
  ctx.fillRect(x + size - 1, y, 1, size);
  if (value) {
    ctx.fillStyle = CHECKBOX_CHECK_COLOR;
    ctx.fillRect(x + 3, y + 3, size - 6, size - 6);
  }
};

/** 内置类型渲染表：CellNode 无自定义渲染器时按 cellType 取用 */
export const BUILTIN_CELL_RENDERERS: Readonly<Record<CellType, CellRenderer>> = {
  text: renderTextCell,
  checkbox: renderCheckboxCell,
};
