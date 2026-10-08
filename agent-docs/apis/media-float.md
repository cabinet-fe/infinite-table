---
title: 图片格与浮动对象（media 层）
description: infinitable 媒体能力：resolveCellImage 按格图片（L2 media 层窗口化加载 + 位图 LRU 无闪协议，imageServiceOptions 配预算/并发/加载器注入，table.imageService 实例订阅 onImageLoad/onImageError）、CellChartMedia 图表格媒体描述（chart 插件出图路由）与 table.floatObjects 浮动对象层（格上图片拖拽、8 缩放手柄 + 旋转、onTransformEnd 写回）。导出类型 LoadedImage/FloatObject/FloatTransformEndEvent。
aliases: [图片, 浮动对象, FloatObject, ImageService, MediaCache, FloatObjectLayer, 媒体层]
keywords: [resolveCellImage, imageServiceOptions, table.imageService, onImageLoad, onImageError, loadImage, LoadedImage, maxCacheBytes, concurrency, placeholderDelay, CellChartMedia, floatObjects, onTransformEnd, onDragEnd, rotation, 图片加载, 浮动图片, 缩放, 旋转, 图表格]
---

# 图片格与浮动对象（media 层）

`infinitable`（core 层）导出媒体类型 `LoadedImage`（加载完成的位图）、`CellChartMedia`（图表格媒体描述：内容 key + 位图生产者）、`FloatObject`（浮动对象）与 `FloatTransformEndEvent`/`FloatTransformHandle`。媒体服务实例面挂在 `ListTable` 上：`table.imageService`（图片资源服务：窗口化加载 + 解码位图 LRU + 无闪协议，供宿主配置与订阅事件）与 `table.floatObjects`（浮动对象层：格上图片/图表的选中、拖拽、8 缩放手柄 + 旋转手柄）。图片加载服务与位图缓存类（原 `ImageService`/`MediaCache`/`FloatObjectLayer`，0.1.2 起不再导出）经实例面消费；格内图片/图表渲染在 L2 media 层（与 body 文本层分离），浮动对象挂 sky 层最顶、随滚动帧级跟随。

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
/** 加载完成的可用位图 */
export interface LoadedImage {
  source: RenderImageSource
  width: number
  height: number
}

/** 按格图片 hook（ListTableOptions.resolveCellImage，未导出为独立类型）：
 *  返回 URL 的格按图片渲染，null/undefined 走常规管线 */

/** 格内图表媒体描述（L2 media 的 chart 预留位；图表语义全部在 chart 插件侧） */
export interface CellChartMedia {
  /** 内容 key：按图表声明内容生成（内容变更自然换 key）；core 叠加格尺寸与 DPR 成完整缓存 key */
  key: string
  /** 位图生产：未命中 cell 级缓存时调用（size 形态 `{ width, height, dpr }`，未导出为独立类型）；
   *  同 key 并发出图由 core 单飞收敛 */
  produce(size: { width: number; height: number; dpr: number }): Promise<LoadedImage> | LoadedImage
}

/** 浮动对象（对齐 ultra-ui SheetImage 的可映射子集） */
export interface FloatObject {
  id: string
  /** image 首批；chart/dom 预留（未加载内容时画占位） */
  kind: 'image' | 'chart' | 'dom'
  anchor: {
    from: { col: number; row: number } // 格坐标（0 基；统一入口类型名 GridCellRef）
    to: { col: number; row: number }
    offsetX: number
    offsetY: number
  }
  /** 绝对像素尺寸；缺省时由 anchor.from → anchor.to 的格范围决定 */
  size?: { width: number; height: number }
  /** 旋转角（顺时针度数，缺省 0）：渲染绕对象中心旋转，命中沿逆变换路径 */
  rotation?: number
  /** 图片填充模式：'fill' | 'contain'（内嵌字段，未导出为独立类型） */
  fit?: 'fill' | 'contain'
  /** kind === 'image' 时的图片 URL（经 table.imageService 加载） */
  src?: string
  alt?: string
  title?: string
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
```

`ListTableOptions.imageServiceOptions`（图片服务配置，类型未导出，字段内嵌）：

```ts
interface ImageServiceOptions {
  /** 解码位图 LRU 字节预算（默认 256MB） */
  maxCacheBytes?: number
  /** 解码位图条目上限（默认 1000） */
  maxCacheCount?: number
  /** 并发加载上限（默认 10） */
  concurrency?: number
  /** 占位延迟显示 ms（默认 80，防快速滚动占位闪烁） */
  placeholderDelay?: number
  crossOrigin?: string | null
  /** 传输层注入：默认走 DOM Image（data URL、canvas 位图、测试桩） */
  loadImage?: (url: string, crossOrigin: string | null | undefined) => Promise<LoadedImage>
  /** 位图字节估算（默认 宽×高×4） */
  estimateBytes?: (image: LoadedImage) => number
}
```

## 参数说明

`imageServiceOptions`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `maxCacheBytes` | `number` | `268435456`（256MB） | 否 | 解码位图 LRU 字节预算，超预算逐出最久未用且不在窗口内的条目 |
| `maxCacheCount` | `number` | `1000` | 否 | 条目上限 |
| `concurrency` | `number` | `10` | 否 | 并发加载上限 |
| `placeholderDelay` | `number` | `80` | 否 | 占位延迟显示毫秒数（防快速滚动闪烁） |
| `crossOrigin` | `string \| null` | — | 否 | 透传 DOM Image 的 crossOrigin |
| `loadImage` | `(url, crossOrigin) => Promise<LoadedImage>` | DOM Image | 否 | 传输层注入（data URL、canvas 位图、测试桩） |
| `estimateBytes` | `(image) => number` | 宽×高×4 | 否 | 位图字节估算 |

`FloatObject`：

| 字段 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `id` | `string` | — | 是 | 层内唯一；重复 add 同 id 覆盖 |
| `kind` | 枚举 | — | 是 | `'image'` 加载 src 绘制；`'chart'`/`'dom'` 预留（画占位） |
| `anchor.from`/`anchor.to` | `{ col, row }`（格坐标） | — | 是 | 格区间锚定；`offsetX/offsetY` 为 from 格内像素偏移（负值 clamp 0） |
| `size` | `{width, height}` | 格范围推导 | 否 | 绝对像素尺寸；缺省由 from → to 的格范围决定 |
| `rotation` | `number` | `0` | 否 | 顺时针度数；渲染绕中心旋转、命中逆变换 |
| `fit` | `'fill' \| 'contain'` | — | 否 | 图片填充模式 |
| `src` | `string` | — | kind=image 时必填 | 经 `table.imageService` 加载 |

`CellChartMedia.key`：按图表声明内容生成——内容变更换 key，core 叠加格尺寸与 DPR 组成完整缓存 key 定向失效重出图。

## 方法与事件

`table.imageService`（图片资源服务实例；状态机 idle（未发起/已降级）→ loading → ready | error）：

- `request(url, cell, onSettled?)` — 登记格引用并按需发起加载，返回当前状态；`onSettled` 在状态迁移时回调一次。
- `releaseRef(url, cell)` — 释放格引用（窗口滚出时由引擎调，宿主自管媒体时手动调）。
- `updateWindow(predicate)` — 窗口化调度：predicate 判定格是否在「视口+余量」内；窗外请求取消降级、窗内提权。
- `hasResource(url)` / `getBitmap(url)` — 同步查询；`hasResource` 为 true 时场景重建首帧直接 blit（无闪协议）。
- `invalidate(url)` — 作废位图并返回受影响格坐标列表（引擎据此定向失效）。
- `onImageLoad` — 载荷 `{ url, width, height, cells }`（引用该 URL 的格列表，载荷类型未导出）。
- `onImageError` — 载荷 `{ url, error, cells }`（error 态必触发，消灭「永远 loading」）。
- `configure(options)` — 运行时改 LRU/并发参数；`dispose` 由 `table.destroy()` 统一调用。

`table.floatObjects`（浮动对象层实例）：

- `add/remove/update/get/getAt/size` — 对象集合管理；`update(id, patch)` 局部字段更新。
- `select(id)`/`clearSelection()`/`getSelectedId()` — 选中态（2px 选中环 + 手柄）。
- `beginDrag(id, x, y)` → `dragMove(x, y)` → `endDrag()` — 拖拽会话（位移超阈值才成拖拽）；结束抛 `onDragEnd`（载荷 `{ id, anchor }`，落点换算新锚点，宿主写回模型；载荷类型未导出）。
- `handleAt(x, y)` — 命中变换手柄（选中态下）。
- `beginTransform(handle, x, y)` → `transformMove(x, y, shiftKey)` → `endTransform()` — 缩放/旋转会话：拖拽过程只改渲染态；`shiftKey` 等比缩放 / 旋转 15° 吸附；结束抛 `onTransformEnd`（`FloatTransformEndEvent`）。
- `onChange` — 集合变更事件（add/remove/update；载荷类型未导出）。
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

### 拖拽结束写回锚点

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

## 注意事项

> [!WARNING]
> - 图片格渲染在 L2 media 层（首个图片/图表格出现时惰性创建），不在 body 文本层；两种渲染不能叠加在同一格——`resolveCellImage` 返回 URL 即整格按图片渲染。
> - `CellChartMedia` 的图表语义（类型/数据/库）全部在插件侧：core 只认内容 key 与位图生产者。使用方接图表格用 chart 插件（`createChartPlugin`，见 `apis/chart-watermark-plugin.md`），不要自行实现图表媒体解析器除非自建出图管线。
> - 浮动对象拖拽/变换过程只改渲染态，结束才抛事件——宿主必须在 `onDragEnd`/`onTransformEnd` 里写回模型，否则下一次滚动跟随回到旧锚点。
> - `FloatObject.rotation` 单位是顺时针度数（不是弧度），归一化 0–360。
> - 图片加载服务、位图缓存与浮动对象层类（原 `ImageService`/`MediaCache`/`FloatObjectLayer`，0.1.2 起不再导出）只经 `table.imageService`/`table.floatObjects` 实例面消费，不支持脱离 `ListTable` 独立实例化。

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
