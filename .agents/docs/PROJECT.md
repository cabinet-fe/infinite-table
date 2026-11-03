# 项目

- 是什么：高性能 canvas 表格引擎（零 vrender 依赖，自研渲染引擎）
- 类别：前端库（代码）
- 组织结构：多包单体仓库（包路径：`packages/render`、`packages/grid`、`packages/protocol`、`packages/table`、`packages/formulas`、`packages/plugins`、`packages/pivot`、`packages/sheet`、`packages/infinitable`；应用：根目录 `playground`——示例总览 + 架构与 API 边界 + 量化基准 + 冒烟自检、`apps/print-form-designer`——独立全栈应用：打印表单设计器（前端设计器 + Bun/bun:sqlite/Hono 后端）；文档站：`website`——VitePress 开发者文档 + 可交互示例）
