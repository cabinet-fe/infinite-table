---
title: 插件开发
description: TablePlugin 契约、构造 plugins 与 table.use 的差异、chart/watermark/print 官方插件挂载方式，以及 setUnderlayPainter/setOverlayPainter 扩展点与最小自定义插件。
---

# 插件开发

infinitable 的插件是普通对象，不继承基类、不访问引擎内部模块。插件通过 `mount(engine)` 拿到 `EngineAssembly` 装配协议面，向公开的渲染预留位、事件与实例方法接线；引擎销毁时按注册逆序调用 `unmount(engine)` 回收。

挂载参数是协议面而不是 `ListTable` 具体类型：`ListTable`、`SheetGrid` 装配与 pivot 引擎 `PivotGrid` 等平级引擎都实现 `EngineAssembly`，只依赖协议面的插件可跨引擎挂载（水印、打印即如此）。需要表格领域能力（如 `chartMediaResolver`、`floatObjects`）的插件把参数收窄为 `ListTable`（实现 `TableEngine` 协议面），此时插件只在表格引擎上生效。

官方插件（chart / watermark / print）本身就是 `TablePlugin` 的实现，因此官方能力与自写插件走同一套注册路径。完整签名见 [插件（plugins）](/api/plugins)。

## 契约与生命周期

`TablePlugin` 只有三个成员，方法名是 `mount` / `unmount`，不是 `install` / `uninstall`：

```ts
import type { EngineAssembly } from 'infinitable'

interface TablePlugin {
  readonly name: string
  /** 挂载：构造传入或引擎 use() 注册时立即调用；参数为引擎装配协议面 */
  mount(engine: EngineAssembly): void
  /** 卸载：引擎销毁时按注册逆序调用 */
  unmount?(engine: EngineAssembly): void
}
```

`EngineAssembly` 的成员就是协议装配路径的全部：渲染宿主 `host`、数据面（`rowCount` / `getCellValue` / `updateCell` / `onCellChange`）、主题（`getTheme` / `updateTheme`）、painter 槽位（`setUnderlayPainter` / `setOverlayPainter`）、插件槽位（`use`）、生命周期（`destroy`）与可选的导出读取面 `read`。协议面不包含选区、编辑、表头等表格领域操作——那些在各引擎自己的领域面上（表格引擎为 `TableEngine`）。

生命周期顺序：

1. `new ListTable(options)`：构造过程中按 `options.plugins` 数组顺序逐个调用 `use(plugin)`。
2. 每个 `use` 立即执行 `plugin.mount(engine)`。构造期注册发生在首次场景重建之前，渲染接线能参与首帧。
3. 构造完成，场景重建，首帧上屏。
4. 运行期调用 `table.use(plugin)`：同样立即 `mount`，没有单独的“初始化”阶段。
5. `table.destroy()`：从插件列表尾部向前逐个调用 `unmount`，然后清理场景与画布。

`unmount` 是可选成员，但只要插件写过渲染预留位、订阅过事件或持有外部资源，就必须实现；否则下一次挂载或表格销毁后会残留旧 painter / 旧订阅。

## 两种注册路径

### 构造时传入 plugins

```ts
import { ListTable, type TablePlugin } from 'infinitable'

const plugin: TablePlugin = {
  name: 'my-plugin',
  mount(engine) {
    // 写入预留位 / 订阅事件
  },
  unmount(engine) {
    // 还原预留位 / 退订事件
  },
}

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 640,
  height: 360,
  columns: [{ title: '名称', width: 200 }],
  rowCount: 20,
  resolveDisplayValue: (_col, row) => `行 ${row}`,
  plugins: [plugin],
  hostOptions: { container },
})
```

`ListTableOptions.plugins` 的类型是 `readonly TablePlugin[]`。插件在 `rebuildScene` 之前挂载，适合依赖场景装配的渲染接线。

### 运行时 table.use

```ts
table.use(plugin) // 立即 mount；返回 void
```

`use` 只做两件事：把插件对象追加进内部数组，然后调用 `mount`。它不会去重：同一个插件对象注册两次就会 `mount` 两次。也没有公开的单插件移除方法；要更换整套插件，销毁并重建表格。

两种路径的差异：

| 维度         | 构造时 `plugins`   | 运行时 `table.use()`       |
| ------------ | ------------------ | -------------------------- |
| 挂载时机     | 首次场景重建之前   | 调用 `use` 的当下          |
| 首帧渲染接线 | 参与首帧           | 需要插件自己触发刷新或重建 |
| 卸载         | `destroy()` 时逆序 | 同样在 `destroy()` 时逆序  |
| 重复注册     | 不去重             | 不去重                     |

运行时挂载能否即时生效，取决于插件写入的扩展点：

- `setUnderlayPainter` / `setOverlayPainter` 写入后会提交对应层的整层失效，下一帧自动重绘，不需要插件做额外重建。
- 依赖场景装配的接线（例如格内图表解析器）需要触发一次全量重建。官方 chart 插件把挂载参数收窄为 `ListTable`，在 `mount` 内检查 `table.sceneInitialized`，已初始化时走引擎的全量几何重建路径；这是官方插件对引擎预留位的接线，不属于宿主自定义插件的公开契约。
- 只订阅事件、不参与绘制的插件，`use` 后立即生效。

## 官方插件挂载

三个插件都实现 `TablePlugin`，都能放进 `plugins` 数组：

```ts
import { createChartPlugin, createPrintPlugin, createWatermarkPlugin, ListTable } from 'infinitable'

const chart = createChartPlugin({
  resolveCellChart: (col, row) =>
    col === 1
      ? {
          type: 'line',
          labels: ['一月', '二月', '三月'],
          datasets: [{ label: '趋势', data: [12, null, 26] }],
        }
      : null,
})

const watermark = createWatermarkPlugin({
  enabled: true,
  text: '内部资料',
  opacity: 0.12,
})

const print = createPrintPlugin({
  source: {
    name: '销售明细',
    rowCount: 20,
    colCount: 3,
    rowHeight: () => 28,
    colWidth: () => 120,
    merges: () => [],
    cellValue: (col, row) => `${col}-${row}`,
    cellStyle: () => undefined,
    displayValue: (col, row) => `${col}-${row}`,
  },
  config: { headerRepeatRows: 1 },
})

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 640,
  height: 360,
  columns: [
    { title: '指标', width: 160 },
    { title: '趋势', width: 160 },
  ],
  rowCount: 6,
  rowHeight: 96,
  resolveDisplayValue: (col, row) => (col === 0 ? `指标-${row}` : ''),
  plugins: [chart, watermark, print],
  hostOptions: { container },
})

// print 不接线表格：能力全部经 handle 方法消费
const pages = print.paginate()
const html = print.buildDocumentHtml()
void pages
void html
```

各插件挂载后的实际接线：

| 插件                    | `mount` 做了什么                                                                          | `unmount` 做了什么                   |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| `createChartPlugin`     | 把挂载参数收窄为表格引擎，将「格 → 图表媒体」解析器写入引擎的 chart 预留位；晚挂载时触发全量重建 | 仅当当前解析器仍是自己的解析器时置空 |
| `createWatermarkPlugin` | `enabled` 时经协议面 `setOverlayPainter` 写入顶层 overlay painter                          | 置空 overlay painter、解除引擎引用   |
| `createPrintPlugin`     | 仅记录挂载引擎，不接线引擎                                                                | 无表侧副作用                         |

图表数据变更后仍需要宿主调 `table.refreshCell(col, row)`。`resolveCellChart` 是拉取式 hook，引擎不会感知声明对象内部的数据变化。`chart.getChartSpec(col, row)` 可独立解析声明，非法声明返回 `null`；`chart.loadLibrary()` 用于预热 Chart.js。

水印的运行时配置通过句柄修改，挂载态下一帧内重绘：

```ts
watermark.updateConfig({ text: '机密', rotate: -20 })
watermark.isEnabled()
watermark.getConfig()
```

## 引擎扩展点

### setUnderlayPainter：ground 层

```ts
import type { UnderlayPainter } from 'infinitable'

const syncPainter: UnderlayPainter = (ctx, viewport) => {
  // (ctx: RenderContext, viewport: Size) => void
  ctx.fillStyle = 'rgba(15, 23, 42, 0.04)'
  ctx.fillRect(0, 0, viewport.width, viewport.height)
}

table.setUnderlayPainter(syncPainter) // 传 null 还原
```

- 承载节点挂在 ground 层（L0），层在首次写入 painter 时惰性创建。
- 每次整层重绘（写入变更、容器 resize、整层失效）都会以层上下文与视口尺寸调用 painter。
- ground 层不参与滚动 band 失效与位图平移，绘制内容锚定视口，不随滚动移动。
- ground 恒在最底。默认主题的 body 单元格底色不透明，会遮挡 ground 内容；衬底水印/斑马纹若要可见，需要宿主把 body 底色改为透明或半透明，或者改用 overlay。

### setOverlayPainter：sky 层

```ts
import type { OverlayPainter } from 'infinitable'

const painter: OverlayPainter = (ctx, viewport) => {
  ctx.fillStyle = 'rgba(15, 23, 42, 0.06)'
  ctx.fillRect(0, 0, viewport.width, viewport.height)
}

table.setOverlayPainter(painter) // 传 null 还原
```

- 承载节点挂在 sky 层最顶，在选区浮层与浮动对象之上；滚动条会被重新置顶到水印之上。
- 不新增 canvas 层，四层叠放结构不变。任意主题 body 底色都不会遮挡 overlay 内容。
- 节点不可命中，pointer 事件透传，sky 层既有事件语义不受影响。
- 写入变更提交 sky 整层失效，下一帧重绘；容器 resize 时视口尺寸同步。
- 与 underlay 一样锚定视口，不随滚动平移。

### chartMediaResolver：图表预留位

`ListTable` 实例上有 `chartMediaResolver` 字段，这是官方 chart 插件使用的引擎预留位，不是面向宿主的通用扩展点。它的值描述「某一格如何产出图表位图」：

```ts
interface CellChartMedia {
  key: string
  produce(size: { width: number; height: number; dpr: number }): Promise<LoadedImage> | LoadedImage
}
```

- `key` 是内容 key，table 会再叠加格尺寸与 DPR 组成完整缓存 key。
- `produce` 在 cell 级位图缓存未命中时调用，同 key 并发出图由 table 收敛。
- 宿主应使用 `createChartPlugin`，不要自己写 `chartMediaResolver`。该字段在引擎源码中标记为内部预留位，不属于稳定宿主 API。

### 单写方槽位

underlay、overlay 与 chart 预留位都是单写方槽位：

- 后挂载的 overlay painter 会覆盖先挂载的 painter。
- 多个顶层内容（水印 + 角标 + 标尺）必须合并进同一个 painter 内自绘。
- `unmount` 必须还原自己写过的槽位。

## 最小自定义插件：sky 标尺

下面这个插件在表格视口底部画一条标尺。它只依赖公开的 `OverlayPainter` 与 `setOverlayPainter`，不 import 任何引擎内部模块。

```ts
import { ListTable, type OverlayPainter, type TablePlugin } from 'infinitable'

const rulerPlugin: TablePlugin = {
  name: 'viewport-ruler',
  mount(engine) {
    const paint: OverlayPainter = (ctx, viewport) => {
      const height = 26
      const top = viewport.height - height

      ctx.save()
      // 底条
      ctx.fillStyle = 'rgba(248, 250, 252, 0.92)'
      ctx.fillRect(0, top, viewport.width, height)

      // 刻度线（RenderContext 是最小 canvas 子集，用 fillRect 画线）
      ctx.fillStyle = '#94a3b8'
      for (let x = 0; x <= viewport.width; x += 25) {
        const major = x % 100 === 0
        ctx.fillRect(x, top, 1, major ? 11 : 5)
      }

      // 主刻度文字
      ctx.fillStyle = '#334155'
      ctx.font = '11px sans-serif'
      for (let x = 0; x <= viewport.width; x += 100) {
        ctx.fillText(String(x), x + 4, top + 21)
      }
      ctx.restore()
    }

    engine.setOverlayPainter(paint)
  },
  unmount(engine) {
    engine.setOverlayPainter(null)
  },
}

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 640,
  height: 360,
  columns: [
    { title: '名称', width: 200 },
    { title: '数值', width: 160 },
  ],
  rowCount: 200,
  resolveDisplayValue: (col, row) => (col === 0 ? `行 ${row}` : String(row * 3)),
  plugins: [rulerPlugin],
  hostOptions: { container },
})

window.addEventListener('beforeunload', () => table.destroy())
```

如果改成运行时挂载：

```ts
const table = new ListTable({/* 不传 plugins */})
table.use(rulerPlugin) // setOverlayPainter 自动提交 sky 整层失效，下一帧出现
```

`RenderContext` 只暴露引擎实际使用的 canvas 最小子集：`fillStyle`、`strokeStyle`、`lineWidth`、`font`、`save/restore`、`setTransform`、`translate`、`beginPath`、`rect`、`clip`、`clearRect`、`fillRect`、`fillText`、`drawImage`、`measureText`。没有 `globalAlpha`、`moveTo/lineTo`、`stroke`；透明度用 rgba 颜色表达，线条用 `fillRect` 绘制。

## 插件接口红线

插件只允许依赖公开入口显式导出的 API：

```ts
// 正确：用户侧从 infinitable 公共入口导入
import type { ListTable, OverlayPainter, RenderContext, Size, TablePlugin } from 'infinitable'

// 错误：深路径、内部模块、@internal 成员
import { rebuildScene } from '@infinitable/table/src/list-table-scene'
```

红线清单：

- 不 import 引擎内部模块、深路径模块或未导出符号，不使用 `@internal` 成员。
- 不读写 `table.options`、`table.cellNodes`、`table.pipeline` 等内部字段，不猴补丁引擎方法。
- 不依赖画布 DOM 的具体层级、节点顺序或内部缓存实现。
- 不直接写 `chartMediaResolver`；图表能力经 `createChartPlugin` 消费。
- 不依赖 `sceneInitialized` / `applyGeometryChange` 等内部重建入口；自定义插件需要刷新时使用公开方法（`refreshCell`、`batchUpdate`、painter 写入等）。
- 插件状态由插件自己持有，不要把生命周期绑在表格私有字段上。
- 订阅事件必须保存退订函数并在 `unmount` 调用；写过的预留位必须在 `unmount` 还原。

## 动态分包与可选依赖

chart 插件是唯一按需加载重依赖的官方插件：

- Chart.js 是可选能力依赖：不用图表时不会进入主入口路径，也不会触发动态加载。
- 源码中只有 chart-loader 触碰 Chart.js，通过 `import('chart.js')` 动态加载。
- 首次出图时才请求 Chart.js；未使用图表插件的宿主不会加载这部分代码。
- 发布包的构建会把 Chart.js 单独打成 `chart-*.js` 分包，主入口不包含 Chart.js 代码；源码方式消费 `@infinitable/plugins` 时，Chart.js 由该包的依赖提供。
- `Chart.register(...registerables)` 在模块加载后执行一次；Chart.js 4 主入口不自动注册控制器，缺少这一步会报 `bar is not a registered controller`。
- 需要预热时提前调 `chart.loadLibrary()`；测试或自定义模块通过 `chartJsModule` 注入，注入的模块需自行完成注册。
- `createCanvas` 可注入离屏画布工厂，默认 `document.createElement('canvas')`。

水印与打印不引入额外运行时依赖。打印的页面构建与分页是纯 TS；`print` / `openPreview` 触 DOM，在 SSR 环境应只消费 `paginate` / `buildDocumentHtml`。

## 常见问题

### 水印或 underlay 内容看不见

顶层水印用 `setOverlayPainter`，默认主题下一定可见。若用 `setUnderlayPainter` 画在内容之下，默认主题的 body 不透明底色会遮挡；需要宿主提供透明/半透明 body 底色，或改用 overlay。

### 两个顶层插件互相覆盖

overlay 是单写方槽位，后挂载者覆盖先挂载者。把多个顶层内容合并到一个 painter 里，由一个插件统一写入。

### 运行时挂载后图表没有立刻出现

`chartMediaResolver` 依赖场景重建。直接用官方 `createChartPlugin` 时会处理晚挂载；自写插件不应写这个预留位。若自写插件依赖场景装配，请改用构造时 `plugins` 注册。

### 销毁后旧水印还在

`unmount` 没有把 overlay painter 置空。凡是写过 painter 的插件都必须在 `unmount` 调用 `table.setOverlayPainter(null)` 或 `table.setUnderlayPainter(null)`。
