---
title: EditManager 编辑与 TextEditor 文本编辑器
description: infinitable 编辑体系：可编三级判定（editor 声明 ∧ 格级 editable ∧ 有回写目标）、EditManager 编辑会话生命周期（startEdit/commitEdit/cancelEdit）、EditorRegistry 注册表与格级路由、createTextEditor DOM 浮层文本编辑器（Enter 提交下移/Tab 右移/Esc 取消）。
aliases: [Editor, 编辑器, 编辑, EditManager, TextEditor]
keywords: [EditManager, startEdit, commitEdit, cancelEdit, EditorRegistry, registerEditor, createTextEditor, editorMultiline, editorMaxLength, resolveEditable, editCellOnEnter, onEditStart, onEditEnd, EditWriteTarget, 编辑, 双击编辑, 单元格编辑, 编辑器注册, 提交, 取消]
---

# EditManager 编辑与 TextEditor 文本编辑器

`infinitable`（core 层）导出编辑体系：`EditorRegistry`（编辑器注册表与格级路由）、`EditManager`（编辑会话唯一状态源）、`createTextEditor`（DOM 浮层文本编辑器，单行 input/多行 textarea）。双击（含触控双击）进入编辑，`editCellOnEnter: true` 时非编辑态按 Enter 进编辑；Enter 提交并下移、Tab 提交并右移、Esc 取消；编辑中滚动浮层逐帧跟随锚定格，锚定格滚出视口按 Enter 语义自动提交。`ListTable` 已内置接线：挂在 `ListTable` 上使用时只调 `table.startEdit/commitEdit/cancelEdit` 与事件；`EditManager`/`createTextEditor` 用于脱离 `ListTable` 独立组装编辑管线。

## 快速上手

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {}) // 名字任意；列定义 editor 引用同名

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 620,
  height: 220,
  columns: [
    { title: '名称', width: 160, editor: 'text' },
    { title: '备注（多行）', width: 220, editor: 'text', editorMultiline: true },
    { title: '展示列', width: 140 }, // 无 editor 声明：双击无反应（不可编）
  ],
  model: new SheetModel(16, 3),
  editorRegistry: registry,
  hostOptions: { container },
})

// 双击 (0,3) 或调 API 进入编辑：
const opened = table.startEdit(0, 3) // => true（三级判定通过）
table.commitEdit() // 提交回写 model 并移动选区；无会话返回 false

table.onCellChange((change) => {
  console.log(`(${change.col},${change.row}) ${String(change.oldValue)} -> ${String(change.newValue)}`)
})
```

## API 签名

```ts
/** 编辑器接口：实现该接口并经 EditorRegistry 注册即可被格级路由解析到 */
export interface CellEditor {
  /** 编辑器标识（可选，供实现自检/调试；注册名由注册表管理） */
  readonly name?: string
}

/** 格级路由 hook：按格返回编辑器注册名，优先于列定义 editor */
export type EditorRoute = (col: number, row: number) => string | undefined

export class EditorRegistry {
  constructor(route?: EditorRoute)
  registerEditor(name: string, editor: CellEditor): void
  getEditor(name: string): CellEditor | undefined
  /** 路由名先走 route hook，回退列定义 editor；未注册的名字解析为 undefined */
  resolveEditor(columns: readonly ColumnDefine[], col: number, row: number): CellEditor | undefined
}

/** 回写目标：数据供给形态的格级可写判定与提交写值 */
export interface EditWriteTarget {
  canWrite(col: number, row: number): boolean
  write(col: number, row: number, value: unknown): void
}

/** 提交后的选区移动方向：Enter 下移、Tab 右移 */
export type EditCommitMove = 'down' | 'right'

export interface EditManagerInit {
  columns: readonly ColumnDefine[]
  registry: EditorRegistry
  resolveEditable?: (col: number, row: number) => boolean
  editorMaxLength?: number
  writeTarget: EditWriteTarget
  resolveValue: (col: number, row: number) => unknown
  cellFont?: (col: number, row: number) => string
  cellRect: (col: number, row: number) => Region | null
  refreshCell: (col: number, row: number) => void
  emitChange: (change: CellChangeEvent) => void
  emitStart?: (event: EditStartEvent) => void
  emitEnd?: (event: EditEndEvent) => void
  moveSelection: (col: number, row: number, move: EditCommitMove) => void
  restoreFocus: () => void
  resolveEditorBlur?: () => 'commit' | 'ignore'
  host?: TextEditorHost
  doc?: TextEditorDoc
  subscribeScrollFrame?: (listener: (state: ScrollState) => void) => () => void
}

export class EditManager {
  constructor(init: EditManagerInit)
  isEditing(): boolean
  editingCell(): CellRef | null
  /** 可编三级判定：editor 声明/路由 ∧ 格级 editable ∧ 有回写目标 */
  isEditable(col: number, row: number): boolean
  startEdit(col: number, row: number): boolean
  commitEdit(move?: EditCommitMove): boolean
  cancelEdit(): void
  dispose(): void
}

/** 编辑器键盘事件最小结构（真实 KeyboardEvent 天然满足） */
export interface EditorKeyEvent {
  readonly key?: string
  preventDefault(): void
  stopPropagation(): void
}

/** 编辑器元素最小结构（真实 HTMLInputElement/HTMLTextAreaElement 天然满足） */
export interface TextEditorElement {
  value: string
  maxLength?: number
  readonly style: TextEditorElementStyle
  focus(): void
  addEventListener(type: string, listener: (event: EditorKeyEvent) => void): void
  removeEventListener(type: string, listener: (event: EditorKeyEvent) => void): void
}

export interface TextEditorElementStyle {
  position: string
  left: string
  top: string
  width: string
  height: string
  cssText?: string
  borderColor?: string
}

export interface TextEditorHost {
  appendChild(child: TextEditorElement): unknown
  removeChild(child: TextEditorElement): unknown
}

export interface TextEditorDoc {
  createElement(tag: 'input' | 'textarea'): TextEditorElement
}

/** 键盘语义动作：Esc 取消、Enter 提交并下移、Tab 提交并右移 */
export type TextEditorKeyAction = 'cancel' | 'commitDown' | 'commitRight'

export interface TextEditorInit {
  multiline?: boolean
  maxLength?: number
  font?: string
  doc?: TextEditorDoc
}

export interface TextEditor {
  open(host: TextEditorHost, rect: Region, initialValue: string): void
  moveTo(rect: Region): void
  getValue(): string
  close(): void
  onKey(handler: (action: TextEditorKeyAction) => void): void
  onBlur(handler: () => void): void
}

/** 创建文本编辑器实例（每次编辑会话新建一个） */
export function createTextEditor(init?: TextEditorInit): TextEditor
```

## 参数说明

`TextEditorInit`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `multiline` | `boolean` | `false` | 否 | true 走 textarea（多行，Enter 在多行态换行由宿主键位决定——引擎内 Enter 恒提交），false 单行 input |
| `maxLength` | `number` | 不截断 | 否 | 元素原生 maxLength 截断输入期键入/粘贴 + 初值与提交口径兜底截断 |
| `font` | `string` | 浏览器缺省 | 否 | CSS font 串（引擎按锚定格样式推导传入） |
| `doc` | `TextEditorDoc` | `globalThis.document` | 否 | 无 DOM 环境必须注入，缺 document 时抛 `createTextEditor 需要 DOM 文档；无 DOM 环境请注入 init.doc` |

`EditorRegistry.resolveEditor` 路由序：`route(col, row)` 返回的名字优先；未给（undefined）回退 `columns[col].editor`；最终名字未注册返回 undefined（该格不可编）。

可编三级判定（`isEditable` / `table.startEdit`）：

1. `EditorRegistry.resolveEditor` 命中（列声明 `editor` 或格级路由给出且已注册）；
2. `resolveEditable`（ListTableOptions / EditManagerInit）未对该格返回 false（缺省全部可编）；
3. `writeTarget.canWrite(col, row)` 为 true——records 形态该列须有 `field` 且行对象存在；model 形态恒 true。

`EditManagerInit.resolveEditorBlur`：缺省 `'commit'`（焦点移出画布按提交语义终止但不抢回焦点）；`'ignore'` 保持会话（公式引用拾取等宿主互锁形态）。ListTable 的动态判定：`editPickMode` 为 true 时 ignore，否则 commit。

## 方法与事件

`EditManager`（ListTable 经 `table.editManager` 透出，`table.startEdit/commitEdit/cancelEdit/isEditing` 直通）：

- `startEdit(col, row): boolean` — 三级判定通过才打开浮层（初值为基础值口径，未过 `resolveDisplayValue`），返回 true；不可编返回 false 且无浮层。已有会话时同格幂等（不重开不丢焦点），异格先提交当前会话再开新会话。ListTable 侧进入前先把锚定格滚动到完整可见并选中该格。
- `commitEdit(move?): boolean` — 提交序固定：写回数据源 → 该格 cell 级失效 → 抛 `onCellChange` → 抛 `onEditEnd`（committed=true 带终值）→ 按 move（`'down'`/`'right'`）移动选区。无会话返回 false。
- `cancelEdit(): void` — 不回写不抛 onCellChange；抛 `onEditEnd`（committed=false 无终值）；焦点交还表格。无会话为空操作。
- `isEditing(): boolean` / `editingCell(): CellRef | null`。
- `dispose(): void` — 退订滚动帧并取消当前会话。

编辑中行为：

- 滚动帧：浮层逐帧对齐锚定格最新视口矩形；锚定格滚出视口（cellRect null）按 Enter 语义自动提交（`commitEdit('down')`）。
- 编辑中锚定格内容隐藏（DOM 浮层取代内容渲染，溢出部分一并隐去），会话结束恢复。
- `EditStartEvent`：`{ col, row, initialValue }`——会话真正打开后通知（可编判定失败不抛）；同格幂等重入不重复通知。
- `EditEndEvent`：`{ col, row, initialValue, finalValue?, committed }`——提交路径在 `onCellChange` 之后抛且带终值；取消 committed=false。

`TextEditor`：

- `open(host, rect, initialValue)` — 挂载到宿主（表格容器）、按视口矩形定位（边框 2px 骑格缘内外各半）、赋初值（超 maxLength 截断）并聚焦。
- `moveTo(rect)` — 滚动跟随重新定位，不重挂载、不抢焦点、不改值。
- `getValue(): string` — 当前编辑值（提交口径，超 maxLength 截断）。
- `close()` — 摘除元素、解绑键盘；重复调用幂等。
- `onKey` — Esc/Enter/Tab 已拦截默认行为与冒泡后回调语义动作。
- `onBlur` — 元素 blur 事件（close 后不再触发）。

## 典型示例

### 字符上限与禁编格

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})
const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 620,
  height: 220,
  columns: [
    { title: '名称', width: 160, editor: 'text', editorMaxLength: 5 }, // 列级上限 5 字符
    { title: '备注', width: 220, editor: 'text' },
  ],
  model: new SheetModel(16, 2),
  editorRegistry: registry,
  editorMaxLength: 500, // options 级兜底（列级优先）
  resolveEditable: (col, row) => !(col === 0 && row === 2), // (0,2) 格级禁编
  hostOptions: { container },
})

console.log(table.startEdit(0, 2)) // => false（resolveEditable 拒绝）
console.log(table.startEdit(0, 0)) // => true（输入第 6 个字符被截断）
```

### 独立组装 EditManager（无 ListTable）

```ts
import { EditManager, EditorRegistry, createTextEditor } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})

const manager = new EditManager({
  columns: [{ title: 'A', editor: 'text' }],
  registry,
  writeTarget: {
    canWrite: () => true,
    write: (col, row, value) => {
      console.log('write', col, row, value)
    },
  },
  resolveValue: (col, row) => `初始-${row}`,
  cellRect: () => ({ x: 100, y: 40, width: 160, height: 28 }),
  refreshCell: () => {},
  emitChange: (change) => console.log(change.newValue),
  moveSelection: () => {},
  restoreFocus: () => {},
})

const opened = manager.startEdit(0, 1) // => true（浮层挂 detached 离屏宿主，会话状态可用）
manager.commitEdit('down') // => 控制台输出 write 0 1 与新值
manager.dispose()
```

### 编辑事件镜像公式栏

```ts
import { ListTable, SheetModel, EditorRegistry } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {})
const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ title: '公式', editor: 'text' }],
  model: new SheetModel(10, 1),
  editorRegistry: registry,
  hostOptions: { container },
})

const formulaBar = document.querySelector<HTMLInputElement>('#formula-bar')!
table.onEditStart((event) => {
  formulaBar.value = String(event.initialValue ?? '') // 基础值口径（= 原文）
})
table.onEditEnd((event) => {
  if (event.committed) {
    formulaBar.value = String(event.finalValue ?? '')
  }
})
```

## 注意事项

> [!WARNING]
> - 编辑初值是基础值口径（`resolveValue`，未过 `resolveDisplayValue`）：公式格显示值与编辑值不一致时，编辑拿到的是原始值——公式感知显示由 sheet 插件 `createFormulaDisplay` 配合（见 `apis/sheet-plugin.md`）。
> - 注册表是实例级（`ListTableOptions.editorRegistry` 或 `table.editorRegistry`），不是全局注册表；跨表复用须传同一实例或各自注册。
> - 编辑器字符上限优先级：列 `editorMaxLength` > options `editorMaxLength` > 不截断。
> - 多行形态（`editorMultiline: true`）下 Enter 仍是提交并下移（引擎内 Enter 恒提交语义）；需要「多行内换行」的宿主须自行接管键位。
> - 编辑浮层挂 `hostOptions.container`；未传容器的离屏构造编辑器不落 DOM（会话状态仍可用，浮层不可见）。
> - 无 DOM 环境调 `createTextEditor` 缺 `init.doc` 抛 `createTextEditor 需要 DOM 文档；无 DOM 环境请注入 init.doc`。

## 常见问题

### 双击进不了编辑且 startEdit 返回 false

原因：三级判定未全过——列没声明 `editor`、注册表里没有同名编辑器、`resolveEditable` 拒绝、或 records 形态该列无 `field`。修复：补声明与注册。

```ts
import { EditorRegistry, ListTable } from 'infinitable'

const registry = new EditorRegistry()
registry.registerEditor('text', {}) // 缺这一行时列声明 editor: 'text' 也判定不可编
const table = new ListTable({
  width: 400,
  height: 300,
  columns: [{ field: 'name', title: '名称', editor: 'text' }], // records 形态必须有 field 才有回写目标
  records: [{ name: 'a' }],
  editorRegistry: registry,
  hostOptions: { container: document.querySelector<HTMLDivElement>('#table')! },
})
console.log(table.startEdit(0, 0)) // => true
```

### 编辑中滚动表格后编辑内容丢了

原因：锚定格滚出视口时按 Enter 语义自动提交（不丢内容，已回写）；内容「丢」是提交后选区下移的观感。修复：需要保持会话时编辑前先 `scrollToCell`，或用 `editPickMode` 形态由宿主管理互锁（公式拾取场景）。

```ts
import type { ListTable } from 'infinitable'

declare const table: ListTable
table.scrollToCell({ col: 0, row: 100 }) // 先滚到目标格完整可见
table.startEdit(0, 100) // 编辑期间锚定格保持可见，浮层逐帧跟随
```
