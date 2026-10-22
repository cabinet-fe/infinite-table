# 基础表格

这篇教程从空页面开始，构造一个 10 万行、可滚动、冻结首列、带轻量主题的 `ListTable`。示例只使用 records 数组，不涉及编辑和插件，适合作为接入新项目的起点。

<script setup>
import BasicTableDemo from '../.vitepress/theme/components/BasicTableDemo.vue'
import DemoBlock from '../.vitepress/theme/components/DemoBlock.vue'
</script>

## 在线演示

下面的表格是真实运行的 `ListTable` 实例，不是截图：可以滚轮滚动、拖拽滚动条、键盘导航，也可以输入行号跳转。切换到「源码」可以直接查看这个演示的完整实现。

<DemoBlock>

<BasicTableDemo />

<template #source>

<<< @/.vitepress/theme/components/BasicTableDemo.vue

</template>

</DemoBlock>

## 场景说明

- 数据已经在浏览器内存里，以对象数组形式提供，每行一条记录。
- 只需要展示和滚动，不需要回写数据。
- 用户期望用鼠标滚轮、键盘方向键和内置滚动条都能滚动。
- 页面卸载时销毁表格，避免 canvas 和事件监听残留。

## HTML 与容器

四层 canvas 会绝对定位叠放在容器内，容器必须是非 `static` 定位，并且宽高与构造参数一致。

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>infinitable 基础表格</title>
    <style>
      html,
      body {
        margin: 0;
      }

      #table {
        /* 四层 canvas 以绝对定位叠放在容器内，static 会让画布跑到页面左上角 */
        position: relative;
        width: 800px;
        height: 420px;
        margin: 24px;
      }
    </style>
  </head>
  <body>
    <div id="table"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

## 完整代码

```ts
// src/main.ts
import { ListTable } from 'infinitable'

const container = document.querySelector<HTMLDivElement>('#table')!

const table = new ListTable({
  // 视口尺寸（CSS 像素），不是数据规模
  width: 800,
  height: 420,
  columns: [
    { field: 'id', title: '编号', width: 120 },
    { field: 'name', title: '名称', width: 200 },
    { field: 'qty', title: '数量', width: 100 },
    { field: 'price', title: '单价', width: 120 },
  ],
  // records 形态：行数取 records.length，构造只处理可视窗口
  records: Array.from({ length: 100_000 }, (_, row) => ({
    id: `ID-${row}`,
    name: `商品-${row}`,
    qty: row % 97,
    price: ((row * 13) % 500) + 1,
  })),
  // 冻结左侧第一列（数据列，不含行号列）
  frozenColCount: 1,
  // 主题覆盖会与默认主题深合并，未覆盖的 token 保持不变
  theme: {
    header: { background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 },
    body: { borderColor: '#e2e8f0' },
  },
  // 引擎经 hostOptions 自建 RenderHost，并把四层 canvas 挂进容器
  hostOptions: { container },
})

/**
 * 鼠标滚轮接线：引擎内置触控惯性、键盘导航和内建滚动条，
 * 但鼠标滚轮需要宿主自己转发到 scrollBy。
 * 原生滚动条模式下浏览器滚动容器已经接管滚轮，必须让位，避免双滚。
 */
function attachWheel(target: HTMLElement, table: ListTable): () => void {
  if (table.usesNativeScrollbar) {
    return () => {}
  }
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    table.scrollBy(event.deltaX, event.deltaY)
  }
  target.addEventListener('wheel', onWheel, { passive: false })
  return () => target.removeEventListener('wheel', onWheel)
}

const detachWheel = attachWheel(container, table)

// 框架宿主中，把这段清理放进组件卸载生命周期
window.addEventListener('beforeunload', () => {
  detachWheel()
  table.destroy()
})
```

## 关键点

### 列定义与记录数据

`columns` 的 `field` 指向 records 对象上的字段名。字段名不匹配时该列显示为空，不会报错。列宽缺省使用 `defaultColWidth`（默认 100），也可以用 `width` 逐列覆盖。

```ts
columns: [
  { field: 'id', title: '编号', width: 120 },
  { field: 'name', title: '名称', width: 200 },
]
```

如果某列不需要从 records 取值，可以只给 `title`，再配合 `resolveDisplayValue` 按格生成文本，这属于大数据量页介绍的纯钩子形态。

### 虚拟窗口

构造和首帧只处理可视窗口内的行列。10 万行与 100 行的构造成本差异主要来自行高、列宽前缀和的一次性计算，不来自逐行创建 DOM 或场景节点。滚动时只有新滚入窗口的行列会建节点，滚动位置不变时不会重绘整表。

### 滚动接线

引擎内置的滚动能力包括：

- 触控板与触屏惯性滚动；
- 方向键、Tab / Shift+Tab 的焦点移动与滚动跟随；
- 画布内建滚动条：拖滑块、点轨道跳转；
- 程序化滚动 `scrollTo` / `scrollBy`。

鼠标滚轮不在内置范围内，必须由宿主接线，并且要 `preventDefault()` + `passive: false`，否则页面会跟着一起滚动。

内建滚动条默认是 `hover` 档：指针悬停表格或滚动时显示，静止后隐藏。需要常驻时显式传 `scrollbar: true`，需要固定延时隐藏时传对象：

```ts
scrollbar: { visibility: 'scrolling', hideDelay: 600 }
```

需要浏览器原生滚动条外观和触控板惯性时，使用原生档：

```ts
scrollbar: {
  mode: 'native'
}
```

原生档下滚轮由浏览器滚动容器接管，`attachWheel` 里的 `table.usesNativeScrollbar` 判定就是用来跳过宿主接线的。

### 主题轻改

`theme` 是 `ThemeOverride`，会与默认主题深合并。常用 token 分区有 `body`、`header`、`rowHeader`、`corner` 与 `interaction`。

```ts
theme: {
  header: { background: '#dbeafe', color: '#1d4ed8', fontWeight: 600 },
  body: { borderColor: '#e2e8f0' },
}
```

运行时切换主题调用 `updateTheme`，它以当前主题为基准继续深覆盖，不重建实例：

```ts
table.updateTheme({
  header: { background: '#fef3c7', color: '#92400e' },
  body: { borderColor: '#fde68a' },
})
```

::: tip
`updateTheme` 不会重新计算已经生效的 `rowHeight`、`headerHeight`、`rowHeaderWidth`、`defaultColWidth` 等几何值。运行时改行列尺寸请用 `setRowHeight` / `setColWidth`。
:::

### 销毁

`destroy()` 是幂等的，重复调用安全。使用 `hostOptions` 让引擎自建宿主时，`destroy()` 会同时销毁该宿主；如果构造时注入的是自己的 `host`，引擎不会销毁它，需要宿主自行管理。

销毁后不要继续调用渲染相关方法。需要在同一容器里重新展示时，重新 `new ListTable(...)`。

## 常见坑

::: warning 容器定位
`#table` 使用 `position: static` 时，四层 canvas 会相对页面而不是容器定位，表现为表格跑到页面左上角或尺寸错乱。容器必须是 `relative`、`absolute` 或 `fixed`。
:::

- **漏装 `@cat-kit/core`**：它是 peer 依赖，必须与 `infinitable` 一起安装，否则公式相关模块会找不到依赖。
- **只接了滚轮但没有清理**：在 SPA 里切换页面时，`wheel` 监听仍挂在旧容器上。把 `detachWheel()` 和 `table.destroy()` 一起放进卸载逻辑。
- **把数据量当成 `height`**：`height` 只是视口高度。100 万行不需要 100 万像素高的容器，虚拟滚动只需要一个固定高度视口。
- **records 字段名写错**：`field` 与对象键不一致时该列静默为空。先确认每行的键名。
- **原生滚动条模式下仍强行接滚轮**：会拦截浏览器原生滚动并造成双滚。接线前判断 `table.usesNativeScrollbar`。
- **销毁后复用实例**：`destroy()` 之后实例不再可用，不能指望再次 `scrollTo` 或改数据就恢复渲染。

下一步可以看[大数据量](/examples/large-data)了解 100 万行与批量写入，或看[可编辑表格](/examples/editing)把 records 换成可回写的模型。
