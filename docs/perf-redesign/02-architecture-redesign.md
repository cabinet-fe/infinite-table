# 02 · 渲染架构重构总方案（多层 canvas + 统一滚动）

> 本文是重构的总体方案：目标架构、失效模型、后端抽象与兼容映射。模块级接口与帧时序见 [03 详细设计](./03-detailed-design-multilayer-render.md)。

---

## 1. 设计原则

1. **可测优先**：每个优化项必须先有基准（TTFF、滚动帧率、失效面积），后动代码；性能回归进 CI 看板。
2. **渐进可退**：每个结构改造都有"关闭开关"可退回现状单 canvas 模式；不搞一次性大爆炸重构。
3. **窄接口隔离渲染后端**：VTable 只依赖 `RenderHost` 窄接口（创建层/提交失效/请求帧/读测量），vrender 是当前唯一实现，未来 WebGL/CanvasKit/OffscreenCanvas-Worker 可插拔替换。
4. **失效即数据**：把"哪里脏了"从隐式的 stage.dirty(bounds) 升级为一等数据结构（行带脏区列表），滚动/交互/图片加载/批量更新共用同一失效语言。
5. **滚动是唯一状态源**：全表只允许一个滚动状态机，层、滚动条、浮层、下游（ultra-ui）全部只读订阅。

## 2. 现状架构（问题标注）

```
┌─ 唯一 canvas ───────────────────────────────────────────┐
│ stage.defaultLayer（单树）                                │
│  └─ tableGroup(clip)                                     │
│      ├─ cornerHeaderGroup / colHeaderGroup / rowHeaderGroup │ ← 表头与 body 同层同帧
│      ├─ bodyGroup        ← 滚动窗口节点复用（proxy）        │
│      ├─ 9× *SelectGroup  ← 选区 overlay 与内容同层          │ ← hover/选区重绘牵连 body
│      └─ componentGroup   ← 滚动条/冻结阴影/列宽线           │ ← 同上
└──────────────────────────────────────────────────────────┘
滚动：proxy.setY/X → 窗口内节点复用换内容 → 整组 setY 位移 → updateNextFrame(全帧渲染)
失效：vrender 单 dirtyBounds(union) + 每帧全树 bounds prepare；fastScrolling 时跳 prepare 全视口重绘
首屏：5× 视口同步建节点 + resize 双跑 + 3 次 RAF 全量渲染
```

结构性问题：① 内容层与浮层层不分离，hover/选区/滚动条重绘牵连 body；② 表头/网格线等静态内容无缓存，随滚动帧重算；③ chart/media 类重内容与文本 cell 同树同失效粒度；④ 失效粒度是"单矩形 union"，一处 hover + 滚动并发即接近全屏重绘；⑤ 首屏过量构建与冗余渲染路径。

## 3. 目标架构

### 3.1 四层 canvas 结构（自下而上）

| 层 | 名称 | 内容 | 更新频率 | 滚动响应策略 | 缓存形态 |
| --- | --- | --- | --- | --- | --- |
| L0 | ground | 网格线、斑马纹、表头/冻结区背景、主题底色 | 极低（resize/主题/行列尺寸变化） | 行带 blit / pattern 平移 | **整层离屏缓存**（学 Univer enableLayerCache） |
| L1 | body | 常规单元格内容（文本/icon/checkbox…） | 高（滚动窗口、数据更新） | 窗口节点复用 + **增量行带补画** | 无整层缓存；行带脏区重画 |
| L2 | media | chart 单元格、图片单元格、富媒体 | 中（自身数据/加载态变化） | 位图 blit + 窗口重算（异步补齐） | **cell 级位图缓存**（LRU） |
| L3 | sky | 选区、hover 高亮、列宽拖拽线、滚动条、编辑器宿主 | 最高、小面积 | 直接重绘自身脏区 | 无 |

要点：
- **chart 扩展获得独立生命周期**：chart cell 的绘制/失效只发生在 L2，文本滚动帧不需要重画 chart（blit 旧位图即可），chart 内部动画/重算也不脏 L1。这是"从最底层支持 chart 扩展"的直接答案。
- sky 层滚动条是唯一滚动条（含 frozen 区滚动条合并策略），数据源是 ScrollManager；列宽拖拽线、选区框不再触发 body 重绘。
- 每层 = 一个独立 canvas（vrender Layer 或自管 MultiCanvasHost，见 §5），**共享同一 rAF**（学 leafer App 单帧收敛），按 zIndex 顺序合成。

### 3.2 统一滚动管理（ScrollManager）

```
wheel / touch / scrollbar drag / setScrollTop(API) / 惯性
        │
        ▼
┌─ ScrollManager ─────────────────────────────────┐
│ state: { scrollTop, scrollLeft, viewport, mode } │  ← 全表唯一状态源
│ 合帧：rAF 收敛 + fastScrolling 判定 + maxFPS 节流 │
│ 派发：per-layer strategy（层只读订阅）             │
│   L0 ground: blitRowBands(deltaY)                │
│   L1 body:   windowShift + incrementalPaint      │
│   L2 media:  blitCache + ensureWindowAsync       │
│   L3 sky:    invalidateSelf()（便宜，整层重画）    │
│ 滚动条：sky 层组件，唯一消费者                      │
│ 帧 hook：onScrollFrame(cb)  ← 供下游浮层帧级同步    │
└──────────────────────────────────────────────────┘
```

- 滚动条 UI（当前 vrender-components ScrollBar ×4）迁入 sky 层，拖动时不再走"跳过 prepare + 全视口重绘"的特化路径，而是行带增量路径。
- 对下游暴露 `onScrollFrame` 帧级回调与 `getScrollState()`，替代 ultra-ui 现在监听 SCROLL 事件 + rAF 近似同步的方式（消除 DOM 浮层错位窗口）。

### 3.3 失效模型（Invalidation Model）

三档失效语言，全表统一：

| 档位 | 结构 | 触发方 | 处理 |
| --- | --- | --- | --- |
| Cell invalidation | `(col,row)` 或 cell bounds ∪ 旧 bounds（双包围盒，学 leafer before/after） | hover/选中态/文本变更/图片加载完成 | L1/L2 定向重画该 cell；L0 不动 |
| Row-band invalidation | 连续行带 `[rowStart,rowEnd) × viewport` | 滚动补画、行高变更、批量数据更新 | 按行带聚合 clear+重画，块数上限（如 8）超出回退全量 |
| Full invalidation | 整层 | resize/DPR/主题/缓存失效/空失效兜底 | 层全量重绘（L0 从缓存 blit） |

规则（继承自 leafer 的健壮性设计）：
- 任何**无法给出可靠 bounds** 的失效一律登记 full invalidation，不允许猜一个小块。
- 局部重绘区域统一 `spread(10).ceil()` 扩边 + 像素对齐，根治残影。
- 渲染循环内"补充布局/补充渲染"重试上限 3 次，防属性级联死循环。

### 3.4 首屏路径重构

1. 首帧只建 **1× 视口**节点（0 缓冲，学 AG Grid 首屏低 rowBuffer），同步 render 上屏。
2. 首帧后由 ScrollManager 的渐进调度（rAF 对齐、8ms/帧预算）扩缓冲至 1.5-2× 视口，替代现行 5× + setTimeout(16)。
3. 构造路径去重：`setRecords` 内 resize 与构造末尾 resize 合一；首帧前所有 setAttribute 不经过 dirty 机制（现状保留一次全量绘制是合理的），但**首帧后不再叠加 2 次全量 RAF**。
4. `getStyleTheme` 结果缓存（key = 缓存 style 对象标识），cell 构建热路径 getProp 从 20+ 次降到 0-1 次。
5. 显式尺寸快速路径：行列尺寸全静态时跳过测量类计算；autoRowHeight/auto 列宽首帧用估算值，首帧后 idle 修正（带滚动位置补偿）。
6. 文本测量启动预热 + 批量布局延迟（首屏 cell 构建不立即读 AABBBounds，标记后统一布局一轮）。

预期合成收益：TTFF 60-220ms → ≤80ms（见 07 规格）。

## 4. Media 层与 chart 扩展（课题 2 核心）

### 4.1 Extension 注册制（学 Univer SheetExtension/Skeleton）

官方特性与用户扩展走同一条路，统一注册：

```ts
interface CellContentExtension {
  uKey: string;                       // 唯一标识，缓存键组成部分
  zIndex: number;                     // 层内绘制顺序
  layer: 'body' | 'media' | 'sky';    // 声明落位层
  match(cell: CellInfo): boolean;     // 该 cell 是否由本扩展渲染
  draw(ctx: RenderContext, cell: CellInfo): DrawResult; // 产出绘制指令或场景节点
  isStatic?(cell: CellInfo): boolean; // 可位图缓存声明（默认 false）
  dispose?(): void;
}
table.registerExtension(ext);
```

- chart 单元格 = 一个 `layer:'media'`、`isStatic:false` 的扩展：chart 库产出位图 → media 层 cell 级缓存；滚动 blit，数据变更定向失效该 cell。
- 静态扩展（如角标、水印）可进 L0/L2 位图缓存，滚动零成本。

### 4.2 cell 级位图缓存（MediaCache）

- key：`uKey + cellIdentity + contentVersion + dpr + size`；LRU 上限可配（默认按内存预算，如 256MB）。
- 失效传播：内容版本号由扩展自己维护 bump；行列尺寸变化、DPR 变化全量失效。
- 临时离屏画布从 **CanvasPool** 取还（学 leafer CanvasManager），帧末统一回收，避免滚动期分配抖动。

## 5. 渲染后端抽象（RenderHost）

```ts
interface RenderHost {
  createLayer(opts: LayerOpts): LayerHandle;   // canvas / offscreen / 模式
  requestFrame(cb: () => void): void;          // 全 host 单帧收敛
  invalidate(layer: LayerHandle, region?: Region): void;
  measure(text: string, style: TextStyle): Size; // 测量（可下沉 worker）
  exportCanvas(): HTMLCanvasElement;            // 合成导出（所有层 drawImage 合并）
  destroy(): void;
}
```

- **当前实现 `VRenderHost`**：映射到 vrender Stage 多 Layer（`createLayer(layerMode)`，LayerHandler 已有 canvas2d / offscreen2d / empty 三种 contribution）。
- vrender 能力缺口（已在源码确认）：① 单帧收敛需确认多 Layer 是否共享一个 rAF（leafer 式 parentApp 收敛）；② 失效粒度是单 dirtyBounds union，**行带脏区需在 VTable 侧自管块列表、下传多 region 清屏**，或改造 vrender DrawContribution 支持多 region；③ 无 Canvas 池/图片回收池/限帧设施 → 在 VTable 侧补。
- **决策（2026-09-16 修订）**：分阶段替换渲染引擎，详见 [08 引擎策略](./08-render-engine-strategy.md)。实测证实 vrender 体积失控（demo 产物 gzip 389KB、引擎侧 ≈1,861 模块、捆绑 lottie-web）且存在管线级扩展硬伤（单矩形 dirtyBounds、每帧全树 bounds prepare、无多 region）。路径：**E1 vendor fork 瘦身 + 管线手术（vrender-lite）→ E2 自研表格专用引擎（vtable-engine）目标态**；RenderHost 窄接口是全程安全带，任一阶段失败可回退上一形态。本文的行带失效（§3.3）与四层架构（§3.1）在 E1 后从"侧通"转为"正轨"。

## 6. 与现状的兼容映射

| 现状 | 落位 | 兼容策略 |
| --- | --- | --- |
| tableGroup 单树 21 容器 | 拆到 L0-L3 四层 | Scenegraph 对外 API 不变；内部按 role 分发 |
| proxy 渐进窗口 + 节点复用 | L1 body 的滚动策略 | 保留（这是表格正确路线），参数与调度改造 |
| vrender-components ScrollBar ×4 | L3 sky 组件，数据源 ScrollManager | API 不变（scrollBar 属性），内部重构 |
| `stage.dirty(bounds)` 单矩形 | 失效三档模型 | RenderHost.invalidate 多 region；vrender 不够则 VTable 侧自管 |
| `cellType:'image'` 格内图 | L2 media + ImageService（04 文档） | 对外 API 兼容，内部走新通道 |
| `options.canvas` 用户传入 | VRenderHost 单层模式（降级路径） | 保留：用户传 canvas 时自动退化为单 canvas 合成模式 |
| 导出（下游依赖截图语义） | `exportCanvas()` 跨层合成 | 保证导出包含 media/sky 层内容 |

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 多 canvas 内存增加（4 层） | 层数按需创建：无 chart 列不建 L2；ground 用 offscreen 层；移动端降为 2 层 |
| 跨层事件命中顺序 | 保持 vrender 单一事件系统与 picker，层仅是渲染概念；zIndex 与层序对齐 |
| 导出/截图漏层 | RenderHost.exportCanvas 统一合成 + 回归用例覆盖 |
| 行带脏区复杂度 | 块数上限回退全量；Debug.showRepaint 式可视化开关辅助调试 |
| 渐进改造期间双路径共存 | 每阶段有 flag 可退回；基准护栏（07 规格）防回归 |
