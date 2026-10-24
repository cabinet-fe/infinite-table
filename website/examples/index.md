# 示例

本目录的示例都对应仓库 `playground` 里真实运行的演示区。教程中的代码按最小可读范围摘出，补上容器与依赖后可以直接放进 Vite 项目运行；更完整的控件、状态行和冒烟断言留在 playground 源码中。

<script setup>
import BasicTableDemo from '../.vitepress/theme/components/BasicTableDemo.vue'
import DemoBlock from '../.vitepress/theme/components/DemoBlock.vue'
</script>

## 先试一下

下面是一个真实运行的 10 万行表格。所有示例页顶部都有同类的交互演示，可以在「示例」和「源码」之间切换，代码块用于对照实现。

<DemoBlock>

<BasicTableDemo />

<template #source>

<<< @/.vitepress/theme/components/BasicTableDemo.vue

</template>

</DemoBlock>

## 示例清单

| 教程                             | 演示内容                                                                                        | playground 路由                     | 主要源码                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [基础表格](/examples/basic)      | 最小 `ListTable`、列定义、10 万行 records、滚轮接线、主题轻改、销毁                             | `#/display`                         | `playground/src/sections/display.ts`、`playground/src/app/views/DisplayPage.tsx`                                            |
| [大数据量](/examples/large-data) | 10 万行模型直挂、100 万行 `rowCount` + `resolveDisplayValue`、`batchUpdate`、overscan、性能观测 | `#/data-forms`、`#/interaction`     | `playground/src/sections/data-forms.ts`、`playground/src/sections/interaction.ts`、`playground/src/bench/scenarios.ts`      |
| [可编辑表格](/examples/editing)  | 编辑器注册表、可编三级判定、Enter 编辑、提交/取消、自定义编辑器、填充柄事件                     | `#/editing`                         | `playground/src/sections/editing.ts`、`playground/src/app/views/EditingPage.tsx`、`packages/sheet/src/grid/grid-editors.ts` |
| [图表与图片](/examples/chart)    | chart 插件装配、单元格图表、Chart.js 分包、图片格、浮动对象、水印                               | `#/chart`、`#/media`、`#/watermark` | `playground/src/sections/chart.ts`、`playground/src/sections/media.ts`、`playground/src/sections/watermark.ts`              |
| [打印](/examples/print)          | print 插件装配、`PrintSource`、`PrintConfig`、分页、页眉页脚、打印与预览                        | `#/print`、`#/report`               | `playground/src/sections/print.ts`、`playground/src/sections/report.ts`、`playground/src/app/views/PrintPage.tsx`           |

另外两个与性能相关的入口：

- `#/native-scroll`：`scrollbar: { mode: 'native' }` 的浏览器原生滚动条模式，源码在 `playground/src/sections/native-scroll.ts`。
- `bench.html`：独立的量化基准页，跑 TTFF、滚动 FPS、失效面积等场景，源码在 `playground/src/bench/`。

## 本地运行 playground

在仓库根目录安装依赖，然后启动 playground：

```bash
bun install
cd playground
bun run dev
```

开发服务器固定监听 `2345` 端口，打开 `http://localhost:2345/` 即可看到总览。侧栏页面使用 hash 路由，例如 `http://localhost:2345/#/display`、`http://localhost:2345/#/chart`；量化基准是独立页面 `http://localhost:2345/bench.html`。

## 示例的公共约定

所有教程都遵循同一套最小装配方式：

```bash
bun add infinitable @cat-kit/core
```

`@cat-kit/core` 是 `infinitable` 的 peer 依赖，必须显式安装。电子表格模型与 `SheetGrid` 从子路径导入：

```ts
import { Sheet, SheetGrid } from 'infinitable/sheet'
```

容器必须是非 `static` 定位，因为四层 canvas 会以绝对定位叠放在容器内：

```css
#table {
  position: relative;
  width: 800px;
  height: 420px;
}
```

`ListTable` 的 `width` / `height` 是视口尺寸，不是数据规模。数据规模由 `records.length`、模型的 `rowCount` 或纯钩子形态的 `rowCount` 决定。

::: tip 阅读顺序
第一次接触 infinitable 时，先看[快速开始](/guide/getting-started)了解安装和挂载，再按本目录顺序看基础表格、大数据量、编辑、图表、打印。每篇末尾的「常见坑」列出了该场景最容易踩的配置问题。
:::
