---
title: 插件（plugins）
description: 官方插件 API：图表（Chart.js 按需加载与单元格声明）、文字水印（顶层 overlay 句柄）、打印（headless 分页、文档构建、iframe 输出、DOM 预览与引擎供数适配），以及共同挂载与卸载方式。
---

# 插件（plugins）

`plugins` 提供三个官方插件工厂，全部实现 `TablePlugin` 契约：

| 插件       | 工厂                    | `name`        | 能力                                                      |
| ---------- | ----------------------- | ------------- | --------------------------------------------------------- |
| 单元格图表 | `createChartPlugin`     | `'chart'`     | 解析格内图表声明，Chart.js 离屏出图，落 L2 media 位图管线 |
| 文字水印   | `createWatermarkPlugin` | `'watermark'` | 顶层 overlay 平铺文字，锚定视口不随滚动                   |
| 打印       | `createPrintPlugin`     | `'print'`     | headless 分页与文档 HTML、iframe 打印、DOM 预览           |

所有工厂与类型均从 `infinitable` 主入口导入。

## 共同挂载与卸载

```ts
interface TablePlugin {
  readonly name: string
  mount(engine: EngineAssembly): void
  unmount?(engine: EngineAssembly): void
}
```

挂载参数是 `EngineAssembly` 装配协议面（`import type { EngineAssembly } from 'infinitable'`），不是 `ListTable` 具体类型：水印、打印等协议插件只依赖该面，挂到 `ListTable`、pivot 引擎 `PivotGrid` 等任何实现该面的引擎都生效；图表插件需要表格领域能力，内部把参数收窄为 `ListTable`。

两种注册方式等价：

```ts
import { ListTable, createChartPlugin, createWatermarkPlugin } from 'infinitable'

const table = new ListTable({
  width: 900,
  height: 500,
  columns,
  records,
  hostOptions: { container },
  plugins: [
    createChartPlugin({ resolveCellChart: (col, row) => declarations.get(`${col},${row}`) }),
    createWatermarkPlugin({ enabled: true, text: '内部资料' }),
  ],
})
```

```ts
import { createPrintPlugin } from 'infinitable'

const printer = createPrintPlugin({ source })
table.use(printer)
```

- 构造参数 `plugins` 在首次场景重建之前挂载，渲染接线参与首帧。
- `table.use(plugin)` 立即调用 `mount`；图表插件在场景已初始化时会补一次几何重建，使图表即时上图。
- `ListTable.destroy()` 按注册的逆序调用 `unmount`。没有内置的「注销单个插件」API；各插件的 `unmount` 可从句柄直接调用，重复调用是安全的。

::: tip
`name` 是插件在注册路径中的标识，不是运行时去重键。同一实例重复 `use` 会重复挂载；同一 `name` 的两个实例会依次挂载，由后挂载者覆盖同类预留位（如 `chartMediaResolver`）。
:::

## 图表插件

```ts
function createChartPlugin(options?: ChartPluginOptions): ChartPluginHandle
```

### 配置

```ts
interface ChartPluginOptions {
  resolveCellChart?: (col: number, row: number) => ChartCellDeclaration | null | undefined
  createCanvas?: () => HTMLCanvasElement
  chartJsModule?: ChartJsModule | Promise<ChartJsModule>
}
```

| 选项               | 类型                                                      | 默认                               | 说明                                                |
| ------------------ | --------------------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| `resolveCellChart` | `(col, row) => ChartCellDeclaration \| null \| undefined` | —                                  | 返回该格的图表声明；`null` / `undefined` 表示普通格 |
| `createCanvas`     | `() => HTMLCanvasElement`                                 | `document.createElement('canvas')` | 离屏画布工厂注入；测试用                            |
| `chartJsModule`    | `ChartJsModule \| Promise<ChartJsModule>`                 | 动态 `import('chart.js')`          | Chart.js 模块注入缝；测试用                         |

`ChartJsModule` 是 `typeof import('chart.js')` 的类型别名，未从公共入口导出；正常使用不需要提供该选项。

### 句柄

```ts
interface ChartPluginHandle extends TablePlugin {
  getChartSpec(col: number, row: number): ChartSpec | null
  loadLibrary(): Promise<ChartJsModule>
}
```

| 成员                     | 说明                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `name`                   | `'chart'`                                                                                |
| `mount(engine)`          | 把挂载参数收窄为表格引擎，将「格 → 图表媒体」解析器写入 `chartMediaResolver` 预留位；晚挂载时触发一次几何重建 |
| `unmount(engine)`        | 仅当预留位仍指向本插件的解析器时置 `null`                                                |
| `getChartSpec(col, row)` | 解析该格声明；未声明或非法返回 `null`，不抛异常                                          |
| `loadLibrary()`          | 按需加载 Chart.js，返回模块（模块级缓存）                                                |

### 声明格式

格内声明来自宿主数据，字段值面未知，由解析器校验：

```ts
interface ChartCellDeclaration {
  type?: unknown
  labels?: unknown
  datasets?: unknown
}

interface ChartDatasetDeclaration {
  label?: unknown
  data?: unknown
}
```

规范化产物为纯数据形态，与 Chart.js 解耦：

```ts
type ChartType = 'bar' | 'line' | 'area' | 'pie'
type ChartSpecType = 'bar' | 'line' | 'pie'

interface ChartDatasetSpec {
  label: string
  data: (number | null)[]
  fill: boolean
}

interface ChartSpec {
  type: ChartSpecType
  labels: string[] | null
  datasets: ChartDatasetSpec[]
}
```

| 字段                            | 说明                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `ChartCellDeclaration.type`     | 必须是 `bar` / `line` / `area` / `pie` 之一                   |
| `ChartCellDeclaration.labels`   | 类目轴标签；`null` / 缺省 / 空数组归一为 `null`（按数据序号） |
| `ChartCellDeclaration.datasets` | 数据集数组，必须非空                                          |
| `ChartDatasetDeclaration.label` | 图例名称；字符串或有限数字转文本，其余归一为 `''`             |
| `ChartDatasetDeclaration.data`  | 数据点数组；每项必须是有限数字或 `null`                       |
| `ChartSpec.type`                | `area` 归一为 `'line'`；其余原样                              |
| `ChartSpec.labels`              | 标签字符串数组；数组项 `null` 落空串，其余 `String(label)`    |
| `ChartDatasetSpec.fill`         | 面积图置 `true`，其余 `false`                                 |
| `ChartDatasetSpec.data`         | 与声明顺序一致；`null` 表示折线/面积断点                      |

解析规则：

- 声明必须是普通对象（非数组、非 `null`）。
- `type` 字符串区分大小写，只接受四个基线类型。
- `datasets` 必须是非空数组；每项必须是对象，`data` 必须是数组。
- 数据点不接受字符串数字等隐式转换。
- 饼图只保留第一个数据集（Chart.js 饼图仅渲染首个）。
- 任何非法声明都返回 `null`，该格降级为普通格。

```ts
import { createChartPlugin } from 'infinitable'

const chart = createChartPlugin({
  resolveCellChart: (col, row) =>
    col === 0 && row === 0
      ? {
          type: 'bar',
          labels: ['一季度', '二季度'],
          datasets: [{ label: '销量', data: [12, 18] }],
        }
      : null,
})

chart.getChartSpec(0, 0)
// { type: 'bar', labels: ['一季度', '二季度'],
//   datasets: [{ label: '销量', data: [12, 18], fill: false }] }

await chart.loadLibrary()
```

### Chart.js 按需加载与分包

`loadLibrary()` 首次调用触发动态 `import('chart.js')`，之后共享同一个模块级 Promise：

```ts
import('chart.js').then((module) => {
  module.Chart.register(...module.registerables)
  return module
})
```

- Chart.js 4 的主入口不自动注册控制器、刻度等组件；不调用 `Chart.register(...registerables)` 会在出图时抛 `bar is not a registered controller`。
- 动态 import 使 `chart.js` 与其唯一依赖 `@kurkle/color` 独立成 chunk；未启用图表插件的宿主不会触发加载，`plugins` 主产物不包含 Chart.js 代码。
- 重复调用 `loadLibrary()` 不会重复加载或重复注册。
- 出图走 L2 media 位图管线：解析后的 `ChartSpec` 映射为 Chart.js 配置，在离屏画布出图，位图按内容 key 缓存并 blit 上屏。同一声明对象内容未变时复用既有 media；内容 key 变化则重建，使该格缓存定向失效。

## 水印插件

```ts
function createWatermarkPlugin(config: WatermarkTextConfig): WatermarkHandle
```

配置是必填位置参数，`enabled` 与 `text` 必填，样式字段可选。

### 配置

```ts
interface WatermarkTextConfig {
  enabled: boolean
  text: string
  fontSize?: number
  color?: string
  opacity?: number
  rotate?: number
  gapX?: number
  gapY?: number
}
```

| 字段       | 类型      | 默认        | 说明                                   |
| ---------- | --------- | ----------- | -------------------------------------- |
| `enabled`  | `boolean` | 必填        | 是否启用水印；关闭时预留位不写 painter |
| `text`     | `string`  | 必填        | 水印文本                               |
| `fontSize` | `number`  | `14`        | 字号（px）                             |
| `color`    | `string`  | `'#000000'` | 文本颜色                               |
| `opacity`  | `number`  | `0.12`      | 整体不透明度（0–1）                    |
| `rotate`   | `number`  | `-30`       | 旋转角度（度，负值为逆时针）           |
| `gapX`     | `number`  | `160`       | 相邻水印单元横向间距（px）             |
| `gapY`     | `number`  | `120`       | 相邻水印单元纵向间距（px）             |

渲染约定：

- 平铺步长 = 文本测量宽 + `gapX`、字号 + `gapY`；两轴都从视口原点开始推进。
- 颜色为 `#rgb` / `#rrggbb` 时与 `opacity` 预混为 `rgba()`；非 hex 颜色原样使用，不再叠加 `opacity`。
- 字体族固定为 `sans-serif`，不与表格主题耦合。
- 绘制在顶层 overlay（sky 层），覆盖表格内容，锚定视口，不随滚动平移。

### 句柄

```ts
interface WatermarkHandle extends TablePlugin {
  updateConfig(patch: Partial<WatermarkTextConfig>): void
  getConfig(): WatermarkTextConfig
  isEnabled(): boolean
}
```

| 成员                  | 说明                                                           |
| --------------------- | -------------------------------------------------------------- |
| `name`                | `'watermark'`                                                  |
| `mount(engine)`       | 按 `enabled` 经协议面 `engine.setOverlayPainter` 写入或清空    |
| `unmount(engine)`     | 置 `setOverlayPainter(null)`，还原预留位                       |
| `updateConfig(patch)` | 浅合并配置；任一项变化触发整层失效，一帧内重绘；值未变则无操作 |
| `getConfig()`         | 返回缺省值已并入的完整配置副本                                 |
| `isEnabled()`         | 当前 `enabled`                                                 |

```ts
import { createWatermarkPlugin } from 'infinitable'

const watermark = createWatermarkPlugin({ enabled: true, text: '内部资料', opacity: 0.1 })

table.use(watermark)

watermark.updateConfig({ text: '机密', rotate: -45 })
watermark.getConfig().fontSize // 14
watermark.isEnabled() // true
```

## 打印插件

```ts
function createPrintPlugin(options: PrintPluginOptions): PrintPluginHandle
```

打印链路本身 headless：`mount` 只记录挂载引擎，不接线任何挂点，全部能力经句柄方法调用，可脱离引擎实例使用。

### 配置

```ts
interface PrintPluginOptions {
  source: PrintSource
  config?: PrintConfig
  hooks?: {
    print?: (iframe: HTMLIFrameElement) => void | Promise<void>
  }
}
```

| 选项          | 说明                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `source`      | 打印数据源，必填                                                                         |
| `config`      | 基线打印配置；方法调用未显式给 `config` 时回落到此，再缺省为 `{}`                        |
| `hooks.print` | 打印触发钩子；缺省调用 `iframe.contentWindow.print()`。`PrintHooks` 类型未从公共入口导出 |

### 数据源

```ts
interface PrintSource {
  name: string
  rowCount: number
  colCount: number
  rowHeight(row: number): number
  colWidth(col: number): number
  merges(): readonly CellRange[]
  cellValue(col: number, row: number): unknown
  cellStyle(col: number, row: number): CellStyle | undefined
  displayValue(col: number, row: number): unknown
}
```

| 成员                     | 说明                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `name`                   | 表名；也是页眉页脚 `{title}` 的缺省来源                      |
| `rowCount` / `colCount`  | 数据行数 / 列数（含重复表头行）                             |
| `rowHeight` / `colWidth` | 行高 / 列宽，单位 px（96dpi）                               |
| `merges`                 | 合并区域列表（grid 的 `CellRange`，0 基闭区间）             |
| `cellValue`              | 原始格值；分组换页按此判定，不受显示链影响                  |
| `cellStyle`              | 有效格样式（grid 的 `CellStyle`）；无样式返回 `undefined`   |
| `displayValue`           | 显示值；页面构建消费                                        |

### 引擎供数适配

```ts
function createEnginePrintSource(
  engine: EngineAssembly,
  options?: EnginePrintSourceOptions,
): PrintSource
```

宿主打印引擎实例（`ListTable`、`PivotGrid` 等）时不必自写适配器：`createEnginePrintSource` 从引擎装配协议的导出读取面（`engine.read`）逐项映射打印数据源——行列数、行高列宽、合并区、原始值、有效样式与有效显示文本。`options.name` 作为表名（缺省空串）。引擎未提供导出读取面（`engine.read` 缺失）时 fail-fast 抛错。

```ts
import { createEnginePrintSource, createPrintPlugin } from 'infinitable'

const printer = createPrintPlugin({ source: createEnginePrintSource(table, { name: '销售明细' }) })
```

适配 `infinitable/sheet` 时，可从 `SheetSnapshot` 的 `cells` 稀疏条目、`rowHeights` / `colWidths` 元组映射；`Sheet` 模型的 getter 形态也可直接包装。

### 打印配置

```ts
type PrintPaperPreset = 'A3' | 'A4' | 'A5' | 'Letter'
type PrintPaperSpec = PrintPaperPreset | { widthMm: number; heightMm: number }
type PrintOrientation = 'portrait' | 'landscape'
type PrintPagingMode = 'fitpage' | 'fixrows'
type PrintScaleMode = 'origin' | 'fit-width'

interface PrintMargin {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

interface PrintConfig {
  paperSize?: PrintPaperSpec
  orientation?: PrintOrientation
  margin?: number | PrintMargin
  scale?: PrintScaleMode | { percent: number }
  paging?: PrintPagingMode
  fixRows?: number
  headerRepeatRows?: number
  rowRange?: { start: number; end: number }
  colRange?: { start: number; end: number }
  groupBreakBy?: number | readonly number[]
  headerFooter?: PrintHeaderFooterConfig
  watermark?: WatermarkTextConfig
}
```

| 字段               | 类型                                                        | 默认         | 说明                                                              |
| ------------------ | ----------------------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| `paperSize`        | `'A3' \| 'A4' \| 'A5' \| 'Letter' \| { widthMm; heightMm }` | `'A4'`       | 纸张；自定义尺寸按 portrait 口径宽高                              |
| `orientation`      | `'portrait' \| 'landscape'`                                 | `'portrait'` | 横向时交换纸张宽高                                                |
| `margin`           | `number \| PrintMargin`                                     | 四边 `48` px | 单数值展开为四边同距；对象缺边回落 48 px                          |
| `scale`            | `'origin' \| 'fit-width' \| { percent }`                    | `'origin'`   | 原始尺寸 / 按可用页宽等比缩小（只缩不放）/ 自定义百分比（1–1000） |
| `paging`           | `'fitpage' \| 'fixrows'`                                    | `'fitpage'`  | 按行高累加 / 固定行数（套打）                                     |
| `fixRows`          | `number`                                                    | —            | `fixrows` 必填：每页总行数（含重复表头行）                        |
| `headerRepeatRows` | `number`                                                    | `0`          | 每页重复的源表前 N 行                                             |
| `rowRange`         | `{ start; end }`                                            | 全表         | 数据行区间，含 `start` 不含 `end`；越界夹取，空/倒置区间按空处理  |
| `colRange`         | `{ start; end }`                                            | 全列         | 打印列区间；`fit-width` 与横向分页按区间内列宽计算                |
| `groupBreakBy`     | `number \| readonly number[]`                               | —            | 分组列；列值变化处强制换页，与分页模式正交                        |
| `headerFooter`     | `PrintHeaderFooterConfig`                                   | —            | 页眉页脚                                                          |
| `watermark`        | `WatermarkTextConfig`                                       | —            | 打印水印；`enabled` 为真才平铺                                    |

纸张预设（mm，portrait 宽 × 高）：

| 预设     | 宽    | 高    |
| -------- | ----- | ----- |
| `A3`     | 297   | 420   |
| `A4`     | 210   | 297   |
| `A5`     | 148   | 210   |
| `Letter` | 215.9 | 279.4 |

::: warning 未导出的内部类型
`PrintScale`、`PrintRange`、`PrintPage`、`PrintHooks`、`PrintPreviewHandle` 均未从公共入口导出。上文以字段形态展示；`PrintPage` 的结构见下文分页结果。
:::

### 页眉页脚

```ts
interface PrintHeaderFooterSection {
  left?: string
  center?: string
  right?: string
}

interface PrintHeaderFooterConfig {
  header?: PrintHeaderFooterSection | null
  footer?: PrintHeaderFooterSection | null
  headerHeight?: number
  footerHeight?: number
}
```

- 三段各占 1/3 宽。
- `header` / `footer` 存在时预留高度，缺省 `32` px；显式 `headerHeight` / `footerHeight` 覆盖。
- 缺省 section 不预留高度。

占位符：

| 占位符          | 说明                                  |
| --------------- | ------------------------------------- |
| `{page}`        | 当前页码（1 起）                      |
| `{pageCount}`   | 总页数                                |
| `{date}`        | 本地日期 `yyyy-MM-dd`                 |
| `{time}`        | 本地时间 `HH:mm`                      |
| `{title}`       | 表名（`PrintSource.name`）            |
| `{pageSum:COL}` | 本页第 `COL` 列数值之和；空集为 `0`   |
| `{pageAvg:COL}` | 本页第 `COL` 列数值平均值；空集为空串 |
| `{pageMax:COL}` | 本页第 `COL` 列数值最大值；空集为空串 |
| `{pageMin:COL}` | 本页第 `COL` 列数值最小值；空集为空串 |

`COL` 是 0 基列索引。未识别的占位符与非法列索引原样保留。聚合数值输出前按 `Math.round(value * 1e10) / 1e10` 消除浮点尾差。

### 句柄

```ts
interface PrintPluginHandle extends TablePlugin {
  paginate(config?: PrintConfig): PrintPage[]
  buildDocumentHtml(config?: PrintConfig): string
  print(config?: PrintConfig): Promise<void>
  openPreview(config?: PrintConfig): PrintPreviewHandle
}
```

| 成员                         | 说明                                           |
| ---------------------------- | ---------------------------------------------- |
| `name`                       | `'print'`                                      |
| `mount(engine)`              | 仅记录挂载引擎，不做其它接线                  |
| `paginate(config?)`          | headless 分页，返回页面数组                    |
| `buildDocumentHtml(config?)` | headless 构建完整打印文档 HTML                 |
| `print(config?)`             | 触 DOM：隐藏 iframe 装载文档并调起打印         |
| `openPreview(config?)`       | 触 DOM：打开预览弹层，返回 `{ close(): void }` |

每次方法调用都可传入 `config` 覆盖 options 中的基线配置：`config ?? options.config ?? {}`。

分页结果 `PrintPage` 的结构：

| 字段         | 类型                             | 说明                                                      |
| ------------ | -------------------------------- | --------------------------------------------------------- |
| `rowRange`   | `{ start: number; end: number }` | 本页数据行区间（源表行号，不含重复表头行）                |
| `headerRows` | `{ start; end } \| null`         | 每页重复的表头行区间；`headerRepeatRows = 0` 时为 `null`  |
| `blankRows`  | `number`                         | 末页补齐的空白行数；`fitpage` 恒为 `0`                    |
| `scale`      | `number`                         | 本页缩放系数；`origin` 为 1，`{ percent }` 为百分比 / 100 |
| `colRange`   | `{ start: number; end: number }` | 本页列区间（横向分页或 `colRange` 裁剪后）                |

分页语义：

- `fitpage`：行高（× 缩放）累加至放不下即换页；重复表头每页先占高；单行高于可用页高时独占一页，不截断。
- `fixrows`：每页数据行数 = `fixRows - headerRepeatRows`；不足一页的末页与分组提前换页的中间页补空白行。
- `groupBreakBy`：指定列值变化处强制换页，两种模式通用。
- 横向分页：列宽（× 缩放）累加超过可用页宽时按列切带；页序先行带后列带。
- 空表或空打印区域返回 `[]`。

配置校验：

| 场景                         | 抛错信息                                                   |
| ---------------------------- | ---------------------------------------------------------- |
| `fixrows` 未配置 `fixRows`   | `fixrows 分页必须配置 fixRows（每页总行数，含重复表头行）` |
| `fixRows ≤ headerRepeatRows` | `fixRows（N）必须大于 headerRepeatRows（M）`               |
| `scale.percent` 不在 1–1000  | `自定义缩放百分比必须为 1–1000 的有限数值`                 |
| 自定义纸张非有限正数         | `自定义纸张尺寸必须为有限正数（mm）：...`                  |
| 未知纸张预设                 | `未知纸张预设：...（可用：A3/A4/A5/Letter 或自定义 mm）`   |

### 打印输出与预览

- `print()` 创建离屏 iframe，`srcdoc` 装载文档；`load` 事件最多等待 5000 ms，超时降级继续。
- 真实打印路径在 `afterprint` 时清理 iframe，并有 60000 ms 兜底定时器；钩子路径在钩子返回/抛错后立即清理。
- 无 DOM 环境：`print()` 抛 `printPages 需要浏览器 DOM 环境（headless 场景消费 buildPrintDocumentHtml）`，`openPreview()` 抛 `openPrintPreview 需要浏览器 DOM 环境（headless 场景消费 paginate/buildPrintPageHtml）`。
- 预览弹层包含缩略图列表、当前页 iframe 放大预览与打印按钮；关闭按钮、`Esc`、点击背景与 `handle.close()` 都可关闭，清理幂等。

```ts
import { createPrintPlugin } from 'infinitable'

const printer = createPrintPlugin({
  source: {
    name: '销售报表',
    rowCount: 200,
    colCount: 6,
    rowHeight: () => 28,
    colWidth: () => 120,
    merges: () => [],
    cellValue: (col, row) => values[row]?.[col],
    cellStyle: () => undefined,
    displayValue: (col, row) => values[row]?.[col],
  },
  config: {
    paperSize: 'A4',
    orientation: 'landscape',
    scale: 'fit-width',
    paging: 'fitpage',
    headerRepeatRows: 1,
    headerFooter: {
      footer: { center: '第 {page} / {pageCount} 页', right: '{date} {time}' },
    },
  },
})

const pages = printer.paginate()
const html = printer.buildDocumentHtml()
await printer.print()

const preview = printer.openPreview({ scale: { percent: 80 } })
preview.close()
```
