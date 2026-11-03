// 画布 sky 层组合 overlay：区域轨道（区名/色条/边界）+ 纸张参考线，两段画在同一 painter 里。
//
// 为什么要有它：用户看不懂「区域」的核心原因是界面上没有任何东西把侧栏列表和画布行对应起来。
// 这里按区域类型给每种区域一个固定颜色，在行号列右缘画同色竖条、首行可见时画区名 pill、
// 区域交界处画浅虚线——侧栏圆点用同一份颜色表，两处颜色一致才能建立「这块就是明细区」的直觉。
//
// 几何全部每帧现算（getCellRelativeRect 返回视口坐标，天然跟随滚动/尺寸变化，不缓存）。
// 参考线绘制仍复用 paper-guides 的纯函数与既有视觉，不改其口径。

import type { SheetGrid } from '@infinitable/sheet'

import { createPaperGuidesPainter, type PaperGuidesConfig } from './paper-guides'
import { BAND_KIND_LABELS, type BandKind, type FormBand } from './template'

/** 视口尺寸（与 overlay painter 协议同形） */
interface Viewport {
  width: number
  height: number
}

/** 区域类型 → 强调色（侧栏圆点与画布竖条/pill 共用同一份，保证两处同色） */
export const BAND_KIND_COLORS: Record<BandKind, string> = {
  pageHeader: '#2f62f0',
  info: '#12b76a',
  detail: '#f79009',
  summary: '#7a5af8',
  signature: '#667085',
}

/** 区域交界虚线色 */
const REGION_BOUNDARY_COLOR = '#cbd2dc'
/** 边界虚线：段长 / 间隔（px；RenderContext 无 setLineDash，手动分段） */
const BOUNDARY_DASH = 4
const BOUNDARY_GAP = 4
/** 区域竖条宽度（常规 / 当前选中区域加宽档） */
const TRACK_WIDTH = 4
const TRACK_WIDTH_ACTIVE = 6
/** 当前选中区域的整行淡色条纹透明度（用 globalAlpha 控制，避免算 rgba） */
const ACTIVE_STRIPE_ALPHA = 0.08
/** pill 尺寸与内距 */
const PILL_HEIGHT = 16
const PILL_FONT = '10px -apple-system, BlinkMacSystemFont, sans-serif'
const PILL_PAD_X = 7

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
  getBands: () => readonly FormBand[]
  /** 当前选中区域的起始行（命中即高亮该区域；undefined = 无） */
  getActiveBandStartRow: () => number | undefined
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

/** 水平虚线：沿 y 从 x1 到 x2 手动分段 */
function dashedHLine(ctx: RegionPaintContext, x1: number, y: number, x2: number): void {
  ctx.beginPath()
  for (let x = x1; x < x2; x += BOUNDARY_DASH + BOUNDARY_GAP) {
    ctx.moveTo(x, y)
    ctx.lineTo(Math.min(x + BOUNDARY_DASH, x2), y)
  }
}

interface RowRect {
  y: number
  height: number
}

/** 区域内所有可见行的矩形（视口外行返回 null，直接跳过）+ 第 0 列左缘 x */
function visibleRowRects(
  table: ReturnType<SheetGrid['getTable']>,
  band: FormBand,
): { rows: RowRect[]; columnLeft: number } {
  const rows: RowRect[] = []
  let columnLeft = Number.NaN
  for (let row = band.startRow; row <= band.endRow; row++) {
    const rect = table.getCellRelativeRect(0, row)
    if (!rect) continue
    rows.push({ y: rect.y, height: rect.height })
    if (Number.isNaN(columnLeft)) columnLeft = rect.x
  }
  return { rows, columnLeft }
}

/** 区域轨道：竖条 + 首行 pill + 选中区整行条纹 */
function drawRegionTracks(
  ctx: RegionPaintContext,
  table: ReturnType<SheetGrid['getTable']>,
  bands: readonly FormBand[],
  activeStartRow: number | undefined,
): void {
  const bodyLeft = table.getCellRelativeRect(0, 0)?.x ?? Number.NaN
  const bodyWidth = table.getCellRelativeRect(0, 0)?.width ?? 0

  for (const band of bands) {
    const { rows, columnLeft } = visibleRowRects(table, band)
    if (rows.length === 0 || Number.isNaN(columnLeft)) continue
    const color = BAND_KIND_COLORS[band.kind]
    const active = band.startRow === activeStartRow
    const trackWidth = active ? TRACK_WIDTH_ACTIVE : TRACK_WIDTH
    const top = rows[0]!.y
    const bottom = rows[rows.length - 1]!.y + rows[rows.length - 1]!.height

    // 选中区域：整行淡色条纹（很轻，只用来指示「现在说的是这块」）
    if (active && bodyWidth > 0) {
      ctx.save()
      ctx.globalAlpha = ACTIVE_STRIPE_ALPHA
      ctx.fillStyle = color
      ctx.fillRect(columnLeft, top, bodyWidth - (columnLeft - bodyLeft), bottom - top)
      ctx.restore()
    }

    // 行号列右缘的色条（宽度随选中态变化）
    ctx.fillStyle = color
    ctx.fillRect(columnLeft - trackWidth, top, trackWidth, bottom - top)

    // 区名 pill：只在该区域首行可见时画一次（区域滚走后不再出现，避免误读「这里就是开头」）。
    // 位置紧贴色条右侧、与首行顶部对齐——像报表设计器里的区域标签页，压住的内容最少。
    const firstVisible = rows[0]!
    const label = BAND_KIND_LABELS[band.kind]
    ctx.save()
    ctx.font = PILL_FONT
    const pillWidth = Math.max(44, ctx.measureText(label).width + PILL_PAD_X * 2)
    const pillX = columnLeft + 3
    const pillY = firstVisible.y + 2
    ctx.globalAlpha = 0.92
    ctx.fillStyle = color
    roundRectPath(ctx, pillX, pillY, pillWidth, PILL_HEIGHT, PILL_HEIGHT / 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, pillX + PILL_PAD_X, pillY + PILL_HEIGHT / 2 + 3.5)
    ctx.restore()
  }
}

/** 区域交界虚线（横贯 body 宽度；第一条区域顶部不画，避免与列头重叠） */
function drawRegionBoundaries(
  ctx: RegionPaintContext,
  table: ReturnType<SheetGrid['getTable']>,
  bands: readonly FormBand[],
  viewport: Viewport,
): void {
  const firstBodyCell = table.getCellRelativeRect(0, 0)
  if (!firstBodyCell) return
  const x1 = firstBodyCell.x
  const x2 = viewport.width
  ctx.save()
  ctx.strokeStyle = REGION_BOUNDARY_COLOR
  ctx.lineWidth = 1
  for (let i = 1; i < bands.length; i++) {
    const band = bands[i]!
    const rect = table.getCellRelativeRect(0, band.startRow)
    if (!rect) continue
    // 落在半像素上让 1px 线清晰
    dashedHLine(ctx, x1, Math.round(rect.y) - 0.5, x2)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * 组合 painter：先画区域轨道（贴近内容，被参考线压住也不影响读数），再画参考线。
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
    const bands = deps.getBands()
    if (bands.length > 0) {
      drawRegionBoundaries(ctx, table, bands, viewport)
      drawRegionTracks(ctx, table, bands, deps.getActiveBandStartRow())
    }
    guidesPainter(ctx as never, viewport)
  }
}

/**
 * overlay 接线（form-canvas 调用）：attach 随每次网格创建/重建把 painter 写进新引擎的
 * overlay 槽位；refresh 以同一 painter 原位重写触发 sky 整层失效——行高/列宽/选区内
 * 容就地变化后区域轨道随重绘对齐（协议 setOverlayPainter 非空写入恒提交失效）。
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
