# 交互与编辑

`ListTable` 内置 Excel 式指针交互：点选、框选、Ctrl/Cmd 加选、Shift 扩展、表头拖选整行整列、角点全选、填充柄、行列 resize、键盘导航、触控惯性滚动和双击编辑。宿主只需要读取选区、订阅事件、提供编辑器和数据回写。

本页覆盖选区模型、滚动 API、右键事件、链接与图片点击、冻结与合并、行列 resize、填充柄事件，以及编辑器注册表与编辑会话。

::: tip 坐标系
统一入口里有两个 `CellRef`：`infinitable` 的 `CellRef` 是 formulas 的 A1 引用（含绝对标记等字段）；数据格坐标请用 `GridCellRef`（`{ col, row }`，0 基）。本页所有格坐标示例都用 `GridCellRef`。
:::

## 选区模型

选区由若干段组成，每段有 `start`（锚点）和 `end`（焦点侧）。拖选可以反向，因此 `start` 不一定在左上角；读取边界一律先归一化。

```ts
import { ListTable, normalizeRange } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 720,
  height: 420,
  columns: [
    { field: 'name', title: '名称', width: 160 },
    { field: 'qty', title: '数量', width: 100 },
    { field: 'note', title: '备注', width: 200 },
  ],
  records: Array.from({ length: 10_000 }, (_, row) => ({
    name: `商品-${row}`,
    qty: row,
    note: `备注-${row}`,
  })),
  ctrlMultiSelect: true,
  hostOptions: { container },
})

table.onSelectionChange((snapshot) => {
  for (const range of snapshot.ranges) {
    const { minCol, minRow, maxCol, maxRow } = normalizeRange(range)
    console.log(`段 ${minCol},${minRow} ~ ${maxCol},${maxRow}`)
  }
  console.log('焦点格', snapshot.focus)
})
```

### 指针选择

| 操作                    | 行为                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| 单击数据格              | 替换选区为单格；命中合并区时整块包围盒作为一个选区单元                                   |
| 按下并拖拽              | 从按下格锚定框选，拖拽过程每帧更新焦点，可反向                                           |
| Ctrl/Cmd + 单击         | `ctrlMultiSelect: true` 时在既有选区上追加一段；缺省 `false`，按普通点选替换             |
| Shift + 单击            | 从锚点扩展到点击格；锚点默认取画布选区末段 `start`，可经 `resolveShiftSelectAnchor` 指定 |
| 单击列头 / 拖拽列头     | 整列选择；拖拽过程中重算为连续列区间                                                     |
| 单击行号列 / 拖拽行号列 | 整行选择；拖拽过程中重算为连续行区间                                                     |
| 单击左上角              | 全选；焦点落在可视带首格                                                                 |
| 方向键 / Shift + 方向键 | 移动活动格 / 以当前锚点扩展选区                                                          |
| Tab / Shift + Tab       | 单格右移 / 左移，不扩展选区                                                              |

`resolveShiftSelectAnchor` 用于「画布选区不随拾取流动」的宿主（如公式引用拾取）：

```ts
const table = new ListTable({
  width: 600,
  height: 400,
  columns: [{ title: '公式', width: 200 }],
  rowCount: 100,
  resolveShiftSelectAnchor: (target) => (target.col === 0 ? { col: 2, row: 0 } : null),
  hostOptions: { container },
})
```

返回 `undefined` 用引擎缺省锚点（画布选区末段 `start`）；返回 `null` 不扩展，回落普通点选。

::: warning
`ctrlMultiSelect` 缺省为 `false`，`Ctrl/Cmd + 单击`默认是「替换选区」。需要 Excel 式加选必须显式开启 `ctrlMultiSelect: true`。电子表格 `SheetGrid` 装配固定传 `false`，因此 Ctrl 加选在 `SheetGrid` 下不可用。
:::

### 程序化选区

```ts
import { ListTable, type GridCellRef, type SelectionSnapshot } from 'infinitable'

const table = new ListTable({
  width: 720,
  height: 420,
  columns: [{ title: 'A' }, { title: 'B' }, { title: 'C' }],
  rowCount: 1_000,
  hostOptions: { container },
})

table.selectCell(0, 0)
table.selectRow(4)
table.selectCol(2)
table.selectAll()

// 多段选区：整组替换，焦点落在末段 end，填充柄挂在焦点段
table.selectCells([
  { start: { col: 0, row: 0 }, end: { col: 1, row: 2 } },
  { start: { col: 2, row: 10 }, end: { col: 2, row: 12 } },
])

const snapshot: SelectionSnapshot = table.getSelection()
const copy = table.getSelectedCellRanges() // 段数组副本，start/end 保留方向
const focus: GridCellRef | null = snapshot.focus
```

| 方法                                | 说明                                          |
| ----------------------------------- | --------------------------------------------- |
| `selectCell(col, row)`              | 单格选中；同时把该格滚动到完整可见            |
| `selectCells(ranges)`               | 整组替换；焦点落末段 `end`                    |
| `selectRow(row)` / `selectCol(col)` | 整行 / 整列                                   |
| `selectAll()` / `clearSelection()`  | 全选 / 清空                                   |
| `getSelection()`                    | 返回 `SelectionSnapshot`（只读段数组 + 焦点） |
| `getSelectedCellRanges()`           | 返回段数组副本，保留 `start/end` 方向         |
| `applyExternalSelection(snapshot)`  | 外部回写选区：钳制到数据区、刷新浮层但不广播  |

`SelectionSnapshot` 的形态：

```ts
interface SelectionSnapshot {
  readonly ranges: readonly {
    start: { col: number; row: number }
    end: { col: number; row: number }
  }[]
  readonly focus: { col: number; row: number } | null
}
```

`SelectionRange` 类型本身未从公共入口导出；需要类型时用 `SelectionSnapshot['ranges'][number]` 推导。

### 外部选区回流

`applyExternalSelection` 天然断回环：它只刷新浮层，不触发 `onSelectionChange`。

```ts
let external: SelectionSnapshot = { ranges: [], focus: null }

table.onSelectionChange((snapshot) => {
  external = snapshot // 表格 → 外部
})

// 外部 → 表格：不会再次广播
table.applyExternalSelection(external)
```

拖拽进行中收到与当前拖拽段归一化边界等值的外部快照时，引擎只同步焦点、不替换段，以保住拖拽锚点。宿主不要绕过该行为自行改段。

## 滚动 API

```ts
import { ListTable, type GridCellRef } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { title: 'A', width: 120 },
    { title: 'B', width: 120 },
  ],
  rowCount: 1_000_000,
  resolveDisplayValue: (col, row) => `${col}-${row}`,
  hostOptions: { container },
})

// canvas 滚动条模式下，鼠标滚轮由宿主接线（引擎内置触控惯性、键盘与滚动条）
if (!table.usesNativeScrollbar) {
  container.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      table.scrollBy(event.deltaX, event.deltaY)
    },
    { passive: false },
  )
}

table.scrollTo(0, 32_000)
table.scrollBy(0, 200)
table.scrollToCell({ col: 0, row: 500_000 })

const { left, top } = table.getScrollState()
const windowRange = table.getVisibleRange() // [start, end)，不含冻结区
const bodyRange = table.getBodyVisibleCellRange() // 冻结行列并入
```

| 方法                                                      | 说明                                                      |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `scrollTo(left, top)` / `scrollBy(dx, dy)`                | 位置自动夹取到 `[0, max]`；未变化不广播                   |
| `getScrollState()` / `getScrollLeft()` / `getScrollTop()` | 当前滚动位置                                              |
| `setScrollLeft(left)` / `setScrollTop(top)`               | 单轴设置，另一轴不变                                      |
| `scrollToCell(cell)`                                      | 让目标格完整可见；冻结轴恒可见，跳过                      |
| `getVisibleRange()`                                       | 当前滚动窗口 `{ rows, cols }`，`[start, end)`，不含冻结区 |
| `getBodyVisibleCellRange()`                               | 可视数据格范围，冻结行列并入                              |
| `getCellRelativeRect(col, row)`                           | 数据格视口矩形；窗口外返回 `null`                         |
| `getCellAtRelativePosition(x, y)`                         | 视口坐标命中数据格；表头/空白返回 `null`                  |
| `getDrawRange()`                                          | 扣除行号列与列头后的内容区矩形                            |
| `onScrollFrame(listener)`                                 | 滚动发生的帧触发一次，同帧多次滚动合并                    |
| `resize(width, height)`                                   | 原地调整视口，不重建实例；滚动位置与选区保留              |

滚动状态源只有一个：`table.scroll.state` 是只读的 `{ left, top }`，所有滚动路径（滚轮接线、键盘、滚动条拖拽、触控惯性、程序化 API）最终都汇入它。

### 原生滚动条模式

```ts
const table = new ListTable({
  width: 800,
  height: 400,
  columns: [{ title: 'A' }],
  rowCount: 10_000,
  scrollbar: { mode: 'native' },
  hostOptions: { container },
})

console.log(table.usesNativeScrollbar) // => true
```

原生档由浏览器渲染真实滚动条，外观、显隐、触控板惯性和辅助功能随 OS；`visibility` / `hideDelay` / `reserve` 不生效。此时滚轮和触控板由原生滚动容器接管，宿主已有滚轮接线必须用 `if (table.usesNativeScrollbar) return` 让位，否则会双滚。程序化滚动、键盘导航与原生容器双向同步。

canvas 档的滚动条配置：

```ts
const table = new ListTable({
  width: 800,
  height: 400,
  columns: [{ title: 'A' }],
  rowCount: 10_000,
  // 缺省 'hover'：悬停表格或滚动时显示；true 为 'always'；false 整体关闭
  scrollbar: { visibility: 'scrolling', hideDelay: 600 },
  hostOptions: { container },
})
```

## 右键事件

```ts
import { ListTable } from 'infinitable'

table.onContextMenu(({ cell, region, x, y, originalEvent }) => {
  // region: 'body' | 'row-header' | 'col-header'
  // cell: 命中的数据格；表头/空白/角点为 null
  console.log(region, cell, x, y, originalEvent)
})
```

行为约定：

- 右键不改选区、不开启任何指针会话；菜单作用对象由宿主根据落点与既有选区决定。
- 有监听者时引擎调用 `originalEvent.preventDefault()`，避免浏览器原生菜单盖在自绘菜单上；无监听者时不做任何事。
- 角点（行号列 × 列头交叉的全选区）归 `'body'` 且 `cell` 为 `null`，便于宿主继续作用于既有选区。
- 右键命中浮动对象时不派发单元格右键事件，改走 `table.floatObjects.onContextMenu`。

## 链接与图片点击

### 单元格链接

```ts
import { ListTable } from 'infinitable'

const table = new ListTable({
  width: 640,
  height: 360,
  columns: [
    { title: '名称', width: 200 },
    { title: '文档', width: 240 },
  ],
  rowCount: 100,
  resolveDisplayValue: (col, row) => (col === 0 ? `行-${row}` : `文档-${row}`),
  resolveCellLink: (col, row) =>
    col === 1 ? { url: `https://example.com/doc/${row}`, text: `文档-${row}` } : null,
  openCellLinkOnClick: false, // 由宿主接管打开行为
  hostOptions: { container },
})

table.onCellLinkHover(({ col, row, url, text, x, y }) => {
  // 宿主渲染 tooltip；x/y 为层坐标（CSS 像素）
  console.log('hover', col, row, url, text, x, y)
})

table.onCellLinkLeave(({ col, row }) => {
  console.log('leave', col, row)
})

table.onCellLinkClick(({ col, row, url }) => {
  console.log('click', col, row, url)
})
```

- 命中 `resolveCellLink` 的格自动获得默认链接外观：主题 `linkColor` 蓝字 + 下划线。该外观可被 `resolveCellStyle` 逐字段覆盖。
- 指针悬停链接格时光标变为 `pointer`；同格内移动不重复派发 `onCellLinkHover`，移出链接格/表头/空白派发 `onCellLinkLeave`。
- 单击要求真实指针在左键下按下并抬起于同一链接格，且位移不超过阈值（拖拽/框选/键盘选中不触发）。
- `openCellLinkOnClick` 缺省 `true`：事件派发后引擎执行 `window.open(url, '_blank', 'noopener')`；无 `window` 环境静默跳过。设为 `false` 后完全由宿主打开。

### 图片链接

```ts
import { ListTable } from 'infinitable'

const table = new ListTable({
  width: 640,
  height: 360,
  columns: [{ title: '封面', width: 160 }],
  rowCount: 100,
  resolveCellImage: (_col, row) => `https://cdn.example.com/cover/${row}.png`,
  // 有链接的嵌入图：单击派发 onImageLinkClick，kind === 'cell'
  resolveCellImageLink: (_col, row) => `https://example.com/detail/${row}`,
  openCellLinkOnClick: false,
  hostOptions: { container },
})

table.onImageLinkClick((event) => {
  if (event.kind === 'cell') {
    console.log('嵌入图', event.col, event.row, event.url)
  } else {
    console.log('浮动图', event.id, event.url)
  }
})
```

- `resolveCellImageLink` 用于图片格，与 `resolveCellImage` 配套；引擎只按该 hook 的返回值判定，宿主应只对确实有图的格返回 URL。单击派发 `onImageLinkClick`，`kind: 'cell'`。
- 嵌入图链接优先于单元格链接：同一格既有 `resolveCellLink` 又有 `resolveCellImageLink` 时，视觉点击的是图片，只派发图片链接事件。
- 浮动图片的超链接来自 `FloatObject.link`，单击派发 `onImageLinkClick`，`kind: 'float'` 并带对象 `id`。
- 无链接图片单击保持原有选中行为，不派发链接事件。

图片加载、位图缓存与浮动对象见 API 参考中的媒体能力说明。

## 冻结与合并

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 760,
  height: 420,
  columns: [
    { field: 'id', title: 'ID', width: 80 },
    { field: 'name', title: '名称', width: 140 },
    { field: 'note', title: '备注', width: 160 },
  ],
  records: Array.from({ length: 1_000 }, (_, row) => ({
    id: `ID-${row}`,
    name: `商品-${row}`,
    note: `备注-${row}`,
  })),
  frozenColCount: 1,
  frozenRowCount: 1,
  mergeCells: [
    { startCol: 1, startRow: 2, endCol: 2, endRow: 3 },
    { startCol: 1, startRow: 6, endCol: 1, endRow: 8 },
  ],
  hostOptions: { container },
})

table.setFrozenColCount(2)
table.setFrozenRowCount(0)

table.addMergeCell({ startCol: 0, startRow: 20, endCol: 1, endRow: 20 })
table.removeMergeCell({ startCol: 1, startRow: 6, endCol: 1, endRow: 8 })
table.setMergeCells([{ startCol: 1, startRow: 2, endCol: 2, endRow: 3 }])
```

冻结：

- `frozenColCount` / `frozenRowCount` 只数数据列/数据行，不含行号列与列头；构造和运行时都会夹取到 `[0, 列数/行数]`。
- 运行时用 `getFrozenColCount()` / `setFrozenColCount(count)` / `getFrozenRowCount()` / `setFrozenRowCount(count)`。
- 冻结轴恒可见：选区、`scrollToCell`、键盘导航都会跳过冻结轴。
- 冻结分隔线用主题 `interaction.freezeDividerColor` / `freezeDividerWidth`。

合并：

- `mergeCells` 是闭区间 `{ startCol, startRow, endCol, endRow }`；1×1 不算合并。
- 构造与 `setMergeCells` 属批量入口：重叠项自动规范化，保留先声明、丢弃冲突项并 `console.warn`，不打断渲染；越出表格抛错。
- `addMergeCell` 属程序化单命令：重叠抛 `MergeOverlapError`，越界抛错且原状不变；`removeMergeCell` 按归一化后精确匹配，未命中为空操作。
- 跨冻结边界的合并区合法，主格按冻结带钉固绘制。
- 合并区整体作为一个选区单元：点按任意被覆盖格选中整块，取值、样式、编辑都路由到主格。
- 需要先消解脏数据时用 `sanitizeMerges(ranges)`，与引擎同语义，返回 `{ ranges, conflicts }`。

## 行列 resize

```ts
import { ListTable } from 'infinitable'

const table = new ListTable({
  width: 720,
  height: 420,
  columns: [
    { field: 'name', title: '名称', width: 140 },
    { field: 'qty', title: '数量', width: 80 },
  ],
  records: [{ name: 'a', qty: 1 }],
  canResizeCol: (col) => col !== 1, // 第 1 列禁止拖宽
  canResizeRow: (row) => row % 2 === 0, // 奇数行禁止拖高
  hostOptions: { container },
})

table.onColResizeEnd(({ col, width }) => {
  console.log(col, width) // 夹取后的生效值，最小 20
  localStorage.setItem(`col-width-${col}`, String(width))
})

table.onRowResizeEnd(({ row, height }) => {
  console.log(row, height)
})

table.setColWidth(0, 180)
table.setRowHeight(0, 40)
```

- 列手柄在列头区列右缘，行手柄在行号列区行下缘；关闭列头/行号列后对应手柄不可命中。
- 拖拽期间画布绘制 resize 指示线；会话结束时才提交尺寸并派发事件。
- 宽高下限均为 20px；`getColWidth` / `getRowHeight` 越界返回 0，`setColWidth` / `setRowHeight` 越界为空操作。
- `canResizeCol` / `canResizeRow` 返回 `false` 的行列不可拖拽，但程序化 `setColWidth` / `setRowHeight` 不受限制。

## 填充柄

选区焦点段右下角绘制填充柄。按下、拖拽结束、双击分别派发事件；**填充生成不在内核**，宿主负责写值。

```ts
import { ListTable, SheetModel } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

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
  // anchor / target 均为 min/max 序边界
  table.batchUpdate(() => {
    for (let row = anchor.maxRow + 1; row <= target.maxRow; row++) {
      table.updateCell(anchor.minCol, row, row)
    }
  })
})

table.onFillHandleDown(({ range }) => {
  console.log('柄所在段', range) // start/end 可反向
})

table.onFillHandleDoubleClick(({ range }) => {
  console.log('双击自动填充', range)
})
```

事件语义：

| 事件                      | 载荷                 | 说明                                                  |
| ------------------------- | -------------------- | ----------------------------------------------------- |
| `onFillHandleDown`        | `{ range }`          | 柄所在选区段；段方向保留，读取边界先 `normalizeRange` |
| `onFillDragEnd`           | `{ anchor, target }` | 锚定段与拖拽目标，均为 `RangeBounds` min/max 序       |
| `onFillHandleDoubleClick` | `{ range }`          | 与拖拽结束互斥；Excel 语义为按相邻数据区向下自动填充  |

拖拽有轴锁定：行/列位移绝对值大的轴为主轴，相等取纵向，副轴夹回锚定段跨度内。指针停在视口边缘会持续自动滚动。

需要现成填充算法时用 `infinitable/sheet` 的 `computeFillTargetRange` / `generateFill` 纯函数，或直接用 `SheetGrid`（自动接线填充与双击填充）。

## 编辑器注册表与编辑会话

### EditorRegistry

```ts
import { EditorRegistry, type ColumnDefine } from 'infinitable'

const registry = new EditorRegistry((col, row) => (col === 0 && row >= 5 ? 'long-text' : undefined))

registry.registerEditor('text', {})
registry.registerEditor('long-text', {})

const columns: ColumnDefine[] = [
  { title: '名称', width: 160, editor: 'text' },
  { title: '备注', width: 220, editor: 'text', editorMultiline: true },
]

registry.resolveEditor(columns, 0, 6) // => long-text 对应的编辑器对象
```

```ts
class EditorRegistry {
  constructor(route?: (col: number, row: number) => string | undefined)
  registerEditor(name: string, editor: { readonly name?: string }): void
  resolveEditor(
    columns: readonly ColumnDefine[],
    col: number,
    row: number,
  ): { readonly name?: string } | undefined
}
```

- 路由优先：`route(col, row)` 返回的名字优先于列定义 `editor`；最终名字未注册则解析为 `undefined`。
- 注册表是实例级的，不是全局表。跨表复用要么传同一实例，要么各自注册。
- MVP 中注册对象只是「名字已注册」的占位凭证，实际编辑浮层统一是内置文本编辑器（input/textarea），具体形态由列级 `editorMultiline` / `editorMaxLength` 决定。

### 可编判定

`startEdit` 与双击编辑都要求三级判定全部通过：

1. `EditorRegistry.resolveEditor` 命中：列声明了 `editor`，或格级路由给出名字，且该名字已注册。
2. `resolveEditable` 没有对该格返回 `false`（缺省全部可编）。
3. 有回写目标：`model` 形态恒有；`records` 形态要求该列有 `field` 且行对象存在。

::: warning
`model` 形态即使没有实现 `setCellValue`，可编判定仍会通过；提交时写入不会落到模型，但会话、`onEditEnd` 与 `onCellChange` 事件照常触发。需要真正回写时请实现 `setCellValue`。
:::

### 编辑会话

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 620,
  height: 240,
  columns: [
    { title: '名称', width: 160, editor: 'text', editorMaxLength: 20 },
    { title: '备注', width: 260, editor: 'text', editorMultiline: true },
  ],
  model: new SheetModel(16, 2),
  editorRegistry: registry,
  editorMaxLength: 500,
  editorInsideBorder: true,
  editCellOnEnter: true,
  resolveEditable: (col, row) => !(col === 0 && row === 2),
  hostOptions: { container },
})

table.onEditStart(({ col, row, initialValue }) => {
  console.log('开始编辑', col, row, initialValue)
})

table.onCellChange(({ col, row, oldValue, newValue }) => {
  console.log('提交回写', col, row, oldValue, '->', newValue)
})

table.onEditEnd(({ col, row, initialValue, finalValue, committed }) => {
  console.log('结束编辑', col, row, committed, initialValue, finalValue)
})

console.log(table.startEdit(0, 0)) // => true
table.commitEdit()
```

| 成员                           | 说明                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `startEdit(col, row): boolean` | 判定通过才打开浮层；同格重入幂等，异格先提交当前会话。进入前会选中该格并滚动到完整可见 |
| `commitEdit(): boolean`        | 提交当前会话；不移动选区（编辑器内 Enter/Tab 提交才移动）；无会话返回 `false`          |
| `cancelEdit(): void`           | 取消当前会话；无会话为空操作                                                           |
| `isEditing(): boolean`         | 当前是否有会话                                                                         |
| `editPickMode: boolean`        | 拾取模式，缺省 `false`；为 `true` 时点击其它格不提交，焦点移出画布也不终止             |
| `onEditStart`                  | `{ col, row, initialValue }`，会话真正打开后派发                                       |
| `onCellChange`                 | `{ col, row, oldValue, newValue }`，编辑提交且值实际变化后派发                         |
| `onEditEnd`                    | `{ col, row, initialValue, finalValue?, committed }`，会话结束后派发                   |

行为细节：

- **初值口径**：编辑拿到的是基础值，未过 `resolveDisplayValue`。公式格要「所见即所编」需要模型层在 `getCellValue` 返回原文（`SheetGrid` 即此口径）。
- **提交序**：写回数据源 → 该格 cell 级失效 → `onCellChange` → `onEditEnd`（`committed: true`，带终值）。编辑器内 Enter / Tab 提交时随后移动选区（Enter 下移、Tab 右移）；宿主直接调用 `table.commitEdit()` 不移动选区。
- **无操作提交**：提交文本与初值文本相同则跳过写回、刷新与 `onCellChange`，但会话结束、焦点恢复照常；若本次提交带移动请求（Enter/Tab），选区移动也照常。
- **取消**：不回写、不抛 `onCellChange`，抛 `onEditEnd`（`committed: false`，无终值），焦点交还表格。
- **键位**：Enter 提交并下移，Tab 提交并右移，Esc 取消。`editorMultiline: true` 时 Enter 仍是提交；需要「多行内换行」必须宿主自行接管键位。
- **字符上限**：列级 `editorMaxLength` 优先于 `options.editorMaxLength`；未配置不截断。
- **滚动跟随**：编辑中浮层逐帧对齐锚定格；锚定格滚出视口按 Enter 语义自动提交。
- **失焦**：焦点移出画布时缺省按提交语义结束会话但不抢回焦点；`editPickMode = true` 时保持会话。
- **编辑期内容**：锚定格内容暂时隐藏（DOM 浮层取代内容渲染），会话结束恢复。
- **`editorInsideBorder`**：`true` 时浮层按锚定格四周可视边框线宽内缩（含浮层自带边框骑缘补偿），浮层落在边框内侧，粗边框编辑期保持可见；缺省 `false` 时浮层骑格缘，盖住本格自画的 right/bottom 边框。
- **双击进入**：双击/双触同格且位移、时长在阈值内才进入编辑；拾取模式下抬起不触发双击进编辑与链接单击。

多行编辑器示例中，Enter 提交、Tab 右移、Esc 取消都由内置编辑器拦截，不会冒泡到表格键盘导航。

## 相关

- [ListTable API](/api/list-table)：选区、滚动、事件、冻结、合并与编辑会话的方法清单。
- [数据供给与模型](/guide/data-models)：编辑回写目标与 `updateCell` / `refreshCell` 的差异。
- [电子表格（sheet）](/guide/sheet)：`SheetGrid` 的填充、选区同步与编辑器装配。
- [主题与样式](/guide/theming)：选区、填充柄、resize 线与冻结分隔线的 token。
