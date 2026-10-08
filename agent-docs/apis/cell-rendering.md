---
title: CellRenderer 单元格渲染与网格布局
description: infinitable 单元格渲染（内置 text/checkbox、ResolveCellRenderer 自定义渲染 hook、CellRenderTarget 入参）、合并单元格区间模型（CellRange/MergeCellMap）、CellNode 场景节点与网格布局纯函数（偏移前缀和/虚拟窗口/冻结坐标换算）。
aliases: [CellRenderer, 自定义渲染, MergeCellMap, 合并单元格, grid-layout, 布局函数]
keywords: [CellRenderer, ResolveCellRenderer, cellType, checkbox, renderCheckboxCell, BUILTIN_CELL_RENDERERS, MergeCellMap, CellRange, normalizeCellRange, rangeContains, computeColOffsets, computeRowOffsets, computeRowWindow, resolveCellX, findColAt, unionRegions, WindowRange, 自定义渲染, 合并单元格, 虚拟窗口]
---

# CellRenderer 单元格渲染与网格布局

`infinitable`（core 层）导出单元格渲染与网格几何两族 API：渲染族（`CellType` 内置类型、`CellRenderer`/`CellRenderTarget` 渲染契约、`resolveCellRenderer` 按格接管、`BUILTIN_CELL_RENDERERS`/`renderTextCell`/`renderCheckboxCell` 内置实现）、合并区间族（`CellRange`/`MergeCellMap` 及三个纯谓词）、场景格节点 `CellNode`、网格布局纯函数族（列宽/行高前缀和、可见窗口、冻结坐标换算、区域并集）。布局函数全部同步纯函数，供宿主做命中测试、坐标换算与自定义几何管线。

## 快速上手

```ts
import type { CellRenderer } from 'infinitable'
import { ListTable } from 'infinitable'

/** 评分列：紫色条形图（value 为 0~1 数字） */
const ratingRenderer: CellRenderer = ({ ctx, width, height, value }) => {
  const ratio = typeof value === 'number' ? value : 0
  const barWidth = Math.round((width - 16) * ratio)
  if (barWidth <= 0) {
    return
  }
  ctx.fillStyle = '#7c3aed'
  ctx.fillRect(8, (height - 10) / 2, barWidth, 10)
}

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 760,
  height: 420,
  columns: [
    { field: 'name', title: '名称', width: 140 },
    { field: 'rating', title: '评分', width: 120 },
    { field: 'done', title: '完成', width: 80, cellType: 'checkbox' }, // 内置复选框
  ],
  records: Array.from({ length: 100 }, (_, row) => ({
    name: `商品-${row}`,
    rating: ((row * 7) % 10) / 10,
    done: row % 2 === 0, // value 即勾选态
  })),
  resolveCellRenderer: (col) => (col === 1 ? ratingRenderer : null), // null 走内置渲染
  hostOptions: { container },
})
// => 评分列画条形、完成列画复选框、名称列内置文本渲染
```

## API 签名

```ts
/** 内置单元格类型 */
export type CellType = 'text' | 'checkbox'

/** 渲染器入参：格几何 + 管线产物 + 投影后样式（ctx 已平移到格内局部原点） */
export interface CellRenderTarget {
  ctx: RenderContext
  col: number
  row: number
  width: number
  height: number
  /** 取值管线最终显示文本 */
  text: string
  /** 基础值（模型值或 records 字段值），checkbox 据此判定勾选态 */
  value: unknown
  style: CellStyle
  /** 文本测量宽（内置 text 路径由节点测量传入） */
  textWidth?: number
  /** 节点已推导的 font 串；缺省时渲染器自行按样式组装 */
  font?: string
  /** 文本可绘制的局部右界：等于 width 即右侧裁剪在本格，更大表示可溢出到右侧空格 */
  textMaxX?: number
  /** 文本可绘制的局部左界：等于 0 即左侧裁剪，负值表示可溢出到左侧空格 */
  textMinX?: number
}

/** 单元格渲染器：在格内局部坐标系绘制内容（背景与边框由节点负责） */
export type CellRenderer = (target: CellRenderTarget) => void

/** 自定义渲染 hook：纯函数、同步、O(1)；返回渲染器即接管该格内容绘制 */
export type ResolveCellRenderer = (col: number, row: number) => CellRenderer | null

/** 内置类型渲染表 */
export const BUILTIN_CELL_RENDERERS: Readonly<Record<CellType, CellRenderer>>

/** 内置 text 渲染（对齐/溢出/换行随样式） */
export const renderTextCell: CellRenderer
/** 内置 checkbox 渲染：14px 方框 + 勾选态实心块，value 即状态，不绘制取值文本 */
export const renderCheckboxCell: CellRenderer

/** 单元格区间（闭区间，归一化后 start ≤ end） */
export interface CellRange {
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 归一化：交换使 start ≤ end */
export function normalizeCellRange(range: CellRange): CellRange
/** (col, row) 是否落在区间内 */
export function rangeContains(range: CellRange, col: number, row: number): boolean
/** 区间是否跨越冻结边界（纯谓词；跨冻结边界的合并区合法） */
export function rangeCrossesBoundary(
  range: CellRange,
  frozenColCount: number,
  frozenRowCount: number,
): boolean

/** 合并区集合：构造时归一化并校验互不重叠，重叠抛错 */
export class MergeCellMap {
  constructor(ranges?: readonly CellRange[])
  readonly ranges: readonly CellRange[]
  /** 覆盖 (col, row) 的合并区；未覆盖返回 null */
  rangeAt(col: number, row: number): CellRange | null
  /** (col, row) 所属合并区的主格（左上角）坐标；未被覆盖返回 null */
  masterOf(col: number, row: number): { col: number; row: number } | null
  /** (col, row) 是否为合并区主格 */
  isMaster(col: number, row: number): boolean
}

/** 单元格场景节点：背景 → 内容（内置 cellType 或自定义渲染）→ 逐边边框 */
export class CellNode extends SceneNode {
  readonly col: number
  readonly row: number
  text: string
  value: unknown
  cellType: CellType
  style: CellStyle
  border: CellBorder | null
  renderer: CellRenderer | null
  textMaxX: number
  textMinX: number
  contentHidden: boolean
  constructor(init: CellNodeInit)
  setContent(text: string, value: unknown): void
}

export interface CellNodeInit extends SceneNodeInit {
  col: number
  row: number
  text?: string
  value?: unknown
  cellType?: CellType
  style?: CellStyle
}

// ---- 网格布局纯函数 ----

/** 窗口区间 [start, end) */
export interface WindowRange {
  start: number
  end: number
}

/** 列宽前缀和：offsets[i] 为第 i 列左缘内容坐标，length = 列数 + 1 */
export function computeColOffsets(colWidths: readonly number[]): number[]
/** 行高前缀和（支持逐行覆盖），length = 行数 + 1 */
export function computeRowOffsets(
  rowCount: number,
  defaultRowHeight: number,
  rowHeights?: ReadonlyMap<number, number>,
): number[]
/** 等行高可见行窗口（含边缘部分可见行） */
export function computeRowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
): WindowRange
/** 可见列窗口（start 二分定位，end 短程扫描） */
export function computeColWindow(
  scrollLeft: number,
  viewportWidth: number,
  colOffsets: readonly number[],
): WindowRange
/** 逐行高度版可见行窗口 */
export function computeRowWindowFromOffsets(
  scrollTop: number,
  viewportHeight: number,
  rowOffsets: readonly number[],
): WindowRange
/** 非冻结行可见窗口（滚动位置定义在可滚动内容上） */
export function computeScrollableRowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  frozenRowCount: number,
): WindowRange
/** 非冻结列可见窗口 */
export function computeScrollableColWindow(
  scrollLeft: number,
  viewportWidth: number,
  colOffsets: readonly number[],
  frozenColCount: number,
): WindowRange
/** computeScrollableRowWindow 的逐行高度版 */
export function computeScrollableRowWindowFromOffsets(
  scrollTop: number,
  viewportHeight: number,
  rowOffsets: readonly number[],
  frozenRowCount: number,
): WindowRange
/** 内容坐标 y 命中的行；越界返回 -1 */
export function findRowAt(rowOffsets: readonly number[], contentY: number): number
/** 内容坐标 x 命中的列；越界返回 -1 */
export function findColAt(colOffsets: readonly number[], contentX: number): number
/** 夹取冻结数量到 [0, total] */
export function clampFrozenCount(count: number, total: number): number
/** 数据列左缘层坐标 x：冻结列固定，非冻结列随 scrollLeft 平移 */
export function resolveCellX(
  col: number,
  scrollLeft: number,
  colOffsets: readonly number[],
  frozenColCount: number,
  rowHeaderWidth: number,
): number
/** 数据行上缘层坐标 y（等行高版） */
export function resolveCellY(
  row: number,
  scrollTop: number,
  rowHeight: number,
  frozenRowCount: number,
  headerHeight: number,
): number
/** 数据行上缘层坐标 y（逐行高度版） */
export function resolveCellYFromOffsets(
  row: number,
  scrollTop: number,
  rowOffsets: readonly number[],
  frozenRowCount: number,
  headerHeight: number,
): number
/** 区域并集（包围盒）；空数组返回 null */
export function unionRegions(regions: readonly Region[]): Region | null
```

## 参数说明

`CellRenderTarget`（自定义渲染器入参）：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `ctx` | `RenderContext` | 已 `translate` 到格内局部原点（(0,0) 为格左上角）；坐标系随 dpr 缩放已处理 |
| `width` / `height` | `number` | 格 CSS 像素尺寸（合并区为整块包围盒） |
| `text` / `value` | `string` / `unknown` | `text` 是取值管线最终显示文本；`value` 是基础值（checkbox 态、条形图比例等场景用） |
| `style` | `CellStyle` | 投影后样式（主题 → 列级 → 按格）；渲染器可读颜色/对齐 |
| `textMaxX` / `textMinX` | `number`（可选） | 文本走廊界（溢出绘制区间）；自定义渲染器按需消费 |
| `textWidth` / `font` | `number` / `string`（可选） | 节点测量产物；缺省自行组装 |

`CellRange`：闭区间（end 可比 start 小，构造 `MergeCellMap` 时自动归一化）；1×1 单格区间不算合并（被丢弃）。

`MergeCellMap` 构造：重叠区间抛 `merge ranges overlap at (col, row): [startCol,startRow ~ endCol,endRow]`。

`computeColWindow` 系列：窗口含边缘部分可见的行/列；`rowCount/viewportHeight ≤ 0` 返回 `{ start: 0, end: 0 }`。

## 方法与事件

`renderTextCell`（内置 text 渲染）行为，按样式逐级分派：

- `style.textWrap === true`：逐字贪心断行（先按 `\n` 强制分段），行块垂直居中，超出格高的行被裁掉。
- 超宽且 `style.textOverflow === 'ellipsis'`：二分找「最长前缀 + `…`」。
- 超宽且 `style.textOverflow === 'clip'`：内容盒内直接裁剪。
- 超宽未设置：Excel 式溢出——left 对齐只向右溢、right 只向左溢、center 双向，对齐锚点恒在源格。
- 修饰线：`underline` 紧贴基线下方、`lineThrough` 在基线上方约 30% 字高处，随文本色绘制。
- 空 `text` 不绘制。

`renderCheckboxCell`：14px 方框（细线 `fillRect` 保证像素对齐，边框色 `#8f959e`）+ 勾选态实心块（`#3370ff`）；`value` 为 truthy 即勾选；水平位置跟随 `textAlign` 与 padding 内缩，不绘制取值文本。

`CellNode.setContent(text, value)` — 同步更新内容并失效文本测量缓存；背景与边框由节点 `paint` 绘制，渲染器只画内容。

`unionRegions(regions)` — 返回包围盒并集（不是逐矩形精确并）；空数组返回 null。

## 典型示例

### 复选框列 + 读写联动

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ field: 'done', title: '完成', width: 80, cellType: 'checkbox', editor: 'text' }],
  records: Array.from({ length: 20 }, (_, row) => ({ done: row % 2 === 0 })),
  hostOptions: { container },
})
// => 偶数行实心勾选块；cellType: 'checkbox' 的渲染不改变点击行为，编辑提交走文本编辑器
```

### MergeCellMap 独立查询命中

```ts
import { MergeCellMap, normalizeCellRange, rangeContains } from 'infinitable'

const map = new MergeCellMap([
  { startCol: 2, startRow: 2, endCol: 3, endRow: 3 },
  { startCol: 5, endCol: 4, startRow: 1, endRow: 1 }, // 反向区间自动归一化为 (4,1)~(5,1)
])
console.log(map.rangeAt(3, 3)) // => { startCol: 2, startRow: 2, endCol: 3, endRow: 3 }
console.log(map.masterOf(3, 3)) // => { col: 2, row: 2 }
console.log(map.isMaster(2, 2)) // => true
console.log(rangeContains(normalizeCellRange({ startCol: 2, startRow: 2, endCol: 3, endRow: 3 }), 3, 2)) // => true

// new MergeCellMap([{ startCol: 0, startRow: 0, endCol: 2, endRow: 0 }, { startCol: 1, startRow: 0, endCol: 1, endRow: 1 }])
// => 抛 Error: merge ranges overlap at (1, 0): [0,0 ~ 2,0]
```

### 布局函数做视口外命中测试

```ts
import {
  clampFrozenCount,
  computeColOffsets,
  computeColWindow,
  findColAt,
  resolveCellX,
} from 'infinitable'

const colWidths = [80, 140, 80, 100]
const colOffsets = computeColOffsets(colWidths) // => [0, 80, 220, 300, 400]
const window = computeColWindow(120, 200, colOffsets) // 滚动 120、视口宽 200
console.log(window) // => { start: 1, end: 3 }（第 1~2 列可见，含边缘部分可见）

console.log(findColAt(colOffsets, 250)) // => 2（内容坐标 250 命中第 2 列）
console.log(findColAt(colOffsets, 999)) // => -1（越界）

const frozen = clampFrozenCount(9, 4) // => 4（夹取到列数）
console.log(resolveCellX(0, 120, colOffsets, 1, 48)) // => 48（冻结列不随滚动平移：48 + 0 - 0）
console.log(resolveCellX(2, 120, colOffsets, 1, 48)) // => 48 + 300 - 120 = 228（非冻结列随滚动平移）
```

## 注意事项

> [!WARNING]
> - 自定义渲染器在格内局部坐标系绘制（ctx 已平移），背景与边框由 `CellNode` 负责——渲染器里画满格背景会盖不住边框绘制序，不要在渲染器内重画背景/边框（需要改底色用 `resolveCellStyle`）。
> - `resolveCellRenderer` 要求纯函数、同步、O(1)：渲染器在滚动帧建格/重投影时高频调用，禁止在其中做异步或重计算。
> - `checkbox` 的勾选态取 `value`（基础值），不是 `text`；`cellType: 'checkbox'` 不改变点击交互——点选仍是选区语义，改值走编辑提交。
> - `CellNode.border` 是共享边裁决产物（生效边框），与 `style.border` 引用不同步；宿主改样式走 `table.refreshCell` 全链路，不要单独改写节点字段。
> - `unionRegions` 是包围盒并集，不是精确并集；面积敏感的失效计算只把它用于合并提交。
> - 布局函数的 `colOffsets`/`rowOffsets` 约定 `length = 行列数 + 1`（前缀和含 0 起点），传错长度会命中错位。

## 常见问题

### 自定义渲染列不显示任何内容

原因：`resolveCellRenderer` 返回了渲染器但渲染器没消费对字段——渲染器拿到的是格内局部坐标，且内容绘制依赖 `ctx` 当前样式状态。修复：显式设置 `fillStyle`/`font` 再绘制。

```ts
import type { CellRenderer } from 'infinitable'

const badgeRenderer: CellRenderer = ({ ctx, width, height, value }) => {
  ctx.fillStyle = '#2563eb' // 缺这行时沿用上一次绘制的填充色（不受 style.color 控制）
  ctx.fillRect(4, (height - 8) / 2, width - 8, 8)
  void value
}
```

### 合并区显示重叠/错乱

原因：传入 `MergeCellMap`（或 `ListTableOptions.mergeCells`）的区间互相重叠。修复：保证区间互斥；运行时新增用 `addMergeCell`（重叠抛错保持原状，不会静默错绘）。

```ts
import { MergeCellMap } from 'infinitable'

// 修复前：[{ 0,0 ~ 2,0 }, { 1,0 ~ 1,1 }] 重叠抛错
const map = new MergeCellMap([
  { startCol: 0, startRow: 0, endCol: 2, endRow: 0 },
  { startCol: 1, startRow: 1, endCol: 1, endRow: 1 }, // 1×1 单格会被自动丢弃（不算合并）
])
console.log(map.ranges.length) // => 1
```
