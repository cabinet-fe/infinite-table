# 快速开始

本页从一个空页面开始，创建一个 10 万行、可滚动、可编辑的 canvas 表格。示例使用 Vite 和 TypeScript，Vue、React 等框架把挂载代码放进对应的客户端生命周期即可。

## 安装

```bash
bun add infinitable @cat-kit/core
```

npm、pnpm、yarn 等价写法：

```bash
npm install infinitable @cat-kit/core
```

`@cat-kit/core`（`^1.2.1`）是 peer 依赖，必须与 `infinitable` 一起安装。公式引擎的四则运算和 `SUM` / `AVERAGE` / `ROUND` / `ABS` 精确计算依赖它的 `$n` 能力，漏装会在构建或运行时找不到模块。

::: tip 可选依赖
只有使用单元格图表时才需要图表运行时。图表插件在首次出图时动态加载 Chart.js：

- 从 npm 安装的 `infinitable` 发布产物已将 Chart.js 打入独立动态 chunk，通常无需单独安装。
- 如果从源码消费 `@infinitable/plugins` 或自行装配插件包，需要安装 Chart.js v4：

```bash
bun add chart.js
```

未启用图表插件时不会触发加载，主产物也不包含 Chart.js 代码。
:::

## 准备容器

四层 canvas 会以绝对定位叠放在容器内，容器必须是非 `static` 定位，否则画布会相对页面而不是容器定位。

```html
<!-- index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>infinitable 快速开始</title>
    <style>
      #table {
        position: relative;
        width: 800px;
        height: 400px;
      }
    </style>
  </head>
  <body>
    <div id="table"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```css
/* 也可以放在独立样式文件中 */
#table {
  position: relative;
  width: 800px;
  height: 400px;
}
```

## 创建表格

```ts
// src/main.ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!

const table = new ListTable({
  // 视口尺寸（CSS 像素），不是数据量
  width: 800,
  height: 400,
  columns: [
    { field: 'name', title: '名称', width: 200 },
    { field: 'score', title: '分数', width: 120 },
  ],
  records: Array.from({ length: 100_000 }, (_, i) => ({
    name: `行 ${i}`,
    score: i,
  })),
  // 未注入 host 时，引擎按此创建 RenderHost 并挂载四层 canvas
  hostOptions: { container },
})

// 鼠标滚轮不由引擎内置，需要宿主接线到 scrollBy
container.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    table.scrollBy(event.deltaX, event.deltaY)
  },
  { passive: false },
)

window.addEventListener('beforeunload', () => {
  table.destroy()
})
```

说明：

- `width` / `height` 是表格视口尺寸。数据量由 `records.length`、`model.rowCount` 或 `rowCount` 决定。
- `hostOptions: { container }` 让 `ListTable` 自建并持有 `RenderHost`，`destroy()` 会一并清理画布和事件。
- 触控滚动、键盘方向键和画布内建滚动条已内置；鼠标滚轮需要像上面这样接线。
- 每一列只有声明了 `field` 才会从 `records` 行对象中取对应字段的值。

启动开发服务器：

```bash
bunx vite --open
```

页面打开后应看到列头和行号列。滚动到任意位置，可视窗口始终只包含视口内的行列；在浏览器控制台可以查询当前窗口：

```ts
table.getVisibleRange() // => { rows: { start, end }, cols: { start, end } }
table.getCellText(0, 0) // => '行 0'
```

## 数据供给三形态

`ListTable` 支持三种数据形态，任选一种，也可以叠加按格 hook。

### records 数组

适合只读展示或简单回写。每列用 `field` 指定取值字段。

```ts
const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { field: 'name', title: '名称', width: 200 },
    { field: 'score', title: '分数', width: 120 },
  ],
  records: [
    { name: 'A', score: 90 },
    { name: 'B', score: 85 },
  ],
  hostOptions: { container },
})
```

### model 模型直挂

适合需要编辑回写的场景。模型实现 `TableModel` 接口，表格按格 O(1) 取值、回写和订阅变更。内置 `SheetModel` 是一个按坐标存取的内存模型。

```ts
import { ListTable, SheetModel } from 'infinitable'

const model = new SheetModel(100_000, 2)
model.setCellValue(0, 0, '行 0')
model.setCellValue(1, 0, 42)

const table = new ListTable({
  width: 800,
  height: 400,
  columns: [
    { title: '名称', width: 200 },
    { title: '数值', width: 120 },
  ],
  model,
  hostOptions: { container },
})

// 表格回写模型：该格局部刷新，模型同步 echo 的派生格也会被收集刷新
table.updateCell(1, 0, 100)
```

也可以实现自己的 `TableModel`：

```ts
import type { CellChangeEvent, TableModel } from 'infinitable'

const data: string[][] = Array.from({ length: 100_000 }, () => ['', ''])
const listeners = new Set<(change: CellChangeEvent) => void>()

const model: TableModel = {
  get rowCount() {
    return data.length
  },
  getCellValue(col, row) {
    return data[row]?.[col]
  },
  setCellValue(col, row, value) {
    const oldValue = data[row]?.[col]
    if (!data[row]) return
    data[row]![col] = String(value ?? '')
    // 通知订阅者，表格会局部刷新
    for (const listener of listeners) {
      listener({ col, row, oldValue, newValue: value })
    }
  },
  onCellChange(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
```

`model` 形态下，外部直接调用 `setCellValue` 触发的变更会经 `onCellChange` 订阅自动局部刷新；`table.updateCell` 的回写产生的同步 echo 由引擎收集去重，不会形成回环。

### rowCount + resolveDisplayValue 钩子

适合数据不在内存中、按格懒取值的场景。不分配行对象，由钩子同步返回显示文本。

```ts
import { ListTable } from 'infinitable'

const table = new ListTable({
  width: 1280,
  height: 720,
  columns: Array.from({ length: 20 }, (_, col) => ({
    title: `列${col}`,
    width: 100,
  })),
  rowCount: 1_000_000,
  resolveDisplayValue: (col, row) => `${col}-${row}`,
  hostOptions: { container },
})
```

行数优先级：

1. 有 `model` 时取 `max(model.rowCount ?? 0, rowCount)`。
2. 否则有 `records` 时取 `records.length`。
3. 否则取 `rowCount`。

无论基础值来自哪种形态，`resolveDisplayValue` 都作用在取值管线末端，返回最终显示文本。要求纯函数、同步、O(1)，滚动帧会按可见格高频调用。

## 常用后续步骤

- [数据供给与模型](/guide/data-models)：三种数据形态的细节与选型。
- [交互与编辑](/guide/interaction-editing)：选区、键盘导航、编辑器注册表。
- [主题与样式](/guide/theming)：主题 token、列级样式、按格样式钩子。
- [渲染管线与失效模型](/guide/rendering-pipeline)：理解滚动为什么只重绘一条带。
- [性能与虚拟滚动](/guide/performance)：十万到百万行的选型与写入方式。
- [插件开发](/guide/plugin-development)：图表、水印、打印与自定义插件。
- [公式引擎](/guide/formulas)：A1 解析、求值与依赖图。
- [电子表格（sheet）](/guide/sheet)：`Sheet`、`Workbook`、`SheetGrid` 与 xlsx IO。
- [ListTable API](/api/list-table)：构造选项与实例方法的完整清单。

## SSR 与无 window 环境

表格实例绑定 canvas、DOM 事件和编辑器浮层，**只能在浏览器端构造**。在 Next.js、Nuxt 等 SSR 框架中：

- 把构造代码放在 `useEffect`、`onMounted` 或客户端组件中，不要在模块顶层直接 `new ListTable`。
- 需要延迟加载时使用动态 `import()`，并加 `typeof window !== 'undefined'` 守卫。
- `container` 未提供时 `createRenderHost` 进入离屏模式：只创建画布、不挂 DOM，适合测试和预渲染断言。
- 无 `window` 时 DPR 回落为 1，帧调度退化为 `setTimeout(16)`；默认 canvas 工厂仍依赖 `document`，纯 Node 环境需要注入 `createCanvas`。
- `openCellLinkOnClick` 默认在单击链接时打开 URL，无 `window` 环境会静默跳过。

```ts
import { ListTable } from 'infinitable'

const columns = [{ field: 'name', title: '名称', width: 200 }]
const records = [{ name: 'A' }]

if (typeof window !== 'undefined') {
  const container = document.querySelector<HTMLDivElement>('#table')!
  const table = new ListTable({
    width: 800,
    height: 400,
    columns,
    records,
    hostOptions: { container },
  })
  // 客户端卸载时销毁
  window.addEventListener('beforeunload', () => table.destroy())
}
```

::: warning
`ListTable.destroy()` 是幂等的。销毁后再次调用渲染或查询方法行为未定义，需要重新构造实例。注入了外部 `host` 时，`ListTable` 不会销毁该 host，需要宿主自行调用 `host.destroy()`。
:::
