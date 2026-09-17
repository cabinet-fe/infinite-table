// 单元格渲染：内置 text/checkbox 类型渲染 + 自定义渲染 hook。
// 渲染器拿到的 ctx 已平移到格内局部原点；text/value 是取值管线的产物，
// 自定义渲染器可以完全不用它们（与取值管线解耦，凭 col/row 自渲染任意内容）。

import type { RenderContext } from '@infinite-table/render'

import {
  cellStyleFont,
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

const TEXT_PADDING_X = 8
/** 换行模式行高（12px 字体） */
const TEXT_LINE_HEIGHT = 16
/** 基线相对行盒中线的下移量（12px 字体近似） */
const BASELINE_OFFSET = 4
/** 下划线相对基线的下移量 */
const UNDERLINE_GAP = 2
const CHECKBOX_SIZE = 14
const CHECKBOX_BORDER_COLOR = '#8f959e'
const CHECKBOX_CHECK_COLOR = '#3370ff'

/**
 * 水平对齐锚点：left（缺省）走左内边距，center/right 按内容宽定位。
 * 文本与 checkbox 等非文本内置内容共用。
 */
function alignedX(align: CellTextAlign | undefined, width: number, contentWidth: number): number {
  if (align === 'center') {
    return (width - contentWidth) / 2
  }
  if (align === 'right') {
    return width - TEXT_PADDING_X - contentWidth
  }
  return TEXT_PADDING_X
}

/** 垂直基线：以 TEXT_LINE_HEIGHT 行盒为基准；top 贴顶、bottom 贴底、middle（缺省）居中 */
function textBaselineY(align: CellVerticalAlign | undefined, height: number): number {
  if (align === 'top') {
    return TEXT_LINE_HEIGHT - BASELINE_OFFSET
  }
  if (align === 'bottom') {
    return height - BASELINE_OFFSET
  }
  return height / 2 + BASELINE_OFFSET
}

/** 内置 text 渲染：对齐与字体随样式（缺省左对齐垂直居中）；超宽文本 Excel 式溢出（clip 到允许右界）或格内换行 */
export const renderTextCell: CellRenderer = ({
  ctx,
  width,
  height,
  text,
  style,
  textWidth,
  textMaxX,
}) => {
  if (!text) {
    return
  }
  ctx.fillStyle = style.color ?? '#1f2329'
  ctx.font = cellStyleFont(style)
  const measured = textWidth ?? ctx.measureText(text).width
  const x = alignedX(style.textAlign, width, measured)
  const baselineY = textBaselineY(style.verticalAlign, height)
  if (style.textWrap === true) {
    drawWrappedText(ctx, text, width, height)
    return
  }
  if (measured > width - TEXT_PADDING_X) {
    // 超宽：左对齐（缺省）溢出画进右侧空格（textMaxX > width），中/右对齐裁剪在本格
    const canOverflow = (style.textAlign ?? 'left') === 'left'
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, canOverflow ? Math.max(width, textMaxX ?? width) : width, height)
    ctx.clip()
    ctx.fillText(text, x, baselineY)
    drawTextDecorations(ctx, x, baselineY, measured, style)
    ctx.restore()
    return
  }
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

/** 换行绘制：逐字贪心断行，行块垂直居中，clip 在本格内（超出格高的行被裁掉） */
function drawWrappedText(ctx: RenderContext, text: string, width: number, height: number): void {
  const maxLines = Math.max(1, Math.ceil(height / TEXT_LINE_HEIGHT))
  const lines = wrapTextLines(ctx, text, width - TEXT_PADDING_X, maxLines)
  const startY = Math.max(0, (height - lines.length * TEXT_LINE_HEIGHT) / 2)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, width, height)
  ctx.clip()
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(
      lines[i]!,
      TEXT_PADDING_X,
      startY + i * TEXT_LINE_HEIGHT + TEXT_LINE_HEIGHT / 2 + 4,
    )
  }
  ctx.restore()
}

/** 逐字贪心断行（CJK 无空格断点，统一逐字）；超过 maxLines 的剩余文本舍弃 */
function wrapTextLines(
  ctx: RenderContext,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  let current = ''
  for (const char of text) {
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
  if (current) {
    lines.push(current)
  }
  return lines
}

/** 内置 checkbox 渲染：方框（fillRect 细线保证像素对齐）+ 勾选态实心块；value 即状态，不绘制取值文本；水平位置跟随 textAlign（缺省左） */
export const renderCheckboxCell: CellRenderer = ({ ctx, width, height, value, style }) => {
  const size = Math.min(CHECKBOX_SIZE, height - 8)
  const x = alignedX(style.textAlign, width, size)
  const y = (height - size) / 2
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
