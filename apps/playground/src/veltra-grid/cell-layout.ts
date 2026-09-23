// customLayout 布局对象（Text/Rect 基础形态）→ 本仓引擎格渲染的映射。
// 对齐 ultra-ui @veltra/sheet-core/grid 的 customLayout 契约（ADR-0004）：宿主以
// CustomLayout 构建布局对象，经 SheetGrid 的 resolveCellRenderer 按格分发（仅 body 格）；
// 渲染不写模型、不进快照；hook 返回 undefined 回落默认渲染。
// 字段命名与 VTable 图形属性同口径（fill/fontSize/fontWeight/textAlign/textBaseline）；
// 坐标一律为格内局部坐标（引擎渲染器 ctx 已平移到格左上角），由本模块换算定位。

import type { CellRenderTarget, CellRenderer } from '@infinite-table/core'

/** Text 元素：text 缺省回落格显示值；x/y 缺省按 textAlign/textBaseline 在整格内定位 */
export interface CellLayoutText {
  type: 'text'
  /** 显示文本；缺省用格显示值（显示值管线产物，宿主无需重复拼接） */
  text?: string
  /** 行盒左缘横坐标；缺省按 textAlign 定位 */
  x?: number
  /** 行盒顶缘纵坐标；缺省按 textBaseline 定位 */
  y?: number
  fontSize?: number
  fontWeight?: number | string
  fontFamily?: string
  /** 文本色；缺省随格样式 color */
  fill?: string
  textAlign?: 'left' | 'center' | 'right'
  textBaseline?: 'top' | 'middle' | 'bottom'
}

/** Rect 元素：x/y 缺省 0、宽/高缺省整格（fillRect 绘制，保证像素对齐；无 fill 不绘制） */
export interface CellLayoutRect {
  type: 'rect'
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
}

/** 布局对象（ultra-ui ICustomLayoutObj 的 Text/Rect 基础形态子集） */
export type ICustomLayoutObj = CellLayoutText | CellLayoutRect

/** 布局对象构建器：宿主经 new CustomLayout(root) 声明锚点格渲染形态 */
export class CustomLayout {
  constructor(public readonly root: ICustomLayoutObj) {}
}

/** 行盒高/基线下移随字号缩放（与引擎内置 text 渲染同一启发式，观感一致） */
const LINE_HEIGHT_RATIO = 4 / 3
const BASELINE_OFFSET_RATIO = 1 / 3
const DEFAULT_FONT_SIZE = 12
/** 无格样式色兜底时的文本色（与引擎内置 text 渲染缺省一致） */
const DEFAULT_TEXT_COLOR = '#1f2329'

/** textAlign → 行盒左缘：left 贴格左缘，center/right 在格宽内按文本宽定位 */
function alignX(align: CellLayoutText['textAlign'], textWidth: number, cellWidth: number): number {
  if (align === 'center') return (cellWidth - textWidth) / 2
  if (align === 'right') return cellWidth - textWidth
  return 0
}

/** textBaseline → 文本基线：以行盒高为基准，top 贴顶、bottom 贴底、middle（缺省）居中 */
function baselineY(
  baseline: CellLayoutText['textBaseline'],
  cellHeight: number,
  lineHeight: number,
  baselineOffset: number,
): number {
  if (baseline === 'top') return lineHeight - baselineOffset
  if (baseline === 'bottom') return cellHeight - baselineOffset
  return cellHeight / 2 + baselineOffset
}

function drawLayoutText(target: CellRenderTarget, el: CellLayoutText): void {
  const text = el.text ?? target.text
  if (!text) return
  const fontSize = el.fontSize ?? DEFAULT_FONT_SIZE
  const lineHeight = Math.round(fontSize * LINE_HEIGHT_RATIO)
  const baselineOffset = Math.round(fontSize * BASELINE_OFFSET_RATIO)
  const ctx = target.ctx
  ctx.fillStyle = el.fill ?? target.style.color ?? DEFAULT_TEXT_COLOR
  const weight = el.fontWeight?.toString()
  ctx.font = [weight, `${fontSize}px`, el.fontFamily ?? 'sans-serif']
    .filter((part) => part !== undefined)
    .join(' ')
  const x = el.x ?? alignX(el.textAlign, ctx.measureText(text).width, target.width)
  const baseline =
    el.y !== undefined
      ? el.y + lineHeight - baselineOffset
      : baselineY(el.textBaseline, target.height, lineHeight, baselineOffset)
  ctx.fillText(text, x, baseline)
}

function drawLayoutRect(target: CellRenderTarget, el: CellLayoutRect): void {
  if (!el.fill) return
  const ctx = target.ctx
  ctx.fillStyle = el.fill
  ctx.fillRect(el.x ?? 0, el.y ?? 0, el.width ?? target.width, el.height ?? target.height)
}

/** 布局对象 → 引擎格渲染器（格几何/显示值经入参注入，背景与边框仍由节点绘制） */
export function cellLayoutRenderer(layout: CustomLayout): CellRenderer {
  return (target) => {
    const root = layout.root
    if (root.type === 'rect') {
      drawLayoutRect(target, root)
    } else {
      drawLayoutText(target, root)
    }
  }
}

const rendererCache = new WeakMap<CustomLayout, CellRenderer>()

/** 分发用渲染器：同一布局对象只构建一次绘制闭包（按格分发热路径零分配） */
export function cachedCellLayoutRenderer(layout: CustomLayout): CellRenderer {
  let renderer = rendererCache.get(layout)
  if (!renderer) {
    renderer = cellLayoutRenderer(layout)
    rendererCache.set(layout, renderer)
  }
  return renderer
}
