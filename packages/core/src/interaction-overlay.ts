// 交互浮层：选区、hover、resize 拖拽线绘制在 sky 层，不触发 body 重绘。
// 浮层节点不可拾取（pickable: false），指针事件穿透到 body 层。
// 绘制颜色/宽度唯一来源为主题 interaction 分区 token（构造时传入生效主题的解析值）。

import { SceneNode, type Region, type RenderContext } from '@infinite-table/render'

import { fillHandleRect } from './fill-handle'
import type { WindowRange } from './grid-layout'
import {
  normalizeRange,
  type RangeBounds,
  type SelectionRange,
  type SelectionSnapshot,
} from './selection'
import type { CellRef } from './types'
import type { InteractionTokens } from './theme'

/** 浮层绘制所需的几何查询（闭包读取表格实时状态） */
export interface OverlayGeometry {
  /** 数据格在视口中的矩形；行/列在可视窗口外返回 null */
  cellRect(col: number, row: number): Region | null
  /** 数据区在视口中的可绘制矩形（扣除行列头） */
  readonly bodyViewport: Region
}

/** resize 拖拽指示线（视口坐标） */
export interface ResizeLine {
  readonly orientation: 'vertical' | 'horizontal'
  readonly position: number
}

export interface OverlayContent {
  readonly selection: SelectionSnapshot
  readonly hover: CellRef | null
  readonly resizeLine: ResizeLine | null
  /** 填充柄所在焦点段（无选区为 null）；柄绘制在焦点段右下角格的角点上 */
  readonly fillHandleRange: SelectionRange | null
  /** 填充拖拽预览区（轴锁定后的纯扩展区；非拖拽中为 null） */
  readonly fillPreview: RangeBounds | null
  /** 可视窗口（选区裁剪用，[start, end)） */
  readonly window: { rows: WindowRange; cols: WindowRange }
}

export class OverlayNode extends SceneNode {
  content: OverlayContent | null = null

  constructor(
    private readonly geometry: OverlayGeometry,
    private readonly interaction: InteractionTokens,
  ) {
    super({ pickable: false })
  }

  override paint(ctx: RenderContext): void {
    const content = this.content
    if (!content) {
      return
    }
    const viewport = this.geometry.bodyViewport
    ctx.save()
    ctx.beginPath()
    ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height)
    ctx.clip()
    this.paintHover(ctx, content)
    this.paintSelection(ctx, content)
    this.paintFillPreview(ctx, content)
    this.paintFillHandle(ctx, content)
    this.paintResizeLine(ctx, content, viewport)
    ctx.restore()
  }

  private paintHover(ctx: RenderContext, content: OverlayContent): void {
    const hover = content.hover
    if (!hover) {
      return
    }
    const viewport = this.geometry.bodyViewport
    const cell = this.geometry.cellRect(hover.col, hover.row)
    if (!cell) {
      return
    }
    // 行/列带 + 格三级 hover 高亮
    ctx.fillStyle = this.interaction.hoverBand
    ctx.fillRect(viewport.x, cell.y, viewport.width, cell.height)
    ctx.fillRect(cell.x, viewport.y, cell.width, viewport.height)
    ctx.fillStyle = this.interaction.hoverCell
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height)
  }

  private paintSelection(ctx: RenderContext, content: OverlayContent): void {
    for (const range of content.selection.ranges) {
      const rect = this.rangeRect(range, content)
      if (!rect) {
        continue
      }
      ctx.fillStyle = this.interaction.selectionFill
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
      // 四边边框（RenderContext 无 stroke，用细条填充）
      ctx.fillStyle = this.interaction.selectionBorder
      const w = this.interaction.selectionBorderWidth
      ctx.fillRect(rect.x, rect.y, rect.width, w)
      ctx.fillRect(rect.x, rect.y + rect.height - w, rect.width, w)
      ctx.fillRect(rect.x, rect.y, w, rect.height)
      ctx.fillRect(rect.x + rect.width - w, rect.y, w, rect.height)
    }
  }

  /** 填充柄方点：挂在焦点段右下角格的角点上；该格在可视窗口外则不画 */
  private paintFillHandle(ctx: RenderContext, content: OverlayContent): void {
    const range = content.fillHandleRange
    if (!range) {
      return
    }
    const bounds = normalizeRange(range)
    const cell = this.geometry.cellRect(bounds.maxCol, bounds.maxRow)
    if (!cell) {
      return
    }
    const handle = fillHandleRect(cell)
    ctx.fillStyle = this.interaction.fillHandle
    ctx.fillRect(handle.x, handle.y, handle.width, handle.height)
  }

  /** 填充拖拽预览：扩展区的虚线边框（对标 VTable 拖拽中的目标区反馈） */
  private paintFillPreview(ctx: RenderContext, content: OverlayContent): void {
    const preview = content.fillPreview
    if (!preview) {
      return
    }
    const rect = this.boundsRect(preview, content)
    if (!rect) {
      return
    }
    const w = this.interaction.selectionBorderWidth
    const dash = 5
    const gap = 4
    ctx.fillStyle = this.interaction.selectionBorder
    for (let x = rect.x; x < rect.x + rect.width; x += dash + gap) {
      const seg = Math.min(dash, rect.x + rect.width - x)
      ctx.fillRect(x, rect.y, seg, w)
      ctx.fillRect(x, rect.y + rect.height - w, seg, w)
    }
    for (let y = rect.y; y < rect.y + rect.height; y += dash + gap) {
      const seg = Math.min(dash, rect.y + rect.height - y)
      ctx.fillRect(rect.x, y, w, seg)
      ctx.fillRect(rect.x + rect.width - w, y, w, seg)
    }
  }

  private paintResizeLine(ctx: RenderContext, content: OverlayContent, viewport: Region): void {
    const line = content.resizeLine
    if (!line) {
      return
    }
    ctx.fillStyle = this.interaction.resizeLine
    const w = this.interaction.resizeLineWidth
    if (line.orientation === 'vertical') {
      ctx.fillRect(line.position - w / 2, viewport.y, w, viewport.height)
    } else {
      ctx.fillRect(viewport.x, line.position - w / 2, viewport.width, w)
    }
  }

  /** 选区段裁剪到可视窗口后的视口矩形；完全在窗口外返回 null */
  private rangeRect(
    range: SelectionSnapshot['ranges'][number],
    content: OverlayContent,
  ): Region | null {
    return this.boundsRect(normalizeRange(range), content)
  }

  /** 边界矩形裁剪到可视窗口后的视口矩形；完全在窗口外返回 null */
  private boundsRect(bounds: RangeBounds, content: OverlayContent): Region | null {
    const minCol = Math.max(bounds.minCol, content.window.cols.start)
    const maxCol = Math.min(bounds.maxCol, content.window.cols.end - 1)
    const minRow = Math.max(bounds.minRow, content.window.rows.start)
    const maxRow = Math.min(bounds.maxRow, content.window.rows.end - 1)
    if (minCol > maxCol || minRow > maxRow) {
      return null
    }
    const topLeft = this.geometry.cellRect(minCol, minRow)
    const bottomRight = this.geometry.cellRect(maxCol, maxRow)
    if (!topLeft || !bottomRight) {
      return null
    }
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x + bottomRight.width - topLeft.x,
      height: bottomRight.y + bottomRight.height - topLeft.y,
    }
  }
}

/** 交互浮层：持有 sky 层节点，update 返回当前是否有内容（供调用方决定失效提交） */
export class InteractionOverlay {
  private readonly node: OverlayNode

  constructor(
    skyRoot: SceneNode,
    private readonly geometry: OverlayGeometry,
    interaction: InteractionTokens,
  ) {
    this.node = new OverlayNode(geometry, interaction)
    this.node.width = geometry.bodyViewport.x + geometry.bodyViewport.width
    this.node.height = geometry.bodyViewport.y + geometry.bodyViewport.height
    skyRoot.appendChild(this.node)
  }

  /** 更新浮层内容；返回是否有可见内容（无内容时节点隐藏，供调用方跳过 sky 失效） */
  update(content: OverlayContent): boolean {
    const has =
      content.selection.ranges.length > 0 ||
      content.hover !== null ||
      content.resizeLine !== null ||
      content.fillPreview !== null
    this.node.visible = has
    this.node.content = has ? content : null
    return has
  }
}
