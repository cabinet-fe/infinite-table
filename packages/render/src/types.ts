// 渲染引擎公共类型：RenderHost 窄接口及其实现共享的基础类型

import type { SceneNode } from './scene/scene-node'

/** 矩形区域（场景坐标，CSS 像素） */
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

/** 尺寸 */
export interface Size {
  width: number
  height: number
}

/** 四层 canvas 的层标识，自底向上 ground → body → media → sky */
export type LayerKind = 'ground' | 'body' | 'media' | 'sky'

/** 层创建参数 */
export interface LayerOpts {
  kind: LayerKind
}

/** 引擎使用的 2D 上下文最小子集（结构化类型，真实 CanvasRenderingContext2D 天然满足） */
export interface RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  save(): void
  restore(): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  translate(x: number, y: number): void
  beginPath(): void
  rect(x: number, y: number, width: number, height: number): void
  clip(): void
  clearRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  drawImage(image: RenderImageSource, dx: number, dy: number): void
  drawImage(image: RenderImageSource, dx: number, dy: number, dw: number, dh: number): void
  drawImage(
    image: RenderImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
  measureText(text: string): {
    width: number
    actualBoundingBoxAscent?: number
    actualBoundingBoxDescent?: number
  }
}

/** drawImage 接受的位图源：引擎画布或任意 DOM 图像源 */
export type RenderImageSource = RenderCanvas | CanvasImageSource

/** 引擎使用的 canvas 最小子集（结构化类型，真实 HTMLCanvasElement 天然满足） */
export interface RenderCanvas {
  width: number
  height: number
  getContext(contextId: '2d'): RenderContext | null
}

/**
 * 三档失效：
 * - cell：单元格级脏区（可带旧包围盒，用于内容移动/缩放后的双包围盒重绘）
 * - band：行带级脏区（视口全宽的一条横带，滚动窗口滑动的典型产物）
 * - full：整层重绘（无可靠 bounds 时必须用 full，禁止猜小块）
 */
export type Invalidation =
  | { type: 'cell'; region: Region; prevRegion?: Region }
  | { type: 'band'; region: Region }
  | { type: 'full' }

/** 帧任务：在下一个渲染帧执行一次 */
export type FrameTask = () => void

/** 层句柄：持层方对单层 canvas 的全部操作入口 */
export interface LayerHandle {
  readonly kind: LayerKind
  /** 该层场景树根节点（尺寸与层一致），内容方在此挂载场景子树 */
  readonly root: SceneNode
  /** 该层画布（上屏模式下即挂载在容器中的 canvas 元素） */
  readonly canvasElement: RenderCanvas
  /**
   * 调整层尺寸（w/h 为 CSS 像素，dpr 缺省沿用当前值）。
   * 预留能力：当前 core 无调用方（滚动走重建+band 路线，层尺寸随宿主创建固定），仅测试覆盖。
   */
  setSize(width: number, height: number, dpr?: number): void
  /** 对本层声明三档失效，等价于 host.submitInvalidation(kind, inv) */
  invalidate(inv: Invalidation): void
  /**
   * 层内容整体平移的 blit 快路径：位图自拷贝 + 暴露带转 band 失效。
   * 预留能力：当前 core 无调用方（滚动走重建+band 路线），仅测试覆盖；
   * 若未来滚动路线切换为平移复用，此处即 body 层快路径接入点。
   */
  translateBy(dx: number, dy: number): void
}

/**
 * RenderHost 窄接口：外部仅凭该接口完成建层、提交三档失效、请求帧、读测量。
 * 场景内容的读写经 LayerHandle.root 的场景树 API 进行。
 */
export interface RenderHost {
  /** 按 kind 取层句柄；同 kind 重复调用幂等返回同一句柄 */
  createLayer(opts: LayerOpts): LayerHandle
  /** 提交三档失效；当帧内多次提交在下一帧收敛为一次重绘 */
  submitInvalidation(kind: LayerKind, inv: Invalidation): void
  /** 请求一个渲染帧；同一任务在同一帧内只执行一次 */
  requestFrame(task: FrameTask): void
  /** 文本测量（CSS 像素） */
  measure(text: string, font: string): Size
  /** 销毁：取消挂起帧、解绑事件、回收池化画布 */
  destroy(): void
}
