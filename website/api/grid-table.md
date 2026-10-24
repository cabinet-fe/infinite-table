---
title: 共享类型与模型（grid / table）
description: grid 与 table 两层的公共 API：SheetModel 与 TablePlugin、主题与样式投影、选区类型与归一化、编辑器注册表与 CellRenderer、合并区集合与重叠消解、媒体与浮动对象、ground/sky 绘制预留位。
---

# 共享类型与模型（grid / table）

本页覆盖 `infinitable` 主入口中来自 grid 与 table 两层、且不属于 `ListTable` 主类的公共 API：主题、样式、选区与合并原语定义在 `@infinitable/grid`，模型、编辑、媒体与绘制预留位定义在 `@infinitable/table`。`ListTable` 与其构造选项见 [/api/list-table](/api/list-table)。

> 本页签名中的格坐标统一写作 `GridCellRef`（统一入口的消歧别名）。grid 源码内部的类型名为 `CellRef`，字段同为 `{ col, row }`。

索引：

- [SheetModel 与 TablePlugin](#sheetmodel-与-tableplugin)
- [主题](#主题)
- [样式](#样式)
- [选区](#选区)
- [编辑](#编辑)
- [合并](#合并)
- [媒体与浮动对象](#媒体与浮动对象)
- [绘制预留位](#绘制预留位)

## SheetModel 与 TablePlugin

### SheetModel

内置内存坐标模型，实现 `TableModel`。适合不准备 `records`、但需要开箱编辑与回写通知的场景。

```ts
export class SheetModel implements TableModel {
  constructor(rowCount: number, colCount: number)
  constructor(initialCells: readonly (readonly unknown[])[])
  get rowCount(): number
  setRowCount(rowCount: number): void
  getCellValue(col: number, row: number): unknown
  setCellValue(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}
```

| 成员             | 签名                                 | 说明                                |
| ---------------- | ------------------------------------ | ----------------------------------- |
| 构造（空表）     | `new SheetModel(rowCount, colCount)` | 按行列数创建，初始全为空            |
| 构造（二维数组） | `new SheetModel(initialCells)`       | 内部拷贝一份；列数取最长行          |
| `rowCount`       | `get rowCount(): number`             | 当前行数，随 `setRowCount` 即时生效 |
| `setRowCount`    | `(rowCount: number): void`           | 扩大补空行，缩小截断                |
| `getCellValue`   | `(col, row): unknown`                | 越界（含负坐标）返回 `undefined`    |
| `setCellValue`   | `(col, row, value): void`            | 越界为空操作；写值后同步通知订阅者  |
| `onCellChange`   | `(listener) => () => void`           | 订阅变更；返回退订函数              |

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const model = new SheetModel([
  ['名称-0', '备注-0'],
  ['名称-1', '备注-1'],
])

const table = new ListTable({
  width: 620,
  height: 220,
  columns: [
    { title: '名称', width: 160, editor: 'text' },
    { title: '备注', width: 220, editor: 'text', editorMultiline: true },
  ],
  model,
  editorRegistry: registry,
  hostOptions: { container: document.querySelector<HTMLDivElement>('#table')! },
})
```

### TablePlugin

```ts
export interface TablePlugin {
  readonly name: string
  /** 挂载：构造传入 plugins 或引擎 use() 注册时立即调用；参数为引擎装配协议面 */
  mount(engine: EngineAssembly): void
  /** 卸载：引擎销毁时按注册逆序调用 */
  unmount?(engine: EngineAssembly): void
}
```

| 成员      | 类型                                       | 说明                                                |
| --------- | ------------------------------------------ | --------------------------------------------------- |
| `name`    | `readonly string`                          | 插件名                                              |
| `mount`   | `(engine: EngineAssembly) => void`         | 构造传入 `plugins` 或调用 `engine.use()` 时立即执行 |
| `unmount` | `(engine: EngineAssembly) => void`（可选） | 引擎销毁时按注册逆序调用                            |

挂载参数是 `EngineAssembly` 装配协议面（渲染宿主、数据面、主题、painter 槽位、插件槽位与生命周期），不是 `ListTable` 具体类型：`ListTable` 与 pivot 引擎 `PivotGrid` 等平级引擎都实现该面，只依赖协议面的插件可跨引擎挂载。需要表格领域能力（如 `chartMediaResolver`）的插件把参数收窄为 `ListTable`（实现 `TableEngine` 协议面）。协议面成员清单与挂载细节见[插件开发](/guide/plugin-development)。

```ts
import type { TablePlugin } from 'infinitable'

const plugin: TablePlugin = {
  name: 'demo-overlay',
  mount(engine) {
    engine.setOverlayPainter((ctx, viewport) => {
      ctx.fillStyle = 'rgba(31, 35, 41, 0.05)'
      ctx.fillRect(0, viewport.height - 24, viewport.width, 24)
    })
  },
  unmount(engine) {
    engine.setOverlayPainter(null)
  },
}

table.use(plugin)
```

## 主题

### TableTheme

```ts
export interface CellStyleTokens {
  font: string
  color: string
  background: string
  borderColor: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  fontWeight?: number | string
  fontStyle?: string
  fontSize?: number
  fontFamily?: string
  underline?: boolean
  lineThrough?: boolean
  textOverflow?: 'ellipsis' | 'clip'
  padding?: [top: number, right: number, bottom: number, left: number]
  border?: CellBorder
}

export interface InteractionTokens {
  selectionFill: string
  selectionBorder: string
  selectionBorderWidth: number
  fillHandle: string
  resizeLine: string
  resizeLineWidth: number
  headerHighlight: string
  freezeDividerColor: string
  freezeDividerWidth: number
  scrollbarThumb: string
  scrollbarThumbHover: string
  scrollbarThumbActive: string
  scrollbarRadius: number
  scrollbarSize: number
  scrollbarTrackColor: string
  scrollbarMargin: number
  scrollbarMarginHover: number
  scrollbarHideDelay: number
}

export interface FrameStyle {
  lineWidth: number
  color: string
  shadow: boolean
}

export interface TableTheme {
  rowHeight: number
  headerHeight: number
  rowHeaderWidth: number
  defaultColWidth: number
  body: CellStyleTokens
  header: CellStyleTokens
  rowHeader: CellStyleTokens
  corner: CellStyleTokens
  underlayBackgroundColor: string
  linkColor: string
  interaction: InteractionTokens
  frameStyle: FrameStyle
}

export interface ThemeOverride {
  rowHeight?: number
  headerHeight?: number
  rowHeaderWidth?: number
  defaultColWidth?: number
  body?: Partial<CellStyleTokens>
  header?: Partial<CellStyleTokens>
  rowHeader?: Partial<CellStyleTokens>
  corner?: Partial<CellStyleTokens>
  underlayBackgroundColor?: string
  linkColor?: string
  interaction?: Partial<InteractionTokens>
  frameStyle?: Partial<FrameStyle>
}

export function extendsTheme(override?: ThemeOverride, base?: TableTheme): TableTheme
```

| 字段                                                                | 类型                | 说明                                                                   |
| ------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| `rowHeight` / `headerHeight` / `rowHeaderWidth` / `defaultColWidth` | `number`            | 几何 token；构造期生效，`updateTheme` 不重算已生效值                   |
| `body` / `header` / `rowHeader` / `corner`                          | `CellStyleTokens`   | 数据格、列头、行号列、左上角四个样式分区                               |
| `underlayBackgroundColor`                                           | `string`            | 数据区底色，铺在格背景之下                                             |
| `linkColor`                                                         | `string`            | 超链接格默认字色；下划线随链接自动注入，可被 `resolveCellStyle` 覆盖   |
| `interaction`                                                       | `InteractionTokens` | 选区、填充柄、resize 指示线、冻结分隔线与内建滚动条的唯一颜色/尺寸来源 |
| `frameStyle`                                                        | `FrameStyle`        | 表格外框线宽、颜色与阴影                                               |

`extendsTheme(override, base)` 的行为：

- `override` 缺省 `{}`，`base` 缺省内置默认主题。
- 标量 token 未给时继承 `base`；嵌套对象按键深覆盖。
- `rowHeader` / `corner` 先随「生效 header」派生（`{ ...生效 header, ...override.rowHeader }`），再应用各自显式覆盖键。
- 返回新对象，不修改入参。

默认主题关键值（可用 `extendsTheme()` 或 `table.getTheme()` 读取）：

| 键                                                                            | 默认值                                                                       |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rowHeight`                                                                   | `32`                                                                         |
| `headerHeight`                                                                | `36`                                                                         |
| `rowHeaderWidth`                                                              | `48`                                                                         |
| `defaultColWidth`                                                             | `100`                                                                        |
| `body` / `header` / `rowHeader` / `corner` 字体                               | `12px sans-serif`                                                            |
| 前景色 / 表头底色 / 网格线                                                    | `#1f2329` / `#f5f6f7` / `#e5e6eb`                                            |
| `underlayBackgroundColor`                                                     | `#ffffff`                                                                    |
| `linkColor`                                                                   | `#0563c1`                                                                    |
| `interaction.selectionFill` / `selectionBorder` / `selectionBorderWidth`      | `rgba(46, 106, 219, 0.08)` / `#2e6adb` / `2`                                 |
| `interaction.fillHandle` / `resizeLine` / `resizeLineWidth`                   | `#2e6adb` / `#2e6adb` / `2`                                                  |
| `interaction.headerHighlight`                                                 | `rgba(46, 106, 219, 0.18)`                                                   |
| `interaction.freezeDividerColor` / `freezeDividerWidth`                       | `#c9cdd4` / `1`                                                              |
| `interaction.scrollbarThumb` / `scrollbarThumbHover` / `scrollbarThumbActive` | `rgba(31, 35, 41, 0.4)` / `rgba(31, 35, 41, 0.55)` / `rgba(31, 35, 41, 0.7)` |
| `interaction.scrollbarRadius` / `scrollbarSize`                               | `4` / `10`                                                                   |
| `interaction.scrollbarTrackColor`                                             | `#f0f1f3`                                                                    |
| `interaction.scrollbarMargin` / `scrollbarMarginHover`                        | `2` / `1`                                                                    |
| `interaction.scrollbarHideDelay`                                              | `1500`（ms）                                                                 |
| `frameStyle.lineWidth` / `color` / `shadow`                                   | `0` / `#e5e6eb` / `false`                                                    |

```ts
import { extendsTheme, type ThemeOverride } from 'infinitable'

const dark: ThemeOverride = {
  underlayBackgroundColor: '#111318',
  body: { color: '#e5e6eb', background: '#16181d', borderColor: '#2b2f36' },
  header: { color: '#e5e6eb', background: '#1d2026', borderColor: '#2b2f36' },
  linkColor: '#60a5fa',
  interaction: {
    selectionFill: 'rgba(96, 165, 250, 0.16)',
    selectionBorder: '#60a5fa',
    scrollbarThumb: 'rgba(229, 230, 235, 0.4)',
  },
}

const theme = extendsTheme(dark)
console.log(theme.rowHeight) // 32：未覆盖键继承默认主题
console.log(theme.rowHeader.background) // '#1d2026'：随生效 header 派生
```

::: tip
`defaultTheme` 常量不对外导出。需要默认主题值时用 `extendsTheme()` 派生结果或 `table.getTheme()` 读取；分区 token 结构（`CellStyleTokens` / `InteractionTokens` / `FrameStyle`）也未单独导出，它们作为 `TableTheme` 的字段形态出现。
:::

## 样式

```ts
export interface CellBorderEdge {
  width: number
  color: string
  style?: 'solid' | 'dashed' | 'dotted' | 'double'
  grid?: boolean
}

export interface CellBorder {
  top?: CellBorderEdge
  right?: CellBorderEdge
  bottom?: CellBorderEdge
  left?: CellBorderEdge
}

export interface CellStyle {
  background?: string
  color?: string
  font?: string
  textAlign?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  fontWeight?: number | string
  fontStyle?: string
  fontSize?: number
  fontFamily?: string
  underline?: boolean
  lineThrough?: boolean
  textWrap?: boolean
  textOverflow?: 'ellipsis' | 'clip'
  padding?: [top: number, right: number, bottom: number, left: number]
  border?: CellBorder
}

export function projectCellStyle(base: CellStyle, override: CellStyle | null | undefined): CellStyle
```

| 字段                                                   | 类型                                                | 默认                      | 说明                                                          |
| ------------------------------------------------------ | --------------------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| `background` / `color`                                 | `string`                                            | 来自主题分区              | 背景与前景色                                                  |
| `font`                                                 | `string`                                            | `12px sans-serif`         | CSS `font` 简写；给定结构化字体字段时被组装结果取代           |
| `textAlign`                                            | `'left' \| 'center' \| 'right'`                     | `left`                    | 水平对齐                                                      |
| `verticalAlign`                                        | `'top' \| 'middle' \| 'bottom'`                     | `middle`                  | 垂直对齐                                                      |
| `fontWeight` / `fontStyle` / `fontSize` / `fontFamily` | `number \| string` / `string` / `number` / `string` | —                         | 任一给出即组装 CSS `font` 串，缺省分量补 `12px`、`sans-serif` |
| `underline` / `lineThrough`                            | `boolean`                                           | —                         | 下划线与删除线                                                |
| `textWrap`                                             | `boolean`                                           | —                         | `true` 时超宽文本格内断行；`\n` 强制换行始终生效              |
| `textOverflow`                                         | `'ellipsis' \| 'clip'`                              | 未设置（Excel 式溢出）    | `ellipsis` 省略号截断；`clip` 在内容盒内裁剪                  |
| `padding`                                              | `[top, right, bottom, left]`                        | `[0, 8, 0, 8]`            | 格内边距（CSS 像素）                                          |
| `border`                                               | `CellBorder`                                        | 主题网格边（右/下各 1px） | 逐边边框；未给的边按投影链保留基础边                          |

`CellBorderEdge`：

| 字段    | 类型                                          | 说明                                                                    |
| ------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `width` | `number`                                      | 边线宽（CSS 像素）                                                      |
| `color` | `string`                                      | 边线色                                                                  |
| `style` | `'solid' \| 'dashed' \| 'dotted' \| 'double'` | 线型，缺省 `solid`                                                      |
| `grid`  | `boolean`                                     | 引擎内部标记：表示该边由主题 `borderColor` 派生。宿主设置样式时不要自填 |

`projectCellStyle(base, override)`：

- 同步纯函数，返回新对象，不修改入参。
- `override` 逐字段覆盖 `base`。
- 边框四边独立合并：`override` 只给左边框时，`base` 的其余三边保留。
- 用于实现自定义覆盖链（主题 token → 列级 → 按格）；`ListTable` 内部已按该链投影。

```ts
import { projectCellStyle, type CellStyle } from 'infinitable'

const base: CellStyle = {
  color: '#1f2329',
  padding: [0, 8, 0, 8],
  border: {
    right: { width: 1, color: '#e5e6eb' },
    bottom: { width: 1, color: '#e5e6eb' },
  },
}

const merged = projectCellStyle(base, {
  fontWeight: 'bold',
  border: { left: { width: 3, color: '#dc2626' } },
})

console.log(merged.border)
// 左 3px 红；右/下仍保留 base 的 1px 网格线；top 未设置
```

::: warning
`CellBorderEdge.grid` 是投影链内部标记，宿主写样式时不要设置 `grid: true`。显式边在共享边裁决中恒胜主题网格派生边。
:::

## 选区

```ts
export interface RangeBounds {
  minCol: number
  minRow: number
  maxCol: number
  maxRow: number
}

export interface SelectionSnapshot {
  readonly ranges: readonly SelectionRange[]
  readonly focus: GridCellRef | null
}

export interface HighlightRange {
  readonly bounds: RangeBounds
  readonly color: string
}

export function normalizeRange(range: SelectionRange): RangeBounds
```

| 类型                       | 说明                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SelectionRange`（未导出） | `{ start: GridCellRef; end: GridCellRef }`。`start` 是锚点，`end` 是焦点侧，二者可反向                  |
| `RangeBounds`              | 归一化后的 min/max 边界                                                                                 |
| `SelectionSnapshot`        | 选区快照：段数组 + 焦点格。程序化选区入参、`getSelection()` 返回值与 `onSelectionChange` 载荷共用此形态 |
| `HighlightRange`           | 宿主高亮区：四边细条边框，只绘制不拦截事件                                                              |

`normalizeRange(range)` 对 `start` / `end` 逐轴取 min/max，返回 `RangeBounds`，不修改入参。

```ts
import { normalizeRange, type SelectionSnapshot } from 'infinitable'

const snapshot: SelectionSnapshot = {
  ranges: [{ start: { col: 3, row: 5 }, end: { col: 1, row: 2 } }],
  focus: { col: 1, row: 2 },
}

const bounds = normalizeRange(snapshot.ranges[0]!)
console.log(bounds) // { minCol: 1, minRow: 2, maxCol: 3, maxRow: 5 }

table.setHighlightRanges([
  { bounds: { minCol: 0, minRow: 0, maxCol: 2, maxRow: 2 }, color: '#2e6adb' },
])
```

::: warning
选区段的 `start` 不是 min 角。反向拖选时 `start` 是拖拽起点、`end` 是当前焦点，直接当边界读会得到反向区间。读取边界前统一经 `normalizeRange`。
:::

## 编辑

### EditorRegistry

```ts
export class EditorRegistry {
  constructor(route?: (col: number, row: number) => string | undefined)
  registerEditor(name: string, editor: CellEditor): void
  resolveEditor(columns: readonly ColumnDefine[], col: number, row: number): CellEditor | undefined
}
```

| 成员 | 签名                               | 说明                                                                            |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------- |
| 构造 | `new EditorRegistry(route?)`       | 可选格级路由 hook；返回编辑器注册名                                             |
| 注册 | `registerEditor(name, editor)`     | 注册或覆盖同名编辑器                                                            |
| 解析 | `resolveEditor(columns, col, row)` | 先走构造传入的 route，回退 `columns[col]?.editor`；名字未注册时返回 `undefined` |

`CellEditor` 与 `EditorRoute` 未导出：

```ts
interface CellEditor {
  readonly name?: string
}

type EditorRoute = (col: number, row: number) => string | undefined
```

```ts
import { EditorRegistry } from 'infinitable'

const registry = new EditorRegistry((col, row) => (col === 0 && row === 0 ? 'number' : undefined))
registry.registerEditor('number', { name: 'number' })
```

注册名只在注册后才会被识别：列声明了 `editor: 'text'` 但注册表没有 `text` 时，该格仍判定为不可编。

### CellRenderer

```ts
export type CellRenderer = (target: CellRenderTarget) => void

interface CellRenderTarget {
  ctx: RenderContext
  col: number
  row: number
  width: number
  height: number
  text: string
  value: unknown
  style: CellStyle
  textWidth?: number
  font?: string
  textMaxX?: number
  textMinX?: number
}
```

| 字段                    | 类型                        | 说明                                                          |
| ----------------------- | --------------------------- | ------------------------------------------------------------- |
| `ctx`                   | `RenderContext`             | 已平移到格内局部原点（`(0, 0)` 为格左上角），已处理 dpr       |
| `col` / `row`           | `number`                    | 格坐标；合并区传主格坐标                                      |
| `width` / `height`      | `number`                    | 格 CSS 像素尺寸；合并区为整块包围盒                           |
| `text`                  | `string`                    | 取值管线最终显示文本                                          |
| `value`                 | `unknown`                   | 基础值（模型值或 records 字段值），checkbox 勾选态据此判定    |
| `style`                 | `CellStyle`                 | 投影后样式（主题 → 列级 → 链接外观 → 按格 hook）              |
| `textWidth` / `font`    | `number` / `string`（可选） | 节点测量产物；缺省时渲染器自行组装                            |
| `textMaxX` / `textMinX` | `number`（可选）            | 文本可绘制的局部右/左界；大于 `width` / 小于 `0` 表示允许溢出 |

```ts
import type { CellRenderer } from 'infinitable'
import { ListTable } from 'infinitable'

const barRenderer: CellRenderer = ({ ctx, width, height, value }) => {
  const ratio = typeof value === 'number' ? value : 0
  const barWidth = Math.round((width - 16) * ratio)
  if (barWidth <= 0) return
  ctx.fillStyle = '#7c3aed'
  ctx.fillRect(8, (height - 10) / 2, barWidth, 10)
}

new ListTable({
  width: 600,
  height: 300,
  columns: [
    { field: 'name', title: '名称', width: 140 },
    { field: 'rating', title: '评分', width: 120 },
  ],
  records: [{ name: 'A', rating: 0.8 }],
  resolveCellRenderer: (col) => (col === 1 ? barRenderer : null),
  hostOptions: { container: document.querySelector<HTMLDivElement>('#table')! },
})
```

::: warning
自定义渲染器在格内局部坐标系绘制，背景与边框由引擎节点负责，不要在渲染器内重画背景/边框。`resolveCellRenderer` 在滚动帧建格与重投影时高频调用，必须是纯函数、同步、`O(1)`。
:::

## 合并

```ts
export interface CellRange {
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

export interface MergeConflict {
  coord: { col: number; row: number }
  range: CellRange
  existing: CellRange
}

export interface SanitizedMerges {
  ranges: CellRange[]
  conflicts: MergeConflict[]
}

export function normalizeCellRange(range: CellRange): CellRange

export class MergeOverlapError extends Error {
  readonly coord: MergeConflict['coord']
  readonly range: CellRange
  readonly existing: CellRange
}

export class MergeCellMap {
  constructor(ranges?: readonly CellRange[])
  readonly ranges: readonly CellRange[]
  rangeAt(col: number, row: number): CellRange | null
  masterOf(col: number, row: number): { col: number; row: number } | null
  isMaster(col: number, row: number): boolean
}

export function sanitizeMerges(ranges?: readonly CellRange[]): SanitizedMerges

export function warnMergeConflicts(conflicts: readonly MergeConflict[], source: string): void
```

| 成员                  | 签名                                 | 说明                                                                           |
| --------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| `normalizeCellRange`  | `(range) => CellRange`               | 交换使 `start ≤ end`，返回新对象                                               |
| `MergeCellMap` 构造   | `new MergeCellMap(ranges?)`          | 逐条归一化、丢弃 1×1；区间重叠抛 `MergeOverlapError`                           |
| `MergeCellMap.ranges` | `readonly CellRange[]`               | 归一化后的合并区列表                                                           |
| `rangeAt`             | `(col, row) => CellRange \| null`    | 覆盖该格的合并区；未覆盖返回 `null`                                            |
| `masterOf`            | `(col, row) => { col, row } \| null` | 所属合并区的主格（左上角）；未覆盖返回 `null`                                  |
| `isMaster`            | `(col, row) => boolean`              | 是否合并区主格；未覆盖时返回 `false`                                           |
| `sanitizeMerges`      | `(ranges?) => SanitizedMerges`       | 归一化并消解重叠：丢弃 1×1，按声明序保留先到项、整体丢弃后到冲突项；不修改入参 |
| `warnMergeConflicts`  | `(conflicts, source) => void`        | 逐条 `console.warn` 冲突来源、被丢区间与保留区间；同一冲突只提示一次           |

`MergeOverlapError`：

| 字段       | 类型                  | 说明                                   |
| ---------- | --------------------- | -------------------------------------- |
| `name`     | `'MergeOverlapError'` | 错误名                                 |
| `coord`    | `{ col, row }`        | 首个冲突格坐标                         |
| `range`    | `CellRange`           | 与既有区间重叠而被拒的区间（归一化后） |
| `existing` | `CellRange`           | 先声明并已生效的冲突区间（归一化后）   |

报错原文形如：

```text
merge ranges overlap at (2, 2): existing [1,1 ~ 3,3] vs incoming [2,2 ~ 2,4]
```

```ts
import {
  MergeCellMap,
  MergeOverlapError,
  normalizeCellRange,
  sanitizeMerges,
  type CellRange,
} from 'infinitable'

console.log(normalizeCellRange({ startCol: 3, startRow: 3, endCol: 2, endRow: 2 }))
// { startCol: 2, startRow: 2, endCol: 3, endRow: 3 }

const dirty: CellRange[] = [
  { startCol: 0, startRow: 0, endCol: 2, endRow: 0 },
  { startCol: 1, startRow: 0, endCol: 3, endRow: 0 },
]
const { ranges, conflicts } = sanitizeMerges(dirty)
console.log(ranges) // [{ startCol: 0, startRow: 0, endCol: 2, endRow: 0 }]
console.log(conflicts[0]?.coord) // { col: 1, row: 0 }

try {
  new MergeCellMap([
    { startCol: 0, startRow: 0, endCol: 2, endRow: 0 },
    { startCol: 1, startRow: 0, endCol: 3, endRow: 0 },
  ])
} catch (error) {
  if (error instanceof MergeOverlapError) {
    console.log(error.coord, error.range, error.existing)
  }
}
```

::: tip
批量数据入口（`ListTableOptions.mergeCells`、`ListTable.setMergeCells`）在构造 `MergeCellMap` 前先经 `sanitizeMerges`，所以重叠不会打断渲染；程序化单命令 `addMergeCell` 与直接 `new MergeCellMap` 仍保持 fail-fast。
:::

## 媒体与浮动对象

### LoadedImage

```ts
export interface LoadedImage {
  source: RenderImageSource
  width: number
  height: number
}
```

| 字段               | 类型                | 说明                        |
| ------------------ | ------------------- | --------------------------- |
| `source`           | `RenderImageSource` | 可交给 `drawImage` 的位图源 |
| `width` / `height` | `number`            | 位图原始尺寸                |

### CellChartMedia

```ts
export interface CellChartMedia {
  key: string
  produce(size: { width: number; height: number; dpr: number }): Promise<LoadedImage> | LoadedImage
}
```

| 字段      | 类型                                            | 说明                                                                    |
| --------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| `key`     | `string`                                        | 内容 key；内容变更自然换 key。table 会叠加格尺寸与 DPR 组成完整缓存 key |
| `produce` | `(size) => LoadedImage \| Promise<LoadedImage>` | 未命中格级缓存时调用；同 key 并发出图由 table 单飞收敛                 |

`size` 的类型未单独导出，字段为 `{ width, height, dpr }`。图表语义（类型、数据、渲染库）全部在 chart 插件侧；table 只认内容 key 与位图生产者。

### FloatObject

```ts
export interface FloatObject {
  id: string
  kind: 'image' | 'chart' | 'dom'
  anchor: {
    from: GridCellRef
    to: GridCellRef
    offsetX: number
    offsetY: number
  }
  size?: { width: number; height: number }
  rotation?: number
  fit?: 'fill' | 'contain'
  src?: string
  alt?: string
  title?: string
  link?: string
}
```

| 字段                        | 类型                          | 默认                       | 说明                                                                         |
| --------------------------- | ----------------------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `id`                        | `string`                      | 必填                       | 层内唯一；重复 `add` 同 id 会先移除旧对象                                    |
| `kind`                      | `'image' \| 'chart' \| 'dom'` | 必填                       | `image` 按 `src` 加载绘制；`chart` / `dom` 预留，未加载内容时画占位          |
| `anchor.from` / `anchor.to` | `GridCellRef`                 | 必填                       | 格区间锚定；`offsetX` / `offsetY` 是 `from` 格内像素偏移（负值落点时夹到 0） |
| `size`                      | `{ width, height }`           | 由 `from → to` 格范围推导  | 绝对像素尺寸；给出后行列 resize 只跟随锚点位置，尺寸不变                     |
| `rotation`                  | `number`                      | `0`                        | 顺时针度数，归一化 0–360；渲染绕对象中心旋转，命中走逆变换                   |
| `fit`                       | `'fill' \| 'contain'`         | `'fill'`（浮动图绘制路径） | 图片填充模式                                                                 |
| `src`                       | `string`                      | —                          | `kind: 'image'` 时的 URL，经 `table.imageService` 加载                       |
| `alt` / `title`             | `string`                      | —                          | 辅助信息                                                                     |
| `link`                      | `string`                      | —                          | 图片超链接；带链接浮动图单击派发 `onImageLinkClick`（`kind: 'float'`）       |

### 手柄与事件

```ts
export type FloatTransformHandle =
  | 'left-top'
  | 'center-top'
  | 'right-top'
  | 'left-middle'
  | 'right-middle'
  | 'left-bottom'
  | 'center-bottom'
  | 'right-bottom'
  | 'rotate'

export interface FloatTransformEndEvent {
  id: string
  anchor: FloatObject['anchor']
  size: { width: number; height: number }
  rotation: number
}

export interface FloatContextMenuEvent {
  id: string
  x: number
  y: number
  originalEvent: SceneEvent['originalEvent']
}
```

| 类型                     | 字段                                  | 说明                                                        |
| ------------------------ | ------------------------------------- | ----------------------------------------------------------- |
| `FloatTransformHandle`   | 8 个缩放手柄 + `'rotate'`             | 四角、四边中点与顶部旋转手柄                                |
| `FloatTransformEndEvent` | `id` / `anchor` / `size` / `rotation` | 缩放或旋转会话抬起时抛出；`rotation` 为归一化后的顺时针度数 |
| `FloatContextMenuEvent`  | `id` / `x` / `y` / `originalEvent`    | 右键命中浮动对象时抛出，不穿透到单元格右键事件              |

### table.floatObjects 实例面

`FloatObjectLayer` 类未导出，只经 `table.floatObjects` 使用。

| 方法                                                | 签名                                                                    | 说明                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| `size`                                              | `get size(): number`                                                    | 对象数量                                           |
| `add`                                               | `(object: FloatObject) => void`                                         | 新增；同 id 先移除旧对象                           |
| `remove`                                            | `(id: string) => void`                                                  | 移除对象                                           |
| `update`                                            | `(id, patch: Partial<Omit<FloatObject, 'id'>>) => void`                 | 合并补丁；要清除可选字段须显式传该键为 `undefined` |
| `get`                                               | `(id) => FloatObject \| undefined`                                      | 读取对象                                           |
| `getAt`                                             | `(x, y) => FloatObject \| null`                                         | 层坐标命中测试；后加对象在上                       |
| `select` / `clearSelection`                         | `(id) => void` / `() => void`                                           | 单选选中 / 清除选中                                |
| `getSelectedId`                                     | `() => string \| null`                                                  | 当前选中 id                                        |
| `isDragging` / `isTransforming`                     | `() => boolean`                                                         | 是否处于拖拽 / 变换会话                            |
| `beginDrag` / `dragMove` / `endDrag`                | `(id, x, y) => boolean` / `(x, y) => void` / `() => void`               | 拖拽会话；位移超过 3px 才算拖拽                    |
| `onDragEnd`                                         | `(listener) => () => void`                                              | 拖拽结束抛新锚点 `{ id, anchor }`                  |
| `handleAt`                                          | `(x, y) => FloatTransformHandle \| null`                                | 命中选中对象的变换手柄                             |
| `beginTransform` / `transformMove` / `endTransform` | `(handle, x, y) => boolean` / `(x, y, shiftKey) => void` / `() => void` | 缩放/旋转会话；Shift 等比缩放、旋转吸附 15°        |
| `onTransformEnd`                                    | `(listener) => () => void`                                              | 变换结束抛 `FloatTransformEndEvent`                |
| `onContextMenu`                                     | `(listener) => () => void`                                              | 浮动对象右键事件                                   |
| `onChange`                                          | `(listener) => () => void`                                              | 集合变更（`add` / `remove` / `update`）            |
| `isReadonly`                                        | `boolean`                                                               | 运行时只读开关；只读时可选不可拖/不可变换          |

`syncPositions`、`recalcGeometry`、`setBodyViewport`、`dispatchContextMenu`、`dispose` 由引擎接线调用，宿主通常无需直接使用；滚动跟随与行列尺寸变化后的重算已自动完成。

```ts
table.floatObjects.add({
  id: 'photo-1',
  kind: 'image',
  anchor: { from: { col: 1, row: 2 }, to: { col: 3, row: 4 }, offsetX: 8, offsetY: 8 },
  size: { width: 220, height: 140 },
  rotation: 0,
  src: 'https://cdn.example.com/photo.png',
})

table.floatObjects.onTransformEnd((event) => {
  table.floatObjects.update(event.id, {
    anchor: event.anchor,
    size: event.size,
    rotation: event.rotation,
  })
})

table.floatObjects.onDragEnd((event) => {
  table.floatObjects.update(event.id, { anchor: event.anchor })
})
```

::: warning
拖拽与变换过程只修改渲染态，结束时才抛事件。宿主必须在 `onDragEnd` / `onTransformEnd` 中写回模型，否则下一次锚定重排会回到旧位置/旧尺寸。
:::

### table.imageService 实例面

`ImageService` 类未导出，只经 `table.imageService` 使用。

| 方法               | 签名                                                            | 说明                                                                                                                  |
| ------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `request`          | `(url, cell: GridCellRef, onSettled?) => ImageState`            | 登记格引用并按需加载，返回当前状态；`onSettled` 仅在请求后异步落定为 `ready` / `error` 时回调一次（已就绪命中不补发） |
| `releaseRef`       | `(url, cell: GridCellRef) => void`                              | 移除格引用；滚出窗口时由引擎调用                                                                                      |
| `updateWindow`     | `(predicate: (cell) => boolean) => void`                        | 重设「视口 + 余量」判定并重新调度加载队列                                                                             |
| `hasResource`      | `(url) => boolean`                                              | 是否已就绪；场景重建首帧可据此直接贴图                                                                                |
| `getBitmap`        | `(url) => LoadedImage \| undefined`                             | 取已就绪位图；命中会提升 LRU 序                                                                                       |
| `invalidate`       | `(url) => GridCellRef[]`                                        | 作废位图并返回引用它的格坐标                                                                                          |
| `invalidateAll`    | `() => void`                                                    | 作废全部缓存                                                                                                          |
| `onImageLoad`      | `(listener) => () => void`                                      | 载荷 `{ url, width, height, cells }`（类型未导出）                                                                    |
| `onImageError`     | `(listener) => () => void`                                      | 载荷 `{ url, error, cells }`（类型未导出）                                                                            |
| `setUrlResolver`   | `(resolver: ((raw: string) => string \| null) \| null) => void` | URL 规范化钩子；返回 `null` 判定为非法并走 error                                                                      |
| `placeholderDelay` | `number`                                                        | 占位延迟毫秒数（构造时由 `imageServiceOptions.placeholderDelay` 初始化）                                              |

`dispose` 由 `table.destroy()` 统一调用，宿主无需单独释放。

`ImageState` 未导出，取值为 `'idle' | 'loading' | 'ready' | 'error'`。

```ts
table.imageService.setUrlResolver((raw) => (raw.trim() === '' ? null : raw))

table.imageService.onImageError((event) => {
  console.error('图片加载失败', event.url, event.cells)
})
```

## 绘制预留位

```ts
export type UnderlayPainter = (ctx: RenderContext, viewport: Size) => void

export type OverlayPainter = (ctx: RenderContext, viewport: Size) => void
```

| 类型              | 挂载层             | 绘制位置                       | 说明                                                                  |
| ----------------- | ------------------ | ------------------------------ | --------------------------------------------------------------------- |
| `UnderlayPainter` | `ground`（最底层） | 表格内容之下                   | 经 `table.setUnderlayPainter` 写入；`ground` 层只在首次写入时惰性创建 |
| `OverlayPainter`  | `sky`（最上层）    | 选区与浮动对象之上、滚动条之下 | 经 `table.setOverlayPainter` 写入；不新增 canvas 层，节点不可命中     |

`ctx` 以层坐标（即视口坐标）绘制，`viewport` 为当前视口尺寸。二者内容天然锚定视口：滚动 band 失效不波及 ground/sky 的整层内容，容器 `resize` 时节点尺寸与收到视口尺寸同步更新。传 `null` 移除 painter 并整层失效清屏。

```ts
import type { OverlayPainter } from 'infinitable'

const watermark: OverlayPainter = (ctx, viewport) => {
  ctx.save()
  ctx.fillStyle = 'rgba(31, 35, 41, 0.08)'
  ctx.font = '24px sans-serif'
  ctx.fillText('内部预览', viewport.width - 160, viewport.height - 24)
  ctx.restore()
}

table.setOverlayPainter(watermark)
// 移除：
table.setOverlayPainter(null)
```

::: tip
内容之下的水印用 `setUnderlayPainter`，但它会被 body 的不透明底色遮挡；需要在任意主题下都可见时，用顶层 `setOverlayPainter`，或把 `underlayBackgroundColor` 与 body 背景配成透明色。
:::

## 注意事项

::: warning
- **默认主题常量不导出**：用 `extendsTheme()` / `table.getTheme()` 读取；不要依赖未导出的 `defaultTheme` 名称。
- **`projectCellStyle` 返回新对象**：全仓 `CellStyle` 按不可变约定使用，不要在投影结果上就地改写。
- **注册名先注册再声明**：`EditorRegistry.resolveEditor` 只识别已注册的名字；列声明 `editor` 不等于可编。
- **合并重叠入口不同语义**：`sanitizeMerges` 宽容消解；`MergeCellMap` 构造与 `addMergeCell` fail-fast。
- **图片与浮动对象的类未导出**：只经 `table.imageService` / `table.floatObjects` 实例面消费，不能脱离 `ListTable` 独立实例化。
- **变换只改渲染态**：浮动对象的拖拽/缩放/旋转结束必须由宿主写回模型。
- **`FloatObject.rotation` 是度数**：顺时针，归一化到 0–360，不是弧度。
:::
