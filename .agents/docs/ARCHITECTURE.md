# 架构

## 业务架构

高性能 canvas 渲染的表格引擎库，面向需要大数据量（10 万行级）展示与交互的前端应用。核心域：

- 表格渲染：多层 canvas 分层（ground/body/media/sky）、虚拟滚动窗口、行带增量失效
- 交互：选区、hover、列宽拖拽、冻结、排序、编辑
- 公式引擎：单元格公式计算（解析/求值 + 49 个内置函数 + 依赖图 DependencyGraph；宿主驱动求值、图驱动增量失效——value 变更经 affectedBy 传递闭包标脏波及公式，易失函数随任意变更重算，循环由宿主护栏报错）
- 插件机制：官方特性与用户扩展走同一注册路径

下游为 ultra-ui 等自用产品。重构调研与目标架构文档 `docs/perf-redesign/`（01-08）已删除（0330ea0），仅存 git 历史。

## 技术架构

本仓库是 vtable 的私有精简提取版（原 `vtable-core/`，69k 行）的**重写**，不是渐进改造：

- 原 `vtable-core/`（迁移参考与 API 行为基准）已删除：迁移已完成，代码全部在 `packages/`
- 渲染引擎自研（`@infinite-table/render`，即 perf-redesign 08 决策的 vtable-engine 目标态）：场景树 + 分层渲染器 + 多 region 失效 + federated 事件 + canvas 池化；目标引擎核心 ≤60KB gzip
- `@infinite-table/core`（表格主体）只依赖 render 的窄接口（RenderHost 风格：创建层/提交失效/请求帧/读测量），不依赖任何 vrender 系列包
- 四层 canvas 自下而上：L0 ground（网格线/斑马纹，整层离屏缓存）→ L1 body（单元格滚动窗口）→ L2 media（chart/图片，cell 级位图缓存 LRU）→ L3 sky（选区/hover/滚动条/编辑器）；所有层由唯一 ScrollManager 状态机驱动
- 失效模型三档统一：cell / row-band / full；滚动、交互、图片加载、批量更新共用同一失效语言

### 技术栈

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 语言 / runtime | TypeScript 7（tsgo 原生编译器）、ESM only、浏览器 + bun | tsconfig strict: true |
| 构建 / 包管理 | bun 1.4.2 workspaces + vite-plus 0.3.2（vp CLI，内含 rolldown-vite / oxlint / oxfmt / vitest 4.1.11） | 零 vrender 系列依赖；包发布构建用 vite-plus |
| 渲染 | 自研 `@infinite-table/render`（canvas 2d，多 region 失效） | 替代 @visactor/vrender 全家 |
| 工具库 | `@cat-kit/core`（cabinet-fe 核心工具包） | 替代 @visactor/vutils |
| 测试 | vitest（vite-plus 内置） | 浏览器行为用浏览器模式冒烟 |
| 部署 | 私有 npm 包，下游 ultra-ui 自用 | 不公开发布 |

## 未决

- `packages/plugins` 首批插件清单未定（旧代码仅有 custom-cell-style / invert-highlight / list-tree-stick-cell）
