import { InvalidationQueue, type RepaintPlan } from '../invalidation/invalidation-queue'
import { clip } from '../region'
import { paintTree } from '../scene/paint'
import { SceneNode } from '../scene/scene-node'
import type {
  Invalidation,
  LayerConsumption,
  LayerHandle,
  LayerKind,
  Region,
  RenderCanvas,
  RenderContext,
} from '../types'

/**
 * 单层 canvas：持有一棵场景树与一个失效队列，
 * 帧末按重绘计划消费脏区（整层重绘 / 逐 region 增量补画）。
 */
export class CanvasLayer implements LayerHandle {
  readonly root: SceneNode
  private readonly queue: InvalidationQueue
  private readonly ctx: RenderContext | null
  private width: number
  private height: number
  private dpr: number

  constructor(
    readonly kind: LayerKind,
    readonly canvasElement: RenderCanvas,
    width: number,
    height: number,
    dpr: number,
    /** 请求宿主在下一帧执行各层 flush（单帧收敛） */
    private readonly scheduleFlush: () => void,
    /** 失效消费策略（建层参数注入，透传给本层失效队列） */
    consumption: LayerConsumption,
  ) {
    this.queue = new InvalidationQueue(consumption)
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvasElement.width = Math.round(width * dpr)
    this.canvasElement.height = Math.round(height * dpr)
    this.ctx = this.canvasElement.getContext('2d')
    this.root = new SceneNode({ width, height, pickable: false })
  }

  /** 调整层尺寸并整层失效（宿主 resize 的逐层落地入口） */
  setSize(width: number, height: number, dpr?: number): void {
    this.width = width
    this.height = height
    if (dpr !== undefined) {
      this.dpr = dpr
    }
    this.canvasElement.width = Math.round(width * this.dpr)
    this.canvasElement.height = Math.round(height * this.dpr)
    this.root.width = width
    this.root.height = height
    this.invalidate({ type: 'full' })
  }

  invalidate(inv: Invalidation): void {
    this.queue.push(inv)
    this.scheduleFlush()
  }

  /** 帧末消费：取出重绘计划并执行 */
  flush(): void {
    const plan = this.queue.drain()
    if (!plan) {
      return
    }
    this.render(plan)
  }

  private render(plan: RepaintPlan): void {
    const ctx = this.ctx
    if (!ctx) {
      return
    }
    if (plan.full) {
      ctx.save()
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      ctx.clearRect(0, 0, this.width, this.height)
      paintTree(this.root, ctx)
      ctx.restore()
      return
    }
    const bounds: Region = { x: 0, y: 0, width: this.width, height: this.height }
    for (const region of plan.regions) {
      const dirty = clip(region, bounds)
      if (!dirty) {
        continue
      }
      ctx.save()
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      ctx.beginPath()
      ctx.rect(dirty.x, dirty.y, dirty.width, dirty.height)
      ctx.clip()
      ctx.clearRect(dirty.x, dirty.y, dirty.width, dirty.height)
      paintTree(this.root, ctx, dirty)
      ctx.restore()
    }
  }
}
