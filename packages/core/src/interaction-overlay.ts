// 交互浮层：选区、hover、resize 拖拽线绘制在 sky 层，不触发 body 重绘。
// 浮层节点不可拾取（pickable: false），指针事件穿透到 body 层。

import { SceneNode, type Region, type RenderContext } from '@infinite-table/render';

import type { WindowRange } from './grid-layout';
import { normalizeRange, type SelectionSnapshot } from './selection';
import type { CellRef } from './types';

const SELECTION_FILL = 'rgba(46, 106, 219, 0.08)';
const SELECTION_BORDER = '#2e6adb';
const SELECTION_BORDER_WIDTH = 2;
const HOVER_CELL_FILL = 'rgba(31, 35, 41, 0.08)';
const HOVER_BAND_FILL = 'rgba(31, 35, 41, 0.04)';
const RESIZE_LINE_COLOR = '#2e6adb';
const RESIZE_LINE_WIDTH = 2;

/** 浮层绘制所需的几何查询（闭包读取表格实时状态） */
export interface OverlayGeometry {
  /** 数据格在视口中的矩形；行/列在可视窗口外返回 null */
  cellRect(col: number, row: number): Region | null;
  /** 数据区在视口中的可绘制矩形（扣除行列头） */
  readonly bodyViewport: Region;
}

/** resize 拖拽指示线（视口坐标） */
export interface ResizeLine {
  readonly orientation: 'vertical' | 'horizontal';
  readonly position: number;
}

export interface OverlayContent {
  readonly selection: SelectionSnapshot;
  readonly hover: CellRef | null;
  readonly resizeLine: ResizeLine | null;
  /** 可视窗口（选区裁剪用，[start, end)） */
  readonly window: { rows: WindowRange; cols: WindowRange };
}

class OverlayNode extends SceneNode {
  content: OverlayContent | null = null;

  constructor(private readonly geometry: OverlayGeometry) {
    super({ pickable: false });
  }

  override paint(ctx: RenderContext): void {
    const content = this.content;
    if (!content) {
      return;
    }
    const viewport = this.geometry.bodyViewport;
    ctx.save();
    ctx.beginPath();
    ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height);
    ctx.clip();
    this.paintHover(ctx, content);
    this.paintSelection(ctx, content);
    this.paintResizeLine(ctx, content, viewport);
    ctx.restore();
  }

  private paintHover(ctx: RenderContext, content: OverlayContent): void {
    const hover = content.hover;
    if (!hover) {
      return;
    }
    const viewport = this.geometry.bodyViewport;
    const cell = this.geometry.cellRect(hover.col, hover.row);
    if (!cell) {
      return;
    }
    // 行/列带 + 格三级 hover 高亮
    ctx.fillStyle = HOVER_BAND_FILL;
    ctx.fillRect(viewport.x, cell.y, viewport.width, cell.height);
    ctx.fillRect(cell.x, viewport.y, cell.width, viewport.height);
    ctx.fillStyle = HOVER_CELL_FILL;
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
  }

  private paintSelection(ctx: RenderContext, content: OverlayContent): void {
    for (const range of content.selection.ranges) {
      const rect = this.rangeRect(range, content);
      if (!rect) {
        continue;
      }
      ctx.fillStyle = SELECTION_FILL;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      // 四边边框（RenderContext 无 stroke，用细条填充）
      ctx.fillStyle = SELECTION_BORDER;
      const w = SELECTION_BORDER_WIDTH;
      ctx.fillRect(rect.x, rect.y, rect.width, w);
      ctx.fillRect(rect.x, rect.y + rect.height - w, rect.width, w);
      ctx.fillRect(rect.x, rect.y, w, rect.height);
      ctx.fillRect(rect.x + rect.width - w, rect.y, w, rect.height);
    }
  }

  private paintResizeLine(ctx: RenderContext, content: OverlayContent, viewport: Region): void {
    const line = content.resizeLine;
    if (!line) {
      return;
    }
    ctx.fillStyle = RESIZE_LINE_COLOR;
    if (line.orientation === 'vertical') {
      ctx.fillRect(
        line.position - RESIZE_LINE_WIDTH / 2,
        viewport.y,
        RESIZE_LINE_WIDTH,
        viewport.height,
      );
    } else {
      ctx.fillRect(
        viewport.x,
        line.position - RESIZE_LINE_WIDTH / 2,
        viewport.width,
        RESIZE_LINE_WIDTH,
      );
    }
  }

  /** 选区段裁剪到可视窗口后的视口矩形；完全在窗口外返回 null */
  private rangeRect(
    range: SelectionSnapshot['ranges'][number],
    content: OverlayContent,
  ): Region | null {
    const bounds = normalizeRange(range);
    const minCol = Math.max(bounds.minCol, content.window.cols.start);
    const maxCol = Math.min(bounds.maxCol, content.window.cols.end - 1);
    const minRow = Math.max(bounds.minRow, content.window.rows.start);
    const maxRow = Math.min(bounds.maxRow, content.window.rows.end - 1);
    if (minCol > maxCol || minRow > maxRow) {
      return null;
    }
    const topLeft = this.geometry.cellRect(minCol, minRow);
    const bottomRight = this.geometry.cellRect(maxCol, maxRow);
    if (!topLeft || !bottomRight) {
      return null;
    }
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x + bottomRight.width - topLeft.x,
      height: bottomRight.y + bottomRight.height - topLeft.y,
    };
  }
}

/** 交互浮层：持有 sky 层节点，update 返回当前是否有内容（供调用方决定失效提交） */
export class InteractionOverlay {
  private readonly node: OverlayNode;

  constructor(
    skyRoot: SceneNode,
    private readonly geometry: OverlayGeometry,
  ) {
    this.node = new OverlayNode(geometry);
    this.node.width = geometry.bodyViewport.x + geometry.bodyViewport.width;
    this.node.height = geometry.bodyViewport.y + geometry.bodyViewport.height;
    skyRoot.appendChild(this.node);
  }

  /** 更新浮层内容；返回是否有可见内容（无内容时节点隐藏，供调用方跳过 sky 失效） */
  update(content: OverlayContent): boolean {
    const has =
      content.selection.ranges.length > 0 || content.hover !== null || content.resizeLine !== null;
    this.node.visible = has;
    this.node.content = has ? content : null;
    return has;
  }
}
