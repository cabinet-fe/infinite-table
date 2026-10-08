---
title: createSheetPlugin sheet 插件
description: infinitable 官方 sheet 插件：createSheetPlugin 工厂（单表/书两种装配）返回插件对象（TablePlugin 契约 + 运行时 handle）。handle 操作面：Store 参考模型（值/样式/meta/尺寸/冻结/合并 + asModel 模型直挂）、多 sheet 实例池（registerSheet/switchTo）、撤销栈（undo/redo/writeValues 撤销化批量写）、快照采集灌回（saveSnapshot/restoreSnapshot）、填充生成与选区同步构造期接线、公式显示与 Excel 键位底座、边框预设与 xlsx 导出映射（borderEdge/borderCells/exportSheet）。
aliases: [sheet 插件, 电子表格, SheetStore, SheetBook, 填充, 撤销, 快照, undo]
keywords: [createSheetPlugin, SheetPluginOptions, SheetPluginHandle, store, createStore, asModel, registerSheet, switchTo, activeStore, activeTable, onSheetChange, undo, redo, writeValues, canUndo, clearHistory, saveSnapshot, restoreSnapshot, selectionSync, syncSelectionFromExternal, evaluate, excelKeys, readonly, undoLimit, borderEdge, borderCells, exportSheet, decodeImage, 填充, 撤销, 快照, 电子表格, xlsx 导出]
---

# createSheetPlugin sheet 插件

`infinitable`（plugins 层）导出 `createSheetPlugin(options)` 工厂：把 sheet 能力族（Store 参考模型、多 sheet 实例池、撤销栈、填充生成、选区同步、公式显示、Excel 键位、边框预设、xlsx 导出映射）收拢为单一插件对象——返回值同时是 `TablePlugin`（构造 `plugins` 或 `table.use()` 注册）与运行时 handle（建 Store、注册/切换 sheet、撤销重做、快照采集灌回、边框展开与 xlsx 导出映射）。两种装配形态：单表形态（`options.store` 给出、`createHost` 未给）：插件持有唯一 Store，宿主自建表（`model` 取 `handle.store.asModel()`、`plugins` 传入本插件）；书形态（`options.createHost` 给出）：插件内建多 sheet 实例池，`switchTo` 惰性建表并随建随挂本插件。原散装符号（`SheetStore`/`SheetBook`/`snapshot`/`excelKeymapPreset`/`bindFillGeneration`/`UndoStack` 等，0.1.2 起不再导出）全部经 handle 操作面消费。

## 快速上手

```ts
import { EditorRegistry, createSheetPlugin, ListTable } from 'infinitable'

// 1. 单表形态：插件持有唯一 Store（唯一事实源）
const sheet = createSheetPlugin({ store: { rowCount: 50, colCount: 8 } })
const store = sheet.store!
store.setValue(0, 0, '标题')
store.setStyle(1, 1, { fontWeight: 'bold' })
store.setFrozen({ colCount: 1, rowCount: 1 })
store.setMerges([{ startCol: 2, startRow: 2, endCol: 3, endRow: 3 }])

// 2. 宿主自建表：模型直挂 + 插件注册（mount 接线撤销记录/填充生成；Excel 键位/公式显示为构造期底座）
const registry = new EditorRegistry()
registry.registerEditor('text', {})
const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 800,
  height: 420,
  columns: Array.from({ length: 8 }, (_, col) => ({ title: `列${col}`, width: 90, editor: 'text' })),
  model: store.asModel(),
  editorRegistry: registry,
  plugins: [sheet],
  hostOptions: { container },
})
table.setFrozenColCount(1)
table.setFrozenRowCount(1)
table.setMergeCells(store.getMerges())

// 3. 撤销：双击/Enter 编辑提交自动转值命令（mount 已接线）；直写 Store 的批量变更走 writeValues
sheet.writeValues(store, [
  { col: 1, row: 1, value: 42 },
  { col: 2, row: 1, value: '批量写入' },
])
sheet.undo() // 整体回退（经 store.setValue → 模型事件 → 表格局部刷新，不触发 onCellChange，无回环）
```

## API 签名

```ts
/** 单格值写入（writeValues 入参条目；value 为新值；未导出为独立类型） */
interface SheetValueWrite {
  col: number
  row: number
  value: unknown
}

/** 插件配置（工厂参数） */
export interface SheetPluginOptions {
  /** 单表形态：唯一 Store 的构造参数（维度等见下方 Store 面） */
  store?: {
    rowCount: number
    colCount: number
    defaultColWidth?: number // 默认 100
    defaultRowHeight?: number // 默认 32
    /** 基础样式片段（getEffectiveStyle 合成最底层；未给为空片段） */
    baseStyle?: CellStyle
    /** 显示值解析注入（getDisplayValue 显示链；缺省回落原始值口径） */
    resolveDisplayValue?: (col: number, row: number, value: unknown) => unknown
  }
  /** 书形态：实例构造时的宿主注入（容器/hostOptions；host 缺省由引擎自建） */
  createHost?: (def: {
    id: string
    store: ReturnType<SheetPluginHandle['createStore']>
    options?: Partial<ListTableOptions>
  }) => {
    host?: ListTableOptions['host']
    hostOptions?: ListTableOptions['hostOptions']
  }
  /** 书形态：每实例统一表 options（主题/列定义/编辑器等；插件注入的键位/公式显示为更低优先级底座） */
  tableOptions?: Partial<ListTableOptions>
  /** 值命令撤销栈上限（缺省 100，超限丢最旧） */
  undoLimit?: number
  /** 只读形态：不装配写路径接线（引擎编辑提交的撤销记录 / 填充生成 / 双击自动填充） */
  readonly?: boolean
  /** 公式显示求值器（`=` 前缀格经求值渲染，未注入/失败回落原文；书形态构造期注入底座） */
  evaluate?: (formula: string, col: number, row: number) => string | number | null | undefined
  /** Excel 键位预设（缺省启用：Enter 进焦点格编辑、关闭 Ctrl/Cmd 点选加选；书形态构造期注入底座） */
  excelKeys?: boolean
  /** 选区双向同步：表格选区 → apply 落外部模型；外部模型变化经 syncSelectionFromExternal 回流 */
  selectionSync?: {
    apply: (selection: SelectionSnapshot) => void
    get: () => SelectionSnapshot
  }
}

/** 插件 handle：TablePlugin 契约（name 'sheet'）+ 运行时操作面 */
export interface SheetPluginHandle extends TablePlugin {
  /** 单表形态的唯一 Store（书形态 undefined，改用 registerSheet/activeStore） */
  readonly store: ReturnType<SheetPluginHandle['createStore']> | undefined
  /** 新建 Store（注册进书，或单表宿主自建表挂模型用） */
  createStore(storeOptions: SheetPluginOptions['store']): ReturnType<SheetPluginHandle['createStore']>

  // ---- 书形态：多 sheet 实例池 ----
  /** 注册 sheet 定义（同 id 重复注册替换定义，已建实例保留至显式移除） */
  registerSheet(def: {
    id: string
    store: ReturnType<SheetPluginHandle['createStore']>
    options?: Partial<ListTableOptions>
  }): void
  /** 移除定义并销毁池内实例；移除活跃 sheet 时 activeId 置空并抛事件 */
  removeSheet(id: string): void
  /** id 是否已注册 */
  has(id: string): boolean
  /** 池内实例（未创建为 undefined） */
  get(id: string): ListTable | undefined
  /** 当前活跃 sheet id（无活跃为 null） */
  readonly activeId: string | null
  /** 切换活跃 sheet：实例惰性创建（池化复用），创建即挂本插件（mount 接线） */
  switchTo(id: string): ListTable
  /** 当前活跃实例（书形态无活跃 / 单表形态未挂载为 null） */
  activeTable(): ListTable | null
  /** 当前活跃 Store（单表形态为唯一 Store；无活跃为 null） */
  activeStore(): ReturnType<SheetPluginHandle['createStore']> | null
  /** 订阅切换/创建/移除事件（宿主据其重挂 DOM）；返回退订函数 */
  onSheetChange(listener: (event: {
    activeId: string | null
    table: ListTable | null
    /** 本次事件是否为该 sheet 实例首次创建 */
    created: boolean
  }) => void): () => void
  /** 销毁池内全部实例（宿主收尾用）；定义保留可重建 */
  dispose(): void

  // ---- 快照 ----
  /** 采集 Store 全量快照（九字段；images/selection 不归 Store 持有，经 extras 注入携带） */
  saveSnapshot(
    store: ReturnType<SheetPluginHandle['createStore']>,
    extras?: { images?: readonly FloatObject[]; selection?: SelectionSnapshot | null },
  ): /* SheetSnapshot，结构见方法与事件 */ object
  /** 快照全量灌回 Store（替换语义，经 Store.rebuild 收口汇总）；images/selection 经 wiring 由宿主接线应用 */
  restoreSnapshot(
    store: ReturnType<SheetPluginHandle['createStore']>,
    snap: ReturnType<SheetPluginHandle['saveSnapshot']>,
    wiring?: {
      images?: (images: readonly FloatObject[]) => void
      selection?: (selection: SelectionSnapshot | null) => void
    },
  ): void

  // ---- 撤销 / 重做 ----
  /** 撤销栈顶命令（空栈空操作） */
  undo(): void
  /** 重做栈顶命令（空栈空操作） */
  redo(): void
  /** 撤销栈状态 */
  readonly canUndo: boolean
  readonly canRedo: boolean
  /** 清空撤销/重做栈 */
  clearHistory(): void
  /**
   * 撤销化批量写值（填充/查找替换/清空内容等直写 Store 的内容变更共用）：
   * 同格多写末次为准、新值与现值相同的格不写不入命令；一次调用 = 一条组合值命令
   */
  writeValues(store: ReturnType<SheetPluginHandle['createStore']>, writes: readonly SheetValueWrite[]): void

  // ---- 边框预设 ----
  /** 线型 + 颜色 → 边定义（thin/medium/thick → solid 1/2/3px；dashed/dotted 同名线型） */
  borderEdge(
    style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted',
    color: string,
  ): CellBorderEdge
  /** 边框预设 → 选区逐格 border 片段集合（8 预设；none 产出清除项，调用方清边框键） */
  borderCells(
    bounds: RangeBounds,
    preset: 'outer' | 'inner' | 'all' | 'top' | 'bottom' | 'left' | 'right' | 'none',
    edge: CellBorderEdge,
  ): { col: number; row: number; style: CellStyle }[]

  // ---- xlsx 导出通道 ----
  /** Store（+ 合并/行列尺寸/浮动图）→ xlsx 引擎写表形态（纯数据，可结构化克隆发 worker） */
  exportSheet(source: {
    name: string
    store: ReturnType<SheetPluginHandle['createStore']>
    /** 数字格式判定（四类：date/thousands/cnUpper/fixed(digits)） */
    numFmt?:
      | (col: number, row: number) =>
          | { kind: 'date' }
          | { kind: 'thousands' }
          | { kind: 'cnUpper' }
          | { kind: 'fixed'; digits: number }
          | undefined
    images?: readonly FloatObject[]
    imageData?: (object: FloatObject) => { data: Uint8Array; type: 'png' | 'jpeg' | 'gif' | 'svg' | 'webp' } | undefined
  }): /* hucre WriteSheet */ object
  /** data: URL 图片 → 导出字节载荷（五类 MIME 之外/非 base64/解析失败返回 undefined，跳过导出） */
  decodeImage(src: string | undefined): { data: Uint8Array; type: 'png' | 'jpeg' | 'gif' | 'svg' | 'webp' } | undefined

  // ---- 选区同步（selectionSync 接线时） ----
  /** 外部模型选区变化时回流当前活跃表（同签名零开销；未接线为空操作） */
  syncSelectionFromExternal(): void
}

export function createSheetPlugin(options?: SheetPluginOptions): SheetPluginHandle
```

## 参数说明

`SheetPluginOptions`（五要素）：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `store` | Store 构造参数 | — | 否 | 单表形态必给（否则 `handle.store` 为 undefined）；`rowCount`/`colCount` 必填且构造期固定 |
| `createHost` | `(def) => { host?, hostOptions? }` | — | 否 | 书形态必给（用书形态方法时缺失抛错）；每个 sheet 定义惰性建表时调用 |
| `tableOptions` | `Partial<ListTableOptions>` | — | 否 | 书形态每实例统一表 options；覆盖序：插件底座（键位/公式显示）< `tableOptions` < 定义 `options` |
| `undoLimit` | `number` | `100` | 否 | 撤销栈上限，超限丢最旧 |
| `readonly` | `boolean` | `false` | 否 | true 时 mount 不接写路径（无撤销记录/填充生成/双击自动填充） |
| `evaluate` | `(formula, col, row) => string \| number \| null \| undefined` | — | 否 | `=` 前缀格的公式求值；返回 null/undefined/抛错回落 `=` 原文 |
| `excelKeys` | `boolean` | `true` | 否 | false 关闭 Excel 键位底座（`editCellOnEnter: true` + `ctrlMultiSelect: false`） |
| `selectionSync` | `{ apply, get }` | — | 否 | 给出即接线双向同步；`apply` 收表格选区快照，`get` 供回流读取 |

Store 实例面（`handle.store` / `handle.createStore()` / `handle.activeStore()` 的产物；类型未单独导出）：

- 构造参数即 `SheetPluginOptions.store` 形态；`rowCount`/`colCount` 构造期固定，越界写为空操作。
- 值：`getValue(col, row)` / `setValue(col, row, value)` / `getDisplayValue(col, row)`（经 `resolveDisplayValue` 显示链）。
- 样式：`getStyle`/`setStyle`/`clearStyle`/`entriesCellStyles`（格级）、`getColumnStyle`/`setColumnStyle`/`clearColumnStyle`/`entriesColumnStyles`（列级）、`getEffectiveStyle(col, row)`（合成序 `projectCellStyle(projectCellStyle(baseStyle, 列级), 格级)`，边框逐边独立合成，返回新对象）。
- cell meta：`setCellMeta(ns, col, row, value)` / `getCellMeta(ns, col, row)` / `entriesCellMeta(ns)`（行主序）/ `clearCellMeta(ns, col?, row?)` / `getCellMetaNamespaces()`——命名空间隔离。
- 行列尺寸：`getColWidth`/`setColWidth`/`getRowHeight`/`setRowHeight`/`clearColWidth`/`clearRowHeight`/`getColWidthOverrides`/`getRowHeightOverrides`。
- 冻结与合并：`getFrozen(): { colCount, rowCount }` / `setFrozen(frozen)` / `getMerges(): readonly CellRange[]` / `setMerges(ranges)`（重叠抛错）。
- 变更通知：`rebuild(update)`（批量重建：update 内静默、返回后发一次 `rebuild` 事件 + 每个被触碰 meta 命名空间一条）/ `onChange(listener)`（事件 `{ type: 'value' | 'style' | 'geometry' | 'freeze' | 'merge' | 'rebuild', col?, row? }`）/ `onMetaChange(listener)`。
- `asModel(): TableModel` — 产出 core 模型直挂 `ListTableOptions.model`；同一 Store 多次调用返回同一模型。

## 方法与事件

mount / unmount（引擎注册路径调用）：

- `mount(table)` — 取本实例对应 Store（书形态按实例反查，单表形态回落唯一 Store；未关联抛 `sheet 插件：mount 的表未关联 Store（书形态实例经 switchTo 创建，勿对插件外的表手动挂载）`）；非 `readonly` 时接线引擎编辑撤销记录（编辑提交 → 值命令）与填充生成（拖拽/双击柄 → 生成值经撤销化批量写 + `batchUpdate` 收敛失效，双击自动填充按 Store 行数延展）；`selectionSync` 给出时接线选区双向同步。
- `unmount(table)` — 按注册逆序拆线（填充 → 撤销 → 选区同步）。

书形态：

- `switchTo(id)` — 定义不存在抛 `SheetBook: unknown sheet id "<id>"`；首次切换惰性创建实例并应用 Store 冻结/合并/行列尺寸覆盖，创建即挂本插件；成功抛 change 事件（`created: true` 标记首建）。构造 options 合成序：统一 `tableOptions` × 定义 `options` × Store 状态（model/frozen/mergeCells）；列平面缺省按 Store 列数生成（`field` 为列号字符串、标题 A..Z，宿主给了 `columns` 时不覆盖）。
- `onSheetChange(listener)` — 切换/创建/移除事件（宿主据其重挂 DOM：容器显隐/重挂）。
- `dispose()` — 销毁池内全部实例；定义保留可重建。注入式宿主（`createHost` 返回 `host`）不随实例销毁（所有权在注入方）。

撤销 / 重做：

- `undo()` / `redo()` — 值命令回写经 `store.setValue` 直写模型（模型事件 → 引擎局部刷新），不再触发 `onCellChange`，天然无回环；空栈空操作。
- `writeValues(store, writes)` — 撤销化批量写：同格多写末次为准，新值与现值相同的格不写不入命令；一次调用 = 一条组合值命令（整体回退/重做）。
- 只覆盖值命令：结构命令（冻结/合并/行列尺寸）不入栈。

快照：

- `saveSnapshot(store, extras?)` — 九字段全量快照：`cells`（值）、`styles`（格级 + 列级）、`merges`、`frozen`、`rowHeights`、`colWidths`、`images`、`meta`、`selection`；样式/选区/浮动图深拷贝。`extras.selection` 缺省为 null。
- `restoreSnapshot(store, snap, wiring?)` — 替换语义（不在快照内的状态被清场）、经 `Store.rebuild` 收口一次汇总；`images`/`selection` 经 `wiring` 回调交宿主接线落到引擎侧。

边框与导出：

- `borderEdge(style, color)` — `thin`/`medium`/`thick` → solid 1/2/3px；`dashed`/`dotted` 同名线型。
- `borderCells(bounds, preset, edge)` — 8 预设（outer/inner/all/top/bottom/left/right/none）× 区域展开为逐格边框片段，宿主逐格 `store.setStyle` 合并；不做邻居共享边回写（core 共享边裁决保证单侧设置即正确显示）；`none` 产出清除项（调用方清边框键）。
- `exportSheet(source)` — Store 状态（值经 `getDisplayValue`、样式经 `getEffectiveStyle`、合并/行列尺寸/浮动图）纯映射为 hucre `WriteSheet`（可结构化克隆发 worker）；`numFmtToXlsxCode` 映射：date → `yyyy-mm-dd`、thousands → `#,##0.00`、cnUpper → `[DBNum2][$-804]G/通用格式`、fixed(digits) → `0.00…`（0 位为 `0`）。
- `decodeImage(src)` — `data:image/*;base64,…` → 字节载荷（MIME 限 png/jpeg/gif/svg/webp）；其余/非 base64/解析失败返回 undefined，该对象跳过导出。

选区同步（`selectionSync` 接线时）：

- 表格 → 外部：`onSelectionChange` + 签名判重后调 `apply`。
- 外部 → 表格：`syncSelectionFromExternal()` → 读 `get()` → `table.applyExternalSelection`（同签名零开销；回流不广播，不触发 `apply`）；未接线为空操作。

## 典型示例

### 书形态：多 sheet 切换（DOM 显隐归宿主）

```ts
import { createSheetPlugin } from 'infinitable'

const viewport = document.querySelector<HTMLDivElement>('#grid')!
const sheet = createSheetPlugin({
  createHost: () => {
    const container = document.createElement('div')
    container.style.width = '800px'
    container.style.height = '420px'
    container.style.position = 'relative'
    container.style.display = 'none' // 宿主管显隐：切活跃时置 block
    viewport.appendChild(container)
    return { hostOptions: { container } }
  },
})

const storeA = sheet.createStore({ rowCount: 50, colCount: 8 })
storeA.setValue(0, 0, 'A1')
const storeB = sheet.createStore({ rowCount: 30, colCount: 8 })
sheet.registerSheet({ id: 'sheet-1', store: storeA })
sheet.registerSheet({ id: 'sheet-2', store: storeB })

sheet.onSheetChange((event) => {
  console.log(event.activeId, event.created) // => 'sheet-1' true（首次创建）
  // 宿主据 event 重挂 DOM：旧容器 display none、新容器 display block
})

const table = sheet.switchTo('sheet-1') // 惰性创建实例并挂本插件
console.log(table.getCellText(0, 0)) // => 'A1'
sheet.switchTo('sheet-2') // 池内复用路径（第二次切回 sheet-1 不重建）
console.log(sheet.activeStore() === storeB) // => true
sheet.dispose() // 销毁全部实例（定义保留可重建）
```

### 撤销化批量写 + 快照持久化

```ts
import type { ListTable } from 'infinitable'
import type { SheetPluginHandle } from 'infinitable'

declare const table: ListTable
declare const sheet: SheetPluginHandle
declare const store: ReturnType<SheetPluginHandle['createStore']>

// 查找替换等直写 Store 的内容变更共用 writeValues：一次调用 = 一条撤销命令
sheet.writeValues(store, [
  { col: 0, row: 0, value: '新值' },
  { col: 1, row: 0, value: 42 },
])
sheet.undo() // 整体回退
sheet.clearHistory()

// 采集（浮动对象与选区自引擎侧取值注入）
const images = table.floatObjects.get('float-1') ? [table.floatObjects.get('float-1')!] : []
const snap = sheet.saveSnapshot(store, { images, selection: table.getSelection() })
localStorage.setItem('sheet-snapshot', JSON.stringify(snap))

// 灌回（替换语义；images/selection 经 wiring 接线落到引擎侧）
sheet.restoreSnapshot(store, snap, {
  images: (objects) => {
    for (const object of objects) {
      table.floatObjects.add(object)
    }
  },
  selection: (selection) => {
    if (selection) table.applyExternalSelection(selection)
    else table.clearSelection()
  },
})
```

### 边框预设 + xlsx 导出

```ts
import type { SheetPluginHandle } from 'infinitable'
import { writeSheet } from 'hucre' // xlsx 读写引擎由使用方自备

declare const sheet: SheetPluginHandle
declare const store: ReturnType<SheetPluginHandle['createStore']>

// 选区四边加中粗红框：预设展开为逐格片段，逐格合并进 Store
const edge = sheet.borderEdge('medium', '#dc2626')
for (const cell of sheet.borderCells({ minCol: 0, minRow: 0, maxCol: 2, maxRow: 2 }, 'outer', edge)) {
  store.setStyle(cell.col, cell.row, cell.style)
}

// Store → hucre WriteSheet（纯数据映射，可结构化克隆发 worker）；写 .xlsx 由 hucre 执行
const writeable = sheet.exportSheet({ name: '销售明细', store })
const payload = sheet.decodeImage('data:image/png;base64,iVBORw0KGgo=') // 浮动图字节载荷
console.log(payload?.type, writeable.name) // => 'png' '销售明细'
void writeSheet
```

## 注意事项

> [!WARNING]
> - 0.1.2 起本篇从散装符号（`SheetStore`/`SheetBook`/`snapshot`/`restore`/`excelKeymapPreset`/`bindFillGeneration`/`bindSelectionSync`/`createFormulaDisplay`/`UndoStack`/`bindCellChangeUndo`/`borderPresetLine`/`buildBorderPresetCells`/`sheetToWriteSheet`/`numFmtToXlsxCode`/`decodeDataUrlImage`）收敛为 `createSheetPlugin` 工厂与 handle 方法：Store 经 `handle.store`/`createStore`/`activeStore()` 取用，能力一律走 handle 同名方法，散装导入不再可用。
> - Store 维度构造期固定：行数/列数不可变（与引擎 `columns.length` 对齐）；值/样式/meta 越界写为空操作不报错。
> - 单表形态宿主自建表时必须同时把插件传进 `plugins`（或 `table.use(sheet)`）：只取 `asModel()` 不挂插件则没有撤销/填充/键位接线；对插件外的表手动挂载会抛「mount 的表未关联 Store」。
> - 书形态只管实例池与状态，DOM 呈现归宿主：容器显隐、尺寸测量、滚轮接线都在宿主的 `createHost`/`onSheetChange` 里做。
> - `switchTo` 只在实例首次创建时应用 Store 冻结/合并/尺寸；Store 状态在实例已建后再改，不会自动同步到引擎——订阅 Store `onChange` 自行写到活跃实例。
> - `writeValues`/`undo`/`redo` 只覆盖值命令：结构命令（冻结/合并/行列尺寸）由宿主自行入栈管理。
> - `exportSheet` 产出 hucre 的 `WriteSheet` 纯映射对象；hucre（xlsx 读写引擎）不在 infinitable 依赖里，由使用方自备。
> - `borderCells` 不做邻居共享边回写：单侧设置即正确显示（core 共享边裁决保证）；共享边所有者滚出可视窗口时邻居对侧边暂不显示，这是 core 的既有取舍。

## 常见问题

### 切 sheet 后冻结/合并没生效

原因：`switchTo` 只在实例首次创建时应用 Store 冻结/合并/尺寸；Store 状态在实例已建后再改，不会自动同步到引擎。修复：订阅 Store `onChange`，把 freeze/merge/geometry 变更写到活跃实例。

```ts
import type { SheetPluginHandle } from 'infinitable'

declare const sheet: SheetPluginHandle
const store = sheet.activeStore()

store?.onChange((event) => {
  const table = sheet.activeTable()
  if (!table) {
    return
  }
  if (event.type === 'freeze') {
    const frozen = store.getFrozen()
    table.setFrozenColCount(frozen.colCount)
    table.setFrozenRowCount(frozen.rowCount)
  } else if (event.type === 'merge') {
    table.setMergeCells(store.getMerges())
  }
})
```

### 撤销后表格没刷新

原因：undo 回写走的不是 `store.setValue`（模型事件路径）而是直接改了引擎或跳过了 Store。修复：直写 Store 的内容变更一律经 `sheet.writeValues`，撤销重做经 `sheet.undo()/redo()`。

```ts
import type { SheetPluginHandle } from 'infinitable'

declare const sheet: SheetPluginHandle
declare const store: ReturnType<SheetPluginHandle['createStore']>

sheet.writeValues(store, [{ col: 0, row: 0, value: '新值' }]) // 写入 + 入栈一条组合命令
sheet.undo() // 回写旧值经 store.setValue → 模型事件 → 引擎局部刷新
```
