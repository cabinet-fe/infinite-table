import { InvalidationQueue, type RepaintPlan } from '../invalidation/invalidation-queue'
import type { CanvasPool } from '../pool/canvas-pool'
import { clip } from '../region'
import { paintTree } from '../scene/paint'
import { SceneNode } from '../scene/scene-node'
import type {
  Invalidation,
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
    private readonly pool: CanvasPool,
    /** 请求宿主在下一帧执行各层 flush（单帧收敛） */
    private readonly scheduleFlush: () => void,
  ) {
    this.queue = new InvalidationQueue(kind)
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvasElement.width = Math.round(width * dpr)
    this.canvasElement.height = Math.round(height * dpr)
    this.ctx = this.canvasElement.getContext('2d')
    this.root = new SceneNode({ width, height, pickable: false })
  }

  /**
   * 调整层尺寸并整层失效。
   * 预留能力：当前 core 无调用方（层尺寸随宿主创建固定），仅测试覆盖。
   */
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

  /**
   * 平移本层位图的 blit 快路径：经池化临时画布自拷贝，暴露带转 band 失效增量补画。
   * 预留能力：当前 core 无调用方（滚动走重建+band 路线），仅测试覆盖。
   */
  translateBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) {
      return
    }
    const physicalWidth = this.canvasElement.width
    const physicalHeight = this.canvasElement.height
    const offsetX = Math.round(dx * this.dpr)
    const offsetY = Math.round(dy * this.dpr)
    if (
      !this.ctx ||
      physicalWidth <= 0 ||
      physicalHeight <= 0 ||
      Math.abs(offsetX) >= physicalWidth ||
      Math.abs(offsetY) >= physicalHeight
    ) {
      this.invalidate({ type: 'full' })
      return
    }
    // blit 快路径：经池化临时画布自拷贝，暴露带转 band 失效增量补画
    const temp = this.pool.acquire(physicalWidth, physicalHeight)
    const tempCtx = temp.getContext('2d')
    if (tempCtx) {
      tempCtx.drawImage(this.canvasElement, 0, 0)
      this.ctx.save()
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.clearRect(0, 0, physicalWidth, physicalHeight)
      this.ctx.drawImage(temp, offsetX, offsetY)
      this.ctx.restore()
    }
    this.pool.release(temp)
    for (const region of this.exposedRegions(dx, dy)) {
      this.invalidate({ type: 'band', region })
    }
  }

  /** 帧末消费：取出重绘计划并执行；本帧无失效返回 false */
  flush(): boolean {
    const plan = this.queue.drain()
    if (!plan) {
      return false
    }
    this.render(plan)
    return true
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

  /** 平移后暴露的 L 形区域拆成横竖两条带（避免重叠重复失效） */
  private exposedRegions(dx: number, dy: number): Region[] {
    const regions: Region[] = []
    const absDy = Math.min(Math.abs(dy), this.height)
    const absDx = Math.min(Math.abs(dx), this.width)
    if (absDy > 0) {
      regions.push({
        x: 0,
        y: dy > 0 ? 0 : this.height - absDy,
        width: this.width,
        height: absDy,
      })
    }
    if (absDx > 0) {
      regions.push({
        x: dx > 0 ? 0 : this.width - absDx,
        y: dy > 0 ? absDy : 0,
        width: absDx,
        height: this.height - absDy,
      })
    }
    return regions
  }
}
