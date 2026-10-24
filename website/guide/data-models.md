# 数据供给与模型

`ListTable` 不持有业务数据，只按可视窗口向数据源取值。数据供给有三种形态：`records` 数组、`model`（`TableModel` 事件订阅）、`rowCount` + `resolveDisplayValue` 纯钩子。三者可叠加按格 hook，但同一套表格里基础值只有一个来源。

本页说明三种形态的取舍、`TableModel` 契约、内置 `SheetModel`、批量写入 API、按格 hook 的调用时机与性能约束，以及 `ColumnDefine` 的全部字段。

## 三种供给形态

| 形态                               | 行数来源                                  | 基础值来源                     | 回写能力                                   | 适用场景                                         |
| ---------------------------------- | ----------------------------------------- | ------------------------------ | ------------------------------------------ | ------------------------------------------------ |
| `records` + `columns`              | `records.length`                          | `records[row]?.[column.field]` | 编辑提交写回行对象的 `field`               | 已有内存数组、简单展示或轻量编辑                 |
| `model` + `columns`                | `max(model.rowCount ?? 0, rowCount ?? 0)` | `model.getCellValue(col, row)` | `model.setCellValue` 或 `table.updateCell` | 外部状态是唯一真相、需要按格 O(1) 读写与变更订阅 |
| `rowCount` + `resolveDisplayValue` | `rowCount`                                | 无（钩子直接产出显示文本）     | 无                                         | 数据不在内存、按格懒计算、只读大表               |

优先级细节：

- 同时给 `model` 与 `records` 时，取值一律走 `model`，`records` 不参与。
- `resolveDisplayValue` 作用在取值管线末端，三种形态都能叠加，拿到的是基础值。
- 纯 hook 形态（无 `model`、无 `records`）没有回写目标，因此不可编辑。

行数解析顺序（源码 `CellValuePipeline.rowCount`）：

1. 有 `model`：`Math.max(model.rowCount ?? 0, rowCount ?? 0)`。
2. 否则有 `records`：`records.length`，`rowCount` 不参与。
3. 否则：`rowCount ?? 0`。

::: tip
`model.rowCount` 是可选字段。模型不提供行数时，用 `rowCount` 兜底；两者同时存在时取较大值，便于宿主先扩大模型再让引擎跟随。
:::

## records 数组

每列用 `field` 指定取值字段；没有 `field` 的列不会从行对象取值，但仍可经 hook 或 `model` 供给。

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const records = Array.from({ length: 100_000 }, (_, row) => ({
  id: `ID-${row}`,
  name: `商品-${row}`,
  amount: row * 3,
}))

const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { field: 'id', title: 'ID', width: 120 },
    { field: 'name', title: '名称', width: 200 },
    { field: 'amount', title: '金额', width: 120, style: { textAlign: 'right' } },
  ],
  records,
  hostOptions: { container },
})

console.log(table.getCellText(1, 0)) // => '商品-0'
```

外部修改 `records` 后，引擎不会自动感知，需要显式局部刷新：

```ts
records[0]!.name = '改名'
table.refreshCell(1, 0)
```

编辑回写也只认 `field`：records 形态下，列必须声明 `field` 且该行对象存在，才具备回写目标；可编还需已注册的编辑器且未被 `resolveEditable` 拒绝，见[交互与编辑](/guide/interaction-editing)。

## model 模型直挂

`model` 形态把外部状态直接挂到表格上。表格按格调用 `getCellValue`，编辑提交经 `setCellValue` 回写，外部变更经 `onCellChange` 订阅后局部刷新。

### TableModel 契约

```ts
import type { CellChangeEvent, TableModel } from 'infinitable'

export interface TableModel {
  /** 行数；缺省时用 ListTableOptions.rowCount 兜底 */
  readonly rowCount?: number
  /** 按格取值；滚动进入窗口的每格都会调用，要求同步、O(1) */
  getCellValue(col: number, row: number): unknown
  /** 表格回写入口；缺省时编辑可判定通过但提交不会落到模型 */
  setCellValue?(col: number, row: number, value: unknown): void
  /** 订阅外部变更；返回退订函数 */
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}

export interface CellChangeEvent {
  col: number
  row: number
  /** 变更前取值；外部模型给不出时为 undefined */
  oldValue: unknown
  /** 变更后取值 */
  newValue: unknown
}
```

契约要点：

- 表格构造时订阅一次 `onCellChange`。模型在 `setCellValue` 之外发出的变更会直接路由到 `refreshCell(col, row)`，不需要宿主手动刷新。
- 模型应同步通知订阅者。只有同步 echo 才会进入回环窗口的去重收集；异步通知按普通外部变更处理，同样会刷新，但不会参与本次回写的派生格合并。
- `getCellValue` 在滚动帧按可见格调用，应避免深拷贝、格式化、网络或复杂计算。

### 完整自定义模型

```ts
import { ListTable, type CellChangeEvent, type TableModel } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const data = new Map<string, unknown>()
const listeners = new Set<(change: CellChangeEvent) => void>()
const key = (col: number, row: number) => `${col}:${row}`

const model: TableModel = {
  rowCount: 100_000,
  getCellValue: (col, row) => data.get(key(col, row)),
  setCellValue: (col, row, value) => {
    const oldValue = data.get(key(col, row))
    data.set(key(col, row), value)
    for (const listener of listeners) {
      listener({ col, row, oldValue, newValue: value })
    }
  },
  onCellChange: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { title: '名称', width: 200 },
    { title: '数值', width: 120 },
  ],
  model,
  hostOptions: { container },
})

// 表格 → 模型：该格局部刷新；模型同步 echo 的变更被收集去重后统一刷新
table.updateCell(0, 0, '第一行')

// 模型 → 表格：外部写值经 onCellChange 自动局部刷新
model.setCellValue(1, 0, 42)
console.log(table.getCellText(1, 0)) // => '42'
```

### 回环吞事件

编辑提交或 `updateCell` 回写模型时，模型可能在 `setCellValue` 内同步发出事件，包括被写格自身的 echo 和公式依赖重算等派生格。如果这些事件直接转发回表格，就会形成回环，并可能引发重入刷新。

引擎用 `ModelBinding` 收口：

1. 回写前进入 echo 窗口。
2. 窗口内收到的所有变更按 `(col, row)` 去重收集，不直接转发。
3. 回写结束后把收集结果交给调用方，逐格 `refreshCell`，被编辑格再由调用方显式刷新一次，每格恰好刷新一次。
4. 模型未提供 `setCellValue`，或正处于回写/echo 链路的重入调用，直接拒绝写入。

因此模型作者只需要在 `setCellValue` 里同步通知订阅者，不需要自己判断「这次变更是不是表格发起的」。

::: warning
`model` 形态下 `table.updateCell` 是唯一受支持的表格回驱入口；`records` 形态调用它是空操作。records 形态请直接改行对象字段后调 `refreshCell`。
:::

## 内置 SheetModel

`SheetModel` 是 table 内置的坐标寻址内存模型，实现 `TableModel`，开箱可用于可编辑表。

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const model = new SheetModel([
  ['名称-0', '备注-0'],
  ['名称-1', '备注-1'],
])

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

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

table.onCellChange(({ col, row, oldValue, newValue }) => {
  console.log(`(${col},${row}) ${String(oldValue)} -> ${String(newValue)}`)
})
```

构造重载与行为（源码 `packages/table/src/sheet-model.ts`）：

```ts
class SheetModel implements TableModel {
  constructor(rowCount: number, colCount: number)
  constructor(initialCells: readonly (readonly unknown[])[])
  get rowCount(): number
  setRowCount(rowCount: number): void
  getCellValue(col: number, row: number): unknown
  setCellValue(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}
```

- 二维数组构造会复制一份，列数取最长行。
- `getCellValue` 越界（含负坐标）返回 `undefined`；`setCellValue` 越界为空操作。
- `setRowCount` 扩大补空行，缩小截断；列数固定。
- 没有订阅者时 `setCellValue` 跳过事件对象分配，适合批量灌数热路径。
- 只提供值存取，不包含样式、合并、公式、命令或撤销；这些能力在 `infinitable/sheet` 的 `Sheet` 模型与 `SheetGrid` 适配层。

::: warning 关于 `SheetStore.asModel()`
仓库 README 和官网首页仍写着 `SheetStore.asModel()`，但当前源码里没有 `SheetStore` 这个导出。可直接使用的内置模型是 `SheetModel`；电子表格形态由 `@infinitable/sheet` 的 `Sheet` + `SheetGrid` 承担，`SheetGrid` 内部把 `Sheet` 适配成 `TableModel`。以源码公共导出面为准，不要按旧名称写业务代码。
:::

## rowCount + resolveDisplayValue

数据不在内存、也不需要回写时，用 `rowCount` 给出总行数，由 `resolveDisplayValue` 按格计算显示文本。这个形态不分配行对象，适合日志、指标、只读报表等百万行场景。

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 960,
  height: 480,
  columns: [
    { title: '编号', width: 120 },
    { title: '部门', width: 160 },
    { title: '金额', width: 160, style: { textAlign: 'right' } },
    { title: '状态', width: 120 },
  ],
  rowCount: 1_000_000,
  resolveDisplayValue: (col, row) => {
    switch (col) {
      case 0:
        return `NO-${row + 1}`
      case 1:
        return `部门-${(row % 8) + 1}`
      case 2:
        return `${((row * 37) % 900) + 100}.00`
      default:
        return row % 3 === 0 ? '待处理' : '已完成'
    }
  },
  hostOptions: { container },
})

// 只读：没有 model 或 records，纯 hook 形态没有回写目标
console.log(table.getCellText(0, 0)) // => 'NO-1'
```

取值链：

```text
基础值（model.getCellValue 或 records[row][field]）→ resolveDisplayValue → 最终文本
```

没有基础值时 `value` 为 `undefined`；没有配置 hook 时引擎用 `value == null ? '' : String(value)` 兜底。

::: warning
纯 hook 形态不可编辑。需要编辑时改用 `model`，或提供 `records` 且列声明 `field`。`resolveDisplayValue` 也不是「按需加载」：它必须同步返回文本，异步取数请先在宿主侧缓存，再让 hook 读缓存。
:::

## 批量写入与单格刷新

### updateCell

`table.updateCell(col, row, value)` 只对 `model` 形态生效：

- 经 `ModelBinding.writeBack` 写入模型。
- 同步 echo 的派生格收集去重后逐格刷新，再刷新被编辑格。
- 不抛 `onCellChange`；该事件只属于编辑提交。

```ts
const table = new ListTable({
  width: 600,
  height: 300,
  columns: [{ title: '值', width: 100 }],
  model: new SheetModel(1000, 1),
  hostOptions: { container },
})

for (let row = 0; row < 1000; row++) {
  table.updateCell(0, row, row)
}
```

逐格调用会产生多次失效提交。大块写入应包在 `batchUpdate` 里。

### batchUpdate

`table.batchUpdate(fn)` 把 `fn` 内的所有失效区域收集起来，结束时合并成一次 `band` 失效提交；支持嵌套，只有最外层结束时才提交。

```ts
table.batchUpdate(() => {
  for (let row = 0; row < 1000; row++) {
    table.updateCell(0, row, row)
  }
})
```

::: tip
`fn` 抛异常时 `finally` 仍会结束批量窗口并提交已收集的失效，不会把批量状态留在打开状态。收集粒度是失效区域，不是事务；数据写入本身不会被回滚。
:::

### refreshCell

`refreshCell(col, row)` 做单格 region 级失效：更新节点内容、重投影样式、重算共享边框与溢出走廊；被合并覆盖的坐标会路由到主格，失效区取主格包围盒。窗口外的格没有节点，只做溢出源反查，不会为了刷新而建格。

```ts
// records 形态：改完行对象后手动局部刷新
records[0]!.amount = 999
table.refreshCell(2, 0)
```

## 按格 hook

所有 hook 都在渲染热路径上同步调用，签名是纯函数、O(1)。

| 选项                  | 签名                                          | 返回                             | 调用时机                                                         |
| --------------------- | --------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `resolveDisplayValue` | `(col, row, value) => string`                 | 最终显示文本                     | 取值管线末端：可视格节点建格/刷新时，以及 `getCellText`          |
| `resolveCellStyle`    | `(col, row) => CellStyle \| null`             | 样式片段；`null` 沿用基础样式    | 每次解析该格样式时（建格、刷新、共享边裁决）                     |
| `resolveCellRenderer` | `(col, row) => CellRenderer \| null`          | 渲染器；`null` 走内置 `cellType` | 可视格节点建格/刷新时取得渲染器，之后每次绘制该格调用渲染器      |
| `resolveCellImage`    | `(col, row) => string \| null \| undefined`   | 图片 URL；空值走常规管线         | 建格/刷新与图片格联动时；同一格返回不同 URL 会触发重建与位图失效 |
| `resolveCellLink`     | `(col, row) => CellLink \| null \| undefined` | `{ url, text? }`                 | 样式解析、指针命中判定、悬停/单击事件判定                        |

相关的两个补充 hook：

- `resolveCellImageFit(col, row)`：返回 `'fill' | 'contain'`，覆盖该格图片缩放语义；缺省 `'contain'`。
- `resolveCellImageLink(col, row)`：返回 URL 时，该图片格单击派发 `onImageLinkClick`（`kind: 'cell'`）。

### 性能约束

- **同步**：hook 不能返回 Promise，也不能依赖异步结果；异步数据请先落到模型或缓存，hook 只读。
- **O(1)**：调用次数与「可见格数 × 建格/刷新次数」成正比，滚动时新进入窗口的每一格都会调用。避免排序、遍历大数组、深拷贝、正则重计算、网络或频繁 JSON 解析。
- **纯**：不要修改表格状态、模型或传入对象。`resolveCellStyle` 返回的对象按不可变值使用，引擎可能缓存或共享。
- **返回稳定值**：`resolveCellImage` 对同一格应返回稳定 URL，否则每次解析都会被当作换图，触发节点重建与位图缓存失效。
- **样式 hook 尽量返回 `null`**：主题 token 与列级样式已按列缓存；只有 hook 返回非空时才做第二级投影并分配新对象。
- **渲染器只负责画**：`CellRenderer` 每次该格上屏都会执行，内部不要再创建 canvas、加载图片或写模型。

样式覆盖链与样式细节见[主题与样式](/guide/theming)。

### 示例：斑马纹 + 条件图片 + 自定义渲染器

```ts
import { ListTable, type CellRenderer } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const badge: CellRenderer = ({ ctx, value, width, height }) => {
  const active = value === true
  ctx.fillStyle = active ? '#16a34a' : '#9ca3af'
  ctx.fillRect(width - 28, (height - 8) / 2, 8, 8)
}

const table = new ListTable({
  width: 720,
  height: 360,
  columns: [
    { title: '名称', width: 200 },
    { title: '缩略图', width: 120 },
    { title: '状态', width: 100 },
  ],
  rowCount: 10_000,
  resolveDisplayValue: (_col, row) => `行-${row}`,
  resolveCellStyle: (_col, row) => (row % 2 === 1 ? { background: '#f8fafc' } : null),
  resolveCellImage: (col, row) => (col === 1 ? `https://cdn.example.com/thumb/${row}.png` : null),
  resolveCellRenderer: (col) => (col === 2 ? badge : null),
  hostOptions: { container },
})
```

## ColumnDefine

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

| 字段              | 类型                   | 默认                          | 说明                                                                  |
| ----------------- | ---------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `field`           | `string`               | 无                            | records 取值字段；也是 records 形态的编辑回写字段。缺省时该列无数组值 |
| `title`           | `string`               | 空串                          | 列头标题。运行时增列未给标题时回落 `resolveColTitle`                  |
| `width`           | `number`               | `defaultColWidth`（主题 100） | 列宽；运行时改宽用 `setColWidth`，最小 20                             |
| `cellType`        | `'text' \| 'checkbox'` | `'text'`                      | 内置单元格类型；checkbox 按基础值判定勾选态                           |
| `editor`          | `string`               | 无                            | 该列编辑器注册名；未注册时该列不可编辑                                |
| `editorMultiline` | `boolean`              | `false`                       | true 用 textarea，false 用 input                                      |
| `editorMaxLength` | `number`               | 无                            | 列级字符上限，优先于 `ListTableOptions.editorMaxLength`               |
| `textWrap`        | `boolean`              | `false`                       | 超宽文本格内断行，不向右侧空格溢出；可被按格样式覆盖                  |
| `style`           | `CellStyle`            | 无                            | 列级样式片段，只作用于数据格，不作用于列头                            |

## 运行时行列数

```ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
container.style.position = 'relative'

const table = new ListTable({
  width: 600,
  height: 300,
  columns: [{ title: '值' }],
  rowCount: 100,
  resolveDisplayValue: (_col, row) => `${row}`,
  resolveColTitle: (col) => String.fromCharCode(65 + (col % 26)),
  hostOptions: { container },
})

table.setRowCount(1_000) // 纯 hook 形态：直接抬高兜底行数
table.setColCount(5, { width: 80, cellType: 'text' }) // 追加列；标题走 resolveColTitle
```

- `setRowCount(count)`：模型形态应先把模型 `rowCount` 扩大，再调用本方法触发引擎重算；records 形态行数恒为 `records.length`，无法增长；纯 hook 形态直接抬高兜底值。收缩会钳制冻结行数、丢弃越界合并区并钳制选区。
- `setColCount(count, template?)`：增长按 `template` 追加列定义与列宽，缺省列宽走 `defaultColWidth`；收缩会截断列、清列级样式缓存、钳制冻结列数、丢弃越界合并区并钳制选区。
- `table.rowCount` / `table.colCount` 读取当前生效值。

行数变化不会重建表格实例；滚动边界、滚动条与虚拟窗口只按新行数重算。

## 相关

- [ListTable API](/api/list-table)：构造选项、实例方法与事件完整清单。
- [共享类型与模型（grid / table）](/api/grid-table)：`TableModel`、`SheetModel`、`ColumnDefine` 等导出面。
- [电子表格（sheet）](/guide/sheet)：`Sheet`、`Workbook`、`SheetGrid` 与模型适配。
