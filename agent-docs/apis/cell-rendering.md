---
title: CellRenderer 自定义单元格渲染与合并区
description: infinitable 单元格渲染：CellRenderer 自定义渲染器（resolveCellRenderer 按格接管内容绘制）、内置 text/checkbox 渲染行为（对齐/溢出/换行/修饰线与勾选态方框）、CellRange 合并单元格区间模型与 normalizeCellRange 归一化。渲染器在格内局部坐标系绘制，背景与边框由引擎节点负责。
aliases: [CellRenderer, 自定义渲染, MergeCellMap, 合并单元格, BUILTIN_CELL_RENDERERS, 渲染器]
keywords: [CellRenderer, resolveCellRenderer, cellType, checkbox, textOverflow, textWrap, CellRange, normalizeCellRange, mergeCells, setMergeCells, addMergeCell, removeMergeCell, textAlign, verticalAlign, 自定义渲染, 合并单元格, 复选框, 斑马纹]
---

# CellRenderer 自定义单元格渲染与合并区

`infinitable`（core 层）导出单元格渲染与合并区两族 API：`CellRenderer`（自定义渲染器契约：在格内局部坐标系绘制内容，经 `ListTableOptions.resolveCellRenderer` 按格接管）、`CellRange`（合并单元格区间模型）与 `normalizeCellRange`（区间归一化）。内置渲染按列 `cellType`（`'text'`/`'checkbox'`）分派（内置渲染实现与场景节点、网格布局纯函数族 0.1.2 起不再导出，为引擎内部实现）。

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
/** 渲染器入参：格几何 + 管线产物 + 投影后样式（未单独导出；ctx 已平移到格内局部原点） */
interface CellRenderTarget {
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

/** 单元格渲染器：在格内局部坐标系绘制内容（背景与边框由引擎节点负责） */
export type CellRenderer = (target: CellRenderTarget) => void

/** 单元格区间（闭区间，归一化后 start ≤ end） */
export interface CellRange {
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 归一化：交换使 start ≤ end */
export function normalizeCellRange(range: CellRange): CellRange
```

`ListTableOptions.resolveCellRenderer`（按格接管 hook，未导出为独立类型）：`(col: number, row: number) => CellRenderer | null`——纯函数、同步、O(1)；返回渲染器即接管该格内容绘制，返回 null 走内置 `cellType` 渲染。

`ColumnDefine.cellType`：`'text' | 'checkbox'`，缺省 `'text'`（内置类型，未导出为独立类型）。

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

`CellRange`：闭区间（end 可比 start 小，`normalizeCellRange` 归一化；构造 `mergeCells` 时引擎自动归一化）；1×1 单格区间不算合并（被丢弃）。

合并区约束：`ListTableOptions.mergeCells` / `setMergeCells` / `addMergeCell` 传入重叠区间抛 `merge ranges overlap at (col, row): [startCol,startRow ~ endCol,endRow]`；越出表格抛 `assertMergesWithinTable` 系列错误；跨冻结边界的合并区合法。

## 方法与事件

内置 text 渲染行为（`cellType: 'text'` 缺省路径），按样式逐级分派：

- `style.textWrap === true`：逐字贪心断行（先按 `\n` 强制分段），行块垂直居中，超出格高的行被裁掉。
- 超宽且 `style.textOverflow === 'ellipsis'`：二分找「最长前缀 + `…`」。
- 超宽且 `style.textOverflow === 'clip'`：内容盒内直接裁剪。
- 超宽未设置：Excel 式溢出——left 对齐只向右溢、right 只向左溢、center 双向，对齐锚点恒在源格。
- 修饰线：`underline` 紧贴基线下方、`lineThrough` 在基线上方约 30% 字高处，随文本色绘制。
- 空 `text` 不绘制。

内置 checkbox 渲染行为（`cellType: 'checkbox'`）：14px 方框（细线 `fillRect` 保证像素对齐，边框色 `#8f959e`）+ 勾选态实心块（`#3370ff`）；`value` 为 truthy 即勾选；水平位置跟随 `textAlign` 与 padding 内缩，不绘制取值文本。

`ListTable` 合并区运行时 API：`setMergeCells(ranges)`（整体替换）/ `addMergeCell(range)` / `removeMergeCell(range)`（按归一化后精确匹配，未命中为空操作）；重叠或越界抛错并保持原状。被合并覆盖的格取主格文本（`getCellText` 同口径）。

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

### 合并区构造与运行时变更

```ts
import { ListTable, normalizeCellRange, type CellRange } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }],
  rowCount: 10,
  mergeCells: [{ startCol: 2, startRow: 2, endCol: 3, endRow: 3 }], // 跨冻结边界合法
  hostOptions: { container },
})

// 反向区间先归一化再读取边界（构造 mergeCells 时引擎自动归一化）
const raw: CellRange = { startCol: 3, startRow: 3, endCol: 2, endRow: 2 }
console.log(normalizeCellRange(raw)) // => { startCol: 2, startRow: 2, endCol: 3, endRow: 3 }

table.addMergeCell({ startCol: 0, startRow: 0, endCol: 1, endRow: 0 })
// 传入与既有区重叠的区间 => 抛 Error: merge ranges overlap at (0, 0): [0,0 ~ 1,0]
// 1×1 单格区间（如 1,1 ~ 1,1）被引擎自动丢弃，不算合并
```

### 状态徽章渲染（读 style 与 value）

```ts
import type { CellRenderer } from 'infinitable'
import { ListTable } from 'infinitable'

const badgeRenderer: CellRenderer = ({ ctx, width, height, value, style }) => {
  const ok = value === 'pass'
  ctx.fillStyle = ok ? '#22c55e' : '#ef4444'
  ctx.fillRect(4, (height - 8) / 2, width - 8, 8)
  void style // 可读投影后样式（主题 → 列级 → 按格）做条件配色
}

const container = document.querySelector<HTMLDivElement>('#table')!
new ListTable({
  width: 400,
  height: 300,
  columns: [{ field: 'state', title: '状态', width: 120 }],
  records: [
    { state: 'pass' },
    { state: 'fail' },
  ],
  resolveCellRenderer: (col) => (col === 0 ? badgeRenderer : null),
  hostOptions: { container },
})
```

## 注意事项

> [!WARNING]
> - 自定义渲染器在格内局部坐标系绘制（ctx 已平移），背景与边框由引擎格节点负责——不要在渲染器内重画背景/边框（需要改底色用 `resolveCellStyle`）。
> - `resolveCellRenderer` 要求纯函数、同步、O(1)：渲染器在滚动帧建格/重投影时高频调用，禁止在其中做异步或重计算。
> - `checkbox` 的勾选态取 `value`（基础值），不是 `text`；`cellType: 'checkbox'` 不改变点击交互——点选仍是选区语义，改值走编辑提交。
> - 内置渲染实现、场景格节点（原 `renderTextCell`/`renderCheckboxCell`/`BUILTIN_CELL_RENDERERS`/`CellNode`）与网格布局纯函数族（原 `computeColOffsets`/`computeRowWindow` 等，0.1.2 起不再导出）为引擎内部实现：坐标换算走 `table.getCellRelativeRect`/`getCellAtRelativePosition`，窗口查询走 `table.getVisibleRange`/`getBodyVisibleCellRange`。

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

原因：传入 `ListTableOptions.mergeCells`（或 `setMergeCells`/`addMergeCell`）的区间互相重叠。修复：保证区间互斥；运行时新增用 `addMergeCell`（重叠抛错保持原状，不会静默错绘）。

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
  rowCount: 10,
  // 修复前：[{ 0,0 ~ 2,0 }, { 1,0 ~ 1,1 }] 重叠抛错
  mergeCells: [
    { startCol: 0, startRow: 0, endCol: 2, endRow: 0 },
    { startCol: 1, startRow: 1, endCol: 1, endRow: 1 }, // 1×1 单格会被自动丢弃（不算合并）
  ],
  hostOptions: { container },
})
// 区间互斥后正常构造；运行时读回合并区无公共 API，由宿主自行维护数据源
```
