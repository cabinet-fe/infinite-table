---
title: ListTable
description: ListTable 主类与 ListTableOptions 全量参考：数据供给三形态、布局与冻结合并、交互、可编判定与编辑会话、媒体与链接、主题、内建滚动条，以及全部公共方法、事件载荷与典型用法。
---

# ListTable

`ListTable` 是表格主类：按可视窗口装配场景树、驱动虚拟滚动、管理选区/编辑/冻结/合并/图片/浮动对象，并通过 `RenderHost` 窄接口提交渲染。

## 快速上手

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative' // 层 canvas 以绝对定位叠放，容器不能是 static

const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { field: 'name', title: '名称', width: 160 },
    { field: 'score', title: '分数', width: 100, style: { textAlign: 'right' } },
  ],
  records: Array.from({ length: 100_000 }, (_, row) => ({ name: `行 ${row}`, score: row })),
  hostOptions: { container },
})

// canvas 滚动条档下滚轮不内置，宿主自行接线
container.addEventListener(
  'wheel',
  (event) => {
    if (table.usesNativeScrollbar) return
    event.preventDefault()
    table.scrollBy(event.deltaX, event.deltaY)
  },
  { passive: false },
)

table.onCellChange((change) => {
  console.log(change.col, change.row, change.oldValue, '->', change.newValue)
})
```

## ListTableOptions

```ts
export interface ListTableOptions {
  width: number
  height: number
  columns: ColumnDefine[]
  records?: readonly DataRecord[]
  rowCount?: number
  model?: TableModel
  resolveDisplayValue?: ResolveDisplayValue
  resolveCellStyle?: (col: number, row: number) => CellStyle | null
  resolveCellRenderer?: (col: number, row: number) => CellRenderer | null
  resolveCellImage?: (col: number, row: number) => string | null | undefined
  resolveCellImageFit?: (col: number, row: number) => 'fill' | 'contain' | null | undefined
  resolveCellLink?: (col: number, row: number) => CellLink | null | undefined
  resolveCellImageLink?: (col: number, row: number) => string | null | undefined
  openCellLinkOnClick?: boolean
  resolveEditable?: (col: number, row: number) => boolean
  editCellOnEnter?: boolean
  editorRegistry?: EditorRegistry
  editorMaxLength?: number
  editorInsideBorder?: boolean
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
  doc?: CanvasDocSource
  theme?: ThemeOverride
  plugins?: readonly TablePlugin[]
  canResizeCol?: (col: number) => boolean
  canResizeRow?: (row: number) => boolean
  ctrlMultiSelect?: boolean
  scrollbar?: boolean | ScrollbarOptions
  overscanRows?: number
  overscanCols?: number
  resolveShiftSelectAnchor?: (target: GridCellRef) => GridCellRef | null | undefined
  resolveColTitle?: (col: number) => string
}
```

> 展示用签名把 grid 内部的格坐标 `CellRef` 写成了统一入口别名 `GridCellRef`；`ImageServiceOptions` 未作为公共类型导出，字段见下方媒体表。

### 数据与渲染 hook

| 参数                  | 类型                                 | 默认 | 说明                                                                                              |
| --------------------- | ------------------------------------ | ---- | ------------------------------------------------------------------------------------------------- |
| `columns`             | `ColumnDefine[]`                     | 必填 | 列平面；列数等于数组长度。升级到 `setColCount` 时该数组原地增删                                   |
| `records`             | `readonly DataRecord[]`              | —    | 数组形态数据；行数取 `records.length`                                                             |
| `rowCount`            | `number`                             | `0`  | 纯 hook 形态的行数兜底。有 `records` 时以数组长度为准；模型形态取 `max(model.rowCount, rowCount)` |
| `model`               | `TableModel`                         | —    | 模型直挂形态；给出后基础值一律走模型，优先于 `records`                                            |
| `resolveDisplayValue` | `(col, row, value) => string`        | —    | 取值管线末端的显示文本 hook，可与任一数据形态叠加                                                 |
| `resolveCellRenderer` | `(col, row) => CellRenderer \| null` | —    | 返回渲染器即接管该格内容绘制；`null` 走内置 `cellType`                                            |
| `resolveColTitle`     | `(col) => string`                    | —    | 列定义未给 `title` 的列（如 `setColCount` 增出的列）的标题源；未配置时为空串                      |

数据供给的取值优先级：`model` 存在时只用模型；否则按列 `field` 从 `records[row]` 取值。`resolveDisplayValue` 只影响显示文本，不改变基础值（`CellRenderer` 的 `value` 仍是基础值）。

### 布局

| 参数               | 类型                   | 默认                                | 说明                                                                                                     |
| ------------------ | ---------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `width` / `height` | `number`               | 必填                                | 视口尺寸（CSS 像素）。构造后可用 `resize()` 原地调整                                                     |
| `rowHeight`        | `number`               | 主题 `rowHeight`（默认主题为 `32`） | 全表行高基准；逐行覆盖走 `setRowHeight`。显式 options 优先于主题 token                                   |
| `defaultColWidth`  | `number`               | 主题 `defaultColWidth`（`100`）     | 列未给 `width` 时的列宽                                                                                  |
| `headerHeight`     | `number`               | 主题 `headerHeight`（`36`）         | 列头高度；`showColHeader: false` 时归一化为 `0`，显式值被忽略                                            |
| `rowHeaderWidth`   | `number`               | 主题 `rowHeaderWidth`（`48`）       | 行号列宽；`showRowHeader: false` 时归一化为 `0`                                                          |
| `showColHeader`    | `boolean`              | `true`                              | `false` 关闭列头，内容原点上移到 `y = 0`                                                                 |
| `showRowHeader`    | `boolean`              | `true`                              | `false` 关闭行号列，内容原点左移到 `x = 0`                                                               |
| `frozenColCount`   | `number`               | `0`                                 | 左侧冻结数据列数（不含行号列），构造时夹取到 `[0, 列数]`                                                 |
| `frozenRowCount`   | `number`               | `0`                                 | 顶部冻结数据行数（不含列头），构造时夹取到 `[0, 行数]`                                                   |
| `mergeCells`       | `readonly CellRange[]` | `[]`                                | 合并区（闭区间）。构造前经 `sanitizeMerges`：丢弃 1×1、保留先声明、丢弃重叠项并 `console.warn`；越界抛错 |
| `overscanRows`     | `number`               | `0`                                 | 渲染窗口向滚动方向两侧多建的行数；只扩大场景装配窗口，不改变滚动边界                                     |
| `overscanCols`     | `number`               | `0`                                 | 渲染缓冲列数，语义同 `overscanRows`                                                                      |

跨冻结边界的合并区合法：主格按其所属冻结带钉固绘制。

### 交互

| 参数                       | 类型                                                        | 默认        | 说明                                                                                                                      |
| -------------------------- | ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `canResizeCol`             | `(col) => boolean`                                          | 全部允许    | 返回 `false` 禁止该列拖拽改宽                                                                                             |
| `canResizeRow`             | `(row) => boolean`                                          | 全部允许    | 返回 `false` 禁止该行拖拽改高                                                                                             |
| `ctrlMultiSelect`          | `boolean`                                                   | `false`     | `true` 时 Ctrl/Cmd 点数据格在既有选区上追加选区段；`false` 时点选替换选区                                                 |
| `resolveShiftSelectAnchor` | `(target: GridCellRef) => GridCellRef \| null \| undefined` | `undefined` | Shift 点选扩展的锚点解析。返回格坐标以它为锚；`undefined` 用引擎缺省（画布选区末段 `start`）；`null` 不扩展，回落普通点选 |

### 编辑

| 参数                 | 类型                    | 默认     | 说明                                                                                                      |
| -------------------- | ----------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `resolveEditable`    | `(col, row) => boolean` | 全部可编 | 返回 `false` 该格不可编                                                                                   |
| `editCellOnEnter`    | `boolean`               | `false`  | `true` 时非编辑态按 Enter 进入焦点格编辑                                                                  |
| `editorRegistry`     | `EditorRegistry`        | 空注册表 | 可编第一级判定与格级路由；也可事后经 `table.editorRegistry` 注册                                          |
| `editorMaxLength`    | `number`                | 不截断   | 编辑器字符上限；列级 `editorMaxLength` 优先                                                               |
| `editorInsideBorder` | `boolean`               | `false`  | `true` 时编辑浮层按锚定格四周可视边框内缩，浮层落在边框内侧、格边框编辑期间保持可见；`false` 时浮层骑格缘 |

进入编辑需要同时满足：1) 列声明了已注册的 `editor`，或注册表路由命中；2) `resolveEditable` 未拒绝；3) 有回写目标（模型形态恒有；records 形态该列需有 `field` 且行对象存在）。

### 媒体与链接

| 参数                   | 类型                                                     | 默认      | 说明                                                                                                                                              |
| ---------------------- | -------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveCellImage`     | `(col, row) => string \| null \| undefined`              | —         | 返回 URL 的格在 L2 media 层按图片渲染；`null`/`undefined` 走常规管线                                                                              |
| `resolveCellImageFit`  | `(col, row) => 'fill' \| 'contain' \| null \| undefined` | `contain` | 仅对图片格生效的填充模式；`resolveCellImage` 返回 URL 的格才消费                                                                                  |
| `imageServiceOptions`  | 见下表                                                   | 见下表    | 图片服务的缓存预算、并发、占位延迟、加载器注入                                                                                                    |
| `resolveCellLink`      | `(col, row) => CellLink \| null \| undefined`            | —         | 返回链接的格获得默认链接外观（主题 `linkColor` + 下划线）、pointer 光标与链接事件                                                                 |
| `resolveCellImageLink` | `(col, row) => string \| null \| undefined`              | —         | 返回 URL 的图片格单击派发图片链接点击事件                                                                                                         |
| `openCellLinkOnClick`  | `boolean`                                                | `true`    | 单击命中链接格或带链接图片后，引擎在派发事件后默认打开 URL（`window.open` 新标签 + `noopener`；无 `window` 静默跳过）；`false` 时由宿主经事件接管 |

`imageServiceOptions` 字段：

| 字段               | 类型                                         | 默认                 | 说明                                        |
| ------------------ | -------------------------------------------- | -------------------- | ------------------------------------------- |
| `maxCacheBytes`    | `number`                                     | `268435456`（256MB） | 解码位图 LRU 字节预算                       |
| `maxCacheCount`    | `number`                                     | `1000`               | 位图条目上限                                |
| `concurrency`      | `number`                                     | `10`                 | 并发加载上限                                |
| `placeholderDelay` | `number`                                     | `80`                 | 占位延迟显示毫秒数，防快速滚动闪烁          |
| `crossOrigin`      | `string \| null`                             | —                    | 透传 DOM `Image` 的 `crossOrigin`           |
| `loadImage`        | `(url, crossOrigin) => Promise<LoadedImage>` | DOM `Image`          | 传输层注入（data URL、canvas 位图、测试桩） |
| `estimateBytes`    | `(image) => number`                          | `width × height × 4` | 位图字节估算                                |

### 主题与样式

| 参数               | 类型                              | 默认     | 说明                                                     |
| ------------------ | --------------------------------- | -------- | -------------------------------------------------------- |
| `theme`            | `ThemeOverride`                   | 默认主题 | 基于默认主题经 `extendsTheme` 派生                       |
| `resolveCellStyle` | `(col, row) => CellStyle \| null` | —        | 按格样式 hook；返回 `null` 沿用「主题 token + 列级样式」 |

样式覆盖链为：主题分区 token → 列级 `ColumnDefine.style` → 链接默认外观（命中 `resolveCellLink` 时）→ 按格 `resolveCellStyle`。逐字段覆盖，边框逐边独立合并。

### 插件与宿主

| 参数          | 类型                                           | 默认 | 说明                                                               |
| ------------- | ---------------------------------------------- | ---- | ------------------------------------------------------------------ |
| `plugins`     | `readonly TablePlugin[]`                       | `[]` | 构造期按数组顺序挂载，先于首次场景重建                             |
| `host`        | `RenderHost`                                   | 自建 | 注入渲染宿主。注入后 `destroy()` 不销毁该宿主                      |
| `hostOptions` | `Omit<RenderHostOptions, 'width' \| 'height'>` | —    | 未注入 `host` 时创建宿主的参数；容器通常在 `hostOptions.container` |
| `doc`         | `CanvasDocSource`                              | 全局 `document` | 文档源注入：层 canvas 与测量画布创建经它。无 DOM 环境（SSR / 无头测试）注入替身后可构造并出图；`hostOptions.createCanvas` 显式注入仍优先。类型见下方「引擎协议面与文档源注入」 |

### 滚动条

| 参数        | 类型                          | 默认                                              | 说明                                                                       |
| ----------- | ----------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `scrollbar` | `boolean \| ScrollbarOptions` | `undefined`：canvas + `'hover'` + `reserve: true` | `false` 整体关闭；`true` 常驻（`'always'`）；对象形态见 `ScrollbarOptions` |

```ts
export type ScrollbarMode = 'canvas' | 'native'

export interface ScrollbarOptions {
  mode?: ScrollbarMode
  visibility?: 'always' | 'scrolling' | 'hover'
  hideDelay?: number
  reserve?: boolean
}
```

| 字段         | 类型                                 | 默认                                            | 说明                                                                                                                                                 |
| ------------ | ------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`       | `'canvas' \| 'native'`               | `'canvas'`                                      | `'canvas'` 为画布内建滚动条；`'native'` 在宿主容器内装配真实 DOM 滚动容器（`overflow: scroll` + `scrollbar-gutter: stable`），滚动条由浏览器原生渲染 |
| `visibility` | `'always' \| 'scrolling' \| 'hover'` | `'hover'`                                       | `always` 常驻；`scrolling` 滚动或滚动条交互时显示；`hover` 悬停表格内或滚动时显示。仅 canvas 档生效                                                  |
| `hideDelay`  | `number`                             | 主题 `interaction.scrollbarHideDelay`（`1500`） | `scrolling` / `hover` 档静止后隐藏延时（ms）。仅 canvas 档生效                                                                                       |
| `reserve`    | `boolean`                            | `true`                                          | `true` 在可滚动轴画布右/下缘常驻预留一条轨道带；`false` 回悬浮式滑块。仅 canvas 档生效                                                               |

::: warning
`mode: 'native'` 下 `visibility`、`hideDelay`、`reserve` 均不适用（给出即忽略）。原生滚动条模式下滚轮/触控板由滚动容器接管，宿主既有 wheel 接线必须用 `table.usesNativeScrollbar` 让位，避免双滚。
:::

## 公共方法

所有方法均为同步。事件订阅方法统一返回退订函数 `() => void`。

### 生命周期与主题

| 方法     | 签名                                         | 参数       | 返回         | 说明                                                                                                                  |
| -------- | -------------------------------------------- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| 构造     | `new ListTable(options: ListTableOptions)`   | 构造选项   | `ListTable`  | 装配场景、绑定交互、挂载 `plugins`，并提交首帧                                                                        |
| 取主题   | `getTheme(): TableTheme`                     | —          | `TableTheme` | 当前生效主题                                                                                                          |
| 更新主题 | `updateTheme(override: ThemeOverride): void` | 深覆盖片段 | `void`       | 以当前主题为 base 累积深覆盖，重建场景、提交 body 层整层失效并刷新浮层；不触碰滚动/选区/冻结，已生效几何 token 不重算 |
| 注册插件 | `use(plugin: TablePlugin): void`             | 插件对象   | `void`       | 注册即挂载；销毁时按注册逆序调用 `unmount`                                                                            |

### 滚动

| 方法       | 签名                                                                  | 参数     | 返回                     | 说明                                     |
| ---------- | --------------------------------------------------------------------- | -------- | ------------------------ | ---------------------------------------- |
| 滚动到     | `scrollTo(left: number, top: number): void`                           | 目标偏移 | `void`                   | 自动夹取到 `[0, max]`；位置未变不广播    |
| 相对滚动   | `scrollBy(dx: number, dy: number): void`                              | 增量     | `void`                   | 在当前偏移上叠加并夹取                   |
| 滚动状态   | `getScrollState(): ScrollState`                                       | —        | `{ left, top }`          | 返回滚动状态快照；`ScrollState` 未导出   |
| 横向偏移   | `getScrollLeft(): number`                                             | —        | `number`                 | 当前 `left`                              |
| 纵向偏移   | `getScrollTop(): number`                                              | —        | `number`                 | 当前 `top`                               |
| 设横向     | `setScrollLeft(left: number): void`                                   | 目标     | `void`                   | 只改横向，纵向不变                       |
| 设纵向     | `setScrollTop(top: number): void`                                     | 目标     | `void`                   | 只改纵向，横向不变                       |
| 滚到格     | `scrollToCell(cell: GridCellRef): void`                               | 格坐标   | `void`                   | 滚动到目标格完整可见；冻结轴恒可见，跳过 |
| 可视窗口   | `getVisibleRange(): { rows: WindowRange; cols: WindowRange }`         | —        | 两个 `[start, end)` 区间 | 不含冻结区；`WindowRange` 未导出         |
| 可视数据格 | `getBodyVisibleCellRange(): { rows: WindowRange; cols: WindowRange }` | —        | 两个 `[start, end)` 区间 | 冻结行列并入可视范围                     |
| 原生档判定 | `get usesNativeScrollbar(): boolean`                                  | —        | `boolean`                | `true` 表示当前滚动条为 `mode: 'native'` |

### 尺寸与行列数

| 方法     | 签名                                                        | 参数                 | 返回     | 说明                                                                                                                                                 |
| -------- | ----------------------------------------------------------- | -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 视口宽   | `get width(): number`                                       | —                    | `number` | 表格视口宽（CSS 像素）                                                                                                                               |
| 视口高   | `get height(): number`                                      | —                    | `number` | 表格视口高（CSS 像素）                                                                                                                               |
| 调整视口 | `resize(width: number, height: number): void`               | 新尺寸               | `void`   | 原地调整，不重建实例；尺寸负值夹到 0；滚动位置与选区保留                                                                                             |
| 列宽     | `getColWidth(col: number): number`                          | 列号                 | `number` | 越界返回 `0`                                                                                                                                         |
| 设列宽   | `setColWidth(col: number, width: number): void`             | 列号、宽度           | `void`   | 越界空操作；宽度夹取最小 `20px`                                                                                                                      |
| 行高     | `getRowHeight(row: number): number`                         | 行号                 | `number` | 越界返回 `0`                                                                                                                                         |
| 设行高   | `setRowHeight(row: number, height: number): void`           | 行号、高度           | `void`   | 越界空操作；高度夹取最小 `20px`                                                                                                                      |
| 行数     | `get rowCount(): number`                                    | —                    | `number` | 当前数据行数                                                                                                                                         |
| 列数     | `get colCount(): number`                                    | —                    | `number` | 当前数据列数                                                                                                                                         |
| 设行数   | `setRowCount(count: number): void`                          | 目标行数             | `void`   | 纯 hook 形态直接改兜底行数；模型形态需先增长模型再调用；records 形态行数恒等于数组长度，增长无效；收缩时钳冻结行数、丢弃越界合并区、钳选区           |
| 设列数   | `setColCount(count: number, template?: ColumnDefine): void` | 目标列数、新增列模板 | `void`   | 增长时按模板追加列定义与列宽（缺省 `defaultColWidth`，列头标题回落 `resolveColTitle`）；收缩时截断、清列样式缓存、钳冻结列数、丢弃越界合并区、钳选区 |
| 绘制区   | `getDrawRange(): Region`                                    | —                    | `Region` | 扣除行号列与列头后的数据区可绘制矩形                                                                                                                 |

### 几何与命中查询

| 方法       | 签名                                                                   | 参数     | 返回              | 说明                             |
| ---------- | ---------------------------------------------------------------------- | -------- | ----------------- | -------------------------------- |
| 格矩形     | `getCellRelativeRect(col: number, row: number): Region \| null`        | 格坐标   | 视口矩形或 `null` | 行/列在可视窗口外返回 `null`     |
| 坐标命中   | `getCellAtRelativePosition(x: number, y: number): GridCellRef \| null` | 视口坐标 | 格坐标或 `null`   | 点在行列头/空白处返回 `null`     |
| 行号列判定 | `isSeriesNumber(col: number, row: number): boolean`                    | 格坐标   | `boolean`         | 是否为行号列格                   |
| 表头层数   | `getHeaderLevelCount(): number`                                        | —        | `number`          | 恒为 `1`，当前版本不支持多级表头 |

### 冻结与合并

| 方法     | 签名                                                | 参数       | 返回     | 说明                                                                                                  |
| -------- | --------------------------------------------------- | ---------- | -------- | ----------------------------------------------------------------------------------------------------- |
| 冻结列数 | `getFrozenColCount(): number`                       | —          | `number` | 当前冻结数据列数                                                                                      |
| 冻结行数 | `getFrozenRowCount(): number`                       | —          | `number` | 当前冻结数据行数                                                                                      |
| 设冻结列 | `setFrozenColCount(count: number): void`            | 目标列数   | `void`   | 夹取到 `[0, 列数]`；跨冻结边界的既有合并区合法，主格按新边界重钉                                      |
| 设冻结行 | `setFrozenRowCount(count: number): void`            | 目标行数   | `void`   | 夹取到 `[0, 行数]`；语义同上                                                                          |
| 替换合并 | `setMergeCells(ranges: readonly CellRange[]): void` | 合并区列表 | `void`   | 整体替换。重叠项经 `sanitizeMerges` 规范化：保留先声明、丢弃冲突并 `console.warn`；越界抛错且保持原状 |
| 新增合并 | `addMergeCell(range: CellRange): void`              | 单个区间   | `void`   | 与既有区间重叠抛 `MergeOverlapError`；越界抛错；失败均保持原状                                        |
| 移除合并 | `removeMergeCell(range: CellRange): void`           | 单个区间   | `void`   | 按归一化后精确匹配；未命中为空操作                                                                    |

### 选区与高亮

| 方法     | 签名                                                          | 参数            | 返回                | 说明                                                                     |
| -------- | ------------------------------------------------------------- | --------------- | ------------------- | ------------------------------------------------------------------------ |
| 选单格   | `selectCell(col: number, row: number): void`                  | 格坐标          | `void`              | 选中单格并把焦点同步到该格，同时滚动到可见                               |
| 选多段   | `selectCells(ranges: readonly SelectionRange[]): void`        | 选区段数组      | `void`              | 整组替换；焦点落末段 `end`；不自动滚动                                   |
| 选整行   | `selectRow(row: number): void`                                | 行号            | `void`              | 选区覆盖整行，焦点落该行首格                                             |
| 选整列   | `selectCol(col: number): void`                                | 列号            | `void`              | 选区覆盖整列，焦点落该列首格                                             |
| 全选     | `selectAll(): void`                                           | —               | `void`              | 覆盖全部数据区，焦点落左上角                                             |
| 清空     | `clearSelection(): void`                                      | —               | `void`              | 清空所有选区段与焦点；原本为空时为空操作                                 |
| 取选区   | `getSelection(): SelectionSnapshot`                           | —               | `SelectionSnapshot` | 当前选区快照（段可反向，边界读取用 `normalizeRange`）                    |
| 取段副本 | `getSelectedCellRanges(): SelectionRange[]`                   | —               | 选区段副本          | 返回副本；`SelectionRange` 未导出                                        |
| 外部回写 | `applyExternalSelection(snapshot: SelectionSnapshot): void`   | 选区快照        | `void`              | 钳制到数据区并刷新浮层，但不广播，天然防回环；拖拽中同边界快照只同步焦点 |
| 高亮区   | `setHighlightRanges(ranges: readonly HighlightRange[]): void` | 高亮区数组      | `void`              | sky 浮层四边细条边框；只绘制不拦截事件；传空数组清除                     |
| 选区锚点 | `setSelectionAnchor(anchor: GridCellRef \| null): void`       | 格坐标或 `null` | `void`              | 编辑拾取会话中持续绘制锚定格；合并格按整块包围盒；`null` 清除            |

### 编辑

| 方法     | 签名                                           | 参数   | 返回         | 说明                                                                                     |
| -------- | ---------------------------------------------- | ------ | ------------ | ---------------------------------------------------------------------------------------- |
| 进入编辑 | `startEdit(col: number, row: number): boolean` | 格坐标 | 是否成功     | 可编三级判定全通过才打开浮层并返回 `true`；否则返回 `false` 且无浮层。会先滚动该格到可见 |
| 提交     | `commitEdit(): boolean`                        | —      | 是否提交成功 | 值回写数据源、该格局部失效、派发 `onCellChange`；无会话返回 `false`                      |
| 取消     | `cancelEdit(): void`                           | —      | `void`       | 不回写、不派发 `onCellChange`，焦点交还表格；无会话为空操作                              |
| 编辑中   | `isEditing(): boolean`                         | —      | `boolean`    | 当前是否存在编辑会话                                                                     |

键位语义：Enter 提交并下移，Tab 提交并右移，Esc 取消。编辑中锚定格滚出视口时按 Enter 语义自动提交。

### 事件订阅

| 方法         | 签名                                            | 触发                                   | 载荷                                                                               |
| ------------ | ----------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| 单元格变更   | `onCellChange(listener): () => void`            | 编辑提交回写后                         | `CellChangeEvent`：`{ col, row, oldValue, newValue }`                              |
| 编辑开始     | `onEditStart(listener): () => void`             | 编辑会话真正打开                       | `EditStartEvent`：`{ col, row, initialValue }`（基础值口径，类型未导出）           |
| 编辑结束     | `onEditEnd(listener): () => void`               | 会话结束（提交在 `onCellChange` 之后） | `EditEndEvent`：`{ col, row, initialValue, finalValue?, committed }`（类型未导出） |
| 选区变更     | `onSelectionChange(listener): () => void`       | 选区变更（拖选过程每帧）               | `SelectionSnapshot`                                                                |
| 滚动帧       | `onScrollFrame(listener): () => void`           | 滚动帧，同帧多次滚动只触发一次         | `{ left, top }`（`ScrollState`，类型未导出）                                       |
| 右键         | `onContextMenu(listener): () => void`           | 右键命中表格                           | `TableContextMenuEvent`                                                            |
| 列宽调整结束 | `onColResizeEnd(listener): () => void`          | 列宽拖拽会话结束                       | `{ col, width }`（夹取后的生效值，类型未导出）                                     |
| 行高调整结束 | `onRowResizeEnd(listener): () => void`          | 行高拖拽会话结束                       | `{ row, height }`（夹取后的生效值，类型未导出）                                    |
| 填充柄按下   | `onFillHandleDown(listener): () => void`        | 填充柄按下                             | `{ range }`（柄所在选区段，可反向，类型未导出）                                    |
| 填充拖拽结束 | `onFillDragEnd(listener): () => void`           | 填充柄拖拽结束                         | `FillDragEndEvent`：`{ anchor, target }`，均 min/max 序                            |
| 填充柄双击   | `onFillHandleDoubleClick(listener): () => void` | 填充柄双击，与拖拽结束互斥             | `{ range }`（类型未导出）                                                          |
| 链接悬停     | `onCellLinkHover(listener): () => void`         | 指针悬停命中链接格                     | `CellLinkHoverEvent`                                                               |
| 链接离开     | `onCellLinkLeave(listener): () => void`         | 指针移出已悬停的链接格                 | `CellLinkLeaveEvent`                                                               |
| 链接单击     | `onCellLinkClick(listener): () => void`         | 真实指针 down+up 命中同一链接格        | `CellLinkClickEvent`                                                               |
| 图片链接单击 | `onImageLinkClick(listener): () => void`        | 带链接的浮动图/嵌入图真实单击          | `ImageLinkClickEvent`                                                              |

填充生成算法不在内核：`onFillDragEnd` / `onFillHandleDoubleClick` 只负责事件通知，写入由宿主完成。轴锁定规则：行/列位移绝对值大者为主轴（相等取纵向），副轴夹回锚定段跨度内。

### 媒体与浮动对象

| 成员       | 签名                                   | 说明                                                                                                                                                                          |
| ---------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 图片服务   | `get imageService(): ImageService`     | 可在实例上 `request` / `releaseRef` / `updateWindow` / `hasResource` / `getBitmap` / `invalidate` / `invalidateAll` / `setUrlResolver`，并订阅 `onImageLoad` / `onImageError` |
| 浮动对象层 | `get floatObjects(): FloatObjectLayer` | 首次访问时惰性建层，挂在 sky 层选区浮层之上、滚动条之下；对象集合、选中、拖拽、缩放/旋转与事件见 [/api/grid-table](/api/grid-table)                                                       |

```ts
let loaded = 0
table.imageService.onImageLoad(() => {
  loaded++
})
table.imageService.onImageError((event) => {
  console.error('图片加载失败', event.url, event.error)
})

table.floatObjects.add({
  id: 'float-1',
  kind: 'image',
  anchor: { from: { col: 2, row: 1 }, to: { col: 4, row: 3 }, offsetX: 8, offsetY: 8 },
  src: 'https://cdn.example.com/float.png',
  title: '浮动图片',
})
```

::: tip
`imageService` 与 `floatObjects` 的具体类型未从主入口导出，只经实例面消费。图片/图表格的窗口化调度与滚动跟随由引擎自动接线，宿主无需手动调用 `syncPositions`。
:::

### 样式查询与绘制预留位

| 方法        | 签名                                                         | 参数              | 返回     | 说明                                                                                    |
| ----------- | ------------------------------------------------------------ | ----------------- | -------- | --------------------------------------------------------------------------------------- |
| 取显示文本  | `getCellText(col: number, row: number): string`              | 格坐标            | `string` | 取值管线最终文本；被合并覆盖的格取主格文本                                              |
| 回驱模型    | `updateCell(col: number, row: number, value: unknown): void` | 格坐标、新值      | `void`   | 只对 `model` 形态生效；无绑定直接返回。模型同步 echo 的派生格变更收集去重后统一局部刷新 |
| 局部刷新    | `refreshCell(col: number, row: number): void`                | 格坐标            | `void`   | 单格 region 级失效；合并区路由到主格包围盒；窗外溢出源会联动                              |
| 批量更新    | `batchUpdate(fn: () => void): void`                          | 变更函数          | `void`   | 收集 `fn` 内全部失效，结束时合并为一次 band 提交                                        |
| ground 预置 | `setUnderlayPainter(painter: UnderlayPainter \| null): void` | painter 或 `null` | `void`   | ground 层整层绘制，内容锚定视口；首次写入时惰性建层                                     |
| sky 预置    | `setOverlayPainter(painter: OverlayPainter \| null): void`   | painter 或 `null` | `void`   | 挂在 sky 层选区与浮动对象之上（滚动条仍置顶）的整层绘制；不新增 canvas 层、不拦截指针   |

`UnderlayPainter` / `OverlayPainter` 的签名都是 `(ctx: RenderContext, viewport: Size) => void`，每次整层重绘时调用。

```ts
table.setOverlayPainter((ctx, viewport) => {
  ctx.fillStyle = 'rgba(31, 35, 41, 0.06)'
  ctx.fillRect(viewport.width / 2 - 80, viewport.height - 40, 160, 20)
})
```

### 销毁

| 方法 | 签名              | 参数 | 返回   | 说明                                                                                                   |
| ---- | ----------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------ |
| 销毁 | `destroy(): void` | —    | `void` | 幂等。停止惯性滚动、解绑事件、逆序调用插件 `unmount`、销毁图片服务与自建宿主；注入的 `host` 不会被销毁 |

## 实例属性

| 属性             | 类型                                                | 说明                                                            |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| `options`        | `ListTableOptions`                                  | 构造时传入的选项对象                                            |
| `host`           | `RenderHost`                                        | 渲染宿主（注入或自建）                                          |
| `scroll`         | `{ readonly state: { left: number; top: number } }` | 滚动状态源；读写请优先用 `scrollTo` / `scrollBy` / `getScroll*` |
| `selection`      | `SelectionState`                                    | 选区状态机（类型未导出）；读写请用 `select*` / `getSelection`   |
| `editorRegistry` | `EditorRegistry`                                    | 编辑器注册表，可事后注册                                        |
| `imageService`   | `ImageService`                                      | 图片资源服务（类型未导出）                                      |
| `floatObjects`   | `FloatObjectLayer`                                  | 浮动对象层（类型未导出）                                        |
| `theme`          | `TableTheme`                                        | 当前生效主题对象                                                |
| `rowHeight`      | `number`                                            | 全表行高基准                                                    |
| `headerHeight`   | `number`                                            | 列头带高（关闭列头时为 `0`）                                    |
| `rowHeaderWidth` | `number`                                            | 行号列宽（关闭行号列时为 `0`）                                  |
| `contentWidth`   | `number`                                            | 全部列宽之和（CSS 像素，不含滚动预留）                          |
| `contentHeight`  | `number`                                            | 全部行高之和（CSS 像素，不含滚动预留）                          |

::: warning
`scroll` / `selection` / `imageService` / `floatObjects` 等字段的静态类型来自包内实现，未进入公共导出面。宿主应调用 `ListTable` 的公共方法与事件，不要依赖其内部字段结构。标注 `@internal` 的成员（如 `pokeScrollbar`、`getContainer`、`setContainerCursor`）不构成公共 API。
:::

## 相关类型

### ColumnDefine

```ts
export interface ColumnDefine {
  field?: string
  title?: string
  width?: number
  cellType?: 'text' | 'checkbox'
  editor?: string
  editorMultiline?: boolean
  editorMaxLength?: number
  textWrap?: boolean
  style?: CellStyle
}
```

| 字段              | 类型                   | 默认                         | 说明                                                           |
| ----------------- | ---------------------- | ---------------------------- | -------------------------------------------------------------- |
| `field`           | `string`               | —                            | records 取值字段；缺省时该列无数组值（仍可经 hook 或模型供给） |
| `title`           | `string`               | —                            | 列头标题；未给时回落 `resolveColTitle`，再回落空串             |
| `width`           | `number`               | `defaultColWidth`            | 列宽                                                           |
| `cellType`        | `'text' \| 'checkbox'` | `'text'`                     | 内置单元格类型                                                 |
| `editor`          | `string`               | —                            | 该列编辑器的注册名（`EditorRegistry` 格级路由的列级来源）      |
| `editorMultiline` | `boolean`              | `false`                      | `true` 走 textarea，缺省单行 input                             |
| `editorMaxLength` | `number`               | 沿 `options.editorMaxLength` | 该列编辑器字符上限                                             |
| `textWrap`        | `boolean`              | —                            | 该列文本自动换行，可被逐格样式 hook 覆盖                       |
| `style`           | `CellStyle`            | —                            | 列级样式片段，只作用于数据格                                   |

### DataRecord 与 TableModel

```ts
export type DataRecord = Record<string, unknown>

export interface TableModel {
  readonly rowCount?: number
  getCellValue(col: number, row: number): unknown
  setCellValue?(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}
```

| 成员           | 签名                                | 说明                                              |
| -------------- | ----------------------------------- | ------------------------------------------------- |
| `rowCount`     | `readonly number \| undefined`      | 行数；未给时依赖 `ListTableOptions.rowCount` 兜底 |
| `getCellValue` | `(col, row) => unknown`             | 取基础值                                          |
| `setCellValue` | `(col, row, value) => void`（可选） | 表格回驱入口；未提供时 `updateCell` 直接返回      |
| `onCellChange` | `(listener) => () => void`          | 订阅模型变更；返回退订函数                        |

### CellChangeEvent

| 字段          | 类型      | 说明                                       |
| ------------- | --------- | ------------------------------------------ |
| `col` / `row` | `number`  | 变更格坐标                                 |
| `oldValue`    | `unknown` | 变更前取值；外部模型给不出时为 `undefined` |
| `newValue`    | `unknown` | 变更后取值                                 |

### TableContextMenuEvent

| 字段            | 类型                                     | 说明                                              |
| --------------- | ---------------------------------------- | ------------------------------------------------- |
| `cell`          | `GridCellRef \| null`                    | 命中的数据格；点在行列头/空白处为 `null`          |
| `region`        | `'body' \| 'row-header' \| 'col-header'` | 右键落点区域；角点归 `'body'` 且 `cell` 为 `null` |
| `x` / `y`       | `number`                                 | 层坐标（CSS 像素）                                |
| `originalEvent` | `DomEventLike`                           | 原始 DOM 事件最小结构                             |

### 链接类型

```ts
export interface CellLink {
  url: string
  text?: string
}

export interface CellLinkHoverEvent {
  col: number
  row: number
  url: string
  text?: string
  x: number
  y: number
  originalEvent: SceneEvent['originalEvent']
}

export interface CellLinkLeaveEvent {
  col: number
  row: number
}

export interface CellLinkClickEvent {
  col: number
  row: number
  url: string
  text?: string
  originalEvent: SceneEvent['originalEvent']
}

export type ImageLinkClickEvent =
  | { kind: 'float'; id: string; url: string; originalEvent: SceneEvent['originalEvent'] }
  | {
      kind: 'cell'
      col: number
      row: number
      url: string
      originalEvent: SceneEvent['originalEvent']
    }
```

链接格默认外观来自主题 `linkColor`（默认 `#0563c1`）加下划线，可被 `resolveCellStyle` 覆盖。`onCellLinkClick` / `onImageLinkClick` 只在真实指针按下并在阈值内抬起时触发；框选拖拽和键盘选中不触发。是否执行默认打开由 `openCellLinkOnClick` 决定。

### ScrollbarOptions

字段表见上文「滚动条」小节。`mode` 缺省 `'canvas'`，`visibility` 缺省 `'hover'`，`reserve` 缺省 `true`。

### 引擎协议面与文档源注入

`ListTable` 除具体类外还实现两个协议面（插件与适配层消费，不依赖具体类）；`CanvasDocSource` 是无 DOM 环境的构造注入缝。

```ts
export interface EngineAssembly {
  readonly host: RenderHost
  readonly rowCount: number
  getCellValue(col: number, row: number): unknown
  updateCell(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
  getTheme(): TableTheme
  updateTheme(override: ThemeOverride): void
  setUnderlayPainter(painter: UnderlayPainter | null): void
  setOverlayPainter(painter: OverlayPainter | null): void
  use(plugin: TablePlugin): void
  destroy(): void
  /** 导出读取面（可选能力；表格引擎恒提供） */
  readonly read?: EngineReadView
}

export interface EngineReadView {
  readonly rowCount: number
  readonly colCount: number
  getRowHeight(row: number): number
  getColWidth(col: number): number
  getCellText(col: number, row: number): string
  getCellValue(col: number, row: number): unknown
  getCellStyle(col: number, row: number): CellStyle | undefined
  getMergeRanges(): readonly CellRange[]
}

export interface CanvasDocSource {
  createElement(tag: 'canvas'): RenderCanvas
}
```

| 类型              | 说明                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EngineAssembly`  | 引擎装配协议面（中立本体）：渲染宿主 `host`、数据面（`rowCount` / `getCellValue` / `updateCell` / `onCellChange`）、主题（`getTheme` / `updateTheme`）、painter 槽位（`setUnderlayPainter` / `setOverlayPainter`）、插件槽位（`use`）、生命周期（`destroy`）与可选导出读取面 `read`。`ListTable` 与 pivot 引擎 `PivotGrid` 等平级引擎都实现该面，只依赖协议面的插件可跨引擎挂载；成员语义与挂载细节见[插件开发](/guide/plugin-development) |
| `TableEngine`     | 表格引擎协议面（`extends EngineAssembly`）：协议本体 + 表格领域公共操作。全部成员是 `ListTable` 既有公共 API 的签名集合——即上文「公共方法」「实例属性」两节的视口/几何、滚动与命中、冻结与合并、选区、编辑、事件订阅与 `floatObjects` / `imageService`。sheet 的 `SheetGrid` 装配与 pivot 引擎经本面消费 table 引擎（`pivot.getTable()` 返回的就是它），不触碰具体类 |
| `EngineReadView`  | 导出读取面（`EngineAssembly.read` 的类型）：导出类插件读取引擎有效数据 / 样式 / 几何 / 合并区的窄接口——有效取值与原始值、有效样式、行列几何、合并区（几何区间语言）。`ListTable` 恒提供（`table.read`）；消费示例见 [/api/plugins](/api/plugins) 的 `createEnginePrintSource` |
| `CanvasDocSource` | 文档源最小结构（真实 `Document` 天然满足）：层 canvas 与测量画布创建经它。经 `ListTableOptions.doc` 注入，缺省回落运行环境全局 `document`；无 DOM 环境（SSR / 无头测试）注入替身后构造与出图不再依赖运行环境 DOM |

## 典型用法

### 纯 hook 形态与滚动条显隐

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
  scrollbar: { visibility: 'scrolling', hideDelay: 600 },
  hostOptions: { container },
})

table.scrollTo(0, 3200)
```

### 模型直挂与编辑事件

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const table = new ListTable({
  width: 620,
  height: 220,
  columns: [
    { title: '名称', width: 160, editor: 'text' },
    { title: '备注', width: 220, editor: 'text', editorMultiline: true },
  ],
  model: new SheetModel([
    ['名称-0', '备注-0'],
    ['名称-1', '备注-1'],
  ]),
  editorRegistry: registry,
  hostOptions: { container: document.querySelector<HTMLDivElement>('#table')! },
})

table.onEditStart((event) => {
  console.log('开始编辑', event.col, event.row, event.initialValue)
})
table.onCellChange((change) => {
  console.log(change.col, change.row, change.oldValue, '->', change.newValue)
})
```

### 冻结、合并与批量写

```ts
import { ListTable } from 'infinitable'

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
  hostOptions: { container: document.querySelector<HTMLDivElement>('#table')! },
})

table.batchUpdate(() => {
  for (let row = 0; row < 1000; row++) {
    table.refreshCell(1, row)
  }
})

table.setFrozenColCount(2)
```

::: tip
records 形态没有回写通道，`updateCell` 不生效。修改 `records[row][field]` 后调用 `refreshCell(col, row)`；需要 `updateCell` 时改用 `model` 形态。
:::

## 注意事项

::: warning
- **滚轮不内置**：canvas 滚动条档下引擎内置触控惯性、键盘导航与滚动条拖拽，滚轮必须由宿主接线到 `scrollBy`（`preventDefault` + `{ passive: false }`）。原生滚动条档下滚轮由容器原生处理，宿主接线处用 `table.usesNativeScrollbar` 让位。
- **`updateCell` 只对模型形态生效**：records 形态直接改行对象字段后调 `refreshCell`。
- **合并区重叠分两层**：`mergeCells` / `setMergeCells` 重叠自动规范化并 console 提示；`addMergeCell` / `new MergeCellMap` 重叠抛 `MergeOverlapError`。越界两类入口都抛错并保持原状。
- **`updateTheme` 不重算已生效几何**：`rowHeight`、`headerHeight`、`rowHeaderWidth`、`defaultColWidth` 的当前值不会因主题更新而改变；运行时改尺寸走 `setRowHeight` / `setColWidth` / `resize`。
- **表头固定一层**：`getHeaderLevelCount()` 恒返回 `1`。
- **`destroy` 幂等**：销毁后再调用渲染相关方法行为未定义；构造时注入了 `host` 则不会销毁该宿主。
- **`setRowCount` 与数据形态相关**：records 形态行数恒等于 `records.length`，增长无效；模型形态需先增长模型再调用。
:::
