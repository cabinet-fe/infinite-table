---
title: 渲染引擎（render）
description: createRenderHost 与 RenderHostOptions、RenderHost 窄接口、LayerHandle 与三档失效、SceneNode 场景树、SceneEvent 事件系统、基础几何与绘制类型，以及离屏渲染、测试注入与 DPR/resize 行为。
---

# 渲染引擎（render）

render 层是自研 canvas 引擎：`createRenderHost` 创建宿主，按 `ground → body → media → sky` 叠放四层 canvas；`SceneNode` 组成场景树；`LayerHandle` 提交三档失效（`cell` / `band` / `full`）。`ListTable` 内部经该窄接口渲染，宿主也可以直接使用本层 API 注入自绘内容或在离屏环境做测试。

## 快速上手

```ts
import type { RenderContext } from 'infinitable'
import { createRenderHost, SceneNode } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#stage')!
container.style.position = 'relative' // 层 canvas 绝对定位，容器不能是 static

const host = createRenderHost({
  width: 800,
  height: 600,
  container, // 不传 container 即离屏模式
})

const layer = host.createLayer({ kind: 'body' }) // 同 kind 重复调用返回同一句柄

class RectNode extends SceneNode {
  override paint(ctx: RenderContext): void {
    ctx.fillStyle = '#2e6adb'
    ctx.fillRect(0, 0, this.width, this.height)
  }
}

const rect = new RectNode({ x: 40, y: 40, width: 120, height: 60 })
layer.root.appendChild(rect)

layer.invalidate({ type: 'cell', region: { x: 40, y: 40, width: 120, height: 60 } })

host.destroy()
```

## createRenderHost 与 RenderHostOptions

```ts
export function createRenderHost(options: RenderHostOptions): RenderHost

export interface RenderHostOptions {
  width: number
  height: number
  dpr?: number
  container?: HTMLElement
  eventsTarget?: EventTargetLike
  createCanvas?: () => RenderCanvas
  scheduleFrame?: (callback: () => void) => number
  cancelFrame?: (handle: number) => void
  measureText?: (text: string, font: string) => Size
}
```

`EventTargetLike` 未作为公共类型导出，结构上只需满足：

```ts
interface EventTargetLike {
  addEventListener(type: string, listener: (event: DomEventLike) => void): void
  removeEventListener(type: string, listener: (event: DomEventLike) => void): void
  getBoundingClientRect?(): { left: number; top: number }
}
```

| 参数               | 类型                   | 默认                                                                 | 必填 | 说明                                                                                       |
| ------------------ | ---------------------- | -------------------------------------------------------------------- | :--: | ------------------------------------------------------------------------------------------ |
| `width` / `height` | `number`               | —                                                                    |  是  | 视口尺寸（CSS 像素）                                                                       |
| `dpr`              | `number`               | 环境 `window.devicePixelRatio`；无 `window` 回落 `1`                 |  否  | 设备像素比。运行期 DPR 变化由宿主自动跟随                                                  |
| `container`        | `HTMLElement`          | 不传即离屏                                                           |  否  | 各层 canvas 以绝对定位按 `ground → body → media → sky` 叠放；容器需 `position` 非 `static` |
| `eventsTarget`     | `EventTargetLike`      | `container`                                                          |  否  | 提供后启用事件系统；离屏且未提供时不派发场景事件                                           |
| `createCanvas`     | `() => RenderCanvas`   | `document.createElement('canvas')`                                   |  否  | canvas 工厂，测试可注入假画布                                                              |
| `scheduleFrame`    | `(callback) => number` | 浏览器 `requestAnimationFrame`；无 rAF 时 `setTimeout(callback, 16)` |  否  | 帧调度；测试可注入同步执行                                                                 |
| `cancelFrame`      | `(handle) => void`     | `cancelAnimationFrame` / `clearTimeout`                              |  否  | 取消帧调度                                                                                 |
| `measureText`      | `(text, font) => Size` | 内部测量画布                                                         |  否  | 文本测量覆盖                                                                               |

## RenderHost 窄接口

```ts
export interface RenderHost {
  createLayer(opts: LayerOpts): LayerHandle
  submitInvalidation(kind: LayerKind, inv: Invalidation): void
  requestFrame(task: FrameTask): void
  measure(text: string, font: string): Size
  resize(width: number, height: number, dpr?: number): void
  destroy(): void
}
```

| 方法                            | 参数                 | 返回          | 说明                                                                               |
| ------------------------------- | -------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `createLayer(opts)`             | `LayerOpts`          | `LayerHandle` | 按 `kind` 取层；同 kind 重复调用幂等返回同一句柄。新建层会使事件系统的层根缓存失效 |
| `submitInvalidation(kind, inv)` | 层标识、失效声明     | `void`        | 等价于 `createLayer({ kind }).invalidate(inv)`；同帧多次提交在下一帧收敛为一次重绘 |
| `requestFrame(task)`            | `FrameTask`          | `void`        | 请求下一渲染帧执行任务；同一任务引用在同一帧内只执行一次                           |
| `measure(text, font)`           | 文本、CSS `font` 串  | `Size`        | 文本测量（CSS 像素）；高度为 `actualBoundingBoxAscent + actualBoundingBoxDescent`  |
| `resize(width, height, dpr?)`   | 新视口尺寸、可选 dpr | `void`        | 原地重设已建层尺寸（含 CSS 尺寸）并整层失效；显式 dpr 会同步宿主内部 dpr           |
| `destroy()`                     | —                    | `void`        | 幂等；取消挂起帧、解绑事件、回收池化画布、移除容器中的 canvas                      |

## 层、句柄与失效

```ts
export type LayerKind = 'ground' | 'body' | 'media' | 'sky'

export interface LayerOpts {
  kind: LayerKind
}

export type FrameTask = () => void

export type Invalidation =
  | { type: 'cell'; region: Region; prevRegion?: Region }
  | { type: 'band'; region: Region }
  | { type: 'full' }
```

| 类型           | 说明                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `LayerKind`    | 四层标识，自底向上 `ground → body → media → sky`                                                                                         |
| `LayerOpts`    | 建层参数，仅含 `kind`                                                                                                                    |
| `FrameTask`    | `() => void`，在下一渲染帧执行一次                                                                                                       |
| `Invalidation` | 三档失效：`cell` 单元格级脏区（可带 `prevRegion` 覆盖移动前后双包围盒）；`band` 行带/列带级脏区，滚动窗口滑动的典型产物；`full` 整层重绘 |

```ts
export interface LayerHandle {
  readonly kind: LayerKind
  readonly root: SceneNode
  readonly canvasElement: RenderCanvas
  setSize(width: number, height: number, dpr?: number): void
  invalidate(inv: Invalidation): void
  translateBy(dx: number, dy: number): void
}
```

| 成员            | 签名                            | 说明                                                                                                          |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `kind`          | `readonly LayerKind`            | 层标识                                                                                                        |
| `root`          | `readonly SceneNode`            | 该层场景树根，尺寸与层一致；内容挂在这里                                                                      |
| `canvasElement` | `readonly RenderCanvas`         | 该层画布；上屏模式下即容器中的 canvas 元素                                                                    |
| `setSize`       | `(width, height, dpr?) => void` | 调整层尺寸并整层失效；dpr 缺省沿用当前值                                                                      |
| `invalidate`    | `(inv: Invalidation) => void`   | 对本层声明三档失效                                                                                            |
| `translateBy`   | `(dx, dy) => void`              | 位图自拷贝的整体平移快路径，暴露带转为 `band` 失效。当前 core 滚动走「重建 + band」路线，无调用方；属预留能力 |

::: details 失效队列的收敛规则
- `cell` 失效：`region` 与 `prevRegion` 先取并集，再四边外扩 10px 并像素对齐。
- `band` 失效：吸收被其完全包含的 `cell`（仅相交不吸收）；同帧 `band` 数超过 8 条时升级为整层重绘；`full` 吸收一切。
- 各层消费策略：`ground` 只响应 `band` / `full`；`body` 与 `media` 逐 region 清理并重画；`sky` 收到任何失效都整层重画。
- 帧末按 `ground → body → media → sky` 顺序消费各层重绘计划。
:::

## 场景树 SceneNode

```ts
export interface SceneNodeInit {
  x?: number
  y?: number
  width?: number
  height?: number
  visible?: boolean
  pickable?: boolean
}

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
  removeChildren(predicate: (child: SceneNode) => boolean): SceneNode[]
  getGlobalBounds(): Region
  paintedBounds(): Region
  paint(ctx: RenderContext): void
  on(type: SceneEventType, listener: SceneEventListener): () => void
  off(type: SceneEventType, listener: SceneEventListener): void
  handleEvent(event: SceneEvent): void
}
```

| 成员               | 默认   | 说明                                           |
| ------------------ | ------ | ---------------------------------------------- |
| `x` / `y`          | `0`    | 父坐标系局部坐标；层坐标为累加祖先偏移         |
| `width` / `height` | `0`    | 节点尺寸；参与命中与脏区剔除                   |
| `visible`          | `true` | `false` 时整棵子树不绘制、不参与命中           |
| `pickable`         | `true` | `false` 时命中测试穿透本节点，子节点仍可被命中 |
| `parent`           | `null` | 父节点；由场景树 API 维护                      |

| 方法               | 参数                 | 返回           | 说明                                                                                                                   |
| ------------------ | -------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `appendChild`      | `SceneNode`          | `void`         | 追加子节点；若已有父节点先摘除。绘制顺序即 `children` 顺序，后者在上                                                   |
| `removeChild`      | `SceneNode`          | `void`         | 摘除指定子节点并把其 `parent` 置空                                                                                     |
| `removeFromParent` | —                    | `void`         | 从当前父节点摘除自身                                                                                                   |
| `removeChildren`   | `(child) => boolean` | 被摘除节点数组 | 单趟 `O(children)` 批量摘除，相对顺序不变，`parent` 已置空                                                             |
| `getGlobalBounds`  | —                    | `Region`       | 全局（层）坐标下的包围盒                                                                                               |
| `paintedBounds`    | —                    | `Region`       | 绘制内容覆盖的局部包围盒；缺省即 `{ x: 0, y: 0, width, height }`。绘制超出自身几何的节点应覆盖此方法，避免脏区剔除漏画 |
| `paint`            | `RenderContext`      | `void`         | 绘制自身内容；`ctx` 已平移到本节点局部原点并按 dpr 缩放。子类覆盖                                                      |
| `on`               | 事件类型、监听器     | 退订函数       | 订阅本节点的场景事件                                                                                                   |
| `off`              | 事件类型、监听器     | `void`         | 退订                                                                                                                   |
| `handleEvent`      | `SceneEvent`         | `void`         | 由事件系统在冒泡路径上调用；一般不需要手动调用                                                                         |

绘制顺序：父节点先 `paint`，再按 `children` 顺序绘制子节点。子节点坐标相对父节点，`ctx` 已平移，无需自行累加祖先偏移。

```ts
import type { Region, RenderContext } from 'infinitable'
import { SceneNode } from 'infinitable'

class BadgeNode extends SceneNode {
  override paint(ctx: RenderContext): void {
    ctx.fillStyle = '#22c55e'
    ctx.fillRect(0, 0, this.width, this.height)
  }

  // 若绘制会超出自身矩形（如外扩标牌），把溢出段并入
  override paintedBounds(): Region {
    return { x: -6, y: -6, width: this.width + 12, height: this.height + 12 }
  }
}
```

## 事件系统与 SceneEvent

```ts
export type SceneEventType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'wheel'
  | 'keydown'
  | 'keyup'
  | 'contextmenu'
  | 'touchstart'
  | 'touchmove'
  | 'touchend'
  | 'touchcancel'

export type SceneEventListener = (event: SceneEvent) => void

export interface SceneEvent {
  readonly type: SceneEventType
  readonly target: SceneNode | null
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
  readonly key: string | undefined
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly button?: number
  readonly originalEvent: DomEventLike
}
```

| 字段                               | 类型                  | 说明                                                            |
| ---------------------------------- | --------------------- | --------------------------------------------------------------- |
| `type`                             | `SceneEventType`      | 归一化后的事件类型                                              |
| `target`                           | `SceneNode \| null`   | 命中的最深层节点；键盘事件不命中，为 `null`                     |
| `x` / `y`                          | `number`              | 层坐标（CSS 像素）；键盘事件为 `0`                              |
| `deltaX` / `deltaY`                | `number`              | 滚轮增量；非滚轮事件为 `0`                                      |
| `key`                              | `string \| undefined` | 键盘按键                                                        |
| `shiftKey` / `ctrlKey` / `metaKey` | `boolean`             | 修饰键状态                                                      |
| `button`                           | `number \| undefined` | 指针按键：`0` 主键、`1` 中键、`2` 次键；触摸/键盘为 `undefined` |
| `originalEvent`                    | `DomEventLike`        | 原始 DOM 事件的最小结构（含可选 `preventDefault`）              |

事件流：

1. 事件源（`eventsTarget`，缺省为 `container`）上的 DOM 事件被归一化为层坐标。
2. 从 `sky` 到 `ground` 逐层做命中测试，取包含该点的最深层、绘制顺序最靠上的可拾取节点。
3. 从命中节点沿 `parent` 链向上冒泡，每层调用该节点上同类型监听器。
4. 键盘事件不命中节点，从最顶层场景根开始派发。

```ts
const card = new SceneNode({ x: 20, y: 20, width: 100, height: 50 })
layer.root.appendChild(card)

const off = card.on('pointerdown', (event) => {
  console.log('点击了卡片', event.x, event.y)
  event.originalEvent.preventDefault?.()
})

off()
```

::: warning
当前 `SceneEvent` 没有 `currentTarget`、`stopPropagation` 字段，冒泡会一直走到层根。若需要按节点分流，请在监听器内自行判断 `event.target` 或节点身份。事件类型集合也不包含 `click` / `dblclick`；需要点击语义时用 `pointerdown` + `pointerup` 组合判定。
:::

## 基础几何与绘制类型

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

export type RenderImageSource = RenderCanvas | CanvasImageSource

export interface RenderCanvas {
  width: number
  height: number
  getContext(contextId: '2d'): RenderContext | null
}
```

`RenderContext` 是引擎使用的 2D 上下文最小子集，真实 `CanvasRenderingContext2D` 天然满足。成员如下：

| 成员                                                 | 说明                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `fillStyle` / `strokeStyle` / `lineWidth` / `font`   | 绘制状态                                                                                          |
| `shadowColor` / `shadowBlur`                         | 可选；仅外框阴影路径使用                                                                          |
| `save()` / `restore()`                               | 状态栈                                                                                            |
| `setTransform(a, b, c, d, e, f)`                     | 设置变换                                                                                          |
| `translate(x, y)`                                    | 平移                                                                                              |
| `rotate?(rad)`                                       | 可选；真实上下文天然携带，最小桩实现可缺省                                                        |
| `beginPath()` / `rect(...)` / `clip()`               | 裁剪路径                                                                                          |
| `clearRect(...)` / `fillRect(...)` / `fillText(...)` | 绘制                                                                                              |
| `drawImage(...)`                                     | 三种重载：`(image, dx, dy)`、`(image, dx, dy, dw, dh)`、`(image, sx, sy, sw, sh, dx, dy, dw, dh)` |
| `measureText(text)`                                  | 返回 `{ width, actualBoundingBoxAscent?, actualBoundingBoxDescent? }`                             |

`RenderCanvas` 是所有层画布与测量画布的最小结构；`RenderImageSource` 是 `drawImage` 接受的位图源，可以是引擎画布或任意 `CanvasImageSource`。

## 离屏模式与测试注入

不传 `container` 即离屏模式：层 canvas 不挂载 DOM，`layer.canvasElement` 仍可取走位图做断言或上传；未提供 `eventsTarget` 时没有事件系统。

| 注入点          | 用途                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `createCanvas`  | 返回 `{ width, height, getContext('2d') }` 结构的假画布，供无 DOM 环境测试 |
| `scheduleFrame` | 替换帧调度；同步执行时传入 `(callback) => { callback(); return 0 }`        |
| `cancelFrame`   | 与 `scheduleFrame` 配套的取消函数                                          |
| `measureText`   | 返回固定 `Size`，消除字体环境差异                                          |

```ts
import { createRenderHost, SceneNode } from 'infinitable'

const host = createRenderHost({
  width: 200,
  height: 100,
  dpr: 1,
  scheduleFrame: (callback) => {
    callback()
    return 0
  },
  cancelFrame: () => {},
  measureText: (text) => ({ width: text.length * 6, height: 12 }),
})

const layer = host.createLayer({ kind: 'body' })
layer.root.appendChild(new SceneNode({ width: 200, height: 100 }))
layer.invalidate({ type: 'full' })

// layer.canvasElement 即离屏画布；同步帧调度下失效已在 invalidate 时消费
```

::: tip
`ListTable` 也接受注入的 `host`（`ListTableOptions.host`）。需要共享同一场景树或自管宿主生命周期时，先 `createRenderHost`，再把实例传给表格；此时表格 `destroy()` 不会销毁宿主。
:::

## DPR 与 resize

- **初始 DPR**：`options.dpr` 缺省取 `window.devicePixelRatio`；无 `window` 环境回落 `1`。层物理尺寸为 `round(cssWidth × dpr)`。
- **运行期跟随**：浏览器缩放、跨屏移动导致 DPR 变化时，宿主经 `window.resize` 与 `matchMedia('(resolution: Xdppx)')` 双通道感知，以新 dpr 重设全部已建层物理尺寸并触发整层重绘；滚动位置与场景内容不动，实例不重建。
- **显式 resize**：`host.resize(width, height, dpr?)` 保存新尺寸供后续建层使用，已建层逐个 `setSize` 并整层失效。显式传入 `dpr` 才更新宿主内部 dpr；不传则沿用当前值。
- **离屏/无 window**：不监听 DPR 变化，稳定使用传入值或 `1`。

```ts
const host = createRenderHost({
  width: 800,
  height: 600,
  container: document.querySelector<HTMLElement>('#stage')!,
  dpr: 2, // 需要锁定时显式给；缺省跟随环境
})

// 容器尺寸变化后原地调整
host.resize(1024, 768)
```

## 注意事项

::: warning
- 引擎是「失效驱动 + 场景树」模型，不是保留模式图形库：`paint` 在每次重绘帧调用，节点内不要持有跨帧可变绘制状态。
- 无可靠脏区时必须用 `{ type: 'full' }`，不要猜小块，否则会留下残影。
- `container` 未传即离屏模式；容器 `position: static` 会让绝对定位的 canvas 叠到容器之外，表现为空白。
- `SceneNode.paint` 的 `ctx` 已平移到本节点局部原点并按 dpr 缩放，直接用局部坐标绘制即可。
- `eventsTarget` 缺省取 `container`；离屏且未提供事件源时没有事件系统。
- `LayerHandle.translateBy` 是预留能力，当前 core 无调用方；滚动失效走 `band` 路线。
- `ListTable` 的 ground/sky 整层绘制预留位应经 `table.setUnderlayPainter` / `table.setOverlayPainter` 挂接，不直接操作宿主建层。
:::
