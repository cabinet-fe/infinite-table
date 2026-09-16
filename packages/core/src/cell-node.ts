// 单元格场景节点：背景 → 内容（内置 cellType 或自定义渲染 hook）→ 逐边边框。
// 列头/行号列复用同一节点（无 cellType/renderer，样式参数不同）。

import { SceneNode, type RenderContext, type SceneNodeInit } from '@infinite-table/render';

import { BUILTIN_CELL_RENDERERS, type CellRenderer, type CellType } from './cell-renderer';
import type { CellBorderEdge, CellStyle } from './cell-style';

export interface CellNodeInit extends SceneNodeInit {
  col: number;
  row: number;
  text?: string;
  /** 取值管线基础值（checkbox 勾选态、自定义渲染器可用） */
  value?: unknown;
  cellType?: CellType;
  /** 投影后的逐格样式（含逐边边框） */
  style?: CellStyle;
  /** 自定义渲染 hook：接管格内容绘制（背景/边框仍由节点负责） */
  renderer?: CellRenderer | null;
}

export class CellNode extends SceneNode {
  readonly col: number;
  readonly row: number;
  text: string;
  value: unknown;
  cellType: CellType;
  style: CellStyle;
  renderer: CellRenderer | null;

  constructor(init: CellNodeInit) {
    super(init);
    this.col = init.col;
    this.row = init.row;
    this.text = init.text ?? '';
    this.value = init.value;
    this.cellType = init.cellType ?? 'text';
    this.style = init.style ?? {};
    this.renderer = init.renderer ?? null;
  }

  /** 刷新管线产物（文本与基础值） */
  setContent(text: string, value: unknown): void {
    this.text = text;
    this.value = value;
  }

  override paint(ctx: RenderContext): void {
    if (this.style.background) {
      ctx.fillStyle = this.style.background;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    const renderer = this.renderer ?? BUILTIN_CELL_RENDERERS[this.cellType];
    renderer({
      ctx,
      col: this.col,
      row: this.row,
      width: this.width,
      height: this.height,
      text: this.text,
      value: this.value,
      style: this.style,
    });
    this.paintBorders(ctx);
  }

  /** 逐边边框：fillRect 细线保证像素对齐，后画压在内容之上 */
  private paintBorders(ctx: RenderContext): void {
    const border = this.style.border;
    if (!border) {
      return;
    }
    const { width, height } = this;
    const edge = (style: CellBorderEdge, x: number, y: number, w: number, h: number): void => {
      ctx.fillStyle = style.color;
      ctx.fillRect(x, y, w, h);
    };
    if (border.top) {
      edge(border.top, 0, 0, width, border.top.width);
    }
    if (border.bottom) {
      edge(border.bottom, 0, height - border.bottom.width, width, border.bottom.width);
    }
    if (border.left) {
      edge(border.left, 0, 0, border.left.width, height);
    }
    if (border.right) {
      edge(border.right, width - border.right.width, 0, border.right.width, height);
    }
  }
}
