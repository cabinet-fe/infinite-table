// 格内图片场景节点（L2 media 层）：
// 无闪协议——位图就绪前只在 placeholderDelay 之后画确定性占位（快速滚过不闪占位），
// 位图就绪后由 ListTable 定向失效本格，单帧切换，无"先按错误尺寸渲一帧再调整"。
// 不可拾取：格内图片是数据格的装饰层（事件系统跨层命中 sky→media→body 自顶向下
// 取第一个可拾取节点，再沿其父链冒泡派发），可拾取会把指针事件截在 media 根链，
// body 根上接线的表交互（选区/浮动对象/悬停光标）全部收不到——交互实体是 body 层
// 数据格，本节点让事件穿透下去。

import { SceneNode, type Region, type RenderContext, type SceneNodeInit } from '@infinitable/render'

import type { BorderInset } from '../cell-style'
import {
  MEDIA_CELL_BACKGROUND,
  bodyViewportClip,
  drawFittedImage,
  fittedRect,
  paintImagePlaceholder,
  type ImageFit,
} from '@infinitable/grid'
import type { LoadedImage } from '@infinitable/grid'

export interface ImageCellNodeInit extends SceneNodeInit {
  col: number
  row: number
  url: string
  fit?: ImageFit
  /** 该时刻之后占位才允许上屏（请求时刻 + placeholderDelay） */
  placeholderAfter: number
  /**
   * 绘制区内缩的四边边框线宽（本格生效边框，默认网格线右/下 1px）：
   * media 层画在 body 之上，内缩后图片/占位不盖住画在本格矩形内的边框。缺省不内缩。
   */
  borderInset?: BorderInset
  /**
   * body 视口（层坐标，扣除表头/行号列）：绘制裁剪边界。
   * 缺省不裁剪；提供时边缘半格图片只画视口内部分，不越界盖住表头/行号列。
   */
  bodyViewport?: Region
  /** 时钟注入（默认 Date.now，测试可控） */
  now?: () => number
}

/** 零内缩共享常量（样式对象按不可变约定使用） */
const NO_BORDER_INSET: BorderInset = { top: 0, right: 0, bottom: 0, left: 0 }

export class ImageCellNode extends SceneNode {
  readonly col: number
  readonly row: number
  readonly url: string
  fit: ImageFit
  placeholderAfter: number
  /** 绘制区内缩（本格生效边框线宽；对象按不可变约定使用，变更整体替换） */
  borderInset: BorderInset
  private image: LoadedImage | null = null
  private readonly bodyViewport: Region | null
  private readonly now: () => number

  constructor(init: ImageCellNodeInit) {
    super({ pickable: false, ...init })
    this.col = init.col
    this.row = init.row
    this.url = init.url
    this.fit = init.fit ?? 'contain'
    this.placeholderAfter = init.placeholderAfter
    this.borderInset = init.borderInset ?? NO_BORDER_INSET
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
    // 绘制区内缩本格生效边框线宽：media 层画在 body 之上，不内缩会盖住 body 层
    // 画在本格矩形内的边框（默认网格线右/下、显式边框、首列/首行左/上）
    const inset = this.borderInset
    const width = Math.max(0, this.width - inset.left - inset.right)
    const height = Math.max(0, this.height - inset.top - inset.bottom)
    if (width > 0 && height > 0) {
      if (inset.left !== 0 || inset.top !== 0) {
        ctx.save()
        ctx.translate(inset.left, inset.top)
      }
      if (this.image) {
        // 白底只垫位图实际区域：contain 留白保持透明——格底色与网格线从下层透出，
        // 不再整格填充白底把网格线盖住（透明位图在位图区域内仍有白底兜底可读）
        const rect = fittedRect(this.image, width, height, this.fit)
        ctx.fillStyle = MEDIA_CELL_BACKGROUND
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
        drawFittedImage(ctx, this.image, width, height, this.fit)
      } else {
        paintImagePlaceholder(ctx, width, height)
      }
      if (inset.left !== 0 || inset.top !== 0) {
        ctx.restore()
      }
    }
    if (clip) {
      ctx.restore()
    }
  }

  private viewportClip(): Region | null {
    return bodyViewportClip(this.getGlobalBounds(), this.bodyViewport)
  }
}
