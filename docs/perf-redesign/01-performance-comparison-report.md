# 01 · 性能对比分析报告：VTable vs 流行开源项目（首屏渲染）

> 调研基线：旧精简版（源自 @visactor/vtable 1.26.8 精简提取，渲染依赖 @visactor/vrender ~1.1.10；迁移完成后该目录已删除）。本地结论按调研时仓库内 `file:line` 复核；外部结论附来源 URL，标注"推断"处为未证实项。

---

## 1. VTable 现状画像

### 1.1 首屏渲染完整路径（constructor → 第一帧上屏）

`new ListTable(container, options)` **同步**完成到第一帧 canvas 绘制（`demo/main.ts:87-100` 以 constructor 耗时作为首屏耗时）：

```
new ListTable()                                        src/ListTable.ts:97
└─ BaseTable constructor                               src/core/BaseTable.ts:231
   ├─ createRootElement + createElement('canvas')      BaseTable.ts:391-401（唯一用户可见 canvas :393）
   ├─ new Scenegraph(this)                             BaseTable.ts:510
   │  ├─ createStageFromVRenderApp → 共享 App          scenegraph/scenegraph.ts:174-204、vrender-app.ts:22-42
   │  ├─ initSceneGraph() 建 21 个容器 Group           scenegraph.ts:219 → group-creater/init-scenegraph.ts:5-128
   │  └─ createComponent()（滚动条/冻结阴影/resize线） scenegraph.ts:224
   ├─ refreshHeader / setRecords(records)              ListTable.ts:134,141
   │  ├─ CachedDataSource.ofArray（O(n) 建索引）        ListTable.ts:1594 → data/DataSource.ts:327
   │  ├─ scenegraph.createSceneGraph()                 ListTable.ts:1630 → scenegraph.ts:514
   │  │  ├─ new SceneProxy（确定渐进窗口）              proxy.ts:69-106
   │  │  ├─ computeColsWidth / computeRowsHeight       create-group-for-first-screen.ts:90,106
   │  │  ├─ proxy.createGroupForFirstScreen()  ← 同步为"5×视口"范围建全部 cell 节点
   │  │  └─ afterScenegraphCreated()（RAF#1）          scenegraph.ts:1609-1664
   │  ├─ scenegraph.resize()（RAF#2）                  ListTable.ts:1645 → scenegraph.ts:1084-1124
   │  └─ this.render() ← 第一次真正上屏（同步全量）      ListTable.ts:1663
   └─ this.resize() ← 构造末尾又跑一次 resize（RAF#3）  ListTable.ts:165 → BaseTable.ts:635-666
```

### 1.2 首屏同步构建范围：5× 视口（瓶颈核心之一）

- 行：`firstScreenRowLimit = max(30, frozen + min(rowLimit, ceil(视口高×5/默认行高)))`，`rowLimit = max(200, ceil(2×视口高/行高))`（`proxy.ts:171-176, 85`）。
- 列：`firstScreenColLimit = max(15, ceil(视口宽×5/默认列宽))`（`proxy.ts:136-141`）。
- 每个 cell 一次性建 Group+Text（+icon/CheckBox），且建完立即读 `wrapText.AABBBounds` 强制同步测量排版（`text-icon-layout.ts:151,196-197`）。**不是视口范围，是 ~5× 视口范围**。

### 1.3 结构性冗余（已逐条核实）

| # | 问题 | 证据 |
| --- | --- | --- |
| R1 | 构造期 `scenegraph.resize()` 双跑，每次都 resetFrozen/updateScrollBar/progress/updateNextFrame | `ListTable.ts:1645` + `ListTable.ts:165` → `scenegraph.ts:1084-1124` |
| R2 | 首帧必然全视口重绘：renderCount==0 时 attribute 变更不记 dirty | `graphic/group.ts:424-433` |
| R3 | vrender 每个渲染帧做**全场景树 bounds 递归**（dirty-rect 只省绘制不省 bounds）；仅拖滚动条（fastScrolling）时 vtable 特化绕过、退化为全视口重绘 | vrender-core `render-service.js:12-19`；`scenegraph/utils/render-service.ts:14-31` |
| R4 | `getStyleTheme` 每 cell 全量 getProp 重算无缓存，抵消了底层 `_getCellStyle` 缓存 | `core/tableHelper.ts:255-370`（调用点 `column-helper.ts:245-252`、`cell-helper.ts:673-679`） |
| R5 | progress 用 `setTimeout(16)` 与 RAF 渲染交错，双倍调度 | `proxy.ts:265-297` |
| R6 | autoRowHeight 级联成本：首屏 5×视口逐格测量，progress 每批 `computeRowsHeight+updateAutoRow×3`，滚动每帧同步范围再算 | `compute-row-height.ts:358-466`、`proxy.ts:608-645`、`dynamic-set-y.ts:113-133` |
| R7 | 非 fast-update 路径整格重建节点（icon/wrap/merge 场景），滚动期 GC 压力 | `cell-helper.ts:684-735` |
| R8 | `getColGroup/getRowGroup` O(childrenCount) 线性扫描残留 | `graphic/group.ts:200-227`（部分被 `highPerformanceGetCell` 缓解 `proxy.ts:767-821`） |
| R9 | DPR `ceil(dpr)` 非整数倍进一，首帧填充率 ×4 | `tools/pixel-ratio.ts:11-15` |
| R10 | 遗留调试输出 | `ListTable.ts:1669`、`event/listener/table-group.ts:668` |

### 1.4 首屏耗时构成（最佳估计，参考场景：10 万行×10-20 列、固定行列尺寸、1080p、DPR2）

| 阶段 | 占比 | 估计耗时 |
| --- | --- | --- |
| 数据初始化（索引 + layoutMap） | 3-8% | 3-15ms |
| 列宽计算（固定宽 O(cols)；auto 宽 ×10-20） | <2%（auto: 10-25%） | 1-3ms（auto: 30-100ms） |
| 行高计算（固定样式近 O(1)；autoRowHeight 5×视口逐格测量） | 2-5%（auto: 25-40%） | 2-10ms（auto: 50-300ms） |
| scenegraph 首屏节点构建（~1.5-2k cell 的 Group/Text 创建+主题+文本布局） | **45-60%** | 40-150ms |
| 首次 vrender render（全视口全量绘制，DPR2） | 15-25% | 15-45ms |
| 后续帧（resize 双跑 2 次 RAF + progress 每批渲染，填满渐进窗口） | 非阻塞 | 拖长 100-500ms |

**结论：constructor 同步耗时 ≈ 60-220ms，一半以上花在 scenegraph 节点构建；开 autoRowHeight / auto 列宽则进入 300ms-1s 量级。**（与仓库 README 记录"10 万行构造 0.46s"量级一致。）

---

## 2. leafer-ui 深挖：为什么快，哪些能搬

> 来源：leaferjs 官网与源码（leaferjs/leafer、leaferjs/ui），npm 最新 2.2.10。官方性能页：https://github.com/leaferjs/ai-docs/blob/main/performance.md ；实测站 https://benchmark.leaferjs.com ；第三方分析 https://juejin.cn/post/7259762205984522297 、https://cloud.tencent.com/developer/article/2343459

### 2.1 快的本质（源码核实）

1. **叶级双包围盒脏区（partLayout + partRender）**：每个叶子的 `__layout` 代理维护 6 类脏标记（matrix/bounds/box/surface/opacity/hitCanvas）；布局前记 beforeBounds、布局后记 afterBounds，`updatedBounds = union(before, after)`（`LayoutBlockData.ts`，文档 https://www.leaferjs.com/ui/guide/app/partRender.html ）。
2. **事件驱动批处理帧**：属性 set 只进 Watcher 队列 + `render.request` 去重，一个 rAF 内完成"收集→布局→渲染"；App 多子层**共享单一 rAF**（`Renderer.ts`、`Watcher.ts`）。
3. **脏块合并 + clip/clear 局部重绘**：`mergeBlocks()` 合并本帧脏块，`clipWorld(spread(10).ceil())` 扩边 10px 防残影 + 像素对齐，只遍历重绘相交子树（`Renderer.ts`）。
4. **多 canvas 分层（App 结构）**：`ground/tree/sky` 三层标准结构，"将不同更新频率的内容分开渲染"；各层独立判断 changed、独立 partRender（文档 https://www.leaferjs.com/ui/guide/advanced/app.html ）。
5. **工程化设施**：Canvas 对象池（`CanvasManager.get/recycle`）、图片回收池（帧末 `clearRecycled`）、hitCanvas 离屏命中缓存、`lazy` 视口惰性 paint、`maxFPS` 限帧 + 30 帧滑动窗口 FPS 采样。
6. **图片异步协议**：未就绪先渲染占位（`placeholderDelay` 防闪烁）、加载中 `ignoreRender(true)` 挂起重绘、完成后 `forceUpdate('surface')` 只失效该元素包围盒、auto 宽高加载后同步 updateBounds 防布局跳动、同 URL 全局共享 + LOD 缩略图（`leaferjs/ui/packages/partner/image/src/image.ts`）。

官方基准（Chrome/2K 屏）：创建 100 万可交互矩形 1.28s（SVG 5.83 / Konva 15.93 / Fabric 41.33）、内存 0.32GB、百万矩形中拖拽单元素 60FPS（其余引擎 ≤4FPS）；但 1.6 万全动态元素 Pixi 58 > Leafer 40FPS——**全动态场景（≈表格滚动）是它的弱项**。

### 2.2 对表格场景的适配性判定

| leafer 设计 | 能否搬 | 理由 |
| --- | --- | --- |
| 批帧收敛 / 限帧 / FPS 采样 | ✅ 直接搬 | 纯调度层，无结构冲突 |
| 脏区扩边 + 像素对齐 | ✅ 直接搬 | vrender 已有 DPR floor/ceil，补 spread 即可 |
| 图片异步协议（占位/防闪/surface 失效/回收池/LOD） | ✅ 直接搬 | 正是课题 3 需要的（见 04 文档） |
| 批量静默模式（trackChanges:false 思想） | ✅ 搬 | setRecords/批量更新期间关事件派发与脏登记 |
| 空失效→全量回退规则 | ✅ 搬 | 无法给可靠 bounds 的一律登记全屏，消除"局部重绘丢内容"类 bug |
| App 分层（ground/tree/sky） | ✅ 结构性搬 | vrender 多 Layer 是现成地基（见 02/03 文档） |
| 叶级双包围盒脏区 | ⚠️ 改造后搬 | 对 hover/选中类状态变更价值大；表格滚动整屏失效时退化为全量，需配行带式分段失效 |
| "百万轻节点、无虚拟化、视口裁剪遍历" | ❌ 不搬 | 与表格"虚拟窗口 + 节点复用"路线互斥；10 万节点缩放仅 16FPS 证明 O(n) 遍历路线对表格不可行 |
| 离屏 isPointInPath 命中 | ❌ 不搬 | 表格命中是行列二分定位，收益极低 |

---

## 3. 同类表格项目横向对比

> 详细来源与引文见调研原文；此处为合并结论。基准数据均注明条件与出处。

### 3.1 架构对比

| 维度 | Handsontable | AG Grid | Glide Data Grid | Univer | canvas-datagrid | regular-table | VTable 现状 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 渲染方式 | DOM 虚拟渲染 | DOM 虚拟化为主，sparkline 内嵌 canvas | 纯 Canvas2D 单主画布 + DOM overlay | 自研 Canvas2D（Engine/Scene/Layer/Viewport） | 单 canvas web component | 原生 table + 虚拟数据契约 | canvas（vrender），单 canvas 单树 |
| canvas 层数 | 0 | 0（图表 cell 内部 1） | 1 主 canvas（+离屏/DOM overlay） | 每 Layer 1 canvas + 每层可选**离屏缓存** | 1 | 0 | 1（+离屏测量） |
| 虚拟化粒度 | 行+列（offset 缓冲） | 行（rowBuffer=10）+列（无缓冲） | 可见区懒渲染（数据也懒） | Viewport 裁剪 + Layer 脏检查 + **增量滚动绘制** | 可见格绘制 | 可见窗口 slice 契约 | 行列双向（5× 视口首屏 + 渐进窗口） |
| chart 支持 | 无内置，外接 | ag-charts sparkline（canvas，企业版） | 自定义 canvas renderer | chart 插件（model+UI 双包） | 无 | 无 | vrender 图表 cell（本精简版已移除） |
| 图片支持 | 自定义 DOM renderer | 自定义 cell renderer | **ImageCell + 窗口化异步 loader + 预缩放图** | **floating image + cell image 双模型** | 无 | 无 | cellType image（见 04 文档的问题） |
| 首屏亮点 | 关自动测量 + batch/suspendRender | **rowBuffer 调低加速首绘** | 懒渲染=首屏只画一屏 | Layer 离屏缓存 + Viewport 裁剪 | 数据 getter 现生成 | 数据源契约 | （优化目标） |

关键出处：
- Handsontable 性能指南（关 autoRowSize/autoColumnSize、batch、beforeRender/afterRender 钩子）：https://handsontable.com/docs/javascript-data-grid/performance/
- AG Grid rowBuffer 与首绘速度的官方表述：https://www.ag-grid.com/javascript-data-grid/scrolling-performance/
- Glide 作者长文（fillText 占 CPU 一半、damage region、blitting、按列渲染、关 alpha 混合）：https://itnext.io/i-wrote-an-html-canvas-data-grid-so-you-dont-have-to-d945aa4780b4
- Univer 渲染架构官方博客（Engine→Scene→Viewport→Layer、层离屏缓存、"only draws incremental views"、600 万单元格 50-60FPS）：https://docs.univer.ai/zh-TW/blog/rendering
- Univer 自定义 canvas Extension 注册制：https://docs.univer.ai/zh-CN/blog/custom-canvas
- Glide ImageCell 窗口化 loader：https://docs.grid.glideapps.com/api/cells/imagecell
- regular-table 虚拟数据契约（20 亿行示例）：https://github.com/finos/regular-table

### 3.2 基准数据摘录

| 数据 | 条件 | 出处 |
| --- | --- | --- |
| 6 网格 5 万行 30 次中位 "Ready"：最快 390ms，AG Grid 444ms | 初始渲染，数百 ms 量级 | https://itnext.io/i-benchmarked-6-react-data-grids-on-50-000-rows-the-real-winner-was-the-tradeoff-d447fbf5ecde |
| 所有主流网格初始渲染都在 ~1s 内，**滚动才是分水岭** | 多方一致结论 | https://medium.com/bryntum/five-fast-javascript-data-grids-a-performance-review-22b456ba423b |
| Univer 600 万单元格滚动 50-60FPS；10 万行×50 列加载 <3s | 官方/社区实测 | https://docs.univer.ai/zh-TW 、https://juejin.cn/post/7537588523089133595 |
| Glide 百万行、宣传 120fps | 懒渲染 + canvas | https://grid.glideapps.com/ |
| AG Grid ~27FPS（100 万行）；LyteNyte 60FPS | 1771 Technologies 13 场景（利益相关，参考） | https://www.1771technologies.com/blog/performance-benchmarks |
| React 表格虚拟化：页面加载 ~49s → ~300ms | DOM 表格对照 | https://dev.to/navneet7716/optimizing-react-table-rendering-by-160x--5g3c |

### 3.3 通用技术工具箱（表格场景要点）

| 技术 | 要点 | 出处 |
| --- | --- | --- |
| 滚动增量绘制 blitting | 旧帧可见区 drawImage 自拷贝，只补新进入的行带 | https://dev.to/keyurparalkar/rendering-a-million-rows-in-react-by-drawing-1a39 |
| OffscreenCanvas + Worker | 不提速但解放主线程；分块离屏 + blit 有实例 | https://web.dev/articles/offscreen-canvas |
| desynchronized:true | 降低绘制延迟；有兼容性案例（qutebrowser #8290），只可实验 | https://developer.chrome.com/blog/desynchronized |
| 时间切片渲染 | ~5-8ms/帧预算、可中断；调度用 MessageChannel 比 rIC 可靠 | https://github.com/reactwg/react-18/discussions/27 |
| requestIdleCallback 预热 | 只适合"预热"（扩缓冲、预解码）不适合必须及时的工作 | 同上 |
| 绘制微优化组合拳 | 按列渲染（样式/字体设置一次）、缓存 ctx 状态少 save/restore、预计算混合色关 alpha、少 measureText | Glide 作者长文（同上） |

---

## 4. 可落地启示清单（12 条，按性价比 = 收益/代价/风险 排序）

| # | 启示 | 来源 | 收益 | 代价 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | **首屏零缓冲起步、滚动时动态扩缓冲**（首帧只建 1× 视口，rAF/idle 渐进扩到 1.5-2×，替代现行 5×） | AG Grid rowBuffer | 首屏收益立竿见影 | 低（proxy 参数与节奏调整） | 低（快速滚动露白需兜底） |
| 2 | **构造路径去重**：resize 单跑、首帧前合并全部 updateNextFrame、删调试输出 | 本地 R1/R2/R10 | 中（省 2 次全量 RAF 渲染） | 极低 | 低 |
| 3 | **getStyleTheme 结果缓存**（按已缓存的 style 对象做 key） | 本地 R4 | 中高（cell 构建热路径） | 低 | 低 |
| 4 | **显式尺寸快速路径 + 文档引导**（提供跳过 autoRowHeight/auto 列宽的一等配置与预热 API） | Handsontable | auto 场景首屏 ×3-10 提升 | 低-中 | 低 |
| 5 | **批帧收敛 + 限帧 + FPS 采样**（Stage 级 maxFPS、交互 60/静置降帧、render.request 去重） | leafer | 空闲场景省 CPU/电 | 低 | 低 |
| 6 | **progress 调度对齐 vsync + 每帧时间预算**（setTimeout(16) → rAF + 8ms 预算） | React time slicing | 滚动/渐进期掉帧减少 | 低 | 低 |
| 7 | **批量静默模式 batch API**（setRecords/批量更新期间关逐格事件与脏登记，帧末统一失效一次） | leafer trackChanges + Handsontable batch | 万行级更新省中间态开销 | 低-中 | 低 |
| 8 | **脏区扩边 + 像素对齐 + 空失效全量回退** | leafer | 根治残影/丢内容类 bug | 极低 | 低 |
| 9 | **行带式脏区分段失效 + 滚动 blitting**（失效按行带聚合而非 union 单矩形；滚动帧自拷贝旧帧、只画新增行带） | Univer + blitting 实践 | 高（滚动+hover 并发主痛点） | 高 | 中（块数上限回退全量） |
| 10 | **多 canvas 分层：ground（网格/冻结背景）+ sky（选区/滚动条/拖拽线）独立**，body 滚动不牵连背景与浮层重绘 | leafer App / Univer Viewport | 高 | 中-高（vrender 多 Layer 已有半套基建） | 中（导出、DPR、事件跨层） |
| 11 | **图片窗口化异步 loader + 无闪占位 + LRU 回收 + 预缩放图建议** | Glide ImageCell + leafer image | 图片列体验质变 | 中 | 低 |
| 12 | **重 cell 类型（chart/富文本）位图缓存 + Canvas 对象池**（渲染一次 blit 复用；临时离屏画布池化） | Univer 层缓存 + leafer CanvasManager | 滚动帧耗骤降 | 高 | 中-高（缓存失效传播需严设计） |

低优先级附加项：`desynchronized:true` 实验、OffscreenCanvas+Worker 渲染、requestIdleCallback 预热邻近行列、文本测量启动预热（常用 font 字符宽度表）。

---

## 5. 结论

1. VTable 首屏的 50% 以上耗时在"为 5× 视口同步建 scenegraph 节点 + 每 cell 即时文本布局"，且构造路径存在 resize 双跑与多次全量 RAF 渲染等**无架构收益的冗余**——不换引擎即可压缩 50-70%。
2. leafer-ui 的性能神话不适用于表格主场景（无虚拟化、全动态场景反而落后），但其**批帧收敛、限帧、池化、图片异步协议、脏区工程细节**全部值得移植；其**多 canvas 分层思想**与 Univer 的 **Layer 离屏缓存 + Viewport + Extension 注册制**共同构成课题 2/3 的目标架构蓝本。
3. 表格同行的共识：首屏三件事（显式尺寸、最小缓冲、单次合并渲染），长期两件事（层缓存 + 增量滚动绘制）。这构成本系列 02/03 文档的主线。
