---
title: region-interaction 区域交互几何
description: infinitable 格区间区域交互几何（自 grid 内核导出）：ResizeEdge 8 方向词汇与 cursorForEdge 方向光标、floatHandleEdge 浮层缩放手柄换算、regionBoundsOf 视口包围盒、regionHandleRect/hitRegionHandle 右下角手柄、hitRegionEdge 边缘热区命中、resizeRegionRect 拖拽落点合入。纯函数不碰 DOM，宿主画布负责指针事件与提交、宿主 overlay 负责绘制。
aliases: [region interaction, 数据块交互, 区域拖拽, resize 手柄, 边缘热区]
keywords: [ResizeEdge, cursorForEdge, floatHandleEdge, regionBoundsOf, regionHandleRect, hitRegionHandle, hitRegionEdge, resizeRegionRect, REGION_HANDLE_SIZE, REGION_HANDLE_SIZE_ACTIVE, REGION_HANDLE_INSET, REGION_EDGE_HIT_PX, RegionRect, RegionHitTarget, CellRectSource, 区域交互, 手柄命中, 边缘拖拽, 热区, 光标, 数据块]
---

# region-interaction 区域交互几何

`infinitable`（grid 层）导出格区间区域（region：`CellRange` 闭区间矩形）的画布交互几何：视口包围盒换算、右下角手柄命中、边缘/角落拖拽命中与落点应用，以及 8 方向 `ResizeEdge` 词汇、`cursorForEdge` 方向光标与 `floatHandleEdge` 浮层缩放手柄换算。全部为纯函数（不碰 DOM、不依赖引擎实例），命中口径与拖拽应用口径可脱离画布做单元测试；方向语义与 `FloatObjectLayer` 的变换手柄共用同一份单源（grid `interaction/resize-geometry`）。

## 快速上手

```ts
import {
  hitRegionEdge,
  hitRegionHandle,
  regionBoundsOf,
  type CellRectSource,
  type RegionHitTarget,
} from 'infinitable'

// 模型区域列表（CellRange，闭区间 start ≤ end）
const regions = [
  { startRow: 0, endRow: 3, startCol: 0, endCol: 5 },
  { startRow: 6, endRow: 9, startCol: 2, endCol: 4 },
]

// table 为宿主引擎的取格矩形面（getCellRelativeRect 返回视口坐标；null = 该格不可见）
const table: CellRectSource = grid.getTable()

// 每帧现算 targets（包围盒跟随滚动/尺寸变化，不缓存）；任一角格不可见则该区域不参与命中
const targets: RegionHitTarget[] = []
for (let index = 0; index < regions.length; index++) {
  const bounds = regionBoundsOf(table, regions[index]!)
  if (bounds) targets.push({ index, bounds })
}

// pointermove / pointerdown：先手柄后边缘（同一坐标两档判定，命中档决定交互模式）
const x = 132 // 指针在画布内的像素坐标（event.clientX - hostLeft 等换算，宿主自理）
const y = 47
const handle = hitRegionHandle(targets, x, y) // 命中返回区域下标；未命中 undefined
const edge = handle === undefined ? hitRegionEdge(targets, x, y) : undefined
```

## API 签名

```ts
/** 8 方向边/角：四边 + 四角 */
type ResizeEdge =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

/** 视口矩形（与 getCellRelativeRect 同一坐标系：画布相对像素） */
interface RegionRect { x: number; y: number; width: number; height: number }

/** 命中判定输入：区域下标 + 视口包围盒（数组顺序即层序：后画的在上） */
interface RegionHitTarget { index: number; bounds: RegionRect }

/** 网格引擎的最小依赖面：给 col/row 取视口矩形；返回 null 表示该格不可见 */
interface CellRectSource { getCellRelativeRect(col: number, row: number): RegionRect | null }

/** 边/角 → 鼠标指针样式 */
function cursorForEdge(edge: ResizeEdge): string

/** 浮层 8 缩放手柄名 → 8 方向边（旋转手柄 'rotate' 不在映射域） */
function floatHandleEdge(handle: Exclude<FloatTransformHandle, 'rotate'>): ResizeEdge

/** 区域的视口包围盒：四角格取并集；任一角不可见返回 null */
function regionBoundsOf(table: CellRectSource, region: CellRange): RegionRect | null

/** 手柄矩形：右下角单元格内角的小方块（右/下各内缩 REGION_HANDLE_INSET） */
function regionHandleRect(bounds: RegionRect, size?: number): RegionRect

/** 指针是否落在手柄上：返回区域下标（后画的区域优先），未命中返回 undefined */
function hitRegionHandle(targets: readonly RegionHitTarget[], x: number, y: number): number | undefined

/** 指针落在边缘热区上：先角后边（角是两边交集、优先级更高）；未命中返回 undefined */
function hitRegionEdge(
  targets: readonly RegionHitTarget[],
  x: number,
  y: number,
): { index: number; edge: ResizeEdge } | undefined

/** 拖拽落点应用：按边把指针下格子地址合入区域矩形，返回字段补丁（start ≤ end 恒成立） */
function resizeRegionRect(
  rect: CellRange,
  edge: ResizeEdge,
  addr: { row: number; col: number },
): Partial<CellRange>

/** 手柄边长（px），默认 10 */
const REGION_HANDLE_SIZE: 10
/** 手柄悬停时的放大边长（px），12 */
const REGION_HANDLE_SIZE_ACTIVE: 12
/** 手柄与区域右/下边缘的内缩（px），3 */
const REGION_HANDLE_INSET: 3
/** 边缘拖拽命中热区（px），6 */
const REGION_EDGE_HIT_PX: 6
```

`CellRange` 为合并区同款闭区间模型矩形（`{ startRow, endRow, startCol, endCol }`，归一化后 start ≤ end），从主入口与 `@infinitable/grid` 包公共面均可导入。`FloatTransformHandle` 为浮动对象变换手柄名（`'left-top'` / `'center-top'` / `'right-top'` / `'left-middle'` / `'right-middle'` / `'left-bottom'` / `'center-bottom'` / `'right-bottom'` / `'rotate'`）。

## 参数说明

| 参数 | 类型 | 默认值 | 必填 | 约束 |
| --- | --- | --- | --- | --- |
| `cursorForEdge` 的 `edge` | `ResizeEdge` | — | 是 | 8 枚举值之外无其它取值 |
| `cursorForEdge` 返回 | `string` | — | — | 角：同号对角 `'nwse-resize'`、异号对角 `'nesw-resize'`；边：`'ew-resize'`（left/right）、`'ns-resize'`（top/bottom） |
| `floatHandleEdge` 的 `handle` | `Exclude<FloatTransformHandle, 'rotate'>` | — | 是 | 传入 `'rotate'` 是类型错误；映射为 `'left-top'→'top-left'`、`'center-top'→'top'` 等 8 项（由轴向符号推导） |
| `regionBoundsOf` 的 `table` | `CellRectSource` | — | 是 | 引擎 `getTable()` 结构子类型；`getCellRelativeRect` 返回 null 时该角视为不可见 |
| `regionHandleRect` 的 `size` | `number` | `REGION_HANDLE_SIZE` | 否 | 悬停强调传 `REGION_HANDLE_SIZE_ACTIVE`（放大向内扩、不越出区域） |
| `hitRegionHandle` 的 `targets` | `readonly RegionHitTarget[]` | — | 是 | 数组顺序即层序：同点命中多个区域时返回**最后一个**（后画的在上层） |
| `hitRegionEdge` 的热区 | — | `REGION_EDGE_HIT_PX`（6px） | — | 判定条件：指针贴某边（≤6px）且另一轴落在区域范围（含 6px 余量）内 |
| `resizeRegionRect` 的 `addr` | `{ row: number; col: number }` | — | 是 | 指针落点格地址（引擎 hitTest 结果）；反向拖过头夹回单行/单列 |

## 典型示例

**示例 1：pointerdown 手柄点击与边缘拖拽开启（捕获阶段拦截，不触发引擎选区）**

```ts
import {
  cursorForEdge,
  hitRegionEdge,
  hitRegionHandle,
  regionBoundsOf,
  type CellRectSource,
  type RegionHitTarget,
  type ResizeEdge,
} from 'infinitable'

// 宿主侧上下文：host 为画布容器 DOM、grid 为引擎适配实例、model 持有区域列表
const table: CellRectSource = grid.getTable()
const buildTargets = (): RegionHitTarget[] => {
  const targets: RegionHitTarget[] = []
  model.regions.forEach((region, index) => {
    const bounds = regionBoundsOf(table, region)
    if (bounds) targets.push({ index, bounds })
  })
  return targets
}
let dragSession: { index: number; edge: ResizeEdge } | undefined

host.addEventListener(
  'pointerdown',
  (event) => {
    if (event.button !== 0) return
    const rect = host.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const targets = buildTargets()

    const handleIndex = hitRegionHandle(targets, x, y)
    if (handleIndex !== undefined) {
      event.stopPropagation() // 手柄点击不落入单元格选区
      openRegionPanel(handleIndex)
      return
    }
    const edge = hitRegionEdge(targets, x, y)
    if (edge) {
      event.stopPropagation()
      host.setPointerCapture(event.pointerId)
      host.style.cursor = cursorForEdge(edge.edge) // => 'nwse-resize'（拖 top-left 角时）
      dragSession = { index: edge.index, edge: edge.edge }
    }
  },
  true, // 捕获阶段先于引擎处理
)
```

**示例 2：拖拽跟随预览与松开提交（resizeRegionRect 的补丁口径）**

```ts
import { resizeRegionRect } from 'infinitable'

// dragSession 为示例 1 建立的会话；addr 为当前指针落点格（引擎 hitTest 结果）
let lastAddr: { row: number; col: number } = { row: 0, col: 0 }

const onPointerMove = (addr: { row: number; col: number }) => {
  if (!dragSession) return
  lastAddr = addr
  const region = model.regions[dragSession.index]!
  const patch = resizeRegionRect(region, dragSession.edge, addr)
  dragPreview = { ...region, ...patch } // 画虚线预览；补丁只含被拖动边的字段
  // 拖 top 越过 endRow 时 patch.startRow === region.endRow（夹回单行，start ≤ end 恒成立）
}

const onPointerUp = () => {
  const session = dragSession
  if (!session) return
  dragSession = undefined
  const region = model.regions[session.index]!
  const patch = resizeRegionRect(region, session.edge, lastAddr)
  if (Object.keys(patch).length > 0) model.updateRegion(session.index, patch)
}
```

**示例 3：自绘浮层缩放手柄的光标（floatHandleEdge + cursorForEdge 单源推导）**

```ts
import { cursorForEdge, floatHandleEdge, type FloatTransformHandle } from 'infinitable'

// 宿主自绘浮动对象的手柄高亮层时，手柄光标与引擎指针路由同一口径：
const handleCursor = (handle: FloatTransformHandle): string =>
  handle === 'rotate' ? 'grab' : cursorForEdge(floatHandleEdge(handle))

handleCursor('left-top') // => 'nwse-resize'
handleCursor('right-middle') // => 'ew-resize'
handleCursor('rotate') // => 'grab'
```

## 注意事项

> [!WARNING]
> - 手柄整体落在区域右下角单元格**内部**（右/下各内缩 3px），命中与绘制必须共用 `regionHandleRect` 的同一几何——这是与「骑在角点上」的选区填充柄（引擎内置）形态与位置上的有意区分，两套手柄不重叠。
> - `RegionRect` 是画布相对像素坐标（与 `getCellRelativeRect` 同一坐标系），不是文档/模型坐标；`CellRange` 才是模型格坐标。两个坐标系不得混用。
> - 本组函数不做任何指针事件接线与模型写入：事件捕获/提交/撤销由宿主持有；`resizeRegionRect` 返回的补丁是否合法（如与其它区域重叠）由宿主模型层守卫。
> - `hitRegionHandle`/`hitRegionEdge` 遍历顺序为层数组倒序（后画的优先）；targets 数组顺序必须与绘制层序一致，否则命中的是错误区域。
