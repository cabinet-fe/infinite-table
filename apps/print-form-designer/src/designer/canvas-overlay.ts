// 画布 sky 层组合 overlay：区域矩形描边 + 悬停名称 pill + 展开方向提示 + 纸张参考线。
//
// 为什么改成「默认只有边框」：早期版本给每个区域常驻画一枚左上角名称 pill，pill 直接压住
// 区域里的第一行内容，用户看不到自己排的字——遮挡比「不知道这是区域」更难受。所以默认态
// 只留最低成本的区域识别信号（区域色圆角描边 + 左上角折角标记 + 展开方向色条/虚线），
// 区域名改成**悬停才出现**（pill 画到区域外侧上沿，不盖内容）。
//
// 侧栏圆点用同一份颜色表（REGION_EXPAND_COLORS），两处一致才能建立「列表 ↔ 画布」对应直觉。
// 几何全部每帧现算（getCellRelativeRect 返回视口坐标，天然跟随滚动/尺寸变化，不缓存）。
// 悬停态由宿主（form-canvas）经 getHoveredRegionIndex 提供：本文件不持有指针状态。
// 参考线绘制仍复用 paper-guides 的纯函数与既有视觉，不改其口径。

import type { SheetGrid } from '@infinitable/sheet'

import {
  createPaperGuidesPainter,
  dashedLine,
  type DashPattern,
  type PaperGuidesConfig,
} from './paper-guides'
import { regionLabel, regionsAt, type FormRegion, type RegionExpand } from './template'

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

/** 展开方式 → 悬停 pill 后缀文案（不展开不加后缀） */
const EXPAND_PILL_SUFFIX: Record<RegionExpand, string> = {
  none: '',
  down: ' · 向下展开',
  right: ' · 向右展开',
}

/** 展开提示虚线的图案（段 4 / 间隔 4；比分页参考线更密，贴边更轻） */
const EXPAND_DASH: DashPattern = { dash: 4, gap: 4 }
/** 展开区提示色条宽度 */
const EXPAND_BAR_WIDTH = 3
/** 区域描边圆角半径 */
const OUTLINE_RADIUS = 4
/** 左上角折角标记边长（实心小三角，只做「这块是区域」的暗示，不写字） */
const CORNER_MARK_SIZE = 6
/** 悬停 pill 尺寸与内距 */
const PILL_HEIGHT = 16
const PILL_FONT = '10px -apple-system, BlinkMacSystemFont, sans-serif'
const PILL_PAD_X = 7
/** pill 与区域上沿的间距（画在区域外侧，避免遮挡内容） */
const PILL_GAP_Y = 4
/** 区域上沿贴着视口顶部时的回退内距（pill 落到区域内部上沿） */
const PILL_INSET_Y = 2
/** 描边档：常态细描边 / 选中或悬停加粗 */
const OUTLINE_WIDTH = 1
const OUTLINE_WIDTH_ACTIVE = 2
/** 常态描边透明度 / 强调态描边透明度 */
const OUTLINE_ALPHA = 0.55
const OUTLINE_ALPHA_ACTIVE = 0.95
/** 选中区域淡色填充透明度 / 悬停区域更淡的填充 */
const ACTIVE_FILL_ALPHA = 0.06
const HOVER_FILL_ALPHA = 0.03

/** painter 绘制上下文最小子集（RenderContext 的结构化子类型；只取用到的成员） */
interface RegionPaintContext {
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

interface CanvasOverlayDeps {
  getGrid: () => SheetGrid | undefined
  getPaperGuides: () => PaperGuidesConfig | null
  getRegions: () => readonly FormRegion[]
  /** 当前选中格（用于判定「现在说的是哪个区域」，命中即加粗描边） */
  getActiveCell: () => { row: number; col: number } | undefined
  /**
   * 指针当前悬停的区域下标（`undefined` = 没悬停在任何区域）。
   * 宿主在 pointermove 命中区域变化时把它写入闭包并调用 overlay.refresh()。
   */
  getHoveredRegionIndex: () => number | undefined
  /** 内容包围盒（参考线分页域口径）：无限画布的引擎行列含大量空行噪声，只在该域内估算换页线 */
  getContentBounds: () => { rows: number; cols: number }
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
 *
 * 这两样贴边绘制、不进入内容区，是唯一允许的常驻说明。
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
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  if (expand === 'down') {
    ctx.fillRect(bounds.x, bounds.y, EXPAND_BAR_WIDTH, bounds.height)
    // 底边虚线：半像素对齐（0.5）让 1px 线落在设备像素中心
    const y = Math.round(bounds.y + bounds.height) - 0.5
    dashedLine(ctx, bounds.x, y, bounds.x + bounds.width, y, EXPAND_DASH)
  } else {
    ctx.fillRect(bounds.x, bounds.y, bounds.width, EXPAND_BAR_WIDTH)
    const x = Math.round(bounds.x + bounds.width) - 0.5
    dashedLine(ctx, x, bounds.y, x, bounds.y + bounds.height, EXPAND_DASH)
  }
  ctx.stroke()
  ctx.restore()
}

/** 左上角折角标记：6×6 实心三角，颜色同区域色（替代常驻文字标签的「这里是区域」暗示） */
function drawCornerMark(
  ctx: RegionPaintContext,
  bounds: { x: number; y: number },
  color: string,
): void {
  const x = Math.round(bounds.x) + 1
  const y = Math.round(bounds.y) + 1
  ctx.save()
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + CORNER_MARK_SIZE, y)
  ctx.lineTo(x, y + CORNER_MARK_SIZE)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/**
 * 悬停 pill 文案：区域展示名 + 展开方向后缀。
 * 展示名走 template.regionLabel（与侧栏/绑定面板同一份「区域 N」口径），
 * 这里只补 pill 专属的方向后缀。
 */
function hoverPillLabel(region: FormRegion, index: number): string {
  const name = region.name?.trim()
  return `${name || regionLabel(region, index)}${EXPAND_PILL_SUFFIX[region.expand]}`
}

/**
 * 悬停名称 pill：优先画在区域**外侧**上沿（`y = bounds.y - PILL_HEIGHT - 4`），
 * 贴着视口顶部放不下时回落到区域内部上沿（`y = bounds.y + 2`）。
 * 不透明底色 + 白字，保证截图里可读；只在悬停时出现，不遮挡常驻内容。
 */
function drawHoverPill(
  ctx: RegionPaintContext,
  bounds: { x: number; y: number },
  label: string,
  color: string,
): void {
  ctx.save()
  ctx.globalAlpha = 1
  ctx.font = PILL_FONT
  const pillWidth = Math.max(44, ctx.measureText(label).width + PILL_PAD_X * 2)
  const pillX = Math.round(bounds.x)
  const outerY = bounds.y - PILL_HEIGHT - PILL_GAP_Y
  const pillY = outerY < 0 ? bounds.y + PILL_INSET_Y : outerY
  ctx.fillStyle = color
  roundRectPath(ctx, pillX, pillY, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, pillX + PILL_PAD_X, pillY + PILL_HEIGHT / 2 + 3.5)
  ctx.restore()
}

/**
 * 全部区域：默认「圆角描边 + 折角标记 + 展开提示」；
 * 选中加粗并有极淡填充；悬停再加粗、加一层更淡填充并出名称 pill。
 * 同一区域既选中又悬停时只画一次（同一轮循环内合并状态，不做二次描边）。
 */
function drawRegions(
  ctx: RegionPaintContext,
  table: ReturnType<SheetGrid['getTable']>,
  regions: readonly FormRegion[],
  activeCell: { row: number; col: number } | undefined,
  hoveredIndex: number | undefined,
): void {
  const activeRegion = activeCell ? regionsAt(regions, activeCell.row, activeCell.col) : undefined

  regions.forEach((region, index) => {
    const bounds = regionBounds(table, region)
    if (!bounds) return
    const color = REGION_EXPAND_COLORS[region.expand]
    const active = region === activeRegion
    const hovered = index === hoveredIndex
    const emphasized = active || hovered

    // 淡填充：选中（0.06）优先于悬停（0.03），两者都命中时按选中的强度画一次
    const fillAlpha = active ? ACTIVE_FILL_ALPHA : hovered ? HOVER_FILL_ALPHA : 0
    if (fillAlpha > 0) {
      ctx.save()
      ctx.globalAlpha = fillAlpha
      ctx.fillStyle = color
      roundRectPath(ctx, bounds.x, bounds.y, bounds.width, bounds.height, OUTLINE_RADIUS)
      ctx.fill()
      ctx.restore()
    }

    // 圆角矩形描边（选中/悬停加粗提亮）；相邻区域描边允许重叠，不做避让
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = emphasized ? OUTLINE_WIDTH_ACTIVE : OUTLINE_WIDTH
    ctx.globalAlpha = emphasized ? OUTLINE_ALPHA_ACTIVE : OUTLINE_ALPHA
    roundRectPath(
      ctx,
      Math.round(bounds.x) + 0.5,
      Math.round(bounds.y) + 0.5,
      Math.round(bounds.width) - 1,
      Math.round(bounds.height) - 1,
      OUTLINE_RADIUS,
    )
    ctx.stroke()
    ctx.restore()

    drawCornerMark(ctx, bounds, color)
    drawExpandHints(ctx, bounds, region.expand, color)
    if (hovered) drawHoverPill(ctx, bounds, hoverPillLabel(region, index), color)
  })
}

/**
 * 组合 painter：先画区域（贴近内容，被参考线压住也不影响读数），再画参考线。
 * 参考线沿用既有 painter（内部复用 computePageGuides / drawPageGuides），口径不变。
 */
function createCanvasOverlayPainter(
  deps: CanvasOverlayDeps,
): (ctx: RegionPaintContext, viewport: Viewport) => void {
  const guidesPainter = createPaperGuidesPainter(
    deps.getGrid,
    deps.getPaperGuides,
    deps.getContentBounds,
  )
  return (ctx, viewport) => {
    const grid = deps.getGrid()
    if (!grid) return
    const table = grid.getTable()
    const regions = deps.getRegions()
    if (regions.length > 0) {
      const hoveredIndex = deps.getHoveredRegionIndex()
      drawRegions(
        ctx,
        table,
        regions,
        deps.getActiveCell(),
        // 越界/未定义一律视为无悬停（宿主状态与区域序列不同步时不画错标签）
        hoveredIndex !== undefined && regions[hoveredIndex] ? hoveredIndex : undefined,
      )
    }
    guidesPainter(ctx as never, viewport)
  }
}

/**
 * overlay 接线（form-canvas 调用）：attach 随每次网格创建/重建把 painter 写进新引擎的
 * overlay 槽位；refresh 以同一 painter 原位重写触发 sky 整层失效——行高/列宽/选区/
 * 悬停区域变化后区域描边与名称 pill 随重绘对齐（协议 setOverlayPainter 非空写入恒提交失效）。
 */
export interface CanvasOverlay {
  attach(grid: SheetGrid): void
  refresh(): void
  detach(): void
}

export function createCanvasOverlay(deps: CanvasOverlayDeps): CanvasOverlay {
  let grid: SheetGrid | undefined
  const painter = createCanvasOverlayPainter(deps)
  /** 把同一 painter 写回槽位：协议 setOverlayPainter 非空写入恒提交失效，即「原位重绘」 */
  const apply = (): void => {
    grid?.getTable().setOverlayPainter(painter)
  }
  return {
    attach(next) {
      grid = next
      apply()
    },
    refresh: apply,
    detach() {
      grid?.getTable().setOverlayPainter(null)
      grid = undefined
    },
  }
}
