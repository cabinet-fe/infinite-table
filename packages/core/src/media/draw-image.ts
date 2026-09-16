// media 内容共享的绘制助手：确定性占位与 fit 语义位图绘制（图片格与浮动对象共用）

import type { RenderContext } from '@infinite-table/render';

import type { LoadedImage } from './image-service';

const PLACEHOLDER_FILL = '#f0f1f2';

/** 无闪协议的确定性占位：纯灰底，不随加载进度变化 */
export function paintImagePlaceholder(ctx: RenderContext, width: number, height: number): void {
  ctx.fillStyle = PLACEHOLDER_FILL;
  ctx.fillRect(0, 0, width, height);
}

export type ImageFit = 'fill' | 'contain';

/** 按 fit 语义把位图画进目标框（fill 铺满可能变形，contain 等比居中） */
export function drawFittedImage(
  ctx: RenderContext,
  image: LoadedImage,
  width: number,
  height: number,
  fit: ImageFit,
): void {
  if (fit === 'fill' || image.width <= 0 || image.height <= 0) {
    ctx.drawImage(image.source, 0, 0, width, height);
    return;
  }
  const scale = Math.min(width / image.width, height / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image.source, (width - dw) / 2, (height - dh) / 2, dw, dh);
}
