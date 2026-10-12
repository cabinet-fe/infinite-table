// media 内容共享的绘制助手：确定性占位、fit 语义位图绘制、body 视口裁剪
// （图片格、图表格与浮动对象共用）

import type { Region, RenderContext } from '@infinitable/render'

import type { LoadedImage } from './image-service'

/** media 内容白底：垫在位图之下保证透明位图可读（图片格只垫位图实际区域，图表格整格垫底） */
export const MEDIA_CELL_BACKGROUND = '#ffffff'

const PLACEHOLDER_FILL = '#f0f1f2'

/** 无闪协议的确定性占位：纯灰底，不随加载进度变化 */
export function paintImagePlaceholder(ctx: RenderContext, width: number, height: number): void {
  ctx.fillStyle = PLACEHOLDER_FILL
  ctx.fillRect(0, 0, width, height)
}

export type ImageFit = 'fill' | 'contain'

/**
 * fit 语义下位图的目标矩形（目标框局部坐标）：fill 铺满目标框（可能变形），
 * contain 等比居中。零尺寸位图回落整框（与 drawFittedImage 的 fill 回落一致）。
 */
export function fittedRect(
  image: { width: number; height: number },
  width: number,
  height: number,
  fit: ImageFit,
): Region {
  if (fit === 'fill' || image.width <= 0 || image.height <= 0) {
    return { x: 0, y: 0, width, height }
  }
  const scale = Math.min(width / image.width, height / image.height)
  const dw = image.width * scale
  const dh = image.height * scale
  return { x: (width - dw) / 2, y: (height - dh) / 2, width: dw, height: dh }
}

/** 按 fit 语义把位图画进目标框（fill 铺满可能变形，contain 等比居中） */
export function drawFittedImage(
  ctx: RenderContext,
  image: LoadedImage,
  width: number,
  height: number,
  fit: ImageFit,
): void {
  const rect = fittedRect(image, width, height, fit)
  ctx.drawImage(image.source, rect.x, rect.y, rect.width, rect.height)
}

/**
 * 绘制区与 body 视口的交集（换算到 bounds 的局部坐标）。
 * 完全落在视口内、无视口或不相交时返回 null（无需/无法裁剪）。
 */
export function bodyViewportClip(bounds: Region, bodyViewport: Region | null): Region | null {
  if (!bodyViewport) {
    return null
  }
  const left = Math.max(bounds.x, bodyViewport.x)
  const top = Math.max(bounds.y, bodyViewport.y)
  const right = Math.min(bounds.x + bounds.width, bodyViewport.x + bodyViewport.width)
  const bottom = Math.min(bounds.y + bounds.height, bodyViewport.y + bodyViewport.height)
  if (right <= left || bottom <= top) {
    return null
  }
  if (
    left <= bounds.x &&
    top <= bounds.y &&
    right >= bounds.x + bounds.width &&
    bottom >= bounds.y + bounds.height
  ) {
    return null
  }
  return { x: left - bounds.x, y: top - bounds.y, width: right - left, height: bottom - top }
}
