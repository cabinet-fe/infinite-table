---
title: createPrintPlugin 打印插件
description: infinitable 打印插件 createPrintPlugin（ureport2 双模式移植，headless 内核 + DOM 输出）：handle.paginate 分页（fitpage 行高累加 / fixrows 固定行数、重复表头、分组换页、fit-width 缩放）、buildDocumentHtml 页面 HTML、print iframe 打印输出与 openPreview 预览弹层；PrintSource 供数适配，PrintConfig 纸张/边距/页眉页脚占位符（{page}/{pageSum:COL}）与水印配置。
aliases: [print 插件, 打印, 打印预览, paginate, 分页, printPages, openPrintPreview]
keywords: [createPrintPlugin, PrintPluginOptions, PrintPluginHandle, paginate, buildDocumentHtml, print, openPreview, PrintConfig, PrintSource, paperSize, A4, orientation, landscape, fitpage, fixrows, headerRepeatRows, groupBreakBy, "pageSum", PrintPaperPreset, 打印, 分页, 页眉页脚, 套打, 打印预览]
---

# createPrintPlugin 打印插件

`infinitable`（plugins 层）导出 `createPrintPlugin(options)` 工厂（ureport2 双模式移植）：返回值同时是 `TablePlugin`（可经构造 `plugins` / `table.use()` 注册；mount 为契约占位，注册与销毁均无表侧副作用）与运行时 handle——打印链路本身 headless（不接线表格任何挂点），`paginate`（分页纯函数零 DOM）、`buildDocumentHtml`（页面 HTML 构建：页眉页脚占位符求值 + 表格页 + 水印平铺）、`print`（隐藏 iframe 装载 → 调起打印）与 `openPreview`（DOM 预览薄壳）全部经 handle 方法达成，可脱离表格直接以 handle 形态消费。供数走 `PrintSource` 窄接口（适配 sheet 插件 Store 或任意模型）；配置走 `PrintConfig`（纸张/方向/边距/缩放/分页/重复表头/分组换页/页眉页脚/水印），方法调用可逐次覆盖插件 options 的基线 config。原散装函数（`paginate`/`printPages`/`openPrintPreview` 等，0.1.2 起不再导出）收敛为 handle 方法。

## 快速上手

```ts
import { createPrintPlugin, type PrintConfig, type PrintSource } from 'infinitable'
import type { SheetPluginHandle } from 'infinitable'

declare const sheet: SheetPluginHandle
const store = sheet.activeStore()!

// Store → PrintSource 适配（宿主/适配器供数形态）
const source: PrintSource = {
  name: '销售明细',
  rowCount: store.getRowCount(),
  colCount: store.getColCount(),
  rowHeight: (row) => store.getRowHeight(row),
  colWidth: (col) => store.getColWidth(col),
  merges: () => store.getMerges(),
  cellValue: (col, row) => store.getValue(col, row),
  cellStyle: (col, row) => store.getEffectiveStyle(col, row),
  displayValue: (col, row) => store.getDisplayValue(col, row),
}

const print = createPrintPlugin({
  source,
  config: {
    paperSize: 'A4',
    orientation: 'portrait',
    headerRepeatRows: 1, // 每页重复第 0 行作表头
    headerFooter: {
      footer: { center: '第 {page} 页 / 共 {pageCount} 页' },
    },
  } satisfies PrintConfig,
})

await print.print() // 隐藏 iframe 装载并调起系统打印对话框
```

## API 签名

```ts
// ---- 数据源 ----

export interface PrintSource {
  name: string
  rowCount: number
  colCount: number
  /** 行高/列宽一律 px（96dpi，与引擎行列尺寸同口径） */
  rowHeight(row: number): number
  colWidth(col: number): number
  merges(): readonly CellRange[]
  /** 原始格值（分组换页按此判定，不受显示链影响） */
  cellValue(col: number, row: number): unknown
  cellStyle(col: number, row: number): CellStyle | undefined
  displayValue(col: number, row: number): unknown
  images?: readonly FloatObject[]
  imageData?: (object: FloatObject) => PrintImagePayload | undefined
}

export interface PrintImagePayload {
  mime: string
  data: Uint8Array
}

// ---- 配置 ----

export type PrintPaperPreset = 'A3' | 'A4' | 'A5' | 'Letter'
export type PrintPaperSpec = PrintPaperPreset | { widthMm: number; heightMm: number }
export type PrintOrientation = 'portrait' | 'landscape'
export interface PrintMargin {
  top?: number
  right?: number
  bottom?: number
  left?: number
}
export type PrintScaleMode = 'origin' | 'fit-width'
export type PrintPagingMode = 'fitpage' | 'fixrows'

export interface PrintHeaderFooterSection {
  left?: string
  center?: string
  right?: string
}

export interface PrintHeaderFooterConfig {
  header?: PrintHeaderFooterSection | null
  footer?: PrintHeaderFooterSection | null
  headerHeight?: number
  footerHeight?: number
}

export interface PrintConfig {
  paperSize?: PrintPaperSpec
  orientation?: PrintOrientation
  margin?: number | PrintMargin
  scale?: PrintScaleMode
  paging?: PrintPagingMode
  fixRows?: number
  headerRepeatRows?: number
  groupBreakBy?: number | readonly number[]
  headerFooter?: PrintHeaderFooterConfig
  /** 与水印插件同一配置模型；enabled 才平铺 */
  watermark?: WatermarkTextConfig
}

// ---- 插件 ----

export interface PrintPluginOptions {
  /** 打印数据源（宿主/适配器供数的窄接口） */
  source: PrintSource
  /** 基线打印配置（方法调用未显式给 config 时回落到此；缺省字段走各模块缺省值） */
  config?: PrintConfig
  /** 打印钩子（未导出为独立类型；print 输出与预览内打印按钮共用；测试注入桩替换真实 print） */
  hooks?: {
    /** 打印触发（缺省 iframe.contentWindow.print()）；返回 Promise 时等待其完成后再清理 */
    print?: (iframe: HTMLIFrameElement) => void | Promise<void>
  }
}

/** 打印插件句柄：TablePlugin 契约 + 打印链路既有入口（可脱离表格 headless 调用） */
export interface PrintPluginHandle extends TablePlugin {
  /** 打印分页（headless 纯函数零 DOM）：按配置把数据源划分为页 */
  paginate(config?: PrintConfig): PrintPage[]
  /** 构建完整打印文档 HTML（headless 纯函数：分页 + 各页拼装） */
  buildDocumentHtml(config?: PrintConfig): string
  /** 打印输出（触 DOM）：隐藏 iframe 装载文档 → 调起打印 → 清理 */
  print(config?: PrintConfig): Promise<void>
  /** 打开打印预览弹层（触 DOM）：缩略列表 + 当前页放大预览 + 打印按钮；返回句柄 close() 幂等清理 */
  openPreview(config?: PrintConfig): { close(): void }
}

/** paginate 返回的页结构（未导出为独立类型） */
interface PrintPage {
  /** 本页数据行区间（源表行号，不含重复表头行；含 start 不含 end） */
  rowRange: { start: number; end: number }
  /** 每页重复的表头行区间（源表前 N 行）；headerRepeatRows = 0 时为 null */
  headerRows: { start: number; end: number } | null
  /** 末尾补的空白行数（fixrows 补齐每页行数一致；fitpage 恒 0） */
  blankRows: number
  /** 本页缩放系数（origin 恒 1；fit-width 按可用页宽/内容宽只缩不放） */
  scale: number
}

export function createPrintPlugin(options: PrintPluginOptions): PrintPluginHandle
```

`PrintConfig` 缺省值：`paperSize: 'A4'`、`orientation: 'portrait'`、`margin: 48px`（四边）、`scale: 'origin'`、`paging: 'fitpage'`、`headerRepeatRows: 0`、页眉页脚 section 存在即预留 32px 高（可显式覆盖）。

占位符集：`{page}`/`{pageCount}`/`{date}`（yyyy-MM-dd）/`{time}`（HH:mm）/`{title}`（缺省取 `PrintSource.name`）与页级聚合 `{pageSum:COL}`/`{pageAvg:COL}`/`{pageMax:COL}`/`{pageMin:COL}`（COL 为 0 起列索引）；未识别占位符原样保留（宿主自定义文案不破坏）。聚合：sum 空集为 0，avg/max/min 空集为空串；格式化消除浮点累加尾差（0.1+0.2 → 0.3）。

## 参数说明

`PrintPluginOptions`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `source` | `PrintSource` | — | 是 | 打印数据源；行高/列宽单位 px（96dpi） |
| `config` | `PrintConfig` | 各字段缺省值 | 否 | 基线配置；方法调用显式给 config 时逐次覆盖 |
| `hooks` | `{ print?: (iframe) => void \| Promise<void> }` | `iframe.contentWindow.print()` | 否 | print 输出与预览内打印按钮共用的触发钩子 |

`PrintConfig`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `paperSize` | `PrintPaperSpec` | `'A4'` | 否 | 预设代号或自定义 mm 尺寸（portrait 口径宽高，landscape 自动交换） |
| `orientation` | `'portrait' \| 'landscape'` | `'portrait'` | 否 | landscape 宽高交换 |
| `margin` | `number \| PrintMargin` | `48`（px） | 否 | 单值四边同距；单边覆盖走 `PrintMargin`（未给的边回落缺省） |
| `scale` | `'origin' \| 'fit-width'` | `'origin'` | 否 | fit-width 按可用页宽/内容宽等比缩放，只缩不放 |
| `paging` | `'fitpage' \| 'fixrows'` | `'fitpage'` | 否 | fitpage 按行高累加分页；fixrows 按固定行数分页（套打） |
| `fixRows` | `number` | — | fixrows 时必填 | 每页总行数（含重复表头行）；缺省或 ≤ headerRepeatRows 抛 `fixrows 分页必须配置 fixRows（每页总行数，含重复表头行）` / `fixRows（N）必须大于 headerRepeatRows（M）` |
| `headerRepeatRows` | `number` | `0` | 否 | 每页重复的表头行数（取源表前 N 行）；负数按 0、超行数夹到行数 |
| `groupBreakBy` | `number \| readonly number[]` | 不分组 | 否 | 指定列值变化处强制换页（原始值口径）；与分页模式正交组合 |
| `headerFooter` | `PrintHeaderFooterConfig` | 不预留 | 否 | section 存在即预留高度 |
| `watermark` | `WatermarkTextConfig` | 不平铺 | 否 | 与水印插件同一配置模型；enabled 才平铺 |

`PrintSource.rowHeight/colWidth` 单位 px（96dpi）；`cellValue` 是分组换页判定口径（显示变换不改变分组语义），`displayValue` 是页面渲染口径。

## 方法与事件

`createPrintPlugin(options)` — 返回 `PrintPluginHandle`（name `'print'`，同时是 `TablePlugin`；mount/unmount 无表侧副作用）：

- `paginate(config?): PrintPage[]` — 同步纯函数零 DOM：
  - fitpage：行高（× scale）累加至放不下即换页；重复表头行每页先占高；单行高超可用页高时该行独占一页按原样输出（不截断行）。
  - fixrows：每页数据行数 = `fixRows − headerRepeatRows`，按行数切页不看行高；未满额的页（末页、分组提前换页的中间页）补空白行使各页行数一致（套打行栅格）。
  - groupBreakBy：列值变化处提前收页/切页，两模式通用。
  - fit-width：先按内容宽（列宽和）算缩放系数，行高按系数折算后再累加。
  - 空表（数据行数为 0）返回空页列表；`buildDocumentHtml` 对空表输出单页兜底（重复表头照常、无数据行）。
- `buildDocumentHtml(config?): string` — 完整文档 HTML：分页 → 各页拼装（页眉 + 表格体 + 页脚 + 水印层）；全页共享同一时间戳（同一次打印的 `{date}/{time}` 一致）。
- `print(config?): Promise<void>` — 触 DOM：隐藏 iframe 装载（load 等待上限 5s，超时降级直通）→ 等待文档内图片 decode → 调起打印（缺省 `iframe.contentWindow.print()`，可经 `options.hooks.print` 接管）→ afterprint/print 返回后清理 iframe（幂等）。无 DOM 环境抛 `printPages 需要浏览器 DOM 环境（headless 场景消费 buildPrintDocumentHtml）`。
- `openPreview(config?)` — 预览弹层（触 DOM；缩略列表 + 当前页放大 + 打印按钮）：逐页内容装进独立 iframe 隔离渲染（与真实打印同一份样式）；关闭（按钮/ESC/背景点击/handle.close）幂等清理；打印按钮汇到 `options.hooks` 同一钩子。无 DOM 环境抛 `openPrintPreview 需要浏览器 DOM 环境（headless 场景消费 paginate/buildPrintPageHtml）`。返回句柄 `{ close(): void }`。

## 典型示例

### fitpage + 重复表头 + 页脚页码

```ts
import { createPrintPlugin, type PrintConfig, type PrintSource } from 'infinitable'

const source: PrintSource = {
  name: '月度报表',
  rowCount: 48,
  colCount: 4,
  rowHeight: () => 28,
  colWidth: (col) => [120, 160, 140, 140][col] ?? 100,
  merges: () => [{ startCol: 0, startRow: 0, endCol: 3, endRow: 0 }], // 首行合并作表头
  cellValue: (col, row) => (row === 0 ? '表头' : `${col}-${row}`),
  cellStyle: () => undefined,
  displayValue: (col, row) => (row === 0 ? '表头' : `${col}-${row}`),
}

const config: PrintConfig = {
  paperSize: 'A4',
  headerRepeatRows: 1,
  headerFooter: {
    header: { left: '月度报表', right: '{date} {time}' },
    footer: { center: '第 {page} 页 / 共 {pageCount} 页', right: '合计 {pageSum:3}' },
  },
}

const print = createPrintPlugin({ source, config })
const pages = print.paginate() // 基线 config 生效
console.log(pages.length, pages[0]?.rowRange) // 分页结果（页数与首页行区间）
await print.print() // 调起系统打印
```

### fixrows 套打 + 分组换页

```ts
import { createPrintPlugin, type PrintSource } from 'infinitable'

const source: PrintSource = {
  name: '套打凭证',
  rowCount: 100,
  colCount: 6,
  rowHeight: () => 24,
  colWidth: () => 100,
  merges: () => [],
  cellValue: (col, row) => (col === 0 ? `组${Math.floor(row / 20)}` : row * 6 + col),
  cellStyle: () => undefined,
  displayValue: (col, row) => String(col === 0 ? `组${Math.floor(row / 20)}` : row * 6 + col),
}

const print = createPrintPlugin({
  source,
  config: {
    paging: 'fixrows',
    fixRows: 21, // 每页 21 行 = 1 行表头 + 20 行数据
    headerRepeatRows: 1,
    groupBreakBy: 0, // 第 0 列值变化处强制换页
  },
})

console.log(print.paginate().map((page) => page.blankRows))
// => 每页 20 数据行；组边界提前换页的页 blankRows > 0（补齐行栅格）
```

### 预览弹层 + 打印钩子接管

```ts
import { createPrintPlugin, type PrintConfig, type PrintSource } from 'infinitable'

declare const source: PrintSource
declare const config: PrintConfig

const print = createPrintPlugin({
  source,
  hooks: {
    // 测试注入桩（不弹系统对话框）：
    print: (iframe) => {
      console.log(iframe.srcdoc.length) // 文档 HTML 长度
    },
  },
})

const handle = print.openPreview(config)
document.querySelector<HTMLButtonElement>('#close-preview')!.addEventListener('click', () => {
  handle.close() // 幂等清理弹层
})

await print.print(config) // 桩接管打印触发
```

## 注意事项

> [!WARNING]
> - 0.1.2 起 print 散装函数（`paginate`/`buildPrintDocumentHtml`/`buildPrintPageHtml`/`evaluatePlaceholders`/`renderHeaderFooter`/`printPages`/`openPrintPreview` 与 `PrintPage`/`PrintHooks`/`PrintPreviewHandle` 等类型）不再导出：能力一律经 `createPrintPlugin` 的 handle 方法（`paginate`/`buildDocumentHtml`/`print`/`openPreview`）消费。
> - `print`/`openPreview` 触 DOM：无 DOM 环境（SSR/纯测试）直接抛错（报错原文仍以 `printPages`/`openPrintPreview` 函数名开头）——headless 场景消费 `handle.paginate`/`handle.buildDocumentHtml`。
> - fixrows 模式 `fixRows` 缺省或 ≤ `headerRepeatRows` 抛错（配置错误快速失败），两个报错原文：`fixrows 分页必须配置 fixRows（每页总行数，含重复表头行）`、`fixRows（N）必须大于 headerRepeatRows（M）`。
> - 行高/列宽单位是 px（96dpi），与引擎行列尺寸同口径；mm 纸张换算由内核处理，宿主不要二次换算。
> - `groupBreakBy` 按 `cellValue`（原始值）判定分组，显示链（numFmt 等）不影响换页。
> - 占位符求值对未识别的 `{...}` 原样保留——宿主自定义文案里的花括号不会被清空。
> - `PrintSource.images` 为浮动图列表（与 sheet 插件导出通道的 images 同构），`kind === 'image'` 且 `imageData` 解析到字节才进打印输出。

## 常见问题

### 报错 `printPages 需要浏览器 DOM 环境（headless 场景消费 buildPrintDocumentHtml）`

原因：在 SSR/Node 环境调用了触 DOM 的输出方法（`handle.print` / `handle.openPreview`）。修复：headless 消费纯函数产物，浏览器环境再调 `print`。

```ts
import { createPrintPlugin, type PrintConfig, type PrintSource } from 'infinitable'

declare const source: PrintSource
declare const config: PrintConfig
const print = createPrintPlugin({ source })
const pages = print.paginate(config) // headless：只算分页
const html = print.buildDocumentHtml(config) // headless：只产 HTML（自行上传/内嵌）
```

### fitrows 抛 `fixRows（1）必须大于 headerRepeatRows（1）`

原因：每页总行数不大于重复表头行数，数据行配额为 0。修复：`fixRows` 至少为 `headerRepeatRows + 1`。

```ts
import { createPrintPlugin, type PrintConfig } from 'infinitable'
import type { PrintSource } from 'infinitable'

declare const source: PrintSource
const print = createPrintPlugin({
  source,
  config: {
    paging: 'fixrows',
    headerRepeatRows: 1,
    fixRows: 21, // 修复：21 > 1（每页 20 行数据）
  } satisfies PrintConfig,
})
```
