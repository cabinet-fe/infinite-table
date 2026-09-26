// 单元格场景节点：背景 → 内容（内置 cellType 或自定义渲染 hook）→ 逐边边框。
// 列头/行号列复用同一节点（无 cellType/renderer，样式参数不同）。

import { SceneNode, type RenderContext, type SceneNodeInit } from '@infinite-table/render'

import { BUILTIN_CELL_RENDERERS, type CellRenderer, type CellType } from './cell-renderer'
import { cellStyleFont, type CellBorder, type CellBorderEdge, type CellStyle } from './cell-style'

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
  /**
   * 生效绘制边框（场景侧共享边裁决产物）：显式传入（含 null＝不画边框）即与 style.border 解耦；
   * 缺省跟随 style.border（直接构造/无裁决场景）。
   */
  border?: CellBorder | null
  /** 自定义渲染 hook：接管格内容绘制（背景/边框仍由节点负责） */
  renderer?: CellRenderer | null
  /** 文本可绘制局部右界（≥ width 表示可溢出到右侧空格；缺省= width，裁剪在本格） */
  textMaxX?: number
  /** 文本可绘制局部左界（≤ 0 表示可溢出到左侧空格；缺省= 0，不向左溢出） */
  textMinX?: number
}

export class CellNode extends SceneNode {
  readonly col: number
  readonly row: number
  text: string
  value: unknown
  cellType: CellType
  style: CellStyle
  /** 生效绘制边框（共享边裁决产物；null = 不画边框）；style 被整体替换时不随之变化 */
  border: CellBorder | null
  renderer: CellRenderer | null
  /** 文本可绘制局部右界；等于 width 表示不向右溢出 */
  textMaxX: number
  /** 文本可绘制局部左界；等于 0 表示不向左溢出 */
  textMinX: number
  /**
   * 内容隐藏（编辑会话锚定格）：不绘制渲染器内容（背景/边框照画），DOM 编辑浮层取代之；
   * 溢出文本一并隐去（失效区并入 textMaxX 由编辑接线负责），会话结束置回 false。
   */
  contentHidden = false
  /**
   * 溢出走廊内部标记（WPS 口径竖线跳画）：本格为溢出源格或被溢出文本覆盖的空格时，
   * 取覆盖本格的各走廊中最大右端列号（不含，列号口径）；null = 不在任何走廊内。
   * 由场景装配逐行维护（markRowCorridorInterior，全量重建/增量补建/refreshCell 三路径
   * 先清后标同口径）。right 共享边跳画判定：值 > col + 1 表示右侧邻居与本格同处同一
   * 走廊内部（共享竖边被溢出文本覆盖），跳画；值 = col + 1（本格为走廊末端格，右缘即
   * 走廊末端竖线）或 null（走廊外）照常绘制。上下横边、背景、内容绘制不受影响。
   */
  corridorInterior: number | null = null
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
    // 未显式给生效边框时跟随 style.border（直接构造场景）；场景装配恒显式传入
    this.border = 'border' in init ? (init.border ?? null) : (this.style.border ?? null)
    this.renderer = init.renderer ?? null
    this.textMaxX = init.textMaxX ?? init.width ?? 0
    this.textMinX = init.textMinX ?? 0
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
    if (!this.contentHidden) {
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
        textMinX: this.textMinX,
      })
    }
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
    // 测量函数注入：绘制侧用本层 ctx，场景侧溢出走廊用宿主测量画布；两条路径共用
    // 同一缓存（font 或 text 任一变化即失效重测）。
    return this.measureTextWidthWith((text, font) => {
      ctx.font = font
      return ctx.measureText(text).width
    })
  }

  /**
   * 文本测量宽（测量函数注入）：缓存口径与绘制侧一致——style 引用变化只重算 font 串
   * 并与缓存比较，font 串或 text 变了才重测，两者均未变直接返回缓存。溢出走廊（场景侧）
   * 与内容绘制因此得到同一宽度，且滚动帧重标走廊时零重测。
   */
  measureTextWidthWith(measure: (text: string, font: string) => number): number {
    this.resolveFont()
    if (this.measureText !== this.text) {
      this.measureText = this.text
      this.textWidthPx = measure(this.text, this.measureFont)
    }
    return this.textWidthPx
  }

  /**
   * 逐边边框：按各边线型绘制（fillRect 保证像素对齐），后画压在内容之上。
   * 画「生效边框」（共享边裁决产物，shared-edges.ts）：非所有者的 left/top 已剔除、
   * 所有者边已并入邻居对侧强边；直接构造（未走裁决）时跟随 style.border。
   * right 共享边按走廊内部标记跳画（WPS 口径，见 corridorInterior）：溢出走廊覆盖
   * 范围内不绘制纵向线条（默认网格线与用户显式边框同规则），替代旧「right 边先于
   * 内容绘制」的覆盖式分支；走廊末端与走廊外照常绘制，其余各边不受影响。
   */
  private paintBorders(ctx: RenderContext): void {
    const border = this.border
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
    const rightInCorridor = this.corridorInterior !== null && this.corridorInterior > this.col + 1
    if (border.right && !rightInCorridor) {
      paintEdge(ctx, border.right, width - border.right.width, 0, height, false)
    }
  }
}
