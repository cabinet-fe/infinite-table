// 格内图片场景节点（L2 media 层）：
// 无闪协议——位图就绪前只在 placeholderDelay 之后画确定性占位（快速滚过不闪占位），
// 位图就绪后由 ListTable 定向失效本格，单帧切换，无"先按错误尺寸渲一帧再调整"。

import { SceneNode, type Region, type RenderContext, type SceneNodeInit } from '@infinitable/render'

import {
  MEDIA_CELL_BACKGROUND,
  bodyViewportClip,
  drawFittedImage,
  paintImagePlaceholder,
  type ImageFit,
} from './draw-image'
import type { LoadedImage } from './image-service'

export interface ImageCellNodeInit extends SceneNodeInit {
  col: number
  row: number
  url: string
  fit?: ImageFit
  /** 该时刻之后占位才允许上屏（请求时刻 + placeholderDelay） */
  placeholderAfter: number
  /**
   * body 视口（层坐标，扣除表头/行号列）：绘制裁剪边界。
   * 缺省不裁剪；提供时边缘半格图片只画视口内部分，不越界盖住表头/行号列。
   */
  bodyViewport?: Region
  /** 时钟注入（默认 Date.now，测试可控） */
  now?: () => number
}

export class ImageCellNode extends SceneNode {
  readonly col: number
  readonly row: number
  readonly url: string
  fit: ImageFit
  placeholderAfter: number
  private image: LoadedImage | null = null
  private readonly bodyViewport: Region | null
  private readonly now: () => number

  constructor(init: ImageCellNodeInit) {
    super(init)
    this.col = init.col
    this.row = init.row
    this.url = init.url
    this.fit = init.fit ?? 'contain'
    this.placeholderAfter = init.placeholderAfter
    this.bodyViewport = init.bodyViewport ?? null
    this.now = init.now ?? Date.now
  }

  /** 位图是否已就绪（无闪协议：就绪帧直接画位图，未就绪才走占位延迟） */
  get hasBitmap(): boolean {
    return this.image !== null
  }

  /** 位图就绪：由 ListTable 在 ImageService 加载完成后设置并定向失效本格 */
  setBitmap(image: LoadedImage): void {
    this.image = image
  }

  override paint(ctx: RenderContext): void {
    // 无位图且占位未到期：本帧什么都不画
    if (!this.image && this.now() < this.placeholderAfter) {
      return
    }
    const clip = this.viewportClip()
    if (clip) {
      ctx.save()
      ctx.rect(clip.x, clip.y, clip.width, clip.height)
      ctx.clip()
    }
    if (this.image) {
      ctx.fillStyle = MEDIA_CELL_BACKGROUND
      ctx.fillRect(0, 0, this.width, this.height)
      drawFittedImage(ctx, this.image, this.width, this.height, this.fit)
    } else {
      paintImagePlaceholder(ctx, this.width, this.height)
    }
    if (clip) {
      ctx.restore()
    }
  }

  private viewportClip(): Region | null {
    return bodyViewportClip(this.getGlobalBounds(), this.bodyViewport)
  }
}
