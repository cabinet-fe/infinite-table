# 04 · 图片渲染能力设计：ImageService 与浮动对象层

> 服务课题 3：给下游 ultra-ui（`/Users/whj/codes/ultra-ui/packages/sheet-core`，经 npm 使用 @visactor/vtable ^1.26.8 作为电子表格底层）提供可靠、可扩展的图片渲染能力。

---

## 1. 现状与根因（证据链）

### 1.1 上游（旧精简版 / vrender）现状

图片进入场景的三条路径，最终都是 vrender `Image` 图元：

1. `cellType:'image'/'video'`：`scenegraph/group-creater/cell-helper.ts:238-257` → `createImageCellGroup`（`cell-type/image-cell.ts:36-260`），cellGroup `clip:true`，节点打 `__vtable_cell_media__` 标记（`media-cell-helper.ts:4-16`）供复用时移除重建。
2. customRender/customLayout 塞图：`component/custom.ts:286-304`，`new Icon({image: src})`。
3. 列 icon（ColumnIconOption）：`utils/text-icon-layout.ts:519-593`。

加载链路：`Graphic.loadImage`（vrender-core `graphic/graphic.js:1293`）→ 全局 `ResourceLoader.cache`（`resource-loader/loader.js:101`，**永不淘汰**，并发上限 10）→ 成功回调 `Graphic.imageLoadSuccess`（`graphic.js:1313-1317`）→ **`stage.renderNextFrame()` 整层重绘** → vtable successCallback。

### 1.2 根因排序（每条附证据）

| # | 根因 | 证据 |
| --- | --- | --- |
| 1 | **onload → 全量重绘风暴**：每张图成功即 `renderNextFrame`，无脏区/无合并；快速滚动时每屏几十张图分批完成 → 每批一次全量重绘 + 占位↔真图两次视觉跳变 | `graphic.js:1316`；官方注释自认"每一张图加载后就重绘"，节流方案试过又回退（`image-cell.ts:321-322`） |
| 2 | **尺寸未知 → 布局抖动/闪烁**：加载前按单元格渲染，加载后改宽高、`imageAutoSizing` 甚至反改列宽行高；缓存命中场景仍有一帧错误尺寸，只能 opacity 0→setTimeout→1 hack 压制（上游 issue #3588，`4ae3f9824`） | `image-cell.ts:196-210, 272-329` |
| 3 | **URL 语义漏洞**：vrender 只对 `<svg`/isValidUrl/含`/`/base64 四类字符串发起加载，其余**永远 loading 且 failCallback 不触发**（注释自认），只能预判置 damage 图 | `image-cell.ts:249`；vrender `graphic.js:1304-1305`；修复史 `c89a19414`、`d7403e056` |
| 4 | **内存无治理**：`ResourceLoader.cache` 与每实例 `resources` Map 永不淘汰；base64/签名 URL 无限累积；无按视口卸载 | `loader.js:101` |
| 5 | **无浮动对象模型**：`cellType:'image'` 是"格内贴图"语义；跨格、像素偏移、拖拽/选中/删除、随行列增删锚点平移、undo 一概没有 → **这是 ultra-ui 弃用 canvas 通道的根本原因** | ultra-ui 自建 `packages/sheet-core/src/grid/image-layer.ts`（约 760 行 DOM 叠层） |
| 6 | 长尾：合并格 dx/dy 补偿与三处手写 resize 重排的一致性、clip+圆角叠加（上游 `21bb4d82e`）、customLayout 关闭 fast-update 的副作用（ultra-ui `sheet-grid.ts:338-345` 注释） | `update-width.ts:348`、`update-height.ts:205-213`、`scenegraph.ts:2179-2183` |

### 1.3 下游现状（ultra-ui/sheet-core）

- 数据模型自持有：`SheetImage`（data 字节或 src、anchor from/to + 格内像素偏移、`fit: fill/contain`）+ InsertImage/RemoveImage/UpdateImage 命令进 HistoryManager，undo/redo 完整（`core/image.ts:21-55`、`core/command/image.ts`、xlsx 往返 `core/io/import.ts:335-346` / `export.ts:135-147`）。
- 渲染：自研 DOM 叠层 ImageLayer（`grid/image-layer.ts`）——`zIndex:1` 盖在 VTable canvas 上；视口外 240px 预挂防露白；rAF 节流重排；objectURL 生命周期自管（revoke）；`img.load` 后补 naturalWidth 二次布局；交互（拖拽/选中/删除/滚轮转发/触控互斥）全部自研并需与 VTable 事件系统摩擦协调（`sheet-grid.ts:509-590` 处处绕开图片态）。
- **从不用 VTable 的 canvas 图片通道**（全 packages 无 `'image'` cellType 用法）。

## 2. 设计目标

1. canvas 通道的图片渲染做到：**零闪烁、零全量重绘、可预期占位、内存有界、事件外露、缓存可失效**。
2. 提供浮动对象一等公民能力，使 ultra-ui 可以**删除自研 DOM ImageLayer**，或至少获得等价的 canvas 路线选择权。
3. 对外 API 向后兼容（`cellType:'image'` 现有行为不破坏）。

## 3. ImageService 设计

### 3.1 接口

```ts
export interface ImageServiceOptions {
  maxCacheBytes?: number;          // 解码位图 LRU 预算，默认 256MB
  maxCacheCount?: number;          // 条目上限，默认 1000
  concurrency?: number;            // 加载并发，默认 10（对齐现 loader）
  placeholderDelay?: number;       // 占位延迟显示 ms，默认 80（防快速滚动占位闪烁，学 leafer）
  crossOrigin?: string | null;
}

export class ImageService {
  /** 同步查询：资源是否已就绪（首帧无闪的关键） */
  hasResource(url: string): boolean;
  /** 请求资源；返回当前状态。window 语义：滚动出视口+余量的请求自动降级/取消 */
  request(url: string, cell: CellRef, onSettled?: (s: ImageState) => void): ImageState;
  /** 失效：按 URL 逐出缓存并重绘引用它的可见 cell（签名 URL 轮换/头像编辑场景） */
  invalidate(url: string): void;
  invalidateAll(): void;
  /** 事件：加载完成/失败（下游据此做二次布局等） */
  onImageLoad(cb: (e: { url: string; width: number; height: number; cells: CellRef[] }) => void): () => void;
  onImageError(cb: (e: { url: string; error: unknown; cells: CellRef[] }) => void): () => void;
  /** URL 规范化钩子：鉴权相对路径、协议相对路径由宿主补全（根治根因 3） */
  setUrlResolver(resolver: (raw: string) => string | null): void; // 返回 null = 判定非法，直接走 error
  configure(opts: ImageServiceOptions): void;
  dispose(): void;
}
```

### 3.2 关键机制

| 机制 | 设计 | 对应根因 |
| --- | --- | --- |
| **单帧无闪协议** | cell 构建时先 `hasResource(url)`：命中 → 直接按真实宽高建节点（**不再有"先按单元格渲一帧再调整"**）；未命中 → 画确定性占位（loading spinner/damage 由 Service 提供，`placeholderDelay` 内不画），加载完成后**该 cell 定向失效**（失效三档模型的 cell 档），替代 `stage.renderNextFrame` 全量重绘。取消 opacity hack（`image-cell.ts:196-210`） | 1、2 |
| **surface 级失效** | 图片加载完成只标 `addUpdateBoundTag` + cell 失效（学 leafer `forceUpdate('surface')`），且本帧多张图完成合并为一次失效计划 | 1 |
| **窗口化加载** | 只对"视口 + 余量（240px，对齐 ultra-ui 预挂值）"内的请求保持 pending；滚出窗口降级到 idle 队列/取消；可见绘制时提权（沿用现 `improveImageLoading`） | 1、4 |
| **两级缓存 + LRU** | 解码位图级 LRU（bytes 计量）+ 原始响应缓存；同 URL 引用计数；逐出时 revocable 资源（objectURL）统一 revoke | 4 |
| **尺寸语义补全** | 透传 vrender 已有的 `imageMode: cover/contain/fill/auto + imageScale/Offset/Position + repeat`（vrender `image-render.js:19-83` 现成但 vtable 未暴露）；新增样式项 `imageSizing`/`imageAlign`/`imageRadius`；`keepAspectRatio` 保留为 contain 的兼容别名 | 2、6 |
| **URL 语义** | `setUrlResolver` 钩子 + 内置宽松判定（任何非空字符串尝试加载，失败即 error 态），消灭"永远 loading"态；error 态进 damage 占位并触发 `onImageError` | 3 |
| **imageAutoSizing 收敛** | 反改列宽行高的行为保留但改为：先以估算宽高占位布局 → 加载后一次修正 → band 失效；不再二次跳变 | 2 |
| **resize 一致性** | 三处手写重排（`update-width.ts:348`、`update-height.ts:205-213`、`scenegraph.ts:2179-2183`）收敛为 ImageService 的单点 `onCellSizeChange` 处理 | 6 |

### 3.3 落位

- 图片 cell 归入 **L2 media 层**（见 03 文档 §2.4）：加载完成的图片 cell 用 MediaCache 位图缓存（isStatic 语义），滚动 blit；未就绪画占位。文本滚动帧与图片解码彻底解耦。
- `ResourceLoader`（vrender 内）保留为传输层，Cache 淘汰策略由 ImageService 上一层控制；vrender 不动。

## 4. FloatObjectLayer（浮动对象层）

### 4.1 模型

```ts
export interface FloatObject {                 // 对齐 ultra-ui SheetImage，可直接映射
  id: string;
  kind: 'image' | 'chart' | 'dom';             // image 首批；chart 复用 MediaCache；dom 预留
  anchor: { from: CellRef; to: CellRef; offsetX: number; offsetY: number };
  size?: { width: number; height: number };    // 绝对像素（与 anchor 并存，from 锚定 + 尺寸）
  fit?: 'fill' | 'contain';
  src?: string; data?: Blob | Uint8Array;
  alt?: string; title?: string;
}

table.floatObjects.add(obj): void;             // 不进 cell 数据流，独立 Object 树
table.floatObjects.remove(id): void;
table.floatObjects.update(id, patch): void;    // 触发锚点重算与失效
table.floatObjects.getAt(x, y): FloatObject | null;   // 命中（供交互）
onFloatObjectChange(cb): () => void;           // 增删改/锚点平移事件（供 undo/历史集成）
```

- 渲染在 **L3 sky 之上、独立顶层绘制段**（或独立 float 层，M4 实测定）：滚动帧随 ScrollManager 同步重排（`onScrollFrame` 帧级同步，消除 DOM 方案的 rAF 近似错位）；锚点随行列插入/删除/隐藏平移——由表格内部在行/列结构变更事务里钩子完成（上游已有 `shiftImages` 的需求原型，见 ultra-ui `core/sheet.ts:733`）。
- **交互协议**：`table.setInterceptFilter((e) => floatLayer.wants(e))` —— 命中浮动对象的 pointer 事件先交给浮层状态机（拖拽阈值、选中框、Delete 删除、滚轮透传滚动），替代 ultra-ui 现在的 capture 抢劫式拦截（`image-layer.ts:220-335`）。
- **undo/历史**：浮动对象变更以 command/patch 形式抛出（`onFloatObjectChange`），由宿主（ultra-ui 的 HistoryManager）入库；VTable 不内置历史栈（保持"数据模型自持有"的分工，尊重下游 AGENTS.md 约定）。
- **导出**：`exportCanvas()` 合成时包含浮动对象（ultra-ui DOM 层无法进截图的痛点）。

### 4.2 ultra-ui 迁移路径

| 阶段 | 动作 |
| --- | --- |
| T1（无改动） | ultra-ui 维持 DOM ImageLayer；仅接入 `onScrollFrame` + `getScrollState()` 把近似同步升级为帧级同步，消除快速滚动错位窗口 |
| T2 | 以 `FloatObjectLayer` 试点图片渲染：`FloatObject` 直接映射 `SheetImage`；交互用 interceptFilter；undo 走现有 command |
| T3 | 删除 image-layer.ts（约 760 行）与 sheet-grid.ts 中的图片态摩擦代码；xlsx 往返、fit/contain 语义回归 |
| 兜底 | 若 M4 交付延期，T1 是零成本独立收益，先行落地 |

## 5. 内存治理规格

- 解码位图缓存：LRU，`maxCacheBytes` 默认 256MB、`maxCacheCount` 1000，超限逐出最久未用且**不在当前视口+余量内**的条目。
- objectURL：由 Service 统一 create/revoke（字节来源）；宿主 dispose 时 `imageService.dispose()` 全量回收。
- 视口卸载：滚出"视口+2 屏"的 media cell 释放节点/位图引用（数据与缓存仍在 LRU 中，可快速回填）。
- 长会话回归指标：1000 张图连续滚动 10 分钟，内存曲线峰值受 `maxCacheBytes` 约束（见 07 规格）。

## 6. 兼容性

- `cellType:'image'` 现有 options（keepAspectRatio、imageAutoSizing、margin 等）行为保持；内部改走 ImageService + media 层。
- 移除项：opacity 0→1 hack、失败静默（error 必触发 `onImageError`）；这两项是行为修正，在 CHANGELOG 标注。
- `@visactor/vtable` npm 版与旧精简版同步演进，ultra-ui 升级路径：T1（小版本）→ T2/T3（minor）。
