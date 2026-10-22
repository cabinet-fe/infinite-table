# 项目

- 是什么：高性能 canvas 表格引擎（原 vtable 精简版浴火重生，零 vrender 依赖，自研渲染引擎）
- 类别：前端库（代码）
- 组织结构：多包单体仓库（包路径：`packages/render`、`packages/grid`、`packages/table`、`packages/formulas`、`packages/plugins`、`packages/sheet`、`packages/infinitable`——`packages/core` 拆为 grid + table 后删除；应用：根目录唯一 `playground`——示例总览 + 页内 vs VTable 对比 + 量化基准 + 冒烟自检；文档站：`website`——VitePress 开发者文档 + 可交互示例）
