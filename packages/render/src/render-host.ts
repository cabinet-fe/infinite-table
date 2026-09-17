import { EventSystem, type EventTargetLike } from './events/event-system'
import { FrameScheduler, type FrameCancelFn, type FrameScheduleFn } from './frame-scheduler'
import { CanvasLayer } from './layers/canvas-layer'
import { CanvasPool, type CanvasFactory } from './pool/canvas-pool'
import type { SceneNode } from './scene/scene-node'
import type {
  FrameTask,
  Invalidation,
  LayerHandle,
  LayerKind,
  LayerOpts,
  RenderCanvas,
  RenderHost,
  Size,
} from './types'

export interface RenderHostOptions {
  /** 视口尺寸（CSS 像素） */
  width: number
  height: number
  dpr?: number
  /**
   * 上屏容器：提供时各层 canvas 以绝对定位按 ground→body→media→sky 叠放进去，
   * 单帧收敛后由浏览器合成上屏；缺省为离屏模式（测试/预渲染）。
   */
  container?: HTMLElement
  /** 事件源：提供后启用事件系统（缺省取 container） */
  eventsTarget?: EventTargetLike
  /** canvas 工厂（缺省 document.createElement('canvas')，测试可注入假画布） */
  createCanvas?: CanvasFactory
  /** 帧调度（缺省 rAF，测试可注入同步执行） */
  scheduleFrame?: FrameScheduleFn
  cancelFrame?: FrameCancelFn
  /** 文本测量覆盖（缺省用测量画布，测试可注入） */
  measureText?: (text: string, font: string) => Size
}

/** 层叠放顺序（自底向上） */
const LAYER_ORDER: readonly LayerKind[] = ['ground', 'body', 'media', 'sky']

function defaultCreateCanvas(): RenderCanvas {
  return document.createElement('canvas')
}

/** 创建渲染宿主（RenderHost 窄接口的唯一实现入口） */
export function createRenderHost(options: RenderHostOptions): RenderHost {
  return new CanvasRenderHost(options)
}

class CanvasRenderHost implements RenderHost {
  private readonly layers = new Map<LayerKind, CanvasLayer>()
  private readonly scheduler: FrameScheduler
  private readonly pool: CanvasPool
  private readonly createCanvas: CanvasFactory
  private readonly eventSystem: EventSystem | null
  private readonly measureText?: (text: string, font: string) => Size
  private measureCanvas: RenderCanvas | null = null
  private readonly dpr: number
  private width: number
  private height: number
  private destroyed = false
  /** 稳定引用：同帧内多次失效经 Set 去重后只收敛出一次 flush */
  private readonly flushTask: FrameTask = () => this.flush()

  constructor(private readonly options: RenderHostOptions) {
    this.width = options.width
    this.height = options.height
    this.dpr = options.dpr ?? 1
    this.createCanvas = options.createCanvas ?? defaultCreateCanvas
    this.scheduler = new FrameScheduler(options.scheduleFrame, options.cancelFrame)
    this.pool = new CanvasPool(this.createCanvas)
    this.measureText = options.measureText
    const eventsTarget = options.eventsTarget ?? options.container
    this.eventSystem = eventsTarget
      ? new EventSystem(eventsTarget, () => this.rootsTopDown())
      : null
  }

  createLayer(opts: LayerOpts): LayerHandle {
    const existing = this.layers.get(opts.kind)
    if (existing) {
      return existing
    }
    const canvas = this.createCanvas()
    const layer = new CanvasLayer(
      opts.kind,
      canvas,
      this.width,
      this.height,
      this.dpr,
      this.pool,
      () => this.scheduler.request(this.flushTask),
    )
    this.layers.set(opts.kind, layer)
    // 层集合变化：事件系统的层根缓存失效，下一次派发重建
    this.eventSystem?.invalidateRoots()
    this.mount(opts.kind, canvas)
    return layer
  }

  submitInvalidation(kind: LayerKind, inv: Invalidation): void {
    this.createLayer({ kind }).invalidate(inv)
  }

  requestFrame(task: FrameTask): void {
    this.scheduler.request(task)
  }

  measure(text: string, font: string): Size {
    if (this.measureText) {
      return this.measureText(text, font)
    }
    if (!this.measureCanvas) {
      this.measureCanvas = this.createCanvas()
    }
    const ctx = this.measureCanvas.getContext('2d')
    if (!ctx) {
      return { width: 0, height: 0 }
    }
    ctx.font = font
    const metrics = ctx.measureText(text)
    return {
      width: metrics.width,
      height: (metrics.actualBoundingBoxAscent ?? 0) + (metrics.actualBoundingBoxDescent ?? 0),
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return
    }
    this.destroyed = true
    this.scheduler.destroy()
    this.eventSystem?.dispose()
    this.pool.clear()
    for (const layer of this.layers.values()) {
      this.unmount(layer.canvasElement)
    }
    this.layers.clear()
  }

  /** 帧末各层按 ground→body→media→sky 顺序消费重绘计划（上屏模式由浏览器合成） */
  private flush(): void {
    for (const kind of LAYER_ORDER) {
      this.layers.get(kind)?.flush()
    }
  }

  private rootsTopDown(): readonly SceneNode[] {
    const roots = []
    for (let i = LAYER_ORDER.length - 1; i >= 0; i--) {
      const kind = LAYER_ORDER[i]
      if (kind) {
        const layer = this.layers.get(kind)
        if (layer) {
          roots.push(layer.root)
        }
      }
    }
    return roots
  }

  private mount(kind: LayerKind, canvas: RenderCanvas): void {
    const container = this.options.container
    if (
      !container ||
      typeof HTMLCanvasElement === 'undefined' ||
      !(canvas instanceof HTMLCanvasElement)
    ) {
      return
    }
    canvas.style.position = 'absolute'
    canvas.style.left = '0'
    canvas.style.top = '0'
    canvas.style.width = `${this.width}px`
    canvas.style.height = `${this.height}px`
    canvas.dataset.layerKind = kind
    // 按 LAYER_ORDER 声明 z 序插入：插到首个已挂载的更上层之前，
    // 使「先创建 body、后惰性创建 media」的实际用例下 DOM 叠放仍为 ground→body→media→sky
    for (let i = LAYER_ORDER.indexOf(kind) + 1; i < LAYER_ORDER.length; i++) {
      const laterKind = LAYER_ORDER[i]
      const later = laterKind ? this.layers.get(laterKind) : undefined
      if (
        later &&
        later.canvasElement instanceof HTMLCanvasElement &&
        container.contains(later.canvasElement)
      ) {
        container.insertBefore(canvas, later.canvasElement)
        return
      }
    }
    container.appendChild(canvas)
  }

  private unmount(canvas: RenderCanvas): void {
    if (
      this.options.container &&
      typeof HTMLCanvasElement !== 'undefined' &&
      canvas instanceof HTMLCanvasElement
    ) {
      canvas.remove()
    }
  }
}
