# 代码地图

只做定位：找模块、找路径、找依赖方向。行为口径与实现细节看代码、测试与 `docs/`，不写进本文件。

## 树

```text
infinitable/
├── packages/            # monorepo 主体
│   ├── render/          # 通用 canvas 渲染工具包（场景树/分层 canvas/失效登记/事件/池化/路径原语与内建图元）
│   ├── grid/            # 共享网格内核（自 core 拆出：ScrollManager/虚拟窗口/二分命中/共享边/选区状态/主题投影）
│   ├── table/           # ListTable 引擎（自 core 拆出：装配/溢出/填充柄/表头/取值/编辑；实现引擎装配协议）
│   ├── formulas/        # 公式引擎（tokenizer/Pratt parser/求值/49 内置函数/依赖图）
│   ├── plugins/         # 官方插件（TablePlugin 契约 + chart/print/watermark 插件）
│   ├── sheet/           # 电子表格核心（sheet 模型/命令/IO/SheetGrid 适配，自 plugins sheet 插件族迁入）
│   └── infinitable/     # 统一发布包（npm 单包 infinitable，主入口 re-export 五层，`./sheet` 子路径）
├── playground/          # 唯一应用：示例总览 + 页内 vs VTable 对比 + 量化基准 + 冒烟自检
└── website/             # VitePress 开发者文档站：指南 + API 参考 + 可交互示例（mermaid 图）
```

## 模块

| 模块 | 路径 | 职责 | 主要入口 |
| --- | --- | --- | --- |
| render | `packages/render` | 通用 canvas 渲染工具包：场景树、分层 canvas、多 region 失效（档名去表格语义、各层消费策略建层参数化）、federated 事件、canvas 池化、路径原语与内建图元节点（矩形/文本/路径/图片）、paintTree/hitTest/region 工具导出 | `src/index.ts` |
| grid | `packages/grid` | 共享网格内核（自 core 拆出的通用网格机器纯搬运）：ScrollManager（唯一滚动源）、行列前缀和/虚拟窗口/二分命中、滚动条几何、触控惯性、共享边、cell-range、选区状态、float-object-layer、主题投影；仅依赖 render 与 @cat-kit/core | `src/index.ts` |
| table | `packages/table` | ListTable 引擎（core 领域代码原样搬运）：ListTable 主体与装配、溢出走廊、填充柄、表头装配、取值三形态、编辑链路、交互、图片/图表媒体、插件注册路径；依赖 grid 与 render，实现引擎装配协议（数据面 + 渲染宿主 + 主题 + 生命周期 + 插件槽位） | `src/index.ts` |
| formulas | `packages/formulas` | 公式引擎：地址与错误码、tokenizer、Pratt parser、evaluate、49 内置函数注册表、依赖图与容错引用扫描 | `src/index.ts` |
| plugins | `packages/plugins` | 官方插件承载：TablePlugin 契约具名转出 + chart/print/watermark 插件（print/watermark 面向引擎装配协议槽位挂载，不再以 ListTable 具体类型为挂载参数） | `src/index.ts` |
| sheet | `packages/sheet` | 电子表格核心：sheet 模型、命令、IO（xlsx 导出）、SheetGrid 适配——自 plugins 的 sheet 插件族整体迁入（`createSheetPlugin` 已删），依赖 table、grid 与 formulas（SheetGrid 经引擎装配协议消费 table 引擎） | `src/index.ts` |
| infinitable | `packages/infinitable` | 唯一 npm 发布包：主入口显式转售各层公共 API + `./sheet` 子路径，vp build 整体打成自包含 dist（chart 保持动态分包、@cat-kit/core 外部化），`scripts/build-types.mjs` 装配类型树并改写跨包说明符；发版统一走发版技能 `.agents/skills/release`（changesets + CI） | `src/index.ts` |
| playground | `playground` | 唯一应用（React + shadcn/ui + Tailwind CSS，vite MPA：index 示例 + bench.html 基准）：示例总览、vs VTable 页内对比、量化基准、冒烟自检 | `src/main.tsx`、`bench.html`、`src/app/views/ComparePage.tsx`、`src/bench/headless.test.ts` |
| website | `website` | 开发者文档站（VitePress + mermaid）：指南、架构、API 参考、可交互示例（Vue 组件挂载真实 `ListTable`） | `.vitepress/config.mts`、`index.md` |

## 模块内检索

定位到目录级。模块内部加删文件不算地图变更，文件清单以盘上为准。

### grid — `packages/grid/src`

- 自 core 纯搬运的通用网格机器：滚动 `scroll-manager.ts`（唯一滚动源）、`touch-scroll.ts`、画布内建滚动条 `scrollbar.ts`；几何 `grid-layout.ts`（前缀和/虚拟窗口/二分命中）、`shared-edges.ts`、cell-range；选区状态 `selection.ts`；浮动 `float/float-object-layer.ts`；主题投影 `theme.ts`

### table — `packages/table/src`

- ListTable 领域代码原样搬运：主体与装配 `list-table*.ts`；溢出 `cell-node.ts`、`cell-renderer.ts`（设计依据 `docs/overflow-rendering-research.md`）；交互 `list-table-interaction.ts`、`keyboard-navigation.ts`、`resize.ts`、填充柄 `fill-handle.ts`、sky 浮层 `interaction-overlay.ts`；编辑 `editing/`、`editor-registry.ts`、`sheet-model.ts`、`model-binding.ts`；图片/图表 `list-table-media.ts`、`media/`；引擎装配协议实现与插件注册路径 `plugin.ts`（插件可写引擎预留位 chartMediaResolver、underlay/overlay painter 在 `list-table.ts`）；文件清单以盘上为准

### render — `packages/render/src`

`scene/` 场景树、`layers/` 分层 canvas、`invalidation/` 失效登记、`events/` federated 事件、`pool/` canvas 池、`frame-scheduler.ts` 帧调度、`render-host.ts` RenderHost 窄接口

### formulas — `packages/formulas/src`

`address.ts`、`errors.ts`、`tokenizer.ts`、`parser.ts`、`evaluator.ts`；内置函数注册表 `functions/`；依赖图 `dependency-graph.ts`；静态引用 `ast-refs.ts`；编辑中容错扫描 `scan-refs.ts`。边界：无数组公式，循环检测由宿主护栏

### plugins — `packages/plugins/src`

- chart 插件 `chart/`：声明解析、Chart.js 按需加载、插件工厂、离屏出图；`scripts/assert-chart-chunk.mjs` 构建断言守 chart.js 不进主产物
- print 插件 `print/`：headless 分页引擎（fitpage/fixrows 双模式）+ 页面 HTML 构建（页眉页脚占位符）+ iframe 打印输出与 DOM 预览薄壳；数据经 PrintSource 抽象供数
- watermark 插件 `watermark/`：文字平铺水印，经引擎装配协议 overlay 绘制槽位挂载（锚定视口）
- 接口面红线：`docs/plugin-interface-map.md`

### sheet — `packages/sheet/src`

- 电子表格核心：sheet 模型、命令、IO（xlsx 导出）、SheetGrid 适配——自 plugins 的 sheet 插件族整体迁入（`createSheetPlugin` 已删）；内部文件清单以盘上为准

### playground — `playground`

- 壳与路由：`src/app/**`（React 应用壳 + hash 路由 + 15 页面；`?smoke=1` 全量挂载在 `src/app/SmokeMode.tsx`）
- 示例：`src/sections/**` 十二演示区（display/native-scroll/data-forms/interaction/hyperlink-image/media/chart/watermark/print/editing/report/infinite-sheet；native-scroll 为 ListTable + SheetGrid 双实例浏览器原生滚动条模式，末者为不指定行列数的 WPS 式无限表格；hyperlink-image 为单元格超链接 + 格内嵌入图 + 浮动图右键三合一演示区）；`?smoke=1` 页内自检写 `window.__SMOKE__`。sheet 电子表格示例已移除（下游 ultra-ui 自实现 sheet 包；`@infinitable/sheet` 包与 playground 依赖保留——report 区与 bench S5 场景仍在用）
- vs 对比：`src/app/views/ComparePage.tsx` + `src/bench/vs/`（页内跑批 + `?vsrun=1` 自动契约，@visactor/vtable 仅进对比页动态分包）
- 基准：`src/bench/headless.test.ts` 并入 `vp test run`（headless 回归，无独立命令）+ `bench.html` 浏览器入口，10 场景 JSON 落档 `results/`
- 脚本（npm script 收敛，按需直跑）：`scripts/smoke.mjs`（构建 + preview + 冒烟断言）、`scripts/vs.mjs`（体积实测 + 对比落档）

## 依赖

```mermaid
graph TD
    grid --> render
    table --> grid
    table --> render
    plugins --> table
    plugins --> grid
    sheet --> table
    sheet --> grid
    sheet --> formulas
    infinitable --> render
    infinitable --> grid
    infinitable --> table
    infinitable --> formulas
    infinitable --> plugins
    infinitable --> sheet
    playground --> grid
    playground --> table
    playground --> render
    playground --> plugins
    playground --> sheet
```

- render 与 grid/table 只经 RenderHost 窄接口耦合；formulas 与 grid/table 互不依赖，求值接线在宿主侧（packages/sheet 的 FormulaEngine 适配层）
- infinitable 为发布层：devDependencies 挂内部包（workspace:*，仅构建期），产物自包含不再依赖 @infinitable/*；playground 仍直接吃各内部包源码
- 不入图的外部依赖：@cat-kit/core（formulas $n、grid 工具）、hucre（sheet xlsx 导出）、chart.js（plugins 动态分包）、@visactor/vtable 与 react 技术栈（react/react-dom、shadcn/ui、tailwind css；仅 playground，不进任何 packages）
- 包 exports 三条件 types/dev/import → dist；仓内 playground 走 dev 条件直接吃源码

## 关键路径

跨模块链路一链一行；模块内部主流程看代码入口。

- render 主循环：三档失效（region / band / full；各层失效消费策略建层参数化）→ FrameScheduler 单帧收敛 → 各层按策略消费脏区 → 合成上屏；grid 的滚动与 table 的交互/图片/批量更新都汇入这条失效语言
- grid 滚动窗口：ScrollManager 唯一滚动源 → table 的 ListTable 增量维护可视窗口场景 → band 失效进 render 主循环
- chart 出图：plugins 离屏出图 → 注入 table `chartMediaResolver` → cell 级 MediaCache blit 上屏，与格内图片同一管线
- 水印上屏：plugins 平铺 painter → 经引擎装配协议 overlay 槽位注入（table 实现，ground 层 underlay 槽位同构）→ 对应层整层失效，锚定视口不随滚动平移
- formulas 求值：宿主经 FormulaResolver 驱动求值（packages/sheet 的 FormulaEngine 适配层）；依赖图标脏由宿主消费
- sheet 公式重算：模型命令 → FormulaEngine（sheet 包内图簿联动/改名别名/易失编排）→ formulas 依赖图标脏 + evaluate 逐格求值；#CYCLE! 由适配层递归护栏产出，第二套图/求值不存在
- sheet 装配：playground 示例已移除（下游 ultra-ui 接手）；`@infinitable/sheet`（电子表格核心：模型/命令/IO/SheetGrid 适配）+ table + formulas 的装配能力保留在包内（SheetGrid 经引擎装配协议消费 table 引擎），playground 消费面为 report 区与 bench S5 的只读渲染 + hyperlink-image 区的可写模型 API 演示（setCellImage/insertRows 等）
