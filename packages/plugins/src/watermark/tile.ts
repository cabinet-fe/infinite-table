// 文字平铺水印的几何与绘制（univer watermark util 移植）：
// - 快路径（ctx.createPattern + 离屏瓦片画布可用时）：将单周期瓦片预渲染到离屏 canvas，
//   按参数（text/font/color/angle/gapX/gapY/offsetX/offsetY）与 DPR 缓存并按需失效，
//   视口重绘只需一次 createPattern + fillRect。
// - 降级路径（无 createPattern 或无离屏 2D 上下文，如测试桩 / 无头环境）：回落
//   watermarkTileOrigins 双层循环逐单元 translate + rotate + fillText。
// 整层透明度经「颜色 × opacity 预混 rgba」实现；rotate 为可选成员，缺失的最小桩
// 上下文按未旋转绘制。

import type { CanvasFactory, RenderCanvas, RenderContext } from '@infinitable/render'

import { WATERMARK_TEXT_DEFAULTS, type WatermarkTextConfig } from '../print/types'

/** 水印样式解析结果：缺省值已并入的完整样式快照（几何与绘制共用同一份） */
interface ResolvedWatermarkStyle {
  fontSize: number
  color: string
  opacity: number
  rotate: number
  gapX: number
  gapY: number
}

/** 离屏瓦片缓存条目：任一渲染参数或 DPR 变更时整体失效重建 */
interface CachedWatermarkTile {
  text: string
  font: string
  fillColor: string
  angle: number
  gapX: number
  gapY: number
  offsetX: number
  offsetY: number
  dpr: number
  stepX: number
  stepY: number
  tileWidthPx: number
  tileHeightPx: number
  canvas: RenderCanvas
  patternCtx?: RenderContext
  pattern?: CanvasPattern | null
}

/** 绘制附加选项（可选离屏缓存、画布工厂、DPR 与平铺原点偏移） */
export interface WatermarkDrawOptions {
  /** 跨帧复用离屏瓦片与 CanvasPattern 的缓存实例 */
  cache?: WatermarkTileCache
  /** 自定义离屏画布工厂（缺省使用 document.createElement('canvas')） */
  canvasFactory?: CanvasFactory
  /** 显式覆盖 DPR（缺省从 ctx.getTransform().a 或 window.devicePixelRatio 读取） */
  dpr?: number
  /** 平铺原点横向偏移（CSS 像素，缺省 0） */
  offsetX?: number
  /** 平铺原点纵向偏移（CSS 像素，缺省 0） */
  offsetY?: number
}

/** 水印文本基线相对单元中线的近似偏移系数（alphabetic 基线下视觉居中，约 0.3em） */
const BASELINE_CENTER_RATIO = 0.3

/** 缺省字体族（与 table 主题字体无耦合，水印自带独立观感） */
const WATERMARK_FONT_FAMILY = 'sans-serif'

/** 解析水印样式：未给字段回落 WATERMARK_TEXT_DEFAULTS（与 meta 端缺省同口径） */
export function resolveWatermarkStyle(config: WatermarkTextConfig): ResolvedWatermarkStyle {
  return {
    fontSize: config.fontSize ?? WATERMARK_TEXT_DEFAULTS.fontSize,
    color: config.color ?? WATERMARK_TEXT_DEFAULTS.color,
    opacity: config.opacity ?? WATERMARK_TEXT_DEFAULTS.opacity,
    rotate: config.rotate ?? WATERMARK_TEXT_DEFAULTS.rotate,
    gapX: config.gapX ?? WATERMARK_TEXT_DEFAULTS.gapX,
    gapY: config.gapY ?? WATERMARK_TEXT_DEFAULTS.gapY,
  }
}

/** #rgb / #rrggbb → [r, g, b]；其余格式（rgb()/命名色等）返回 null */
function hexToRgb(color: string): [number, number, number] | null {
  const hex = color.trim()
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
      parseInt(hex[3]! + hex[3]!, 16),
    ]
  }
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]
  }
  return null
}

/**
 * 水印填充色（globalAlpha 的预混等效）：hex 色与 opacity 合成 rgba()；
 * 非 hex 输入原样返回（alpha 由颜色自带，opacity 不再叠加）。
 */
export function watermarkFillColor(color: string, opacity: number): string {
  const rgb = hexToRgb(color)
  return rgb === null ? color : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`
}

/** 平铺水印单元原点（层坐标，单元左上角；视口外或 step 退化时为空） */
interface WatermarkTileOrigin {
  x: number
  y: number
}

/**
 * 平铺原点计算（纯函数，univer 同式）：步长 = 内容尺寸 + gap，两轴各自从 0 起
 * 逐格推进直到越出视口（最后一个部分可见单元计入）；任一轴步长 ≤ 0（如空文本
 * 零间距）返回空数组不绘制。
 */
export function watermarkTileOrigins(
  viewport: { width: number; height: number },
  tileSize: { width: number; height: number },
  gapX: number,
  gapY: number,
): WatermarkTileOrigin[] {
  const stepX = tileSize.width + gapX
  const stepY = tileSize.height + gapY
  const origins: WatermarkTileOrigin[] = []
  if (stepX <= 0 || stepY <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return origins
  }
  for (let y = 0; y < viewport.height; y += stepY) {
    for (let x = 0; x < viewport.width; x += stepX) {
      origins.push({ x, y })
    }
  }
  return origins
}

/** 水印绘制字体串（ctx.font 口径） */
export function watermarkFont(fontSize: number): string {
  return `${fontSize}px ${WATERMARK_FONT_FAMILY}`
}

function defaultCanvasFactory(): RenderCanvas | null {
  if (typeof document === 'undefined') {
    return null
  }
  return document.createElement('canvas')
}

function resolveContextDpr(ctx: RenderContext): number {
  const transform = (ctx as { getTransform?: () => { a: number } }).getTransform?.()
  if (transform && Number.isFinite(transform.a) && transform.a > 0) {
    return transform.a
  }
  if (
    typeof window !== 'undefined' &&
    Number.isFinite(window.devicePixelRatio) &&
    window.devicePixelRatio > 0
  ) {
    return window.devicePixelRatio
  }
  return 1
}

/**
 * 水印离屏瓦片缓存：将单个无缝平铺周期渲染到离屏 canvas，
 * 仅当水印选项（text/font/color/angle/gapX/gapY/offsetX/offsetY）或 DPR 变化时重建。
 */
export class WatermarkTileCache {
  private entry: CachedWatermarkTile | null = null

  constructor(private readonly canvasFactory?: CanvasFactory) {}

  clear(): void {
    this.entry = null
  }

  /** 获取或重建缓存的 CanvasPattern；不可用（无 createPattern / 无离屏 2D 上下文）时返回 null */
  getPattern(
    ctx: RenderContext,
    text: string,
    style: ResolvedWatermarkStyle,
    font: string,
    tileSize: { width: number; height: number },
    dpr: number,
    offsetX: number,
    offsetY: number,
  ): CanvasPattern | null {
    if (typeof ctx.createPattern !== 'function') {
      return null
    }
    const stepX = tileSize.width + style.gapX
    const stepY = tileSize.height + style.gapY
    if (stepX <= 0 || stepY <= 0) {
      return null
    }
    // 非 1 DPR 需要 DOMMatrix 支持 pattern.setTransform 缩回 CSS 像素尺寸；无 DOMMatrix 时按 1x 构建
    const effectiveDpr = dpr !== 1 && typeof DOMMatrix !== 'undefined' ? dpr : 1
    const fillColor = watermarkFillColor(style.color, style.opacity)

    let cached = this.entry
    const hit =
      cached !== null &&
      cached.text === text &&
      cached.font === font &&
      cached.fillColor === fillColor &&
      cached.angle === style.rotate &&
      cached.gapX === style.gapX &&
      cached.gapY === style.gapY &&
      cached.offsetX === offsetX &&
      cached.offsetY === offsetY &&
      cached.dpr === effectiveDpr &&
      cached.stepX === stepX &&
      cached.stepY === stepY

    if (!hit || cached === null) {
      const canvas = this.canvasFactory ? this.canvasFactory() : defaultCanvasFactory()
      if (!canvas) {
        return null
      }
      const tileWidthPx = Math.max(1, Math.round(stepX * effectiveDpr))
      const tileHeightPx = Math.max(1, Math.round(stepY * effectiveDpr))
      canvas.width = tileWidthPx
      canvas.height = tileHeightPx
      const tileCtx = canvas.getContext('2d')
      if (!tileCtx) {
        return null
      }

      const scaleX = tileWidthPx / stepX
      const scaleY = tileHeightPx / stepY
      tileCtx.save()
      tileCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0)
      tileCtx.clearRect(0, 0, stepX, stepY)
      tileCtx.font = font
      tileCtx.fillStyle = fillColor
      const cx = tileSize.width / 2
      const cy = tileSize.height / 2
      const rad = (style.rotate * Math.PI) / 180
      // 3×3 周期包裹：旋转后超出单瓦片边界的笔画在相邻瓦片边缘无缝补齐，不截断
      for (const dy of [-stepY, 0, stepY]) {
        for (const dx of [-stepX, 0, stepX]) {
          tileCtx.save()
          tileCtx.translate(cx + dx, cy + dy)
          if (tileCtx.rotate) {
            tileCtx.rotate(rad)
          }
          tileCtx.fillText(text, -tileSize.width / 2, tileSize.height * BASELINE_CENTER_RATIO)
          tileCtx.restore()
        }
      }
      tileCtx.restore()

      cached = {
        text,
        font,
        fillColor,
        angle: style.rotate,
        gapX: style.gapX,
        gapY: style.gapY,
        offsetX,
        offsetY,
        dpr: effectiveDpr,
        stepX,
        stepY,
        tileWidthPx,
        tileHeightPx,
        canvas,
      }
      this.entry = cached
    }

    if (cached.patternCtx === ctx && cached.pattern !== undefined) {
      return cached.pattern
    }

    const pattern = ctx.createPattern(cached.canvas, 'repeat')
    if (pattern && (cached.tileWidthPx !== stepX || cached.tileHeightPx !== stepY)) {
      const setTransform = (pattern as { setTransform?: (matrix?: DOMMatrix2DInit) => void })
        .setTransform
      if (typeof setTransform !== 'function' || typeof DOMMatrix === 'undefined') {
        return null
      }
      setTransform.call(
        pattern,
        new DOMMatrix().scale(stepX / cached.tileWidthPx, stepY / cached.tileHeightPx),
      )
    }
    cached.patternCtx = ctx
    cached.pattern = pattern
    return pattern
  }
}

/**
 * 文字平铺水印绘制入口：测量前先设 font（真实 2D 上下文按当前 font 计量文本宽）。
 * 优先走离屏 CanvasPattern 缓存快路径（单次 fillRect 铺满视口）；若运行环境无
 * createPattern 或无法创建离屏 2D 上下文，平滑降级为 watermarkTileOrigins 逐格绘制。
 */
export function drawTextWatermark(
  ctx: RenderContext,
  config: WatermarkTextConfig,
  viewport: { width: number; height: number },
  options?: WatermarkDrawOptions,
): void {
  const style = resolveWatermarkStyle(config)
  const font = watermarkFont(style.fontSize)
  ctx.font = font
  const textWidth = ctx.measureText(config.text).width
  const tileSize = { width: textWidth, height: style.fontSize }
  const stepX = tileSize.width + style.gapX
  const stepY = tileSize.height + style.gapY
  if (stepX <= 0 || stepY <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return
  }

  const offsetX = options?.offsetX ?? 0
  const offsetY = options?.offsetY ?? 0

  if (typeof ctx.createPattern === 'function') {
    const cache = options?.cache ?? new WatermarkTileCache(options?.canvasFactory)
    const dpr = options?.dpr ?? resolveContextDpr(ctx)
    const pattern = cache.getPattern(ctx, config.text, style, font, tileSize, dpr, offsetX, offsetY)
    if (pattern) {
      ctx.save()
      ctx.fillStyle = pattern
      if (offsetX !== 0 || offsetY !== 0) {
        ctx.translate(offsetX, offsetY)
        ctx.fillRect(-offsetX, -offsetY, viewport.width, viewport.height)
      } else {
        ctx.fillRect(0, 0, viewport.width, viewport.height)
      }
      ctx.restore()
      return
    }
  }

  const origins = watermarkTileOrigins(viewport, tileSize, style.gapX, style.gapY)
  if (origins.length === 0) {
    return
  }
  const rad = (style.rotate * Math.PI) / 180
  ctx.save()
  ctx.fillStyle = watermarkFillColor(style.color, style.opacity)
  for (const origin of origins) {
    ctx.save()
    ctx.translate(origin.x + offsetX + tileSize.width / 2, origin.y + offsetY + tileSize.height / 2)
    if (ctx.rotate) {
      ctx.rotate(rad)
    }
    ctx.fillText(config.text, -tileSize.width / 2, tileSize.height * BASELINE_CENTER_RATIO)
    ctx.restore()
  }
  ctx.restore()
}
