# 打印

这篇教程用 print 插件把一张销售明细输出为 A4 分页报表：每页重复表头、按地区强制换页、页脚显示页码与本页合计，并演示打印输出和 DOM 预览。打印内核是 headless 的，分页与 HTML 构建不依赖 DOM；只有真正调起打印和打开预览弹层时才触碰浏览器。

<script setup>
import PrintDemo from '../.vitepress/theme/components/PrintDemo.vue'
import DemoBlock from '../.vitepress/theme/components/DemoBlock.vue'
</script>

## 在线演示

下方表格与打印结果共用同一个 `PrintSource`。点「DOM 预览」可以不调起系统打印就查看分页结果；点「打印」会打开浏览器打印对话框。切换到「源码」可以直接查看这个演示的完整实现。

<DemoBlock>

<PrintDemo />

<template #source>

<<< @/.vitepress/theme/components/PrintDemo.vue

</template>

</DemoBlock>

## 场景说明

- 屏上表格用于查看，打印结果用于归档或交付，两者共用同一份数据。
- 报表需要固定纸张、重复表头、页脚页码和本页小计。
- 业务侧可能先在服务端算好分页，也可能直接在浏览器里打开预览。
- 打印内容必须独立于宿主页面样式，不能把导航栏、按钮一起打出来。

## 数据源设计

print 插件不直接读取 `ListTable`，而是消费一个窄接口 `PrintSource`：

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

行高、列宽单位都是 px（96dpi），与引擎的行列尺寸同口径。`cellValue` 是分组换页和页级聚合的原始值口径；`displayValue` 是页面渲染口径。屏上表格与打印可以共用同一组取值函数。

## HTML 与容器

```html
<div id="table"></div>
<div class="actions">
  <button id="print">打印</button>
  <button id="preview">预览</button>
</div>
```

```css
#table {
  position: relative;
  width: 800px;
  height: 360px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
```

## 完整代码

```ts
// src/main.ts
import {
  createPrintPlugin,
  ListTable,
  type CellStyle,
  type PrintConfig,
  type PrintSource,
} from 'infinitable'

const ROW_COUNT = 61
const COL_COUNT = 5
const ROW_HEIGHT = 28
const COL_WIDTHS = [140, 160, 180, 160, 160] as const
const HEADER_REPEAT_ROWS = 1
const REGIONS = ['华东', '华北', '华南']

// 每 20 行一个地区，配合 groupBreakBy 演示分组换页
function regionOf(row: number): string {
  const index = Math.min(REGIONS.length - 1, Math.floor((row - 1) / 20))
  return REGIONS[index] ?? ''
}

function cellValue(col: number, row: number): unknown {
  if (row === 0) {
    return col === 0 ? '2026 Q3 销售明细' : ''
  }
  if (col === 0) return row
  if (col === 1) return regionOf(row)
  if (col === 2) return ['办公用品', '家居生活', '数码电器'][row % 3]
  if (col === 3) return 180 + ((row * 37) % 220)
  const rate = ((row % 5) - 2) * 2.1
  return `${rate > 0 ? '+' : ''}${rate.toFixed(1)}%`
}

const headerStyle: CellStyle = {
  background: '#eef2f7',
  fontWeight: 700,
  textAlign: 'center',
  border: { bottom: { width: 2, color: '#64748b' } },
}

function cellStyle(col: number, row: number): CellStyle | undefined {
  if (row === 0) return headerStyle
  if (col === 4 && String(cellValue(col, row)).startsWith('-')) {
    return { color: '#dc2626' }
  }
  return undefined
}

// 1) 打印数据源：60 行数据 + 1 行合并表头
const source: PrintSource = {
  name: '2026 Q3 销售明细',
  rowCount: ROW_COUNT,
  colCount: COL_COUNT,
  rowHeight: () => ROW_HEIGHT,
  colWidth: (col) => COL_WIDTHS[col] ?? 100,
  merges: () => [{ startCol: 0, startRow: 0, endCol: 4, endRow: 0 }],
  cellValue,
  cellStyle,
  displayValue: cellValue,
}

// 2) 打印配置：A4 纵向、固定边距、宽度自适应、重复表头、按地区换页
const config: PrintConfig = {
  paperSize: 'A4',
  orientation: 'portrait',
  margin: { top: 36, right: 40, bottom: 36, left: 40 },
  // 内容宽 800px 超过 A4 可用页宽时等比缩小；只缩不放
  scale: 'fit-width',
  paging: 'fitpage',
  headerRepeatRows: HEADER_REPEAT_ROWS,
  // 第 1 列（地区）值变化处强制换页，原始值口径
  groupBreakBy: 1,
  headerFooter: {
    header: { left: '销售明细', right: '{date} {time}' },
    footer: {
      center: '第 {page} 页 / 共 {pageCount} 页',
      right: '本页合计 {pageSum:3}',
    },
  },
  watermark: { enabled: true, text: '内部资料', opacity: 0.08 },
}

const printPlugin = createPrintPlugin({ source, config })

// 3) 屏上只读预览表：与打印共用同一个 PrintSource
const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 800,
  height: 360,
  columns: COL_WIDTHS.map((width) => ({ title: '', width })),
  rowCount: ROW_COUNT,
  rowHeight: ROW_HEIGHT,
  resolveDisplayValue: (col, row) => String(cellValue(col, row) ?? ''),
  resolveCellStyle: (col, row) => cellStyle(col, row) ?? null,
  showColHeader: false,
  showRowHeader: false,
  // print 插件 mount 没有表侧副作用；注册在这里只为演示插件装配路径
  plugins: [printPlugin],
  hostOptions: { container },
})

table.setMergeCells(source.merges())
table.setFrozenRowCount(HEADER_REPEAT_ROWS)

container.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    table.scrollBy(event.deltaX, event.deltaY)
  },
  { passive: false },
)

// 4) 打印输出：隐藏 iframe 装载完整文档后调起浏览器打印
document.querySelector<HTMLButtonElement>('#print')!.addEventListener('click', () => {
  void printPlugin.print(config)
})

// 5) DOM 预览：缩略列表 + 当前页放大 + 打印按钮
document.querySelector<HTMLButtonElement>('#preview')!.addEventListener('click', () => {
  const preview = printPlugin.openPreview(config)
  // 预览自带关闭按钮、ESC 与背景点击关闭；需要程序化关闭时调用 preview.close()
  void preview
})

window.addEventListener('beforeunload', () => {
  table.destroy()
})
```

## 关键点

### 分页先算，页面再构建

handle 提供三个层次的方法：

```ts
const pages = printPlugin.paginate(config) // 纯函数，零 DOM
const html = printPlugin.buildDocumentHtml(config) // 完整文档 HTML，零 DOM
await printPlugin.print(config) // 触 DOM：iframe + 浏览器打印
const preview = printPlugin.openPreview(config) // 触 DOM：预览弹层
```

`paginate` 返回的每页包含：

```ts
{
  rowRange: { start, end }, // 本页数据行区间，源表行号，含 start 不含 end
  headerRows: { start, end } | null, // 每页重复的表头行区间
  blankRows: number, // fixrows 补齐的空白行数；fitpage 恒 0
  scale: number, // origin 为 1；fit-width 按可用页宽/内容宽只缩不放
  colRange: { start, end }, // 本页列区间；超宽表横向分页时使用
}
```

`print` 和 `openPreview` 在无 DOM 环境（SSR、Node 测试）会直接抛错。服务端只消费 `paginate` / `buildDocumentHtml`。

### PrintConfig 字段

| 字段                    | 类型                                                        | 缺省         | 说明                                              |
| ----------------------- | ----------------------------------------------------------- | ------------ | ------------------------------------------------- |
| `paperSize`             | `'A3' \| 'A4' \| 'A5' \| 'Letter' \| { widthMm, heightMm }` | `'A4'`       | 纸张预设或自定义 mm 尺寸，纵向口径                |
| `orientation`           | `'portrait' \| 'landscape'`                                 | `'portrait'` | 横向时宽高交换                                    |
| `margin`                | `number \| { top, right, bottom, left }`                    | `48`         | 单位 px，单值表示四边同距                         |
| `scale`                 | `'origin' \| 'fit-width' \| { percent }`                    | `'origin'`   | `fit-width` 只缩不放；自定义百分比有效范围 1–1000 |
| `paging`                | `'fitpage' \| 'fixrows'`                                    | `'fitpage'`  | 按行高累加或按固定行数分页                        |
| `fixRows`               | `number`                                                    | —            | `fixrows` 时必填，每页总行数（含重复表头）        |
| `headerRepeatRows`      | `number`                                                    | `0`          | 每页重复源表前 N 行                               |
| `groupBreakBy`          | `number \| readonly number[]`                               | 不分组       | 列值变化处强制换页，原始值口径                    |
| `rowRange` / `colRange` | `{ start, end }`                                            | 全表         | 打印数据行域 / 列域，含 start 不含 end            |
| `headerFooter`          | `PrintHeaderFooterConfig`                                   | 不预留       | 页眉页脚三段文本与预留高度                        |
| `watermark`             | `WatermarkTextConfig`                                       | 不平铺       | 与水印插件同一配置模型，`enabled` 才平铺          |

### 分页模式

- `paging: 'fitpage'`（缺省）：按行高累加，放不下就换页。重复表头每页先占高；单行高于可用页高时该行独占一页，不截断。
- `paging: 'fixrows'`：按固定行数切页，适合套打。每页数据行数 = `fixRows − headerRepeatRows`，未满额的页补 `blankRows`。`fixRows` 缺省或不大于 `headerRepeatRows` 会抛错。
- `groupBreakBy`：指定列的原始值变化处强制换页，两种分页模式都适用。传单列索引或索引数组。
- 横向分页：列宽和超过可用页宽时按列切带，页序是行带在外、列带在内；跨列带的合并格按带裁剪。`fit-width` 缩放后通常不会触发横向分页。
- `rowRange` / `colRange`：可只打印数据行域或列域，区间越界会夹取，空或倒置区间返回空页列表。

套打示例：

```ts
const config: PrintConfig = {
  paging: 'fixrows',
  fixRows: 21, // 每页 21 行 = 1 行重复表头 + 20 行数据
  headerRepeatRows: 1,
  groupBreakBy: 0,
}
```

### 页眉页脚占位符

页眉页脚是 left / center / right 三段式，section 存在即预留 32px 高度（可显式覆盖）：

```ts
headerFooter: {
  header: { left: '销售明细', right: '{date} {time}' },
  footer: {
    center: '第 {page} 页 / 共 {pageCount} 页',
    right: '本页合计 {pageSum:3}',
  },
}
```

支持的占位符：

| 占位符          | 含义                            |
| --------------- | ------------------------------- |
| `{page}`        | 当前页码，从 1 开始             |
| `{pageCount}`   | 总页数                          |
| `{date}`        | 本地日期，`yyyy-MM-dd`          |
| `{time}`        | 本地时间，`HH:mm`               |
| `{title}`       | 标题，缺省取 `PrintSource.name` |
| `{pageSum:COL}` | 本页数据行在指定列上的数值合计  |
| `{pageAvg:COL}` | 本页平均值                      |
| `{pageMax:COL}` | 本页最大值                      |
| `{pageMin:COL}` | 本页最小值                      |

`COL` 是 0 起列索引。聚合只统计本页数据行里的有限数值，非数值项会被过滤；`pageSum` 空集为 `0`，`pageAvg` / `pageMax` / `pageMin` 空集为空串。未识别的 `{...}` 原样保留，宿主自定义文案不会被清空。

### 打印输出与 iframe

`print(config)` 的流程是：

1. 构建完整文档 HTML；
2. 创建一个离屏隐藏 iframe（`position: fixed; left: -10000px`），用 `srcdoc` 装载文档；
3. 等待 `load`，最多 5 秒，超时降级继续；
4. 调起 `iframe.contentWindow.print()`，或调用 `options.hooks.print`；
5. 等待 `afterprint` 清理 iframe，并设置 60 秒兜底定时器。

使用钩子接管打印触发，便于测试或不弹系统对话框：

```ts
const printPlugin = createPrintPlugin({
  source,
  config,
  hooks: {
    print: (iframe) => {
      console.log('文档 HTML 长度', iframe.srcdoc.length)
    },
  },
})
```

文档级 CSS 包含 `@page` 纸张、方向和边距，以及 `print-color-adjust: exact`，所以背景色、表头底纹和水印可以正常打印。iframe 文档与宿主页面隔离，导航栏和按钮不会进入打印结果。

### DOM 预览

`openPreview(config)` 打开一个轻量弹层：左侧缩略页列表，右侧当前页放大预览，底部打印按钮。逐页内容装进独立 iframe 隔离渲染，与真实打印使用同一份样式。

```ts
const preview = printPlugin.openPreview(config)

// 关闭方式：弹层按钮、ESC、点击背景，或程序化调用
preview.close()
```

预览内的打印按钮复用同一个 `hooks.print`。

## 常见坑

::: warning fixrows 的两个硬性约束
`fixRows` 必须配置，且必须大于 `headerRepeatRows`：

```ts
paging: 'fixrows',
fixRows: 21,
headerRepeatRows: 1, // 21 > 1，合法
```

否则会抛 `fixrows 分页必须配置 fixRows（每页总行数，含重复表头行）` 或 `fixRows（N）必须大于 headerRepeatRows（M）`。
:::

- **把 mm 再换算一次**：`PrintSource` 的行高/列宽已经是 px（96dpi），纸张 mm 到 px 的换算由内核完成。宿主不要二次换算。
- **`headerRepeatRows` 取错来源**：它取的是 `PrintSource` 的前 N 行，不是屏上 `columns` 的表头。报表表头必须作为源表的前几行存在。
- **用显示值判断分组**：`groupBreakBy` 按 `cellValue` 原始值判定，显示链（格式、前缀、百分号）不影响换页。
- **在服务端调用 `print`**：`print` / `openPreview` 需要浏览器 DOM，SSR 场景只能消费 `paginate` / `buildDocumentHtml`。
- **自己写 iframe 用 `display: none`**：部分 WebKit 版本会打印空白。插件的实现是离屏定位而不是隐藏，自己实现时要避开 `display: none` 和 `visibility: hidden`。
- **打印完后立即移除 iframe**：Firefox / Safari 的 `print()` 是异步返回的，立刻移除会截断打印任务。插件交给 `afterprint` 和兜底定时器清理。
- **以为浮动图会打印**：`PrintSource` 只提供表格值、样式、合并和行列几何，浮动图片不进入打印输出。
- **`{pageSum:3}` 列索引写成 1 起**：列索引从 0 开始，写错列会聚合到别的列或返回空集。
- **打开预览后不关闭**：每个预览页是一个独立 iframe。宿主切换页面或销毁表格时要调用 `preview.close()`。

继续阅读[插件开发](/guide/plugin-development)了解插件契约，或看[API：插件](/api/plugins)查阅 print / chart / watermark 的完整类型。
