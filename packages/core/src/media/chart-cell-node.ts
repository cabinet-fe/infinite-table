// 格内图表格场景节点（L2 media 层，chart 预留位落地）：
// 位图由 chart 插件在离屏 canvas 同步出图（core 不含图表语义），本节点只做位图 blit。
// 无闪协议同图片格：cell 级缓存命中即首帧直贴真实位图；未命中在 placeholderDelay 之前
// 连占位都不画，出图完成由 ListTable 定向失效本格、单帧切换。

import {
  SceneNode,
  type Region,
  type RenderContext,
  type SceneNodeInit,
} from '@infinite-table/render'

import {
  MEDIA_CELL_BACKGROUND,
  bodyViewportClip,
  drawFittedImage,
  paintImagePlaceholder,
} from './draw-image'
import type { LoadedImage } from './image-service'

export interface ChartCellNodeInit extends SceneNodeInit {
  col: number
  row: number
  /**
   * cell 级缓存 key（声明内容 key + 格尺寸 + DPR）：
   * 内容/几何变更的比对依据（refreshChartCell 换 key 即重建节点）。
   */
  cacheKey: string
  /** 该时刻之后占位才允许上屏（请求时刻 + placeholderDelay） */
  placeholderAfter: number
  /**
   * body 视口（层坐标，扣除表头/行号列）：绘制裁剪边界。
   * 缺省不裁剪；提供时边缘半格图表格只画视口内部分，不越界盖住表头/行号列。
   */
  bodyViewport?: Region
  /** 时钟注入（默认 Date.now，测试可控） */
  now?: () => number
}

export class ChartCellNode extends SceneNode {
  readonly col: number
  readonly row: number
  cacheKey: string
  placeholderAfter: number
  private image: LoadedImage | null = null
  private readonly bodyViewport: Region | null
  private readonly now: () => number

  constructor(init: ChartCellNodeInit) {
    super(init)
    this.col = init.col
    this.row = init.row
    this.cacheKey = init.cacheKey
    this.placeholderAfter = init.placeholderAfter
    this.bodyViewport = init.bodyViewport ?? null
    this.now = init.now ?? Date.now
  }

  /** 位图是否已就绪（无闪协议：滚动重建命中缓存即首帧直贴，无占位帧） */
  get hasBitmap(): boolean {
    return this.image !== null
  }

  /** 位图就绪：由 ListTable 在出图完成后设置并定向失效本格 */
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
      // 出图位图物理尺寸 = 格 CSS 尺寸 × DPR，1:1 blit 回 CSS 尺寸即原生清晰度
      drawFittedImage(ctx, this.image, this.width, this.height, 'fill')
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
