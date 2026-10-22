---
layout: home

hero:
  name: infinitable
  text: 高性能 canvas 表格引擎
  tagline: 多层画布失效驱动渲染 + 全量虚拟滚动。10 万到 100 万行，性能不随数据量劣化。
  image:
    src: /logo.svg
    alt: infinitable
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 架构总览
      link: /guide/architecture
    - theme: alt
      text: API 参考
      link: /api/

features:
  - title: 虚拟窗口 O(1)
    details: 构造与首帧只处理可视区，10 万行与 100 万行的 TTFF 几乎相同。
  - title: 四层 canvas
    details: ground / body / media / sky 分层，滚动收敛为单条 band 失效，没有全量重绘路径。
  - title: 模型直挂
    details: SheetModel 或宿主自定义模型按格 O(1) 读写，batchUpdate 把大块写收敛为一次失效。
  - title: Excel 式交互
    details: 选区、填充柄、行列 resize、键盘导航、冻结、合并、编辑器注册表。
  - title: 插件体系
    details: 图表、打印、水印与用户扩展走同一注册路径，能力以插件工厂 + handle 交付。
  - title: 极小体积
    details: 最小渲染面 gzip 27KB，相比 VTable 小一个数量级。
---

<script setup>
import BasicTableDemo from './.vitepress/theme/components/BasicTableDemo.vue'
import DemoBlock from './.vitepress/theme/components/DemoBlock.vue'
</script>

## 在线体验

下面是一个真实运行的 10 万行表格，可以直接滚动、跳转和拖拽滚动条。切换到「源码」可以直接查看这个演示的完整实现。

<DemoBlock>

<BasicTableDemo />

<template #source>

<<< @/.vitepress/theme/components/BasicTableDemo.vue

</template>

</DemoBlock>

## 继续阅读

- [快速开始](/guide/getting-started)：从空页面构造第一张表。
- [架构总览](/guide/architecture)：四层 canvas、失效模型与包边界。
- [示例](/examples/)：大数据量、编辑、图表、打印的可交互示例。
- [API 参考](/api/)：全部公共导出与签名。
