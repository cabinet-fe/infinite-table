---
title: RenderHost 渲染引擎
description: infinitable 自研 canvas 渲染引擎：createRenderHost 创建宿主（四层 canvas ground/body/media/sky）、SceneNode 场景树、三档失效 Invalidation（cell/band/full）、LayerHandle 层句柄、federated 事件系统与 DPR 跟随。ListTable 经 RenderHost 窄接口提交渲染。
aliases: [RenderHost, 渲染引擎, SceneNode, 场景树, canvas 引擎]
keywords: [createRenderHost, RenderHostOptions, RenderHost, SceneNode, SceneEvent, LayerHandle, LayerKind, Invalidation, submitInvalidation, requestFrame, measure, ground, body, media, sky, pickable, getGlobalBounds, 分层 canvas, 失效, 脏区]
---

# RenderHost 渲染引擎

`infinitable`（render 层）导出自研 canvas 渲染引擎：`createRenderHost` 是 `RenderHost` 窄接口的唯一实现入口（四层 canvas 按 ground→body→media→sky 自底向上叠放、帧调度收敛、DPR 跟随），`SceneNode` 是场景树节点（paint 绘制 + federated 事件冒泡），`LayerHandle` 是单层操作入口（三档失效 `Invalidation`：cell/band/full）。`ListTable` 内部经该引擎提交渲染；宿主注入自建场景（水印 painter、自绘 overlay）或测试离屏渲染时直接使用本层 API。

## 快速上手

```ts
import { createRenderHost, SceneNode } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#stage')!
container.style.position = 'relative' // 各层 canvas 以绝对定位叠放

const host = createRenderHost({
  width: 800,
  height: 600,
  container, // 缺省为离屏模式（测试/预渲染，不上屏）
})

// 建层（同 kind 重复调用幂等返回同一句柄）
const layer = host.createLayer({ kind: 'body' })

// 场景树挂内容
class RectNode extends SceneNode {
  override paint(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#2e6adb'
    ctx.fillRect(0, 0, this.width, this.height)
  }
}
const rect = new RectNode({ x: 40, y: 40, width: 120, height: 60 })
layer.root.appendChild(rect)

// 提交失效（下一帧收敛重绘）
layer.invalidate({ type: 'cell', region: { x: 40, y: 40, width: 120, height: 60 } })
// => 画布上出现蓝色矩形

host.destroy() // 取消挂起帧、解绑事件、回收池化画布并从容器移除 canvas
```

## API 签名

```ts
export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/** 四层 canvas 的层标识，自底向上 ground → body → media → sky */
export type LayerKind = 'ground' | 'body' | 'media' | 'sky'

export interface LayerOpts {
  kind: LayerKind
}

/**
 * 三档失效：
 * - cell：单元格级脏区（可带旧包围盒 prevRegion，用于内容移动后的双包围盒重绘）
 * - band：行带级脏区（视口全宽/全高的一条带，滚动窗口滑动的典型产物）
 * - full：整层重绘
 */
export type Invalidation =
  | { type: 'cell'; region: Region; prevRegion?: Region }
  | { type: 'band'; region: Region }
  | { type: 'full' }

/** 帧任务：在下一个渲染帧执行一次 */
export type FrameTask = () => void

/** 引擎使用的 2D 上下文最小子集（结构化类型，真实 CanvasRenderingContext2D 天然满足） */
export interface RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  font: string
  shadowColor?: string
  shadowBlur?: number
  save(): void
  restore(): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  translate(x: number, y: number): void
  rotate?(rad: number): void
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
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void
  measureText(text: string): {
    width: number
    actualBoundingBoxAscent?: number
    actualBoundingBoxDescent?: number
  }
}

/** drawImage 接受的位图源 */
export type RenderImageSource = RenderCanvas | CanvasImageSource

/** 引擎使用的 canvas 最小子集 */
export interface RenderCanvas {
  width: number
  height: number
  getContext(contextId: '2d'): RenderContext | null
}

/** 层句柄：持层方对单层 canvas 的全部操作入口 */
export interface LayerHandle {
  readonly kind: LayerKind
  /** 该层场景树根节点（尺寸与层一致） */
  readonly root: SceneNode
  /** 该层画布（上屏模式下即容器中的 canvas 元素） */
  readonly canvasElement: RenderCanvas
  /** 调整层尺寸并整层失效 */
  setSize(width: number, height: number, dpr?: number): void
  /** 对本层声明三档失效 */
  invalidate(inv: Invalidation): void
  /** 层内容整体平移的 blit 快路径（位图自拷贝 + 暴露带转 band 失效；预留能力） */
  translateBy(dx: number, dy: number): void
}

/** 渲染宿主窄接口 */
export interface RenderHost {
  createLayer(opts: LayerOpts): LayerHandle
  submitInvalidation(kind: LayerKind, inv: Invalidation): void
  requestFrame(task: FrameTask): void
  measure(text: string, font: string): Size
  resize(width: number, height: number, dpr?: number): void
  destroy(): void
}

export interface RenderHostOptions {
  width: number
  height: number
  /** 设备像素比（缺省取运行环境 window.devicePixelRatio，无 window 环境回落 1） */
  dpr?: number
  /** 上屏容器：各层 canvas 以绝对定位叠放进去；缺省为离屏模式 */
  container?: HTMLElement
  /** 事件源：提供后启用事件系统（缺省取 container） */
  eventsTarget?: EventTargetLike
  /** canvas 工厂（缺省 document.createElement('canvas')，测试可注入假画布） */
  createCanvas?: CanvasFactory
  /** 帧调度（缺省 rAF，测试可注入同步执行） */
  scheduleFrame?: FrameScheduleFn
  cancelFrame?: FrameCancelFn
  /** 文本测量覆盖（缺省用测量画布） */
  measureText?: (text: string, font: string) => Size
}

/** 创建渲染宿主（RenderHost 窄接口的唯一实现入口） */
export function createRenderHost(options: RenderHostOptions): RenderHost

export interface SceneNodeInit {
  x?: number
  y?: number
  width?: number
  height?: number
  /** 缺省 true */
  visible?: boolean
  /** 缺省 true；false 时命中测试穿透本节点（子节点仍可被命中） */
  pickable?: boolean
}

export type SceneEventListener = (event: SceneEvent) => void

export class SceneNode {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  pickable: boolean
  parent: SceneNode | null
  readonly children: SceneNode[]
  constructor(init?: SceneNodeInit)
  appendChild(child: SceneNode): void
  removeChild(child: SceneNode): void
  removeFromParent(): void
  /** 批量摘除子节点：predicate 命中的全部摘除，O(children) 单趟，相对顺序不变 */
  removeChildren(predicate: (child: SceneNode) => boolean): SceneNode[]
  /** 全局（层）坐标下的包围盒 */
  getGlobalBounds(): Region
  /** 绘制内容覆盖的局部包围盒（脏区剔除判定用；缺省即自身包围盒） */
  paintedBounds(): Region
  /** 绘制自身内容（ctx 已平移到本节点局部原点）；子类覆盖 */
  paint(ctx: RenderContext): void
  on(type: SceneEventType, listener: SceneEventListener): () => void
  off(type: SceneEventType, listener: SceneEventListener): void
  handleEvent(event: SceneEvent): void
}

export type SceneEventType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'click'
  | 'dblclick'
  | 'contextmenu'
  | 'wheel'

export interface SceneEvent {
  type: SceneEventType
  /** 层坐标（CSS 像素） */
  x: number
  y: number
  /** 事件目标节点（命中节点） */
  target: SceneNode
  /** 当前冒泡节点 */
  currentTarget: SceneNode
  originalEvent: unknown
  /** 阻止继续冒泡 */
  stopPropagation(): void
}
```

## 参数说明

`RenderHostOptions`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `width` / `height` | `number` | — | 是 | 视口尺寸（CSS 像素） |
| `dpr` | `number` | 环境值 | 否 | 无 window 环境（headless/离屏）回落 1；运行期 DPR 变化（浏览器缩放/跨屏）宿主自动跟随：以新 dpr 重设全部已建层物理尺寸并整层重绘，实例不重建 |
| `container` | `HTMLElement` | 离屏 | 否 | 各层 canvas 绝对定位叠放（DOM 按 LAYER_ORDER 声明 z 序插入，惰性建层叠放不变）；容器须 position 非 static |
| `eventsTarget` | `EventTarget` | `container` | 否 | 提供后启用 federated 事件系统 |
| `createCanvas` | `() => RenderCanvas` | DOM canvas | 否 | 测试注入假画布 |
| `scheduleFrame`/`cancelFrame` | 帧调度函数 | rAF | 否 | 测试注入同步执行 |
| `measureText` | `(text, font) => Size` | 测量画布 | 否 | 文本测量覆盖 |

`SceneNodeInit`：全部可选；`pickable: false` 的节点命中穿透（子节点仍可命中）。

`Invalidation` 三档选择规则：有可靠脏区用 `cell`（带 `prevRegion` 覆盖移动前后双包围盒）；滚动窗口滑动产生的整行/整列带用 `band`；无可靠 bounds 必须 `full`（禁止猜小块）。

## 方法与事件

`createRenderHost(options): RenderHost`：

- `createLayer(opts)` — 同 kind 重复调用幂等返回同一句柄；层集合变化使事件系统层根缓存失效。
- `submitInvalidation(kind, inv)` — 等价 `createLayer({ kind }).invalidate(inv)`；同帧内多次失效经 Set 去重，下一帧收敛一次重绘（帧末各层按 ground→body→media→sky 顺序消费重绘计划，上屏模式由浏览器合成）。
- `requestFrame(task)` — 同一任务在同一帧内只执行一次。
- `measure(text, font): Size` — 文本测量（CSS 像素）；height 取 actualBoundingBox 之和。
- `resize(width, height, dpr?)` — 原地重设已建层尺寸（含 CSS 尺寸）并整层失效。
- `destroy()` — 幂等；取消挂起帧、解绑事件、回收池化画布。

`SceneNode`：

- 绘制序：父节点 `paint` 后按 `children` 顺序绘制子节点；节点坐标为父坐标系局部坐标，层坐标 = 累加祖先偏移。
- `paintedBounds()` — 绘制超出自身几何的节点（如向邻格溢出的文本格）覆盖此方法把溢出段并入，防脏区剔除漏画。
- `on/off` — 场景事件（`SceneEventType`）；事件经 EventSystem 命中后从命中节点沿 parent 链冒泡，`stopPropagation` 中断。
- `removeChildren(predicate)` — 单趟 O(children) 批量摘除，返回被摘除节点（parent 已置空）。

`LayerHandle.translateBy(dx, dy)` — 位图自拷贝 + 暴露带转 band 失效的快路径；当前 core 滚动走「重建 + band」路线，无调用方（预留能力，仅测试覆盖）。

`SceneEvent` 事件类型集：`pointerdown`/`pointermove`/`pointerup`/`click`/`dblclick`/`contextmenu`/`wheel`；`x`/`y` 为层坐标。

## 典型示例

### 离屏渲染（无 DOM 上屏，测试/预渲染）

```ts
import { createRenderHost, SceneNode } from 'infinitable'

const host = createRenderHost({ width: 200, height: 100, dpr: 1 }) // 无 container：离屏
const layer = host.createLayer({ kind: 'body' })

class TextNode extends SceneNode {
  override paint(ctx: { fillStyle: string; font: string; fillText(t: string, x: number, y: number): void }): void {
    ctx.fillStyle = '#1f2329'
    ctx.font = '12px sans-serif'
    ctx.fillText('离屏渲染', 8, 20)
  }
}
layer.root.appendChild(new TextNode({ width: 200, height: 100 }))
host.submitInvalidation('body', { type: 'full' })
// canvasElement 可经 layer.canvasElement 取走位图做断言或上传
```

### 场景事件（点击命中节点）

```ts
import { createRenderHost, SceneNode } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#stage')!
container.style.position = 'relative'
const host = createRenderHost({ width: 400, height: 300, container })
const layer = host.createLayer({ kind: 'body' })

const card = new SceneNode({ x: 20, y: 20, width: 100, height: 50 })
layer.root.appendChild(card)

const off = card.on('click', (event) => {
  console.log('点击了卡片', event.x, event.y) // x/y 为层坐标
  event.stopPropagation()
})
// off() 退订
```

### 同帧多次失效收敛

```ts
import { createRenderHost } from 'infinitable'

const host = createRenderHost({ width: 800, height: 600, container: document.querySelector<HTMLElement>('#stage')! })
const layer = host.createLayer({ kind: 'body' })

// 同帧提交三段 cell 失效 + 一次 full：full 覆盖一切，帧末只整层重绘一次
layer.invalidate({ type: 'cell', region: { x: 0, y: 0, width: 10, height: 10 } })
layer.invalidate({ type: 'cell', region: { x: 20, y: 0, width: 10, height: 10 } })
layer.invalidate({ type: 'band', region: { x: 0, y: 100, width: 800, height: 32 } })
layer.invalidate({ type: 'full' })
```

## 注意事项

> [!WARNING]
> - 本引擎是「失效驱动 + 场景树」模型，不是保留模式图形库也不是 SVG DOM：`paint` 在每次重绘帧调用，节点内不要持有跨帧可变绘制状态。
> - 无可靠脏区时必须用 `{ type: 'full' }`，禁止猜小块导致残影。
> - 容器不传即离屏模式：canvas 不挂 DOM、无事件系统（`eventsTarget` 缺省取 container）。
> - `SceneNode.paint` 的 ctx 已平移到本节点局部原点（且已按 dpr 缩放），坐标计算用格内局部坐标即可。
> - 运行期 DPR 变化宿主自动跟随（window resize + matchMedia resolution 双通道）；显式 `resize(w, h, dpr)` 传 dpr 才更新内部 dpr。
> - `LayerHandle.translateBy` 是预留能力，当前无 core 调用方；滚动失效走 band 路线，宿主不要依赖平移快路径。
> - `ListTable` 的 ground/sky 整层绘制预留位经 `table.setUnderlayPainter`/`setOverlayPainter` 挂接，不直接操作 host 建层。

## 常见问题

### 画布内容空白/只有一层有内容

原因：离屏模式（未传 `container`）或容器 position 为 static（绝对定位 canvas 叠到容器外）。修复：传入定位容器。

```ts
import { createRenderHost } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#stage')!
container.style.position = 'relative' // 修复：绝对定位的层 canvas 以容器为包含块
const host = createRenderHost({ width: 800, height: 600, container })
```

### 高分屏（Retina）上画面模糊

原因：显式传了 `dpr: 1` 覆盖了环境值。修复：不传 dpr（缺省取 `window.devicePixelRatio`），或传真实设备像素比。

```ts
import { createRenderHost } from 'infinitable'

const host = createRenderHost({
  width: 800,
  height: 600,
  container: document.querySelector<HTMLElement>('#stage')!,
  // dpr: window.devicePixelRatio  // 需要锁定时显式传；缺省即环境值
})
```
