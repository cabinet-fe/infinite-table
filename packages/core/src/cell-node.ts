// 单元格场景节点：基础 text 绘制；列头/行号列复用同一节点（样式参数不同）

import { SceneNode, type RenderContext, type SceneNodeInit } from '@infinite-table/render';

const TEXT_PADDING_X = 8;

export interface TextCellNodeInit extends SceneNodeInit {
  col: number;
  row: number;
  text?: string;
  font?: string;
  color?: string;
  background?: string | null;
}

export class TextCellNode extends SceneNode {
  readonly col: number;
  readonly row: number;
  text: string;
  font: string;
  color: string;
  background: string | null;

  constructor(init: TextCellNodeInit) {
    super(init);
    this.col = init.col;
    this.row = init.row;
    this.text = init.text ?? '';
    this.font = init.font ?? '12px sans-serif';
    this.color = init.color ?? '#1f2329';
    this.background = init.background ?? null;
  }

  setText(text: string): void {
    this.text = text;
  }

  override paint(ctx: RenderContext): void {
    if (this.background) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, this.width, this.height);
    }
    if (this.text) {
      ctx.fillStyle = this.color;
      ctx.font = this.font;
      ctx.fillText(this.text, TEXT_PADDING_X, this.height / 2 + 4);
    }
  }
}
