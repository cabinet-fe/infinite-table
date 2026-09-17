# 08 · 渲染引擎策略：vrender fork 瘦身与自研精简引擎决策

> 修订背景：初版方案（02/03 文档）结论为"不替换 vrender"。经复核，该结论在**体积与扩展性**两个维度上站不住脚，本文以实测数据重立决策：**fork 瘦身（vrender-lite）作为立即桥接，自研表格专用引擎（vtable-engine）作为目标态**，RenderHost 窄接口保证全程可回退。

---

## 1. 实测证据：vrender 的体积问题（2026-09-16 实测于本仓库）

### 1.1 磁盘与模块规模

| 包 | 磁盘体积 | es 模块文件数 |
| --- | --- | --- |
| @visactor/vrender-core | 17MB | 799 |
| @visactor/vrender-components | 11MB | 479 |
| @visactor/vrender | 8.2MB | 41 |
| @visactor/vrender-kits | 7.5MB | 395 |
| @visactor/vrender-animate | 4.4MB | 147 |
| @visactor/vutils（间接依赖） | 4.4MB | - |
| **合计** | **≈52MB** | **≈1,861 个 JS 模块** |

### 1.2 真实产物（决定性证据）

`demo/main.ts` 只渲染一个 10 万行基础 ListTable（文本 + checkbox 列，无 chart、无动画、无 poptip），`vite build`（rolldown）产物：

- **单 chunk 1,598,514 bytes（minify 后） / gzip 后 389KB**；
- 构建警告"chunk > 500kB"，并拖入了 **lottie-web**（来自 vrender-kits 的 Lottie 图元 `graphic/Lottie.js`）——一个表格引擎带上了动画播放器运行时。

### 1.3 体积失控的机制

`src/vrender.ts:82-85` 将五个 vrender 包 `export *` 全量 re-export 进旧精简版的公共 API。**用户只要 import 表格，就必须为整个 vrender 买单**——包括 3D、SVG 渲染后端、jsx 支持、animate/lottie、未用到的几十个组件。tree-shaking 对公共 API 面无效。

而旧精简版源码**实际使用的面**极窄：全 src 共 19 条 `@visactor/*` import 语句（8 条 core、4 条 kits、4 条 components、2 条 vrender、1 条 animate、1 条 vchart 残留），落到能力上就是：

> Stage/Layer、Group/Text/Rect/Image/Line/RichText 六种图元、 federated 事件（wheel/pointer）、ScrollBar/CheckBox/Radio/Switch/Poptip 五个组件、文本测量（已被我们 rebind）、DPR/clip。

这窄面正是自研可行的根本原因：**表格不需要一个通用图形引擎**。

## 2. 实测证据：扩展性硬伤（调研已逐条核实）

| # | 硬伤 | 证据 | 对本项目的阻碍 |
| --- | --- | --- | --- |
| X1 | 失效模型是**单矩形 dirtyBounds union** | vrender-core `stage.dirty(b)`、`draw-contribution.ts` | 行带式分段失效（M2 核心）只能侧通绕行，做不干净 |
| X2 | 每渲染帧**全场景树 bounds 递归**（dirty-rect 只省绘制不省布局） | `render-service.js:12-19` | 滚动帧的固定税；我们只能在 fastScrolling 时跳过（render-service.ts:14-31 特化），属 hack |
| X3 | 不支持**多 region 清屏/裁剪** | DrawContribution 单 dirtyBounds | band 重绘、图片 cell 定向失效都要绕 |
| X4 | 无 Canvas 池 / 图片回收池 / maxFPS 限帧 / FPS 采样 | 源码检索无命中 | 这些工程设施全部要我们在外层补（学 leafer） |
| X5 | 贡献器/tapable 体系复杂，改一处渲染行为要理解整条 contribution 链 | runtime-contributions.ts、draw-interceptor.ts 等特化补丁已 5+ | 我们已经打了 5 个特化补丁，说明"扩展性不够"不是感觉，是既成事实 |
| X6 | 多 Layer 支持存在但**单帧收敛、层间合成语义未打通** | `createLayer(layerMode)` 语义需实测 | M3 分层架构的基建只算"半套" |
| X7 | lottie/animate/poptip/SVG/3D 等重依赖与表格无关但被捆绑 | lottie-web 实锤 | 体积、安全面、加载时间全为不用的能力付费 |

**结论：X1-X3 是管线级限制，外层侧通只能缓解不能根治；X4-X5 证明我们已在外层重复造该属于引擎的设施。**这与"体积大、扩展性不够"的判断互相印证：病根相同——vrender 是为图表叙事场景设计的通用引擎，不是为虚拟化表格设计的。

## 3. 三个选项

| | A · 维持 npm vrender（初版方案） | B · vendor fork 直接改源码（vrender-lite） | C · 自研表格引擎（vtable-engine） |
| --- | --- | --- | --- |
| 一句话 | RenderHost 适配 + 外层侧通 | 源码进仓，砍到表格够用，改管线 | 表格专用精简引擎，从管线设计即服务表格 |
| 体积 | 389KB gzip 不动 | 预计 **-55%~70%**（砍 lottie/animate/3D/SVG/jsx/未用组件；目标 ≤130KB gzip 引擎侧） | 预计 **引擎核心 ≤60KB gzip**（4-6k LOC：场景树/分层渲染器/多 region 失效/事件/池化） |
| 扩展性 | X1-X3 仍在，侧通 hack 累积 | **根治 X1-X4**（管线代码可改）；X5 稍缓解（面变窄） | **根治 X1-X7**（管线原生：多 region、无全树 prepare、层优先、池化内置） |
| 工期 | 0（已在 M3 内） | 15-25 人日 | 40-60 人日（不含文本测量，复用现有 FastTextMeasure） |
| 风险 | 性能天花板受限（X1/X2） | 与上游永久分叉——**可接受**：本仓库本就是私有精简提取，下游 ultra-ui 自用，无上游同步需求 | 事件系统/富文本/边角行为重建；需 feature parity 用例兜底 |
| 回退 | - | 极易（vendor 前 npm 版可随时切回） | RenderHost 双实现开关，fork 版全程保留 |

### 对 B 的关键判断

fork 不是"临时妥协"，而是**两阶段替换的正确第一段**：旧精简版与 vrender 的耦合点（Stage 创建、图元、事件、组件、测量 rebind）集中在 `vrender-app.ts`、`scenegraph.ts`、`runtime-contributions.ts` 少数文件，vendor 后先做**减法**（删未用面）再做**手术**（multi-region dirty、去全树 bounds prepare、单 rAF 多层收敛、Canvas 池内置）。这四刀恰好是 M2/M3 侧通方案想做而做不干净的事。

### 对 C 的关键判断

表格场景的图形面窄（§1.3），且有 Univer（自研 engine-render）、leafer（轻核）两个先例证明自研引擎是主流可行路线而非冒险。**决定成败的不是渲染器，而是三件事**：文本测量与排版（复用现有 FastTextMeasure，风险已消）、事件系统（表格只需 cell 级命中 + 少量图元命中，可比 federated 简单一个量级）、行为 parity 测试（golden 截图 + 事件回归矩阵）。

## 4. 决策：B 为桥接、C 为目标态（分阶段替换）

```
E0 RenderHost 窄接口（提前，原 M3 前置项）
   │
E1 vrender-lite vendor fork ──── 15-25 人日，与 M2 并行
   │  ├─ 砍：lottie/animate/3D/SVG/jsx/poptip/未用组件（体积 -55%+）
   │  ├─ 手术1：多 region dirtyBounds（根治 X1/X3 → M2 行带失效转正）
   │  ├─ 手术2：跳过全树 bounds prepare 的正轨化（表格自持 bounds，根治 X2）
   │  ├─ 手术3：多 Layer 单 rAF 收敛（M3 分层基建补全，根治 X6）
   │  └─ 手术4：Canvas 池/限帧/FPS 采样内置（X4）
   │
E2 vtable-engine 自研引擎 ──── 40-60 人日，E1 完成后立项（带数据决策门）
      ├─ 按层切换：ground/sky（结构简单先行）→ body（节点复用 + band 原生）→ media
      ├─ vrender-lite 实现保留为 RenderHost 回退开关，直至 parity 全绿 + 基准达标
      └─ 决策门 D2：E1 后若 bundle ≤130KB 且性能达标、侧通全部转正，
         E2 可降级为"长期选项"不立项——E1 的成果不浪费，它是 C 的骨架
```

**E1 与主线的关系**：M0/M1（首屏优化）不依赖引擎选择，照常推进；M2（行带失效）在 E1 手术 1 落地后从侧通转为正轨；M3（分层）的基建由 E1 手术 3 补全；M4（图片）不变。

**风险对冲**：E2 立项前设决策门 D1（E1 交付后评估：体积/性能/侧通清理度）；任一阶段失败均可回退上一形态（npm vrender ← vrender-lite ← vtable-engine 双实现开关）。

## 5. 体积与性能预算（进 07 规格）

| 预算项 | 现值 | E1 后 | E2 后 |
| --- | --- | --- | --- |
| 引擎侧 bundle（min+gzip，demo 场景） | 389KB（全量含 lottie） | **≤130KB** 且零 lottie/animate | **≤70KB**（旧精简版 + engine 核心合计目标 ≤150KB） |
| es 模块数（引擎侧） | ≈1,861 | ≤400 | ≤150 |
| 常驻渲染管线每帧成本 | 全树 bounds prepare | O(脏区相关子树) | O(脏区相关子树)，无全局递归 |

## 6. 与既有文档的衔接

- 02 文档 §5"渲染后端抽象"的**决策段作废**（"不整体替换"→ 本文分阶段替换）；RenderHost 接口设计不变，反而成为本策略的安全带。
- 03 文档 §6"引擎替换结论"作废，vrender 能力缺口改由 E1 手术清单承接。
- 05 路线图插入 E0/E1 工作流，M5 重定义；06 任务清单新增 T-E0xx/T-E1xx/T-E2xx 系列卡。
- 07 规格新增 §5 体积预算与 C-6 引擎约束。
