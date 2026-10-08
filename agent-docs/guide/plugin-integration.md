---
title: infinitable 插件接入
description: infinitable 插件体系实战：TablePlugin 契约（mount/unmount）、构造 plugins 与 table.use 两种注册路径、单元格图表插件（createChartPlugin + Chart.js 按需加载）、文字水印插件（createWatermarkPlugin + 顶层 overlay）、自写插件挂引擎预留位（setUnderlayPainter/setOverlayPainter/floatObjects）。完成后得到一个带图表列、水印与自定义整层绘制的表格。
aliases: [插件开发, 插件接入, plugin, TablePlugin, 挂载插件]
keywords: [TablePlugin, mount, unmount, table.use, plugins, createChartPlugin, resolveCellChart, chart.js, createWatermarkPlugin, updateConfig, setUnderlayPainter, setOverlayPainter, OverlayPainter, floatObjects, 插件, 自定义插件, 图表列, 水印, 整层绘制]
---

# infinitable 插件接入

本指南覆盖插件体系全链路：官方插件（图表 `createChartPlugin`、水印 `createWatermarkPlugin`）接入、`TablePlugin` 契约自写插件、引擎预留位（underlay/overlay painter、浮动对象层）的正确用法。完成后得到一个图表列 + 水印 + 自定义整层角标的表格。适用 `infinitable` 0.1.x；图表须自装 `chart.js` v4。

## 前置条件

- 已按 `guide/quick-start.md` 完成安装与基础挂载（`infinitable` + `@cat-kit/core`）。
- 图表插件：`bun add chart.js`（Chart.js v4；不用图表可不装，插件按需动态加载不进主产物）。
- sheet 插件（`createSheetPlugin`：Store 参考模型 + 多 sheet + 撤销/填充/公式显示等）属 plugins 包导出，本指南不展开，见 `apis/sheet-plugin.md`。

## 步骤

1. 注册路径二选一（决策规则）：构造时已知插件用 `options.plugins`（先于首帧场景重建，渲染接线参与首帧）；运行时动态启停用 `table.use(plugin)`（注册即挂载，晚挂载由插件 mount 自行触发全量重建）。销毁时引擎逆序调 `unmount`。

   ```ts
   import type { TablePlugin } from 'infinitable'

   // 自写插件最小形态：
   const myPlugin: TablePlugin = {
     name: 'my-plugin',
     mount(table) {
       // 挂载：写引擎预留位 / 订阅事件 / 注入渲染接线
     },
     unmount(table) {
       // 卸载（可选）：还原预留位、退订事件
     },
   }
   ```

2. 图表列：`createChartPlugin` 的 `resolveCellChart` 按格返回声明，插件离屏出图落 cell 级缓存：

   ```ts
   import { createChartPlugin } from 'infinitable'

   const chartPlugin = createChartPlugin({
     resolveCellChart: (col, row) =>
       col === 1
         ? {
             type: 'line',
             labels: ['一月', '二月', '三月', '四月'],
             datasets: [{ label: '趋势', data: [8, null, 22, 30] }], // null 为断点缺口
           }
         : null,
   })
   ```

3. 水印：`createWatermarkPlugin` 配置必给 `enabled`/`text`，绘制在顶层 overlay（sky 层最顶、覆盖内容之上、锚定视口）：

   ```ts
   import { createWatermarkPlugin } from 'infinitable'

   const watermark = createWatermarkPlugin({ enabled: true, text: '内部资料' })
   ```

4. 自写插件挂顶层 overlay 预留位（角标/版权条等自绘内容，与水印插件的差别：自管 painter 生命周期）：

   ```ts
   import type { OverlayPainter, TablePlugin } from 'infinitable'

   const badgePlugin: TablePlugin = {
     name: 'corner-badge',
     mount(table) {
       const paint: OverlayPainter = (ctx, viewport) => {
         ctx.fillStyle = 'rgba(31, 35, 41, 0.6)'
         ctx.fillRect(viewport.width - 140, viewport.height - 28, 140, 28)
         ctx.fillStyle = '#ffffff'
         ctx.font = '12px sans-serif'
         ctx.fillText('infinitable', viewport.width - 128, viewport.height - 10)
       }
       table.setOverlayPainter(paint) // 传 null 还原预留位
     },
     unmount(table) {
       table.setOverlayPainter(null)
     },
   }
   ```

5. 组装（构造 plugins 一次挂全）：

   ```ts
   import { ListTable } from 'infinitable'

   const container = document.querySelector<HTMLDivElement>('#table')!
   const table = new ListTable({
     width: 48 + 120 + 150 + 12,
     height: 36 + 4 * 110 + 4,
     columns: [
       { title: '指标', width: 120 },
       { title: '趋势图', width: 150 },
     ],
     rowCount: 4,
     rowHeight: 110,
     resolveDisplayValue: (col, row) => (col === 0 ? `指标-${row}` : ''),
     plugins: [chartPlugin, watermark, badgePlugin],
     hostOptions: { container },
   })
   ```

## 完整示例

步骤合并后的最终形态，可直接复制：

```html
<!-- index.html 片段 -->
<style>
  #table {
    position: relative;
    width: 330px;
    height: 480px;
  }
</style>
<div id="table"></div>
<button id="toggle-watermark">切换水印</button>
```

```ts
// src/main.ts
import {
  createChartPlugin,
  createWatermarkPlugin,
  ListTable,
  type OverlayPainter,
  type TablePlugin,
  type WatermarkHandle,
} from 'infinitable'

// 1) 图表插件：第 1 列折线图（Chart.js 首次出图时动态加载）
const chartPlugin = createChartPlugin({
  resolveCellChart: (col, row) =>
    col === 1
      ? {
          type: 'line',
          labels: ['一月', '二月', '三月', '四月'],
          datasets: [{ label: '趋势', data: [8 + row * 2, null, 22 + row, 30] }],
        }
      : null,
})

// 2) 水印插件（句柄可运行时改配置）
const watermark: WatermarkHandle = createWatermarkPlugin({
  enabled: true,
  text: 'infinitable 内部资料',
  opacity: 0.15,
})

// 3) 自写插件：右下角徽标（顶层 overlay 预留位）
const badgePlugin: TablePlugin = {
  name: 'corner-badge',
  mount(table) {
    const paint: OverlayPainter = (ctx, viewport) => {
      ctx.fillStyle = 'rgba(31, 35, 41, 0.6)'
      ctx.fillRect(viewport.width - 140, viewport.height - 28, 140, 28)
      ctx.fillStyle = '#ffffff'
      ctx.font = '12px sans-serif'
      ctx.fillText('infinitable', viewport.width - 128, viewport.height - 10)
    }
    table.setOverlayPainter(paint)
  },
  unmount(table) {
    table.setOverlayPainter(null)
  },
}

// 4) 组装
const container = document.querySelector<HTMLDivElement>('#table')!
const table = new ListTable({
  width: 330,
  height: 480,
  columns: [
    { title: '指标', width: 120 },
    { title: '趋势图', width: 150 },
  ],
  rowCount: 4,
  rowHeight: 110,
  resolveDisplayValue: (col, row) => (col === 0 ? `指标-${row}` : ''),
  plugins: [chartPlugin, watermark, badgePlugin],
  hostOptions: { container },
})

// 5) 运行时控制
document.querySelector<HTMLButtonElement>('#toggle-watermark')!.addEventListener('click', () => {
  watermark.updateConfig({ enabled: !watermark.isEnabled() }) // 开关即时重绘
})

window.addEventListener('beforeunload', () => {
  table.destroy() // 逆序卸载插件：badgePlugin 还原 overlay、watermark 清 painter、chart 解析器置空
})
```

## 验证

```bash
bun add chart.js
bunx vite --open
# => 第 1 列每格渲染 110px 高折线图（首次出图触发 chart.js 动态加载，其后共享模块缓存）
# => 水印文字平铺覆盖在表格内容之上；滚动表格水印不动（锚定视口）
# => 右下角出现半透明徽标条
# => 点击「切换水印」按钮：水印消失/重现（一帧内生效）
```

浏览器控制台：

```ts
// 接完整示例的 table / chartPlugin 变量
chartPlugin.getChartSpec(1, 0)?.type // => 'line'（独立解析声明）
chartPlugin.loadLibrary() // => Promise<typeof import('chart.js')>（按需加载 Chart.js）
// 滚动再滚回：图表格同 key 命中 cell 级位图缓存直贴（无闪）
```

## 注意事项

> [!WARNING]
> - 图表插件依赖 `chart.js` v4 且不随 infinitable 安装：漏装时首次出图报模块加载失败；未启用图表的宿主不受影响（动态 import 独立分包）。首次出图触发 `import('chart.js')` 的网络加载，需要预热的宿主提前调 `chartPlugin.loadLibrary()`（`void chartPlugin.loadLibrary()`）。
> - `resolveCellChart` 返回声明的格整格按图表位图渲染（与 `resolveCellImage` 同层互斥），不叠加文本；数据变更后必须 `table.refreshCell(col, row)` 定向失效。
> - 顶层 overlay 预留位是单写方槽位：watermark 插件与自写 overlay 插件会互相覆盖 painter（后挂载的覆盖先挂载的）——多种顶层内容须合并成一个 painter 内自绘。
> - 内容之下的衬底水印用 `setUnderlayPainter`（ground 层恒在最底）：默认主题 body 不透明底色会遮挡它，须配透明底或改用顶层 overlay。
> - `table.use(plugin)` 重复注册同一插件对象会挂载两次（引擎不去重）；插件列表变更走自管数组 + 销毁重建。
> - 自写插件禁止 import 引擎内部模块或 `@internal` 成员：只依赖 `infinitable` 公开导出面（`TablePlugin`、`ListTable`、painter 类型等）。
> - `unmount` 是可选回调但涉及预留位/事件订阅的插件必须实现：不还原会让下一次挂载的写入方读到旧 painter。

多种顶层内容合并成一个 painter 的写法：

```ts
import type { OverlayPainter, TablePlugin } from 'infinitable'

const combinedPlugin: TablePlugin = {
  name: 'combined-overlay',
  mount(table) {
    const paint: OverlayPainter = (ctx, viewport) => {
      // 第一段：角标
      ctx.fillStyle = 'rgba(31, 35, 41, 0.6)'
      ctx.fillRect(viewport.width - 140, viewport.height - 28, 140, 28)
      // 第二段：顶部提示条
      ctx.fillStyle = 'rgba(46, 106, 219, 0.9)'
      ctx.fillRect(0, 0, viewport.width, 24)
    }
    table.setOverlayPainter(paint)
  },
  unmount(table) {
    table.setOverlayPainter(null)
  },
}
```
