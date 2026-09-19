// 单元格渲染：内置 text/checkbox 类型渲染 + 自定义渲染 hook。
// 渲染器拿到的 ctx 已平移到格内局部原点；text/value 是取值管线的产物，
// 自定义渲染器可以完全不用它们（与取值管线解耦，凭 col/row 自渲染任意内容）。

import type { RenderContext } from '@infinite-table/render'

import {
  cellStyleFont,
  type CellPadding,
  type CellStyle,
  type CellTextAlign,
  type CellVerticalAlign,
} from './cell-style'

/** 内置单元格类型 */
export type CellType = 'text' | 'checkbox'

/** 渲染器入参：格几何 + 管线产物 + 投影后样式 */
export interface CellRenderTarget {
  ctx: RenderContext
  col: number
  row: number
  width: number
  height: number
  /** 取值管线最终显示文本 */
  text: string
  /** 取值管线基础值（模型值或 records 字段值），checkbox 据此判定勾选态 */
  value: unknown
  style: CellStyle
  /** 文本测量宽（内置 text 渲染路径由节点测量传入） */
  textWidth?: number
  /** 节点已推导的 font 串（内置 text 路径由 CellNode 与测量同源传入）；缺省时渲染器自行 cellStyleFont(style) */
  font?: string
  /** 文本可绘制的局部右界：等于 width 即裁剪在本格，更大表示可溢出到右侧空格 */
  textMaxX?: number
}

/** 单元格渲染器：在格内局部坐标系绘制内容（背景与边框由节点负责） */
export type CellRenderer = (target: CellRenderTarget) => void

/**
 * 自定义渲染 hook：纯函数、同步、O(1)。
 * 返回渲染器即接管该格内容绘制；返回 null 走内置 cellType 渲染。
 */
export type ResolveCellRenderer = (col: number, row: number) => CellRenderer | null

/** 缺省格内边距：左右 8px、上下 0（历史缺省，与既有锚点行为一致） */
const DEFAULT_PADDING: CellPadding = [0, 8, 0, 8]
/** 行盒高与基线下移量按字号缩放：12px → 16/4（历史值，其它分区字号变化时垂直居中不失真） */
function lineHeightFor(fontSize: number | undefined): number {
  return Math.round((fontSize ?? 12) * (4 / 3))
}
function baselineOffsetFor(fontSize: number | undefined): number {
  return Math.round((fontSize ?? 12) / 3)
}
/** 下划线相对基线的下移量 */
const UNDERLINE_GAP = 2
/** ellipsis 截断符 */
const ELLIPSIS_CHAR = '…'
const CHECKBOX_SIZE = 14
const CHECKBOX_BORDER_COLOR = '#8f959e'
const CHECKBOX_CHECK_COLOR = '#3370ff'

/** 绘制内容盒：格内边距内缩后的局部矩形（文本与 checkbox 的定位/截断基准） */
interface ContentBox {
  x: number
  y: number
  width: number
  height: number
}

/** 格内边距内缩出内容盒：宽高夹到非负，防负 padding 把内容推出格外 */
function contentBox(style: CellStyle, width: number, height: number): ContentBox {
  const [paddingTop, paddingRight, paddingBottom, paddingLeft] = style.padding ?? DEFAULT_PADDING
  return {
    x: paddingLeft,
    y: paddingTop,
    width: Math.max(0, width - paddingLeft - paddingRight),
    height: Math.max(0, height - paddingTop - paddingBottom),
  }
}

/**
 * 水平对齐锚点：left（缺省）贴内容盒左缘，center/right 在盒内按内容宽定位。
 * 文本与 checkbox 等非文本内置内容共用。
 */
function alignedX(align: CellTextAlign | undefined, box: ContentBox, contentWidth: number): number {
  if (align === 'center') {
    return box.x + (box.width - contentWidth) / 2
  }
  if (align === 'right') {
    return box.x + box.width - contentWidth
  }
  return box.x
}

/** 垂直基线：以行盒为基准，在内容盒竖带内定位；top 贴顶、bottom 贴底、middle（缺省）居中 */
function textBaselineY(
  align: CellVerticalAlign | undefined,
  box: ContentBox,
  fontSize: number | undefined,
): number {
  const lineHeight = lineHeightFor(fontSize)
  const baselineOffset = baselineOffsetFor(fontSize)
  if (align === 'top') {
    return box.y + lineHeight - baselineOffset
  }
  if (align === 'bottom') {
    return box.y + box.height - baselineOffset
  }
  return box.y + box.height / 2 + baselineOffset
}

/**
 * 内置 text 渲染：对齐与字体随样式（缺省左对齐垂直居中），绘制区内缩 padding。
 * 超宽文本按 textOverflow：ellipsis 以省略号截断、clip 在内容盒内直接裁剪；
 * 未设置保持既有 Excel 式溢出（左对齐溢出到右侧空格，clip 到允许右界）或格内换行。
 */
export const renderTextCell: CellRenderer = ({
  ctx,
  width,
  height,
  text,
  style,
  textWidth,
  font,
  textMaxX,
}) => {
  if (!text) {
    return
  }
  ctx.fillStyle = style.color ?? '#1f2329'
  // 入参 font 优先（与节点测量同源，免同帧重复组装，R3-2）；缺省回退自组装，
  // 自定义渲染器不感知该字段，向后兼容
  ctx.font = font ?? cellStyleFont(style)
  const box = contentBox(style, width, height)
  const measured = textWidth ?? ctx.measureText(text).width
  const baselineY = textBaselineY(style.verticalAlign, box, style.fontSize)
  if (style.textWrap === true) {
    drawWrappedText(ctx, text, box, width, height, style)
    return
  }
  if (measured > box.width) {
    if (style.textOverflow === 'ellipsis') {
      drawEllipsizedText(ctx, text, box, baselineY, style)
      return
    }
    if (style.textOverflow === 'clip') {
      drawClippedText(ctx, text, box, baselineY, measured, style)
      return
    }
    // 未设置：左对齐（缺省）溢出画进右侧空格（textMaxX > width），中/右对齐裁剪在本格
    const canOverflow = (style.textAlign ?? 'left') === 'left'
    const x = alignedX(style.textAlign, box, measured)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, canOverflow ? Math.max(width, textMaxX ?? width) : width, height)
    ctx.clip()
    ctx.fillText(text, x, baselineY)
    drawTextDecorations(ctx, x, baselineY, measured, style)
    ctx.restore()
    return
  }
  const x = alignedX(style.textAlign, box, measured)
  ctx.fillText(text, x, baselineY)
  drawTextDecorations(ctx, x, baselineY, measured, style)
}

/** 文本修饰线：下划线紧贴基线下方、删除线在小写字母中部（字号 30% 上方），随文本色绘制 */
function drawTextDecorations(
  ctx: RenderContext,
  x: number,
  baselineY: number,
  textWidth: number,
  style: CellStyle,
): void {
  if (style.underline) {
    ctx.fillRect(x, baselineY + UNDERLINE_GAP, textWidth, 1)
  }
  if (style.lineThrough) {
    ctx.fillRect(x, baselineY - Math.round((style.fontSize ?? 12) * 0.3), textWidth, 1)
  }
}

/** ellipsis 截断：找「最长前缀 + 省略号」在内缩盒内放得下的组合，按对齐锚点绘制（截断后必在盒内，无需 clip） */
function drawEllipsizedText(
  ctx: RenderContext,
  text: string,
  box: ContentBox,
  baselineY: number,
  style: CellStyle,
): void {
  const truncated = ellipsizedText(ctx, text, box.width)
  const truncatedWidth = ctx.measureText(truncated).width
  const x = alignedX(style.textAlign, box, truncatedWidth)
  ctx.fillText(truncated, x, baselineY)
  drawTextDecorations(ctx, x, baselineY, truncatedWidth, style)
}

/**
 * 二分找「前缀 + 省略号」宽不超 maxWidth 的最长前缀；
 * 连省略号自身都放不下时返回裸省略号（极窄内容盒的退化场景，允许压线绘制）。
 */
function ellipsizedText(ctx: RenderContext, text: string, maxWidth: number): string {
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(text.slice(0, mid) + ELLIPSIS_CHAR).width <= maxWidth) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return text.slice(0, lo) + ELLIPSIS_CHAR
}

/** clip 裁剪：clip 在内缩内容盒上，超盒文本与修饰线不绘制 */
function drawClippedText(
  ctx: RenderContext,
  text: string,
  box: ContentBox,
  baselineY: number,
  measured: number,
  style: CellStyle,
): void {
  const x = alignedX(style.textAlign, box, measured)
  ctx.save()
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.width, box.height)
  ctx.clip()
  ctx.fillText(text, x, baselineY)
  drawTextDecorations(ctx, x, baselineY, measured, style)
  ctx.restore()
}

/** 换行绘制：逐字贪心断行，行块在内容盒内垂直居中，clip 在本格（超出格高的行被裁掉） */
function drawWrappedText(
  ctx: RenderContext,
  text: string,
  box: ContentBox,
  width: number,
  height: number,
  style: CellStyle,
): void {
  const lineHeight = lineHeightFor(style.fontSize)
  const baselineOffset = baselineOffsetFor(style.fontSize)
  const maxLines = Math.max(1, Math.ceil(height / lineHeight))
  const lines = wrapTextLines(ctx, text, box.width, maxLines)
  const startY = box.y + Math.max(0, (box.height - lines.length * lineHeight) / 2)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, box.x, startY + i * lineHeight + lineHeight / 2 + baselineOffset)
  }
  ctx.restore()
}

/**
 * 断行：先按 \n 强制分段（连续换行产生空行），段内再逐字贪心断行
 * （CJK 无空格断点，统一逐字）——换行符强制断行与自动换行叠加；
 * 超过 maxLines 的剩余行舍弃。
 */
function wrapTextLines(
  ctx: RenderContext,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  for (const segment of text.split('\n')) {
    let current = ''
    for (const char of segment) {
      if (current && ctx.measureText(current + char).width > maxWidth) {
        lines.push(current)
        if (lines.length >= maxLines) {
          return lines
        }
        current = char
      } else {
        current += char
      }
    }
    lines.push(current)
    if (lines.length >= maxLines) {
      return lines
    }
  }
  return lines
}

/** 内置 checkbox 渲染：方框（fillRect 细线保证像素对齐）+ 勾选态实心块；value 即状态，不绘制取值文本；水平/垂直位置跟随 textAlign 与 padding 内缩（缺省左、垂直居中） */
export const renderCheckboxCell: CellRenderer = ({ ctx, width, height, value, style }) => {
  const size = Math.min(CHECKBOX_SIZE, height - 8)
  const box = contentBox(style, width, height)
  const x = alignedX(style.textAlign, box, size)
  const y = box.y + (box.height - size) / 2
  ctx.fillStyle = CHECKBOX_BORDER_COLOR
  ctx.fillRect(x, y, size, 1)
  ctx.fillRect(x, y + size - 1, size, 1)
  ctx.fillRect(x, y, 1, size)
  ctx.fillRect(x + size - 1, y, 1, size)
  if (value) {
    ctx.fillStyle = CHECKBOX_CHECK_COLOR
    ctx.fillRect(x + 3, y + 3, size - 6, size - 6)
  }
}

/** 内置类型渲染表：CellNode 无自定义渲染器时按 cellType 取用 */
export const BUILTIN_CELL_RENDERERS: Readonly<Record<CellType, CellRenderer>> = {
  text: renderTextCell,
  checkbox: renderCheckboxCell,
}
