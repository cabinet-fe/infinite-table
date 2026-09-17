# 07 · 规格说明书（Specifications)

> 本文档是 perf-redesign 系列的验收契约：指标定义与目标值、新增 API 规格、行为规格、兼容性约束、测试流程。实现与本文冲突时，以本文为准（修订需走评审）。

---

## 1. 性能指标（Performance Budget）

### 1.1 指标定义

| 指标 | 定义 | 测量方式 |
| --- | --- | --- |
| TTFF | Time To First Frame：`new ListTable(...)` 返回前第一帧完成绘制（同步 constructor 含首绘）的耗时 | performance.now() 包裹 constructor（对齐 `demo/main.ts:87-100` 语义） |
| TTI-buffer | 首帧到渐进预热窗口填满且空闲 | 预热队列 drain 完成时间戳 |
| Scroll FPS | 稳态滚动 5s 内帧间隔 ≤ 1/fps_target 的帧占比；取 P50/P95 帧耗时 | harness + FPS 滑动窗口（T-107） |
| Invalidated Area / frame | 每帧失效像素面积 / 视口面积 | InvalidationQueue 埋点（T-002） |
| Full-repaint count | 场景期间 full invalidation 渲染次数 | 同上 |
| Image flash count | 图片占位↔真图在同 cell 的可见跳变次数（含 opacity hack 类遮蔽） | 逐帧截图 diff 自动化（harness） |
| Peak Heap | 场景期间 performance.memory 峰值 | harness |

参考机：Chrome 最新稳定版，Apple Silicon Mac（开发基线）+ 1 台 Linux CI 机（护栏）。数据集：100k 行 × 20 列固定尺寸；autoRowHeight 变体；1000 图列变体。

### 1.2 目标值

| 指标 | 基线（2026-09 实测估计） | M1 出口 | M3 出口 | M4 出口 |
| --- | --- | --- | --- | --- |
| TTFF 固定尺寸（P50） | 60-220ms | **≤80ms** | ≤60ms | ≤60ms |
| TTFF autoRowHeight（P50） | 300ms-1s | ≤150ms（估算首帧） | ≤120ms | ≤120ms |
| TTI-buffer | 100-500ms | ≤150ms | ≤100ms | ≤100ms |
| Scroll FPS 固定行高（P95 帧耗时 ≤16.7ms 占比） | 良好，拖滚动条全量重绘 | ≥95% | ≥98% | ≥98% |
| Scroll FPS autoRowHeight | 卡顿 | ≥50fps 等效 | ≥55fps | ≥55fps |
| Invalidated Area（hover+滚动并发） | ≈全屏 | ≤40% | ≤15%（band） | ≤15% |
| Full-repaint count（稳态滚动 5s） | 每次 fastScroll 均全量 | ≤2 | 0（resize/DPR 除外） | 0 |
| Image flash count（1000 图滚动） | >0（占位跳变/闪烁） | - | - | **0** |
| Peak Heap（1000 图 10min 滚动） | 无界 | - | - | ≤ maxCacheBytes + 15% |

### 1.3 护栏规则

- 任一里程碑合入后，上述指标较上一出口回退 >10% 即阻断合入（CI 基准任务报警）。
- 每场景输出曲线数据（JSON）归档 `demo/bench/results/`。

### 1.4 体积预算（Bundle Budget，2026-09-16 新增，随引擎策略修订）

| 预算项 | 基线（实测） | E1（vrender-lite）出口 | E2（vtable-engine）目标 |
| --- | --- | --- | --- |
| demo 场景总 bundle（min+gzip） | **389KB**（含 lottie-web） | **≤130KB**，且零 lottie/animate/3D/SVG | **≤150KB**（其中引擎核心 ≤60KB） |
| 引擎侧 es 模块数 | ≈1,861 | ≤400 | ≤150 |
| 公共 API 泄漏 | `vrender.ts:82-85` 五包全量 re-export | 移除：公共 API 只暴露表格能力 | 同左（引擎以内部包形态引入） |

护栏：CI 记录每次发布的 gzip 体积，超出预算 10% 阻断（与 §1.3 同规则）。



### 2.1 构造 options（`options.render` / `options.performance`）

```ts
interface RenderOptions {
  layers?: boolean;            // 默认 true；false = 单 canvas 合成模式
  bandRepaint?: boolean;       // 默认 true；false = vrender union dirtyBounds
  maxFPS?: number;             // 默认 60；静置降帧策略内置，可关
  showRepaint?: boolean;       // 脏区可视化（也可运行时 table.debug.showRepaint）
}
interface PerformanceOptions {
  firstScreenBuffer?: { row?: number; col?: number };  // 默认 0；旧 5× 行为 = 显式传大值
  warmBuffer?: { row?: number; col?: number };         // 预热终态缓冲，默认 0.5×/0.25× 视口
  frameBudgetMs?: number;      // 预热/渐进每帧预算，默认 8
  mediaCacheBytes?: number;    // MediaCache/ImageService LRU，默认 256MB
}
```

### 2.2 实例方法/事件

```ts
table.batch(fn: () => void): void;                  // 批量静默：收集期不逐格失效，帧末一次
table.getPerfStats(): { fps: number; invalidatedAreaRatio: number; fullRepaints: number; ... };
table.debug.showRepaint(enable: boolean): void;
table.exportCanvas(opts?: { includeSky?: boolean; includeFloatObjects?: boolean }): HTMLCanvasElement;
table.onScrollFrame(cb: (s: ScrollState) => void): () => void;   // 帧级滚动回调（合成事件之前不存在）
table.getScrollState(): Readonly<ScrollState>;
table.registerExtension(ext: CellContentExtension): () => void;  // 返回反注册函数
table.floatObjects: FloatObjectCollection;          // add/remove/update/getAt/onFloatObjectChange
table.imageService: ImageService;                   // hasResource/request/invalidate/onImageLoad/onImageError/setUrlResolver/configure
```

### 2.3 图片样式（column define / style 扩展）

```ts
interface ImageSizingStyle {
  imageSizing?: 'contain' | 'cover' | 'fill';  // keepAspectRatio=true ≡ contain（兼容别名）
  imageAlign?: 'center' | 'left' | 'right';
  imageRadius?: number;
  placeholderDelay?: number;                   // 默认 80ms
}
```

### 2.4 CellContentExtension（完整签名见 03 文档 §2.4）

约束：`uKey` 全表唯一；`layer` 决定落位层；`isStatic()===true` 的扩展内容可进位图缓存，扩展必须保证同 contentVersion 输出位不变。

## 3. 行为规格

### 3.1 滚动

- BR-1 全表滚动状态唯一来源为 ScrollManager；任何 API（`setScrollTop`、滚动条拖动、滚轮、惯性、触摸）都收敛到同一状态机，同帧多次变更只产生一次滚动帧。
- BR-2 滚动帧内层派发顺序固定：L1 → L0 → L2 → L3 → 滚动条 → `onScrollFrame` 回调。
- BR-3 快速滚动露白兜底：任何情况下视口内不得出现未绘制格；窗口补齐不能在下一帧内完成时，必须同步画出占位底（背景/网格线）而非空白。
- BR-4 拖动滚动条不得触发全视口重绘（与滚轮同走 band 路径）。
- BR-5 DPR 变化、resize、主题切换为 full invalidation，各层缓存全量失效。

### 3.2 失效

- BR-6 无法给出可靠 bounds 的失效必须登记 full；禁止以猜测的小区域局部重绘。
- BR-7 局部重绘区域一律 `spread(10px).ceil()` 且按 DPR 像素对齐。
- BR-8 行带计划上限 MAX_BANDS=8，超出升级 full。
- BR-9 单帧内渲染循环的补充布局/补充渲染重试上限 3 次。

### 3.3 图片

- BR-10 资源就绪（含缓存命中）时，cell 首次绘制即为真实尺寸，**禁止出现"先按单元格尺寸渲染一帧再调整"**的中间态（废除 opacity hack）。
- BR-11 图片加载完成仅触发引用它的 cell 定向失效；同一渲染帧内多张图完成必须合并失效计划。
- BR-12 非法/加载失败 URL 必须进入 error 态：画 damage 占位 + 触发 `onImageError`；禁止停留在永久 loading 态。
- BR-13 解码位图缓存必须有界（LRU，bytes 计量）；逐出必须 revoke 附着的 objectURL。
- BR-14 `imageSizing` 三态语义对齐 CSS object-fit：contain（默认，兼容 keepAspectRatio）/cover/fill；合并格、clip、圆角组合下行为有 golden 用例。

### 3.4 浮动对象

- BR-15 浮动对象不进 cell 数据流；锚点随行列插入/删除/隐藏/固定宽度变化正确平移（事务级钩子，见 ultra-ui `shiftImages` 原型语义）。
- BR-16 浮动对象渲染与滚动帧级同步：任何滚动帧内浮动对象位置与 cell 网格无肉眼错位。
- BR-17 命中浮动对象区域时，交互控制权经 interceptFilter 交给浮动层；滚轮在浮动层透传为表格滚动。
- BR-18 `exportCanvas()` 默认包含浮动对象与 media 层。

### 3.5 chart 扩展

- BR-19 chart cell 渲染、失效、动画不得触发 L0/L1 重绘；chart 位图缓存 key 必须含 contentVersion/尺寸/DPR。
- BR-20 内置 cellType 与用户扩展走同一 ExtensionRegistry；移除内置类型的旁路实现。

## 4. 兼容性约束

- C-1 公开 API（构造 options、事件名、实例方法）向后兼容；仅在 minor 版本以**新增**方式扩展。
- C-2 `options.canvas` 用户注入保留：自动进入单 canvas 合成模式（降级路径）。
- C-3 `cellType:'image'` 现有 options（keepAspectRatio、imageAutoSizing、margin）行为保持；两处**破坏性行为修正**（移除 opacity hack 中间态、error 必触发事件）在 CHANGELOG 显著标注。
- C-4 导出语义：`exportCanvas` 结果必须与屏幕合成一致（golden 对比用例）。
- C-5 下游契约（ultra-ui/sheet-core "数据模型自持有，VTable 只做渲染与输入"）：浮动对象不内置历史栈，变更以事件/patch 抛出由宿主入库。
- C-6 引擎约束（随 08 引擎策略修订新增）：渲染引擎形态（npm vrender / vrender-lite fork / vtable-engine）属于内部实现细节，RenderHost 接口语义在切换期间保持稳定；E1 vendor fork 后不再跟随上游 vrender 版本，安全修复自行 cherry-pick；每次引擎形态切换（A→B→C）须附 §1.2/§1.4 全量基准与体积数字。

## 5. 测试与验收流程

1. **单测**：InvalidationQueue 合并语义、ScrollManager 合帧/source、MediaCache LRU/key 失效、ImageService 状态机（含 URL resolver）、浮动对象锚点平移。
2. **golden 截图**：sizing 三态 ×（普通格/合并格/冻结区/圆角）矩阵、四层合成导出、占位三态（loading/damage/就绪）。
3. **基准**：§1.1 六场景，每里程碑出口跑全量并归档；护栏规则见 §1.3。
4. **人工验收**：showRepaint 逐场景核对失效面积；ultra-ui 联调用例（拖拽/undo/xlsx 往返/导出/触控互斥）。
5. **发布门**：CHANGELOG 完整；降级开关回归；性能目标逐项对照本规格签字。

---

*本规格随里程碑演进修订；任何与 02/03/04 设计文档冲突之处，以本规格 §1.2/§2/§3 为准并提出修订评审。*
