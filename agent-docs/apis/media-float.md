---
title: ImageService 图片与 FloatObjectLayer 浮动对象
description: infinitable 媒体能力：ImageService 窗口化图片加载（视口余量内发起/滚出取消、解码位图 LRU、无闪协议）、MediaCache cell 级位图缓存、resolveCellImage/CellChartMedia 按格媒体 hook，以及 FloatObjectLayer 浮动对象层（格上图片拖拽、8 缩放手柄 + 旋转、onTransformEnd 写回）。
aliases: [ImageService, 图片, 浮动对象, FloatObject, MediaCache, 媒体层]
keywords: [ImageService, imageServiceOptions, loadImage, onImageError, resolveCellImage, LoadedImage, MediaCache, maxCacheBytes, concurrency, FloatObjectLayer, floatObjects, onTransformEnd, onDragEnd, rotation, ImageFit, resolveCellChart, 图片加载, 浮动图片, 缩放, 旋转]
---

# ImageService 图片与 FloatObjectLayer 浮动对象

`infinitable`（core 层）导出媒体能力：`ImageService`（URL 级图片资源服务：窗口化加载 + 解码位图 LRU + 无闪协议）、`MediaCache`（cell 级位图 LRU）、按格媒体 hook（`resolveCellImage` 图片格、`CellChartMedia`/`resolveCellChart` 图表格位图路由）、media 层格节点（`ImageCellNode`/`ChartCellNode`）与 `FloatObjectLayer`（格上浮动图片/图表：选中、拖拽、8 缩放手柄 + 旋转手柄）。格内图片渲染在 L2 media 层（与 body 文本层分离）；浮动对象挂 sky 层最顶、随滚动帧级跟随。

## 快速上手

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 720,
  height: 320,
  columns: Array.from({ length: 6 }, (_, col) => ({ title: `列${col}`, width: 100 })),
  rowCount: 500,
  resolveDisplayValue: (col, row) => `m-${col}-${row}`,
  // 第 1 列偶数行为图片格（返回 URL 即图片渲染，null 走常规管线）
  resolveCellImage: (col, row) => (col === 1 && row % 2 === 0 ? `https://cdn.example.com/img/${row}.png` : null),
  hostOptions: { container },
})

let loaded = 0
table.imageService.onImageLoad(() => {
  loaded++
})
table.imageService.onImageError((event) => {
  console.error('图片加载失败', event.url, event.error)
})

// 浮动图片：锚 (2,1)~(4,3)，随滚动跟随
table.floatObjects.add({
  id: 'float-1',
  kind: 'image',
  anchor: { from: { col: 2, row: 1 }, to: { col: 4, row: 3 }, offsetX: 8, offsetY: 8 },
  src: 'https://cdn.example.com/float.png',
  title: '浮动图片',
})
```

## API 签名

```ts
/** 图片资源状态机：idle（未发起/已降级）→ loading → ready | error */
export type ImageState = 'idle' | 'loading' | 'ready' | 'error'

/** 加载完成的可用位图 */
export interface LoadedImage {
  source: RenderImageSource
  width: number
  height: number
}

/** 传输层：默认走 DOM Image，测试注入假加载器 */
export type ImageLoader = (
  url: string,
  crossOrigin: string | null | undefined,
) => Promise<LoadedImage>

export interface ImageServiceOptions {
  /** 解码位图 LRU 字节预算（默认 256MB） */
  maxCacheBytes?: number
  /** 解码位图条目上限（默认 1000） */
  maxCacheCount?: number
  /** 并发加载上限（默认 10） */
  concurrency?: number
  /** 占位延迟显示 ms（默认 80，防快速滚动占位闪烁） */
  placeholderDelay?: number
  crossOrigin?: string | null
  loadImage?: ImageLoader
  /** 位图字节估算（默认 宽×高×4） */
  estimateBytes?: (image: LoadedImage) => number
}

export interface ImageLoadEvent {
  url: string
  width: number
  height: number
  cells: CellRef[]
}
export interface ImageErrorEvent {
  url: string
  error: unknown
  cells: CellRef[]
}

export class ImageService {
  constructor(options?: ImageServiceOptions)
  /** 同步查询：URL 位图已就绪（无闪协议支撑） */
  hasResource(url: string): boolean
  getBitmap(url: string): LoadedImage | undefined
  request(url: string, cell: CellRef, onSettled?: (state: ImageState) => void): ImageState
  releaseRef(url: string, cell: CellRef): void
  /** 窗口化调度：划入窗口的请求提权，滚出的取消降级 */
  updateWindow(predicate: (cell: CellRef) => boolean): void
  invalidate(url: string): CellRef[]
  invalidateAll(): void
  onImageLoad(listener: (e: ImageLoadEvent) => void): () => void
  onImageError(listener: (e: ImageErrorEvent) => void): () => void
  configure(options: ImageServiceOptions): void
  dispose(): void
}

/** cell 级位图 LRU 缓存 */
export interface MediaCacheOptions {
  /** 位图字节总预算（默认 256MB） */
  maxBytes?: number
  /** 条目上限（默认 1000） */
  maxCount?: number
}

export class MediaCache<T = RenderImageSource> {
  constructor(options?: MediaCacheOptions)
  get size(): number
  get totalBytes(): number
  get(key: string): T | undefined
  put(key: string, value: T, bytes: number): void
  invalidateKey(key: string): void
  invalidateAll(): void
  configure(options: MediaCacheOptions): void
}

/** 按格图片 hook：返回 URL 的格按图片渲染，null/undefined 走常规管线 */
export type ResolveCellImage = (col: number, row: number) => string | null | undefined

/** 图片填充模式 */
export type ImageFit = 'fill' | 'contain'

/** 图表位图生产尺寸 */
export interface CellChartMediaSize {
  width: number
  height: number
  dpr: number
}

/** 格内图表媒体描述（L2 media 的 chart 预留位；图表语义全部在插件侧） */
export interface CellChartMedia {
  /** 内容 key：按图表声明内容生成（内容变更自然换 key）；core 叠加格尺寸与 DPR 成完整缓存 key */
  key: string
  /** 位图生产：未命中 cell 级缓存时调用；同 key 并发出图由 core 单飞收敛 */
  produce(size: CellChartMediaSize): Promise<LoadedImage> | LoadedImage
}

/** 按格图表 hook */
export type ResolveCellChart = (col: number, row: number) => CellChartMedia | null | undefined

export class ImageCellNode extends SceneNode { /* 图片格节点（media 层装配） */ }
export interface ImageCellNodeInit extends SceneNodeInit { /* col/row/url/fit */ }
export class ChartCellNode extends SceneNode { /* 图表格节点（位图 blit） */ }
export interface ChartCellNodeInit extends SceneNodeInit { /* col/row/media */ }

/** 浮动对象（对齐 ultra-ui SheetImage 的可映射子集） */
export interface FloatObject {
  id: string
  /** image 首批；chart/dom 预留（未加载内容时画占位） */
  kind: 'image' | 'chart' | 'dom'
  anchor: { from: CellRef; to: CellRef; offsetX: number; offsetY: number }
  /** 绝对像素尺寸；缺省时由 anchor.from → anchor.to 的格范围决定 */
  size?: { width: number; height: number }
  /** 旋转角（顺时针度数，缺省 0）：渲染绕对象中心旋转，命中沿逆变换路径 */
  rotation?: number
  fit?: ImageFit
  /** kind === 'image' 时的图片 URL（经 ImageService 加载） */
  src?: string
  alt?: string
  title?: string
}

/** 层坐标几何适配：由宿主表格提供（含表头偏移与滚动偏移） */
export interface FloatGeometry {
  cellOrigin(col: number, row: number): { x: number; y: number }
  cellSize(col: number, row: number): { width: number; height: number }
  /** 视口点 → 数据格；行列头带/空白返回 null（落点回弹）。缺省时拖拽抬起回弹 */
  cellAtPoint?(x: number, y: number): CellRef | null
}

export type FloatObjectChange =
  | { type: 'add'; object: FloatObject }
  | { type: 'remove'; id: string }
  | { type: 'update'; object: FloatObject }

/** 拖拽结束事件：落点换算出的新锚点，宿主写回模型 */
export interface FloatDragEndEvent {
  id: string
  anchor: FloatObject['anchor']
}

/** 变换手柄：8 缩放（四角 + 四边中点）+ 顶部 1 旋转 */
export type FloatTransformHandle =
  | 'left-top' | 'center-top' | 'right-top'
  | 'left-middle' | 'right-middle'
  | 'left-bottom' | 'center-bottom' | 'right-bottom'
  | 'rotate'

/** 变换结束事件：宿主写回模型（拖拽过程只改渲染态不提交） */
export interface FloatTransformEndEvent {
  id: string
  anchor: FloatObject['anchor']
  size: { width: number; height: number }
  /** 变换后旋转角（顺时针度数，归一化 0–360） */
  rotation: number
}

export class FloatObjectLayer {
  get size(): number
  add(object: FloatObject): void
  remove(id: string): void
  update(id: string, patch: Partial<Omit<FloatObject, 'id'>>): void
  get(id: string): FloatObject | undefined
  getAt(x: number, y: number): FloatObject | null
  getSelectedId(): string | null
  select(id: string): void
  clearSelection(): void
  beginDrag(id: string, x: number, y: number): boolean
  dragMove(x: number, y: number): void
  endDrag(): void
  onDragEnd(listener: (event: FloatDragEndEvent) => void): () => void
  handleAt(x: number, y: number): FloatTransformHandle | null
  beginTransform(handle: FloatTransformHandle, x: number, y: number): boolean
  transformMove(x: number, y: number, shiftKey: boolean): void
  endTransform(): void
  onTransformEnd(listener: (event: FloatTransformEndEvent) => void): () => void
  onChange(listener: (change: FloatObjectChange) => void): () => void
  isDragging(): boolean
  isTransforming(): boolean
  syncPositions(): void
  recalcGeometry(): void
  setBodyViewport(viewport: Region): void
  dispose(): void
}
```

## 参数说明

`ImageServiceOptions`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `maxCacheBytes` | `number` | `268435456`（256MB） | 否 | 解码位图 LRU 字节预算，超预算逐出最久未用且不在窗口内的条目 |
| `maxCacheCount` | `number` | `1000` | 否 | 条目上限 |
| `concurrency` | `number` | `10` | 否 | 并发加载上限 |
| `placeholderDelay` | `number` | `80` | 否 | 占位延迟显示毫秒数（防快速滚动闪烁） |
| `crossOrigin` | `string \| null` | — | 否 | 透传 DOM Image 的 crossOrigin |
| `loadImage` | `ImageLoader` | DOM Image | 否 | 传输层注入（data: URL、canvas 位图、测试桩） |
| `estimateBytes` | `(image) => number` | 宽×高×4 | 否 | 位图字节估算 |

`FloatObject`：

| 字段 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `id` | `string` | — | 是 | 层内唯一；重复 add 同 id 覆盖 |
| `kind` | 枚举 | — | 是 | `'image'` 加载 src 绘制；`'chart'`/`'dom'` 预留（画占位） |
| `anchor.from`/`anchor.to` | `CellRef` | — | 是 | 格区间锚定；`offsetX/offsetY` 为 from 格内像素偏移（负值 clamp 0） |
| `size` | `{width, height}` | 格范围推导 | 否 | 绝对像素尺寸；缺省由 from → to 的格范围决定 |
| `rotation` | `number` | `0` | 否 | 顺时针度数；渲染绕中心旋转、命中逆变换 |
| `fit` | `'fill' \| 'contain'` | — | 否 | 图片填充模式 |
| `src` | `string` | — | kind=image 时必填 | 经 ImageService 加载 |

`CellChartMedia.key`：按图表声明内容生成——内容变更换 key，core 叠加格尺寸与 DPR 组成完整缓存 key 定向失效重出图。

## 方法与事件

`ImageService`（`table.imageService`）：

- `request(url, cell, onSettled?): ImageState` — 登记格引用并按需发起加载；返回当前状态。`onSettled` 在状态迁移时回调一次。
- `releaseRef(url, cell)` — 释放格引用（窗口滚出时由引擎调，宿主自管媒体时手动调）。
- `updateWindow(predicate)` — 窗口化调度：predicate 判定格是否在「视口+余量」内；窗外请求取消降级、窗内提权。
- `hasResource(url)` / `getBitmap(url)` — 同步查询；`hasResource` 为 true 时场景重建首帧直接 blit（无闪协议）。
- `invalidate(url): CellRef[]` — 作废位图并返回受影响格（引擎据此定向失效）。
- `onImageLoad`/`onImageError` — 事件订阅（error 态必触发，消灭「永远 loading」）；载荷含引用该 URL 的格列表 `cells`。
- `configure(options)` — 运行时改 LRU/并发参数。

`MediaCache`：`get` 命中提升为最近使用；`put(key, value, bytes)` 超预算 LRU 淘汰；`configure` 运行时改预算。

`FloatObjectLayer`（`table.floatObjects`）：

- `add/remove/update/get/getAt/size` — 对象集合管理；`update(id, patch)` 局部字段更新。
- `select(id)`/`clearSelection()`/`getSelectedId()` — 选中态（2px 选中环 + 手柄）。
- `beginDrag(id, x, y)` → `dragMove(x, y)` → `endDrag()` — 拖拽会话（位移超阈值才成拖拽）；结束抛 `onDragEnd`（落点换算新锚点，宿主写回模型）。
- `handleAt(x, y)` — 命中变换手柄（选中态下）。
- `beginTransform(handle, x, y)` → `transformMove(x, y, shiftKey)` → `endTransform()` — 缩放/旋转会话：拖拽过程只改渲染态；`shiftKey` 等比缩放 / 旋转 15° 吸附；结束抛 `onTransformEnd`（`{ id, anchor, size, rotation }`）。
- `onChange` — 集合变更事件（add/remove/update）。
- `syncPositions()` — 滚动帧级跟随（引擎接线，宿主无需调用）；`recalcGeometry()` — 行列尺寸变化后重算锚定几何。

`ListTable` 上：`resolveCellImage` 按格图片、`table.floatObjects` getter 惰性建层；图片/图表格的窗口化调度与滚动失效由引擎自动接线。

## 典型示例

### 注入自定义图片加载器（data URL）

```ts
import { ListTable, type LoadedImage } from 'infinitable'

async function loadImage(url: string): Promise<LoadedImage> {
  if (!url.startsWith('data:')) {
    throw new Error(`仅支持 data URL：${url}`)
  }
  const image = new Image()
  await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true })
    image.addEventListener('error', () => reject(new Error(`图片加载失败：${url}`)), { once: true })
    image.src = url
  })
  return { source: image, width: image.naturalWidth, height: image.naturalHeight }
}

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ title: '缩略图', width: 120 }, { title: '名称', width: 160 }],
  rowCount: 200,
  resolveDisplayValue: (_col, row) => `名称-${row}`,
  resolveCellImage: (col, row) => (col === 0 ? `data:image/png;base64,<占位 base64>-${row}` : null),
  imageServiceOptions: { loadImage, maxCacheCount: 200, concurrency: 4 },
  hostOptions: { container },
})
```

### 浮动对象缩放/旋转写回模型

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 720,
  height: 320,
  columns: Array.from({ length: 6 }, (_, col) => ({ title: `列${col}`, width: 100 })),
  rowCount: 100,
  resolveDisplayValue: (col, row) => `m-${col}-${row}`,
  hostOptions: { container },
})

table.floatObjects.add({
  id: 'transform-demo',
  kind: 'image',
  anchor: { from: { col: 0, row: 6 }, to: { col: 1, row: 7 }, offsetX: 16, offsetY: 16 },
  size: { width: 180, height: 120 },
  rotation: 45,
  src: 'https://cdn.example.com/photo.png',
})

// 用户点选对象 → 拖角/边手柄缩放（Shift 等比）、拖顶部手柄旋转（Shift 吸附 15°）
table.floatObjects.onTransformEnd((event) => {
  console.log(event.id, event.size, event.rotation)
  // => 'transform-demo' { width: 220, height: 147 } 45（变换结束才提交，写回宿主模型）
  const object = table.floatObjects.get(event.id)
  if (object) {
    table.floatObjects.update(event.id, {
      anchor: event.anchor,
      size: event.size,
      rotation: event.rotation,
    })
  }
})
```

### 独立使用 MediaCache

```ts
import { MediaCache } from 'infinitable'

const cache = new MediaCache<{ source: CanvasImageSource; width: number; height: number }>({
  maxBytes: 50 * 1024 * 1024, // 50MB
  maxCount: 100,
})
cache.put('chart:1:2:2', { source: document.createElement('canvas'), width: 150, height: 84 }, 150 * 84 * 4)
console.log(cache.size) // => 1
console.log(cache.get('chart:1:2:2')?.width) // => 150（命中并提升为最近使用）
cache.configure({ maxCount: 10 }) // 运行时收紧预算
```

## 注意事项

> [!WARNING]
> - 图片格渲染在 L2 media 层（首个图片/图表格出现时惰性创建），不在 body 文本层；两种渲染不能叠加在同一格——`resolveCellImage` 返回 URL 即整格按图片渲染。
> - `CellChartMedia` 的图表语义（类型/数据/库）全部在插件侧：core 只认内容 key 与位图生产者。使用方接图表格用 chart 插件（`createChartPlugin`，见 `apis/chart-watermark-plugin.md`），不要自行实现 `resolveCellChart` 除非自建出图管线。
> - 浮动对象拖拽/变换过程只改渲染态，结束才抛事件——宿主必须在 `onDragEnd`/`onTransformEnd` 里写回模型，否则下一次滚动跟随回到旧锚点。
> - `FloatObject.rotation` 单位是顺时针度数（不是弧度），归一化 0–360。
> - `MediaCache.put` 的 `bytes` 由调用方给出（图表位图按 宽×高×4 估算与 ImageService 同口径）。
> - `ImageService.dispose` 由 `table.destroy()` 统一调用；宿主自建 ImageService 实例时自行管理生命周期。

## 常见问题

### 图片滚回视口时闪一下（先空白后出图）

原因：位图被 LRU 逐出后滚回需重新加载。修复：按场景调大 `imageServiceOptions.maxCacheBytes`/`maxCacheCount`；`hasResource` 为 true 时引擎首帧直贴不闪。

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ title: '图', width: 120 }],
  rowCount: 500,
  resolveCellImage: (_col, row) => `https://cdn.example.com/img/${row}.png`,
  imageServiceOptions: { maxCacheBytes: 512 * 1024 * 1024, maxCacheCount: 2000 },
  hostOptions: { container },
})
```

### 浮动图片拖到新位置松手后又弹回原位

原因：拖拽过程只改渲染态，`onDragEnd` 未写回。修复：订阅事件写回。

```ts
import type { ListTable } from 'infinitable'

declare const table: ListTable
table.floatObjects.onDragEnd((event) => {
  const object = table.floatObjects.get(event.id)
  if (object) {
    table.floatObjects.update(event.id, { anchor: event.anchor }) // 写回新锚点
  }
})
```
