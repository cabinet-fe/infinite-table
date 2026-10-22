---
title: 电子表格（sheet）
description: infinitable/sheet 公共 API 全量参考：A1 地址、稀疏单元格存储、Cell Meta、样式池与边框预设、合并/选区/填充/查找、Sheet/Workbook/FormulaEngine、命令与撤销、浮动图片、xlsx/csv 导入导出、SheetGrid 适配层。
---

# 电子表格（sheet）

`infinitable/sheet` 是电子表格模型与视图适配层，包含：

- 稀疏单元格存储、样式池、合并、选区、填充柄与查找
- `Sheet` / `Workbook` / `FormulaEngine` 模型与类型化事件
- 命令系统、补丁回放、事务与 undo/redo
- 浮动图片、按格嵌入图、超链接、只读标记
- xlsx / csv 导入导出
- `SheetGrid`：把 `Sheet` 适配到 `@infinitable/table` 的 `ListTable`

所有符号从子路径导入：

```ts
import { Sheet, Workbook, formatAddress, exportWorkbookXlsx } from 'infinitable/sheet'
```

::: tip 公式引擎不在本入口转售
`infinitable/sheet` 不导出 `@infinitable/formulas` 的 API。需要直接使用解析、求值、依赖图等能力时，从主入口 `infinitable` 导入，见 [公式引擎（formulas）](/api/formulas)。
:::

## 地址

坐标统一 0 基，区域为闭区间且 `start` 为左上角、`end` 为右下角。

```ts
interface CellAddress {
  row: number
  col: number
}

interface CellRange {
  start: CellAddress
  end: CellAddress
}
```

| 函数                   | 签名                                                          | 说明                                              |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `cellKey`              | `(addr: CellAddress) => number`                               | 地址 → 数值 key（`row * 2^20 + col`），Map 索引用 |
| `colIndexToName`       | `(col: number) => string`                                     | 0 基列号 → 列名；非法抛 `RangeError`              |
| `colNameToIndex`       | `(name: string) => number`                                    | 列名 → 0 基列号；非法返回 `-1`                    |
| `parseAddress`         | `(text: string) => CellAddress \| null`                       | 解析 `B2` / `$B$2`；非法返回 `null`               |
| `formatAddress`        | `(addr: CellAddress) => string`                               | 地址 → A1 记法                                    |
| `createRange`          | `(a: CellAddress, b: CellAddress) => CellRange`               | 两角点 → 规范化区域                               |
| `parseRange`           | `(text: string) => CellRange \| null`                         | 解析 `B2` 或 `B2:D5`                              |
| `formatRange`          | `(range: CellRange) => string`                                | 区域 → 记法；单格输出 `B2`                        |
| `rangesEqual`          | `(a: CellRange, b: CellRange) => boolean`                     | 区域相等                                          |
| `rangesIntersect`      | `(a: CellRange, b: CellRange) => boolean`                     | 是否相交                                          |
| `rangeContainsAddress` | `(range: CellRange, addr: CellAddress) => boolean`            | 区域是否包含地址                                  |
| `boundingBox`          | `(ranges: readonly [CellRange, ...CellRange[]]) => CellRange` | 最小包围盒；至少传一个区域                        |
| `iterateRange`         | `(range: CellRange) => Generator<CellAddress>`                | 按行主序遍历区域                                  |

```ts
import { formatAddress, parseRange, iterateRange } from 'infinitable/sheet'

formatAddress({ row: 1, col: 1 })  // 'B2'
parseRange('B2:D5')                 // { start: { row: 1, col: 1 }, end: { row: 4, col: 3 } }
[...iterateRange(parseRange('A1:B2')!)]
// [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }]
```

::: details 未导出的地址工具
`rangeContainsRange` 只在包内使用，未从公共入口导出。
:::

## 单元格存储

### 类型

```ts
type CellType = 'n' | 's' | 'b' | 'str' | 'e' | 'd'
type CellValue = string | number | boolean | null

interface CellData {
  v?: CellValue
  t?: CellType
  f?: string
  s?: StyleId
}

interface CellSnapshotItem extends CellData {
  row: number
  col: number
}
```

| 字段               | 说明                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| `CellType`         | `n` 数字、`s` 字符串、`b` 布尔、`str` 公式结果字符串、`e` 错误、`d` 日期（1900 序列数） |
| `CellValue`        | 原始值；`null` 表示空                                                                   |
| `CellData.v`       | 原始值；公式格为计算缓存值                                                              |
| `CellData.t`       | 值类型，缺省按 `v` 推断                                                                 |
| `CellData.f`       | 公式文本，不含前导 `=`                                                                  |
| `CellData.s`       | 样式池 `StyleId` 引用                                                                   |
| `CellSnapshotItem` | 带 `row` / `col` 的序列化条目                                                           |

### 输入规范化

```ts
const NUMERIC_TEXT_RE: RegExp
function normalizeInputValue(value: CellValue): CellValue
function inferCellType(v: CellValue): CellType | undefined
function isEmptyCellData(data: CellData | undefined): boolean
function cellDataEqual(a: CellData | undefined, b: CellData | undefined): boolean
```

| 函数                  | 行为                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `normalizeInputValue` | 数字文本 → `number`；`TRUE` / `FALSE`（忽略大小写）→ `boolean`；前导 `'` → 强制文本（去掉撇号）；其余原样 |
| `inferCellType`       | 数字 → `n`、布尔 → `b`、字符串 → `s`、`null` → `undefined`                                                |
| `isEmptyCellData`     | 无公式、无样式且值为 `null` / `undefined` / `''` 时为空；只有样式或公式的格不算空                         |
| `cellDataEqual`       | 逐字段比较 `v` / `t` / `f` / `s`                                                                          |

### CellStore

稀疏矩阵存储：`Map<row, Map<col, CellData>>`。空单元格不占存储；`rowCount` / `colCount` 是高水位，不是分配尺寸。

```ts
class CellStore {
  get rowCount(): number
  get colCount(): number
  get size(): number
  getCell(addr: CellAddress): CellData | undefined
  setCell(addr: CellAddress, data?: CellData): void
  deleteCell(addr: CellAddress): boolean
  entries(): Generator<[CellAddress, CellData]>
  entriesInRange(range: CellRange): Generator<[CellAddress, CellData]>
  rowsForColumn(col: number): Generator<number>
  peekCell(addr: CellAddress): CellData | undefined
  peekRow(row: number): Generator<[number, CellData]>
  rowKeys(): Generator<number>
  snapshot(): CellSnapshotItem[]
  restore(items: readonly CellSnapshotItem[]): void
  clear(): void
  insertRows(at: number, count: number): void
  deleteRows(at: number, count: number): void
  insertCols(at: number, count: number): void
  deleteCols(at: number, count: number): void
}
```

| 成员                                                      | 说明                                       |
| --------------------------------------------------------- | ------------------------------------------ |
| `getCell`                                                 | 返回副本；空格 `undefined`                 |
| `setCell`                                                 | 存副本；空数据等价于删除                   |
| `entries` / `entriesInRange`                              | 只遍历真实存在的格（行主序），返回副本     |
| `rowsForColumn`                                           | 该列有数据的行号（稀疏遍历）               |
| `peekCell` / `peekRow`                                    | 只读内部引用，渲染热路径用，调用方不得修改 |
| `snapshot` / `restore`                                    | 序列化 / 清空后重建，并重算高水位          |
| `insertRows` / `deleteRows` / `insertCols` / `deleteCols` | 只平移坐标，不产生新数据；操作后重算高水位 |

```ts
import { CellStore, normalizeInputValue } from 'infinitable/sheet'

const store = new CellStore()
store.setCell({ row: 0, col: 0 }, { v: normalizeInputValue('42'), t: 'n' })
store.getCell({ row: 0, col: 0 }) // { v: 42, t: 'n' }
store.size // 1
```

## 元数据（Cell Meta）

Cell Meta 是与单元格存储平行的侧车数据，按「行、列、namespace」存储可序列化载荷；不写入 `CellData`。

### 命名空间与载荷

| 常量                           | 值                | 用途                              |
| ------------------------------ | ----------------- | --------------------------------- |
| `CELL_IMAGE_META_NAMESPACE`    | `'cell-image'`    | 按格嵌入图                        |
| `CELL_LINK_META_NAMESPACE`     | `'cell-link'`     | 单元格超链接                      |
| `CELL_READONLY_META_NAMESPACE` | `'cell-readonly'` | 单元格只读标记（载荷恒为 `true`） |

```ts
interface CellImagePayload {
  src?: string
  data?: Uint8Array
  type?: SheetImageType
  fit?: ImageFitMode
  link?: string
}

interface CellLinkPayload {
  url: string
  text?: string
}

interface CellMetaSnapshotItem {
  row: number
  col: number
  namespace: string
  payload: unknown
}
```

| 字段                    | 说明                                       |
| ----------------------- | ------------------------------------------ |
| `CellImagePayload.src`  | URL 来源；存在时优先于 `data`              |
| `CellImagePayload.data` | 图片字节（渲染层转 objectURL）             |
| `CellImagePayload.type` | 图片格式；缺省按 `png`                     |
| `CellImagePayload.fit`  | `contain` 保比例（缺省）或 `fill` 拉伸铺满 |
| `CellImagePayload.link` | 图片超链接；缺省无链接                     |
| `CellLinkPayload.url`   | 链接 URL                                   |
| `CellLinkPayload.text`  | 可选显示文本；缺省显示单元格原值           |

::: warning 两种图片的 `fit` 缺省不同
按格嵌入图 `CellImagePayload.fit` 缺省为 `contain`；浮动图 `SheetImage.fit` 缺省为 `fill`。两者不要混用同一套缺省假设。
:::

### 工具与存储

```ts
function cellMetaKey(row: number, col: number, namespace: string): string
function cellMetaKeyFrom(addr: CellAddress, namespace: string): string
function cloneCellMetaPayload(payload: unknown): unknown
function cellMetaPayloadEqual(a: unknown, b: unknown): boolean

class CellMetaStore {
  get(addr: CellAddress, namespace: string): unknown
  peek(addr: CellAddress, namespace: string): unknown
  set(addr: CellAddress, namespace: string, payload: unknown): void
  snapshot(): CellMetaSnapshotItem[]
  restore(items: CellMetaSnapshotItem[] | undefined): void
  applyStructureChange(change: StructureChange): void
}
```

| 成员                                 | 说明                                         |
| ------------------------------------ | -------------------------------------------- |
| `cellMetaKey`                        | 生成 `${row},${col}\0${namespace}` 键        |
| `cloneCellMetaPayload`               | 深拷贝；`structuredClone` 不可用时回退 JSON  |
| `cellMetaPayloadEqual`               | JSON 序列化比较，用于无变更跳过              |
| `CellMetaStore.get`                  | 返回副本；不存在 `undefined`                 |
| `CellMetaStore.peek`                 | 原始引用，不带拷贝；不得持有或修改           |
| `CellMetaStore.set`                  | 写入副本；`payload === undefined` 等价于删除 |
| `CellMetaStore.snapshot`             | 按 `row`、`col`、`namespace` 排序输出        |
| `CellMetaStore.applyStructureChange` | 行列插删时平移坐标与载荷内嵌地址             |

通常不直接操作 `CellMetaStore`，而是经 `Sheet` 的 meta / 链接 / 嵌入图 / 只读方法写入，以获得命令与 undo 支持。

```ts
import { CELL_LINK_META_NAMESPACE, CELL_IMAGE_META_NAMESPACE } from 'infinitable/sheet'

sheet.setCellLink({ row: 0, col: 0 }, { url: 'https://example.com', text: '官网' })
sheet.getCellMeta({ row: 0, col: 0 }, CELL_LINK_META_NAMESPACE)
// { url: 'https://example.com', text: '官网' }

sheet.setCellImage({ row: 1, col: 1 }, { src: '/logo.png', fit: 'contain' })
sheet.getCellMeta({ row: 1, col: 1 }, CELL_IMAGE_META_NAMESPACE)
// { src: '/logo.png', fit: 'contain' }
```

## 样式

样式定义集中在 `StylePool`，单元格只存 `StyleId`。

### 类型

```ts
type BorderLineStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted'
type HorizontalAlign = 'left' | 'center' | 'right'
type VerticalAlign = 'top' | 'middle' | 'bottom'
type StyleId = number

interface BorderEdge {
  style: BorderLineStyle
  width: number
  color: string
}

interface CellFont {
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  size?: number
}

interface CellAlign {
  horizontal?: HorizontalAlign
  vertical?: VerticalAlign
  wrap?: boolean
}

type NumFmt =
  | { type: 'date' }
  | { type: 'thousands' }
  | { type: 'cnUpper' }
  | { type: 'fixed'; digits: number }

interface CellStyle {
  fill?: { color: string }
  border?: Partial<Record<BorderSide, BorderEdge>>
  font?: CellFont
  align?: CellAlign
  numFmt?: NumFmt
}
```

| 类型                 | 说明                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `BorderLineStyle`    | 实线三档粗细 + 虚线 / 点线                                                                       |
| `BorderSide`         | `'top' \| 'right' \| 'bottom' \| 'left'`；`BORDER_SIDES` 为 `['top', 'right', 'bottom', 'left']` |
| `BorderEdge.width`   | 线宽（px）                                                                                       |
| `CellFont.size`      | 字号，单位 pt（渲染时 ×4/3 转 px）                                                               |
| `CellAlign.vertical` | 模型用 `middle`；xlsx 导出映射为 `center`                                                        |
| `NumFmt`             | 只影响显示：日期、千分位、中文大写金额、固定小数位                                               |
| `CellStyle`          | 样式池条目；缺省字段表示不设置                                                                   |

### 部分样式补丁

```ts
interface CellStylePatch {
  fill?: { color?: string }
  border?: Partial<Record<BorderSide, Partial<BorderEdge> | null>>
  font?: {
    color?: string | null
    bold?: boolean | null
    italic?: boolean | null
    underline?: boolean | null
    strikethrough?: boolean | null
    size?: number | null
  }
  align?: {
    horizontal?: HorizontalAlign | null
    vertical?: VerticalAlign | null
    wrap?: boolean | null
  }
  numFmt?: NumFmt | null
}
```

合并语义：

- 顶层浅合并：只给 `fill` 时保留既有 `border` / `font` / `align`，反之亦然。
- `fill` 存在即覆盖；`{}` 或 `{ color: undefined }` 清除填充，保留其余。
- `border` 边级合并：边值为对象时与既有边合并，缺失字段用默认值补全；边值为 `null` 删除该边；未列出的边保留。
- `font` / `align` 逐字段合并；字段值为 `null` 删除该字段；`{}` 清除该类全部字段。
- `numFmt` 存在即整体替换；`null` 删除。

### 常量

| 常量                   | 值 / 说明                                                       |
| ---------------------- | --------------------------------------------------------------- |
| `BORDER_SIDES`         | `['top', 'right', 'bottom', 'left']`                            |
| `BORDER_STYLE_WIDTH`   | `thin: 1`、`medium: 2`、`thick: 3`、`dashed: 1`、`dotted: 1`    |
| `BORDER_EDGE_DEFAULTS` | `{ style: 'thin', width: 1, color: '#000000' }`                 |
| `FONT_STYLE_KEYS`      | `color`、`bold`、`italic`、`underline`、`strikethrough`、`size` |
| `ALIGN_STYLE_KEYS`     | `horizontal`、`vertical`、`wrap`                                |

### StylePool

```ts
class StylePool {
  get size(): number
  intern(style: CellStyle): StyleId
  get(id: StyleId): CellStyle | undefined
  peek(id: StyleId): CellStyle | undefined
  hasAlignWrap(): boolean
  snapshot(): CellStyle[]
  restore(items: readonly CellStyle[]): void
  clear(): void
}
```

- `intern` 先规范化（剔除空字段、空边），按稳定序列化 key 去重；相同内容返回同一 id。
- 空样式调用 `intern` 抛 `StylePool.intern：空样式不能内部化`。
- id 从 1 起递增；池只增不减，undo 回放不回收定义。
- `snapshot` 按 id 升序导出；`restore` 清空后按序重建，单元格的 `s` 引用仍有效。
- `peek` 返回内部引用，渲染热路径用，不得修改。

### 层叠与边框预设

```ts
function composeCellStyles(
  base: CellStyle | undefined,
  overlay: CellStyle | undefined,
): CellStyle | undefined
```

层叠顺序为列 → 行 → 格，后者覆盖同名字段：

- `fill`：`overlay` 含 `fill` 则整层替换（无 `color` 即清除）。
- `border`：边级替换，未给出的边保留 `base`。
- `font` / `align`：字段级覆盖。
- `numFmt`：`overlay` 定义则覆盖。

```ts
type BorderPreset = 'outer' | 'inner' | 'all' | 'top' | 'bottom' | 'left' | 'right' | 'none'

interface BorderPresetItem {
  addr: CellAddress
  patch: CellStylePatch
}

function buildBorderPresetItems(
  range: CellRange,
  preset: BorderPreset,
  edge: BorderEdge,
  getStyle: (addr: CellAddress) => CellStyle | undefined,
): BorderPresetItem[]
```

预设展开为逐格补丁，可交给 `sheet.setCellStyles(items)` 一次执行（单 undo 单元）。共享边同步邻居：外边框与单侧边框会把选区外邻居的对侧边写 `null`；无边框会把每格四边写 `null`。邻居 `null` 边只在邻居确有该边时生成。

```ts
import { buildBorderPresetItems, composeCellStyles } from 'infinitable/sheet'

const items = buildBorderPresetItems(
  { start: { row: 0, col: 0 }, end: { row: 3, col: 2 } },
  'outer',
  { style: 'thin', width: 1, color: '#333333' },
  (addr) => sheet.getCellStyle(addr),
)
sheet.setCellStyles(items)

composeCellStyles(
  { fill: { color: '#eeeeee' }, font: { bold: true } },
  { fill: { color: '#ffeeaa' }, align: { horizontal: 'center' } },
)
// { fill: { color: '#ffeeaa' }, font: { bold: true }, align: { horizontal: 'center' } }
```

## 合并、选区、填充、查找

### MergeManager

```ts
type MergedCellKind = 'normal' | 'merged-anchor' | 'merged-covered'

interface CellInfo {
  kind: MergedCellKind
  anchor: CellAddress
  mergeRange?: CellRange
}

interface MergeResult {
  range: CellRange
  removed: CellRange[]
}

class MergeManager {
  computeMerge(range: CellRange): MergeResult
  addMerge(range: CellRange): void
  removeMerge(range: CellRange): void
  resolveAnchor(addr: CellAddress): CellAddress
  getMergeAt(addr: CellAddress): CellRange | undefined
  getCellInfo(addr: CellAddress): CellInfo
  getMerges(): CellRange[]
  get size(): number
  clear(): void
  shiftRowsInsert(at: number, count: number): void
  shiftColsInsert(at: number, count: number): void
  shiftRowsDelete(at: number, count: number): void
  shiftColsDelete(at: number, count: number): void
}
```

- 锚点恒为区域左上角，数据只存在锚点格。
- `computeMerge` 只查询不改状态：返回与入参相交的既有合并、最终包围盒与被解除的旧合并。
- `addMerge` / `removeMerge` 是精确登记 / 移除，供命令回放使用；不做相交解算。
- `resolveAnchor` 把被覆盖格解析到锚点；普通格返回自身。
- `shift*` 实现行列插删时的合并区平移、扩展与裁剪。

### SelectionModel

```ts
interface SelectionState {
  activeCell: CellAddress | null
  ranges: CellRange[]
}

class SelectionModel {
  constructor(
    resolveAnchor: (addr: CellAddress) => CellAddress,
    resolveRange?: (addr: CellAddress) => CellRange,
  )
  get activeCell(): CellAddress | null
  get ranges(): CellRange[]
  selectCell(addr: CellAddress): void
  selectRange(range: CellRange, active?: CellAddress): void
  getState(): SelectionState
  restoreState(state: SelectionState): void
  on(handler: (state: SelectionState) => void): () => void
}
```

- `activeCell` 永远是锚点；选中被覆盖格时自动解析到合并锚点并扩展选区。
- `selectRange` 的 `active` 缺省为区域起点；传入值会被钳入区域并解析锚点。
- 状态相等时不去重发事件；`on` 返回退订函数。
- `restoreState` 静默写入，不发 `change`。

### 填充

```ts
type FillDirection = 'top' | 'bottom' | 'left' | 'right'

interface GenerateFillOptions {
  source: CellRange
  target: CellRange
  direction: FillDirection
  getCellData: (addr: CellAddress) => CellData | undefined
}

function computeFillTargetRange(
  source: CellRange,
  direction: FillDirection,
  expanded: CellRange,
): CellRange | null

function generateFill(options: GenerateFillOptions): SetCellValueItem[]
```

- `computeFillTargetRange` 由源选区、方向和拖拽后的扩展选区算出需要写入的目标区；无扩展返回 `null`。
- `generateFill`：公式格经 `shiftFormulaRefs` 平移相对引用（`$` 锁定）；数字 / 日期按等差序列；其余按源区 tile 复制。
- 返回值交给 `sheet.setCells(items)`，一次调用即一个 undo 单元。

### 查找

```ts
interface FindOptions {
  caseSensitive?: boolean
  wholeCell?: boolean
  searchIn?: 'value' | 'formula'
}

interface FindMatch {
  addr: CellAddress
  text: string
}

function findAll(sheet: Sheet, query: string, options?: FindOptions): FindMatch[]
function findNext(
  sheet: Sheet,
  query: string,
  from: CellAddress,
  options?: FindOptions,
): FindMatch | null
function findPrev(
  sheet: Sheet,
  query: string,
  from: CellAddress,
  options?: FindOptions,
): FindMatch | null
function findNextFrom(matches: FindMatch[], from: CellAddress): FindMatch | null
function findPrevFrom(matches: FindMatch[], from: CellAddress): FindMatch | null
```

| 选项            | 默认      | 说明                                                       |
| --------------- | --------- | ---------------------------------------------------------- |
| `caseSensitive` | `false`   | 是否区分大小写                                             |
| `wholeCell`     | `false`   | 整格相等；`false` 为包含匹配                               |
| `searchIn`      | `'value'` | `'value'` 匹配显示值，`'formula'` 匹配公式原文（不含 `=`） |

遍历范围只包含存储中真实存在的格（行主序）；合并格只存锚点，显示值天然不重复。`findNext` / `findPrev` 从 `from` 严格之后 / 之前开始，到边界后循环。`findNextFrom` / `findPrevFrom` 在已排序命中数组上二分查找，适合缓存命中导航。

```ts
import { computeFillTargetRange, generateFill, findAll, findNext } from 'infinitable/sheet'

const source = { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } }
const target = computeFillTargetRange(source, 'bottom', {
  start: { row: 0, col: 0 },
  end: { row: 4, col: 0 },
})!

const items = generateFill({
  source,
  target,
  direction: 'bottom',
  getCellData: (addr) => sheet.getCellData(addr),
})
sheet.setCells(items)
sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 0, col: 3 } })
sheet.selectRange({ start: { row: 0, col: 0 }, end: { row: 0, col: 3 } })

const matches = findAll(sheet, '合计', { wholeCell: false })
const next = findNext(sheet, '合计', { row: 0, col: 0 })
```

## 模型与事件

### Sheet

`Sheet` = 单元格存储 + 合并 + 选区 + 历史 + 公式引擎 + 样式池的统一入口。所有写操作经命令系统执行，天然支持 undo/redo。

```ts
class Sheet {
  constructor(name?: string, formulaGraph?: FormulaEngine)

  readonly store: CellStore
  readonly merges: MergeManager
  readonly selection: SelectionModel
  readonly history: HistoryManager
  readonly formulaGraph: FormulaEngine
  readonly stylePool: StylePool

  get name(): string
  get rowCount(): number
  get colCount(): number
  get rows(): number
  get cols(): number
  get frozen(): FrozenState

  getCellData(addr: CellAddress): CellData | undefined
  getDisplayValue(addr: CellAddress): CellValue | undefined
  setCellValue(addr: CellAddress, value: CellValue): void
  setCell(addr: CellAddress, data?: CellData): void
  setCellFormula(addr: CellAddress, formula: string): void
  setCells(items: SetCellValueItem[]): void

  setCellStyle(range: CellRange, partial: CellStylePatch): void
  setCellStyles(items: SetCellStyleItem[]): void
  clearCellStyle(range: CellRange): void
  getCellStyle(addr: CellAddress): CellStyle | undefined
  getRowStyle(row: number): CellStyle | undefined
  getRowStyleId(row: number): StyleId | undefined
  getRowStyleIds(): ReadonlyMap<number, StyleId>
  setRowStyle(row: number, partial: CellStylePatch): void
  clearRowStyle(row: number): void
  getColStyle(col: number): CellStyle | undefined
  getColStyleId(col: number): StyleId | undefined
  getColStyleIds(): ReadonlyMap<number, StyleId>
  setColStyle(col: number, partial: CellStylePatch): void
  clearColStyle(col: number): void
  getEffectiveStyle(addr: CellAddress): CellStyle | undefined

  getRowHeight(row: number): number | undefined
  setRowHeight(row: number, height: number): void
  getRowHeights(): ReadonlyMap<number, number>
  getColWidth(col: number): number | undefined
  setColWidth(col: number, width: number): void
  getColWidths(): ReadonlyMap<number, number>
  get defaultRowHeight(): number | undefined
  setDefaultRowHeight(height: number | undefined): void
  get defaultColWidth(): number | undefined
  setDefaultColWidth(width: number | undefined): void

  setFrozen(rows: number, cols: number): void

  getCellInfo(addr: CellAddress): CellInfo
  mergeCells(range: CellRange): CellRange
  mergeCellsBatch(ranges: CellRange[]): void
  unmergeCells(range: CellRange): void

  getImages(): readonly SheetImage[]
  getImage(id: string): SheetImage | undefined
  insertImage(input: ImageInput): string
  removeImage(id: string): void
  updateImage(id: string, patch: ImageUpdateFields): void

  getCellMeta<T = unknown>(addr: CellAddress, namespace: string): T | undefined
  setCellMeta(addr: CellAddress, namespace: string, payload: unknown): void
  clearCellMeta(addr: CellAddress, namespace: string): void

  setCellImage(addr: CellAddress, image: CellImagePayload | null): void
  getCellImage(addr: CellAddress): CellImagePayload | undefined
  hasCellImage(addr: CellAddress): boolean
  insertCellImage(addr: CellAddress, image: CellImagePayload): void
  removeCellImage(addr: CellAddress): void

  setCellLink(addr: CellAddress, link: CellLinkPayload | null): void
  getCellLink(addr: CellAddress): CellLinkPayload | undefined
  clearCellLink(addr: CellAddress): void

  setCellReadonly(addr: CellAddress, readonly?: boolean): void
  setRangeReadonly(range: CellRange, readonly?: boolean): void
  isCellReadonly(addr: CellAddress): boolean

  executeCommand<R = void>(commandId: string, params: unknown): R | undefined
  beginTransaction(): void
  commit(): void
  rollback(): void
  undo(): boolean
  redo(): boolean
  get canUndo(): boolean
  get canRedo(): boolean

  insertRows(at: number, count?: number): void
  insertCols(at: number, count?: number): void
  deleteRows(at: number, count?: number): void
  deleteCols(at: number, count?: number): void

  getSelection(): SelectionState
  selectCell(addr: CellAddress): void
  selectRange(range: CellRange, active?: CellAddress): void

  snapshot(): SheetSnapshot
  restore(snapshot: SheetSnapshot): void

  on<K extends keyof SheetEvents>(type: K, handler: (payload: SheetEvents[K]) => void): () => void
}
```

关键语义：

| 方法 / 属性               | 说明                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `getCellData`             | 原始存储语义；被合并覆盖的非锚点格返回 `undefined`                |
| `getDisplayValue`         | 锚点解析语义；被覆盖格返回锚点的值                                |
| `setCellValue`            | 解析锚点后写入；字符串以 `=` 开头时转为公式；空值清除；经命令执行 |
| `setCell`                 | 写入完整 `CellData`；空数据清除                                   |
| `setCellFormula`          | 可带或不带 `=`；空白公式清除；解析失败运行时为 `#ERROR!`          |
| `setCells`                | 批量写入；一次调用 = 一个 undo 单元                               |
| `setCellStyle`            | 区域部分样式；样式只存锚点格                                      |
| `clearCellStyle`          | 清除样式，保留值与公式；纯样式格被整体删除                        |
| `getCellStyle`            | 原始存储语义；被覆盖格返回 `undefined`                            |
| `getEffectiveStyle`       | 列 → 行 → 格字段级叠加，合并格读锚点                              |
| 行高 / 列宽 / 默认尺寸    | 不进 undo，随快照序列化                                           |
| `frozen` / `setFrozen`    | 不进 undo；冻结变化发 `frozen-change`                             |
| `mergeCells`              | 保留包围盒内按行主序第一个有值格的值，写入新锚点；返回最终区域    |
| `mergeCellsBatch`         | 批量合并，一次调用 = 一个 undo 单元                               |
| 图片 / meta / 链接 / 只读 | 经命令执行，可撤销，随快照序列化，行列插删时平移                  |
| `setRangeReadonly`        | 事务包裹逐格标记，合并为单 undo 单元                              |
| 只读拦截                  | 在 grid 层生效；模型层不阻止绕过 `SheetGrid` 的命令写入           |
| `undo` / `redo`           | 无可用项时返回 `false`；事务进行中返回 `false`                    |
| `snapshot` / `restore`    | 全量快照；`restore` 静默恢复，不进 undo                           |
| `on`                      | 返回退订函数                                                      |

::: details 内部方法
以下方法标记为 `@internal`，由视图层、命令或 `Workbook` 编排调用，不属于稳定公共面：`setName`、`ensureTableSize`、`applyDerivedPatches`、`applyStructureChange`、`prepareDeletedCellPatches`、`prepareFormulaShift`、`prepareDeletedImagePatches`、`prepareShiftedImagePatches`、`restoreContent`、`peekCellMeta`。
:::

### 快照与事件

```ts
interface FrozenState {
  rows: number
  cols: number
}

interface SheetSnapshot {
  cells: CellSnapshotItem[]
  styles: CellStyle[]
  merges: CellRange[]
  frozen: FrozenState
  rows: number
  cols: number
  selection?: { activeCell: CellAddress; ranges: CellRange[] }
  rowHeights?: [number, number][]
  colWidths?: [number, number][]
  rowStyles?: [number, StyleId][]
  colStyles?: [number, StyleId][]
  images?: SheetImage[]
  meta?: CellMetaSnapshotItem[]
}
```

| 字段                          | 说明                                   |
| ----------------------------- | -------------------------------------- |
| `cells` / `styles` / `merges` | 单元格、样式池、合并区                 |
| `frozen`                      | 冻结行数 / 列数                        |
| `rows` / `cols`               | 表格尺寸；`0` 表示未声明，由视图层决定 |
| `selection`                   | 可选；旧快照缺省时回落 A1；不进 undo   |
| `rowHeights` / `colWidths`    | 自定义行高 / 列宽；不进 undo           |
| `rowStyles` / `colStyles`     | 行 / 列默认样式 `StyleId`              |
| `images`                      | 浮动图片                               |
| `meta`                        | Cell Meta 侧车                         |

`SheetEvents`：

| 事件                | 载荷                                      | 触发时机                             |
| ------------------- | ----------------------------------------- | ------------------------------------ |
| `cell-change`       | `{ addr }`                                | 单元格数据变化（含删除）             |
| `merge-change`      | `{ range }`                               | 合并 / 取消合并                      |
| `selection-change`  | `SelectionState`                          | 选区变化                             |
| `history-change`    | `HistoryState`                            | undo / redo 可用状态变化             |
| `frozen-change`     | `FrozenState`                             | 冻结状态变化                         |
| `structure-change`  | `StructureChange`                         | 行列插入 / 删除                      |
| `content-reset`     | `undefined`                               | 整表内容替换（导入、undo/redo 回放） |
| `image-change`      | `{ id?: string }`                         | 浮动图片集合变化；整表替换时 id 缺省 |
| `meta-change`       | `{ addr?; namespace? }`                   | Cell Meta 变化；整表替换时字段缺省   |
| `cell-image-change` | `{ addr? }`                               | 按格嵌入图变化                       |
| `axis-style-change` | `{ axis: 'row' \| 'col'; index: number }` | 行 / 列默认样式变化                  |

```ts
import { Sheet } from 'infinitable/sheet'

const sheet = new Sheet('Sheet1')
sheet.setCellValue({ row: 0, col: 0 }, 10)
sheet.setCellFormula({ row: 0, col: 1 }, '=A1*2')
sheet.getDisplayValue({ row: 0, col: 1 }) // 20

const off = sheet.on('cell-change', ({ addr }) => console.log(addr))
sheet.undo()
off()
```

### Workbook

```ts
type WorkbookEvents = {
  'active-sheet-change': { sheet: Sheet; index: number }
  'sheets-change': { sheets: Sheet[] }
  'sheet-rename': { sheet: Sheet; oldName: string; newName: string }
}

type AddSheetCellInput = CellValue | undefined | Omit<CellData, 's'>

interface AddSheetOptions {
  data?: readonly (readonly AddSheetCellInput[])[]
  rows?: number
  cols?: number
}

class Workbook {
  readonly formulaGraph: FormulaEngine
  get sheetCount(): number
  get activeSheet(): Sheet
  get activeSheetIndex(): number
  getSheets(): Sheet[]
  getSheet(name: string): Sheet | undefined
  addSheet(name?: string, options?: AddSheetOptions): Sheet
  removeSheet(name: string): boolean
  renameSheet(oldName: string, newName: string): boolean
  activateSheet(name: string): boolean
  beginBatch(): void
  endBatch(): void
  on<K extends keyof WorkbookEvents>(
    type: K,
    handler: (payload: WorkbookEvents[K]) => void,
  ): () => void
}
```

| 成员                      | 说明                                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 构造                      | 自动创建 `Sheet1`                                                                                                                  |
| `formulaGraph`            | 工作簿级公式引擎，全部 sheet 共享                                                                                                  |
| `addSheet`                | 名称缺省 `Sheet{n}`；初始数据经一次 `setCells` 写入后清空历史（基线状态不进 undo）；`rows` / `cols` 与数据行列数取大，非正整数抛错 |
| `removeSheet`             | 至少保留一个 sheet；删除后引用该表的公式立即变 `#REF!`（不进 undo）                                                                |
| `renameSheet`             | 空名或重名（不区分大小写）返回 `false`；成功后重索引依赖图，跨表引用跟随新名                                                       |
| `activateSheet`           | 不存在或已是当前项返回 `false`                                                                                                     |
| `beginBatch` / `endBatch` | 可嵌套；期间结构事件抑制，结束时合并补发                                                                                           |
| `AddSheetOptions.data`    | 二维数组，从 A1 起写入；`null` / `undefined` / `''` 跳过；对象形态支持 `{ v, t, f }`，不支持 `s`                                   |

```ts
import { Workbook } from 'infinitable/sheet'

const workbook = new Workbook()
const sheet2 = workbook.addSheet('汇总', {
  data: [
    ['名称', '金额'],
    ['A', 100],
    ['B', 200],
  ],
  rows: 100,
  cols: 10,
})

workbook.renameSheet('汇总', 'Summary')
workbook.activateSheet('Summary')
```

### FormulaEngine

`FormulaEngine` 是 `@infinitable/formulas` 的组合门面：依赖索引用 `DependencyGraph`，求值用 `evaluate`，自身负责 sheet 注册、改名别名、标脏闭包、拓扑序重算与环检测。

```ts
interface FormulaNodeView {
  readonly sheetName: string
  readonly addr: CellAddress
}

class FormulaEngine {
  registerSheet(sheet: Sheet): void
  getSheet(name: string): Sheet | undefined
  get nodeCount(): number
  allNodes(): Generator<[Sheet, FormulaNodeView]>
  unregisterSheet(sheet: Sheet): CellPatch[]
  renameSheet(oldName: string, newName: string): void
  syncCell(sheet: Sheet, addr: CellAddress, before?: CellData, after?: CellData): void
  rebuildSheet(sheet: Sheet, cells: readonly CellSnapshotItem[]): void
  recalc(changed: readonly { sheet: Sheet; addr: CellAddress }[]): CellPatch[]
}
```

`FormulaNodeView` 未从公共入口导出，此处展示 `allNodes()` 返回项的结构。

| 方法              | 说明                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `registerSheet`   | 注册 sheet 到引擎                                                        |
| `getSheet`        | 按当前表名查找；别名不在此解析                                           |
| `nodeCount`       | 公式节点总数                                                             |
| `allNodes`        | 遍历全部公式节点                                                         |
| `unregisterSheet` | 注销并移除节点，重算引用方，返回**未应用**的派生补丁（引用方变 `#REF!`） |
| `renameSheet`     | 重排注册表、别名与依赖边；公式原文不重写，旧名经别名解析                 |
| `syncCell`        | 单元格 `f` 增删改后的图同步；由 `Sheet` 的补丁通道调用                   |
| `rebuildSheet`    | 整表内容替换后的图重建                                                   |
| `recalc`          | 变更集 → 标脏 + 拓扑序重算，返回未应用的派生补丁；易失公式格必然重算     |

环形引用在递归求值栈上检测，环上格产出 `#CYCLE!`；环外格只传播错误。求值结果写回 `v` / `t`，保留既有样式 `s`。

### TypedEventEmitter

```ts
class TypedEventEmitter<EventMap extends Record<string, unknown>> {
  on<K extends keyof EventMap>(type: K, handler: (payload: EventMap[K]) => void): () => void
  off<K extends keyof EventMap>(type: K, handler: (payload: EventMap[K]) => void): void
  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void
}
```

`on` 返回退订函数。`Sheet`、`Workbook`、`HistoryManager`、`SelectionModel` 内部均使用它。

## 命令与撤销

模型的一切变更都是命令，执行时产出 `Mutation`；`Patch` 是 before/after 差量，同一批补丁双向回放。

### 补丁与命令类型

```ts
type PatchDirection = 'undo' | 'redo'

interface CellPatch {
  kind: 'cell'
  addr: CellAddress
  sheet?: Sheet
  before?: CellData
  after?: CellData
}

interface MergePatch {
  kind: 'merge'
  range: CellRange
  before: boolean
  after: boolean
}

type StructureChange =
  | { kind: 'insert-rows'; at: number; count: number }
  | { kind: 'delete-rows'; at: number; count: number }
  | { kind: 'insert-cols'; at: number; count: number }
  | { kind: 'delete-cols'; at: number; count: number }

interface StructurePatch {
  kind: 'structure'
  change: StructureChange
  beforeRows: number
  beforeCols: number
}

interface SnapshotPatch {
  kind: 'snapshot'
  snapshot: SheetSnapshot
}

interface ImagePatch {
  kind: 'image'
  id: string
  before?: SheetImage
  after?: SheetImage
}

interface CellMetaPatch {
  kind: 'cell-meta'
  addr: CellAddress
  namespace: string
  before?: unknown
  after?: unknown
}

interface AxisStylePatch {
  kind: 'axis-style'
  axis: 'row' | 'col'
  index: number
  before?: number
  after?: number
}

type Patch =
  | CellPatch
  | MergePatch
  | StructurePatch
  | SnapshotPatch
  | ImagePatch
  | CellMetaPatch
  | AxisStylePatch

interface Mutation {
  redo: Patch[]
  undo: Patch[]
}

interface CommandResult<R = unknown> {
  mutations: Mutation[]
  result?: R
}

interface CommandContext {
  sheet: Sheet
  applyPatch(patch: Patch, direction: PatchDirection): void
}

interface Command<P = unknown, R = unknown> {
  readonly id: string
  handler(ctx: CommandContext, params: P): CommandResult<R> | undefined
}
```

`CellPatch.sheet` 用于跨表派生补丁路由；缺省表示命令所在 sheet。`SnapshotPatch` 只替换 `cells` / `styles` / `merges` / `images` / 行列表样式，冻结、行高、列宽、尺寸、选区保持当前。

### 内置命令

| 命令类                   | id                                | 参数类型                |
| ------------------------ | --------------------------------- | ----------------------- |
| `SetCellValueCommand`    | `sheet.command.set-cell-value`    | `SetCellValueParams`    |
| `SetCellFormulaCommand`  | `sheet.command.set-cell-formula`  | `SetCellFormulaParams`  |
| `SetCellStyleCommand`    | `sheet.command.set-cell-style`    | `SetCellStyleParams`    |
| `SetAxisStyleCommand`    | `sheet.command.set-axis-style`    | `SetAxisStyleParams`    |
| `InsertCellsCommand`     | `sheet.command.insert-cells`      | `InsertCellsParams`     |
| `MergeCellsCommand`      | `sheet.command.merge-cells`       | `MergeCellsParams`      |
| `MergeCellsBatchCommand` | `sheet.command.merge-cells-batch` | `MergeCellsBatchParams` |
| `UnmergeCellsCommand`    | `sheet.command.unmerge-cells`     | `UnmergeCellsParams`    |
| `InsertImageCommand`     | `sheet.insert-image`              | `InsertImageParams`     |
| `RemoveImageCommand`     | `sheet.remove-image`              | `RemoveImageParams`     |
| `UpdateImageCommand`     | `sheet.update-image`              | `UpdateImageParams`     |
| `SetCellMetaCommand`     | `sheet.set-cell-meta`             | `SetCellMetaParams`     |
| `ClearCellMetaCommand`   | `sheet.clear-cell-meta`           | `ClearCellMetaParams`   |
| `SetCellLinkCommand`     | `sheet.set-cell-link`             | `SetCellLinkParams`     |
| `ClearCellLinkCommand`   | `sheet.clear-cell-link`           | `ClearCellLinkParams`   |
| `InsertCellImageCommand` | `sheet.insert-cell-image`         | `InsertCellImageParams` |
| `RemoveCellImageCommand` | `sheet.remove-cell-image`         | `RemoveCellImageParams` |

参数类型：

```ts
interface SetCellValueItem {
  addr: CellAddress
  data?: CellData
}
interface SetCellValueParams {
  items: SetCellValueItem[]
}

interface SetCellFormulaParams {
  addr: CellAddress
  formula: string
}

interface SetCellStyleItem {
  addr: CellAddress
  partial?: CellStylePatch
  clear?: boolean
}
interface SetCellStyleParams {
  items: SetCellStyleItem[]
}

interface SetAxisStyleItem {
  index: number
  partial?: CellStylePatch
  clear?: boolean
}
interface SetAxisStyleParams {
  axis: 'row' | 'col'
  items: SetAxisStyleItem[]
}

interface InsertCellsParams {
  change: StructureChange
}

interface MergeCellsParams {
  range: CellRange
}
interface UnmergeCellsParams {
  range: CellRange
}
interface MergeCellsBatchParams {
  ranges: CellRange[]
}

interface InsertImageParams {
  image: ImageInput
}
interface RemoveImageParams {
  id: string
}

interface ImageUpdateFields {
  anchor?: SheetImageAnchor
  width?: number
  height?: number
  rotation?: number
  altText?: string
  title?: string
  link?: string | null
}

interface UpdateImageParams {
  id: string
  patch: ImageUpdateFields
}

interface SetCellMetaParams {
  addr: CellAddress
  namespace: string
  payload: unknown
}
interface ClearCellMetaParams {
  addr: CellAddress
  namespace: string
}

interface SetCellLinkParams {
  addr: CellAddress
  link: CellLinkPayload
}
interface ClearCellLinkParams {
  addr: CellAddress
}

interface InsertCellImageParams {
  addr: CellAddress
  image: CellImagePayload
}
interface RemoveCellImageParams {
  addr: CellAddress
}
```

::: warning 未导出的恢复命令
`RestoreSheetCommand`（id `sheet.restore-sheet`）已注册在 `defaultCommandRegistry` 中，供导入与快照替换使用，但类本身未从 `infinitable/sheet` 顶层导出。业务代码应通过 `importXlsx` / `replaceWorkbookWithSnapshots` 触发，而不是直接构造该命令。
:::

### 注册表与历史

```ts
class CommandRegistry {
  register(command: Command): void
  get(id: string): Command | undefined
  execute<R>(ctx: CommandContext, id: string, params: unknown): CommandResult<R> | undefined
}

const defaultCommandRegistry: CommandRegistry

class HistoryManager {
  constructor(applyPatch: (patch: Patch, direction: PatchDirection) => void, capacity?: number)
  get canUndo(): boolean
  get canRedo(): boolean
  get undoSize(): number
  get redoSize(): number
  get inTransaction(): boolean
  push(mutations: Mutation[]): void
  beginTransaction(): void
  commit(): void
  rollback(): void
  undo(): boolean
  redo(): boolean
  clear(): void
  onChange(handler: (state: HistoryState) => void): () => void
}

interface HistoryState {
  canUndo: boolean
  canRedo: boolean
}
```

- `CommandRegistry.register` 重复 id 抛 `命令重复注册: ${id}`；`execute` 未注册抛 `命令未注册: ${id}`。
- `defaultCommandRegistry` 模块级全局共享，注册全部 18 个内置命令（含内部的 `restore-sheet`）。
- `HistoryManager` 容量默认 200；超限淘汰最旧条目；新命令入栈清空 redo 栈。
- 事务可嵌套，提交时拍平为一个 undo 单元；`commit` 无事务时抛 `HistoryManager.commit：没有进行中的事务`。
- 事务进行中 `undo` / `redo` 返回 `false`。

```ts
import { defaultCommandRegistry, CommandRegistry } from 'infinitable/sheet'

const registry = new CommandRegistry()
registry.register({
  id: 'my.command',
  handler(ctx, params) {
    return { mutations: [], result: params }
  },
})

sheet.beginTransaction()
try {
  sheet.setCellValue({ row: 0, col: 0 }, 1)
  sheet.setCellValue({ row: 0, col: 1 }, 2)
  sheet.commit()
} catch (error) {
  sheet.rollback()
  throw error
}
```

## 浮动图片

```ts
type SheetImageType = 'png' | 'jpeg' | 'gif' | 'svg' | 'webp'
type ImageFitMode = 'fill' | 'contain'

interface SheetImageAnchor {
  from: CellAddress & { offsetX?: number; offsetY?: number }
  to?: CellAddress
}

interface SheetImage {
  id: string
  data: Uint8Array
  type: SheetImageType
  anchor: SheetImageAnchor
  src?: string
  fit?: ImageFitMode
  width?: number
  height?: number
  rotation?: number
  altText?: string
  title?: string
  link?: string
}

interface ImageInput {
  id?: string
  data: Uint8Array
  type: SheetImageType
  anchor: SheetImageAnchor
  src?: string
  fit?: ImageFitMode
  width?: number
  height?: number
  rotation?: number
  altText?: string
  title?: string
  link?: string
}

const IMAGE_MIME: Record<SheetImageType, string>

function createImageId(): string
function cloneImageAnchor(anchor: SheetImageAnchor): SheetImageAnchor
function cloneSheetImage(image: SheetImage): SheetImage
```

| 字段 / 符号        | 说明                                                 |
| ------------------ | ---------------------------------------------------- |
| `anchor.from`      | 起始格；`offsetX` / `offsetY` 为格内像素偏移，缺省 0 |
| `anchor.to`        | 可选结束格，表达跨单元格锚定                         |
| `data` / `src`     | 字节来源或 URL 来源；`src` 优先                      |
| `fit`              | `fill` 拉伸（缺省）或 `contain` 等比完整显示         |
| `width` / `height` | 渲染尺寸 px；缺省取图片自然尺寸                      |
| `rotation`         | 顺时针角度，缺省 0                                   |
| `link`             | 图片超链接                                           |
| `IMAGE_MIME`       | 模型 `type` → Blob MIME 映射                         |
| `createImageId`    | 生成图片 id；优先 `crypto.randomUUID()`              |
| `cloneSheetImage`  | 浅拷贝元数据，锚点独立，`data` 字节共享              |

图片写操作全部经 `Sheet` 方法：`insertImage` 返回生成的 id，`removeImage` / `updateImage` 可撤销；行列插删时锚点平移，删除区间内的图片被移除，收缩的锚点进入同一 undo 单元。

```ts
const id = sheet.insertImage({
  data: bytes,
  type: 'png',
  anchor: { from: { row: 0, col: 0, offsetX: 8, offsetY: 8 } },
  width: 160,
  height: 90,
  fit: 'contain',
})

sheet.updateImage(id, { width: 200, altText: '图表' })
sheet.removeImage(id)
```

## 导入导出

xlsx 读写基于 `hucre`，CSV 读写同样经其 `hucre/csv` 子路径。

```ts
function exportWorkbookXlsx(workbook: Workbook): Promise<Uint8Array>
function exportSheetXlsx(sheet: Sheet, options?: { fallbackName?: string }): Promise<Uint8Array>
function exportSheetCsv(sheet: Sheet): string

function importXlsx(
  buffer: ArrayBuffer | Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Workbook>
function importCsv(text: string, sheet: Sheet): void

function replaceWorkbookWithSnapshots(
  target: Workbook,
  snapshots: readonly SheetReplaceItem[],
  activeIndex: number,
): void

interface SheetReplaceItem {
  name: string
  snapshot: SheetSnapshot
  rowHeights?: ReadonlyMap<number, number>
  colWidths?: ReadonlyMap<number, number>
  defaultRowHeight?: number
  defaultColWidth?: number
}
```

| 函数                           | 说明                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `exportWorkbookXlsx`           | 导出整个工作簿：值、公式与计算缓存、合并、样式、冻结、行高、列宽、浮动图片                                    |
| `exportSheetXlsx`              | 导出单个 sheet；表名取 `sheet.name                                                                            |     | options?.fallbackName |     | 'Sheet'` |
| `exportSheetCsv`               | 导出 A1 到最后一个真实存在格的矩形；UTF-8 BOM；公式格导计算缓存值；合并覆盖格为空                             |
| `importXlsx`                   | 读入新 `Workbook`；样式池按内容去重；每个 sheet 的数据写入 = 单 undo 单元；`onProgress` 每完成一个 sheet 回调 |
| `importCsv`                    | 从 A1 覆盖写入既有 sheet，事务包裹为单 undo 单元；空格不覆盖既有格，空串清除；结束后扩张渲染尺寸              |
| `replaceWorkbookWithSnapshots` | 以快照数组替换工作簿内容；结构变更（删表/改名/新增）不进 undo，每个 sheet 内容替换为单 undo 单元              |

xlsx 映射要点：

- 公式原文存 `f`，计算缓存存 `v`；导入后由本地引擎重算填充缓存。
- 日期 `t = 'd'` 存 1900 序列数，导出为数字 + 日期格式，导入时把 `Date` 转回序列数。
- 样式：填充、四边边框、字体、对齐、四类数字格式；线宽在 xlsx 侧无对应字段，导入时按线型补默认宽度。
- 行高 px → points（×0.75）；列宽 px → Excel 字符宽。
- 冻结映射为 `freezePane`；浮动图随导出保留；CSV 忽略图片。

```ts
import {
  Workbook,
  exportWorkbookXlsx,
  importXlsx,
  exportSheetCsv,
  importCsv,
} from 'infinitable/sheet'

const bytes = await exportWorkbookXlsx(workbook)
const imported = await importXlsx(bytes, (done, total) => {
  console.log(`${done}/${total}`)
})

const csv = exportSheetCsv(imported.activeSheet)
importCsv('名称,金额\nA,100', imported.activeSheet)
```

## SheetGrid 适配

`SheetGrid` 把 `Sheet` 包装为 `@infinitable/table` 的 `ListTable`：数据面模型直挂，样式与显示值按格拉取，选区、冻结、合并、浮动图通过公开事件与运行时 API 双向同步。

```ts
import { SheetGrid } from 'infinitable/sheet'

const grid = new SheetGrid({
  container: document.querySelector<HTMLDivElement>('#sheet')!,
  sheet,
  height: 480,
})

grid.getTable() // 底层 ListTable
grid.release() // 销毁并解绑事件
```

### 配置

```ts
interface SheetGridOptions {
  container: HTMLElement
  sheet: Sheet
  rows?: number
  cols?: number
  width?: number
  height?: number
  resolveDisplayValue?: ResolveDisplayValue
  resolveCellStyle?: ResolveCellStyleHook
  resolveCellRenderer?: ResolveCellRenderer
  header?: SheetGridHeaderOptions
  editors?: SheetGridEditorsOptions
  onContextMenu?: (info: SheetGridContextMenuInfo) => void
  onEditStart?: (addr: CellAddress) => void
  onEditEnd?: (addr: CellAddress) => void
  colResize?: boolean
  onColResizeEnd?: (event: { col: number; width: number }) => void
  interceptSelection?: (meta?: SelectionInterceptMeta) => boolean
  onSelectionIntercept?: (range: CellRange, meta: SelectionInterceptMeta) => void
  readonly?: boolean
  showRowHeader?: boolean
  showColHeader?: boolean
  scrollbar?: boolean | ScrollbarOptions
  theme?: ThemeOverride
  openCellLinkOnClick?: boolean
  editorInsideBorder?: boolean
  growOnScroll?: boolean
  dpr?: number
}
```

| 选项                        | 类型                                          | 默认                                  | 说明                                                    |
| --------------------------- | --------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `container`                 | `HTMLElement`                                 | 必填                                  | 挂载容器；`position: static` 会被改为 `relative`        |
| `sheet`                     | `Sheet`                                       | 必填                                  | 绑定的模型                                              |
| `rows` / `cols`             | `number`                                      | 未声明时按可视尺寸给足，下限 100 × 26 | 初始渲染行列数；`growOnScroll: false` 时缺省为 100 × 26 |
| `width` / `height`          | `number`                                      | 测量容器；未布局回落 960 × 420        | 视口尺寸（CSS 像素）                                    |
| `resolveDisplayValue`       | `(addr, base) => CellValue \| undefined`      | —                                     | 显示值覆盖；返回 `undefined` 回落 `base`                |
| `resolveCellStyle`          | `(addr, baseStyle) => CellStyle \| undefined` | —                                     | 动态样式叠加；不写模型、不进快照                        |
| `resolveCellRenderer`       | `(addr, base) => CellRenderer \| undefined`   | —                                     | 接管该格内容绘制；`undefined` 回落默认渲染              |
| `header`                    | `SheetGridHeaderOptions`                      | —                                     | 列标题与自定义表头 DOM                                  |
| `editors`                   | `SheetGridEditorsOptions`                     | —                                     | 类型化编辑器注册与按格路由；`readonly` 下忽略           |
| `onContextMenu`             | `(info) => void`                              | —                                     | 右键菜单回调                                            |
| `onEditStart` / `onEditEnd` | `(addr) => void`                              | —                                     | 编辑会话开始 / 结束                                     |
| `colResize`                 | `boolean`                                     | `false`                               | 只读模式下为 `true` 时放开列宽拖拽手柄                  |
| `onColResizeEnd`            | `({ col, width }) => void`                    | —                                     | 列宽拖拽落定回调（已写模型）                            |
| `interceptSelection`        | `(meta?) => boolean`                          | —                                     | 返回 `true` 拦截本次选区联动（引用拾取用）              |
| `onSelectionIntercept`      | `(range, meta) => void`                       | —                                     | 被拦截的选区范围回调                                    |
| `readonly`                  | `boolean`                                     | `false`                               | 整表只读：不注册编辑器、禁 resize、禁撤销快捷键         |
| `showRowHeader`             | `boolean`                                     | `true`                                | 是否显示行号列                                          |
| `showColHeader`             | `boolean`                                     | `true`                                | 是否显示列字母表头                                      |
| `scrollbar`                 | `boolean \| ScrollbarOptions`                 | `true`                                | `false` 关闭；对象形态支持 `mode: 'native'` 原生滚动条  |
| `theme`                     | `ThemeOverride`                               | —                                     | 以内置主题为底的深覆盖                                  |
| `openCellLinkOnClick`       | `boolean`                                     | `true`                                | 单击链接格或带链接图片时是否默认打开 URL                |
| `editorInsideBorder`        | `boolean`                                     | `false`                               | 编辑浮层是否落在格边框内侧                              |
| `growOnScroll`              | `boolean`                                     | `true`                                | 滚动近端动态增长；`false` 为固定尺寸网格                |
| `dpr`                       | `number`                                      | `window.devicePixelRatio`             | 渲染设备像素比；截图对比等场景锁定 1                    |

### 相关类型

```ts
type ResolveDisplayValue = (addr: CellAddress, base: CellValue | undefined) => CellValue | undefined

type ResolveCellStyleHook = (addr: CellAddress, baseStyle?: CellStyle) => CellStyle | undefined

type ResolveCellRenderer = (
  addr: CellAddress,
  base: CellValue | undefined,
) => CellRenderer | undefined

interface SheetGridHighlight {
  range: CellRange
  color: string
}

type SheetGridContextMenuKind = 'body' | 'row-header' | 'col-header'

interface SheetGridContextMenuInfo {
  x: number
  y: number
  kind: SheetGridContextMenuKind
  addr: CellAddress | null
  row?: number
  col?: number
}

interface SheetGridHeaderOptions {
  resolveTitle?: (col: number) => string | undefined
  resolveHeader?: (col: number) => HTMLElement | undefined
}

interface SelectionInterceptMeta {
  shiftKey?: boolean
  extend?: boolean
}
```

| 类型                                | 说明                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `CellRenderer` / `CellRenderTarget` | 引擎单元格渲染器及绘制目标（自 table 转出）                  |
| `ScrollbarOptions`                  | 滚动条配置（自 grid 转出）；`mode: 'native'` 为原生滚动条档 |
| `SheetGridContextMenuInfo.x/y`      | 客户端坐标                                                  |
| `SheetGridContextMenuInfo.addr`     | body 格地址；行号列 / 列头为 `null`                         |
| `SelectionInterceptMeta.shiftKey`   | 本次按下是否携带 Shift                                      |
| `SelectionInterceptMeta.extend`     | 是否为对上次拾取段的 Shift 扩展                             |

### 编辑器

```ts
interface GridEditorRect {
  x: number
  y: number
  width: number
  height: number
}

interface GridEditorSession {
  addr: CellAddress
  container: HTMLElement
  rect: GridEditorRect
  value: CellValue | undefined
  commit(value: CellValue): void
  cancel(): void
  onRectChange(listener: (rect: GridEditorRect) => void): void
}

interface GridCellEditor {
  readonly name: string
  open(session: GridEditorSession): void
  close(): void
}

interface SheetGridEditorsOptions {
  editors: GridCellEditor[]
  route?: (addr: CellAddress) => string | undefined
}
```

- `value` 为编辑初值：公式格是 `'=' + f` 原文，其余是存储值。
- `commit` 经引擎 `updateCell` 回写模型，走命令系统，可 undo。
- `route` 返回未注册的名称或 `undefined` 时回落统一文本编辑器。
- 自定义编辑器接管时，机制会取消引擎内建文本会话；滚动时通过 `onRectChange` 同步锚定格矩形，滚出视口自动取消。

### 方法

| 方法                                            | 说明                                            |
| ----------------------------------------------- | ----------------------------------------------- |
| `getTable(): ListTable`                         | 底层引擎实例（调试 / 测试）                     |
| `hitTestSheetAddr(x, y): CellAddress \| null`   | 容器内相对坐标 → 模型地址；行列头返回 `null`    |
| `setSelectionAnchor(addr \| null)`              | 设置选区锚点标记（引用拾取），纯视图态          |
| `setHighlightRanges(items)`                     | 设置公式引用染色框；空数组清除，纯视图态        |
| `updateTheme(override)`                         | 运行时深覆盖主题并重绘，不重建网格              |
| `setVisible(on)`                                | 隐藏时只置脏；激活时全量同步                    |
| `applyAxisSizes(axis, indexes)`                 | 把模型行列尺寸同步到引擎（右键数值写入路径）    |
| `setCellLink` / `getCellLink` / `clearCellLink` | 透传模型链接命令                                |
| `insertCellImage` / `removeCellImage`           | 透传模型嵌入图命令                              |
| `release()`                                     | 解绑事件、断开 ResizeObserver、销毁底层表；幂等 |

内建交互：

- 键盘：`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 或 `Ctrl+Y` 重做、`Ctrl/Cmd+A` 全选、`Delete` / `Backspace` 删除选中的浮动图片。
- 滚轮：Shift + `deltaY` 转横向；原生滚动条档下滚轮接线整体让位。
- 容器 resize 采用 100 ms 尾部防抖，原地调整尺寸，不重建实例。

::: warning 结构变化需重建
`structure-change`（行列插入 / 删除）超出引擎适配面的能力：`SheetGrid` 不处理结构重建（可见实例忽略该事件，隐藏实例置脏）。宿主需要在结构变化后销毁并重新创建 `SheetGrid`。
:::

::: details 未从公共入口导出的内部符号
`SHEET_TEXT_EDITOR`、`SHEET_GRID_THEME`、`SHEET_DEFAULT_ROW_HEIGHT`、`SHEET_DEFAULT_COL_WIDTH`、`sanitizeSnapshotMerges`、`formatByNumFmt`、`mergeCellStyle`、`rangeContainsRange` 均为包内实现细节。顶层导出面以本页所列符号为准。
:::
