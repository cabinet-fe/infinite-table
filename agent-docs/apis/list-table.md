---
title: ListTable 表格主类
description: infinitable 表格主类 ListTable 与构造选项 ListTableOptions：数据三形态（records/model/rowCount+hook）、虚拟滚动 API、冻结与合并运行时变更、事件订阅（onCellChange/onSelectionChange/onScrollFrame 等）、插件注册与生命周期。含 TableModel/SheetModel/ModelBinding/ScrollManager。
aliases: [Table, DataTable, Grid, 表格, ListTable]
keywords: [ListTable, ListTableOptions, ColumnDefine, records, model, rowCount, resolveDisplayValue, TableModel, SheetModel, scrollBy, batchUpdate, updateCell, frozenColCount, mergeCells, setMergeCells, onCellChange, onSelectionChange, 虚拟滚动, 合并单元格, merge ranges overlap]
---

# ListTable 表格主类

`infinitable`（core 层）导出表格主类 `ListTable` 与构造选项 `ListTableOptions`。构造时按可视窗口建场景（窗口外行列不进入场景树），滚动由 `ScrollManager` 唯一状态源驱动并按方向提交 band 失效；数据供给三形态任选其一：`records` 数组、`model`（TableModel，如 `SheetStore.asModel()` 或 `SheetModel`）、`rowCount` + `resolveDisplayValue` 钩子。

## 快速上手

```ts
import { ListTable } from 'infinitable'

// 容器：position 非 static（四层 canvas 以绝对定位叠放其内）
const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { field: 'name', title: '名称', width: 160 },
    { field: 'score', title: '分数', width: 100 },
  ],
  records: Array.from({ length: 100_000 }, (_, i) => ({ name: `行 ${i}`, score: i })),
  hostOptions: { container }, // 不传 host 时引擎经 hostOptions 自建 RenderHost
})

// 滚轮滚动由宿主接线（引擎内置触控/键盘/滚动条，滚轮不内置）
container.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    table.scrollBy(e.deltaX, e.deltaY)
  },
  { passive: false },
)

// => 画布上渲染行列头 + 可视区数据格；滚动时只重绘对应 band
```

## API 签名

```ts
/** records 形态的一行数据 */
export type DataRecord = Record<string, unknown>

/** 列定义（records/columns 数组形态的取值与表头描述） */
export interface ColumnDefine {
  /** records 取值字段；缺省时该列无数组值（仍可经 hook / 模型供给） */
  field?: string
  /** 列头标题 */
  title?: string
  /** 列宽（缺省用 ListTableOptions.defaultColWidth） */
  width?: number
  /** 内置单元格类型（缺省 'text'） */
  cellType?: 'text' | 'checkbox'
  /** 该列单元格的编辑器注册名（EditorRegistry 格级路由的列级来源） */
  editor?: string
  /** 该列编辑器多行形态：true 走 textarea（缺省单行 input） */
  editorMultiline?: boolean
  /** 该列编辑器字符上限（覆盖 options.editorMaxLength）；未配置沿 options 级 */
  editorMaxLength?: number
  /** 该列文本自动换行：超宽文本在格内断行，不向右侧空格溢出 */
  textWrap?: boolean
  /** 列级样式片段（覆盖链「主题分区 token → 列级 → 按格 hook」） */
  style?: CellStyle
}

/** 按格显示 hook：纯函数、同步、O(1)；value 为基础值，返回最终显示文本 */
export type ResolveDisplayValue = (col: number, row: number, value: unknown) => string

/** 外部数据模型（模型事件订阅形态） */
export interface TableModel {
  readonly rowCount?: number
  getCellValue(col: number, row: number): unknown
  setCellValue?(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}

/** 模型单元格变更事件 */
export interface CellChangeEvent {
  col: number
  row: number
  oldValue: unknown
  newValue: unknown
}

/** 格坐标（0 基；统一入口以 GridCellRef 别名导出，A1 引用的 CellRef 在 formulas 层） */
export interface CellRef {
  col: number
  row: number
}

export interface ListTableOptions {
  width: number
  height: number
  columns: ColumnDefine[]
  records?: readonly DataRecord[]
  rowCount?: number
  model?: TableModel
  resolveDisplayValue?: ResolveDisplayValue
  resolveCellStyle?: ResolveCellStyle
  resolveCellRenderer?: ResolveCellRenderer
  resolveCellImage?: ResolveCellImage
  resolveEditable?: (col: number, row: number) => boolean
  editCellOnEnter?: boolean
  editorRegistry?: EditorRegistry
  editorMaxLength?: number
  imageServiceOptions?: ImageServiceOptions
  frozenColCount?: number
  frozenRowCount?: number
  mergeCells?: readonly CellRange[]
  rowHeight?: number
  defaultColWidth?: number
  headerHeight?: number
  rowHeaderWidth?: number
  showColHeader?: boolean
  showRowHeader?: boolean
  host?: RenderHost
  hostOptions?: Omit<RenderHostOptions, 'width' | 'height'>
  theme?: ThemeOverride
  plugins?: readonly TablePlugin[]
  canResizeCol?: (col: number) => boolean
  canResizeRow?: (row: number) => boolean
  ctrlMultiSelect?: boolean
  scrollbar?: boolean
}

export class ListTable {
  constructor(options: ListTableOptions)
  get width(): number
  get height(): number
  readonly options: ListTableOptions
  readonly host: RenderHost
  readonly scroll: ScrollManager
  readonly selection: SelectionState
  readonly editManager: EditManager
  readonly editorRegistry: EditorRegistry
  readonly imageService: ImageService
  get floatObjects(): FloatObjectLayer
  getTheme(): TableTheme
  updateTheme(override: ThemeOverride): void
  use(plugin: TablePlugin): void
  destroy(): void
}

/** 唯一滚动状态源：所有滚动经此收敛并广播 (state, delta) */
export class ScrollManager {
  get state(): ScrollState
  get maxLeft(): number
  get maxTop(): number
  setContentSize(width: number, height: number): void
  setViewportSize(width: number, height: number): void
  scrollTo(left: number, top: number): void
  scrollBy(dx: number, dy: number): void
  onScroll(listener: (state: ScrollState, delta: ScrollDelta) => void): () => void
}

/** 内置内存坐标模型：实现 TableModel，写值同步通知订阅者 */
export class SheetModel implements TableModel {
  constructor(rowCount: number, colCount: number)
  constructor(initialCells: readonly (readonly unknown[])[])
  get rowCount(): number
  setRowCount(rowCount: number): void
  getCellValue(col: number, row: number): unknown
  setCellValue(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}

/** 模型事件订阅绑定：外部变更 → 局部刷新；回驱 echo 收集防回环 */
export class ModelBinding {
  constructor(model: TableModel, onExternalChange: (change: CellChangeEvent) => void)
  attach(): void
  writeBack(col: number, row: number, value: unknown): readonly CellChangeEvent[]
  dispose(): void
}

/** 取值管线：基础值优先级 model > records 字段；resolveDisplayValue 作用末端 */
export class CellValuePipeline {
  constructor(init: CellValuePipelineInit)
  get rowCount(): number
  resolveText(col: number, row: number): string
  resolveValue(col: number, row: number): unknown
}

/** 插件契约：构造传入或 table.use() 注册即挂载，销毁逆序卸载 */
export interface TablePlugin {
  readonly name: string
  mount(table: ListTable): void
  unmount?(table: ListTable): void
}
```

## 参数说明

ListTableOptions 全部字段（五要素）：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `width` / `height` | `number` | — | 是 | 表格视口尺寸（CSS 像素）；构造后经 `resize()` 原地调整 |
| `columns` | `ColumnDefine[]` | — | 是 | 列平面；表格列数 = `columns.length` |
| `records` | `readonly DataRecord[]` | — | 否 | 数组形态数据；行数兜底取 `records.length` |
| `model` | `TableModel` | — | 否 | 模型直挂形态；给了 `model` 则基础值一律走模型（优先于 records） |
| `rowCount` | `number` | — | 否 | 无 records、模型也未给 rowCount 时（纯 hook 形态）的行数兜底 |
| `resolveDisplayValue` | `(col, row, value) => string` | — | 否 | 作用于取值管线末端，可与另两形态叠加 |
| `resolveCellStyle` | `(col, row) => CellStyle \| null` | — | 否 | 按格样式 hook，返回 null 沿用基础样式 |
| `resolveCellRenderer` | `(col, row) => CellRenderer \| null` | — | 否 | 返回渲染器即接管该格内容绘制 |
| `resolveCellImage` | `(col, row) => string \| null` | — | 否 | 返回 URL 的格按图片渲染（L2 media 层） |
| `resolveEditable` | `(col, row) => boolean` | — | 否 | 返回 false 该格不可编（缺省全部可编） |
| `editCellOnEnter` | `boolean` | `false` | 否 | 开启后非编辑态按 Enter 进入焦点格编辑 |
| `editorRegistry` | `EditorRegistry` | 空表 | 否 | 可编第一级判定与格级路由；也可事后经 `table.editorRegistry` 注册 |
| `editorMaxLength` | `number` | 不截断 | 否 | 编辑器字符上限；列级 `editorMaxLength` 优先 |
| `imageServiceOptions` | `ImageServiceOptions` | `maxCacheBytes: 256MB`、`maxCacheCount: 1000`、`concurrency: 10`、`placeholderDelay: 80` | 否 | 位图 LRU 预算/并发/占位延迟/加载器注入 |
| `frozenColCount` | `number` | `0` | 否 | 左侧冻结列数（数据列，不含行号列），构造时夹取到 [0, 列数] |
| `frozenRowCount` | `number` | `0` | 否 | 顶部冻结行数（数据行，不含列头），构造时夹取到 [0, 行数] |
| `mergeCells` | `readonly CellRange[]` | `[]` | 否 | 闭区间；重叠抛错、越出表格抛错；跨冻结边界合法 |
| `rowHeight` | `number` | 主题 `rowHeight`（32） | 否 | 全表行高基准；逐行覆盖走 `setRowHeight` |
| `defaultColWidth` | `number` | 主题 `defaultColWidth`（100） | 否 | 列未给 width 时的列宽 |
| `headerHeight` | `number` | 主题 `headerHeight`（36） | 否 | 列头高度；`showColHeader: false` 时归一化为 0（忽略显式值） |
| `rowHeaderWidth` | `number` | 主题 `rowHeaderWidth`（48） | 否 | 行号列宽；`showRowHeader: false` 时归一化为 0 |
| `showColHeader` | `boolean` | `true` | 否 | false 关闭列头，内容原点上移到 y=0 |
| `showRowHeader` | `boolean` | `true` | 否 | false 关闭行号列，内容原点左移到 x=0 |
| `host` | `RenderHost` | 自建 | 否 | 注入渲染宿主；注入后 destroy 不销毁宿主 |
| `hostOptions` | `Partial<RenderHostOptions>` | — | 否 | 未注入 host 时创建 RenderHost 的参数（width/height 取视口尺寸） |
| `theme` | `ThemeOverride` | 默认主题 | 否 | 基于默认主题 extends 派生 |
| `plugins` | `readonly TablePlugin[]` | `[]` | 否 | 构造即挂载生效（先于首帧场景重建） |
| `canResizeCol` | `(col) => boolean` | 全部允许 | 否 | 返回 false 禁止该列拖拽改宽 |
| `canResizeRow` | `(row) => boolean` | 全部允许 | 否 | 返回 false 禁止该行拖拽改高 |
| `ctrlMultiSelect` | `boolean` | `false` | 否 | 开启后 Ctrl/Cmd 点数据格追加选区段 |
| `scrollbar` | `boolean` | `true` | 否 | 内建滚动条：内容溢出该轴才显示，支持拖滑块/点轨道 |

`CellRange`（合并区，闭区间）：`{ startCol, startRow, endCol, endRow }`，构造与 `setMergeCells` 前先归一化（start ≤ end），1×1 单格区间不算合并。

## 方法与事件

实例方法（均为同步）：

- `getTheme(): TableTheme` — 当前生效主题。
- `updateTheme(override: ThemeOverride): void` — 以当前主题为 base 深覆盖合并（可多次调用累积），重建场景并整层失效；不触碰滚动/选区/冻结；几何 token 已生效值不重算。
- `use(plugin: TablePlugin): void` — 注册即挂载；构造期 `plugins` 数组同一路径。
- `scrollTo(left, top)` / `scrollBy(dx, dy)` — 位置自动夹取到 `[0, max]`。
- `getScrollState()` / `getScrollLeft()` / `getScrollTop()` / `setScrollLeft(left)` / `setScrollTop(top)`。
- `getVisibleRange(): { rows: WindowRange; cols: WindowRange }` — 当前滚动窗口（[start, end)，不含冻结区）。
- `getBodyVisibleCellRange()` — 可视数据格范围（冻结行列并入）。
- `scrollToCell(cell: CellRef): void` — 滚动到目标格完整可见（冻结轴恒可见跳过）。
- `getCellText(col, row): string` — 最终显示文本（经取值管线，同步 O(1)）；被合并覆盖的格取主格文本。
- `updateCell(col, row, value): void` — 表格回驱模型（仅 model 形态生效；无 binding 直接返回）。模型同步 echo 回来的派生格变更收集去重后统一局部刷新。
- `refreshCell(col, row): void` — 局部刷新单格（cell 级失效；合并区失效为主格包围盒）。
- `batchUpdate(fn: () => void): void` — fn 内多次变更的失效区域收集，结束时只提交一次 band 失效。
- `resize(width, height): void` — 原地调整视口（不重建实例）；滚动位置与选区保留。
- `getColWidth(col)` / `setColWidth(col, width)` / `getRowHeight(row)` / `setRowHeight(row, height)` — 越界索引为空操作/返回 0；宽度夹取最小 20px。
- `getFrozenColCount()` / `setFrozenColCount(count)` / `getFrozenRowCount()` / `setFrozenRowCount(count)` — 运行时修改夹取到 [0, 列数/行数]。
- `setMergeCells(ranges)` / `addMergeCell(range)` / `removeMergeCell(range)` — 运行时整体替换/新增/移除合并区；重叠或越界抛错并保持原状；`removeMergeCell` 按归一化后精确匹配，未命中为空操作。
- `getCellRelativeRect(col, row): Region | null` — 数据格视口矩形（CSS 像素）；窗口外返回 null。
- `getCellAtRelativePosition(x, y): CellRef | null` — 视口坐标命中数据格；点在行列头/空白处返回 null。
- `getDrawRange(): Region` — 内容区矩形（扣除行号列与列头）。
- `isSeriesNumber(col, row): boolean` — 是否行号列格。
- `getHeaderLevelCount(): number` — 恒 1（列头固定一层）。
- `startEdit(col, row): boolean` / `commitEdit(): boolean` / `cancelEdit(): void` / `isEditing(): boolean` — 编辑会话 API。`startEdit` 三级判定全通过才打开浮层并返回 true（① 列声明 `editor` 或格级路由命中 `EditorRegistry` 已注册名；② `resolveEditable` 未拒绝；③ 有回写目标——model 形态恒有、records 形态列须有 `field` 且行对象存在）；不可编返回 false 且无浮层；编辑中锚定格滚出视口按 Enter 语义自动提交。键位：Enter 提交并下移、Tab 提交并右移、Esc 取消。
- `setUnderlayPainter(painter | null)` / `setOverlayPainter(painter | null)` — ground 层（内容之下）/sky 层最顶（内容之上）整层绘制预留位，锚定视口不随滚动平移。
- `setHighlightRanges(ranges)` — sky 浮层宿主高亮区（公式引用染色框等）。
- `setSelectionAnchor(anchor | null)` — 编辑拾取会话的选区锚点绘制。
- `selectCell(col, row)` / `selectCells(ranges)` / `selectRow(row)` / `selectCol(col)` / `selectAll()` / `clearSelection()` — 程序化选区。
- `getSelection(): SelectionSnapshot` / `getSelectedCellRanges(): SelectionRange[]` / `applyExternalSelection(snapshot)`（钳制到数据区、不广播防回环）。
- `destroy(): void` — 幂等；逆序卸载插件、解绑事件、销毁自建 host。

事件订阅（全部返回退订函数）：

| 方法 | 触发 | 载荷 |
| --- | --- | --- |
| `onCellChange` | 编辑提交回写后 | `{ col, row, oldValue, newValue }` |
| `onEditStart` | 编辑会话打开（可编判定通过且浮层已开） | `{ col, row, initialValue }`（基础值口径） |
| `onEditEnd` | 会话结束（提交在 onCellChange 之后） | `{ col, row, initialValue, finalValue?, committed }` |
| `onSelectionChange` | 选区变更 | `SelectionSnapshot` |
| `onScrollFrame` | 滚动帧（同帧多次滚动只触发一次） | `ScrollState` |
| `onContextMenu` | 右键 | `{ cell: CellRef \| null, region: 'body' \| 'row-header' \| 'col-header', x, y, originalEvent }` |
| `onColResizeEnd` / `onRowResizeEnd` | 列宽/行高拖拽会话结束 | `{ col, width }` / `{ row, height }`（夹取后生效值） |
| `onFillHandleDown` / `onFillDragEnd` / `onFillHandleDoubleClick` | 填充柄按下/拖拽结束/双击 | 按下载荷 `{ range }`（柄所在选区段，start/end 可反向）；拖拽结束载荷 `{ anchor, target }`（均 min/max 序，轴锁定：位移绝对值大的轴为主轴、相等取纵向）；双击与拖拽结束互斥。填充生成不在内核，写入由宿主完成 |

`ScrollManager`：`scrollTo`/`scrollBy` 位置未变时不广播；`state` 返回 `{ left, top }`；`maxLeft`/`maxTop` = `max(0, content - viewport)`。

`SheetModel`：`setCellValue` 越界（含负坐标）为空操作；`getCellValue` 越界返回 undefined；`setRowCount` 扩大补空行、缩小截断。

`ModelBinding.writeBack(col, row, value)`：模型未提供 `setCellValue` 或重入时返回空数组不写入；正常返回本次回驱窗口内模型 echo 的变更格（去重保序）。

## 典型示例

### 模型直挂（SheetModel 驱动可编辑表）

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {}) // 注册名与列定义 editor 对应；空对象即占位编辑器
const model = new SheetModel([
  ['名称-0', '备注-0'],
  ['名称-1', '备注-1'],
])

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 620,
  height: 220,
  columns: [
    { title: '名称', width: 160, editor: 'text' },
    { title: '备注', width: 220, editor: 'text', editorMultiline: true },
  ],
  model,
  editorRegistry: registry,
  hostOptions: { container },
})

table.onCellChange((change) => {
  console.log(change.col, change.row, change.oldValue, '->', change.newValue)
  // => 0 0 '名称-0' -> '改名'（双击编辑提交后）
})
```

### 纯 hook 形态（rowCount + resolveDisplayValue，10 万行）

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 660,
  height: 360,
  columns: [
    { title: '编号', width: 120 },
    { title: '部门', width: 160 },
    { title: '金额', width: 160 },
  ],
  rowCount: 100_000,
  resolveDisplayValue: (col, row) => {
    if (col === 0) return `NO-${row + 1}`
    if (col === 1) return `部门-${(row % 8) + 1}`
    return `${((row * 37) % 900) + 100}.00`
  },
  hostOptions: { container },
})
table.scrollTo(0, 3200) // 滚动到第 100 行附近，仍只有可视区进场景
```

### 冻结 + 合并 + 批量写收敛

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 760,
  height: 420,
  columns: [
    { field: 'id', title: 'ID', width: 80 },
    { field: 'name', title: '名称', width: 140 },
    { field: 'note', title: '备注', width: 160 },
  ],
  records: Array.from({ length: 1000 }, (_, row) => ({
    id: `ID-${row}`,
    name: `商品-${row}`,
    note: `备注-${row}`,
  })),
  frozenColCount: 1,
  frozenRowCount: 1,
  mergeCells: [{ startCol: 1, startRow: 2, endCol: 2, endRow: 3 }],
  hostOptions: { container },
})

// 批量改 2000 格：所有 cell 失效合并为一次 band 提交
table.batchUpdate(() => {
  for (let row = 0; row < 1000; row++) {
    table.updateCell(1, row, `改-${row}`)
  }
})

table.setFrozenColCount(2) // 运行时改冻结（跨冻结边界的既有合并区合法）
```

## 注意事项

> [!WARNING]
> - 鼠标滚轮滚动不内置：引擎内置触控惯性/键盘/内建滚动条，滚轮必须宿主自行 `container.addEventListener('wheel', ...)` 接线到 `table.scrollBy`（`preventDefault` + `passive: false`）。
> - `CellRef` 在统一入口有两个：core 的格坐标以 `GridCellRef` 导出，`CellRef` 是 formulas 层的 A1 引用（含 `colAbsolute`/`rowAbsolute`/`sheet` 字段）。
> - 合并区重叠构造即抛错：`merge ranges overlap at (col, row): [startCol,startRow ~ endCol,endRow]`；越出表格抛 `assertMergesWithinTable` 系列错误。跨冻结边界的合并区合法（主格按冻结带钉固绘制）。
> - `updateCell` 只对 model 形态生效；records 形态直接改行对象字段后调 `refreshCell`。
> - `updateTheme` 不重算已生效的 rowHeight/headerHeight/rowHeaderWidth/defaultColWidth 几何值；运行时改行列尺寸走 `setRowHeight`/`setColWidth`。
> - 表头层数恒 1：`getHeaderLevelCount()` 固定返回 1，多级表头不在当前版本能力内。
> - destroy 后再调用渲染相关方法行为未定义；构造传入了 `host` 时 destroy 不销毁该 host（宿主自管）。

## 常见问题

### 报错 `merge ranges overlap at (2, 2): [1,1 ~ 3,3]`

原因：`mergeCells`（或 `setMergeCells`/`addMergeCell`）传入的区间互相重叠。修复：区间互斥后再传入。

```ts
import { ListTable } from 'infinitable'

const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }],
  rowCount: 10,
  // 修复前：[{ startCol: 1, startRow: 1, endCol: 3, endRow: 3 }, { startCol: 2, startRow: 2, endCol: 2, endRow: 2 }]
  mergeCells: [{ startCol: 1, startRow: 1, endCol: 3, endRow: 3 }], // 只保留互斥区间
  hostOptions: { container: document.querySelector<HTMLDivElement>('#table')! },
})
```

### 双击单元格没反应（进不了编辑）

原因：可编三级判定全通过才开浮层——① 列声明 `editor` 或格级路由命中 `EditorRegistry` 已注册的名字；② `resolveEditable` 未对该格返回 false；③ 有回写目标（model 形态恒有；records 形态该列须有 `field` 且行对象存在）。修复：注册编辑器并声明列。

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {}) // 注册表里没有名字时，列声明 editor: 'text' 也判定不可编
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ title: '名称', editor: 'text' }],
  model: new SheetModel(20, 1),
  editorRegistry: registry,
  hostOptions: { container: document.querySelector<HTMLDivElement>('#table')! },
})
```
