# 05 · 开发路线图（Roadmap）

> 总周期约 5-6 个月（M0-M5），每个里程碑独立可交付、可回退、有量化出口准则。阶段间唯一硬依赖：M2 的失效模型是 M3/M4 的地基。

```
M0 基线与快赢(2w) ─→ M1 首屏优化(4w) ─→ M2 失效模型与滚动(6w) ─→ M3 分层架构(8w) ─→ M4 图片与浮动对象(6w)
                              │                    │                    │
                              └── ultra-ui T1 帧级同步（随 M1 交付，零改动收益）──┘        │
E0 RenderHost 接口(1w, 并行) ──→ E1 vrender-lite vendor fork(4-5w, 并行) ────────┘（E1 手术承接 M2/M3 的侧通转正）
                                                                        ──→ E2 自研引擎 vtable-engine（决策门 D1 后立项）
```

> 引擎策略修订（2026-09-16）：原 M5"不替换引擎"结论作废，替换为 [08 引擎策略](./08-render-engine-strategy.md) 的 **E0/E1/E2 分阶段替换**；原 M5 的 spike 项并入 E2 立项后的评估池。

---

## M0 · 基线护栏与快赢（2 周）

**目标**：先能测，再动刀；顺手摘无架构收益的果子。

- 搭建基准 harness：TTFF（constructor 同步耗时）、首帧后 1s、稳态滚动 FPS、hover+滚动并发、1000 图列、批量 setRecords 六个场景；参考机固定（Chrome + Apple Silicon / 一台 Linux）。
- showRepaint 脏区可视化 + 每帧失效面积/FPS 采样埋点（`table.debug.showRepaint`、`table.getPerfStats()`）。
- 快赢清单（改参/去重级，0 风险）：构造期 resize 双跑合一；删 `console.log` 残留（`ListTable.ts:1669`、`table-group.ts:668`）；`getStyleTheme` 结果缓存；progress 由 setTimeout(16) 改 rAF 对齐。
- ultra-ui T1：暴露 `onScrollFrame` + `getScrollState()`（随 M0/M1 API 交付，下游接入消除 DOM 浮层错位窗口）。

**出口准则**：基准数字落档（报告 + CI 任务）；快赢项 TTFF 实测下降记录在案；无行为回归。

## M1 · 首屏渲染优化（4 周）

**目标**：TTFF 达标（10 万行×20 列固定尺寸 P50 ≤ 80ms）。

- 首屏同步建节点范围 5× 视口 → 1× 视口 0 缓冲（`proxy.ts:136-141,171-176` 参数与逻辑改造）；首帧后 rAF+8ms 预算渐进扩缓冲（替代 5× 同步 + setTimeout(16) 渐进）。
- cell 构建热路径：取消逐 cell 即时 AABBBounds 读取，改标记后统一布局（`text-icon-layout.ts:196-197`）；文本测量启动预热。
- 显式尺寸快速路径 + auto 估算/后置精确化（autoRowHeight、auto 列宽，带 scrollTop 补偿）。
- batch API（`table.batch(fn)`）：收集期静默，帧末一次失效（学 Handsontable batch / leafer trackChanges）。
- maxFPS 节流 + FPS 采样（frame-scheduler）。

**出口准则**：TTFF 目标达标（固定尺寸与 auto 两套基准）；滚动露白兜底通过（快速滚动 1 屏无空白格）；batch 下 setRecords 10 万行单帧失效面积 = 全屏 ×1 次。

## M2 · 失效模型与滚动重构（6 周）

**目标**：失效成为一等数据（三档模型）；消灭全量重绘路径；为 M3/M4 打地基。

- InvalidationQueue（cell 双包围盒 / band / full；spread(10).ceil() 像素对齐；MAX_BANDS=8 回退 full；空失效必须 full）。
- 滚动行带增量绘制：现"fastScrolling 跳 prepare + 全视口重绘"（`render-service.ts:14-31`）升级为 band 重绘；滚轮路径绕开全树 bounds prepare。
- ScrollManager 收拢：滚动状态唯一源，4 条滚动条数据源统一；惯性/惯性节流策略并入。
- dirty-region 调试面板与基准接入（失效面积进 CI）。

**出口准则**：滚动稳态（10 万行固定行高）≥55fps、autoRowHeight ≥50fps；hover+滚动并发失效面积 ≤ band×2 行；拖滚动条不再是全量重绘路径。

## M3 · 分层渲染架构（8 周）

**目标**：ground/body/media/sky 四层落地，chart 扩展获得独立生命周期。

- RenderHost 接口 + VRenderHost（vrender 多 Layer 映射，先实测 static/dynamic/virtual 与 offscreen2d 语义）。
- 四层拆树（scenegraph 21 容器按 role 落位）；ground 层离屏缓存 + blit；sky 层（选区/滚动条/拖拽线/编辑器宿主）迁入。
- MediaCache（cell 级位图 LRU）+ CanvasPool + ExtensionRegistry（`registerExtension`，layer/isStatic 声明）。
- chart cellType 以扩展方式回归（位图缓存 + media 层），作为课题 2 的验收场景。
- 降级开关：单 canvas 合成模式、bandRepaint 关闭路径。

**出口准则**：chart 列滚动帧 L1/L0 零重绘（showRepaint 验证）；列宽拖拽/选区/hover 不触发 body 重绘；四层与单 canvas 模式基准对比报告；导出含全部层。

## M4 · ImageService 与浮动对象（6 周）

**目标**：图片能力达标（04 文档 §2 目标 1、2）；ultra-ui 可迁移。

- ImageService（窗口化加载、LRU、单帧无闪协议、URL resolver、load/error 事件、invalidate API、sizing 语义透传 cover/contain/fill）。
- 图片 cell 迁入 media 层；移除 opacity hack；三处 resize 重排收敛单点。
- FloatObjectLayer：模型/锚点平移/交互协议（interceptFilter）/导出合成；onFloatObjectChange 供下游 undo。
- ultra-ui T2 试点 → T3 删除 DOM ImageLayer（与下游联调排期）。

**出口准则**：1000 图列滚动零闪烁、失效范围 ≤ cell∪边界、无全量重绘；内存上限受控（LRU 生效）；ultra-ui 试点验收（拖拽/undo/xlsx 往返/导出全通过）；非法 URL 必触发 onImageError。

## E0/E1 · 引擎替换第一段：RenderHost + vrender-lite vendor fork（并行工作流，4-6 周）

**目标**：把体积与管线扩展性两大问题在源头解决（证据与方案见 [08 文档](./08-render-engine-strategy.md)）。

- E0（1 周，与 M0 并行）：RenderHost 窄接口落地（原 M3 前置项提前），旧精简版渲染调用点收拢到接口后。
- E1（4-5 周，与 M2 后半并行）：vrender 五包源码 vendor 进仓为 `vrender-lite`：
  - 减法：删 lottie/animate/3D/SVG/jsx/poptip/未用组件与全部未用导出面（体积目标 **-55%+，引擎侧 ≤130KB gzip**）；
  - 手术 1：多 region dirtyBounds（X1/X3）→ M2 行带失效从侧通转正轨；
  - 手术 2：跳过全树 bounds prepare 正轨化（X2，表格自持 bounds）；
  - 手术 3：多 Layer 单 rAF 收敛（X6）→ M3 分层基建补全；
  - 手术 4：Canvas 池/限帧/FPS 采样内置（X4）。
- 决策门 D1：E1 交付后按 08 文档 §5 预算评审——达标则 E2 立项；若侧通已全部转正且预算达成，E2 可降级为长期选项（E1 骨架保留）。

**出口准则**：demo 场景引擎侧 bundle ≤130KB gzip 且零 lottie/animate；`stage.dirty` 多 region 生效（band 重绘不走侧通）；滚动帧无全树 bounds prepare（profiler 验证）；四手术均有基准数字。

## M5 · vtable-engine 自研引擎（E2，决策门 D1 后立项）

**目标**：表格专用精简引擎为目标态（引擎核心 ≤60KB gzip），vrender-lite 保留为 RenderHost 回退实现直至 parity 全绿。

- 引擎范围（§08 文档 §3 表 C 列）：场景树（Group/Text/Rect/Image/Line/RichText 六图元 + 脏传播）、分层渲染器（多 region 失效原生、无全局 bounds 递归）、轻量事件（cell 级命中 + 图元命中，替代 federated 全量）、内置组件直绘（ScrollBar/CheckBox/Radio/Switch）、池化/限帧/DPR 内置；文本测量复用 FastTextMeasure。
- 按层切换：ground/sky → body（节点复用 + band 原生）→ media；每层切换有 golden 截图与事件回归矩阵护栏。
- 原 M5 spike 项（OffscreenCanvas+Worker、desynchronized、CanvasKit、vrender 多 region PR）并入 E2 评估池：其中"vrender 多 region PR"已被 E1 手术 1 取代（自有代码，无需上游）。

---

## 里程碑依赖与人力估算

| 里程碑 | 估时 | 前置 | 风险等级 |
| --- | --- | --- | --- |
| M0 | 2 周 | 无 | 低 |
| M1 | 4 周 | M0（需基准） | 低-中 |
| M2 | 6 周 | M1（帧调度设施复用）；E1 手术 1 后侧通转正轨 | 中 |
| M3 | 8 周 | M2（失效模型硬依赖）；E1 手术 3 后分层基建补全 | 中-高 |
| M4 | 6 周 | M3（media 层硬依赖）；T1 可先行 | 中 |
| E0+E1 | 5-6 周 | E0 与 M0 并行；E1 与 M2 后半并行 | 中 |
| E2 (M5) | 40-60 人日 | 决策门 D1（E1 出口评审） | 中-高 |

关键路径：M0 → M1 → M2 → M3 → M4（约 26 周）；E0/E1 为并行工作流不占关键路径，但 **M2/M3 的质量上限由 E1 决定**（侧通 vs 正轨）。M0 快赢、ultra-ui T1、E0 可提前兑现价值。每里程碑结束产出：基准报告 + CHANGELOG + 可回退开关确认。
