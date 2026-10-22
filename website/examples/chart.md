# 图表与图片

这篇教程把三类媒体能力放进同一张表：chart 插件在单元格内渲染柱状、折线、面积和饼图；`resolveCellImage` 渲染嵌入图片；`floatObjects` 渲染可拖动、可缩放旋转的浮动图片。水印插件作为附加小节，覆盖在内容之上且锚定视口。

<script setup>
import ChartDemo from '../.vitepress/theme/components/ChartDemo.vue'
import DemoBlock from '../.vitepress/theme/components/DemoBlock.vue'
</script>

## 在线演示

四类图表格位图由 chart 插件实时出图，首次加载 Chart.js 后即可滚动复用缓存；「开启水印」会挂载 watermark 插件并立即重绘 sky 层。切换到「源码」可以直接查看这个演示的完整实现。

<DemoBlock>

<ChartDemo />

<template #source>

<<< @/.vitepress/theme/components/ChartDemo.vue

</template>

</DemoBlock>

## 场景说明

- 报表需要在单元格内直接展示趋势图，而不是跳到独立图表页。
- 长列表滚动时图表不能每次都重新加载，需要位图缓存命中。
- 图片列与图表列共存，但同一格只显示一种媒体。
- 浮动图片需要跟随滚动，拖拽和缩放结束后写回宿主模型。

## 依赖说明

从 npm 安装发布包时，只需要：

```bash
bun add infinitable @cat-kit/core
```

不需要单独安装 `chart.js`。发布产物已经把 Chart.js 打进独立的动态 chunk，只有在首次真正出图时才异步加载；未使用图表插件时不会加载，也不会进入主产物。

::: tip 从源码消费时
如果在本仓库内直接消费 `@infinitable/plugins` 源码或自行装配插件包，需要安装 Chart.js v4：

```bash
bun add chart.js
```

插件内部执行 `import('chart.js')` 后会调用 `Chart.register(...registerables)`，所以不要注入未注册控制器的自定义模块。
:::

## HTML 与容器

```html
<div id="table"></div>
<button id="toggle-watermark">切换水印</button>

<div id="table-scroll"></div>
```

```css
#table,
#table-scroll {
  position: relative;
  margin-bottom: 16px;
}

#table {
  width: 920px;
  height: 320px;
}

#table-scroll {
  width: 720px;
  height: 360px;
}
```

## 完整代码：四类图表、图片格、浮动对象与水印

```ts
// src/main.ts
import { createChartPlugin, createWatermarkPlugin, ListTable } from 'infinitable'

const labels = ['一月', '二月', '三月', '四月']

// 1) 图表插件：按格返回声明，返回 null 的格走常规文本/图片管线
const chartPlugin = createChartPlugin({
  resolveCellChart: (col, row) => {
    const shift = row * 10
    if (col === 1) {
      return {
        type: 'bar',
        labels,
        datasets: [
          { label: '本年', data: [12 + shift, 26 + shift, 18 + shift, 32 + shift] },
          { label: '上年', data: [18 + shift, 14 + shift, 24 + shift, 20 + shift] },
        ],
      }
    }
    if (col === 2) {
      return {
        type: 'line',
        labels,
        // null 是折线断点缺口，不是 0
        datasets: [{ label: '趋势', data: [8 + shift, null, 22 + shift, 30 + shift] }],
      }
    }
    if (col === 3) {
      return {
        type: 'area',
        labels,
        datasets: [{ label: '累计', data: [6 + shift, 16 + shift, 12 + shift, 24 + shift] }],
      }
    }
    if (col === 4) {
      return {
        type: 'pie',
        labels,
        // 饼图规范化时只取第一个数据集
        datasets: [{ label: '占比', data: [35, 25, 22, 18] }],
      }
    }
    return null
  },
})

// 2) 水印插件：顶层 overlay 绘制，覆盖内容之上，锚定视口不随滚动
const watermark = createWatermarkPlugin({
  enabled: true,
  text: '内部资料',
  opacity: 0.12,
  rotate: -30,
})

// 3) 内联 SVG 图片：不依赖网络，适合直接复制运行
function imageUrl(label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">
    <rect width="120" height="60" fill="#dbeafe"/>
    <text x="60" y="35" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#1d4ed8">${label}</text>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 920,
  height: 320,
  columns: [
    { title: '指标', width: 120 },
    { title: '柱状', width: 150 },
    { title: '折线', width: 150 },
    { title: '面积', width: 150 },
    { title: '饼图', width: 150 },
    { title: '图片', width: 150 },
  ],
  rowCount: 2,
  // 图表格需要足够高度，110px 在 150px 宽的格内可读
  rowHeight: 110,
  resolveDisplayValue: (col, row) => {
    if (col !== 0) return ''
    return row === 0 ? '营收' : '利润'
  },
  // 图片格：返回 URL 的格整格按图片渲染，不叠加文本
  resolveCellImage: (col, row) => (col === 5 ? imageUrl(`IMG-${row}`) : null),
  plugins: [chartPlugin, watermark],
  hostOptions: { container },
})

// 4) 浮动图片：锚定 (0,0) 到 (1,1)，随滚动帧级跟随
table.floatObjects.add({
  id: 'float-note',
  kind: 'image',
  anchor: {
    from: { col: 0, row: 0 },
    to: { col: 1, row: 1 },
    offsetX: 12,
    offsetY: 12,
  },
  src: imageUrl('浮动图片'),
  title: '浮动图片',
})

// 拖拽与缩放/旋转过程只改渲染态，结束事件里必须写回，否则下次滚动会回到旧位置
table.floatObjects.onDragEnd(({ id, anchor }) => {
  table.floatObjects.update(id, { anchor })
})

table.floatObjects.onTransformEnd(({ id, anchor, size, rotation }) => {
  table.floatObjects.update(id, { anchor, size, rotation })
})

// 5) 水印运行时开关
document.querySelector<HTMLButtonElement>('#toggle-watermark')!.addEventListener('click', () => {
  watermark.updateConfig({ enabled: !watermark.isEnabled() })
})

window.addEventListener('beforeunload', () => {
  table.destroy()
})
```

## 关键点

### 单元格声明

`resolveCellChart` 返回的声明只有「类型 + 数据」：

```ts
interface ChartCellDeclaration {
  type?: unknown // 'bar' | 'line' | 'area' | 'pie'
  labels?: unknown // 字符串数组；省略时按数据序号
  datasets?: unknown // 数据集数组
}
```

- `type` 大小写敏感，非法值按普通格处理。
- `data` 的每个点必须是有限数值或 `null`；`null` 用于折线/面积的断点缺口。
- `area` 归一化为 `line` + `fill`，没有独立的 chart.js 类型。
- `pie` 只使用第一个数据集。
- 配色、动画、图例交互都不在声明里，插件使用确定性的缺省色板并禁用动画，保证离屏出图可复现。

出图流程是：插件在离屏 canvas 上出图，位图落到 core 的 L2 media 层，按「声明内容 key + 格尺寸 + DPR」做 cell 级缓存。滚动滚回命中缓存时直接贴图，不会闪烁。

### 长列表滚动与缓存

长列表应共享身份稳定的声明对象，按行取模或查表返回。这样插件的声明 memo 和位图缓存 key 才能收敛：

```ts
import { createChartPlugin, ListTable, type ChartCellDeclaration } from 'infinitable'

const declarations: ChartCellDeclaration[] = Array.from({ length: 6 }, (_, variant) => ({
  type: 'bar',
  labels: ['一月', '二月', '三月', '四月'],
  datasets: [
    {
      label: '销量',
      data: [20 + variant * 6, 14 + variant * 3, 28 - variant * 2, 18 + variant * 4],
    },
  ],
}))

const scrollChart = createChartPlugin({
  resolveCellChart: (col, row) =>
    col === 1 ? (declarations[row % declarations.length] ?? null) : null,
})

const scrollContainer = document.querySelector<HTMLDivElement>('#table-scroll')!
const scrollTable = new ListTable({
  width: 720,
  height: 360,
  columns: [
    { title: '地区', width: 160 },
    { title: '销量', width: 150 },
  ],
  rowCount: 400,
  rowHeight: 84,
  resolveDisplayValue: (col, row) => (col === 0 ? `地区-${row}` : ''),
  plugins: [scrollChart],
  hostOptions: { container: scrollContainer },
})

scrollContainer.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    scrollTable.scrollBy(event.deltaX, event.deltaY)
  },
  { passive: false },
)
```

声明数据变化后，必须对该格调 `refreshCell`。`resolveCellChart` 是拉取式 hook，引擎不会自动感知声明内部的数据修改：

```ts
// 就地改第一组声明的内容
declarations[0] = {
  type: 'bar',
  labels: ['一月', '二月', '三月', '四月'],
  datasets: [{ label: '销量', data: [40, 32, 18, 26] }],
}

// 只需要刷新当前可视窗口内的图表格；窗外格滚回时会按新声明重新解析
const visible = scrollTable.getVisibleRange().rows
for (let row = visible.start; row < visible.end; row++) {
  scrollTable.refreshCell(1, row)
}
```

调试时可以直接读取解析结果，或预热 Chart.js：

```ts
console.log(chartPlugin.getChartSpec(1, 0)?.type)
// => 'bar'

void chartPlugin.loadLibrary()
// 首次调用触发动态 import('chart.js')，之后共享模块缓存
```

### 图片格

`resolveCellImage` 返回 URL 的格在 L2 media 层按图片渲染，返回 `null` / `undefined` 走常规文本管线。图片格与图表格不能叠加，同一格只会走其中一种。

```ts
resolveCellImage: (col, row) => (col === 5 ? imageUrl(`IMG-${row}`) : null),
```

图片加载是窗口化的：只有视口和余量内的请求会发起，滚出后取消。需要控制缓存预算或注入加载器时使用 `imageServiceOptions`：

```ts
imageServiceOptions: {
  maxCacheBytes: 512 * 1024 * 1024, // 解码位图 LRU 字节预算
  maxCacheCount: 2000, // 条目上限
  concurrency: 16, // 并发加载
  placeholderDelay: 80, // 占位延迟，防快速滚动闪烁
}
```

远程图片需要 CORS 时设置 `crossOrigin`。依赖网络的示例建议换成 data URL 或本地静态资源。

### 浮动对象

`table.floatObjects` 管理格上浮动对象。`kind: 'image'` 会加载 `src`；`'chart'` 和 `'dom'` 目前是预留类型，未加载内容时画占位。

拖拽和变换过程只改渲染态，结束事件才抛给宿主：

```ts
table.floatObjects.onDragEnd(({ id, anchor }) => {
  table.floatObjects.update(id, { anchor })
})

table.floatObjects.onTransformEnd(({ id, anchor, size, rotation }) => {
  table.floatObjects.update(id, { anchor, size, rotation })
})
```

`rotation` 单位是顺时针度数，不是弧度。缩放/旋转手柄支持 Shift 等比与 15° 吸附。

### 水印

`createWatermarkPlugin` 的配置 `enabled` / `text` 必填，其余样式字段有缺省值。水印绘制在 sky 层最顶的 overlay，覆盖内容之上，锚定视口，滚动时不会随内容平移。

```ts
const watermark = createWatermarkPlugin({
  enabled: true,
  text: '内部资料',
  opacity: 0.12,
  rotate: -30,
})
```

运行时更新是浅合并，一帧内重绘：

```ts
watermark.updateConfig({ text: '机密', rotate: -20 })
```

顶层 overlay 是单写方槽位。水印插件和自写 overlay 插件会互相覆盖 painter；需要同时显示水印和角标时，合并成一个 painter 自绘，不要挂两个顶层插件。

## 常见坑

::: warning Chart.js 是否要安装
从 npm 安装 `infinitable` 发布包时不需要单独安装 `chart.js`，它已经在独立动态 chunk 中。只有从源码消费插件包或自行装配插件时才需要 `chart.js` v4。判断标准是运行时是否报模块加载失败或 `bar is not a registered controller`。
:::

- **改了声明数据但表格没变**：`resolveCellChart` 是拉取式 hook，改完数据要对可视格调 `refreshCell`。
- **每格都返回新字面量**：功能上能工作（内容 key 会比对），但长列表会削弱 memo 和缓存命中。共享声明数组，按行取模。
- **图表格还想要文本**：返回声明的格整格按位图渲染，不叠加文本。需要标题就把标题放在相邻列。
- **同一格既返回图片又返回图表**：两者都走 L2 media，同格互斥。按列或按行明确分流。
- **折线用 0 表示缺口**：断点必须用 `null`，`0` 会被画成真实数据点。
- **饼图传了多个数据集**：只会取第一个，其余忽略。
- **浮动对象拖完回弹**：`onDragEnd` / `onTransformEnd` 里没有写回。拖拽过程只改渲染态。
- **水印和角标互相覆盖**：顶层 overlay 只能有一个 painter。多个覆盖内容要合并绘制。
- **`resolveCellImage` 里做异步请求**：这个 hook 必须同步、纯函数、O(1)。网络加载交给 `imageServiceOptions.loadImage` 或默认图片服务。

继续阅读[打印](/examples/print)了解把表格数据输出为分页报表，或看[插件开发](/guide/plugin-development)了解 `TablePlugin` 契约和自定义 painter。
