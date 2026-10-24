---
title: 电子表格（sheet）
description: infinitable/sheet 的定位与依赖、Sheet/Workbook/CellStore/StylePool/MergeManager/SelectionModel/HistoryManager/CommandRegistry/FormulaEngine 的职责、SheetGrid 适配层、xlsx/csv 导入导出与可编辑电子表格最小示例。
---

# 电子表格（sheet）

`infinitable/sheet` 是电子表格能力入口，转出 `@infinitable/sheet` 的公共 API。它由三块组成：

- **模型**：`Sheet`、`Workbook`、`CellStore`、`StylePool`、`MergeManager`、`SelectionModel`、`FormulaEngine`。
- **命令与历史**：`HistoryManager`、`CommandRegistry`、内置 `XxxCommand`。
- **视图适配**：`SheetGrid`，把 Sheet 模型接到 table 引擎的 `ListTable` 画布。
- **IO**：xlsx / csv 导入导出与快照替换。

它不是插件。旧的 `createSheetPlugin` / `SheetPluginHandle` 已删除，电子表格能力不再放进 `plugins` 数组。完整签名见 [电子表格（sheet）](/api/sheet)。

## 定位与依赖

```ts
import { Sheet, SheetGrid, Workbook } from 'infinitable/sheet'
```

- 发布包 `infinitable` 的主入口不转出 sheet API，必须走 `./sheet` 子路径。
- 仓内对应 workspace 包是 `@infinitable/sheet`；下游用户只从 `infinitable/sheet` 导入。
- 依赖方向：`sheet → table`、`sheet → grid`、`sheet → formulas`。`hucre` 只用于 xlsx 读写，随包依赖，不需要宿主单独安装。
- 不依赖 plugins。图表、水印、打印是官方插件（plugins 包），和 sheet 模型是两套能力。

`Sheet`/`Workbook` 负责数据与命令；`SheetGrid` 负责画布渲染与交互。只要数据面时可以不创建 `SheetGrid`。

## 模型层职责

| 组件              | 职责                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `Workbook`        | 多表簿：sheet 列表、激活表、共享公式引擎、增删改名、批量事件抑制                                   |
| `Sheet`           | 单表门面：值、公式、样式、合并、冻结、行列尺寸、结构变更、图片、超链接、Cell Meta、快照、事件      |
| `CellStore`       | 稀疏单元格存储：行 → 列 → `CellData`；维护有数据的高水位行列数；支持区域迭代与结构平移             |
| `StylePool`       | 样式池：按内容去重，单元格只存 `StyleId`；相同样式共享一份定义                                     |
| `MergeManager`    | 合并区：合并范围、覆盖索引、`resolveAnchor`、`getCellInfo`；结构变更时平移合并区                   |
| `SelectionModel`  | 选区：活动格与多段范围；写入前经合并区解析锚点；变化发 `selection-change`                          |
| `HistoryManager`  | 撤销/重做栈：一个单元 = 一条命令或一次事务的 mutation；默认容量 200；支持嵌套事务                  |
| `CommandRegistry` | 命令表：`id → handler`；默认注册表承载内置命令；重复 `id` 注册抛错                                 |
| `FormulaEngine`   | 公式门面：组合 formulas 的 `DependencyGraph` 与 `evaluate`，负责图簿联动、增量重算、`#CYCLE!` 护栏 |

### Sheet

坐标是 0 基 `CellAddress`：`{ row: 0, col: 0 }` 即 A1。区域是闭区间 `CellRange`：`{ start, end }`。

```ts
import { Sheet } from 'infinitable/sheet'

const sheet = new Sheet('Sheet1')

sheet.setCellValue({ row: 0, col: 0 }, '销售额')
sheet.setCellValue({ row: 1, col: 0 }, 1200)
sheet.setCellValue({ row: 1, col: 1 }, '=A2*2') // '=' 前缀自动转公式

console.log(sheet.getDisplayValue({ row: 1, col: 1 })) // => 2400
console.log(sheet.getCellData({ row: 1, col: 1 })?.f) // => 'A2*2'（不含 '='）
```

关键语义：

- `setCellValue` 识别 `=` 前缀并转 `setCellFormula`；空值清除值但保留样式。
- `setCellFormula` 接受可选的 `=` 前缀；公式原文存在 `CellData.f`，不带 `=`；解析失败记 `#ERROR!`。
- `getCellData` 是原始存储语义：被合并覆盖的非锚点格返回 `undefined`。
- `getDisplayValue` 是锚点解析语义：公式格返回计算缓存，被覆盖格返回锚点值。
- 一切写操作（值、公式、样式、合并、图片、超链接、Cell Meta、结构）都经命令系统执行，进入撤销栈。
- 不进撤销栈：冻结、行列尺寸、默认行列尺寸、选区、`restore()` 全量灌回。
- `sheet.rows` / `sheet.cols` 是渲染尺寸；`rowCount` / `colCount` 是有数据的高水位。`rows = 0` 表示尚未声明，`SheetGrid` 构造时会声明。
- 行列插入/删除会平移数据、合并、尺寸、图片，并用 formulas 的 `shiftFormulaText` 改写公式引用。

样式部分合并写入：

```ts
sheet.setCellStyle(
  { start: { row: 0, col: 0 }, end: { row: 0, col: 3 } },
  {
    font: { bold: true, size: 14 },
    fill: { color: '#eef2f7' },
    align: { horizontal: 'center' },
  },
)
```

`setCellStyle` 是部分合并语义：只给 `fill` 不会清掉已有 `border`。`getEffectiveStyle` 按列 → 行 → 格的字段级叠加顺序取得生效样式。

合并与冻结：

```ts
sheet.mergeCells({
  start: { row: 0, col: 0 },
  end: { row: 0, col: 3 },
}) // 返回最终生效区域（相交合并取包围盒）

sheet.setFrozen(2, 0) // 冻结顶部 2 行、左侧 0 列；不进 undo
sheet.setColWidth(0, 140) // px；不进 undo
sheet.setRowHeight(0, 36) // px；≤ 0 清除
```

合并规则同 Excel：只保留包围盒内按行主序第一个有值格的值，其余覆盖格清空。

选区：

```ts
sheet.selectCell({ row: 2, col: 1 })
sheet.selectRange({
  start: { row: 2, col: 1 },
  end: { row: 4, col: 3 },
})
console.log(sheet.getSelection()) // { activeCell, ranges }
```

Sheet 事件通过 `sheet.on(type, handler)` 订阅，返回退订函数：

| 事件                | 载荷                    | 触发                                 |
| ------------------- | ----------------------- | ------------------------------------ |
| `cell-change`       | `{ addr }`              | 单格数据变化（含清除）               |
| `merge-change`      | `{ range }`             | 合并 / 取消合并                      |
| `selection-change`  | `SelectionState`        | 选区变化                             |
| `history-change`    | `{ canUndo, canRedo }`  | 撤销栈变化                           |
| `frozen-change`     | `FrozenState`           | 冻结变化                             |
| `structure-change`  | `StructureChange`       | 行列插入 / 删除                      |
| `content-reset`     | `undefined`             | 整表内容替换（导入、undo/redo 回放） |
| `image-change`      | `{ id? }`               | 浮动图变化；无 id 表示整表替换       |
| `meta-change`       | `{ addr?, namespace? }` | Cell Meta 变化                       |
| `cell-image-change` | `{ addr? }`             | 按格嵌入图变化                       |
| `axis-style-change` | `{ axis, index }`       | 行/列默认样式变化                    |

快照：

```ts
const snapshot = sheet.snapshot() // JSON 可序列化
sheet.restore(snapshot) // 替换语义；冻结变化会发 frozen-change
```

快照包含单元格、样式池、合并、冻结、尺寸、行高/列宽、行/列默认样式、浮动图、Cell Meta 与选区。`restore` 是整体替换，不是命令，不进撤销栈。

### Workbook

```ts
import { Workbook } from 'infinitable/sheet'

const workbook = new Workbook() // 自带一个空的 Sheet1
const detail = workbook.addSheet('明细')

detail.setCellValue({ row: 0, col: 0 }, '=SUM(Sheet1!B2:B4)')
console.log(workbook.activeSheet.name) // => 'Sheet1'

workbook.activateSheet('明细')
workbook.renameSheet('Sheet1', '汇总') // 跨表引用跟随改名
workbook.removeSheet('明细') // 至少保留一个；引用方变 #REF!（不入 undo）
```

- 所有 Sheet 共享 `workbook.formulaGraph`，跨表引用才能在同一个依赖图中联动。
- `renameSheet` 不改写公式原文，而是建立旧名 → 新名的别名链；依赖边同步重排。
- `removeSheet` 先取 `affectedBySheet` 的引用方，注销后立即重算为 `#REF!`，这批派生补丁不进撤销栈。
- `addSheet(name?, options?)` 支持 `options.data` 二维数组与 `options.rows/cols`；初始数据一次命令写入后清空历史，视为模板基线。
- `beginBatch()` / `endBatch()` 抑制批量结构变更期间的事件风暴，结束时合并补发。

Workbook 事件：`active-sheet-change`、`sheets-change`、`sheet-rename`。

## 命令与撤销栈

内置命令注册在 `defaultCommandRegistry`，覆盖值、公式、结构、样式、合并、图片、Cell Meta、链接、嵌入图等写路径。`Sheet` 的常用方法只是命令的薄封装。

```ts
import { defaultCommandRegistry } from 'infinitable/sheet'

console.log(defaultCommandRegistry.get('sheet.command.set-cell-value')?.id)
// => 'sheet.command.set-cell-value'

sheet.executeCommand('sheet.command.set-cell-value', {
  items: [{ addr: { row: 2, col: 1 }, data: { v: 1800, t: 'n' } }],
})
```

事务把多条命令合并成一个撤销单元：

```ts
sheet.beginTransaction()
try {
  sheet.setCellValue({ row: 2, col: 0 }, '二月')
  sheet.setCellValue({ row: 2, col: 1 }, 1500)
  sheet.setCellValue({ row: 2, col: 2 }, 900)
  sheet.commit()
} catch (error) {
  sheet.rollback()
  throw error
}

sheet.undo() // => true，整组回退
sheet.redo() // => true，整组重做
console.log(sheet.canUndo, sheet.canRedo)
```

事务支持嵌套，拍平到最外层；`rollback` 逆序回放缓冲区并结束事务，不动 undo/redo 栈。新命令入栈会清空 redo 栈。

自定义命令：

```ts
import {
  cellDataEqual,
  defaultCommandRegistry,
  inferCellType,
  type CellAddress,
  type CellData,
  type CellPatch,
  type Command,
} from 'infinitable/sheet'

const stampCommand: Command<{ addr: CellAddress; value: string | number }> = {
  id: 'app.stamp',
  handler(ctx, { addr, value }) {
    const target = ctx.sheet.merges.resolveAnchor(addr)
    const before = ctx.sheet.store.getCell(target)
    const type = inferCellType(value)
    const after: CellData = { v: value, ...(type ? { t: type } : {}) }
    if (cellDataEqual(before, after)) return { mutations: [] }

    const patch: CellPatch = { kind: 'cell', addr: target, before, after }
    ctx.applyPatch(patch, 'redo')
    return { mutations: [{ redo: [patch], undo: [patch] }] }
  },
}

defaultCommandRegistry.register(stampCommand)
sheet.executeCommand('app.stamp', { addr: { row: 3, col: 2 }, value: '已审核' })
sheet.undo() // 回到写入前
```

约束：

- 命令 `id` 重复注册会抛错。
- `CommandResult.mutations` 为空数组时不入历史。
- 命令 handler 通过 `ctx.applyPatch(patch, 'redo')` 应用变更；`HistoryManager` 回放时走同一通道。
- 自定义命令注册是模块级全局的；执行时使用 `sheet.executeCommand(id, params)`。
- 公式重算产生的派生 mutation 会由 `Sheet.executeCommand` 自动追加进同一个撤销单元。

## SheetGrid：Sheet 到 ListTable 的适配

`SheetGrid` 不做第二套渲染。它构造 `ListTable`，把 Sheet 模型适配成 table 引擎的 `TableModel`，再用引擎的公开 hook 同步显示值、样式、选区、冻结、合并、图片和链接。

### 构造参数

```ts
const grid = new SheetGrid({
  container, // 必填；静态定位会被归一为 relative
  sheet, // 必填；冻结/合并/尺寸在构造期读取
  rows: 8, // 可选；显式声明初始尺寸（是否继续增长由 growOnScroll 决定）
  cols: 4,
  width: 528, // 可选；缺省测量容器，未布局回落 960×420
  height: 320,
  readonly: false,
  showRowHeader: true,
  showColHeader: true,
  scrollbar: true, // 或 { mode: 'native' }
  theme: {},
  growOnScroll: true,
})
```

主要选项：

| 选项                              | 类型                                           | 默认     | 说明                                                                   |
| --------------------------------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `container`                       | `HTMLElement`                                  | 必填     | 挂载容器                                                               |
| `sheet`                           | `Sheet`                                        | 必填     | 数据模型                                                               |
| `rows` / `cols`                   | `number`                                       | 自动     | 显式声明初始尺寸；不声明按「可视 + 缓冲」给足                          |
| `width` / `height`                | `number`                                       | 测量容器 | 表视口 CSS 像素                                                        |
| `readonly`                        | `boolean`                                      | `false`  | true 不注册编辑器、禁填充柄与行列拖改，并关闭撤销/重做与图片删除快捷键 |
| `showRowHeader` / `showColHeader` | `boolean`                                      | `true`   | 行号列 / 列字母表头                                                    |
| `scrollbar`                       | `boolean \| ScrollbarOptions`                  | `true`   | `mode: 'native'` 切浏览器原生滚动条                                    |
| `theme`                           | `ThemeOverride`                                | —        | 覆盖内置 `SHEET_GRID_THEME` 的深合并                                   |
| `growOnScroll`                    | `boolean`                                      | `true`   | 滚动近端动态扩容；false 为固定网格                                     |
| `dpr`                             | `number`                                       | 环境 DPR | 锁定出图设备像素比（截图/像素断言）                                    |
| `openCellLinkOnClick`             | `boolean`                                      | `true`   | 链接格单击默认打开                                                     |
| `editorInsideBorder`              | `boolean`                                      | `false`  | 编辑浮层内缩到格边框内                                                 |
| `colResize`                       | `boolean`                                      | `false`  | readonly 下单独放开列宽拖拽                                            |
| `header`                          | `SheetGridHeaderOptions`                       | —        | 列头标题与自定义 DOM 表头                                              |
| `editors`                         | `SheetGridEditorsOptions`                      | —        | 类型化编辑器注册与按格路由                                             |
| `resolveDisplayValue`             | `(addr, base) => CellValue \| undefined`       | —        | 显示值覆盖                                                             |
| `resolveCellStyle`                | `(addr, baseStyle?) => CellStyle \| undefined` | —        | 样式覆盖                                                               |
| `resolveCellRenderer`             | `(addr, base) => CellRenderer \| undefined`    | —        | 按格接管渲染                                                           |
| `interceptSelection`              | `(meta?) => boolean`                           | —        | 返回 true 拦截选区手势                                                 |
| `onSelectionIntercept`            | `(range, meta) => void`                        | —        | 被拦截的选区回交宿主                                                   |
| `onContextMenu`                   | `(info) => void`                               | —        | 右键菜单                                                               |
| `onEditStart` / `onEditEnd`       | `(addr) => void`                               | —        | 编辑会话开始/结束                                                      |
| `onColResizeEnd`                  | `({ col, width }) => void`                     | —        | 列宽拖拽落定                                                           |

### 数据绑定

构造时 `SheetGrid` 执行 `model: createSheetTableModel(sheet)`：

- `rowCount` 是动态 getter，读 `sheet.rows`。
- `getCellValue` 返回编辑基础值：公式格返回 `'=' + f` 原文，其余返回存储值 `v`。
- `setCellValue` 委托 `sheet.setCellValue`；写入经过 Sheet 命令系统，因此可撤销，`=` 前缀仍走公式。
- `onCellChange` 转发 Sheet 的 `cell-change`，引擎 `ModelBinding` 据此局部刷新；引擎回写产生的 echo 被吞掉，避免回环。

显示链是 pull 式的，每次格渲染时拉取：

- `resolveDisplayValue`：公式格取 `sheet.getDisplayValue`（计算缓存），数字按有效样式 `numFmt` 格式化，最后叠加宿主 hook。
- `resolveCellStyle`：`sheet.getEffectiveStyle`（列 → 行 → 格）叠加宿主 hook，再映射成 grid 的 `CellStyle`。
- `resolveCellImage` / `resolveCellLink`：SheetGrid 内部无条件接入，模型里有嵌入图或链接就渲染，不需要宿主传 hook。

合并格由引擎路由到主格；Sheet 侧 `getCellData` 对被覆盖格返回 `undefined`，`getDisplayValue` 返回锚点值。

### 编辑器

- 默认为统一文本编辑器 `SHEET_TEXT_EDITOR`（注册名 `'sheet-text'`），`editorMaxLength: 50000`。
- `readonly: true` 时不注册编辑器。
- 自定义编辑器通过 `editors` 传入：

```ts
const grid = new SheetGrid({
  container,
  sheet,
  editors: {
    editors: [myEditor],
    route: (addr) => (addr.col === 1 ? 'number' : undefined),
  },
  onEditStart: (addr) => console.log('edit start', addr),
  onEditEnd: (addr) => console.log('edit end', addr),
})
```

`GridCellEditor` 契约：

```ts
interface GridCellEditor {
  readonly name: string
  open(session: GridEditorSession): void
  close(): void
}

interface GridEditorSession {
  addr: CellAddress
  container: HTMLElement
  rect: { x: number; y: number; width: number; height: number }
  value: CellValue | undefined // 公式格为 '=' + f
  commit(value: CellValue): void // 经命令系统写模型，可撤销
  cancel(): void
  onRectChange(listener: (rect: GridEditorRect) => void): void
}
```

路由命中自定义编辑器时，`SheetGrid` 取消引擎的文本会话并打开宿主编辑器；提交走 `table.updateCell` → `TableModel.setCellValue` → `sheet.setCellValue`。滚动帧会通过 `onRectChange` 更新锚定矩形，格滚出视口时自动取消会话。

::: details 一个最小自定义编辑器
```ts
import type { GridCellEditor } from 'infinitable/sheet'

function createUppercaseEditor(): GridCellEditor {
  let input: HTMLInputElement | null = null

  return {
    name: 'uppercase',
    open(session) {
      const element = document.createElement('input')
      element.value = String(session.value ?? '')
      Object.assign(element.style, {
        position: 'absolute',
        left: `${session.rect.x}px`,
        top: `${session.rect.y}px`,
        width: `${session.rect.width}px`,
        height: `${session.rect.height}px`,
        boxSizing: 'border-box',
      })
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') session.commit(element.value.toUpperCase())
        if (event.key === 'Escape') session.cancel()
      })
      session.onRectChange((rect) => {
        element.style.left = `${rect.x}px`
        element.style.top = `${rect.y}px`
        element.style.width = `${rect.width}px`
        element.style.height = `${rect.height}px`
      })
      session.container.appendChild(element)
      element.focus()
      input = element
    },
    close() {
      input?.remove()
      input = null
    },
  }
}
```
:::

### 右键菜单

`onContextMenu` 收到客户端坐标与落点区域：

```ts
interface SheetGridContextMenuInfo {
  x: number
  y: number
  kind: 'body' | 'row-header' | 'col-header'
  addr: CellAddress | null
  row?: number
  col?: number
}
```

`body` 格的 `addr` 是模型地址；行号列与列头的 `addr` 为 `null`，分别给 `row` / `col`。角点归 `body` 且 `addr` 为 `null`，保持当前选区。

### 选区拦截

`interceptSelection` 用于公式引用拾取：返回 true 时，画布选区不写模型，而是通过 `onSelectionIntercept(range, meta)` 回交宿主。`meta.shiftKey` 表示手势携带 Shift，`meta.extend` 表示是对上次拾取段的扩展。

```ts
let picking = false

const grid = new SheetGrid({
  container,
  sheet,
  interceptSelection: () => picking,
  onSelectionIntercept: (range, meta) => {
    // 把 range 追加/替换到公式文本；meta.extend 时替换上次插入的引用
    console.log(range, meta)
  },
})

// 进入引用拾取模式；视觉反馈用 SheetGrid 的公开方法
picking = true
grid.setSelectionAnchor({ row: 0, col: 0 })
grid.setHighlightRanges([
  { range: { start: { row: 0, col: 0 }, end: { row: 2, col: 0 } }, color: '#2563eb' },
])
```

指针手势期间只记录最新范围，抬起后一次性回交；非手势选区（键盘、程序化 `selectCells`）即时拦截。`setSelectionAnchor` 与 `setHighlightRanges` 都是纯视图态，不写模型。

### 实例方法与结构变更

```ts
grid.getTable() // 底层 ListTable
grid.hitTestSheetAddr(x, y) // 容器内坐标 → 模型地址
grid.updateTheme({}) // 运行时换肤，不重建网格
grid.setVisible(false) // LRU 可见性：隐藏只置脏
grid.applyAxisSizes('row', [2, 3]) // 模型尺寸覆盖即时落到引擎
grid.setCellLink(addr, { url: 'https://example.com' })
grid.insertCellImage(addr, { src: 'data:image/png;base64,...' })
grid.release() // 销毁
```

行列插入/删除会发 `structure-change`，但引擎维度在构造期固定，`SheetGrid` 不会自动重建：

```ts
let grid: SheetGrid | undefined

function mount(): void {
  grid?.release()
  grid = new SheetGrid({ container, sheet, width: 720, height: 400 })
}

mount()
sheet.on('structure-change', () => mount())
```

`on('structure-change')` 通知后重新创建实例，模型里的冻结、合并、尺寸、选区会在构造期重新读取。

## 导入导出

```ts
import {
  Sheet,
  exportSheetCsv,
  exportSheetXlsx,
  exportWorkbookXlsx,
  importCsv,
  importXlsx,
} from 'infinitable/sheet'

// xlsx → 新工作簿
const buffer = await file.arrayBuffer()
const workbook = await importXlsx(buffer, (done, total) => {
  console.log(`${done}/${total}`)
})

// 工作簿 → xlsx ZIP 字节
const bytes = await exportWorkbookXlsx(workbook)
void bytes

// 单表 → xlsx
const sheetBytes = await exportSheetXlsx(workbook.activeSheet, { fallbackName: 'Sheet' })
void sheetBytes

// CSV：导出带 UTF-8 BOM；公式格导出计算缓存，合并覆盖格为空
const csv = exportSheetCsv(workbook.activeSheet)

// CSV → 既有 Sheet（从 A1 起覆盖，事务包裹 = 单 undo 单元）
const target = new Sheet('csv-target')
importCsv(csv, target)
target.undo() // => true
```

IO 语义：

- `importXlsx` 支持多 sheet、值、公式、合并、样式、冻结、行高、列宽与浮动图；每个 sheet 的数据写入是其自身历史栈上的单 undo 单元。
- `exportWorkbookXlsx` / `exportSheetXlsx` 导出值、公式、合并、样式、冻结、行列尺寸与浮动图；合并覆盖格会按有效样式物化，保证 Excel 端边框完整。
- `exportSheetCsv` 从 A1 到最后一个真实格，带 BOM；合并覆盖格输出空，公式格输出缓存值。
- `importCsv` 从 A1 覆盖写入；空格不覆盖既有格，空串清除目标格；日期转 1900 系序列数。
- `replaceWorkbookWithSnapshots(target, snapshots, activeIndex)` 用于 worker 导入链路，按快照数组整簿替换。

## 从零创建可编辑电子表格

```html
<div id="grid" style="width: 528px; height: 320px"></div>
<button id="undo">撤销</button>
<button id="redo">重做</button>
```

```ts
import { Sheet, SheetGrid } from 'infinitable/sheet'

const sheet = new Sheet('Sheet1')

// 标题行（先写值再合并：合并只保留包围盒内第一个有值格）
sheet.setCellValue({ row: 0, col: 0 }, '季度销售')
sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 0, col: 3 } })
sheet.setCellStyle(
  { start: { row: 0, col: 0 }, end: { row: 0, col: 3 } },
  {
    font: { bold: true, size: 16 },
    align: { horizontal: 'center' },
    fill: { color: '#eef2f7' },
  },
)

// 表头
const headers = ['月份', '销售额', '成本', '毛利']
headers.forEach((text, col) => sheet.setCellValue({ row: 1, col }, text))
sheet.setCellStyle({ start: { row: 1, col: 0 }, end: { row: 1, col: 3 } }, { font: { bold: true } })

// 数据行：毛利列使用公式
const data = [
  ['一月', 1200, 800],
  ['二月', 1500, 900],
  ['三月', 1800, 1000],
] as const

data.forEach(([month, sales, cost], index) => {
  const row = index + 2
  sheet.setCellValue({ row, col: 0 }, month)
  sheet.setCellValue({ row, col: 1 }, sales)
  sheet.setCellValue({ row, col: 2 }, cost)
  sheet.setCellValue({ row, col: 3 }, `=B${row + 1}-C${row + 1}`)
})

// 合计行
sheet.setCellValue({ row: 5, col: 0 }, '合计')
sheet.setCellValue({ row: 5, col: 1 }, '=SUM(B3:B5)')
sheet.setCellValue({ row: 5, col: 2 }, '=SUM(C3:C5)')
sheet.setCellValue({ row: 5, col: 3 }, '=SUM(D3:D5)')
sheet.setCellStyle({ start: { row: 5, col: 0 }, end: { row: 5, col: 3 } }, { font: { bold: true } })

// 列宽与冻结（不进 undo）
sheet.setColWidth(0, 120)
sheet.setColWidth(1, 120)
sheet.setColWidth(2, 120)
sheet.setColWidth(3, 120)
sheet.setFrozen(2, 0)

// 初始装配视为基线，清空历史；之后用户编辑才进入撤销栈
sheet.history.clear()

const container = document.querySelector<HTMLDivElement>('#grid')!
const grid = new SheetGrid({
  container,
  sheet,
  rows: 8,
  cols: 4,
  width: 528,
  height: 320,
  growOnScroll: false, // 固定 8×4 网格
})

const undo = document.querySelector<HTMLButtonElement>('#undo')!
const redo = document.querySelector<HTMLButtonElement>('#redo')!

undo.addEventListener('click', () => sheet.undo())
redo.addEventListener('click', () => sheet.redo())
undo.disabled = !sheet.canUndo
redo.disabled = !sheet.canRedo
sheet.on('history-change', ({ canUndo, canRedo }) => {
  undo.disabled = !canUndo
  redo.disabled = !canRedo
})

window.addEventListener('beforeunload', () => grid.release())
```

这个实例默认就是可编辑的：双击或按 Enter 进入文本编辑，提交后经命令系统写回 Sheet；公式格显示计算结果，进入编辑时显示 `=原文`。选区、填充柄、列宽/行高拖拽、冻结、合并、撤销/重做都由 SheetGrid 与引擎内置。

## 常见问题

### 插入行/列后表格尺寸没有变化

`SheetGrid` 的引擎维度在构造期固定，行列数变化不会自动重建。订阅 `structure-change`，销毁旧实例并重新 `new SheetGrid`。

### undo 之后冻结、行高没有还原

冻结、行列尺寸、默认行列尺寸、选区、`restore()` 按约定不进撤销栈。需要整体回退时用快照：操作前 `sheet.snapshot()`，需要时 `sheet.restore(snapshot)`。

### 公式格显示 `#ERROR!` / `#CYCLE!` / `#REF!`

- `#ERROR!`：公式解析失败，或求值期未预期异常被适配层兜底。
- `#CYCLE!`：`FormulaEngine` 的在途栈检测到循环引用；环上格记该错误，环外格传播错误。
- `#REF!`：公式引用的表被删除，或 resolver 无法解析目标表。

### CSV 导入后空单元格没有清空

`importCsv` 的空格（未出现的字段）不覆盖既有格；要清空某个格，导入文本中对应位置应是空串。公式格导出的是计算缓存值，不是公式原文。
