# 架构

## 业务架构

高性能 canvas 渲染的框架无关无头内核库（承载平级引擎：表格 / sheet / 透视表 / 甘特图，末者为后续规划），面向需要大数据量（10 万行级）展示与交互、且需在 React/Vue/SSR/测试/bun 任意宿主环境装配的前端应用。核心域：

- 表格渲染：多层 canvas 分层（ground/body/media/sky）、虚拟滚动窗口、行带增量失效
- 交互：选区、列宽拖拽、冻结、排序、编辑
- 公式引擎：单元格公式计算（解析/求值 + 49 个内置函数 + 依赖图 DependencyGraph；宿主驱动求值、图驱动增量失效——value 变更经 affectedBy 传递闭包标脏波及公式，易失函数随任意变更重算，循环由宿主护栏报错）
- 引擎装配协议：数据面 + 渲染宿主 + 主题 + 生命周期 + 插件槽位的引擎中立装配，由 table 引擎实现；透视表引擎 `@infinitable/pivot`（PivotGrid：行维度树 × 列维度树 × 度量交叉聚合，维度/度量动态勾选）经同一装配路径接入（内部以 TableEngine 消费 table 引擎、对外转发 EngineAssembly，协议插件跨引擎挂载），后续甘特同构；插件（watermark/print）面向协议槽位挂载，官方特性与用户扩展走同一注册路径

下游为 ultra-ui 等自用产品。重构调研与目标架构文档 `docs/perf-redesign/`（01-08）已删除（0330ea0），仅存 git 历史。

## 技术架构

多包分层架构：

- `@infinitable/render` 为通用渲染工具包：场景树 + 分层渲染器 + 多 region 失效 + federated 事件 + canvas 池化；通用化补齐路径原语（moveTo/lineTo/曲线/stroke/fill）、内建图元节点集（至少矩形/文本/路径/图片），paintTree/hitTest/region 工具进公共导出面，失效档名与各层失效消费策略去表格语义（策略建层参数化）；目标引擎核心 ≤60KB gzip
- `@infinitable/grid`（共享网格内核，自旧 core 拆出的通用网格机器纯搬运：ScrollManager、行列前缀和/虚拟窗口/二分命中、滚动条几何、触控惯性、共享边、cell-range、选区状态、float-object-layer、主题投影）仅依赖 render 的窄接口（RenderHost 风格：创建层/提交失效/请求帧/读测量），不依赖任何 vrender 系列包；grid 公共面已重划——`./src/*` 深路径导出与 `@cat-kit/core` 僵尸依赖均已移除（table 深路径消费收敛为 0，包间消费统一走公共入口）
- `@infinitable/table`（ListTable 引擎：溢出走廊、填充柄、表头装配、取值三形态、编辑链路等领域代码原样搬运）依赖 grid 与 render，实现引擎装配协议（数据面 + 渲染宿主 + 主题 + 生命周期 + 插件槽位）
- `@infinitable/sheet`（电子表格核心：sheet 模型/命令/IO/SheetGrid 适配，自 plugins 的 sheet 插件族整体迁入，`createSheetPlugin` 已删）依赖 table 与 formulas（SheetGrid 经引擎装配协议消费 table 引擎）；infinitable 发布形态新增 `./sheet` 子路径
- `@infinitable/pivot`（透视表引擎：PivotGrid 平级领域引擎——多列树形行头（每行维度一列，同组跨行合并，点击组格左缘展开图标折叠、其余区域点击选区覆盖该组全部维度数据，collapsible 可配置为始终平铺，折叠组收敛为自带聚合的单行载体）× 多级列维度表头（列维度逐层 + 度量行，引擎冻结行 + 合并区落地，表头区行维度列按维度分列）× 度量聚合为包内状态机，行/列维度与度量动态勾选、聚合方式可切、结构原地落地）依赖 table（经 TableEngine 装配，对外转发 EngineAssembly）
- 四层 canvas 自下而上：L0 ground（underlay painter 预留层，默认无内容，可用于衬底水印）→ L1 body（单元格背景、网格线/边框与滚动窗口）→ L2 media（chart/图片，cell 级位图缓存 LRU）→ L3 sky（选区/滚动条/编辑器）；所有层由唯一 ScrollManager 状态机驱动
- 失效模型三档统一：原 `cell` 档更名去表格语义（如 `region`）/ row-band / full；滚动、交互、图片加载、批量更新共用同一失效语言

### 技术栈

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 语言 / runtime | TypeScript 7（tsgo 原生编译器）、ESM only、浏览器 + bun | tsconfig strict: true |
| 构建 / 包管理 | bun 1.4.2 workspaces + vite-plus 1.3.0（vp CLI，内含 rolldown-vite / oxlint / oxfmt / vitest 5） | 零 vrender 系列依赖；包发布构建用 vite-plus |
| 渲染 | 通用渲染工具包 `@infinitable/render`（canvas 2d，多 region 失效，路径原语与内建图元） | 替代 @visactor/vrender 全家 |
| 工具库 | `@cat-kit/core`（cabinet-fe 核心工具包） | 替代 @visactor/vutils |
| 测试 | vitest（vite-plus 内置） | 浏览器行为用浏览器模式冒烟 |
| 应用 UI（仅 playground） | React + shadcn/ui + Tailwind CSS | vite MPA；不进任何 packages |
| 部署 | 公开 npm 包 `infinitable`（changesets + CI 发布） | 其余子包与 playground 私有不发 |

## 未决

- 无（sheet 插件族已整体迁出 plugins、独立为 `@infinitable/sheet` 包，见 CODE-MAP）
