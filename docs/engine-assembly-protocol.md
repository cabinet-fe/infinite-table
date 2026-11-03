# 引擎装配协议（@infinitable/protocol）

四类平级引擎（表格 / sheet / 透视 / 甘特）与插件体系的公共装配契约：中立本体 `EngineAssembly`、导出读取面 `EngineReadView`、插件契约 `EnginePlugin` 与三类插件体系。代码入口 `packages/protocol/src/`（engine.ts / plugin.ts / index.ts，共三个源文件）。返回 [architecture.md](./architecture.md)。

## 为什么要有独立契约包

multi-engine 架构下引擎是平级的：table（ListTable）、pivot（PivotGrid）、sheet（SheetGrid），未来还有甘特。契约若住在 `@infinitable/table`，会产生两个问题：

| 问题 | 独立契约包后的解法 |
| --- | --- |
| pivot/sheet/未来引擎实现装配契约必须依赖 table 包 | 协议本体迁入 `@infinitable/protocol`，实现方只依赖类型契约（pivot 依赖 table 是因为它内部消费 table 引擎，不是因为它要实现协议） |
| 不消费 TableEngine 的插件（watermark/print）被迫拖着具体引擎包 | 协议插件只 import `@infinitable/protocol` 的类型即可完成挂载，换引擎（挂 PivotGrid）零改动 |
| 契约类型出现两个家（protocol 与 table 各导出一份） | **协议类型只有一个家**：定义在 protocol，table/infinitable 等公共入口只具名转出维持既有 import 路径 |

协议包的全部成员是既有原语的组合——数据面（TableModel 形态）、渲染宿主（`@infinitable/render` 的 RenderHost 窄接口）、主题（grid 主题投影 token）、生命周期（注册/销毁）、painter 槽位（underlay/overlay 整层绘制）、插件槽位（EnginePlugin 注册路径）——不引入新引擎概念。**纯类型包：零运行时代码**（`package.json` 声明 `sideEffects: false`，dependencies 只有 `@infinitable/grid` 与 `@infinitable/render`），实现由各引擎自行落地（table 引擎即 ListTable）。

协议中立性（G17）：本体不烧进行号列、表头、合并等表格领域概念。透视表等平级引擎走同一装配路径，其表头/分组需求由 table 公共面增量承载（`TableEngine`，见 [list-table-engine.md](./list-table-engine.md)）而非协议特例；合并区只以几何区间语言出现在可选的导出读取面。

### 实现方与消费方一览

| 角色 | 类/接口 | 与协议的关系 |
| --- | --- | --- |
| 契约定义 | `@infinitable/protocol` | 纯类型：`EngineAssembly` / `EngineReadView` / `EnginePlugin` / `UnderlayPainter` / `OverlayPainter` / `CellChangeEvent` |
| table 引擎 | `ListTable implements TableEngine` | 中立本体的 table 实现（`TableEngine extends EngineAssembly`，叠加表格领域操作） |
| 透视引擎 | `PivotGrid implements EngineAssembly` | 内部 `new ListTable` 后以 `TableEngine` 持有，对外转发实现协议（见「pivot 转发面」） |
| sheet 装配 | `SheetGrid` | 经协议消费 table 引擎：内部 ListTable 实例以 `TableEngine` 面持有并传给全部协作模块，见 [sheet.md](./sheet.md) |
| 协议插件 | watermark / print | mount 只收 `EngineAssembly`，任意引擎可挂 |
| 领域面插件 | chart | mount 写 table 引擎的 `chartMediaResolver` 预留位，换引擎即失效 |
| 注册表插件 | 编辑器 / 公式函数 / 媒体解析器 | 经各注册表写入实现，不走 `use()` |

## EngineAssembly 本体解剖

`packages/protocol/src/engine.ts` 定义的 `EngineAssembly`，逐成员（签名与语义均照源码）：

```ts
export interface EngineAssembly {
  // ---- 渲染宿主（画布面） ----
  readonly host: RenderHost

  // ---- 数据面（TableModel 形态） ----
  readonly rowCount: number
  getCellValue(col: number, row: number): unknown
  updateCell(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void

  // ---- 主题 ----
  getTheme(): TableTheme
  updateTheme(override: ThemeOverride): void

  // ---- painter 槽位 ----
  setUnderlayPainter(painter: UnderlayPainter | null): void
  setOverlayPainter(painter: OverlayPainter | null): void

  // ---- 插件槽位 ----
  use(plugin: EnginePlugin): void

  // ---- 生命周期 ----
  destroy(): void

  // ---- 导出读取面（可选能力） ----
  readonly read?: EngineReadView
}
```

| 成员 | 分组 | 语义要点 |
| --- | --- | --- |
| `host` | 渲染宿主 | render 包的窄接口：`createLayer` / `submitInvalidation` / `requestFrame` / `measure` / `resize` / `destroy`。插件经它建层、提交失效、读文本测量，见 [render-engine.md](./render-engine.md) |
| `rowCount` | 数据面 | 数据行数（模型形态动态读取模型 rowCount） |
| `getCellValue(col, row)` | 数据面 | 单元格原始值读取（数据面口径；合并区路由主格） |
| `updateCell(col, row, value)` | 数据面 | 回驱数据源：`TableModel.setCellValue` 对应物，模型形态经绑定回写并刷新派生格 |
| `onCellChange(listener)` | 数据面 | 订阅数据变更（编辑提交回写等），返回退订函数 |
| `getTheme()` / `updateTheme(override)` | 主题 | 当前生效主题读取 / 运行时深覆盖合并更新（不重建装配形状）；图标与提示色经主题 token 承载，协议不内嵌 UI 文案（G20） |
| `setUnderlayPainter(painter \| null)` | painter 槽位 | 内容之下整层绘制预留位，传 null 还原空置 |
| `setOverlayPainter(painter \| null)` | painter 槽位 | 内容之上整层绘制预留位（最顶层），传 null 还原空置 |
| `use(plugin)` | 插件槽位 | 注册即挂载生效，销毁时逆序卸载（不绑定具体事件类型 G2/G21） |
| `destroy()` | 生命周期 | 卸载全部插件、解绑事件、回收渲染资源（幂等） |
| `read?` | 导出读取面 | 可选能力：导出类插件读取引擎有效数据/样式/几何/合并区；不提供导出能力的引擎为 undefined |

数据面扩展位（G11）：数据面成员与 `TableModel` 同形，但「同步返回最终值」不是唯一合法形态——异步/窗口取数模型的兼容写法是「rowCount 兜底 + 按格 hook pull 式供给 + setRowCount 随窗口增长」组合表达窗口语义，新增异步实现类不动装配形状。

## 词汇面：CellChangeEvent 与 painter 槽位

**CellChangeEvent**（协议数据面的变更通知词汇，`oldValue` 在外部模型给不出时为 `undefined`）：

```ts
export interface CellChangeEvent {
  col: number
  row: number
  oldValue: unknown
  newValue: unknown
}
```

table 的 `types.ts` 与公共入口直接转出本类型——协议类型只有一个家，table 侧不重复定义。

**两个 painter 槽位完全对称**，都是「整层绘制回调」，每次整层重绘（painter 变更、容器 resize、整层失效）时以层上下文与视口尺寸调用：

```ts
export type UnderlayPainter = (ctx: RenderContext, viewport: Size) => void
export type OverlayPainter = (ctx: RenderContext, viewport: Size) => void
```

table 引擎的落地实现（`packages/table/src/list-table.ts`）：

| 槽位 | 承载层 | 惰性创建 | 语义 |
| --- | --- | --- | --- |
| `setUnderlayPainter` | ground 层（L0，四层最底，`kind: 'ground'`） | 首个 painter 写入时建层，此前零开销 | 衬底水印等内容之下绘制；被 body 底色遮挡需宿主透明底配合（`TableTheme.underlayBackgroundColor` 缺省 `'#ffffff'`） |
| `setOverlayPainter` | sky 层（L3）root 最顶子节点 | 节点按需建，不新增 canvas 层 | 覆盖在内容之上，任意主题 body 底色（含不透明缺省白）都可见，零宿主配置；挂载后滚动条浮层重置顶（水印在选区/浮动对象之上、滚动条在水印之上） |

实现细节（`GroundPainterNode` / `OverlayPainterNode`）：承载节点 `pickable: false`（pointer 事件透传，不拦截交互）、整层尺寸（层坐标即视口坐标）、`paint` 委托注入的 painter；painter 变更原位换写（节点与树结构复用）并提交对应层 `{ type: 'full' }` 整层失效，下一帧重绘生效。painter 以视口尺寸绘制、内容锚定视口，滚动 band 失效不波及这两层。槽位为**单写方**（同 chartMediaResolver 先例），挂载期由当前插件独占写入——多种顶层内容须合并进一个 painter。

## EngineReadView 导出读取面

G12-G15 的可选能力成员 `read`：导出类插件（print / 图片导出等）读取引擎**有效数据**的窄接口，而非只能拿具体引擎类型。引擎中立——透视/甘特等引擎可按自身几何语义实现或不提供（消费方经 `engine.read` 探测）：

```ts
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
```

| 成员 | 口径 |
| --- | --- |
| `getCellText` | 有效显示文本（经取值管线；被合并覆盖的格取主格文本） |
| `getCellValue` | 原始值（数据面口径，未经显示链） |
| `getCellStyle` | 有效样式（主题分区 token → 列级 → 按格 hook 投影链产物；无样式引擎返回 undefined） |
| `getMergeRanges` | 合并区集合（闭区间几何语言；无合并语义的引擎返回空数组） |

table 引擎恒提供：ListTable 的 `get read()` 直接返回 `this`（本类的 `getCellText` / `getCellValue` / `getCellStyle` / `getMergeRanges` / `getRowHeight` / `getColWidth` 即读取面实现）。宿主快照合成亦可经 render 的 paintTree / 分层面离屏重放——本面供数据语义，render 层供像素语义。

## 插件三分类（重点）

判据出处：`packages/protocol/src/plugin.ts` 文件头注，原文「插件分三类（**挂载点即分类，不另建并行插件系统**）」。`EnginePlugin` 契约本身只有三个成员：

```ts
export interface EnginePlugin {
  readonly name: string
  mount(engine: EngineAssembly): void
  unmount?(engine: EngineAssembly): void
}
```

`mount` 在构造传入（`options.plugins`）或引擎 `use()` 注册时调用，注册即生效；`unmount` 可选，引擎销毁时按注册**逆序**调用。前身是 table 包的 `TablePlugin`，迁出后更名 `EnginePlugin`——挂载参数不变，仍只收 `EngineAssembly`。

### 三分类判据（照 plugin.ts 头注）

| 分类 | 判据（原文摘要） | 挂载方式 | 换引擎 |
| --- | --- | --- | --- |
| 1. 协议插件 | 实现本契约，mount 只收 `EngineAssembly`——任意引擎可挂（watermark / print）。**跨引擎生效是这一类的判据** | `options.plugins` 或任意引擎的 `use()` | 生效（挂 PivotGrid 同样工作） |
| 2. 领域面插件 | 不实现本契约（作为组合模块），消费某引擎领域面（chart 写 table 引擎的 `chartMediaResolver` 预留位）。判据：**挂载依赖特定引擎的领域 API，换引擎即失效** | `options.plugins` / `table.use()`（注册路径复用，但 mount 需要具体引擎） | 失效 |
| 3. 注册表插件 | 经注册表写入实现的扩展（editor-registry 编辑器、公式函数注册表、媒体解析器）。判据：**注册即插拔，机制不换只换实现** | 不走 `use()`：`EditorRegistry.registerEditor` / `registerFormulaFunction` 等 | 与引擎无关（注册表自持） |

### 官方插件归类表

| 插件 | 分类 | 挂载参数 | 依赖面 |
| --- | --- | --- | --- |
| watermark（`createWatermarkPlugin`） | 协议插件 | `EngineAssembly`（只用 `setOverlayPainter`） | import 面零引擎内部 API：只经 `@infinitable/protocol` 契约面 |
| print（`createPrintPlugin`） | 协议插件 | `EngineAssembly`（mount 只记录挂载引擎，经 `engine.read` 供数） | 同上；打印链路 headless，可脱离引擎消费 |
| chart（`createChartPlugin`） | 领域面插件 | `ListTable`（mount 写 `chartMediaResolver` 预留位） | `@infinitable/table` 公共入口（`ListTable` / `CellChartMedia`） |
| 编辑器 | 注册表插件 | 不经 `use()`：`EditorRegistry.registerEditor(name, editor)` | `@infinitable/table` 的 `EditorRegistry` |
| 公式函数 | 注册表插件 | `registerFormulaFunction(name, def)` | `@infinitable/formulas`，见 [formulas.md](./formulas.md) |

注意 chart 的 mount 签名是 `mount(table: ListTable)`——它满足 `EnginePlugin` 的结构形状（EngineAssembly 收窄到子类型 ListTable，结构兼容），但按判据归领域面：挂到不含 `chartMediaResolver` 的引擎上能力即失效。注册表插件不承载于 `@infinitable/plugins`：编辑器随 `@infinitable/table`、公式函数随 `@infinitable/formulas` 的注册表承载。

## 关键链路走读（源码级）

### 1. 水印上屏链（painter → 协议槽位 → 层失效）

```
createWatermarkPlugin({ enabled, text })
  → 构造 options.plugins / engine.use() 注册
  → plugin.mount(engine: EngineAssembly)
  → applyPainter(): engine.setOverlayPainter(painter)          // watermark-plugin.ts
  → ListTable.setOverlayPainter                                // list-table.ts
      首次写入: new OverlayPainterNode(painter) → sky.root.appendChild
               + this.overlay.raiseToTop()   // 滚动条浮层重新置顶
      再次写入: 原位换写 node.painter（节点与树结构复用）
      changed → host.submitInvalidation('sky', { type: 'full' })
  → 下一帧 sky 层重绘 → OverlayPainterNode.paint 委托 painter
  → painter(ctx, viewport) → drawTextWatermark(ctx, current, viewport)
```

晚挂载（`table.use`）一帧内生效；`unmount` 置 `setOverlayPainter(null)`：承载节点摘除 + sky 整层失效清屏，槽位回到空置（层句柄留存，后续写入方复用）。`updateConfig` 整体换配置引用后重走 `applyPainter`，重绘帧读到的是最新配置；同值补丁无操作。

### 2. print 从 EngineAssembly 取数链（engine-source.ts）

print 链路本身 headless（不接线引擎任何挂点）：mount 仅记录 `mountedEngine`，供数解析在 handle 方法调用时进行——

```
createPrintPlugin({}) → plugins 注册 → mount(engine): mountedEngine = engine
plugin.buildDocumentHtml(config)
  → resolveSource()
      options.source 优先（宿主自备 PrintSource）
      否则 mountedEngine?.read 存在 → createEnginePrintSource(mountedEngine)
      两者皆缺 → throw（不静默产出空文档）
  → createEnginePrintSource (engine-source.ts)
      const read = engine.read; 无 read → throw '引擎未提供导出读取面…'
      字段逐项映射:
        rowCount/colCount ← read.rowCount / read.colCount
        rowHeight/colWidth ← read.getRowHeight / read.getColWidth
        merges ← read.getMergeRanges
        cellValue ← read.getCellValue（原始值）
        cellStyle ← read.getCellStyle（有效样式投影）
        displayValue ← read.getCellText（取值管线有效显示文本）
  → paginate / buildPrintDocumentHtml（分页与文档构建，见 [print.md](./print.md)）
```

### 3. chart 构造缝注入链（领域面插件）

```
createChartPlugin({ resolveCellChart }) → plugins / table.use() 注册
  → mount(table: ListTable)
      table.chartMediaResolver = resolveChartMedia        // 写引擎预留位（构造缝）
      table.sceneInitialized 已 true → table.applyGeometryChange()  // 晚挂载补全量重建即时上图
  → 场景装配/刷新调 this.chartMediaResolver?.(masterCol, masterRow)（list-table.ts，
      与 resolveCellImage 同格互斥、图片优先）→ refreshChartCell 落 L2 media 图表格节点
  → resolveChartMedia: parseChartDeclaration(declaration) 解析声明
      + WeakMap 双重校验 memo（声明身份 + 内容 key，内容未变复用同一 media）
  → CellChartMedia { key, produce(size) } → L2 media 层 ChartCellNode
  → produce 离屏出图（renderChartBitmap，Chart.js 按需动态加载）
  → 位图落 cell 级 MediaCache，滚动滚回命中直贴（无闪协议同图片）
  → unmount: table.chartMediaResolver === resolveChartMedia 时置 null（守卫防误清后写方）
```

构造期注册（`options.plugins`）先于首次场景重建挂载，图表格路由参与首帧；`null = 无图表格能力，table 不含图表语义`（图表语义全在插件侧，引擎只认内容 key 与位图生产者）。

### 4. pivot 转发面：watermark 如何挂到 PivotGrid

`packages/pivot/src/pivot-grid.ts` 的 `PivotGrid implements EngineAssembly`——内部 `new ListTable(...)`（引擎唯一构造点）后以 `private readonly table: TableEngine` 持有，对外逐成员转发：

| 协议成员 | PivotGrid 转发实现 |
| --- | --- |
| `host` | `get host() { return this.table.host }` |
| `rowCount` / `getCellValue` | 转发**领域模型** `this.model.rowCount` / `this.model.getCellValue`（聚合矩阵是本层状态机） |
| `updateCell` / `onCellChange` | 转发 `this.table.updateCell` / `this.table.onCellChange` |
| `getTheme` / `updateTheme` | 转发 `this.table` |
| `setUnderlayPainter` / `setOverlayPainter` | 转发 `this.table` |
| `use(plugin)` | 转发 `this.table.use(plugin)` |
| `read` | `get read() { return this.table.read }`（table 恒提供） |
| `destroy()` | 幂等守卫 + 逐 disposers 解绑 + `this.table.destroy()` |

于是 `pivot.use(watermark)`：PivotGrid.use 转发 → ListTable.use → `plugin.mount(listTable)`——watermark 拿到的 `EngineAssembly` 是 ListTable 实例，`setOverlayPainter` 直接落在 table 引擎的 sky 层。插件全程不感知底下是 ListTable：这就是**协议插件跨引擎挂载生效**的机制证明（playground 透视演示区即此形态）。宿主直接调 `pivot.setOverlayPainter(...)` 等协议成员时走 PivotGrid 的转发 getter/方法，同样落到底层引擎。

## 示例集

以下示例逐标识符对照公共导出面（`@infinitable/protocol` / `@infinitable/table` / `@infinitable/plugins` / `@infinitable/pivot` / `@infinitable/formulas` 的 `src/index.ts`），可直接改编运行。

### 示例 1：最小自定义协议插件（overlay 画角标）

`EnginePlugin` 最小形态：mount 写 overlay 槽位、unmount 还原。取材 `agent-docs/guide/plugin-integration.md`（badgePlugin）与 `packages/plugins/tests/watermark/watermark-plugin.test.ts`（晚挂载路径）。

```ts
import { ListTable } from '@infinitable/table'
import type { EnginePlugin, OverlayPainter } from '@infinitable/protocol'

const badgePlugin: EnginePlugin = {
  name: 'corner-badge',
  mount(engine) {
    const paint: OverlayPainter = (ctx, viewport) => {
      ctx.fillStyle = 'rgba(31, 35, 41, 0.6)'
      ctx.fillRect(viewport.width - 140, viewport.height - 28, 140, 28)
      ctx.fillStyle = '#ffffff'
      ctx.font = '12px sans-serif'
      ctx.fillText('infinitable', viewport.width - 128, viewport.height - 10)
    }
    engine.setOverlayPainter(paint) // 协议槽位语言，不触任何具体引擎类型
  },
  unmount(engine) {
    engine.setOverlayPainter(null) // 涉及槽位的插件必须实现 unmount 还原
  },
}

const table = new ListTable({
  width: 400, height: 200,
  columns: [{ title: 'a', width: 140 }],
  rowCount: 100,
  plugins: [badgePlugin],      // 构造期注册：先于首帧场景重建
})
// 或运行时：table.use(badgePlugin)——注册即挂载生效（单测同路径验证）
```

### 示例 2：自定义 UnderlayPainter（衬底绘制）

与 overlay 完全对称，但内容画在 ground 层（四层最底）。**默认主题 body 底色不透明（`underlayBackgroundColor` 缺省 `'#ffffff'`）会遮挡衬底**，须配透明底。取材 `docs/plugin-interface-map.md`（underlay 绘制位条目）与 watermark 测试的 underlay 槽位保留说明。

```ts
import { ListTable } from '@infinitable/table'
import type { EnginePlugin, UnderlayPainter } from '@infinitable/protocol'

const dotGridPlugin: EnginePlugin = {
  name: 'dot-grid',
  mount(engine) {
    const paint: UnderlayPainter = (ctx, viewport) => {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.35)'
      for (let y = 8; y < viewport.height; y += 16) {
        for (let x = 8; x < viewport.width; x += 16) {
          ctx.fillRect(x, y, 1, 1) // 视口锚定衬底点阵，滚动不动
        }
      }
    }
    engine.setUnderlayPainter(paint)
    // ground 恒在最底：body 底色改透明后衬底才可见（主题 token 深覆盖合并）
    engine.updateTheme({ underlayBackgroundColor: 'transparent' })
  },
  unmount(engine) {
    engine.setUnderlayPainter(null)
    engine.updateTheme({ underlayBackgroundColor: '#ffffff' })
  },
}
```

### 示例 3：watermark 挂载 ListTable（构造 + 运行时配置）

取材 `packages/plugins/tests/watermark/watermark-plugin.test.ts` 与 `playground/src/sections/watermark.ts`（`enabled: true, text: 'infinitable 内部资料'`）。

```ts
import { ListTable } from '@infinitable/table'
import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'

const watermark: WatermarkHandle = createWatermarkPlugin({
  enabled: true,
  text: '内部资料',
  // 样式字段可选，WATERMARK_TEXT_DEFAULTS：fontSize 14 / color '#000000' /
  // opacity 0.12 / rotate -30 / gapX 160 / gapY 120（getConfig 返回的完整快照口径）
})

const table = new ListTable({
  width: 660, height: 360,
  columns: [
    { title: '编号', width: 120 },
    { title: '部门', width: 160 },
  ],
  rowCount: 400,
  resolveDisplayValue: (col, row) => (col === 0 ? `NO-${row + 1}` : `部门-${(row % 8) + 1}`),
  plugins: [watermark], // 构造即挂载，sky 层整层失效一帧内上屏
})

watermark.updateConfig({ opacity: 0.45 })  // 任一项变更触发 sky 整层失效；同值补丁无操作
watermark.getConfig()                      // 缺省并入后的完整配置快照（副本）
watermark.isEnabled()                      // => true（config.enabled）
watermark.updateConfig({ enabled: false }) // 开关即时摘除 painter（槽位置 null）
```

### 示例 4：watermark 挂载 PivotGrid（跨引擎挂载）

协议插件的判据场景：同一 `createWatermarkPlugin` 挂到透视引擎，零改动生效。取材 `playground/src/sections/pivot.ts`（`pivot.use(watermark)`）。

```ts
import {
  PivotGrid,
  type PivotDimension,
  type PivotMeasure,
  type PivotRecord,
} from '@infinitable/pivot'
import { createWatermarkPlugin, type WatermarkHandle } from '@infinitable/plugins'

const dimensions: PivotDimension[] = [
  { key: 'status', title: '状态', width: 110 },
  { key: 'priority', title: '优先级', width: 100 },
]
const measures: PivotMeasure[] = [
  { key: 'amount-sum', title: '金额和', field: 'amount', agg: 'sum', width: 130 },
  { key: 'record-count', title: '记录数', field: '', agg: 'count', width: 100 },
]
const records: PivotRecord[] = [
  { status: '已完成', priority: '高', amount: 120 },
  { status: '进行中', priority: '低', amount: 80 },
]

const pivot = new PivotGrid({
  container: document.querySelector<HTMLDivElement>('#pivot')!,
  dimensions,
  measures,
  records,
  rowDimensions: ['status', 'priority'],
  columnDimensions: [],
  activeMeasures: ['amount-sum'],
})
const watermark: WatermarkHandle = createWatermarkPlugin({ enabled: false, text: 'infinitable 透视表' })
pivot.use(watermark) // 经转发面落到内部 ListTable——mount 只收 EngineAssembly，插件不感知
watermark.updateConfig({ enabled: true }) // 一帧内平铺水印覆盖透视内容之上
```

### 示例 5：print 插件经 EngineAssembly 取数挂载

挂载引擎提供 `read` 即可缺省供数，宿主不再自写适配器。取材 `packages/plugins/tests/print/print-plugin.test.ts`（`createEngine`：2 列 3 行 records + 一个合并区）。

```ts
import { ListTable } from '@infinitable/table'
import type { EngineAssembly } from '@infinitable/protocol'
import { createPrintPlugin, type PrintPluginHandle } from '@infinitable/plugins'

const engine: EngineAssembly = new ListTable({
  width: 400, height: 200,
  columns: [
    { field: 'a', title: 'a', width: 100 },
    { field: 'b', title: 'b', width: 120 },
  ],
  records: [
    { a: 'a0', b: 'b0' },
    { a: 'a1', b: 'b1' },
    { a: 'a2', b: 'b2' },
  ],
  rowHeight: 28,
  mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
})

// 无显式 source：handle 方法经挂载引擎的 engine.read 适配供数
const plugin: PrintPluginHandle = createPrintPlugin({
  config: { paperSize: { widthMm: 200, heightMm: 200 }, margin: 0 },
  hooks: { print: (iframe) => console.log('打印文档字节数', iframe.srcdoc.length) },
})
engine.use(plugin)

const pages = plugin.paginate()               // 分页结果（PrintPage[]）
const html = plugin.buildDocumentHtml()       // 完整打印文档 HTML
void plugin.print()                           // 触 DOM：隐藏 iframe → 调起浏览器打印
plugin.openPreview()                          // 触 DOM：预览弹层（返回句柄，close() 清理）

// 也可不挂载、直接手工适配（同一映射，engine-source 公开导出）：
import { createEnginePrintSource } from '@infinitable/plugins'
const source = createEnginePrintSource(engine, { name: '月度报表' })
source.displayValue(0, 1) // 'a1'（取值管线有效显示文本）
source.merges()           // [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }]
// 引擎无 read（如某引擎不提供导出能力）时 createEnginePrintSource 抛错，消费方探测后降级
```

### 示例 6：chart 插件经构造缝注入

领域面插件：声明通道 `resolveCellChart` 按格返回图表声明，能力经 mount 写入 table 引擎 `chartMediaResolver` 预留位。取材 `packages/plugins/tests/chart/chart-plugin.test.ts`（BAR_DECLARATION）。

```ts
import { ListTable } from '@infinitable/table'
import { createChartPlugin } from '@infinitable/plugins'

const chartPlugin = createChartPlugin({
  resolveCellChart: (col, row) =>
    col === 0 && row === 0
      ? { type: 'bar', labels: ['Q1', 'Q2'], datasets: [{ label: '收入', data: [10, 20] }] }
      : undefined, // null/undefined 表示普通格
})

const host = new ListTable({
  width: 400, height: 200,
  columns: [{ field: 'c0' }, { field: 'c1' }],
  plugins: [chartPlugin], // mount 写 chartMediaResolver，参与首帧场景装配
})

chartPlugin.name           // => 'chart'
chartPlugin.getChartSpec(0, 0)?.type // => 'bar'（独立解析声明；非法声明容错为 null）
chartPlugin.getChartSpec(1, 1)       // => null（普通格）
void chartPlugin.loadLibrary()       // 按需加载 Chart.js（首次动态 import，之后共享模块缓存）
// 换引擎即失效：chartPlugin 挂到 PivotGrid 上，mount 内 table.chartMediaResolver 写入
// 的目标不存在领域预留位——这正是领域面插件与协议插件的分界
```

### 示例 7：监听 CellChangeEvent + 用 EngineReadView 读取数据面

数据面双向：`updateCell` 回驱 + `onCellChange` 订阅；导出读取面 `engine.read` 读有效口径。取材协议面定义与 print 测试的读取面断言。

```ts
import { ListTable, SheetModel } from '@infinitable/table'
import type { EngineAssembly } from '@infinitable/protocol'

// 模型形态（TableModel）：updateCell 经 ModelBinding 回写并刷新派生格；
// records 数组形态不建绑定（updateCell 空操作），可写场景用模型直挂
const model = new SheetModel([
  [10, 'a'],
  [20, 'b'],
])

const engine: EngineAssembly = new ListTable({
  width: 400, height: 200,
  columns: [
    { field: 'qty', title: '数量', width: 120 },
    { field: 'name', title: '名称', width: 120 },
  ],
  model,
})

// 数据面写入 → 变更通知（编辑提交回写同源事件）
const off = engine.onCellChange((change) => {
  console.log(change.col, change.row, change.oldValue, '->', change.newValue)
})
engine.updateCell(0, 0, 99) // 记录: 0 0 10 -> 99（回写模型并局部刷新）
off()                       // 退订

// 导出读取面（table 恒提供；跨引擎消费先探测）
const read = engine.read
if (read) {
  read.rowCount                      // 2（动态模型实时反映）
  read.colCount                      // 2
  read.getRowHeight(0)               // 行高（CSS 像素，含逐行覆盖）
  read.getColWidth(0)                // 120
  read.getCellText(0, 0)             // '99'（有效显示文本，经取值管线）
  read.getCellValue(0, 0)            // 99（原始值口径）
  read.getCellStyle(0, 0)?.font      // 有效样式投影链产物
  read.getMergeRanges()              // []（无合并语义返回空数组）
}
```

### 示例 8：注册表插件——自定义公式函数

不走 `use()`，经 formulas 函数注册表写入实现：注册即插拔、机制不换只换实现。取材 `packages/formulas/src/functions/registry.ts`（SUM 注册形态）与 `packages/formulas/src/index.ts` 公开面。

```ts
import {
  formulaError,
  getFormulaFunctionInfo,
  registerFormulaFunction,
} from '@infinitable/formulas'

// 全局注册（名称大小写不敏感、同名覆盖）：minArgs/maxArgs 校验由求值器执行
registerFormulaFunction('DOUBLED', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    description: '数值翻倍',
    category: '数学',
    params: [{ name: 'number' }],
  },
  impl(args) {
    const value = args[0]
    return typeof value === 'number' ? value * 2 : formulaError('#VALUE!')
  },
})

getFormulaFunctionInfo('doubled')?.signature // => 'DOUBLED(number)'（补全/面板共用元数据）
// 供数宿主（如 sheet 的 FormulaEngine）求值 '=DOUBLED(21)' 时经 invokeFormulaFunction 命中
```

### 示例 9：注册表插件——自定义编辑器注册

编辑器注册表随 `@infinitable/table` 承载（实例级注册，无全局闭包泄露坑）。取材 `packages/table/src/editor-registry.ts`。

```ts
import { EditorRegistry, ListTable } from '@infinitable/table'

const registry = new EditorRegistry() // 也可构造 options.editorRegistry 注入
registry.registerEditor('my-editor', { name: 'my-editor' }) // CellEditor：下游实现接口
// 列定义 editor 名或 route hook 命中后由格级路由解析到该编辑器

const table = new ListTable({
  width: 400, height: 200,
  columns: [{ field: 'a', title: 'a', width: 120, editor: 'my-editor' }],
  records: [{ a: 1 }],
  editorRegistry: registry,
})
```

## 测试与验证入口

| 验证面 | 入口 |
| --- | --- |
| 协议插件挂载/卸载/晚挂载/开关 | `packages/plugins/tests/watermark/watermark-plugin.test.ts`（含「脱离引擎实例直接以协议面挂载」用例） |
| print 引擎供数 / fail-fast / read 缺失 | `packages/plugins/tests/print/print-plugin.test.ts` |
| chart 构造缝注入 / use() 注册 | `packages/plugins/tests/chart/chart-plugin.test.ts` |
| 跨引擎挂载（pivot + watermark） | `playground/src/sections/pivot.ts`（`?smoke=1` 冒烟自检含像素断言） |
| pivot 转发面与领域装配 | `packages/pivot/src/pivot-grid.ts` + `packages/pivot/tests/pivot-grid-interaction.test.ts`、`pivot-model.test.ts` |
| 打印版式契约回归 | `packages/plugins/tests/print/page-html.test.ts`（产物结构变更视为 breaking） |
| 测试基础设施 | `packages/plugins/tests/testing/stub-host.ts`（注入式假 RenderHost，记录失效提交供断言） |

单测用注入式 `StubHost implements RenderHost` 构造 ListTable，断言口径是失效提交序列（如 mount 后 `submitted` 恰为 `[{ kind: 'sky', inv: { type: 'full' } }]`）——协议槽位行为不依赖真实像素。

## 边界与红线

- **协议包零运行时纯类型**：`packages/protocol` 只有三个 `.ts` 源文件全部为类型/接口声明，`sideEffects: false`；运行时行为全部由各引擎实现。依赖只有 `@infinitable/grid` 与 `@infinitable/render` 的**类型**——依赖边是类型依赖，不消费 TableEngine。
- **协议类型只有一个家**：定义在 `@infinitable/protocol`，table / plugins / infinitable 公共入口只具名转出维持既有 import 路径（`packages/table/src/index.ts` 的转出注释即此约定），禁止任何包重复定义同名契约。
- **插件包零引擎内部 API**（红线全文见 [plugin-interface-map.md](./plugin-interface-map.md)）：`@infinitable/plugins` 只允许依赖 `@infinitable/table`、`@infinitable/grid` 与 `@infinitable/protocol` 公共入口（`src/index.ts`）显式导出的 API，禁止 import 引擎任何内部模块、`@internal` 成员与未导出符号；自写插件同受此约束。
- **协议本体不烧表格领域概念**（G17）：行号列、表头、合并等只出现在 `TableEngine`（table 公共面增量）；合并区在协议侧只以 `EngineReadView.getMergeRanges()` 的几何区间语言存在。
- **插件槽位不绑定具体事件类型**（G2/G21）：`EnginePlugin.mount` 只收 `EngineAssembly`，事件订阅由各引擎领域面（如 TableEngine 的 `onSelectionChange`）增量承载。
- **painter 槽位单写方**：watermark 与自写 overlay 插件会互相覆盖 painter（后挂载覆盖先挂载），多种顶层内容须合并成一个 painter；`table.use()` 重复注册同一插件对象会挂载两次（引擎不去重）。
- **消费面探测降级**：`engine.read` 是可选能力，消费方须探测（缺失时 `createEnginePrintSource` 抛错，由消费方决定降级路径），不得假定引擎恒提供。

相关文档：[architecture.md](./architecture.md) · [render-engine.md](./render-engine.md) · [grid-kernel.md](./grid-kernel.md) · [list-table-engine.md](./list-table-engine.md) · [pivot-engine.md](./pivot-engine.md) · [sheet.md](./sheet.md) · [formulas.md](./formulas.md) · [print.md](./print.md) · [infinitable-package.md](./infinitable-package.md) · [plugin-interface-map.md](./plugin-interface-map.md)；插件上手指南 `agent-docs/guide/plugin-integration.md` 与 chart/watermark API 参考 `agent-docs/apis/chart-watermark-plugin.md`。
