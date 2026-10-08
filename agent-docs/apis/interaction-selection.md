---
title: SelectionSnapshot 选区与交互事件
description: infinitable 选区与交互：选区快照 SelectionSnapshot（ranges + focus）、normalizeRange 归一化、程序化选区（selectCells/selectRow/selectAll）、applyExternalSelection 外部回流防回环、HighlightRange 引用染色高亮，以及填充柄（onFillDragEnd 拖拽生成事件）、行列 resize（onColResizeEnd/onRowResizeEnd）等交互事件的载荷语义。拖选/加选/惯性/键盘导航由引擎内置接线。
aliases: [选区, 填充柄, SelectionState, InteractionOverlay, 行列调整, 拖拽]
keywords: [SelectionSnapshot, RangeBounds, normalizeRange, HighlightRange, FillDragEndEvent, getSelection, getSelectedCellRanges, selectCells, selectRow, selectAll, applyExternalSelection, onSelectionChange, onFillDragEnd, onFillHandleDoubleClick, onColResizeEnd, onRowResizeEnd, ctrlMultiSelect, setHighlightRanges, 选区, 填充柄, 拖拽, 染色框]
---

# SelectionSnapshot 选区与交互事件

`infinitable`（core 层）导出选区公共类型与工具：`SelectionSnapshot`（选区快照：段数组 + 焦点格）、`normalizeRange`（段边界归一化）、`RangeBounds`、`HighlightRange`（sky 浮层高亮区）与 `FillDragEndEvent`（填充柄拖拽结束事件载荷）。选区状态机、交互浮层、触控惯性、键盘导航等原语是引擎内部实现，不占公共导出面——`ListTable` 已内置接线：指针拖选、Ctrl/Cmd 加选（`ctrlMultiSelect`）、表头拖选、填充柄按下/拖拽/双击事件、行列 resize、触控惯性、方向键/Tab 导航全部开箱可用；宿主消费 `table.select*/getSelection/on*` 事件面即可。

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
interface SelectionRange {
  start: { col: number; row: number } // 格坐标（0 基；统一入口类型名 GridCellRef，未随选区面导出）
  end: { col: number; row: number }
}

/** 归一化后的选区边界（min/max 序） */
export interface RangeBounds {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

/** 选区快照：程序化选区入参、getSelection 返回与 onSelectionChange 载荷的统一形态 */
export interface SelectionSnapshot {
  readonly ranges: readonly SelectionRange[]
  /** 焦点格（键盘导航的活动格）；无选区时为 null */
  readonly focus: { col: number; row: number } | null
}

/** 求选区段的 min/max 边界 */
export function normalizeRange(range: SelectionRange): RangeBounds

/** 宿主高亮区域（公式引用染色框等）：四边细条边框，只绘制不拦截事件 */
export interface HighlightRange {
  readonly bounds: RangeBounds
  readonly color: string
}

/** 填充柄拖拽结束事件（onFillDragEnd 载荷） */
export interface FillDragEndEvent {
  /** 柄所在选区段的归一化边界 */
  anchor: RangeBounds
  /** 拖拽目标格范围（min/max 序） */
  target: RangeBounds
}
```

## 参数说明

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `SelectionRange.start` / `.end` | `{ col, row }` | — | 是 | 0 基格坐标；end 可小于 start（反向拖选），读取边界必须先 `normalizeRange` |
| `SelectionSnapshot.focus` | `{ col, row } \| null` | — | — | 键盘导航活动格；无选区为 null |
| `HighlightRange.bounds` | `RangeBounds` | — | 是 | min/max 序边界（先归一化再构造） |
| `HighlightRange.color` | `string` | — | 是 | CSS 颜色串（四边细条边框色） |

`ListTableOptions.ctrlMultiSelect`：`boolean`，缺省 `false`（Ctrl/Cmd 点数据格为点选替换选区）；`true` 时 Ctrl/Cmd 点数据格在既有选区上追加选区段。

## 方法与事件

`ListTable` 选区程序化 API（全部同步）：

- `selectCell(col, row)` — 单格选中（焦点同步该格）。
- `selectCells(ranges: readonly SelectionRange[])` — 整组替换，焦点落末段 end（填充柄挂焦点段）。
- `selectRow(row)` / `selectCol(col)` / `selectAll()` / `clearSelection()` — 整行/整列/全选/清空。
- `getSelection(): SelectionSnapshot` / `getSelectedCellRanges(): SelectionRange[]`（返回副本，段 start/end 可反向）。
- `applyExternalSelection(snapshot)` — 外部模型选区回写：钳制到数据区（行头/列头带坐标不入库）、刷新 sky 浮层但不广播（天然防回环）。
- `setHighlightRanges(ranges: readonly HighlightRange[])` — sky 浮层宿主高亮区（公式引用染色框等）。
- `setSelectionAnchor(anchor | null)` — 编辑拾取会话的选区锚点绘制。

选区与交互事件订阅（全部返回退订函数）：

| 方法 | 触发 | 载荷 |
| --- | --- | --- |
| `onSelectionChange` | 选区变更（拖选过程每帧触发） | `SelectionSnapshot`；适配层自行节流 |
| `onFillHandleDown` | 填充柄按下 | `{ range }`（柄所在选区段，start/end 可反向） |
| `onFillDragEnd` | 填充柄拖拽结束 | `{ anchor, target }`（均 min/max 序）；轴锁定：行/列位移绝对值大者为主轴（相等取纵向），副轴夹回锚定段跨度内 |
| `onFillHandleDoubleClick` | 填充柄双击（与拖拽结束互斥） | `{ range }`；Excel 语义为按相邻列连续数据块向下自动填充，写入由宿主或 sheet 插件完成 |
| `onColResizeEnd` / `onRowResizeEnd` | 列宽/行高拖拽会话结束 | `{ col, width }` / `{ row, height }`（夹取后生效值，宽高下限 20px） |

引擎内置交互（无需宿主接线）：指针拖选、Ctrl/Cmd 加选（`ctrlMultiSelect: true`）、表头拖选整列/行号列拖选整行、填充柄拖拽与双击事件、行列 resize 手柄（列手柄在列头区列右缘、行手柄在行号列区行下缘；`canResizeCol`/`canResizeRow` 返回 false 的行列不可拖）、触控惯性滚动、方向键/Tab 键盘导航。

## 典型示例

### 填充柄拖拽生成写入

```ts
import { ListTable, SheetModel } from 'infinitable'

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
import { ListTable, type SelectionSnapshot } from 'infinitable'

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
> - 填充生成算法不在内核：引擎只画柄与抛 `onFillHandleDown`/`onFillDragEnd`/`onFillHandleDoubleClick` 事件，写入由宿主完成（sheet 插件的填充生成接线是参考实现，见 `apis/sheet-plugin.md`）。
> - 选区状态机与交互浮层（原 `SelectionState`/`InteractionOverlay`，0.1.2 起不再导出）为引擎内部实现：选区读写只走 `table.select*/getSelection/applyExternalSelection`；拖拽进行中收到与当前拖拽段归一化边界等值的外部快照时，引擎只同步焦点不替换段（保拖拽锚点），宿主不需要也不应该绕过。
> - 列头关闭（`showColHeader: false`）后列 resize 手柄不可命中；行号列关闭后行 resize 手柄不可命中——没有表头带就没有可抓的边缘。
> - 本库 `ctrlMultiSelect` 缺省 false（点选替换选区）；Excel 式 Ctrl 加选须显式开启（sheet 插件构造期默认注入 `ctrlMultiSelect: false` 的 Excel 键位底座）。

## 常见问题

### 拖填充柄松手后表格数据没变

原因：填充生成不在内核，`onFillDragEnd` 只是事件通知。修复：订阅事件并写入模型，或接入 sheet 插件（其构造期自动接线填充生成与双击自动填充）。

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
