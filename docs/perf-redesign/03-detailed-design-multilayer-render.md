# 03 · 详细设计：多层渲染与统一滚动管理

> 本文是 [02 架构方案](./02-architecture-redesign.md) 的模块级详细设计：接口签名、数据结构、帧时序、场景走查、vrender 能力映射与降级策略。

---

## 1. 模块总览

```
packages/旧精简版/src/
├─ render/                        ← 新增：渲染宿主与分层
│  ├─ render-host.ts              RenderHost 接口 + VRenderHost 实现
│  ├─ layer-host.ts               LayerHandle / 层生命周期 / 合成导出
│  ├─ invalidation.ts             失效三档模型：InvalidationQueue / RowBand list
│  ├─ canvas-pool.ts              离屏画布池（学 leafer CanvasManager）
│  └─ frame-scheduler.ts          单帧收敛 + maxFPS 节流 + FPS 采样
├─ scroll/
│  └─ scroll-manager.ts           唯一滚动状态机（迁移自 state.ts 滚动部分 + proxy 调度）
├─ extension/
│  ├─ registry.ts                 CellContentExtension 注册制
│  └─ media-cache.ts              L2 cell 级位图缓存（LRU + 内存预算）
├─ media/
│  └─ image-service.ts            图片服务（详见 04 文档）
└─ scenegraph/                    ← 存量：L1 body 承载者，内部改造
```

## 2. 核心接口

### 2.1 RenderHost（渲染后端窄接口）

```ts
export type LayerKind = 'ground' | 'body' | 'media' | 'sky';

export interface LayerOpts {
  kind: LayerKind;
  offscreen?: boolean;        // ground 可请求离屏层
  canvas?: HTMLCanvasElement; // 用户注入（降级单 canvas 模式）
}

export interface LayerHandle {
  kind: LayerKind;
  setSize(w: number, h: number, dpr: number): void;
  /** 对该层声明失效区域；region 缺省 = 全层 */
  invalidate(regions?: Region[]): void;
  /** 层内容平移（滚动 transform 快路径；实现可忽略并改为重绘） */
  translateBy?(dx: number, dy: number): void;
  readonly canvasElement: HTMLCanvasElement | null; // offscreen 层为 null
}

export interface Region { x: number; y: number; width: number; height: number; }

export interface RenderHost {
  createLayer(opts: LayerOpts): LayerHandle;
  /** 全 host 单帧收敛：本帧内多次调用只执行最后一次 */
  requestFrame(task: FrameTask): void;
  /** 读/写渲染节点的入口由各实现自定；VTable 侧只依赖本接口 + 场景 API */
  measure(text: string, font: string): { width: number; height: number };
  /** 跨层合成导出（ground→body→media→sky 顺序 drawImage） */
  exportCanvas(): HTMLCanvasElement;
  destroy(): void;
}
```

约束：
- `requestFrame` 由 `FrameScheduler` 实现：rAF 对齐 + `maxFPS` 节流（交互态 60，静置降至 30/15）+ 每帧时间预算（默认 8ms，超预算任务顺延下一帧）+ 30 帧滑动窗口 FPS 统计（上报 `table.getPerfStats()`）。
- `VRenderHost` 首版直接映射 vrender：`Stage.createLayer` ×4；`requestFrame` 映射 `stage.renderNextFrame`（外包节流）；失效先透传单 union bounds，行带多 region 在 Invalidations 层做两次透传（vrender 缺口见 §6）。

### 2.2 InvalidationQueue（失效三档模型）

```ts
export type Invalidation =
  | { type: 'cell';    col: number; row: number; bounds: Region; prevBounds?: Region } // 双包围盒
  | { type: 'band';    rowStart: number; rowEnd: number }   // 行带（viewport 全宽）
  | { type: 'full';    layer?: LayerKind };                 // 全层（无可靠 bounds 时必须用 full，禁止猜小块）

export class InvalidationQueue {
  push(inv: Invalidation): void;           // 去重合并：cell 吸收进 band；band 数 > MAX_BANDS(8) → 升级 full
  drain(handler: (layer: LayerKind, plan: RepaintPlan) => void): void;
  setRepaintDebugEnabled(cb: (regions: Region[]) => void): void; // Debug.showRepaint 式可视化
}
```

- cell 失效区域 = `union(bounds, prevBounds).spread(10).ceil()`（像素对齐 + 扩边防残影，学 leafer `clipSpread/ceilPartPixel`）。
- **repaint plan** 按层生成：L1/L2 逐 region `clearRect + 重画相交 cell`；L0 仅响应 band/full；L3 响应一切但整层重画自身（便宜）。
- 全树 bounds prepare 规避：滚动 band 失效路径上不走 vrender dirtyBounds，而由 plan 直接驱动重画（复用现 `RenderServiceForVTable` 的特化点 `scenegraph/utils/render-service.ts:14-31`，从"跳过 prepare + 全视口重绘"升级为"跳过 prepare + 行带重绘"）。

### 2.3 ScrollManager（唯一滚动状态机）

```ts
export interface ScrollState {
  scrollTop: number; scrollLeft: number;
  viewport: { width: number; height: number };
  contentSize: { width: number; height: number };
  mode: 'idle' | 'wheel' | 'drag' | 'inertia';
}

export class ScrollManager {
  getState(): Readonly<ScrollState>;
  setScrollTop(v: number, source?: 'api' | 'wheel' | 'drag'): void;
  setScrollLeft(v: number, source?: 'api' | 'wheel' | 'drag'): void;
  /** 帧级回调：层派发完成后触发（供下游浮层帧级同步，见 04 文档 §6） */
  onScrollFrame(cb: (s: Readonly<ScrollState>) => void): () => void;
  /** 层策略注册：层声明自己如何响应滚动 */
  registerStrategy(kind: LayerKind, s: ScrollStrategy): void;
}

interface ScrollStrategy {
  /** 返回本帧该层需要做的工作；Scheduler 保证单帧内执行 */
  onScroll(ctx: ScrollFrameContext): void;
}
```

滚动帧时序（目标，替代现 `proxy.setY` 链路 `proxy.ts:498-531`）：

```
wheel → ScrollManager.setScrollTop
  → rAF 合帧（同帧多次滚动只处理一次；fastScrolling 判定保留）
  → L1 body: 窗口滑动（复用现有 moveCell/dynamicSetY 机制）
       ├─ 窗口内：节点复用换内容 + 行带增量补画（blit 旧帧 + 画新行带）
       └─ 窗口外：整组 translateBy + 异步 ensureWindow（渐进补建）
  → L0 ground: blitRowBands(dy)（网格线/斑马纹位图自拷贝 + 新行带补画）
  → L2 media: cache blit + ensureWindowAsync（未就绪 cell 先空/占位，异步补）
  → L3 sky:   invalidateSelf()
  → ScrollBar 组件更新（消费同一 state）
  → onScrollFrame 回调（下游/编辑器宿主）
```

与现状的差异点：
- 现状 `fastScrolling`（拖滚动条）走"跳过 prepare + **全视口重绘**"（`render-service.ts:25`），新方案改为行带增量，消除最后一条全量重绘路径。
- 现状滚轮路径每帧做全树 bounds prepare（vrender render-service），新方案 band 路径不依赖全树 prepare。
- 滚动条从 componentGroup 迁至 sky 层；4 条滚动条数据源统一为 ScrollManager。

### 2.4 ExtensionRegistry 与 MediaCache

```ts
export interface CellContentExtension {
  uKey: string;
  zIndex: number;                    // 层内顺序；约束：sky>media>body 由层序保证，层内按 zIndex
  layer: 'body' | 'media' | 'sky';
  match(cell: CellInfo): boolean;
  draw(ctx: ExtensionDrawContext, cell: CellInfo): void;
  isStatic?(cell: CellInfo): boolean;
  onCellSizeChange?(col: number, row: number): void;
  dispose?(): void;
}

export class MediaCache {
  get(key: string): CachedBitmap | undefined;
  put(key: string, bitmap: ImageBitmap | HTMLCanvasElement, bytes: number): void;
  invalidateKey(key: string): void;
  invalidateAll(): void;
  configure(opts: { maxBytes?: number; maxCount?: number }): void; // LRU，默认内存预算 256MB
}
```

- 缓存 key：`uKey + col + row + contentVersion + w×h + dpr`。contentVersion 由扩展持有并 bump。
- chart 单元格扩展示例（供后期 chart 扩展直接使用）：

```ts
class ChartCellExtension implements CellContentExtension {
  uKey = 'chart'; layer = 'media' as const; zIndex = 10;
  match(cell) { return cell.define.cellType === 'chart'; }
  draw(ctx, cell) {
    const key = cacheKey(this.uKey, cell, cell.value.version);
    let bmp = mediaCache.get(key);
    if (!bmp) {
      bmp = chartRenderer.renderToBitmap(cell.value.spec, cell.width, cell.height); // chart 库产出位图
      mediaCache.put(key, bmp, estimateBytes(bmp));
    }
    ctx.drawBitmap(bmp, cell.x, cell.y);   // 滚动帧只是 blit，chart 不重算
  }
}
```

## 3. 首屏路径详细设计

阶段化伪码（M1 落地目标）：

```
constructor:
  1) 建 stage + 四层（L2 惰性：无 media 扩展不创建）
  2) refreshHeader / setRecords：
     - 数据索引 O(n)（保留）
     - 尺寸快路径：全静态尺寸 → 跳过测量；auto → 首帧估算（defaultRowHeight/采样列宽）
  3) createGroupForFirstScreen(viewport 1×, buffer=0)   ← 从 5× 收紧（proxy.ts:136-141,171-176 改参）
     - cell 构建热路径：getStyleTheme 缓存命中（tableHelper.ts:255-370 包缓存层）
     - 不立即读 AABBBounds；统一在构建完后一轮布局（消除逐 cell 强制排版）
  4) renderOnce()（同步首帧，全量绘制一次——保留合理性）
  5) 单一 resize（合并 ListTable.ts:1645 与 :165 的双跑）
  6) FrameScheduler 预热队列（rAF + 8ms 预算）：
     - 扩缓冲至 1.5×~2× 视口（替代 5× + setTimeout(16)，proxy.ts:265-297）
     - autoRowHeight 精确修正（带 scrollTop 补偿）
     - auto 列宽精确化
     - 常用 font 字符宽度表预热（TextMeasure）
```

数值参数（写入常量并允许 options 覆盖）：

| 参数 | 现值 | 新值 |
| --- | --- | --- |
| 首屏行缓冲 | ceil(视口高×5/行高)，min 30 | 0（首帧）；预热至 ceil(视口高×0.5/行高) |
| 首屏列缓冲 | ceil(视口宽×5/列宽)，min 15 | 0（首帧）；预热至 ~0.25× |
| 渐进窗口 rowLimit/colLimit | max(200,…)/max(100,…) | 保留，但属"预热终态"而非首屏同步范围 |
| progress 调度 | setTimeout(16) | rAF + 8ms 帧预算 |
| 批量更新 | 逐格失效 | batch API：静默收集，帧末一次 band 失效 |

## 4. 场景走查

### 4.1 新增 chart 列（课题 2 验收场景）

1. 用户 `registerExtension(chartExt)` 或使用内置 chart cellType（L2 media）。
2. 首帧：chart cell 在 L2 只画占位框；TTFF 不受 chart 影响。
3. 预热期：`ensureWindowAsync` 异步渲染 chart 位图入 MediaCache，完成 → cell 失效 → blit 上屏。
4. 滚动：L2 整层位图 blit，**L1/L0 零感知**；chart 动画重算只失效自己 cell。
5. 列宽拖拽：`onCellSizeChange` → 缓存 key 变化 → 重渲染该 cell 位图（.sky 层拖拽线不触发 body）。

### 4.2 hover + 滚动并发（现行最痛场景）

- 现状：hover 变更（cell 失效）+ 滚动（band 失效）union 后 ≈ 全屏，vrender 全树 prepare + 大面积重绘。
- 新方案：L1 上 hover cell 失效收进当帧 band 计划（band 吸收 cell）；滚动 band 重画时该 cell 以新态一并画出；L3 hover 高亮独立重画。失效面积从 ~全屏 → band 宽度 ×2 行高。

### 4.3 批量数据更新（setRecords 10 万行）

- batch API：`table.batch(() => { table.setRecords(...); table.sort(...); })` — 收集期禁用逐格事件派发与脏登记（学 leafer trackChanges:false），退出时一次 full invalidation + 单帧渲染。对照 Handsontable batch/suspendRender。

### 4.4 导出/截图

- `table.exportCanvas()`：RenderHost 按 ground→body→media→sky 合成（含 media 位图与 sky 选区可选开关），供 ultra-ui 等下游截图（当前 DOM 浮层无法进 canvas 的痛点在 04 文档一并解决）。

## 5. 降级与开关

| 开关 | 行为 |
| --- | --- |
| `options.render.layers: false` 或用户传 `options.canvas` | 单 canvas 合成模式：四层逻辑层仍存在，但渲染到同一 canvas（按序绘制），失效模型不变 |
| `options.render.bandRepaint: false` | 退回 union 单矩形 dirtyBounds（vrender 原生） |
| `options.render.maxFPS` | 默认 60；静置降帧可关 |
| `table.debug.showRepaint(true)` | 脏区可视化 + 每帧失效面积/FPS 采样输出（性能回归看板数据源） |

## 6. vrender 能力映射与缺口

| 能力 | vrender 现状（1.1.x 源码核实） | 用法/缺口 |
| --- | --- | --- |
| 多 Layer | `Stage.createLayer(canvasId, layerMode)`，LayerMode: static/dynamic/virtual；LayerHandler: canvas2d / offscreen2d / empty | 直接用；需实测三种 mode 语义后落位（ground→static/offscreen，sky→dynamic） |
| 交互层 | 内置 interactiveLayer（渲染不用 dirtyBounds） | sky 层可先以此验证价值 |
| 失效 | `stage.dirty(b)` 单 union dirtyBounds；DisableDirtyBounds 默认关、VTable 已开 | **缺口**：多 region 清屏/裁剪。方案 A：VTable 侧自管 band 列表、逐 band 调 dirty+clip；方案 B：给 vrender 提 PR 支持多 region（M3 评估） |
| 单帧收敛 | `rafId` 集中分配 + renderNextFrame | 基本可用；多 Layer 是否天然共享单 rAF 需实测，否则 FrameScheduler 收敛 |
| 全树 bounds prepare | 每帧 `_prepare` 递归 update(bounds) | band 路径绕开（沿用 render-service 特化点升级） |
| Canvas 池 / 图片回收池 / 限帧 | 无 | VTable 侧自建（canvas-pool.ts、frame-scheduler.ts、04 文档 ImageService） |
| 视口不可见暂停 | vrender-kits IntersectionObserver 监听 canvas | 保留 |
| 文本测量 | FastTextMeasureContribution 已被 VTable rebind | 保留 + 启动预热 |

**引擎策略结论（2026-09-16 修订，详见 [08 引擎策略](./08-render-engine-strategy.md)）**：上表"缺口"列中，多 region 失效、全树 bounds prepare、单帧收敛、池化/限帧四项为**管线级**问题，外层侧通只能缓解不能根治；vrender 将按"E1 vendor fork 瘦身 + 管线手术 → E2 自研引擎目标态"分阶段替换。E1 的四刀（多 region dirtyBounds、正轨化跳过 bounds prepare、多 Layer 单 rAF 收敛、Canvas 池/限帧内置）正好承接本表全部缺口，届时本文所有"侧通方案"标记的设计转为正轨实现；RenderHost 接口保持不变。

## 7. 测试设计要点（配合 07 规格）

- 单测：InvalidationQueue 合并语义（cell 吸收/band 上限/full 回退）、ScrollManager 合帧与 source 语义、MediaCache LRU 与 key 失效。
- 基准（CI 护栏）：TTFF、首帧后 1s、稳态滚动 FPS、hover+滚动并发失效面积、1000 图列滚动、批量 setRecords。
- 可视化调试：showRepaint 截图对比（人工验收 + 回归 diff）。
