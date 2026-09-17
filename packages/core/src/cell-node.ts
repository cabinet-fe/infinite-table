// 单元格场景节点：背景 → 内容（内置 cellType 或自定义渲染 hook）→ 逐边边框。
// 列头/行号列复用同一节点（无 cellType/renderer，样式参数不同）。

import { SceneNode, type RenderContext, type SceneNodeInit } from '@infinite-table/render'

import { BUILTIN_CELL_RENDERERS, type CellRenderer, type CellType } from './cell-renderer'
import { cellStyleFont, type CellBorderEdge, type CellStyle } from './cell-style'

/** dashed 线型段：段长 6、间隔 4（CSS 像素） */
const DASHED_SEGMENT = { on: 6, off: 4 } as const
/** dotted 线型段：段长 1、间隔 2（CSS 像素） */
const DOTTED_SEGMENT = { on: 1, off: 2 } as const

/**
 * 画一条边线：solid（含缺省）全长实线；dashed/dotted 沿边按段绘制（末段可截短）；
 * double 为厚度带内贴两外侧的两条平行实线（各占约 1/3 厚度）。
 * x/y 为边带外角坐标，run 为边长，horizontal 表示边沿水平方向延伸。
 */
function paintEdge(
  ctx: RenderContext,
  edge: CellBorderEdge,
  x: number,
  y: number,
  run: number,
  horizontal: boolean,
): void {
  const thickness = edge.width
  // along 沿边方向、cross 垂直边方向（厚度带内）
  const fillSegment = (
    alongStart: number,
    alongLength: number,
    crossStart: number,
    crossLength: number,
  ): void => {
    ctx.fillStyle = edge.color
    ctx.fillRect(
      horizontal ? x + alongStart : x + crossStart,
      horizontal ? y + crossStart : y + alongStart,
      horizontal ? alongLength : crossLength,
      horizontal ? crossLength : alongLength,
    )
  }
  if (edge.style === 'double') {
    const line = Math.max(1, Math.floor(thickness / 3))
    fillSegment(0, run, 0, line)
    fillSegment(0, run, thickness - line, line)
    return
  }
  if (edge.style === 'dashed' || edge.style === 'dotted') {
    const { on, off } = edge.style === 'dashed' ? DASHED_SEGMENT : DOTTED_SEGMENT
    for (let start = 0; start < run; start += on + off) {
      fillSegment(start, Math.min(on, run - start), 0, thickness)
    }
    return
  }
  fillSegment(0, run, 0, thickness)
}

export interface CellNodeInit extends SceneNodeInit {
  col: number
  row: number
  text?: string
  /** 取值管线基础值（checkbox 勾选态、自定义渲染器可用） */
  value?: unknown
  cellType?: CellType
  /** 投影后的逐格样式（含逐边边框） */
  style?: CellStyle
  /** 自定义渲染 hook：接管格内容绘制（背景/边框仍由节点负责） */
  renderer?: CellRenderer | null
  /** 文本可绘制局部右界（≥ width 表示可溢出到右侧空格；缺省= width，裁剪在本格） */
  textMaxX?: number
}

export class CellNode extends SceneNode {
  readonly col: number
  readonly row: number
  text: string
  value: unknown
  cellType: CellType
  style: CellStyle
  renderer: CellRenderer | null
  /** 文本可绘制局部右界；等于 width 表示不溢出 */
  textMaxX: number
  /** 文本测量宽缓存：font 串/text 值任一变化即失效重测，免每次 paint 拼键；style 引用仅用于免重复组装 font 串 */
  private measureStyle: CellStyle | null = null
  private measureFont = ''
  private measureText: string | null = null
  private textWidthPx = 0

  constructor(init: CellNodeInit) {
    super(init)
    this.col = init.col
    this.row = init.row
    this.text = init.text ?? ''
    this.value = init.value
    this.cellType = init.cellType ?? 'text'
    this.style = init.style ?? {}
    this.renderer = init.renderer ?? null
    this.textMaxX = init.textMaxX ?? init.width ?? 0
  }

  /** 刷新管线产物（文本与基础值）；测量缓存按 text 值变更自动失效 */
  setContent(text: string, value: unknown): void {
    this.text = text
    this.value = value
  }

  override paint(ctx: RenderContext): void {
    if (this.style.background) {
      ctx.fillStyle = this.style.background
      ctx.fillRect(0, 0, this.width, this.height)
    }
    const renderer = this.renderer ?? BUILTIN_CELL_RENDERERS[this.cellType]
    const textWidth = this.measureTextWidth(ctx)
    renderer({
      ctx,
      col: this.col,
      row: this.row,
      width: this.width,
      height: this.height,
      text: this.text,
      value: this.value,
      style: this.style,
      textWidth,
      // 内置 text 路径已在测量内经 resolveFont 推导并缓存 font 串，直接复用
      // 同一结果（测量 font = 绘制 font，渲染器不再重复组装）；其它路径传
      // undefined，由渲染器回退 cellStyleFont(style)（R3-2）
      font: textWidth === undefined ? undefined : this.measureFont,
      textMaxX: this.textMaxX,
    })
    this.paintBorders(ctx)
  }

  /**
   * font 串推导的单一私有路径（R3-2）：命中判定按 R2-8 口径——style 引用变化
   * 只重算 font 串并与缓存比较，变了才使宽度失效；paint 内测量缓存与渲染器
   * 入参共用同一推导结果，消除同帧对同一 style 的重复组装。
   */
  private resolveFont(): string {
    if (this.measureStyle !== this.style) {
      this.measureStyle = this.style
      const font = cellStyleFont(this.style)
      if (font !== this.measureFont) {
        this.measureFont = font
        this.measureText = null
      }
    }
    return this.measureFont
  }

  /** 内置 text 路径的文本测量宽（缓存）；其它路径不需要测量 */
  private measureTextWidth(ctx: RenderContext): number | undefined {
    if (this.renderer || this.cellType !== 'text' || !this.text) {
      return undefined
    }
    // font 或 text 任一变化即失效重测：style 引用变化只重算 font 串并与缓存值
    // 比较，font 串变了才使宽度失效（仅换 style 引用而 font 结果不变不重测）；
    // style 引用未变时 font 串复用免重组装——重绘热路径（style/text 均未变）
    // 零字符串分配。推导唯一入口 resolveFont，绘制侧复用同一结果，保证测量宽
    // 与实际绘制一致。
    this.resolveFont()
    if (this.measureText !== this.text) {
      this.measureText = this.text
      ctx.font = this.measureFont
      this.textWidthPx = ctx.measureText(this.text).width
    }
    return this.textWidthPx
  }

  /**
   * 逐边边框：按各边线型绘制（fillRect 保证像素对齐），后画压在内容之上。
   * 四边各自 width/color/style 独立生效。
   */
  private paintBorders(ctx: RenderContext): void {
    const border = this.style.border
    if (!border) {
      return
    }
    const { width, height } = this
    if (border.top) {
      paintEdge(ctx, border.top, 0, 0, width, true)
    }
    if (border.bottom) {
      paintEdge(ctx, border.bottom, 0, height - border.bottom.width, width, true)
    }
    if (border.left) {
      paintEdge(ctx, border.left, 0, 0, height, false)
    }
    if (border.right) {
      paintEdge(ctx, border.right, width - border.right.width, 0, height, false)
    }
  }
}
