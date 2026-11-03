---
title: EngineAssembly 引擎装配协议契约
description: "@infinitable/protocol 契约包（纯类型、零运行时）：四类平级引擎（表格/sheet/透视/甘特）装配进宿主的公共路径。含中立本体 EngineAssembly、插件契约 EnginePlugin（协议插件/领域面插件/注册表插件三分类）、可选导出读取面 EngineReadView 与 painter 槽位词汇。"
aliases: [EngineAssembly, EnginePlugin, EngineReadView, 引擎装配协议, 装配协议, 协议插件, Plugin Contract]
keywords: [EngineAssembly, EnginePlugin, EngineReadView, UnderlayPainter, OverlayPainter, CellChangeEvent, mount, unmount, use, setOverlayPainter, setUnderlayPainter, engine.read, 协议插件, 领域面插件, 注册表插件, 插件分类, 跨引擎挂载, 多引擎]
---

# EngineAssembly 引擎装配协议契约

`@infinitable/protocol`（经 `infinitable` 主入口转出同名类型）是引擎装配协议的契约包：纯类型、零运行时代码。任何引擎（表格 / sheet / 透视 / 甘特）装配进宿主的公共路径都由 `EngineAssembly` 描述；插件契约 `EnginePlugin` 的 mount 只收协议面；导出类插件经可选的 `EngineReadView` 读取引擎有效数据。协议类型只有一个家——不消费 TableEngine 的引擎与插件无需依赖 `@infinitable/table`。

## 快速上手

```ts
import type { EngineAssembly, EnginePlugin } from 'infinitable'

// 协议插件：mount 只收 EngineAssembly，任意引擎可挂（ListTable / SheetGrid / PivotGrid）
const loggerPlugin: EnginePlugin = {
  name: 'logger',
  mount(engine: EngineAssembly) {
    console.log(engine.rowCount) // => 数据行数（协议数据面）
  },
  unmount(engine: EngineAssembly) {
    console.log('unmounted', engine === undefined) // => engine 传入卸载时的装配面
  },
}

// ListTable 构造挂载或运行时注册，两者等效
// new ListTable({ ..., plugins: [loggerPlugin] })
// table.use(loggerPlugin)
```

## API 签名

```ts
/** 引擎装配协议（中立本体） */
interface EngineAssembly {
  readonly host: RenderHost
  readonly rowCount: number
  getCellValue(col: number, row: number): unknown
  updateCell(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
  getTheme(): TableTheme
  updateTheme(override: ThemeOverride): void
  setUnderlayPainter(painter: UnderlayPainter | null): void
  setOverlayPainter(painter: OverlayPainter | null): void
  use(plugin: EnginePlugin): void
  destroy(): void
  readonly read?: EngineReadView
}

/** 插件契约（挂载/卸载生命周期） */
interface EnginePlugin {
  readonly name: string
  mount(engine: EngineAssembly): void
  unmount?(engine: EngineAssembly): void
}

/** 导出读取面（可选能力；table 引擎恒提供） */
interface EngineReadView {
  readonly rowCount: number
  readonly colCount: number
  getRowHeight(row: number): number
  getColWidth(col: number): number
  getCellText(col: number, row: number): string
  getCellValue(col: number, row: number): unknown
  getCellStyle(col: number, row: number): CellStyle | undefined
  getMergeRanges(): readonly CellRange[]
}

/** painter 槽位：整层绘制回调（每次整层重绘时以层上下文与视口尺寸调用） */
type UnderlayPainter = (ctx: RenderContext, viewport: Size) => void
type OverlayPainter = (ctx: RenderContext, viewport: Size) => void

/** 数据面变更事件 */
interface CellChangeEvent {
  col: number
  row: number
  oldValue: unknown
  newValue: unknown
}
```

## 参数说明

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `host` | `RenderHost` | — | 是 | 渲染宿主窄接口（`@infinitable/render`）：层创建 / 失效提交 / 帧调度 / 文本测量 |
| `rowCount` | `number` | — | 是 | 模型形态动态读取；窗口取数宿主以兜底行数随窗口增长（`setRowCount`） |
| `use(plugin)` | `EnginePlugin` | — | 是 | 注册即挂载生效；销毁时按注册逆序调用 `unmount` |
| `setUnderlayPainter(painter)` | `UnderlayPainter \| null` | `null` | 否 | 传 `null` 还原空置槽位；单写方约定（挂载期由一个插件独占写入） |
| `setOverlayPainter(painter)` | `OverlayPainter \| null` | `null` | 否 | 同上，与 underlay 完全对称 |
| `read` | `EngineReadView` | 引擎决定 | 否 | 不提供导出能力的引擎为 `undefined`；消费方须探测后再用 |

## 方法与事件

- `onCellChange(listener)`：订阅数据变更（编辑提交回写等），回调收 `CellChangeEvent`（col/row/oldValue/newValue）；返回退订函数。
- `updateTheme(override)`：深覆盖合并，不重建装配形状。
- `destroy()`：幂等；卸载全部插件、解绑事件、回收渲染资源。
- `engine.read`（G12-G15）：导出类插件（print / 图片导出）读取引擎有效数据 / 样式 / 几何 / 合并区的窄接口；合并区以闭区间几何语言（`CellRange[]`）表达，被合并覆盖的格取主格文本。

## 典型示例

### 判别插件三分类（协议插件 / 领域面插件 / 注册表插件）

```ts
import type { EnginePlugin } from 'infinitable'
import { createChartPlugin, createWatermarkPlugin } from 'infinitable'

// 1. 协议插件：实现 EnginePlugin 契约，mount 只收 EngineAssembly——任意引擎可挂。
//    判据：跨引擎生效（watermark 挂 ListTable 或 PivotGrid 都工作）。
const watermark = createWatermarkPlugin({ enabled: true, text: '内部资料' })

// 2. 领域面插件：不靠协议槽位，而是消费特定引擎的领域 API 组合接入
//    （chart 经 ListTableOptions.chartMediaResolver 构造缝注入 table 引擎）。
//    判据：换引擎即失效，类型依赖具体引擎。
const chart = createChartPlugin()

// 3. 注册表插件：经注册表写入实现（editor-registry 编辑器、公式函数注册表、媒体解析器）。
//    判据：注册即插拔，机制不换只换实现。
// registry.registerEditor('my-editor', myEditor)

const _t: EnginePlugin = watermark
const _u: EnginePlugin = chart
```

### 消费引擎读取面做导出

```ts
import type { EngineAssembly } from 'infinitable'

function exportSnapshot(engine: EngineAssembly): string[][] | null {
  const read = engine.read
  if (!read) return null // 引擎不提供导出能力时 read 为 undefined
  const rows: string[][] = []
  for (let r = 0; r < read.rowCount; r++) {
    const line: string[] = []
    for (let c = 0; c < read.colCount; c++) line.push(read.getCellText(c, r))
    rows.push(line)
  }
  return rows
}
```

## 注意事项

> [!WARNING]
> - 本契约与开源库的 plugin API 无对应关系：`EnginePlugin.mount` 只收 `EngineAssembly`，不绑定具体引擎类型与事件类型（G2/G21）——不要在 mount 参数上写 `ListTable` 类型。
> - 协议本体不烧行号列 / 表头 / 合并等表格领域概念（G17 中立性）：表格领域操作在 `TableEngine`（`@infinitable/table`），按需窄化的判据是「插件确实需要引擎领域操作」。
> - `TablePlugin` 已更名 `EnginePlugin`（协议归位重构）：契约成员不变（name / mount / 可选 unmount），import 语句从 `@infinitable/table` 改为 `@infinitable/protocol`（`infinitable` 主入口两者同名导出，路径不变）。
> - `@infinitable/protocol` 是纯类型包（零运行时代码）：没有可 new 的实现，实现方是各引擎（table 引擎即 `ListTable implements TableEngine`）。

## 常见问题

### 自定义插件在 PivotGrid 上挂载不生效？

原因：插件窄化到了 `TableEngine` / `ListTable`（领域面插件只在 table 引擎生效）。修复：协议插件只依赖 `EngineAssembly` 成员（painter 槽位 / 数据面 / 主题 / 生命周期），即可跨引擎挂载：

```ts
import type { EngineAssembly, EnginePlugin } from 'infinitable'

const plugin: EnginePlugin = {
  name: 'cross-engine',
  mount(engine: EngineAssembly) {
    engine.setOverlayPainter((ctx, viewport) => {
      ctx.fillRect(0, 0, viewport.width, viewport.height)
    })
  },
}
```
