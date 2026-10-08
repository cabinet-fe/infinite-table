---
title: print 打印插件
description: infinitable 打印插件（headless 内核 + DOM 输出）：paginate 分页（fitpage 行高累加 / fixrows 固定行数、重复表头、分组换页、fit-width 缩放）、buildPrintDocumentHtml 页面 HTML、evaluatePlaceholders 页眉页脚占位符（{page}/{pageSum:COL} 等）、printPages iframe 打印输出与 openPrintPreview 预览弹层；PrintSource 供数适配 SheetStore。
aliases: [print 插件, 打印, 打印预览, paginate, 分页]
keywords: [paginate, PrintPage, PrintConfig, PrintSource, paperSize, A4, orientation, landscape, fitpage, fixrows, headerRepeatRows, groupBreakBy, evaluatePlaceholders, printPages, openPrintPreview, 打印, 分页, 页眉页脚, 套打, 打印预览]
---

# print 打印插件

`infinitable`（plugins 层）导出打印能力（ureport2 双模式移植）：`paginate` 分页引擎（headless 纯函数零 DOM）、`buildPrintDocumentHtml`/`buildPrintPageHtml` 页面 HTML 构建（页眉页脚占位符求值 + 表格页 + 水印平铺）、`printPages`（隐藏 iframe 装载 → 调起打印）与 `openPrintPreview`（DOM 预览薄壳）。供数走 `PrintSource` 窄接口（适配 SheetStore 或任意模型）；配置走 `PrintConfig`（纸张/方向/边距/缩放/分页/重复表头/分组换页/页眉页脚/水印）。

## 快速上手

```ts
import { printPages, type PrintConfig, type PrintSource } from 'infinitable'
import type { SheetStore } from 'infinitable'

declare const store: SheetStore

// SheetStore → PrintSource 适配（宿主/适配器供数形态）
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

const config: PrintConfig = {
  paperSize: 'A4',
  orientation: 'portrait',
  headerRepeatRows: 1, // 每页重复第 0 行作表头
  headerFooter: {
    footer: { center: '第 {page} 页 / 共 {pageCount} 页' },
  },
}

await printPages(source, config) // 隐藏 iframe 装载并调起系统打印对话框
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
  watermark?: WatermarkTextConfig
}

// ---- 分页（P1 headless） ----

export interface PrintRowRange {
  start: number
  end: number
}

export interface PrintPage {
  /** 本页数据行区间（源表行号，不含重复表头行；含 start 不含 end） */
  rowRange: PrintRowRange
  /** 每页重复的表头行区间（源表前 N 行）；headerRepeatRows = 0 时为 null */
  headerRows: PrintRowRange | null
  /** 末尾补的空白行数（fixrows 补齐每页行数一致；fitpage 恒 0） */
  blankRows: number
  /** 本页缩放系数（origin 恒 1；fit-width 按可用页宽/内容宽只缩不放） */
  scale: number
}

export function paginate(source: PrintSource, config: PrintConfig): PrintPage[]

// ---- 页面构建（P2） ----

export function buildPrintDocumentHtml(source: PrintSource, config: PrintConfig): string
export function buildPrintPageHtml(
  source: PrintSource,
  config: PrintConfig,
  page: PrintPage,
  pageNumber: number,
  pageCount: number,
): string

// ---- 页眉页脚占位符（P2 headless 纯函数） ----

export interface PlaceholderContext {
  page: number
  pageCount: number
  title: string
  date: string
  time: string
  /** 页级聚合取数：页内数据行在指定列上的数值集合（构建方已滤除非数值） */
  columnNumbers: (col: number) => readonly number[]
}

export function evaluatePlaceholders(text: string, ctx: PlaceholderContext): string
/** 三段式页眉/页脚渲染（left/center/right 各占 1/3 宽）；section 为 null/undefined 返回空串 */
export function renderHeaderFooter(
  section: PrintHeaderFooterSection | null | undefined,
  ctx: PlaceholderContext,
  kind: 'header' | 'footer',
): string

// ---- 输出与预览（触 DOM 环节） ----

export interface PrintHooks {
  /** 打印触发（缺省 iframe.contentWindow.print()）；返回 Promise 时等待其完成后再清理 */
  print?: (iframe: HTMLIFrameElement) => void | Promise<void>
}

export async function printPages(
  source: PrintSource,
  config: PrintConfig,
  hooks?: PrintHooks,
): Promise<void>

export interface PrintPreviewHandle {
  close(): void
}

export function openPrintPreview(
  source: PrintSource,
  config: PrintConfig,
  hooks?: PrintHooks,
): PrintPreviewHandle
```

`PrintConfig` 缺省值：`paperSize: 'A4'`、`orientation: 'portrait'`、`margin: 48px`（四边，`DEFAULT_PRINT_MARGIN_PX`）、`scale: 'origin'`、`paging: 'fitpage'`、`headerRepeatRows: 0`、页眉页脚 section 存在即预留 32px 高（`DEFAULT_HEADER_FOOTER_HEIGHT_PX`，可显式覆盖）。

占位符集：`{page}`/`{pageCount}`/`{date}`（yyyy-MM-dd）/`{time}`（HH:mm）/`{title}`（缺省取 `PrintSource.name`）与页级聚合 `{pageSum:COL}`/`{pageAvg:COL}`/`{pageMax:COL}`/`{pageMin:COL}`（COL 为 0 起列索引）；未识别占位符原样保留（宿主自定义文案不破坏）。聚合：sum 空集为 0，avg/max/min 空集为空串；格式化消除浮点累加尾差（0.1+0.2 → 0.3）。

## 参数说明

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

`paginate(source, config): PrintPage[]` — 同步纯函数零 DOM：

- fitpage：行高（× scale）累加至放不下即换页；重复表头行每页先占高；单行高超可用页高时该行独占一页按原样输出（不截断行）。
- fixrows：每页数据行数 = `fixRows − headerRepeatRows`，按行数切页不看行高；未满额的页（末页、分组提前换页的中间页）补空白行使各页行数一致（套打行栅格）。
- groupBreakBy：列值变化处提前收页/切页，两模式通用。
- fit-width：先按内容宽（列宽和）算缩放系数，行高按系数折算后再累加。
- 空表（数据行数为 0）返回空页列表；`buildPrintDocumentHtml` 对空表输出单页兜底（重复表头照常、无数据行）。

`buildPrintDocumentHtml(source, config): string` — 完整文档 HTML：分页 → 各页拼装；全页共享同一时间戳（同一次打印的 `{date}/{time}` 一致）。

`buildPrintPageHtml(source, config, page, pageNumber, pageCount): string` — 单页片段（页眉 + 表格体 + 页脚 + 水印层）；时间戳取调用时刻，整文档打印用 `buildPrintDocumentHtml` 的共享时间戳口径。

`evaluatePlaceholders(text, ctx): string` — 占位符求值；非法列索引按未识别处理原样保留。

`printPages(source, config, hooks?): Promise<void>` — 触 DOM：隐藏 iframe 装载（load 等待上限 5s，超时降级直通）→ 等待文档内图片 decode → 调起打印（缺省 `iframe.contentWindow.print()`，可经 `hooks.print` 接管）→ afterprint/print 返回后清理 iframe（幂等）。无 DOM 环境抛 `printPages 需要浏览器 DOM 环境（headless 场景消费 buildPrintDocumentHtml）`。

`openPrintPreview(source, config, hooks?): PrintPreviewHandle` — 预览弹层（缩略列表 + 当前页放大 + 打印按钮）：逐页内容 = `buildPrintPageHtml` 片段 + 文档级 CSS 装进独立 iframe 隔离渲染（与真实打印同一份样式）；关闭（按钮/ESC/背景点击/handle.close）幂等清理；打印按钮汇到 `printPages`。无 DOM 环境抛 `openPrintPreview 需要浏览器 DOM 环境（headless 场景消费 paginate/buildPrintPageHtml）`。

## 典型示例

### fitpage + 重复表头 + 页脚页码

```ts
import { paginate, printPages, type PrintConfig, type PrintSource } from 'infinitable'

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

const pages = paginate(source, config)
console.log(pages.length, pages[0]?.rowRange) // 分页结果（页数与首页行区间）
await printPages(source, config)
```

### fixrows 套打 + 分组换页

```ts
import { paginate, type PrintConfig, type PrintSource } from 'infinitable'

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

const config: PrintConfig = {
  paging: 'fixrows',
  fixRows: 21, // 每页 21 行 = 1 行表头 + 20 行数据
  headerRepeatRows: 1,
  groupBreakBy: 0, // 第 0 列值变化处强制换页
}

console.log(paginate(source, config).map((page) => page.blankRows))
// => 每页 20 数据行；组边界提前换页的页 blankRows > 0（补齐行栅格）
```

### 预览弹层 + 打印钩子接管

```ts
import { openPrintPreview, printPages, type PrintHooks } from 'infinitable'
import type { PrintSource, PrintConfig } from 'infinitable'

declare const source: PrintSource
declare const config: PrintConfig

const hooks: PrintHooks = {
  // 测试注入桩（不弹系统对话框）：
  print: (iframe) => {
    console.log(iframe.srcdoc.length) // 文档 HTML 长度
  },
}

const handle = openPrintPreview(source, config, hooks)
document.querySelector<HTMLButtonElement>('#close-preview')!.addEventListener('click', () => {
  handle.close() // 幂等清理弹层
})

await printPages(source, config, hooks) // 桩接管打印触发
```

## 注意事项

> [!WARNING]
> - `printPages`/`openPrintPreview` 触 DOM：无 DOM 环境（SSR/纯测试）直接抛错——headless 场景消费 `paginate`/`buildPrintDocumentHtml`/`buildPrintPageHtml`/`evaluatePlaceholders`。
> - `fixrows` 模式 `fixRows` 缺省或 ≤ `headerRepeatRows` 抛错（配置错误快速失败），两个报错原文：`fixrows 分页必须配置 fixRows（每页总行数，含重复表头行）`、`fixRows（N）必须大于 headerRepeatRows（M）`。
> - 行高/列宽单位是 px（96dpi），与引擎行列尺寸同口径；mm 纸张换算由内核处理，宿主不要二次换算。
> - `groupBreakBy` 按 `cellValue`（原始值）判定分组，显示链（numFmt 等）不影响换页。
> - 占位符求值对未识别的 `{...}` 原样保留——宿主自定义文案里的花括号不会被清空。
> - `PrintSource.images` 为浮动图列表（与 xlsx 导出 `SheetExportSource.images` 同构），`kind === 'image'` 且 `imageData` 解析到字节才进打印输出。

## 常见问题

### 报错 `printPages 需要浏览器 DOM 环境（headless 场景消费 buildPrintDocumentHtml）`

原因：在 SSR/Node 环境调用了触 DOM 的输出函数。修复：headless 消费纯函数产物，浏览器环境再调 `printPages`。

```ts
import { buildPrintDocumentHtml, paginate } from 'infinitable'
import type { PrintSource, PrintConfig } from 'infinitable'

declare const source: PrintSource
declare const config: PrintConfig
const pages = paginate(source, config) // headless：只算分页
const html = buildPrintDocumentHtml(source, config) // headless：只产 HTML（自行上传/内嵌）
```

### fitrows 抛 `fixRows（1）必须大于 headerRepeatRows（1）`

原因：每页总行数不大于重复表头行数，数据行配额为 0。修复：`fixRows` 至少为 `headerRepeatRows + 1`。

```ts
import type { PrintConfig } from 'infinitable'

const config: PrintConfig = {
  paging: 'fixrows',
  headerRepeatRows: 1,
  fixRows: 21, // 修复：21 > 1（每页 20 行数据）
}
```
