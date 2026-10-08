// 文字平铺水印的几何与绘制（univer watermark util 移植）：双层 for 平铺，
// 步长 = 内容尺寸 + gap，逐单元 translate（单元中心）+ rotate + fillText。
// 整层透明度经「颜色 × opacity 预混 rgba」实现——core 转出的 RenderContext
// 窄接口无 globalAlpha，预混等效且零引擎改动；rotate 为可选成员，缺失的最小桩
// 上下文按未旋转绘制（与浮动对象旋转渲染同容错约定）。
// 配置消费 P1 打印水印共享的 WatermarkTextConfig：屏幕端（顶层 overlay）与打印端
// 同一配置模型；本模块纯函数部分（平铺原点/颜色预混）可脱离 canvas 单测。

import type { RenderContext } from '@infinitable/core'

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

/** 水印文本基线相对单元中线的近似偏移系数（alphabetic 基线下视觉居中，约 0.3em） */
const BASELINE_CENTER_RATIO = 0.3

/** 缺省字体族（与 core 主题字体无耦合，水印自带独立观感） */
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

/**
 * 文字平铺水印绘制入口：测量前先设 font——真实 2D 上下文按「当前 font」计量文本宽
 * （core cell-node.ts measureTextWidth 同款先例），否则步长按画布缺省 10px 字宽计算
 * 而绘制按配置字号，大字号时平铺重叠。整层统一 font 与预混 alpha 的 fillStyle，
 * 文本宽经 ctx.measureText 测量一次，随后按平铺原点逐单元 translate（单元中心）→
 * rotate → fillText（绕中心旋转，负角度逆时针）。步长 = 测量宽 + gapX / 字号 + gapY。
 */
export function drawTextWatermark(
  ctx: RenderContext,
  config: WatermarkTextConfig,
  viewport: { width: number; height: number },
): void {
  const style = resolveWatermarkStyle(config)
  ctx.font = watermarkFont(style.fontSize)
  const textWidth = ctx.measureText(config.text).width
  const tileSize = { width: textWidth, height: style.fontSize }
  const origins = watermarkTileOrigins(viewport, tileSize, style.gapX, style.gapY)
  if (origins.length === 0) {
    return
  }
  const rad = (style.rotate * Math.PI) / 180
  ctx.save()
  ctx.fillStyle = watermarkFillColor(style.color, style.opacity)
  for (const origin of origins) {
    ctx.save()
    ctx.translate(origin.x + tileSize.width / 2, origin.y + tileSize.height / 2)
    if (ctx.rotate) {
      ctx.rotate(rad)
    }
    ctx.fillText(config.text, -tileSize.width / 2, tileSize.height * BASELINE_CENTER_RATIO)
    ctx.restore()
  }
  ctx.restore()
}
