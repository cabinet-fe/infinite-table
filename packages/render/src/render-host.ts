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
  /** 设备像素比（缺省取运行环境 window.devicePixelRatio，无 window 环境回落 1） */
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

/** 运行环境 DPR：存在全局 window 时取 devicePixelRatio，无 window 环境（headless/离屏）回落 1 */
function resolveEnvironmentDpr(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
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
  private dpr: number
  private width: number
  private height: number
  private destroyed = false
  /** 宿主 DPR 变化探测的 resolution 查询（matchMedia 通道；resize 通道见 watchDpr） */
  private dprMediaQuery: MediaQueryList | null = null
  /** 稳定引用：同帧内多次失效经 Set 去重后只收敛出一次 flush */
  private readonly flushTask: FrameTask = () => this.flush()

  constructor(private readonly options: RenderHostOptions) {
    this.width = options.width
    this.height = options.height
    this.dpr = options.dpr ?? resolveEnvironmentDpr()
    this.createCanvas = options.createCanvas ?? defaultCreateCanvas
    this.scheduler = new FrameScheduler(options.scheduleFrame, options.cancelFrame)
    this.pool = new CanvasPool(this.createCanvas)
    this.measureText = options.measureText
    const eventsTarget = options.eventsTarget ?? options.container
    this.eventSystem = eventsTarget
      ? new EventSystem(eventsTarget, () => this.rootsTopDown())
      : null
    this.watchDpr()
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

  /**
   * 原地调整视口尺寸：记录新尺寸（后续建层取新值），已建层逐个重设（含 CSS 尺寸）并整层失效；
   * dpr 显式传参时同步内部 dpr（core 侧几何变更路径透传运行期 DPR 的落地入口）
   */
  resize(width: number, height: number, dpr?: number): void {
    if (this.destroyed) {
      return
    }
    this.width = width
    this.height = height
    if (dpr !== undefined) {
      this.dpr = dpr
    }
    for (const layer of this.layers.values()) {
      layer.setSize(width, height, dpr)
      this.applyCanvasCssSize(layer.canvasElement)
    }
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
    this.unwatchDpr()
    this.scheduler.destroy()
    this.eventSystem?.dispose()
    this.pool.clear()
    for (const layer of this.layers.values()) {
      this.unmount(layer.canvasElement)
    }
    this.layers.clear()
  }

  /**
   * 运行期 DPR 跟随：window resize + matchMedia resolution 双通道探测 devicePixelRatio 变更
   * （浏览器缩放/跨屏走 resize，纯缩放比变更走 resolution 失配）。变化后以新 dpr 重设全部
   * 已建层物理尺寸（setSize 内整层失效，帧末统一重绘），滚动位置与场景内容不动、实例不重建。
   */
  private watchDpr(): void {
    if (typeof window === 'undefined') {
      return
    }
    window.addEventListener('resize', this.handleHostDprChange)
    this.watchDprMediaQuery()
  }

  private unwatchDpr(): void {
    if (typeof window === 'undefined') {
      return
    }
    window.removeEventListener('resize', this.handleHostDprChange)
    this.unwatchDprMediaQuery()
  }

  /** matchMedia resolution 探测按当前 resolution 一监听一轮：已武装到位则跳过 */
  private watchDprMediaQuery(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const query = `(resolution: ${window.devicePixelRatio}dppx)`
    if (this.dprMediaQuery?.media === query) {
      return
    }
    this.unwatchDprMediaQuery()
    const mediaQuery = window.matchMedia(query)
    mediaQuery.addEventListener('change', this.handleHostDprChange)
    this.dprMediaQuery = mediaQuery
  }

  private unwatchDprMediaQuery(): void {
    this.dprMediaQuery?.removeEventListener('change', this.handleHostDprChange)
    this.dprMediaQuery = null
  }

  private readonly handleHostDprChange = (): void => {
    const dpr = resolveEnvironmentDpr()
    if (dpr !== this.dpr) {
      this.dpr = dpr
      for (const layer of this.layers.values()) {
        layer.setSize(this.width, this.height, dpr)
      }
    }
    this.watchDprMediaQuery()
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
    this.applyCanvasCssSize(canvas)
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

  /** 上屏模式：canvas 的 CSS 尺寸跟随视口（离屏/假画布无 style 语义，跳过） */
  private applyCanvasCssSize(canvas: RenderCanvas): void {
    if (
      this.options.container &&
      typeof HTMLCanvasElement !== 'undefined' &&
      canvas instanceof HTMLCanvasElement
    ) {
      canvas.style.width = `${this.width}px`
      canvas.style.height = `${this.height}px`
    }
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
