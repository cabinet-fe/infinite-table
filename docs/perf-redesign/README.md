# VTable 性能对比与渲染架构重构（perf-redesign）

> 产出日期：2026-09-15。本目录由多路并行调研汇总而成：2 路本地代码调研（首屏渲染管线 / 图片渲染与下游 ultra-ui 现状）+ 2 路外部调研（leafer-ui 深挖 / 主流表格项目对比）。所有代码结论附 `file:line`，外部结论附来源 URL。

## 一、三大课题结论速览

### 课题 1：首屏渲染性能（结论：可压缩 50%~70%，无需更换渲染引擎）

当前 `new ListTable()` 同步首屏耗时典型 60~220ms（10 万行×10-20 列、固定行列尺寸），构成大致为：

| 阶段 | 占比 | 主要证据 |
| --- | --- | --- |
| scenegraph 首屏节点构建 | 45-60% | 首屏过量构建 **5× 视口**的 cell 节点，且每 cell 立即触发文本布局（`proxy.ts:136-141,171-176`、`text-icon-layout.ts:196-197`） |
| 首次全量绘制 | 15-25% | 首帧必然全视口重绘；DPR ceil 放大填充率 |
| 行高/列宽计算 | 2-5%（auto 时 25-40%） | autoRowHeight / auto 列宽是最大变量 |
| 数据初始化 | 3-8% | O(n) 索引构建 |

另外确认三处结构性冗余：构造期 `scenegraph.resize()` **双跑**、构造期至少 3 次 RAF 全量渲染、`getStyleTheme` 每 cell 全量重算无缓存。

对标结论（详见 [01 报告](./01-performance-comparison-report.md)）：
- **leafer-ui 快的本质**是"超轻节点 + 叶级双包围盒脏区 + 事件驱动批处理 + 池化工程设施"，其中批帧收敛、限帧、池化、图片异步协议、脏区扩边像素对齐是低风险可搬项；但它的"百万轻节点、无虚拟化"路线与表格的"虚拟窗口 + 节点复用"路线**互斥，不可照搬**。
- 表格同行（AG Grid / Handsontable / Glide / Univer）的首屏共识路径是三件事：**跳过自动测量（显式尺寸）+ 最小首屏缓冲 + 单次合并渲染**；"首屏之后一直快"的地基是 **Univer 式 Layer 离屏缓存 + 滚动增量绘制**。

### 课题 2：底层多 canvas 分层 + 统一滚动条（结论：可行，vrender 已有一半地基）

vrender 1.1 已支持 `Stage.createLayer(layerMode)` 多 Layer（static/dynamic/virtual）+ offscreen2d layer handler + interactiveLayer。重构方案（详见 [02 架构方案](./02-architecture-redesign.md)、[03 详细设计](./03-detailed-design-multilayer-render.md)）：

```
L3 sky    选区/hover/列宽线/滚动条/编辑器   ← 最高频、小面积、独立 canvas
L2 media  chart / image 单元格内容          ← 位图缓存 + 独立失效，chart 扩展不脏文本格
L1 body   常规单元格（滚动窗口 + 节点复用）   ← 现有 proxy 机制落位
L0 ground 网格线/斑马纹/表头冻结背景         ← 低频，整层离屏缓存
```

所有层由唯一 `ScrollManager` 状态机驱动，每层声明自己的滚动响应策略（transform / blit / pattern / 重绘自身），滚动条作为 sky 层组件是滚动状态的唯一消费者。**chart 扩展从此获得独立于文本渲染的生命周期**。

### 课题 3：图片渲染（结论：根因明确，需一个一等公民 ImageService + 浮动对象层）

ultra-ui 目前**完全绕开** VTable 的图片通道，自建 DOM 叠层 `image-layer.ts`（约 760 行），根因链（详见 [04 设计](./04-image-rendering-design.md)）：

1. **onload → `stage.renderNextFrame()` 整层重绘风暴**（每张图成功都触发全量重绘，官方注释自认且节流方案试过又回退）；
2. **图片尺寸未知 → 布局抖动**（加载前按单元格渲染、加载后改宽高甚至反改列宽行高，只能用 opacity 0→1 hack 压闪烁，上游 issue #3588）；
3. **非法 URL 永远停在 loading 且 failCallback 不触发**；缓存（`ResourceLoader.cache`）**永不淘汰**；
4. **没有浮动对象模型**——ultra-ui 需要的是跨格、可拖拽、进 undo 历史的 floating image，VTable 的 `cellType:'image'` 是"格内贴图"语义，这是下游弃用 canvas 方案的根本原因。

设计产出：`ImageService`（窗口化加载 + LRU + 单帧无闪占位 + surface 级局部失效 + 失效/刷新 API + load/error 事件）+ `FloatObjectLayer`（浮动对象一等公民，锚点模型、交互协议、undo 集成、导出合成），可直接替换 ultra-ui 的 DOM ImageLayer。

## 二、文档索引

| 文件 | 内容 |
| --- | --- |
| [01-performance-comparison-report.md](./01-performance-comparison-report.md) | 性能对比分析报告：VTable 现状画像、leafer-ui 深挖、6 个同类项目横向对比、基准数据、12 条可落地启示 |
| [02-architecture-redesign.md](./02-architecture-redesign.md) | 渲染架构重构总方案：四层 canvas、统一滚动、失效模型、渲染后端抽象 |
| [03-detailed-design-multilayer-render.md](./03-detailed-design-multilayer-render.md) | 详细设计：模块分解、接口签名、滚动帧时序、chart 扩展走查、vrender 能力映射与降级策略 |
| [04-image-rendering-design.md](./04-image-rendering-design.md) | 图片渲染能力设计：ImageService、浮动对象层、对 ultra-ui 的接口与迁移路径 |
| [05-roadmap.md](./05-roadmap.md) | 开发路线图：M0~M5 六个里程碑、出口准则、风险 |
| [06-development-tasks.md](./06-development-tasks.md) | 开发任务拆解：任务卡（范围/涉及文件/估时/依赖/验收） |
| [07-specifications.md](./07-specifications.md) | 规格说明书：性能指标定义与目标值、API 规格、行为规格、兼容性、测试验收 |
| [08-render-engine-strategy.md](./08-render-engine-strategy.md) | 渲染引擎策略修订：vrender 体积/扩展性实测证据，fork 瘦身（vrender-lite）桥接 + 自研引擎（vtable-engine）目标态的分阶段替换决策 |

## 三、总目标（量化）

| 指标 | 现状（估计） | 目标 |
| --- | --- | --- |
| 首帧时间 TTFF（10 万行×20 列固定尺寸，参考机 P50） | 60~220ms | ≤ 80ms；简单表 ≤ 50ms |
| 首帧后到完整可用（渐进窗口填满） | 100~500ms | ≤ 150ms 且不阻塞交互 |
| 滚动帧率（固定行高 10 万行） | 良好但拖滚动条退化为全量重绘 | ≥ 55fps 稳态，无全量重绘路径 |
| autoRowHeight 滚动 | 卡顿明显 | ≥ 50fps |
| 图片列（1000 张图滚动） | 闪烁 + 全量重绘风暴 | 零闪烁、失效范围 ≤ cell∪边界 |
| 图片/离屏缓存内存 | 无上限 | 可配 LRU 上限，长会话平稳 |

## 四、执行摘要（一句话版）

**渲染引擎分阶段替换**（详见 [08 决策](./08-render-engine-strategy.md)）：实测证实 vrender 体积失控（demo 产物 minify 1.6MB / gzip 389KB，拖着 lottie-web，引擎侧 ≈1,861 个模块）且扩展性有管线级硬伤（单矩形 dirtyBounds、每帧全树 bounds prepare、无多 region）——因此以 RenderHost 窄接口为安全带：**E1 先 vendor fork 瘦身改管线（vrender-lite，-55%+ 体积、根治失效模型），E2 以自研表格专用引擎（vtable-engine，目标 ≤60KB gzip）为目标态**。首屏/失效/分层/图片四条主线（M0-M4）在该轨道上照常推进。
