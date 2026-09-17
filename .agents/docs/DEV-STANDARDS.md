# 开发规范

## 命名

- 包名：`@infinite-table/<name>`；目录 `packages/<name>`（render、core、formulas、plugins、utils）
- 文件 kebab-case；类型/类 PascalCase；变量/函数 camelCase
- 测试文件 `*.test.ts`，统一放包内 `tests/` 目录（与 `src/` 平级、子目录结构镜像），禁止与源码混放

## 目录与代码结构

- 每个包 `src/index.ts` 为唯一公共入口，公共 API 从此处显式导出（禁止 `export *` 全量转售依赖——旧代码 `src/vrender.ts` 的教训）
- `packages/core` 禁止 import 任何 `@visactor/*`；渲染一律走 `@infinite-table/render` 的窄接口
- 通用工具优先取 `@cat-kit/core`，仅表格域专用工具进 `packages/utils`

## 代码风格

- 格式化与 lint：vite-plus 内置 oxfmt + oxlint，配置在仓库根
- TypeScript：新包 strict；注释与文档用中文

## 测试

- vitest；单测放包内 `tests/` 目录，测试专用辅助（fake/stub）放 `tests/testing/`
- 渲染相关行为用浏览器冒烟（apps/demo）验证；性能基准场景在 apps/bench，性能回归不许进 main

## 明确禁止

- cooking `spec.md` 缺少可被 `spec-files.mjs parse` 通过的「影响文件」章节
- 引入任何 `@visactor/vrender*` / `@visactor/vutils` 等旧引擎依赖（新代码零 vrender）
- `export *` 转售依赖包公共 API
