---
title: sheet 插件族（SheetStore/SheetBook/填充/撤销/快照/xlsx）
description: infinitable 官方 sheet 插件族：SheetStore 坐标模型（值/格级列级样式/cell meta/行列尺寸/冻结/合并 + asModel 模型直挂）、SheetBook 多 sheet 实例池、generateFill/bindFillGeneration 填充生成、bindSelectionSync 选区双向同步、createFormulaDisplay 公式显示、UndoStack/bindCellChangeUndo 撤销栈、snapshot/restore 快照、边框预设与 xlsx 导出映射。
aliases: [SheetStore, SheetBook, sheet 插件, 电子表格, fill, undo, 快照]
keywords: [SheetStore, asModel, setValue, getEffectiveStyle, setCellMeta, rebuild, SheetBook, switchTo, HostFactory, bindFillGeneration, generateFill, bindSelectionSync, createFormulaDisplay, UndoStack, bindCellChangeUndo, snapshot, sheetToWriteSheet, 填充, 撤销, 快照]
---

# sheet 插件族（SheetStore/SheetBook/填充/撤销/快照/xlsx）

`infinitable`（plugins 层）导出 sheet 能力参考实现：`SheetStore`（坐标模型：值 + 格级/列级样式 + cell meta 命名空间 + 行列尺寸 + 冻结 + 合并，`asModel()` 直挂 `ListTableOptions.model`）、`SheetBook`（多 sheet 实例池，切换复用不重建）、填充生成（`generateFill`/`bindFillGeneration`）、选区双向同步（`bindSelectionSync`）、公式感知显示（`createFormulaDisplay`）、Excel 键位预设（`excelKeymapPreset`）、最小撤销栈（`UndoStack`/`bindCellChangeUndo`）、快照（`snapshot`/`restore`）、边框预设（`borderPresetLine`/`buildBorderPresetCells`）与 xlsx 导出映射（`sheetToWriteSheet` 等）。全部只依赖 core 公开入口。

## 快速上手

```ts
import { EditorRegistry, ListTable } from 'infinitable'
import { bindCellChangeUndo, excelKeymapPreset, SheetStore, UndoStack } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})

// 1. Store 是唯一事实源
const store = new SheetStore({ rowCount: 50, colCount: 8 })
store.setCellValue(0, 0, '标题')
store.setStyle(1, 1, { fontWeight: 'bold' })
store.setFrozen({ colCount: 1, rowCount: 1 })
store.setMerges([{ startCol: 2, startRow: 2, endCol: 3, endRow: 3 }])

// 2. 模型直挂：asModel() 产出 TableModel
const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 800,
  height: 420,
  columns: Array.from({ length: 8 }, (_, col) => ({ title: `列${col}`, width: 90, editor: 'text' })),
  model: store.asModel(),
  editorRegistry: registry,
  ...excelKeymapPreset, // editCellOnEnter: true + ctrlMultiSelect: false
  hostOptions: { container },
})
table.setFrozenColCount(1)
table.setFrozenRowCount(1)
table.setMergeCells(store.getMerges())

// 3. 撤销栈：编辑提交自动转值命令
const stack = new UndoStack(200)
const undo = bindCellChangeUndo({ table, store, stack })
// 双击编辑提交后 stack.undo() 回写 oldValue（经模型事件触发表格局部刷新，不再触发 onCellChange，无回环）
```

## API 签名

```ts
export interface SheetStoreOptions {
  rowCount: number
  colCount: number
  defaultColWidth?: number
  defaultRowHeight?: number
  /** 基础样式片段（getEffectiveStyle 合成最底层；未给为空片段） */
  baseStyle?: CellStyle
  /** 显示值解析注入（getDisplayValue 显示链；缺省回落原始值口径） */
  resolveDisplayValue?: SheetDisplayResolver
}

export type SheetDisplayResolver = (col: number, row: number, value: unknown) => unknown

/** Store 变更事件类型 */
export type SheetStoreChangeType = 'value' | 'style' | 'geometry' | 'freeze' | 'merge' | 'rebuild'
export interface SheetStoreChangeEvent {
  type: SheetStoreChangeType
  col?: number
  row?: number
}
export type SheetStoreChangeListener = (event: SheetStoreChangeEvent) => void

export interface SheetCellMetaEntry<T = unknown> { col: number; row: number; value: T }
export interface SheetCellStyleEntry { col: number; row: number; style: CellStyle }
export interface SheetColumnStyleEntry { col: number; style: CellStyle }

export interface SheetStoreMetaChangeEvent { ns: string; col?: number; row?: number }
export type SheetStoreMetaChangeListener = (event: SheetStoreMetaChangeEvent) => void

export interface SheetFrozen { colCount: number; rowCount: number }

export class SheetStore {
  constructor(options: SheetStoreOptions)
  getRowCount(): number
  getColCount(): number
  // 值
  getValue(col: number, row: number): unknown
  setValue(col: number, row: number, value: unknown): void
  getDisplayValue(col: number, row: number): unknown
  // 格级样式
  getStyle(col: number, row: number): CellStyle | undefined
  setStyle(col: number, row: number, style: CellStyle): void
  clearStyle(col: number, row: number): void
  entriesCellStyles(): SheetCellStyleEntry[]
  // 列级样式片段
  getColumnStyle(col: number): CellStyle | undefined
  setColumnStyle(col: number, style: CellStyle): void
  clearColumnStyle(col: number): void
  entriesColumnStyles(): SheetColumnStyleEntry[]
  /** 有效样式：基础 → 列级 → 格级逐字段合成（projectCellStyle 两级投影） */
  getEffectiveStyle(col: number, row: number): CellStyle | undefined
  // cell meta（命名空间隔离）
  setCellMeta<T>(ns: string, col: number, row: number, value: T): void
  getCellMeta<T = unknown>(ns: string, col: number, row: number): T | undefined
  entriesCellMeta<T = unknown>(ns: string): SheetCellMetaEntry<T>[]
  clearCellMeta(ns: string, col?: number, row?: number): void
  getCellMetaNamespaces(): string[]
  // 行列尺寸
  getColWidth(col: number): number
  getRowHeight(row: number): number
  setColWidth(col: number, width: number): void
  setRowHeight(row: number, height: number): void
  clearColWidth(col: number): void
  clearRowHeight(row: number): void
  getColWidthOverrides(): ReadonlyMap<number, number>
  getRowHeightOverrides(): ReadonlyMap<number, number>
  // 冻结与合并
  getFrozen(): SheetFrozen
  setFrozen(frozen: SheetFrozen): void
  getMerges(): readonly CellRange[]
  setMerges(ranges: readonly CellRange[]): void
  // 变更通知
  rebuild(update: () => void): void
  onChange(listener: SheetStoreChangeListener): () => void
  onMetaChange(listener: SheetStoreMetaChangeListener): () => void
  /** 产出 core TableModel（可直挂 ListTableOptions.model） */
  asModel(): TableModel
}

// ---- 多 sheet 实例池 ----

export interface SheetDef { id: string; store: SheetStore; options?: Partial<ListTableOptions> }
export interface SheetBookChangeEvent {
  activeId: string | null
  table: ListTable | null
  /** 本次事件是否为该 sheet 实例首次创建 */
  created: boolean
}
export type HostFactory = (def: SheetDef) => {
  host?: ListTableOptions['host']
  hostOptions?: ListTableOptions['hostOptions']
}
export interface SheetBookOptions {
  /** 实例构造器（必注入：host 无法在插件层缺省创建） */
  createHost: HostFactory
  tableOptions?: Partial<ListTableOptions>
}
export class SheetBook {
  constructor(options: SheetBookOptions)
  register(def: SheetDef): void
  remove(id: string): void
  has(id: string): boolean
  get(id: string): ListTable | undefined
  get activeId(): string | null
  get activeTable(): ListTable | null
  /** 切换活跃 sheet（实例惰性创建、池化复用）；定义不存在抛错 */
  switchTo(id: string): ListTable
  onChange(listener: (event: SheetBookChangeEvent) => void): () => void
  dispose(): void
}

// ---- 填充生成 ----

export interface FillCell { col: number; row: number; value: unknown }
export type FillRead = (col: number, row: number) => unknown
export interface FillGenerationOptions {
  table: ListTable
  read: FillRead
  write: (cells: FillCell[], event: FillDragEndEvent) => void
  generate?: typeof generateFill
  /** 双击填充柄自动填充：提供行数即启用 */
  autoComplete?: { rowCount: () => number }
}
export function generateFill(anchor: RangeBounds, target: RangeBounds, read: FillRead): FillCell[]
/** 双击自动填充目标：按相邻列连续数据块末行向下延展；无填充返回 null */
export function resolveAutoFillTarget(anchor: RangeBounds, read: FillRead, rowCount: number): RangeBounds | null
export function bindFillGeneration(options: FillGenerationOptions): () => void

// ---- 选区同步 / 公式显示 / 键位 ----

export interface SelectionSyncOptions {
  table: ListTable
  apply: (snapshot: SelectionSnapshot) => void
  get: () => SelectionSnapshot
}
export interface SelectionSyncController { syncFromExternal(): void; signature(): string; dispose(): void }
export function bindSelectionSync(options: SelectionSyncOptions): SelectionSyncController

export type FormulaEvaluator = (formula: string, col: number, row: number) => string | number | null | undefined
export type FormulaDisplayFn = NonNullable<ListTableOptions['resolveDisplayValue']>

/** 值为 '=' 前缀字符串的格经注入求值器渲染，其余复刻引擎缺省管线 */
export function createFormulaDisplay(options?: { evaluate?: FormulaEvaluator }): FormulaDisplayFn

/** 键位预设（Partial<ListTableOptions>，直接展开进 ListTableOptions） */
export const excelKeymapPreset: Partial<ListTableOptions>

// ---- 撤销栈 ----

export interface UndoCommand {
  label?: string
  undo(): void
  redo(): void
}

export class UndoStack {
  constructor(limit?: number) /* limit 默认 100 */
  get canUndo(): boolean
  get canRedo(): boolean
  /** 入栈（数组 = 组合命令，undo 逆序 / redo 正序）；清空 redo；超限丢最旧 */
  push(command: UndoCommand | UndoCommand[]): void
  undo(): void
  redo(): void
  clear(): void
}

export interface CellChangeUndoOptions {
  table: ListTable
  store: SheetStore
  stack: UndoStack
}
export interface CellChangeUndoBinding {
  stack: UndoStack
  dispose(): void
}
/** 引擎编辑提交 → 值命令入栈（undo 回写 oldValue / redo 回写 newValue） */
export function bindCellChangeUndo(options: CellChangeUndoOptions): CellChangeUndoBinding

// ---- 快照 ----

/** Sheet 全量快照（九字段：值/样式/合并/冻结/行高/列宽/浮动图/meta/选区） */
export interface SheetSnapshot {
  cells: { col: number; row: number; value: unknown }[]
  styles: {
    cells: { col: number; row: number; style: CellStyle }[]
    columns: { col: number; style: CellStyle }[]
  }
  merges: CellRange[]
  frozen: SheetFrozen
  rowHeights: { row: number; height: number }[]
  colWidths: { col: number; width: number }[]
  images: FloatObject[]
  meta: { ns: string; entries: SheetCellMetaEntry[] }[]
  selection: SelectionSnapshot | null
}
export interface SheetSnapshotExtras { images?: readonly FloatObject[]; selection?: SelectionSnapshot | null }
export interface SheetRestoreWiring {
  images?: (images: readonly FloatObject[]) => void
  selection?: (selection: SelectionSnapshot | null) => void
}
export function snapshot(store: SheetStore, extras?: SheetSnapshotExtras): SheetSnapshot
export function restore(store: SheetStore, snap: SheetSnapshot, wiring?: SheetRestoreWiring): void

// ---- 边框预设 ----

export type BorderPreset = 'outer' | 'inner' | 'all' | 'top' | 'bottom' | 'left' | 'right' | 'none'
export type BorderLineStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted'
export interface BorderPresetCell { col: number; row: number; style: CellStyle }
export function borderPresetLine(style: BorderLineStyle, color: string): CellBorderEdge
/** 预设 × 区域展开为逐格边框片段（8 预设 × 5 线型，纯函数） */
export function buildBorderPresetCells(preset: BorderPreset, bounds: RangeBounds, line: CellBorderEdge): BorderPresetCell[]

// ---- xlsx 导出 ----

export type SheetNumFmt =
  | { kind: 'date' }
  | { kind: 'thousands' }
  | { kind: 'cnUpper' }
  | { kind: 'fixed'; digits: number }
export interface SheetImagePayload { data: Uint8Array; type: 'png' | 'jpeg' | 'gif' | 'svg' | 'webp' }
export interface SheetExportSource {
  name: string
  store: SheetStore
  numFmt?: (col: number, row: number) => SheetNumFmt | undefined
  images?: readonly FloatObject[]
  imageData?: (object: FloatObject) => SheetImagePayload | undefined
}
/** numFmt → xlsx 格式码：date → 'yyyy-mm-dd'；thousands → '#,##0.00'；cnUpper → '[DBNum2][$-804]G/通用格式'；fixed(digits) → '0.00…'（0 位为 '0'） */
export function numFmtToXlsxCode(fmt: SheetNumFmt): string
/** SheetExportSource → hucre WriteSheet（值/样式经 Store 读取面取数；hucre 由使用方自备） */
export function sheetToWriteSheet(source: SheetExportSource): /* hucre WriteSheet */ unknown
/** data: URL → 字节载荷（MIME 限 png/jpeg/gif/svg/webp 且 base64）；无字节返回 undefined */
export function decodeDataUrlImage(src: string | undefined): SheetImagePayload | undefined
```

`excelKeymapPreset` 展开值：`{ editCellOnEnter: true, ctrlMultiSelect: false }`。

## 参数说明

`SheetStoreOptions`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `rowCount` / `colCount` | `number` | — | 是 | 维度构造期固定；值/样式/meta 越界写为空操作 |
| `defaultColWidth` | `number` | `100` | 否 | 未逐列覆盖时的列宽 |
| `defaultRowHeight` | `number` | `32` | 否 | 未逐行覆盖时的行高 |
| `baseStyle` | `CellStyle` | 空片段 | 否 | `getEffectiveStyle` 合成最底层 |
| `resolveDisplayValue` | `SheetDisplayResolver` | 原始值口径 | 否 | `getDisplayValue` 显示链注入 |

`SheetBookOptions.createHost`（必填）：每个 sheet 定义惰性创建 `ListTable` 时调用，返回 `{ host?, hostOptions? }`；宿主在此建容器并返回 `hostOptions: { container, dpr }`。`switchTo` 构造 options 合成序：统一 `tableOptions` × 定义 `options` × Store 状态（model/frozen/mergeCells）；列平面缺省按 Store 列数生成（`field` 为列号字符串、标题 A..Z）。

`FillGenerationOptions`：`read` 取 `store.getValue`；`write` 内用 `table.batchUpdate` 包住写入收敛失效（写入后 `bindFillGeneration` 自动把选区扩展到锚定段 ∪ 扩展区）。

`UndoStack(limit)`：默认 100；超限丢最旧。

`generateFill` 四类序列模式（按列/行独立推断）：数字线性序列（多格等差推断步长、单格步长 1）、`Date` 日期序列（按天）、文本尾数字序列（保留前导零、前缀须一致）、复制兜底（非序列值循环复制）。

## 方法与事件

`SheetStore`：

- 值：`setValue` 越界（含负坐标）为空操作；引擎编辑提交经 `asModel().setCellValue` 走同一入口并广播 `value` 事件。
- `getEffectiveStyle(col, row)` — 合成序固定：`projectCellStyle(projectCellStyle(baseStyle, 列级), 格级)`，边框逐边独立合成；返回新对象；无任何片段返回空样式；越界返回 undefined。
- cell meta — 命名空间（`ns`）之间隔离；`entriesCellMeta` 行主序确定性返回；`clearCellMeta(ns)`（清整个命名空间）带坐标清单格。
- `rebuild(update)` — 批量重建：update 内全部写路径静默，返回后发一次 `{ type: 'rebuild' }`（宿主按全量刷新处理）+ 每个被触碰命名空间一条 `{ ns }`；嵌套只最外层收口；update 抛错也收口后原样上抛。
- `onChange` — 首个订阅者出现时挂模型事件转发（`asModel` 的写也广播 value 事件）；`onMetaChange` — 独立的 meta 事件面。
- `asModel()` — 返回内部 `SheetModel`（TableModel 形态）；同一 Store 多次调用返回同一模型。

`SheetBook.switchTo(id)` — 定义不存在抛 `SheetBook: unknown sheet id "<id>"`；首次切换惰性创建实例（`created: true`）并应用 Store 行列尺寸覆盖；成功抛 change 事件。DOM 呈现（容器显隐/重挂）归宿主。

`bindFillGeneration(options)` — 返回退订函数；接线 `onFillDragEnd`（生成-写入-扩选）；提供 `autoComplete` 时同时接线 `onFillHandleDoubleClick`。

`bindSelectionSync(options)` — 表格 → 外部经 `onSelectionChange` + 签名判重；外部 → 表格经 `syncFromExternal()` → `table.applyExternalSelection`（同签名零开销）。

`createFormulaDisplay({ evaluate })` — 返回 `resolveDisplayValue` 形态函数：`=` 前缀字符串调 `evaluate(公式体, col, row)`，未注入/返回 null/undefined/抛错回落 `=` 原文（编辑初值即原文，所见即所编）；其它值复刻引擎缺省渲染（`value == null ? '' : String(value)`）。

`bindCellChangeUndo(options)` — 订阅 `table.onCellChange` 转值命令；undo/redo 回写经 `store.setValue` 直写模型（模型事件 → 引擎局部刷新），不再触发 `onCellChange`，天然无回环。

`snapshot(store, extras?)` / `restore(store, snap, wiring?)` — 九字段全量快照（值物化：样式/选区/浮动图两端深拷贝）；`images`/`selection` 不归 Store 持有，采集经 `extras` 注入、灌回经 `wiring` 回调交宿主接线；灌回替换语义（不在快照内的状态被清场）、经 `rebuild` 收口一次汇总。

边框预设：`borderPresetLine(style, color)` 产出一档线型的 `CellBorderEdge`；`buildBorderPresetCells(preset, bounds, line)` 把 8 种预设（outer/inner/all/top/bottom/left/right/none）× 区域展开为逐格边框片段（`BorderPresetCell[]`），宿主逐格 `store.setStyle` 合并；不做邻居共享边回写（core 共享边裁决保证单侧设置即正确显示）。

xlsx 导出：`sheetToWriteSheet(source)` 把 Store 状态（值经 `getDisplayValue`、样式经 `getEffectiveStyle`、合并/行列尺寸/浮动图）纯映射为 hucre `WriteSheet`（可结构化克隆发 worker），写 .xlsx 由使用方自备的 hucre 执行；`numFmtToXlsxCode(fmt)` 四类格式码映射；`decodeDataUrlImage(src)` 把 `data:image/*;base64,…` 解析为字节载荷（MIME 限 png/jpeg/gif/svg/webp，其余/非 base64/解析失败返回 undefined，该对象跳过导出）。

## 典型示例

### SheetBook 多 sheet 切换

```ts
import { EditorRegistry, type ListTableOptions } from 'infinitable'
import { SheetBook, SheetStore } from 'infinitable'

const viewport = document.querySelector<HTMLDivElement>('#grid')!
const registry = new EditorRegistry()
registry.registerEditor('text', {})

const book = new SheetBook({
  createHost: (def) => {
    const container = document.createElement('div')
    container.style.width = '800px'
    container.style.height = '420px'
    container.style.position = 'relative'
    container.style.display = 'none' // 宿主管显隐：切活跃时置 block
    viewport.appendChild(container)
    return { hostOptions: { container } }
  },
  tableOptions: {
    editorRegistry: registry,
    columns: Array.from({ length: 8 }, (_, col) => ({ title: `列${col}`, width: 90, editor: 'text' })),
  } satisfies Partial<ListTableOptions>,
})

book.register({ id: 'sheet-1', store: new SheetStore({ rowCount: 50, colCount: 8 }) })
book.register({ id: 'sheet-2', store: new SheetStore({ rowCount: 30, colCount: 8 }) })

book.onChange((event) => {
  console.log(event.activeId, event.created) // => 'sheet-1' true（首次创建）
})

const table = book.switchTo('sheet-1') // 惰性创建实例
book.switchTo('sheet-2') // 池内复用路径（第二次切回 sheet-1 不重建）
book.dispose() // 销毁全部实例（定义保留可重建）
```

### 填充柄生成写入（batchUpdate 收敛）

```ts
import type { ListTable } from 'infinitable'
import { bindFillGeneration, type SheetStore } from 'infinitable'

declare const table: ListTable
declare const store: SheetStore

const offFill = bindFillGeneration({
  table,
  read: (col, row) => store.getValue(col, row),
  write: (cells) => {
    table.batchUpdate(() => {
      for (const cell of cells) {
        store.setValue(cell.col, cell.row, cell.value) // 模型事件驱动逐格局部刷新
      }
    })
  },
  autoComplete: { rowCount: () => store.getRowCount() }, // 双击柄按相邻数据块自动填充
})
// offFill() 退订
```

### 快照持久化与恢复

```ts
import type { FloatObject, ListTable } from 'infinitable'
import { restore, snapshot, type SheetStore } from 'infinitable'

declare const table: ListTable
declare const store: SheetStore

// 采集（浮动对象与选区自引擎侧取值注入）
const images: FloatObject[] = []
if (table.floatObjects.get('float-1')) {
  images.push(table.floatObjects.get('float-1')!)
}
const snap = snapshot(store, { images, selection: table.getSelection() })
localStorage.setItem('sheet-snapshot', JSON.stringify(snap))

// 灌回（替换语义；images/selection 经 wiring 接线落到引擎侧）
restore(store, snap, {
  images: (images) => {
    for (const object of images) {
      table.floatObjects.add(object)
    }
  },
  selection: (selection) => {
    if (selection) table.applyExternalSelection(selection)
    else table.clearSelection()
  },
})
```

## 注意事项

> [!WARNING]
> - Store 维度构造期固定：行数/列数不可变（与引擎 `columns.length` 对齐）；值/样式/meta 越界写为空操作不报错。
> - `SheetBook.switchTo` 的构造 options 里列平面缺省按 Store 列数生成（`field` 为列号字符串）；宿主给了 `columns`（tableOptions 或 def.options）时不覆盖——引擎表格列数必须等于 Store 列数，否则合并/选区坐标越界。
> - SheetBook 只管实例池与状态，DOM 呈现归宿主：容器显隐、尺寸测量、滚轮接线都在宿主的 `createHost`/`onChange` 里做。
> - `bindCellChangeUndo` 只覆盖值命令：结构命令（冻结/合并/行列尺寸）由宿主包装 `UndoCommand` 自行入栈。
> - `snapshot` 的 `images`/`selection` 采集时给 undefined 与 null 语义不同（`extras.selection` 缺省为 null）；`restore` 后宿主需自行接线引擎侧（浮层对象对账、选区回流）。
> - `sheetToWriteSheet` 产出 hucre 的 `WriteSheet` 纯映射对象；hucre（xlsx 读写引擎）不在 infinitable 依赖里，由使用方自备。
> - `buildBorderPresetCells` 不做邻居共享边回写：单侧设置即正确显示（core 共享边裁决保证）；共享边所有者滚出可视窗口时邻居对侧边暂不显示，这是 core 的既有取舍。

## 常见问题

### 切 sheet 后冻结/合并没生效

原因：`SheetBook.switchTo` 只在实例首次创建时应用 Store 冻结/合并/尺寸；Store 状态在实例已建后再改，不会自动同步到引擎。修复：订阅 Store `onChange`，把 freeze/merge/geometry 变更写到活跃实例。

```ts
import type { ListTable } from 'infinitable'
import type { SheetStore } from 'infinitable'

declare const table: ListTable
declare const store: SheetStore

store.onChange((event) => {
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

原因：undo 回写走的不是 `store.setValue`（模型事件路径）而是直接改了引擎或跳过了 Store。修复：值命令的 undo/redo 一律经 `store.setValue` 写回。

```ts
import { UndoStack, bindCellChangeUndo } from 'infinitable'
import type { ListTable, SheetStore } from 'infinitable'

declare const table: ListTable
declare const store: SheetStore

const stack = new UndoStack()
bindCellChangeUndo({ table, store, stack }) // undo 回写 oldValue 经 store.setValue → 模型事件 → 引擎局部刷新
```
