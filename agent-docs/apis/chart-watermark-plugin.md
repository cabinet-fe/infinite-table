---
title: chart 图表插件与 watermark 水印插件
description: infinitable 官方插件：createChartPlugin 单元格图表（Chart.js 按需动态加载 + 离屏出图 + cell 级 MediaCache blit 上屏，bar/line/area/pie 四类）与 createWatermarkPlugin 文字平铺水印（顶层 overlay 预留位绘制，锚定视口不随滚动，updateConfig 运行时改配置）。
aliases: [chart 插件, watermark 插件, 水印, 单元格图表, ChartPlugin, WatermarkPlugin]
keywords: [createChartPlugin, resolveCellChart, ChartType, bar, line, area, pie, parseChartDeclaration, renderChartBitmap, loadChartJs, chart.js, createWatermarkPlugin, WatermarkTextConfig, updateConfig, isEnabled, 图表, 迷你图, 水印, 平铺水印, 图表格]
---

# chart 图表插件与 watermark 水印插件

`infinitable`（plugins 层）导出两个官方插件：`createChartPlugin`（单元格图表——格声明（类型 + 数据）经 Chart.js 在插件侧离屏出图，位图落 core L2 media 的 cell 级 MediaCache blit 上屏，滚动滚回命中直贴无闪；Chart.js 按需动态 `import('chart.js')` 独立分包，不强制安装）与 `createWatermarkPlugin`（文字平铺水印——绘制在顶层 overlay 预留位即 sky 层最顶，覆盖在表格内容之上，锚定视口不随滚动平移）。两者都实现 core `TablePlugin` 契约：构造 `options.plugins` 传入或 `table.use()` 注册即挂载。

## 快速上手

```ts
import { createChartPlugin, createWatermarkPlugin, ListTable } from 'infinitable'

const watermark = createWatermarkPlugin({ enabled: true, text: 'infinitable 内部资料' })
const chart = createChartPlugin({
  resolveCellChart: (col, row) => {
    if (col !== 1) return null // null/undefined 表示普通格
    return {
      type: 'bar',
      labels: ['一月', '二月', '三月', '四月'],
      datasets: [{ label: '营收', data: [12, 26, 18, 32] }],
    }
  },
})

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 48 + 120 + 150 + 12,
  height: 36 + 2 * 110 + 4,
  columns: [
    { title: '指标', width: 120 },
    { title: '柱状图', width: 150 },
  ],
  rowCount: 2,
  rowHeight: 110, // 图表格给足高度
  resolveDisplayValue: (col, row) => (col === 0 ? `指标-${row}` : ''),
  plugins: [chart, watermark], // 构造即挂载
  hostOptions: { container },
})
// => 第 1 列为 110px 高的柱状图位图（Chart.js 首次动态加载）；水印平铺覆盖其上

watermark.updateConfig({ text: '机密' }) // 运行时改配置，一帧内重绘
```

## API 签名

```ts
// ---- chart 插件 ----

/** 基线图表类型 */
export type ChartType = 'bar' | 'line' | 'area' | 'pie'
/** 规范化后的 chart.js 图表类型（area 无独立类型，归一为 line + fill） */
export type ChartSpecType = 'bar' | 'line' | 'pie'

/** 单元格图表声明：单元格内给出的原始形态（字段值面未知，由解析器校验） */
export interface ChartCellDeclaration {
  /** 图表类型：bar / line / area / pie */
  type?: unknown
  /** 类目轴标签（可省略；省略时按数据序号） */
  labels?: unknown
  /** 数据集集合；饼图规范化时取第一个数据集 */
  datasets?: unknown
}

/** 单个数据集声明 */
export interface ChartDatasetDeclaration {
  /** 数据集名称（图例用，可省略） */
  label?: unknown
  /** 数据点：有限数值或 null（折线/面积断点缺口）；其余判非法 */
  data?: unknown
}

/** 规范化数据集 */
export interface ChartDatasetSpec {
  label: string
  data: (number | null)[]
  /** 面积图填充标记（area 归一为 line 时置 true） */
  fill: boolean
}

/** 规范化图表 spec：解析成功产物 */
export interface ChartSpec {
  type: ChartSpecType
  /** 类目轴标签；声明缺省或空数组时为 null（chart.js 按数据序号） */
  labels: string[] | null
  datasets: ChartDatasetSpec[]
}

/** 解析结果：显式容错——非法声明返回 ok:false 与原因，不抛异常 */
export type ChartParseResult = { ok: true; spec: ChartSpec } | { ok: false; reason: string }

/** 解析声明（unknown 入参）；非法返回 ok:false */
export function parseChartDeclaration(declaration: unknown): ChartParseResult

export interface ChartPluginOptions {
  /** 返回该格的图表声明；null/undefined 表示普通格 */
  resolveCellChart?: (col: number, row: number) => ChartCellDeclaration | null | undefined
  /** 离屏画布工厂注入（测试用）；缺省 document.createElement('canvas') */
  createCanvas?: () => HTMLCanvasElement
  /** Chart.js 模块注入（测试用）；缺省按需动态加载 */
  chartJsModule?: ChartJsModule | Promise<ChartJsModule>
}

/** 插件句柄：TablePlugin 契约 + 渲染通路消费的解析/加载入口 */
export interface ChartPluginHandle extends TablePlugin {
  /** 解析指定格的图表声明为 ChartSpec；未声明或非法声明返回 null（不抛异常） */
  getChartSpec(col: number, row: number): ChartSpec | null
  /** 按需加载 Chart.js（首次触发动态 import，之后共享模块缓存） */
  loadLibrary(): Promise<ChartJsModule>
}

export const CHART_PLUGIN_NAME = 'chart'
export function createChartPlugin(options?: ChartPluginOptions): ChartPluginHandle

/** Chart.js 模块类型 */
export type ChartJsModule = typeof import('chart.js')
/** 按需加载 Chart.js（加载后注册全量 registerables） */
export function loadChartJs(): Promise<ChartJsModule>

export interface ChartRenderOptions {
  spec: ChartSpec
  /** 格 CSS 宽高（物理分辨率 = CSS × dpr） */
  width: number
  height: number
  dpr: number
  module?: ChartJsModule
  createCanvas?: () => HTMLCanvasElement
}

/** 按声明内容生成缓存内容 key（ChartSpec 确定性序列化；同声明必同 key） */
export function chartContentKey(spec: ChartSpec): string
/** 同步确定性出图（返回 promise 只为首次库加载）；产物位图物理尺寸 = CSS × dpr */
export function renderChartBitmap(options: ChartRenderOptions): Promise<LoadedImage>

// ---- watermark 插件 ----

/** 文字平铺水印配置（与打印水印共用同一配置模型） */
export interface WatermarkTextConfig {
  enabled: boolean
  text: string
  /** 字号 px；缺省 14 */
  fontSize?: number
  /** 文本颜色；缺省 '#000000' */
  color?: string
  /** 整体不透明度 0-1；缺省 0.12 */
  opacity?: number
  /** 旋转角度（度，负值为逆时针）；缺省 -30 */
  rotate?: number
  /** 相邻水印单元横向间距 px；缺省 160 */
  gapX?: number
  /** 纵向间距 px；缺省 120 */
  gapY?: number
}

export const WATERMARK_TEXT_DEFAULTS = Object.freeze({
  fontSize: 14,
  color: '#000000',
  opacity: 0.12,
  rotate: -30,
  gapX: 160,
  gapY: 120,
})

/** 水印插件句柄：TablePlugin 契约 + 运行时配置读写 */
export interface WatermarkHandle extends TablePlugin {
  /** 运行时更新配置（浅合并；任一项变更一帧内重绘；值未变的补丁无操作） */
  updateConfig(patch: Partial<WatermarkTextConfig>): void
  /** 当前完整配置快照（缺省值已并入，返回副本） */
  getConfig(): WatermarkTextConfig
  /** 当前开关态（config.enabled） */
  isEnabled(): boolean
}

export const WATERMARK_PLUGIN_NAME = 'watermark'
export function createWatermarkPlugin(config: WatermarkTextConfig): WatermarkHandle
```

## 参数说明

`ChartPluginOptions`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `resolveCellChart` | `(col, row) => ChartCellDeclaration \| null \| undefined` | — | 否 | 与 core `resolveCellImage` 同风格；返回声明的格按图表位图渲染，null 走常规管线 |
| `createCanvas` | `() => HTMLCanvasElement` | DOM canvas | 否 | 离屏画布工厂（测试注入） |
| `chartJsModule` | `ChartJsModule \| Promise<ChartJsModule>` | 动态加载 | 否 | Chart.js 模块注入（测试注入；运行时缺省 `import('chart.js')`） |

`ChartCellDeclaration` 校验规则（`parseChartDeclaration`）：

- `type` 限 `'bar' | 'line' | 'area' | 'pie'`（大小写敏感，非法 → `ok: false`）。
- `labels` 缺省为 null（按数据序号）；给定时须为字符串数组。
- `datasets` 须为数据集数组；`data` 逐点须为有限数值或 `null`（折线/面积断点缺口）；`label` 可省略（缺省空串）。
- 饼图规范化只取第一个数据集。
- 解析器对同一声明对象 memo（内容 key 未变时复用同一 media）；声明常被宿主就地改数据（对象身份不变），每次 resolve 重算内容 key——key 变了即换新 media 定向失效重出图。

`WatermarkTextConfig`（`enabled`/`text` 必填，样式字段缺省见 `WATERMARK_TEXT_DEFAULTS`）：见签名块内注释。

## 方法与事件

`createChartPlugin(options)` — 返回 `ChartPluginHandle`（同时是 `TablePlugin`）：

- `mount(table)` — 把「格 → 图表媒体」解析器写入 `table.chartMediaResolver`（core L2 media 的 chart 预留位）；晚挂载（`table.use`）补一次全量重建即时上图。
- `unmount(table)` — 解析器是本插件时置 null。
- `getChartSpec(col, row)` — 独立解析（冒烟断言/取数用）；未声明或非法返回 null。
- `loadLibrary()` — `loadChartJs` 直通；首次调用触发动态 import 并 `Chart.register(...registerables)`（chart.js 4 树摇设计不自动注册，缺这步 `new Chart` 抛 `bar is not a registered controller`），之后模块级缓存。

出图通路（`renderChartBitmap`）：插件持有的离屏 canvas 上同步确定性出图（`responsive: false` + `animation: false` + 显式 `devicePixelRatio`），双画布协议（chart.js destroy 会清 scratch 画布，产物先拷出到 output 画布）；配色由出图器确定性缺省色板（9 色循环），单元格声明不携带配色。产物位图经 cell 级 MediaCache 缓存（key = 内容 key + 格尺寸 + DPR），同 key 并发出图由 core 单飞收敛。

`createWatermarkPlugin(config)` — 返回 `WatermarkHandle`（同时是 `TablePlugin`）：

- `mount(table)` — `enabled` 时写 overlay painter（sky 层最顶），触发 sky 整层失效一帧内生效。
- `unmount(table)` — 置 null 还原预留位（承载节点摘除、绘制面清空）。
- `updateConfig(patch)` — 浅合并 + 无变化守卫；挂载态即时重绘，未挂载只改配置（mount 时按新配置生效）。
- `getConfig()` — 缺省值并入后的完整快照副本；`isEnabled()` — `config.enabled`。
- 水印锚定视口不随滚动平移（sky 层不参与滚动 band 失效）；节点不可命中（pointer 事件透传）；内容之下的衬底水印场景改用 core `setUnderlayPainter`。

## 典型示例

### 长列表滚动图表格（缓存命中无闪）

```ts
import { createChartPlugin, ListTable, type ChartCellDeclaration } from 'infinitable'

/** 声明按行取模共享 6 组（身份稳定对象，保证插件 memo 与缓存 key 收敛） */
const declarations: ChartCellDeclaration[] = Array.from({ length: 6 }, (_, v) => ({
  type: 'bar' as const,
  labels: ['一月', '二月', '三月', '四月'],
  datasets: [{ label: '销量', data: [20 + v * 6, 14 + v * 3, 28 - v * 2, 18 + v * 4] }],
}))

const plugin = createChartPlugin({
  resolveCellChart: (col, row) => (col === 1 ? declarations[row % 6] ?? null : null),
})

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 48 + 160 + 150 + 12,
  height: 320,
  columns: [
    { title: '地区', width: 160 },
    { title: '销量（柱状）', width: 150 },
  ],
  rowCount: 400,
  rowHeight: 84,
  resolveDisplayValue: (col, row) => (col === 0 ? `地区-${row}` : ''),
  plugins: [plugin],
  hostOptions: { container },
})

// 滚动再滚回：同 key 命中 cell 级缓存直贴（无闪）
console.log(table.mediaCache.size, table.chartCellNodes.size) // => 6 6（400 行共享 6 组声明）
```

### 内容换 key 失效重出图

```ts
import { createChartPlugin, ListTable } from 'infinitable'

let revision = 0
const plugin = createChartPlugin({
  resolveCellChart: (col, row) =>
    col === 1
      ? {
          type: 'line',
          labels: ['一月', '二月', '三月', '四月'],
          datasets: [{ label: '趋势', data: [8 + revision * 4, null, 22, 30] }],
        }
      : null,
})

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 320,
  height: 200,
  columns: [{ title: '指标' }, { title: '折线', width: 150 }],
  rowCount: 1,
  rowHeight: 110,
  resolveDisplayValue: (col) => (col === 0 ? '趋势' : ''),
  plugins: [plugin],
  hostOptions: { container },
})

const refresh = document.querySelector<HTMLButtonElement>('#rotate')!
refresh.addEventListener('click', () => {
  revision++ // 数据变了 → 内容 key 变 → 新 media
  table.refreshCell(1, 0) // 定向失效该格缓存并重出图
})
```

### 水印开关与样式即时调整

```ts
import { createWatermarkPlugin, ListTable, type WatermarkHandle } from 'infinitable'

const handle: WatermarkHandle = createWatermarkPlugin({
  enabled: true,
  text: 'infinitable 内部资料',
  fontSize: 16,
  opacity: 0.2,
})

const container = document.querySelector<HTMLDivElement>('#table')!
new ListTable({
  width: 660,
  height: 360,
  columns: [{ title: '编号', width: 120 }, { title: '部门', width: 160 }],
  rowCount: 400,
  resolveDisplayValue: (col, row) => (col === 0 ? `NO-${row + 1}` : `部门-${(row % 8) + 1}`),
  plugins: [handle],
  hostOptions: { container },
})

document.querySelector<HTMLButtonElement>('#toggle')!.addEventListener('click', () => {
  handle.updateConfig({ enabled: !handle.isEnabled() }) // 开关即时可见
})
document.querySelector<HTMLInputElement>('#rotate')!.addEventListener('input', (event) => {
  handle.updateConfig({ rotate: Number((event.target as HTMLInputElement).value) })
})
console.log(handle.getConfig()) // => { enabled: true, text: '...', fontSize: 16, color: '#000000', opacity: 0.2, rotate: -30, gapX: 160, gapY: 120 }
```

## 注意事项

> [!WARNING]
> - Chart.js 不在 infinitable 依赖里：chart 插件首次出图动态 `import('chart.js')`——用到图表须自装 `chart.js`（v4），否则运行时报模块加载失败；未启用图表插件的宿主不触发加载、产物不含 chart.js 代码。
> - 单元格声明只有「类型 + 数据」：配色、动画、交互全部不携带（出图器确定性缺省色板、禁动画）；需要自定义 chart.js 配置的宿主走自建 `CellChartMedia` 出图管线，不用本插件。
> - 图表格与图片格同走 L2 media 层：`resolveCellChart` 返回声明的格整格按位图渲染，不叠加文本。
> - 声明对象要身份稳定：每次 `resolveCellChart` 返回新字面量也能工作（内容 key 比对），但长列表应共享声明数组（身份稳定保证 memo 与缓存收敛），滚动场景以取模或查表返回。
> - 数据变更必须调 `table.refreshCell(col, row)` 触发定向失效——resolveCellChart 是拉取式 hook，引擎不会自动感知声明数据变化。
> - 水印插件独占顶层 overlay 预留位（单写方槽位）：同表再挂第二个 watermark 插件会互相覆盖 painter；多种顶层覆盖内容须在一个 painter 内自绘。
> - `WatermarkTextConfig` 与打印水印（`apis/print-plugin.md` 的 `PrintConfig.watermark`）同一配置模型，三端（表格水印/打印水印）缺省值一致。

## 常见问题

### 图表格空白 / 控制台报 `bar is not a registered controller`

原因：未安装 `chart.js`（动态 import 失败）或注入了未注册组件的自定义模块。修复：安装 chart.js v4；注入模块时自行注册。

```bash
bun add chart.js
```

```ts
import { createChartPlugin, ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!
new ListTable({
  width: 320,
  height: 200,
  columns: [{ title: 'A' }, { title: '图', width: 150 }],
  rowCount: 1,
  rowHeight: 110,
  resolveDisplayValue: (_col) => '',
  plugins: [
    createChartPlugin({
      resolveCellChart: (col) =>
        col === 1 ? { type: 'pie', datasets: [{ data: [35, 25, 22, 18] }] } : null,
    }),
  ],
  hostOptions: { container },
})
```

### 改了图表数据但表格没变

原因：resolveCellChart 是拉取式 hook，引擎不感知声明内部数据变化。修复：改数据后对该格调 `refreshCell`。

```ts
import type { ListTable } from 'infinitable'

declare const table: ListTable
declare const revision: { value: number }
revision.value++
table.refreshCell(1, 0) // 内容 key 变化 → 该格缓存定向失效并重出图
```
