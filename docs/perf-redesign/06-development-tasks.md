# 06 · 开发任务拆解（Task Breakdown)

> 任务卡按里程碑分组。每卡：ID / 标题 / 内容 / 涉及文件 / 估时 / 依赖 / 验收。估时单位：人日（P）。

---

## M0 基线护栏与快赢

| ID | 任务 | 内容 | 涉及文件 | 估时 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| T-001 | 基准 harness | 6 场景（TTFF/首帧后1s/滚动FPS/hover+并发/1000图/批量setRecords）+ 固定参考机 + 结果落 JSON | `demo/`（新增 bench/） | 5P | - | 基线数字入库，一键重跑 |
| T-002 | showRepaint + PerfStats | 脏区可视化、每帧失效面积/FPS 采样、`table.getPerfStats()` API | `scenegraph/`、`core/BaseTable.ts` | 3P | - | 可视化开关可用，采样进 harness |
| T-003 | 构造去重 | resize 双跑合一；删除调试 console | `ListTable.ts:165,1645,1669`、`table-group.ts:668` | 1P | - | TTFF 基准无回归，渲染次数埋点下降 |
| T-004 | getStyleTheme 缓存 | 按缓存 style 对象 key 的 memo 层 | `core/tableHelper.ts:255-370` | 2P | - | cell 构建热点 getProp 调用数（profiler）下降 ≥80% |
| T-005 | progress 改 rAF | setTimeout(16) → rAF + 帧预算常量 | `scenegraph/group-creater/progress/proxy.ts:265-297` | 2P | - | 渐进期掉帧计数下降 |
| T-006 | onScrollFrame/getScrollState | 帧级滚动回调 + 状态读取（下游 ultra-ui T1 接口） | `state/state.ts`、`scroll/scroll-manager.ts`(雏形) | 2P | - | ultra-ui 接入后快速滚动 DOM 浮层无错位 |

## M1 首屏渲染优化

| ID | 任务 | 内容 | 涉及文件 | 估时 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| T-101 | 首屏 1× 视口 | firstScreenRow/ColLimit 改 0 缓冲；参数可配 `performance.firstScreenBuffer` | `proxy.ts:136-141,171-176` | 3P | T-005 | TTFF 达标；首帧可视内容完整 |
| T-102 | 渐进预热重写 | rAF+8ms 预算的预热队列：扩缓冲 1.5-2×、可中断、与滚动互斥策略 | `proxy.ts`、`render/frame-scheduler.ts` | 5P | T-101 | 快速滚动 1 屏无露白；预热期交互不卡 |
| T-103 | cell 构建延迟布局 | 取消逐 cell AABBBounds 即时读取，统一一轮布局 | `text-icon-layout.ts:196-197` 及调用链 | 5P | - | 首屏构建耗时（profiler 分段）下降 |
| T-104 | 文本测量预热 | 常用 font 字符宽度表启动预热 + TextMeasure 实例复用审查 | `tools/vutils.ts:527-603`、`text-measure.ts` | 2P | - | 首屏 measureText 次数下降 |
| T-105 | 显式尺寸快路径 | 全静态尺寸跳过测量分支；auto 行高/列宽首帧估算+后置精确（scrollTop 补偿） | `compute-row-height.ts`、`compute-col-width.ts`、`BaseTable.ts` | 8P | T-102 | auto 场景 TTFF 达标；精确化后无视觉跳变（允许一次 band 重排） |
| T-106 | batch API | `table.batch(fn)`：静默收集失效，帧末一次 full/band | `state/`、`scenegraph/` | 5P | T-002 | setRecords 10 万行失效面积=1×全屏；行为回归通过 |
| T-107 | maxFPS 节流 | frame-scheduler：交互 60/静置降帧、30 帧 FPS 窗口 | `render/frame-scheduler.ts` | 3P | - | 静置 CPU 占用下降可测 |

## M2 失效模型与滚动重构

| ID | 任务 | 内容 | 涉及文件 | 估时 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| T-201 | InvalidationQueue | 三档失效结构、合并语义（cell→band 吸收、MAX_BANDS=8→full）、spread(10).ceil()、空失效=full | `render/invalidation.ts` | 5P | T-002 | 单测全覆盖合并语义 |
| T-202 | 滚动 band 重绘 | fastScrolling 路径"跳 prepare + 全视口重绘"→ band 计划驱动；滚轮路径绕开全树 bounds prepare | `render-service.ts:14-31`、`proxy.ts:498-531`、`dynamic-set-y/x.ts` | 8P | T-201 | 拖滚动条与滚轮均无全量重绘（showRepaint 验证） |
| T-203 | ScrollManager 收拢 | 唯一状态机：scrollTop/left/viewport/mode；4 条滚动条统一数据源；惯性并入 | `state/state.ts:1226-1415`、`event/scroll.ts`、`scroll-bar.ts` | 8P | T-006 | 行为等价回归；滚动条拖动无特化路径 |
| T-204 | 双包围盒 cell 失效 | cell 失效携带 prevBounds；hover/选中态迁移到新失效语言 | `scenegraph/select/`、hover 相关 | 5P | T-201 | hover 移动无拖影；失效面积达标 |
| T-205 | 失效面积进 CI | harness 场景输出失效面积/帧数曲线，超标报警 | `demo/bench/` | 3P | T-002 | CI 护栏生效 |

## M3 分层渲染架构

| ID | 任务 | 内容 | 涉及文件 | 估时 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| T-301 | RenderHost + VRenderHost | 窄接口定义；vrender 多 Layer 映射；static/dynamic/virtual + offscreen2d 语义实测报告 | `render/render-host.ts`、`layer-host.ts` | 5P | - | 四层创建/销毁/合成可用；实测结论落档 |
| T-302 | 四层拆树 | scenegraph 21 容器按 role 落位 L0-L3；事件与 zIndex 对齐验证 | `init-scenegraph.ts`、`scenegraph.ts` | 10P | T-301 | 全功能回归（选区/冻结/合并格/编辑） |
| T-303 | ground 层离屏缓存 | 网格线/斑马纹/表头背景整层缓存 + 行带 blit | `render/`、`layout/frozen.ts` | 8P | T-302 | 滚动帧 ground 零重绘（showRepaint） |
| T-304 | sky 层迁移 | 选区 9 组/滚动条/拖拽线/冻结阴影/编辑器宿主迁 sky；sky 整层自重绘 | `component/`、`select/` | 8P | T-302 | 选区/hover/拖拽不触发 body 重绘 |
| T-305 | MediaCache + CanvasPool | cell 级位图 LRU（内存预算）+ 离屏画布池 | `extension/media-cache.ts`、`canvas-pool.ts` | 5P | - | LRU 单测；滚动期 canvas 分配次数下降 |
| T-306 | ExtensionRegistry | `registerExtension`（uKey/zIndex/layer/isStatic）；内置 cellType 改走注册表 | `extension/registry.ts`、`cell-helper.ts` | 8P | T-302 | 内置类型行为等价；示例扩展可用 |
| T-307 | chart 扩展回归 | chart cellType 以 media 扩展实现（位图缓存 + 异步渲染 + 占位） | `extension/`、`cell-type/` | 10P | T-305,306 | 4.1 场景走查全部通过；chart 滚动帧 L1/L0 零重绘 |
| T-308 | 降级模式 | 单 canvas 合成模式、bandRepaint 关闭；`options.render.*` 配置面 | `render/`、`BaseTable.ts` | 5P | T-302 | 两模式基准对比报告；开关切换无残影 |

## M4 ImageService 与浮动对象

| ID | 任务 | 内容 | 涉及文件 | 估时 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| T-401 | ImageService 核心 | 请求/缓存/LRU/并发/状态机；URL resolver；load/error 事件；invalidate | `media/image-service.ts` | 8P | - | 单测 + 1000 图场景基础通过 |
| T-402 | 单帧无闪协议 | hasResource 同步查询、占位延迟、加载完成 cell 定向失效；移除 opacity hack | `image-cell.ts:196-210`、`draw-interceptor.ts` | 5P | T-401,T-204 | 图片列滚动零闪烁；失效范围 ≤ cell∪边界 |
| T-403 | sizing 语义透传 | imageSizing/Align/Radius（透传 vrender imageMode）；keepAspectRatio 兼容 | `image-define.ts`、`keep-aspect-ratio.ts`、image 渲染贡献器 | 3P | T-401 | cover/contain/fill 用例通过；旧配置等价 |
| T-404 | imageAutoSizing 收敛 | 估算占位→一次修正→band 失效；三处 resize 重排收敛单点 | `image-cell.ts:272-329`、`update-width.ts:348`、`update-height.ts:205-213` | 5P | T-402,T-205 | 加载后单次重排；无二次跳变 |
| T-405 | FloatObjectLayer | 模型/锚点平移（行列增删钩子）/渲染/命中 | `media/float-object-layer.ts` | 8P | T-401,T-304 | 滚动帧级同步无错位；行列插入删除锚点正确 |
| T-406 | 浮动对象交互 | interceptFilter 协议：拖拽/选中框/Delete/滚轮透传/触控互斥 | `event/`、float 层 | 8P | T-405 | ultra-ui 试点手势用例全通过 |
| T-407 | 导出合成 | exportCanvas 含 media/float/sky；与下游截图语义对齐 | `render/layer-host.ts` | 3P | T-308,T-405 | 导出图含全部层；ultra-ui 验收 |
| T-408 | ultra-ui 迁移（T2/T3） | SheetImage→FloatObject 映射；联调；删除 image-layer.ts 与摩擦代码 | 下游仓库 `ultra-ui/packages/sheet-core` | 8P | T-405-407 | 下游回归（undo/xlsx 往返/手势/导出）全通过 |

## E0/E1 引擎替换第一段（并行工作流，见 08 文档）

| ID | 任务 | 内容 | 涉及文件 | 估时 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- | --- |
| T-E01 | RenderHost 落地（E0） | 窄接口 + VRenderHost 适配，渲染调用点收拢（提前自 T-301 的接口部分） | `render/render-host.ts` | 5P | - | 旧精简版不再直接触碰 Stage 细节 |
| T-E11 | vendor fork 瘦身 | 五包源码进仓 `vrender-lite`；删 lottie/animate/3D/SVG/jsx/poptip/未用组件与导出面；修 `vrender.ts:82-85` 全量 re-export | `vendor/vrender-lite/`、`src/vrender.ts` | 8P | T-E01 | bundle 引擎侧 ≤130KB gzip、零 lottie；demo 回归 |
| T-E12 | 手术1：多 region dirtyBounds | stage.dirty 支持多 region；DrawContribution 多 region 清屏/裁剪 | vendor 内 render/draw-contribution | 5P | T-E11 | band 失效不再侧通（T-202 简化） |
| T-E13 | 手术2：去全树 bounds prepare | 表格自持 bounds 的正轨渲染路径 | vendor 内 render/render-service | 5P | T-E11 | 滚动帧 profiler 无全局递归 |
| T-E14 | 手术3：多 Layer 单 rAF 收敛 | 层共享单帧 + 合成语义确认/补齐 | vendor 内 core/stage、layer | 5P | T-E11 | 四层单帧渲染（showRepaint 时序） |
| T-E15 | 手术4：池化/限帧内置 | Canvas 池、maxFPS、FPS 采样从外层迁入引擎 | vendor 内新增、`render/frame-scheduler.ts` | 4P | T-E11 | 设施 API 化，外层删重复实现 |
| T-E16 | E1 出口评审（决策门 D1） | 体积/性能/侧通清理度对照 08 §5 预算，出具 E2 立项/降级决策 | 文档 | 2P | T-E12-15 | 决策记录入库 |

## M5 vtable-engine 自研引擎（E2，决策门 D1 后立项）

| ID | 任务 | 内容 | 估时 | 依赖 | 验收 |
| --- | --- | --- | --- | --- | --- |
| T-501 | 引擎骨架 | 场景树 + 脏传播 + 分层渲染器（多 region 原生、无全局 bounds 递归） | 15P | T-E16 | ground/sky 层切换运行，golden 截图通过 |
| T-502 | 轻量事件系统 | pointer/wheel + cell 级命中 + 图元命中（替代 federated 全量面） | 8P | T-501 | 事件回归矩阵全绿 |
| T-503 | body 层切换 | 节点复用 + band 失效原生承载现有 proxy 机制 | 10P | T-501,502 | 全功能回归 + 滚动基准 ≥ vrender-lite |
| T-504 | 组件直绘 + 收尾 | ScrollBar/CheckBox/Radio/Switch 直绘；池化/DPR/限帧对齐；media 层切换 | 10P | T-503 | 四层全切换；引擎核心 ≤60KB gzip；回退开关验证 |
| T-505 | 评估池 spike（按需） | OffscreenCanvas+Worker / desynchronized / CanvasKit 各独立 spike | 20P | T-501 | 各自报告 + ≥20% 收益立项门槛 |

---

## 统计与排期建议

- 总量 ≈ 224 人日（含 E0/E1 引擎替换第一段 34 人日；E2 自研引擎 63 人日为决策门 D1 后的条件投入）；建议 2-3 人并行：主线（M0→M4）+ 引擎线（T-E01→T-E16→T-50x）+ 图片线（T-401/402 可在 M3 后半提前启动）。
- E1 与 M2/M3 的交叉点：T-202（band 重绘）在 T-E12 后删侧通代码转正轨；T-301/302 的 Layer 基建在 T-E14 后由引擎原生保证。
- 每任务卡完成后必须在 harness 跑对应场景并在任务卡内记录前后数字（防"感觉变快了"）。
- 破坏性行为修正（opacity hack 移除、error 必触发事件、URL 宽松判定、`vrender.ts` 全量 re-export 移除）集中记录 CHANGELOG，minor 版本发布。
