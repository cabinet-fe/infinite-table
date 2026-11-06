// 画布 sky 层组合 overlay：区域矩形描边 + 区域名 pill + 展开方向提示 + 纸张参考线。
//
// 为什么要有它：用户看不懂「区域」的核心原因是界面上没有任何东西把侧栏列表和画布对应起来。
// 这里按展开方式给区域固定配色，画出矩形描边、左上角 pill，并用色条/虚线指出「这里会重复」。
// 侧栏圆点用同一份颜色表（REGION_EXPAND_COLORS），两处一致才能建立对应直觉。
//
// 几何全部每帧现算（getCellRelativeRect 返回视口坐标，天然跟随滚动/尺寸变化，不缓存）。
// 参考线绘制仍复用 paper-guides 的纯函数与既有视觉，不改其口径。

import type { SheetGrid } from '@infinitable/sheet'

import { createPaperGuidesPainter, type PaperGuidesConfig } from './paper-guides'
import { regionsAt, type FormRegion, type RegionExpand } from './template'

/** 视口尺寸（与 overlay painter 协议同形） */
interface Viewport {
  width: number
  height: number
}

/** 展开方式 → 强调色（侧栏圆点与画布描边/pill 共用同一份，保证两处同色） */
export const REGION_EXPAND_COLORS: Record<RegionExpand, string> = {
  none: '#98a2b3',
  down: '#f79009',
  right: '#2f62f0',
}

/** 展开方式 → pill 后缀文案 */
const EXPAND_PILL_SUFFIX: Record<RegionExpand, string> = {
  none: '',
  down: ' · 向下展开',
  right: ' · 向右展开',
}

/** 虚线：段长 / 间隔（px；RenderContext 无 setLineDash，手动分段） */
const DASH_PX = 4
const DASH_GAP_PX = 4
/** 展开区提示色条宽度 */
const EXPAND_BAR_WIDTH = 3
/** pill 尺寸与内距 */
const PILL_HEIGHT = 16
const PILL_FONT = '10px -apple-system, BlinkMacSystemFont, sans-serif'
const PILL_PAD_X = 7
/** 选中区域描边加粗档 */
const OUTLINE_WIDTH = 1
const OUTLINE_WIDTH_ACTIVE = 2
/** 选中区域淡色填充透明度 */
const ACTIVE_FILL_ALPHA = 0.06

/** painter 绘制上下文最小子集（RenderContext 结构兼容；只取用到的成员） */
export interface RegionPaintContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  globalAlpha?: number
  save(): void
  restore(): void
  beginPath(): void
  rect(x: number, y: number, width: number, height: number): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void
  closePath(): void
  fill(): void
  stroke(): void
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  measureText(text: string): { width: number }
}

export interface CanvasOverlayDeps {
  getGrid: () => SheetGrid | undefined
  getPaperGuides: () => PaperGuidesConfig | null
  getRegions: () => readonly FormRegion[]
  /** 当前选中格（用于判定「现在说的是哪个区域」，命中即加粗描边） */
  getActiveCell: () => { row: number; col: number } | undefined
}

/** 圆角矩形路径（RenderContext 无 roundRect，用 arc 拼四角） */
function roundRectPath(
  ctx: RegionPaintContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, height / 2, width / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.arc(x + width - r, y + r, r, -Math.PI / 2, 0)
  ctx.lineTo(x + width, y + height - r)
  ctx.arc(x + width - r, y + height - r, r, 0, Math.PI / 2)
  ctx.lineTo(x + r, y + height)
  ctx.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI)
  ctx.lineTo(x, y + r)
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  ctx.closePath()
}

/** 矩形区域的包围盒（四角格的相对矩形取并集；任一角不可见则返回 null） */
function regionBounds(
  table: ReturnType<SheetGrid['getTable']>,
  region: FormRegion,
): { x: number; y: number; width: number; height: number } | null {
  const topLeft = table.getCellRelativeRect(region.startCol, region.startRow)
  const bottomRight = table.getCellRelativeRect(region.endCol, region.endRow)
  if (!topLeft || !bottomRight) return null
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x + bottomRight.width - topLeft.x,
    height: bottomRight.y + bottomRight.height - topLeft.y,
  }
}

/**
 * 展开方向提示：
 * - `down`：左缘画 3px 色条 + 底边虚线（「这里会往下重复」）
 * - `right`：顶缘画 3px 色条 + 右缘虚线（「这里会向右平铺」）
 */
function drawExpandHints(
  ctx: RegionPaintContext,
  bounds: { x: number; y: number; width: number; height: number },
  expand: RegionExpand,
  color: string,
): void {
  if (expand === 'none') return
  ctx.save()
  ctx.fillStyle = color
  if (expand === 'down') {
    ctx.fillRect(bounds.x, bounds.y, EXPAND_BAR_WIDTH, bounds.height)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = bounds.x; x < bounds.x + bounds.width; x += DASH_PX + DASH_GAP_PX) {
      ctx.moveTo(x, Math.round(bounds.y + bounds.height) - 0.5)
      ctx.lineTo(
        Math.min(x + DASH_PX, bounds.x + bounds.width),
        Math.round(bounds.y + bounds.height) - 0.5,
      )
    }
  } else {
    ctx.fillRect(bounds.x, bounds.y, bounds.width, EXPAND_BAR_WIDTH)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let y = bounds.y; y < bounds.y + bounds.height; y += DASH_PX + DASH_GAP_PX) {
      ctx.moveTo(Math.round(bounds.x + bounds.width) - 0.5, y)
      ctx.lineTo(
        Math.round(bounds.x + bounds.width) - 0.5,
        Math.min(y + DASH_PX, bounds.y + bounds.height),
      )
    }
  }
  ctx.stroke()
  ctx.restore()
}

/** 区域名 pill：画在矩形左上角内侧（最多遮 16px 高，不压正文） */
function drawRegionPill(
  ctx: RegionPaintContext,
  bounds: { x: number; y: number },
  label: string,
  color: string,
): void {
  ctx.save()
  ctx.font = PILL_FONT
  const pillWidth = Math.max(44, ctx.measureText(label).width + PILL_PAD_X * 2)
  const pillX = bounds.x + 3
  const pillY = bounds.y + 2
  ctx.globalAlpha = 0.92
  ctx.fillStyle = color
  roundRectPath(ctx, pillX, pillY, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, pillX + PILL_PAD_X, pillY + PILL_HEIGHT / 2 + 3.5)
  ctx.restore()
}

/** 全部区域：描边 + pill + 展开提示 */
function drawRegions(
  ctx: RegionPaintContext,
  table: ReturnType<SheetGrid['getTable']>,
  regions: readonly FormRegion[],
  activeCell: { row: number; col: number } | undefined,
): void {
  const activeIndex = activeCell
    ? regions.indexOf(regionsAt(regions, activeCell.row, activeCell.col)!)
    : -1

  regions.forEach((region, index) => {
    const bounds = regionBounds(table, region)
    if (!bounds) return
    const color = REGION_EXPAND_COLORS[region.expand]
    const active = index === activeIndex

    // 选中区域：很轻的底色，指示「现在说的是这块」
    if (active) {
      ctx.save()
      ctx.globalAlpha = ACTIVE_FILL_ALPHA
      ctx.fillStyle = color
      ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
      ctx.restore()
    }

    // 矩形描边（选中加粗）
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = active ? OUTLINE_WIDTH_ACTIVE : OUTLINE_WIDTH
    ctx.globalAlpha = active ? 0.95 : 0.55
    ctx.beginPath()
    ctx.rect(
      Math.round(bounds.x) + 0.5,
      Math.round(bounds.y) + 0.5,
      Math.round(bounds.width) - 1,
      Math.round(bounds.height) - 1,
    )
    ctx.stroke()
    ctx.restore()

    drawExpandHints(ctx, bounds, region.expand, color)
    drawRegionPill(ctx, bounds, `区域 ${index + 1}${EXPAND_PILL_SUFFIX[region.expand]}`, color)
  })
}

/**
 * 组合 painter：先画区域（贴近内容，被参考线压住也不影响读数），再画参考线。
 * 参考线沿用既有 painter（内部复用 computePageGuides / drawPageGuides），口径不变。
 */
export function createCanvasOverlayPainter(
  deps: CanvasOverlayDeps,
): (ctx: RegionPaintContext, viewport: Viewport) => void {
  const guidesPainter = createPaperGuidesPainter(deps.getGrid, deps.getPaperGuides)
  return (ctx, viewport) => {
    const grid = deps.getGrid()
    if (!grid) return
    const table = grid.getTable()
    const regions = deps.getRegions()
    if (regions.length > 0) drawRegions(ctx, table, regions, deps.getActiveCell())
    guidesPainter(ctx as never, viewport)
  }
}

/**
 * overlay 接线（form-canvas 调用）：attach 随每次网格创建/重建把 painter 写进新引擎的
 * overlay 槽位；refresh 以同一 painter 原位重写触发 sky 整层失效——行高/列宽/选区
 * 变化后区域描边随重绘对齐（协议 setOverlayPainter 非空写入恒提交失效）。
 */
export interface CanvasOverlay {
  attach(grid: SheetGrid): void
  refresh(): void
  detach(): void
}

export function createCanvasOverlay(deps: CanvasOverlayDeps): CanvasOverlay {
  let grid: SheetGrid | undefined
  const painter = createCanvasOverlayPainter(deps)
  const apply = (): void => {
    grid?.getTable().setOverlayPainter(painter)
  }
  return {
    attach(next) {
      grid = next
      apply()
    },
    refresh() {
      if (grid) grid.getTable().setOverlayPainter(painter)
    },
    detach() {
      if (grid) grid.getTable().setOverlayPainter(null)
      grid = undefined
    },
  }
}
