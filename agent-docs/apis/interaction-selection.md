---
title: SelectionState 选区与交互原语
description: infinitable 选区状态机 SelectionState/SelectionSnapshot、交互浮层 InteractionOverlay、填充柄几何与事件（fillHandleRect/hitFillHandle/onFillDragEnd）、行列 resize（hitResizeHandle/ResizeSession）、触控惯性滚动（InertiaScroller/TouchScrollTracker）与键盘导航纯函数（nextActiveCell/revealAxis）。
aliases: [Selection, 选区, 填充柄, FillHandle, 惯性滚动, Resize, 键盘导航]
keywords: [SelectionState, normalizeRange, SelectionSnapshot, RangeBounds, selectCells, applyExternalSelection, HighlightRange, FILL_HANDLE_SIZE, hitFillHandle, onFillDragEnd, onFillHandleDoubleClick, hitResizeHandle, onColResizeEnd, onRowResizeEnd, InertiaScroller, nextActiveCell, ctrlMultiSelect, 选区, 填充柄, 拖拽]
---

# SelectionState 选区与交互原语

`infinitable`（core 层）导出选区状态机 `SelectionState` 与交互原语：填充柄几何/命中、行列 resize 手柄命中/会话、触控惯性滚动、键盘导航纯函数。`ListTable` 已内置接线——指针拖选、Ctrl/Cmd 加选（`ctrlMultiSelect`）、表头拖选、填充柄按下/拖拽/双击事件、行列 resize、触控惯性、方向键/Tab 导航；宿主直接消费 `table.selection` 快照与 `on*` 事件即可，本篇 API 用于独立组装或扩展交互。

## 快速上手

```ts
import { ListTable, normalizeRange } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ field: 'a', title: 'A' }, { field: 'b', title: 'B' }],
  records: Array.from({ length: 100 }, (_, i) => ({ a: i, b: i * 2 })),
  ctrlMultiSelect: true, // Ctrl/Cmd 点选追加选区段
  hostOptions: { container },
})

table.onSelectionChange((snapshot) => {
  const first = snapshot.ranges[0]
  if (first) {
    const bounds = normalizeRange(first) // start/end 可反向，读边界先归一化
    console.log(bounds.minCol, bounds.minRow, bounds.maxCol, bounds.maxRow)
  }
})

// 程序化多段选中：整组替换，焦点落末段 end
table.selectCells([
  { start: { col: 0, row: 0 }, end: { col: 1, row: 2 } },
  { start: { col: 0, row: 10 }, end: { col: 0, row: 12 } },
])
// => 选区快照含 2 段，sky 浮层同帧绘制全部段
```

## API 签名

```ts
/** 选区段：start 为锚点，end 为焦点侧（可反向，读取边界用 normalizeRange） */
export interface SelectionRange {
  start: CellRef
  end: CellRef
}

/** 归一化后的选区边界（min/max 序） */
export interface RangeBounds {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

export interface SelectionSnapshot {
  readonly ranges: readonly SelectionRange[]
  /** 焦点格（键盘导航的活动格）；无选区时为 null */
  readonly focus: CellRef | null
}

/** 外部回写坐标的钳制边界 */
export interface SelectionBounds {
  colCount: number
  rowCount: number
}

export type SelectionListener = (snapshot: SelectionSnapshot) => void

/** 求选区段的 min/max 边界 */
export function normalizeRange(range: SelectionRange): RangeBounds

export class SelectionState {
  get snapshot(): SelectionSnapshot
  onChange(listener: SelectionListener): () => void
  selectCell(col: number, row: number, extend?: boolean): void
  selectCells(ranges: readonly SelectionRange[]): void
  addRange(range: SelectionRange): void
  beginDrag(col: number, row: number): void
  beginDragRange(start: CellRef, end: CellRef, focus?: CellRef): void
  updateDrag(col: number, row: number): void
  updateDragRange(start: CellRef, end: CellRef): void
  endDrag(): void
  selectRow(row: number, colCount: number): void
  selectCol(col: number, rowCount: number): void
  selectAll(colCount: number, rowCount: number, focus?: CellRef): void
  clear(): void
  applyExternal(snapshot: SelectionSnapshot, bounds?: SelectionBounds): void
}

/** 填充柄方点边长（px） */
export const FILL_HANDLE_SIZE = 8

/** 焦点段：包含焦点格的选区段（填充柄挂在它的右下角）；焦点不在任何段内时取末段 */
export function resolveFocusRange(snapshot: SelectionSnapshot): SelectionRange | null

/** 填充柄方点矩形：骑在锚定段右下角格的右下角点上，向格内格外各伸一半边长 */
export function fillHandleRect(cellRect: Region): Region

/** 填充柄命中判定 */
export function hitFillHandle(x: number, y: number, cellRect: Region): boolean

export interface FillHandleDownEvent {
  range: SelectionRange
}
export interface FillDragEndEvent {
  /** 柄所在选区段的归一化边界 */
  anchor: RangeBounds
  /** 拖拽目标格范围（min/max 序） */
  target: RangeBounds
}
export interface FillHandleDoubleClickEvent {
  range: SelectionRange
}
export type FillHandleDownListener = (event: FillHandleDownEvent) => void
export type FillDragEndListener = (event: FillDragEndEvent) => void
export type FillHandleDoubleClickListener = (event: FillHandleDoubleClickEvent) => void

/** resize 几何快照（视口→内容坐标换算含冻结区与滚动，由调用方注入） */
export interface ResizeGeometry {
  readonly colOffsets: readonly number[]
  readonly rowOffsets: readonly number[]
  readonly rowHeaderWidth: number
  readonly headerHeight: number
  toContentX(x: number): number
  toContentY(y: number): number
}

export type ResizeTarget = { readonly kind: 'col'; readonly index: number } | { readonly kind: 'row'; readonly index: number }
export interface ColResizeEndEvent {
  col: number
  width: number
}
export interface RowResizeEndEvent {
  row: number
  height: number
}
export interface ResizeCapability {
  canResizeCol?(col: number): boolean
  canResizeRow?(row: number): boolean
}

/** 命中 resize 手柄：列手柄在列头区的列右缘，行手柄在行号列区的行下缘 */
export function hitResizeHandle(
  x: number,
  y: number,
  geo: ResizeGeometry,
  capability?: ResizeCapability,
  threshold?: number,
): ResizeTarget | null

/** 一次拖拽 resize 会话：记录起始尺寸，按指针位移给出夹取后的目标尺寸 */
export class ResizeSession {
  constructor(target: ResizeTarget, startSize: number, startPointer: number)
  sizeAt(pointer: number): number
}

/** 触控滚动采样 */
export class TouchScrollTracker {
  /* 逐 touchmove 采样，产出速度估计 */
}
/** 惯性滚动器 */
export class InertiaScroller {
  constructor(
    scroll: (dx: number, dy: number) => void,
    schedule: (task: () => void) => void,
  )
  /* 速度衰减帧循环驱动 scroll 回调 */
}
export interface TouchPoint {
  x: number
  y: number
}
export interface ScrollDelta2D {
  dx: number
  dy: number
}
export interface InertiaVelocity {
  dx: number
  dy: number
}

/** 按按键求下一个活动格；方向键四向、Tab 右移 / Shift+Tab 左移；越界夹取到表缘 */
export function nextActiveCell(
  key: string,
  current: CellRef,
  colCount: number,
  rowCount: number,
  shiftKey?: boolean,
): CellRef | null

/** 单轴滚动跟随：求让 [start, start+size) 完整进入视口的最小滚动位置 */
export function revealAxis(
  scrollPos: number,
  viewportSize: number,
  start: number,
  size: number,
): number

/** sky 层交互浮层（ListTable 内置；独立宿主可自建） */
export class InteractionOverlay {
  constructor(layerRoot: SceneNode, geometry: OverlayGeometry, tokens: InteractionTokens)
  updateTheme(tokens: InteractionTokens): void
  resize(): void
}

/** 浮层绘制所需的几何查询 */
export interface OverlayGeometry {
  cellRect(col: number, row: number): Region | null
  bodyViewport(): Region
}

/** resize 拖拽指示线（视口坐标） */
export interface ResizeLine {
  readonly orientation: 'vertical' | 'horizontal'
  readonly position: number
}

/** 宿主高亮区域（公式引用染色框等）：四边细条边框，只绘制不拦截事件 */
export interface HighlightRange {
  readonly bounds: RangeBounds
  readonly color: string
}

/** 浮层内容源（选区 + 指示线 + 填充预览 + 高亮 + 冻结分隔 + 滚动条几何） */
export interface OverlayContent {
  readonly selection: SelectionSnapshot
  readonly resizeLine: ResizeLine | null
  readonly fillHandleRange: SelectionRange | null
  readonly fillPreview: RangeBounds | null
  readonly selectionAnchor: RangeBounds | null
  readonly highlightRanges: readonly HighlightRange[]
  readonly freezeDividers: { x: number | null; y: number | null }
  readonly scrollbars: { vertical: unknown; horizontal: unknown }
}
```

## 参数说明

`SelectionState` 方法：

| 方法 | 默认 | 约束 |
| --- | --- | --- |
| `selectCell(col, row, extend = false)` | — | 单格选中；extend=true 以既有末段锚点做 shift 扩展，焦点同步目标 |
| `selectCells(ranges)` | — | 整组替换；焦点落末段 end（填充柄挂焦点段） |
| `addRange(range)` | — | 追加一段（ctrlMultiSelect 的 Ctrl/Cmd 点选路径），焦点同步新段 end |
| `beginDrag` / `updateDrag` / `endDrag` | — | 拖选会话：锚定格、扩展末段（焦点同步）、结束（锚点不重置） |
| `selectRow(row, colCount)` / `selectCol(col, rowCount)` | — | 整行/整列；colCount/rowCount ≤ 0 时不广播 |
| `selectAll(colCount, rowCount, focus?)` | — | 全选，焦点缺省左上角首格 |
| `applyExternal(snapshot, bounds?)` | — | 外部回写：不广播防回环；给 bounds 先把段边界与焦点钳到数据区；拖拽中同边界段只同步焦点不替换（保锚点） |

`hitResizeHandle(x, y, geo, capability = {}, threshold = 4)`：命中带宽 4px；列头关闭（headerHeight = 0）时列手柄不可命中，行号列关闭（rowHeaderWidth = 0）时行手柄不可命中；被 `canResizeCol`/`canResizeRow` 拒绝返回 null。

`ResizeSession.sizeAt(pointer)`：夹取下限——列宽最小 20px（`MIN_COL_WIDTH`），行高最小 20px（`MIN_ROW_HEIGHT`）。

`nextActiveCell(key, ...)`：只识别 `'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Tab'`，其余键返回 null；colCount/rowCount ≤ 0 返回 null。

`FILL_HANDLE_SIZE` 固定 `8`（px 方点边长）。

## 方法与事件

`ListTable` 上的选区与交互事件（全部同步、返回退订函数）：

- `onSelectionChange(listener)` — 选区变更级粒度（拖选过程每帧触发）；适配层自行节流。
- `getSelection()` / `getSelectedCellRanges()`（返回副本，段 start/end 可反向）。
- `applyExternalSelection(snapshot)` — 外部模型选区回写：钳制到数据区（行头/列头带坐标不入库）并刷新浮层但不广播。
- `onFillHandleDown(listener)` — 载荷 `{ range }`（柄所在选区段，start/end 可反向）。
- `onFillDragEnd(listener)` — 载荷 `{ anchor, target }`（均 min/max 序）。轴锁定规则：行/列位移绝对值大者为主轴（相等取纵向），副轴夹回锚定段跨度内。填充生成不在内核——宿主据差集自行实现（sheet 插件 `bindFillGeneration` 是参考实现）。
- `onFillHandleDoubleClick(listener)` — 与拖拽结束事件互斥（双击的第二次抬起只抛双击事件）。Excel 语义为按相邻列连续数据块向下自动填充。
- `onColResizeEnd` / `onRowResizeEnd` — 会话结束，载荷为夹取后的最终生效值。

## 典型示例

### 填充柄拖拽生成写入（SheetStore 供给）

```ts
import { ListTable, normalizeRange, SheetModel } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const model = new SheetModel(50, 2)
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ title: 'A' }, { title: 'B' }],
  model,
  hostOptions: { container },
})

table.selectCells([{ start: { col: 0, row: 0 }, end: { col: 0, row: 1 } }])

table.onFillDragEnd(({ anchor, target }) => {
  console.log(`锚定 (${anchor.minCol},${anchor.minRow})~(${anchor.maxCol},${anchor.maxRow})`)
  console.log(`目标 (${target.minCol},${target.minRow})~(${target.maxCol},${target.maxRow})`)
  // 纵向填充：对 target.maxRow > anchor.maxRow 的行逐格写值（数字线性序列示例）
  table.batchUpdate(() => {
    for (let row = anchor.maxRow + 1; row <= target.maxRow; row++) {
      table.updateCell(target.minCol, row, row)
    }
  })
})
// 用户拖填充柄到第 5 行松手 => 控制台输出锚定/目标边界，A3..A5 写入 3..5
```

### 行列 resize 落库持久化

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [
    { field: 'name', title: '名称', width: 140 },
    { field: 'qty', title: '数量', width: 80 },
  ],
  records: [{ name: 'a', qty: 1 }],
  canResizeCol: (col) => col !== 1, // 第 1 列禁止拖宽
  hostOptions: { container },
})

table.onColResizeEnd((event) => {
  console.log(event.col, event.width) // => 0 168（夹取后 ≥ 20 的生效值）
  localStorage.setItem(`col-width-${event.col}`, String(event.width))
})
```

### 外部模型选区回流（防回环）

```ts
import { ListTable, normalizeRange, type SelectionSnapshot } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ field: 'a', title: 'A' }],
  records: Array.from({ length: 30 }, (_, i) => ({ a: i })),
  hostOptions: { container },
})

let external: SelectionSnapshot = { ranges: [], focus: null }
table.onSelectionChange((snapshot) => {
  external = snapshot // 表格 → 外部
})

function syncFromExternal(): void {
  // 外部 → 表格：applyExternalSelection 钳制到数据区且不再广播，天然断开回环
  table.applyExternalSelection(external)
}
```

## 注意事项

> [!WARNING]
> - `SelectionRange.start/end` 可反向（拖选反向时 start 是锚点、end 是焦点）；读取边界必须先 `normalizeRange`，直接读 start/end 当 min 角会得到反向区间。
> - 填充生成算法不在内核：引擎只画柄与抛 `onFillHandleDown`/`onFillDragEnd`/`onFillHandleDoubleClick` 事件，写入由宿主完成（sheet 插件的 `generateFill`/`bindFillGeneration` 是参考实现，见 `apis/sheet-plugin.md`）。
> - `applyExternal`（SelectionState 方法）不广播；`table.applyExternalSelection` 在其上多做了钳制与浮层刷新。宿主自己调 `selection.applyExternal` 时不会刷新 sky 浮层。
> - 拖拽进行中收到与当前拖拽段归一化边界等值的外部快照时，引擎只同步焦点不替换段（保拖拽锚点）——这是防「反向拖拽选区塌缩」的内部规则，宿主不需要也不应该绕过。
> - 列头关闭（`showColHeader: false`）后列 resize 手柄不可命中；行号列关闭后行 resize 手柄不可命中——没有表头带就没有可抓的边缘。
> - 本库 `ctrlMultiSelect` 缺省 false（点选替换选区）；Excel 式 Ctrl 加选须显式开启。

## 常见问题

### 拖填充柄松手后表格数据没变

原因：填充生成不在内核，`onFillDragEnd` 只是事件通知。修复：订阅事件并写入模型（或接入 sheet 插件 `bindFillGeneration`）。

```ts
import { ListTable, SheetModel } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const model = new SheetModel(50, 1)
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ title: 'A' }],
  model,
  hostOptions: { container },
})

table.onFillDragEnd(({ anchor, target }) => {
  table.batchUpdate(() => {
    for (let row = anchor.maxRow + 1; row <= target.maxRow; row++) {
      table.updateCell(anchor.minCol, row, row) // 写回 model 并局部刷新
    }
  })
})
```

### getSelectedCellRanges 读出的 start 坐标比 end 大

原因：反向拖选时 start 是锚点（拖拽起点）、end 是焦点（当前端），不是 min 角。修复：用 `normalizeRange` 归一化后再读边界。

```ts
import { normalizeRange } from 'infinitable'

const range = { start: { col: 3, row: 5 }, end: { col: 1, row: 2 } }
console.log(normalizeRange(range)) // => { minCol: 1, minRow: 2, maxCol: 3, maxRow: 5 }
```
