// 画布 overlay 纸张边界与分页参考线（P4）：设计画布显示层，永不写入模板 JSON——
// 配置只存在于宿主（DesignerPage React 状态 / overlay 闭包），FormDoc 无任何入口。
//
// - 挂载走协议槽位：SheetGrid 协议面 getTable() 即 EngineAssembly，overlay painter
//   经 setOverlayPainter 写入 sky 层最顶（watermark 插件同款协议路径）；painter
//   锚定视口（协议语义），设计画布固定行列、内容不超视口时与内容坐标恒对齐。
// - 分页估算复用 print 插件 paginate（fitpage/origin 口径）：供数经
//   createEnginePrintSource 从挂载引擎的导出读取面取行列几何——估算与画布渲染
//   同源；真实分页以打印弹框预览为准（P8），参考线仅作设计参照。
// - 纸张几何直接复用 print 内核 derivePrintableArea（@infinitable/plugins 公开）：
//   参考线与 paginate 走同一推导口径，不再本地复制 mm→px 换算与预设尺寸表。

import type { PrintOrientation, PrintPaperPreset, PrintSource } from '@infinitable/plugins'
import {
  createEnginePrintSource,
  createPrintPlugin,
  derivePrintableArea,
} from '@infinitable/plugins'
import { dashedLine, type DashPattern } from '@infinitable/render'
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

/**
 * 纸张内容区尺寸（px）：直接复用 print 内核 derivePrintableArea（纸幅 mm→px 换算、
 * landscape 交换、扣四边距；参考线无页眉页脚配置，可用高即纸高 − 上下边距）。与
 * paginate 同一推导，显示参考线与真实分页口径天然一致。
 */
export function paperAreaPx(config: PaperGuidesConfig): { width: number; height: number } {
  const area = derivePrintableArea({
    paperSize: config.paperSize,
    orientation: config.orientation,
    margin: config.marginPx,
  })
  return { width: area.width, height: area.height }
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

/** 分页参考线的虚线图案 */
const GUIDE_DASH: DashPattern = { dash: 6, gap: 4 }

/**
 * 绘制参考线：纸张内容区矩形（第一页锚定画布内容原点 origin）+ 换页/换列虚线
 * （横贯/纵贯视口，超出纸宽的画布部分也可见换页位置）。
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
 * 反推内容原点所需的引擎读取子集（结构化子类型：TableEngine 天然满足，测试可字面桩）。
 * 矩形口径与引擎 cellRectInViewport 一致：虚拟窗口外的格返回 null。
 */
export interface GuideOriginTable {
  /** 数据格视口矩形（CSS 像素，含行号列/列头偏移）；窗口外返回 null */
  getCellRelativeRect(col: number, row: number): { x: number; y: number } | null
  /** 当前可视数据格范围（[start, end)，恒可见的冻结行列并入可视范围） */
  getBodyVisibleCellRange(): {
    rows: { start: number; end: number }
    cols: { start: number; end: number }
  }
  /** 行高读取（含逐行覆盖） */
  getRowHeight(row: number): number
  /** 列宽读取 */
  getColWidth(col: number): number
}

/**
 * 画布内容原点（A1 左上角的视口坐标）：A1 在可视窗口内直接取其矩形；滚出窗口后
 * 取可视窗口首格反推——首格矩形减去 [0, row) 行高 / [0, col) 列宽累计（与引擎
 * 前缀和几何互补）。结果可为负：滚出视口的部分由画布裁剪，参考线在任意滚动位置
 * 都恒显示。可视窗口为空（空画布/零视口）返回 null。
 */
export function resolveContentOrigin(table: GuideOriginTable): { x: number; y: number } | null {
  const direct = table.getCellRelativeRect(0, 0)
  if (direct) return { x: direct.x, y: direct.y }
  const { rows, cols } = table.getBodyVisibleCellRange()
  if (rows.start >= rows.end || cols.start >= cols.end) return null
  const anchor = table.getCellRelativeRect(cols.start, rows.start)
  if (!anchor) return null
  let y = anchor.y
  for (let row = 0; row < rows.start; row++) y -= table.getRowHeight(row)
  let x = anchor.x
  for (let col = 0; col < cols.start; col++) x -= table.getColWidth(col)
  return { x, y }
}

/**
 * 参考线 painter（OverlayPainter 协议的结构化子类型实现）：开启且画布在挂载态时，
 * 从当前引擎读取面估算分页并绘制；画布内容原点经 resolveContentOrigin 求取（A1
 * 滚出虚拟窗口也能反推定位），可视窗口为空（空画布）跳过绘制。
 *
 * `getContentBounds` 是必需依赖：无限画布的行列数含大量扩容噪声，分页域一律取内容
 * 包围盒，避免画出一整屏换页线。
 *
 * 注意：本 painter 只负责参考线。sky 层槽位由 canvas-overlay 的组合 painter 统一持有
 * （数据块轨道 + 参考线），本函数作为其内部子画笔被调用。
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
    const origin = resolveContentOrigin(table)
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
