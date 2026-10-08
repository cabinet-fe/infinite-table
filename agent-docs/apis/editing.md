---
title: EditorRegistry 编辑器注册表与编辑会话
description: infinitable 编辑体系：EditorRegistry 编辑器注册表与格级路由（registerEditor/resolveEditor）、可编三级判定（editor 声明 ∧ 格级 editable ∧ 有回写目标）、table.startEdit/commitEdit/cancelEdit 编辑会话、editorMultiline/editorMaxLength 字符上限、onEditStart/onEditEnd 事件与编辑浮层跟随行为（Enter 提交下移/Tab 右移/Esc 取消）。
aliases: [Editor, 编辑器, 编辑, EditManager, TextEditor, createTextEditor, 单元格编辑]
keywords: [EditorRegistry, registerEditor, resolveEditor, startEdit, commitEdit, cancelEdit, isEditing, editPickMode, editorMultiline, editorMaxLength, resolveEditable, editCellOnEnter, onEditStart, onEditEnd, 编辑, 双击编辑, 单元格编辑, 编辑器注册, 提交, 取消]
---

# EditorRegistry 编辑器注册表与编辑会话

`infinitable`（core 层）导出 `EditorRegistry`（编辑器注册表与格级路由），编辑会话经 `ListTable` 实例面使用：`table.startEdit/commitEdit/cancelEdit/isEditing` 与 `onEditStart/onEditEnd` 事件。双击（含触控双击）进入编辑，`editCellOnEnter: true` 时非编辑态按 Enter 进编辑；Enter 提交并下移、Tab 提交并右移、Esc 取消；编辑中滚动浮层逐帧跟随锚定格，锚定格滚出视口按 Enter 语义自动提交。编辑会话管理器与 DOM 浮层文本编辑器（原 `EditManager`/`createTextEditor`，0.1.2 起不再导出）由引擎内部接线，宿主只消费注册表与表格实例面。

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
/**
 * 编辑器注册表与格级路由（预留）：MVP 不内置具体编辑器，注册名即占位编辑器，
 * 由列定义 editor 字段或构造期 route hook 引用。
 */
export class EditorRegistry {
  /**
   * @param route 格级路由 hook：按格返回编辑器注册名，优先于列定义 editor；
   *              未导出为独立类型，签名 `(col: number, row: number) => string | undefined`
   */
  constructor(route?: (col: number, row: number) => string | undefined)
  /** 注册编辑器（editor 形态 `{ readonly name?: string }`，未导出为独立类型） */
  registerEditor(name: string, editor: { readonly name?: string }): void
  getEditor(name: string): { readonly name?: string } | undefined
  /** 路由名先走 route hook，回退列定义 editor；未注册的名字解析为 undefined */
  resolveEditor(
    columns: readonly ColumnDefine[],
    col: number,
    row: number,
  ): { readonly name?: string } | undefined
}
```

`ListTable` 编辑相关成员（会话与浮层由引擎内置接线）：

```ts
export class ListTable {
  /** 编辑器注册表（ListTableOptions.editorRegistry 注入，或经此事后注册） */
  readonly editorRegistry: EditorRegistry
  /**
   * 编辑拾取模式（宿主驱动，公式引用拾取用）：true 时编辑中指针点选/拖选其它格
   * 不提交当前会话，选区照常流动；置回 false 恢复「点别处即提交」缺省语义
   */
  editPickMode: boolean // 缺省 false
  startEdit(col: number, row: number): boolean
  commitEdit(): boolean
  cancelEdit(): void
  isEditing(): boolean
  onEditStart(listener: (event: { col: number; row: number; initialValue: unknown }) => void): () => void
  onEditEnd(listener: (event: {
    col: number
    row: number
    initialValue: unknown
    finalValue?: unknown
    committed: boolean
  }) => void): () => void
}
```

## 参数说明

`EditorRegistry` 方法：

| 方法 | 返回 | 约束 |
| --- | --- | --- |
| `registerEditor(name, editor)` | `void` | 同名重复注册覆盖 |
| `getEditor(name)` | 编辑器或 `undefined` | 未注册的名字返回 undefined（该格不可编） |
| `resolveEditor(columns, col, row)` | 编辑器或 `undefined` | 路由序：`route(col, row)` 返回的名字优先；未给（undefined）回退 `columns[col].editor`；最终名字未注册返回 undefined |

`ListTableOptions` 编辑字段（五要素）：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `editorRegistry` | `EditorRegistry` | 空表 | 否 | 可编第一级判定与格级路由；也可事后经 `table.editorRegistry` 注册 |
| `resolveEditable` | `(col, row) => boolean` | 全部可编 | 否 | 返回 false 该格不可编 |
| `editCellOnEnter` | `boolean` | `false` | 否 | true 时非编辑态按 Enter 进入焦点格编辑 |
| `editorMaxLength` | `number` | 不截断 | 否 | 编辑器字符上限；列级 `editorMaxLength` 优先 |
| `ColumnDefine.editor` | `string` | — | 否 | 该列编辑器注册名 |
| `ColumnDefine.editorMultiline` | `boolean` | `false` | 否 | true 走 textarea（多行形态） |

可编三级判定（`table.startEdit` / 双击编辑）：

1. `EditorRegistry.resolveEditor` 命中（列声明 `editor` 或格级路由给出且已注册）；
2. `resolveEditable` 未对该格返回 false（缺省全部可编）；
3. 有回写目标——model 形态恒有；records 形态该列须有 `field` 且行对象存在。

## 方法与事件

`ListTable` 编辑会话（全部同步）：

- `startEdit(col, row): boolean` — 三级判定通过才打开浮层（初值为基础值口径，未过 `resolveDisplayValue`），返回 true；不可编返回 false 且无浮层。已有会话时同格幂等（不重开不丢焦点），异格先提交当前会话再开新会话。进入前先把锚定格滚动到完整可见并选中该格。
- `commitEdit(): boolean` — 提交序固定：写回数据源 → 该格 cell 级失效 → 抛 `onCellChange` → 抛 `onEditEnd`（committed=true 带终值）→ 按 Enter 语义移动选区（下移）。无会话返回 false。
- `cancelEdit(): void` — 不回写不抛 onCellChange；抛 `onEditEnd`（committed=false 无终值）；焦点交还表格。无会话为空操作。
- `isEditing(): boolean`。

编辑中行为：

- 滚动帧：浮层逐帧对齐锚定格最新视口矩形；锚定格滚出视口按 Enter 语义自动提交。
- 编辑中锚定格内容隐藏（DOM 浮层取代内容渲染，溢出部分一并隐去），会话结束恢复。
- 焦点移出画布（浮层 blur）：缺省按提交语义终止但不抢回焦点；`table.editPickMode = true` 时保持会话（公式引用拾取等宿主互锁形态）。
- `onEditStart`：`{ col, row, initialValue }`——会话真正打开后通知（可编判定失败不抛）；同格幂等重入不重复通知。
- `onEditEnd`：`{ col, row, initialValue, finalValue?, committed }`——提交路径在 `onCellChange` 之后抛且带终值；取消 committed=false。

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

### 格级路由（route hook 优先于列声明）

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

const registry = new EditorRegistry((col, row) =>
  col === 0 && row >= 5 ? 'long-text' : undefined, // 第 0 列第 5 行起路由到多行编辑器
)
registry.registerEditor('text', {})
registry.registerEditor('long-text', {})

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 620,
  height: 220,
  columns: [
    { title: '名称', editor: 'text', width: 160 },
    { title: '备注', editor: 'text', editorMultiline: true, width: 220 },
  ],
  model: new SheetModel(16, 2),
  editorRegistry: registry,
  hostOptions: { container },
})
console.log(table.startEdit(0, 6)) // => true（路由命中 long-text）
```

### 编辑事件镜像公式栏

```ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

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
> - 编辑初值是基础值口径（未过 `resolveDisplayValue`）：公式格显示值与编辑值不一致时，编辑拿到的是原始值——公式感知显示由 sheet 插件的 `evaluate` 注入达成（见 `apis/sheet-plugin.md`）。
> - 注册表是实例级（`ListTableOptions.editorRegistry` 或 `table.editorRegistry`），不是全局注册表；跨表复用须传同一实例或各自注册。
> - 编辑器字符上限优先级：列 `editorMaxLength` > options `editorMaxLength` > 不截断。
> - 多行形态（`editorMultiline: true`）下 Enter 仍是提交并下移（引擎内 Enter 恒提交语义）；需要「多行内换行」的宿主须自行接管键位。
> - 编辑浮层挂 `hostOptions.container`；未传容器的离屏构造编辑器不落 DOM（会话状态仍可用，浮层不可见）。
> - 编辑会话管理器与 DOM 文本编辑器（原 `EditManager`/`createTextEditor`，0.1.2 起不再导出）不支持脱离 `ListTable` 独立组装；独立编辑管线不在公共能力内。

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

原因：锚定格滚出视口时按 Enter 语义自动提交（不丢内容，已回写）；内容「丢」是提交后选区下移的观感。修复：需要保持会话时编辑前先 `scrollToCell`，或置 `table.editPickMode = true` 由宿主管理互锁（公式拾取场景）。

```ts
import type { ListTable } from 'infinitable'

declare const table: ListTable
table.scrollToCell({ col: 0, row: 100 }) // 先滚到目标格完整可见
table.startEdit(0, 100) // 编辑期间锚定格保持可见，浮层逐帧跟随
```
