# 可编辑表格

这篇教程演示 `ListTable` 的编辑闭环：用 `EditorRegistry` 注册编辑器名、列声明 `editor`、通过可编三级判定打开内置文本编辑器、提交时回写模型、取消时不回写，以及填充柄事件如何在宿主侧生成填充数据。最后给出 `SheetGrid` 的自定义编辑器写法，因为 `ListTable` 本身只提供内置文本编辑器。

<script setup>
import EditingDemo from '../.vitepress/theme/components/EditingDemo.vue'
import DemoBlock from '../.vitepress/theme/components/DemoBlock.vue'
</script>

## 在线演示

双击「数量」或「备注」列进入编辑，按 Enter 提交、Esc 取消；第一列被 `resolveEditable` 锁定为只读。工具栏按钮可以直接驱动编辑会话。切换到「源码」可以直接查看这个演示的完整实现。

<DemoBlock>

<EditingDemo />

<template #source>

<<< @/.vitepress/theme/components/EditingDemo.vue

</template>

</DemoBlock>

## 场景说明

- 数据需要编辑并回写，所以用 `model` 形态而不是 records。
- 不同列可能有不同编辑能力：有的列可编，有的列只读，有的格单独禁编。
- 需要区分「提交」和「取消」，并在提交后收到变更事件。
- 需要处理填充柄拖拽，但填充数据由业务侧生成，引擎只负责交互和事件。

## HTML 与容器

```html
<div id="table"></div>
<div class="actions">
  <button id="start">startEdit(0, 0)</button>
  <button id="commit">commitEdit()</button>
  <button id="cancel">cancelEdit()</button>
</div>
```

```css
#table {
  position: relative;
  width: 680px;
  height: 360px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
```

## 完整代码：注册表、可编判定与事件

```ts
// src/main.ts
import { EditorRegistry, ListTable, SheetModel } from 'infinitable'

// 1) 格级路由：优先于列定义 editor；返回 undefined 时回落到列声明
const registry = new EditorRegistry((col, row) => (col === 1 && row >= 8 ? 'long-text' : undefined))
registry.registerEditor('text', {})
registry.registerEditor('long-text', {})

// 2) 可编辑模型：32 行 × 3 列，初始值直接给二维数组
const model = new SheetModel(
  Array.from({ length: 32 }, (_, row) => [`名称-${row}`, `备注-${row}`, `状态-${row}`]),
)

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 680,
  height: 360,
  columns: [
    { title: '名称', width: 160, editor: 'text', editorMaxLength: 20 },
    { title: '备注', width: 260, editor: 'text', editorMultiline: true },
    // 没有 editor 声明：该列不可编，双击无反应
    { title: '状态', width: 120 },
  ],
  model,
  editorRegistry: registry,
  // 非编辑态按 Enter 进入焦点格编辑
  editCellOnEnter: true,
  // 格级禁编：(0, 2) 所在列可编，但这一格拒绝
  resolveEditable: (col, row) => !(col === 0 && row === 2),
  // 编辑浮层落在格边框内侧，粗边框编辑时仍然可见
  editorInsideBorder: true,
  hostOptions: { container },
})

// 3) 编辑事件：开始 → 提交时 onCellChange → onEditEnd；取消只有 onEditEnd
table.onEditStart(({ col, row, initialValue }) => {
  console.log(`开始编辑 (${col},${row})，初值 ${String(initialValue)}`)
})

table.onCellChange(({ col, row, oldValue, newValue }) => {
  console.log(`已提交 (${col},${row})：${String(oldValue)} -> ${String(newValue)}`)
})

table.onEditEnd(({ col, row, initialValue, finalValue, committed }) => {
  console.log(
    `结束编辑 (${col},${row})，committed=${committed}`,
    String(initialValue),
    String(finalValue),
  )
})

// 4) 编程式入口
document.querySelector<HTMLButtonElement>('#start')!.addEventListener('click', () => {
  // 返回 false 表示三级判定未通过（没声明编辑器、被 resolveEditable 拒绝、没有回写目标）
  console.log('startEdit:', table.startEdit(0, 0))
})

document.querySelector<HTMLButtonElement>('#commit')!.addEventListener('click', () => {
  // 没有编辑会话时返回 false
  console.log('commitEdit:', table.commitEdit())
})

document.querySelector<HTMLButtonElement>('#cancel')!.addEventListener('click', () => {
  table.cancelEdit()
})

window.addEventListener('beforeunload', () => {
  table.destroy()
})
```

## 关键点

### 编辑器注册表是「可编判定 + 路由」

`EditorRegistry` 的注册项契约是：

```ts
interface CellEditor {
  readonly name?: string
}

registerEditor(name: string, editor: CellEditor): void
```

它是一个占位编辑器，只用名字参与可编判定与格级路由。`ListTable` 实际打开的是引擎内置的 DOM 文本编辑器（单行 `input`，`editorMultiline: true` 时为 `textarea`）。`ListTable` **没有**让宿主提供自定义编辑 UI 的 `open` / `close` 契约；需要自定义编辑器界面时使用 `SheetGrid`，见下一节。

注册表是实例级的，不是全局表。跨表复用时要么传同一个 `EditorRegistry` 实例，要么各自注册。同名重复注册会覆盖。

### 可编三级判定

`table.startEdit(col, row)` 和双击编辑都必须同时满足：

1. `EditorRegistry.resolveEditor` 命中：列声明了 `editor`，或格级路由返回了已注册的名字；
2. `resolveEditable(col, row)` 没有返回 `false`；
3. 有回写目标：`model` 形态恒有；`records` 形态该列必须有 `field` 且行对象存在。

任一不满足，`startEdit` 返回 `false`，不会有浮层。

```ts
const opened = table.startEdit(0, 2)
// => false（resolveEditable 对该格返回 false）
```

### 键位与提交顺序

- 双击进入编辑。
- `editCellOnEnter: true` 时，非编辑态按 Enter 进入焦点格编辑。
- 编辑中 Enter 提交并下移，Tab 提交并右移，Esc 取消。
- 提交顺序固定：写回数据源 → 该格失效 → `onCellChange` → `onEditEnd(committed: true)` → 选区按 Enter 语义下移。
- 取消不回写、不抛 `onCellChange`，只抛 `onEditEnd(committed: false)`。
- 编辑中锚定格滚出视口时，按 Enter 语义自动提交。

`onEditStart` 的 `initialValue` 是基础值口径，未经过 `resolveDisplayValue`。公式格显示计算值、编辑拿到 `=SUM(...)` 原文，就是这个原因。

### 字符上限与浮层内缩

字符上限优先级是列级 `editorMaxLength` > `options.editorMaxLength` > 不截断：

```ts
columns: [
  { title: '名称', width: 160, editor: 'text', editorMaxLength: 20 },
],
editorMaxLength: 200,
```

`editorInsideBorder: true` 让编辑浮层按锚定格四周可见边框内缩，编辑粗边框格时不会盖住边框。

### 程序化回写

编辑提交会经模型回写。若要在不打开编辑器的情况下改值，使用 `updateCell`：

```ts
table.updateCell(0, 3, '批量改的值')
```

它只对 `model` 形态生效。records 形态请直接改行对象字段，然后调 `refreshCell(col, row)`。

## 自定义编辑器：SheetGrid

`SheetGrid` 的 `editors` 选项提供真正的自定义编辑 UI 契约。宿主实现 `GridCellEditor`，机制负责会话生命周期、滚动跟随和提交通道：

```ts
interface GridCellEditor {
  readonly name: string
  open(session: GridEditorSession): void
  close(): void
}
```

`GridEditorSession` 提供 `addr`、`container`、`rect`、`value`、`commit(value)`、`cancel()` 与 `onRectChange(listener)`。编辑 UI 挂在 `session.container` 内，按 `session.rect` 定位；提交经 `session.commit(value)` 写模型。

```html
<div id="sheet"></div>
```

```css
#sheet {
  position: relative;
  width: 640px;
  height: 320px;
}
```

```ts
import { Sheet, SheetGrid, type GridCellEditor } from 'infinitable/sheet'

let activeInput: HTMLInputElement | null = null

const noteEditor: GridCellEditor = {
  name: 'note',

  open(session) {
    const input = document.createElement('input')
    activeInput = input
    input.type = 'text'
    input.value = String(session.value ?? '')
    Object.assign(input.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      left: `${session.rect.x}px`,
      top: `${session.rect.y}px`,
      width: `${session.rect.width}px`,
      height: `${session.rect.height}px`,
      border: '2px solid #2e6adb',
      outline: 'none',
      padding: '0 8px',
      font: '12px sans-serif',
    })

    session.container.appendChild(input)

    // 滚动时引擎会回调最新矩形，编辑器据此重新定位
    session.onRectChange((rect) => {
      input.style.left = `${rect.x}px`
      input.style.top = `${rect.y}px`
      input.style.width = `${rect.width}px`
      input.style.height = `${rect.height}px`
    })

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        session.commit(input.value)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        session.cancel()
      }
    })

    input.focus()
    input.select()
  },

  close() {
    activeInput?.remove()
    activeInput = null
  },
}

const container = document.querySelector<HTMLDivElement>('#sheet')!
const sheet = new Sheet('editor-demo')
sheet.setCellValue({ row: 0, col: 0 }, 'A1')
sheet.setCellValue({ row: 0, col: 1 }, 'B1')

const grid = new SheetGrid({
  container,
  sheet,
  width: 640,
  height: 320,
  editors: {
    editors: [noteEditor],
    // 第 0 列走 note 编辑器，其余列回落到统一文本编辑器
    route: ({ col }) => (col === 0 ? 'note' : undefined),
  },
  onEditStart: (addr) => {
    console.log('开始编辑', addr)
  },
  onEditEnd: (addr) => {
    console.log('结束编辑', addr)
  },
})

window.addEventListener('beforeunload', () => {
  grid.release()
})
```

几个契约细节：

- 路由名未命中时回落到 `SheetGrid` 的统一文本编辑器。
- `readonly: true` 时 `editors` 被忽略，不进入编辑。
- `session.commit(value)` 走引擎 `table.updateCell`，即模型命令系统，可参与撤销。
- `close()` 必须摘掉自己挂的编辑 UI；机制在提交或取消后调用它。
- `session.rect` 是容器坐标系，容器需要非 `static` 定位。

## 填充柄事件

填充柄交互由引擎负责，填充数据生成不在内核。三个事件分别是：

```ts
// 按下填充柄：range 是柄所在选区段（start/end 可能反向）
table.onFillHandleDown(({ range }) => {
  console.log('填充柄按下', range)
})

// 拖拽结束：anchor 是锚定段的归一化边界，target 是拖拽扫过的目标范围（均为 min/max 序）
table.onFillDragEnd(({ anchor, target }) => {
  const sourceCount = anchor.maxRow - anchor.minRow + 1
  if (target.maxRow <= anchor.maxRow) return

  table.batchUpdate(() => {
    for (let row = anchor.maxRow + 1; row <= target.maxRow; row++) {
      const sourceRow = anchor.minRow + ((row - anchor.maxRow - 1) % sourceCount)
      for (let col = anchor.minCol; col <= anchor.maxCol; col++) {
        table.updateCell(col, row, model.getCellValue(col, sourceRow))
      }
    }
  })
})

// 双击填充柄：Excel 语义是按相邻列连续数据块自动填充，引擎只抛事件
table.onFillHandleDoubleClick(({ range }) => {
  console.log('双击填充柄', range)
})
```

上面的例子只处理纵向填充。横向填充同理：判断 `target.maxCol > anchor.maxCol`，按列步进复制。`target` 已归一化，不需要自己再取 min/max。

## 常见坑

::: warning ListTable 没有自定义编辑 UI 契约
`EditorRegistry.registerEditor(name, {})` 注册的是占位令牌，不是可渲染的编辑器组件。`ListTable` 始终使用内置文本编辑器。需要自定义编辑界面（下拉、日期、富文本等）时，用 `SheetGrid` 的 `editors` + `GridCellEditor`，不要试图在 `ListTable` 上寻找 `open` / `close` 钩子。
:::

- **只声明 `editor` 不注册**：`editor: 'text'` 但注册表没有 `text` 时，`startEdit` 返回 `false`，双击无反应。
- **records 形态忘了 `field`**：没有 `field` 就没有回写目标，即使注册了编辑器也不可编。
- **以为 `resolveEditable` 能隐藏内容**：它只控制能否进入编辑，不影响显示。
- **多行编辑器按 Enter 想换行**：引擎的 Enter 恒为提交并下移。需要多行内换行时，宿主自己接管键位或改用自定义编辑器。
- **编辑中滚动后以为内容丢了**：锚定格滚出视口会按 Enter 语义自动提交，内容已回写；观感上的「丢」是提交后选区下移。
- **用显示值当编辑初值**：`onEditStart` 的 `initialValue` 是基础值口径，未过 `resolveDisplayValue`。
- **`commitEdit()` 没有会话**：返回 `false`，不会抛 `onCellChange`。
- **填充柄事件里没有生成数据**：引擎不内置填充算法，宿主必须在 `onFillDragEnd` / `onFillHandleDoubleClick` 里自行生成并写回。
- **`updateCell` 用在 records 上**：直接返回，不写数据也不刷新。

继续阅读[图表与图片](/examples/chart)了解插件装配，或看[交互与编辑](/guide/interaction-editing)了解选区、键盘和填充柄的完整交互模型。
