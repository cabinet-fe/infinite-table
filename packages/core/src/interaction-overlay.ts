// 交互浮层：选区、resize 拖拽线绘制在 sky 层，不触发 body 重绘。
// 浮层节点不可拾取（pickable: false），指针事件穿透到 body 层。
// 绘制颜色/宽度唯一来源为主题 interaction 分区 token（构造时传入生效主题的解析值；
// 运行时 updateTheme 换主题时经 updateTheme 方法更换，不残留构造期旧对象引用）。

import { SceneNode, type Region, type RenderContext } from '@infinitable/render'

import { fillHandleRect } from './fill-handle'
import type { WindowRange } from './grid-layout'
import {
  normalizeRange,
  type RangeBounds,
  type SelectionRange,
  type SelectionSnapshot,
} from './selection'
import type { ScrollbarAxisView } from './scrollbar'
import { scrollbarThumbThickness } from './scrollbar'
import type { InteractionTokens } from './theme'

/** 浮层绘制所需的几何查询（闭包读取表格实时状态） */
export interface OverlayGeometry {
  /** 数据格在视口中的矩形；行/列在可视窗口外返回 null */
  cellRect(col: number, row: number): Region | null
  /** 数据区在视口中的可绘制矩形（扣除行列头；闭包实时读取，容器 resize 原地自适应） */
  bodyViewport(): Region
  /** 画布整体尺寸（滚动条/预留轨道锚定画布右/下缘，浮层节点须覆盖整画布） */
  canvas(): { width: number; height: number }
}

/** resize 拖拽指示线（视口坐标） */
export interface ResizeLine {
  readonly orientation: 'vertical' | 'horizontal'
  readonly position: number
}

/**
 * 宿主高亮区域（公式引用染色框等）：四边细条边框，颜色由宿主逐条指定。
 * 与选区语义无关，仅绘制；画在选区之上（引用拾取时被拾取段同时是选区，边框须保持可见）。
 */
export interface HighlightRange {
  /** 高亮范围（min/max 序；可视窗口外部分裁剪不画） */
  readonly bounds: RangeBounds
  /** 边框颜色（CSS 颜色值，宿主循环色板逐条指定） */
  readonly color: string
}

export interface OverlayContent {
  readonly selection: SelectionSnapshot
  readonly resizeLine: ResizeLine | null
  /** 填充柄所在焦点段（无选区为 null）；柄绘制在焦点段右下角格的角点上 */
  readonly fillHandleRange: SelectionRange | null
  /** 填充拖拽预览区（轴锁定后的纯扩展区；非拖拽中为 null） */
  readonly fillPreview: RangeBounds | null
  /** 选区锚点（编辑拾取会话中被编辑格保持的选区绘制；无为 null） */
  readonly selectionAnchor: RangeBounds | null
  /** 宿主高亮区域（公式引用染色框等）；无为空数组 */
  readonly highlightRanges: readonly HighlightRange[]
  /** 冻结分隔线位置（视口坐标；x = 冻结列右缘竖线、y = 冻结行下缘横线，冻结数为 0 的轴为 null） */
  readonly freezeDividers: { x: number | null; y: number | null }
  /** 内建滚动条浮层视图（不可滚动/静止隐藏/选项关闭的轴为 null） */
  readonly scrollbars: {
    vertical: ScrollbarAxisView | null
    horizontal: ScrollbarAxisView | null
  }
  /** 预留轨道条带（右缘宽/下缘高；reserve 开启时可滚动轴常驻，0 = 该侧无预留） */
  readonly scrollbarGutter: { width: number; height: number }
  /** 可视窗口（选区裁剪用，[start, end)） */
  readonly window: { rows: WindowRange; cols: WindowRange }
}

export class OverlayNode extends SceneNode {
  content: OverlayContent | null = null

  constructor(
    private readonly geometry: OverlayGeometry,
    private interaction: InteractionTokens,
  ) {
    super({ pickable: false })
  }

  /**
   * 运行时更换交互 token（表格 updateTheme 路径）：后续绘制读新 token，
   * 不残留构造期旧对象引用；重绘提交由调用方（refreshOverlay）完成。
   */
  updateTheme(interaction: InteractionTokens): void {
    this.interaction = interaction
  }

  override paint(ctx: RenderContext): void {
    const content = this.content
    if (!content) {
      return
    }
    const viewport = this.geometry.bodyViewport()
    ctx.save()
    ctx.beginPath()
    ctx.rect(viewport.x, viewport.y, viewport.width, viewport.height)
    ctx.clip()
    this.paintFreezeDividers(ctx, content, viewport)
    this.paintSelection(ctx, content)
    this.paintSelectionAnchor(ctx, content)
    this.paintHighlightRanges(ctx, content)
    this.paintFillPreview(ctx, content)
    this.paintFillHandle(ctx, content)
    this.paintResizeLine(ctx, content, viewport)
    ctx.restore()
    // 滚动条与预留轨道锚定视口（覆盖行号列/列头带），不随 body 裁剪
    this.paintScrollbarGutter(ctx, content)
    this.paintScrollbars(ctx, content)
  }

  /**
   * 预留轨道条带底色：可滚动轴的画布右/下缘常驻不透明轨道（宽/高 = scrollbarSize），
   * 盖住探出内容区边缘的部分列与溢出文本——滚动条画其上，表格主体不被遮挡。
   * 两轴交汇的右下角由横轴条带整宽覆盖。
   */
  private paintScrollbarGutter(ctx: RenderContext, content: OverlayContent): void {
    const { width: gx, height: gy } = content.scrollbarGutter
    if (gx <= 0 && gy <= 0) {
      return
    }
    ctx.fillStyle = this.interaction.scrollbarTrackColor
    if (gx > 0) {
      ctx.fillRect(this.width - gx, 0, gx, this.height - gy)
    }
    if (gy > 0) {
      ctx.fillRect(0, this.height - gy, this.width, gy)
    }
  }

  /**
   * 内建滚动条滑块：条带内按几何 + 内缩/圆角/三态绘制（节点尺寸即画布尺寸）。
   * 厚度 = 条带厚 − 2×内缩（hover/拖拽档收窄内缩即变粗）；颜色按 激活 > hover > 默认 取档。
   */
  private paintScrollbars(ctx: RenderContext, content: OverlayContent): void {
    const tokens = this.interaction
    const vertical = content.scrollbars.vertical
    if (vertical) {
      const margin =
        vertical.active || vertical.hover ? tokens.scrollbarMarginHover : tokens.scrollbarMargin
      this.paintRoundedRect(
        ctx,
        this.width - tokens.scrollbarSize + margin,
        vertical.geometry.thumbPos,
        scrollbarThumbThickness(tokens.scrollbarSize, margin),
        vertical.geometry.thumbSize,
        tokens.scrollbarRadius,
        this.scrollbarThumbColor(vertical),
      )
    }
    const horizontal = content.scrollbars.horizontal
    if (horizontal) {
      const margin =
        horizontal.active || horizontal.hover ? tokens.scrollbarMarginHover : tokens.scrollbarMargin
      this.paintRoundedRect(
        ctx,
        horizontal.geometry.thumbPos,
        this.height - tokens.scrollbarSize + margin,
        horizontal.geometry.thumbSize,
        scrollbarThumbThickness(tokens.scrollbarSize, margin),
        tokens.scrollbarRadius,
        this.scrollbarThumbColor(horizontal),
      )
    }
  }

  /** 滑块三态取色：拖拽激活 > hover > 默认 */
  private scrollbarThumbColor(view: ScrollbarAxisView): string {
    if (view.active) {
      return this.interaction.scrollbarThumbActive
    }
    return view.hover ? this.interaction.scrollbarThumbHover : this.interaction.scrollbarThumb
  }

  /**
   * 圆角矩形填充：RenderContext 最小子集无圆角路径原语，用「中段整条 + 两端按圆弧
   * 逐行光栅化」拼出（半径钳到短边一半成胶囊形；半径 <1 退化为直角整条）。
   */
  private paintRoundedRect(
    ctx: RenderContext,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    color: string,
  ): void {
    ctx.fillStyle = color
    const r = Math.max(0, Math.min(radius, width / 2, height / 2))
    if (r < 1) {
      ctx.fillRect(x, y, width, height)
      return
    }
    // 中段整条（半径钳到短边一半的胶囊形态下中段长度为 0，仅端部行覆盖全厚度）
    if (height - 2 * r > 0) {
      ctx.fillRect(x, y + r, width, height - 2 * r)
    }
    for (let i = 0; i < Math.ceil(r); i++) {
      const rowHeight = Math.min(1, r - i)
      // 行中心到端点的圆弧半宽 → 两端内缩量（端行内缩最多、近中行贴合全宽）
      const dy = Math.min(i + rowHeight / 2, r)
      const inset = r - Math.sqrt(r * r - (r - dy) * (r - dy))
      const insetWidth = Math.max(0, width - 2 * inset)
      ctx.fillRect(x + inset, y + i, insetWidth, rowHeight)
      ctx.fillRect(x + inset, y + height - i - rowHeight, insetWidth, rowHeight)
    }
  }

  /** 冻结分隔线：冻结列右缘竖线 / 冻结行下缘横线，裁剪在 body 视口内，画在选区之下 */
  private paintFreezeDividers(ctx: RenderContext, content: OverlayContent, viewport: Region): void {
    const { x, y } = content.freezeDividers
    if (x === null && y === null) {
      return
    }
    const w = this.interaction.freezeDividerWidth
    ctx.fillStyle = this.interaction.freezeDividerColor
    // 线体贴边界落在冻结带内侧（与格右边/底边同侧，对齐格边框的像素归属）
    if (x !== null) {
      ctx.fillRect(x - w, viewport.y, w, viewport.height)
    }
    if (y !== null) {
      ctx.fillRect(viewport.x, y - w, viewport.width, w)
    }
  }

  private paintSelection(ctx: RenderContext, content: OverlayContent): void {
    for (const range of content.selection.ranges) {
      const rect = this.rangeRect(range, content)
      if (!rect) {
        continue
      }
      this.paintSelectionRect(ctx, rect)
    }
  }

  /** 选区锚点：编辑拾取会话中被编辑格持续保持的选区绘制（选区已流动到拾取段，本格不丢选中态） */
  private paintSelectionAnchor(ctx: RenderContext, content: OverlayContent): void {
    if (!content.selectionAnchor) {
      return
    }
    const rect = this.boundsRect(content.selectionAnchor, content)
    if (!rect) {
      return
    }
    this.paintSelectionRect(ctx, rect)
  }

  /** 选区样式矩形：主题 token 填充 + 四边细条边框（RenderContext 无 stroke，用细条填充） */
  private paintSelectionRect(ctx: RenderContext, rect: Region): void {
    ctx.fillStyle = this.interaction.selectionFill
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    ctx.fillStyle = this.interaction.selectionBorder
    const w = this.interaction.selectionBorderWidth
    ctx.fillRect(rect.x, rect.y, rect.width, w)
    ctx.fillRect(rect.x, rect.y + rect.height - w, rect.width, w)
    ctx.fillRect(rect.x, rect.y, w, rect.height)
    ctx.fillRect(rect.x + rect.width - w, rect.y, w, rect.height)
  }

  /** 宿主高亮区域：四边细条边框（无填充），逐条取宿主指定颜色；完全在可视窗口外跳过 */
  private paintHighlightRanges(ctx: RenderContext, content: OverlayContent): void {
    const w = this.interaction.selectionBorderWidth
    for (const highlight of content.highlightRanges) {
      const rect = this.boundsRect(highlight.bounds, content)
      if (!rect) {
        continue
      }
      ctx.fillStyle = highlight.color
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
    private readonly skyRoot: SceneNode,
    private readonly geometry: OverlayGeometry,
    interaction: InteractionTokens,
  ) {
    this.node = new OverlayNode(geometry, interaction)
    this.resize()
    skyRoot.appendChild(this.node)
  }

  /**
   * 重挂为 sky root 末子节点（层内绘制顺序最顶）：浮动对象层/水印等节点惰性后挂会
   * 排到本节点之后，调用方在每次后挂后调用，滚动条保持画在浮层最上方。
   */
  raiseToTop(): void {
    this.skyRoot.appendChild(this.node)
  }

  /** 视口尺寸变化后重设浮层节点覆盖范围（整画布：滚动条/预留轨道锚定画布右/下缘） */
  resize(): void {
    const { width, height } = this.geometry.canvas()
    this.node.width = width
    this.node.height = height
  }

  /** 运行时更换交互 token（表格 updateTheme 路径）：浮层绘制改读新主题解析值 */
  updateTheme(interaction: InteractionTokens): void {
    this.node.updateTheme(interaction)
  }

  /** 更新浮层内容；返回是否有可见内容（无内容时节点隐藏，供调用方跳过 sky 失效） */
  update(content: OverlayContent): boolean {
    const has =
      content.selection.ranges.length > 0 ||
      content.resizeLine !== null ||
      content.fillPreview !== null ||
      content.selectionAnchor !== null ||
      content.highlightRanges.length > 0 ||
      content.freezeDividers.x !== null ||
      content.freezeDividers.y !== null ||
      content.scrollbarGutter.width > 0 ||
      content.scrollbarGutter.height > 0 ||
      content.scrollbars.vertical !== null ||
      content.scrollbars.horizontal !== null
    this.node.visible = has
    this.node.content = has ? content : null
    return has
  }
}
