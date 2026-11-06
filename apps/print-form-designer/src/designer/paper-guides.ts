// 画布 overlay 纸张边界与分页参考线（P4）：设计画布显示层，永不写入模板 JSON——
// 配置只存在于宿主（DesignerPage React 状态 / overlay 闭包），FormDoc 无任何入口。
//
// - 挂载走协议槽位：SheetGrid 协议面 getTable() 即 EngineAssembly，overlay painter
//   经 setOverlayPainter 写入 sky 层最顶（watermark 插件同款协议路径）；painter
//   锚定视口（协议语义），设计画布固定行列、内容不超视口时与内容坐标恒对齐。
// - 分页估算复用 print 插件 paginate（fitpage/origin 口径）：供数经
//   createEnginePrintSource 从挂载引擎的导出读取面取行列几何——估算与画布渲染
//   同源；真实分页以打印弹框预览为准（P8），参考线仅作设计参照。
// - 纸张尺寸换算（mm→px、预设表、缺省边距）与 print 内核 paper.ts 同口径常量，
//   由测试用「整页高度恰好放满 → 单页」的边界用例锁定两者一致。

import type { PrintOrientation, PrintPaperPreset, PrintSource } from '@infinitable/plugins'
import { createEnginePrintSource, createPrintPlugin } from '@infinitable/plugins'
import type { SheetGrid } from '@infinitable/sheet'

/** 纸张参考线配置（显示层概念：纸张预设 + 方向 + 四边距 px） */
export interface PaperGuidesConfig {
  paperSize: PrintPaperPreset
  orientation: PrintOrientation
  marginPx: number
}

/** 缺省参考线配置：A4 纵向 + 缺省边距 48px（对齐 print paper.ts DEFAULT_PRINT_MARGIN_PX） */
export const DEFAULT_PAPER_GUIDES: PaperGuidesConfig = {
  paperSize: 'A4',
  orientation: 'portrait',
  marginPx: 48,
}

/** mm → px 换算系数（96dpi，与 print paper.ts MM_TO_PX 同式） */
const MM_TO_PX = 96 / 25.4

/**
 * 纸张预设尺寸表（mm，portrait 口径宽×高；ISO 标准值与 print paper.ts PAPER_PRESETS_MM 同源）。
 * 只收预设代号——自定义 mm 纸张属打印弹框（P8）配置面，不进设计参考线。
 */
const PAPER_PRESETS_MM: Readonly<Record<PrintPaperPreset, { widthMm: number; heightMm: number }>> =
  Object.freeze({
    A3: Object.freeze({ widthMm: 297, heightMm: 420 }),
    A4: Object.freeze({ widthMm: 210, heightMm: 297 }),
    A5: Object.freeze({ widthMm: 148, heightMm: 210 }),
    Letter: Object.freeze({ widthMm: 215.9, heightMm: 279.4 }),
  })

/** 纸张内容区尺寸（px：纸幅 − 左右/上下边距；landscape 交换宽高后扣边距） */
export function paperAreaPx(config: PaperGuidesConfig): { width: number; height: number } {
  const preset = PAPER_PRESETS_MM[config.paperSize]
  const portrait = { w: preset.widthMm * MM_TO_PX, h: preset.heightMm * MM_TO_PX }
  const page = config.orientation === 'landscape' ? { w: portrait.h, h: portrait.w } : portrait
  return { width: page.w - config.marginPx * 2, height: page.h - config.marginPx * 2 }
}

/** 分页参考线几何（画布内容坐标系，px） */
interface PaperGuideGeometry {
  /** 纸张内容区（第一页锚定画布内容原点：可见的纸张边界） */
  paper: { width: number; height: number }
  /** 纵向换页参考线的 y 偏移（相邻页行带边界，不含末页边界；空 = 单页） */
  rowBreaks: number[]
  /** 横向换列参考线的 x 偏移（超宽内容切列带边界；空 = 单列带） */
  colBreaks: number[]
}

/**
 * 参与分页的行列域（半开区间 [0, n)）。无限画布引擎的 read.rowCount/colCount 是
 * 扩容后的尺寸（含上百行空行），直接当打印域会画出一整屏换页线——调用方传内容
 * 包围盒即可把参考线限制在真实内容范围内。
 */
interface PageGuideDomain {
  rowCount: number
  colCount: number
}

/** 行带边界 y 偏移：[0, end) 行高累加 */
function rowOffset(source: PrintSource, endRow: number): number {
  let offset = 0
  for (let row = 0; row < endRow; row++) offset += source.rowHeight(row)
  return offset
}

/** 列带边界 x 偏移：[0, end) 列宽累加 */
function colOffset(source: PrintSource, endCol: number): number {
  let offset = 0
  for (let col = 0; col < endCol; col++) offset += source.colWidth(col)
  return offset
}

/**
 * 估算分页参考线几何：paginate（缺省 fitpage/origin，与参考线口径一致）产出的页
 * 行带/列带边界换算为内容坐标偏移。横向分页按「行带 × 列带」叉乘落页，边界去重。
 * domain 是必需入参：无限画布引擎的行列数含扩容噪声，只在内容包围盒内分页。
 */
export function computePageGuides(
  source: PrintSource,
  config: PaperGuidesConfig,
  domain: PageGuideDomain,
): PaperGuideGeometry {
  const pages = createPrintPlugin({ source }).paginate({
    paperSize: config.paperSize,
    orientation: config.orientation,
    margin: config.marginPx,
    rowRange: { start: 0, end: domain.rowCount },
    colRange: { start: 0, end: domain.colCount },
  })
  const rowEnds = [...new Set(pages.map((page) => page.rowRange.end))]
  const colEnds = [...new Set(pages.map((page) => page.colRange.end))]
  return {
    paper: paperAreaPx(config),
    rowBreaks: rowEnds.slice(0, -1).map((end) => rowOffset(source, end)),
    colBreaks: colEnds.slice(0, -1).map((end) => colOffset(source, end)),
  }
}

/** 绘制上下文窄接口（RenderContext 的绘制子集；painter 参数按结构化子类型接协议槽位） */
export interface GuideContext {
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, width: number, height: number): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
}

/** 纸张边界（实线灰）与分页参考线（虚线蓝）的颜色 */
const PAPER_BOUNDARY_COLOR = '#94a3b8'
const PAGE_BREAK_COLOR = '#3b82f6'

/** 虚线图案（段长 + 间隔，px）：RenderContext 无 setLineDash，按图案手动分段 */
export interface DashPattern {
  dash: number
  gap: number
}

/** 分页参考线的虚线图案 */
const GUIDE_DASH: DashPattern = { dash: 6, gap: 4 }

/**
 * 手动虚线段：从 (x1,y1) 到 (x2,y2) 按图案推进（水平/垂直线通用）。
 * 调用方负责 beginPath / strokeStyle / stroke；本函数只铺路径。
 * overlay 的分页参考线与区域展开提示共用本实现，只有图案不同。
 */
export function dashedLine(
  ctx: GuideContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pattern: DashPattern,
): void {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)
  if (length === 0) return
  const ux = dx / length
  const uy = dy / length
  const step = pattern.dash + pattern.gap
  for (let d = 0; d < length; d += step) {
    const end = Math.min(d + pattern.dash, length)
    ctx.moveTo(x1 + ux * d, y1 + uy * d)
    ctx.lineTo(x1 + ux * end, y1 + uy * end)
  }
}

/**
 * 绘制参考线：纸张内容区矩形（第一页锚定画布内容原点 origin）+ 换页/换列虚线
 * （横贯/纵贯视口，超出纸宽的画布区域也可见换页位置）。
 */
export function drawPageGuides(
  ctx: GuideContext,
  viewport: { width: number; height: number },
  geometry: PaperGuideGeometry,
  origin: { x: number; y: number },
): void {
  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = PAPER_BOUNDARY_COLOR
  ctx.beginPath()
  ctx.rect(origin.x, origin.y, geometry.paper.width, geometry.paper.height)
  ctx.stroke()
  ctx.strokeStyle = PAGE_BREAK_COLOR
  ctx.beginPath()
  for (const y of geometry.rowBreaks) {
    dashedLine(ctx, 0, origin.y + y, viewport.width, origin.y + y, GUIDE_DASH)
  }
  for (const x of geometry.colBreaks) {
    dashedLine(ctx, origin.x + x, 0, origin.x + x, viewport.height, GUIDE_DASH)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * 参考线 painter（OverlayPainter 协议的结构化子类型实现）：开启且画布在挂载态时，
 * 从当前引擎读取面估算分页并绘制；画布内容原点取 (0,0) 格的视口矩形（含行号列/
 * 列头偏移），无可见原点（空画布）跳过绘制。
 *
 * `getContentBounds` 是必需依赖：无限画布的行列数含大量扩容噪声，分页域一律取内容
 * 包围盒，避免画出一整屏换页线。
 *
 * 注意：本 painter 只负责参考线。sky 层槽位由 canvas-overlay 的组合 painter 统一持有
 * （区域轨道 + 参考线），本函数作为其内部子画笔被调用。
 */
export function createPaperGuidesPainter(
  getGrid: () => SheetGrid | undefined,
  getConfig: () => PaperGuidesConfig | null,
  getContentBounds: () => { rows: number; cols: number },
): (ctx: GuideContext, viewport: { width: number; height: number }) => void {
  return (ctx, viewport) => {
    const config = getConfig()
    const grid = getGrid()
    if (!config || !grid) return
    const table = grid.getTable()
    if (!table.read) return
    const origin = table.getCellRelativeRect(0, 0)
    if (!origin) return
    const bounds = getContentBounds()
    // 空内容（包围盒为 0）不画参考线：没有内容就没有换页
    if (bounds.rows === 0 || bounds.cols === 0) return
    drawPageGuides(
      ctx,
      viewport,
      computePageGuides(createEnginePrintSource(table), config, {
        rowCount: bounds.rows,
        colCount: bounds.cols,
      }),
      origin,
    )
  }
}
