# 分层架构：扩展性、独立 canvas 必要性、虚拟分层与行列头层级

## 背景

围绕 `packages/render` 的四层 canvas（ground/body/media/sky）分层架构回答四个问题：加一层是否容易；每层一个独立 canvas 是否必要；是否存在虚拟分层；行头/列头是否应处于最上层。范围为 `packages/render`、`packages/core`、`apps/bench` 及相关设计文档，全程只读。

## 方法

拆为四个维度，各派一个只读子代理并行核实代码：

1. 扩展性：层的定义、注册、z 序、失效策略与层集合的耦合点，估算加一层的改动清单。
2. 独立 canvas：canvas 创建与池化实现、独立 backing store 的独占收益与成本、bench 佐证。
3. 虚拟分层：场景树是否有层内子层抽象，FloatObjectLayer 等是否构成事实虚拟层。
4. 行列头层级：行列头/冻结区所在层与层内 z 序、滚动行为、与 Excel 类惯例的对照。

## 发现

### 扩展性

- 层是字符串字面量联合类型 `LayerKind`（`packages/render/src/types.ts:20`）；z 序写死在 `LAYER_ORDER`（`packages/render/src/render-host.ts:39`）；失效消费策略穷举写死在 `LAYER_CONSUMPTION: Record<LayerKind, Consumption>`（`packages/render/src/invalidation/invalidation-queue.ts:13-24`）。三者构成事实上的"层描述符"，加一层在 render 包内约 3 处、个位数行，且 `Record` 类型让 TS 编译器强制补全，不会静默漏改。
- FrameScheduler、CanvasPool、CanvasLayer、事件系统均与层集合解耦，新层自动获得失效合并、事件命中、flush 排序、blit 全套行为。
- 两个封闭点：① `mount()` 纯 `appendChild`，不设 z-index 也不按 `LAYER_ORDER` 插入（`render-host.ts:161-177`），DOM 叠放顺序=创建顺序——core 惰性创建 media（`packages/core/src/list-table.ts:783-788`）晚于 sky，上屏时 media 实际压在 sky 之上，与声明 z 序不符，是现存缺陷；② core 侧以裸字符串引用层名十余处，层职责全部内联在 `list-table.ts`（约 1370 行），没有 per-layer 宿主抽象，加层的真实工作量在这里。
- ground 层在 core 全仓从未被创建，"四层"名头与实际用量（2~3 个 canvas）有出入。

### 独立 canvas

- 每层确为独立 `<canvas>`（`render-host.ts:84`），但惰性创建使实际数量收敛到 2~3 个。
- 只有独立 backing store 才能做且被实际消费的收益：sky 重绘不牵连 body（hover/选区/resize 全部走 sky full 失效，body 零重绘，`list-table.ts:1330-1345`）；media 图片 onload 只重绘 media cell（`list-table.ts:850-871`）。translateBy blit 自拷贝已实现（`packages/render/src/layers/canvas-layer.ts:65-98`）但 core 从无调用方，是未消费的预留能力。
- 逻辑分层同样能做的：三档失效、按层合并、帧收敛、cull 裁剪——与 canvas 数量无关；设计文档（已删除的 `docs/perf-redesign` 03 §5，git 历史可查）自己设计了 `layers: false` 单 canvas 降级模式佐证这一点。
- 成本侧缺测量：backing store 内存（N×W×H×dpr²×4B）无任何实测；bench 浏览器基线滚动 60fps、JS 帧 P95 0.60ms，证明失效隔离有效，但没有单 canvas 对照组。附带缺口：core 从未调用 `setSize`，多 canvas 尺寸一致性无人维护；设计承诺的跨层导出 `exportCanvas()` 未实现。

### 虚拟分层

- render 包内"层 == canvas"绑定是绝对的：无 VirtualLayer/Group/SubLayer 抽象，层内 z 序只有 children 数组顺序（后画在上），无 zIndex/insertAt（`packages/render/src/scene/scene-node.ts:19-58`）。
- FloatObjectLayer 是事实上的虚拟层：容器节点挂进 sky root 末尾（"最顶"靠挂载时序约定），有独立对象树、生命周期、失效提交与命中接口（`packages/core/src/float/float-object-layer.ts:67,77`）。InteractionOverlay 同理。证明层内逻辑子层在现有树上可行。
- 正式化缺三样：节点级自动 dirty 上报（现在靠各虚拟层手算 region 显式 invalidate）；可靠的层内 z 序（append 时序是隐式契约，后来者 append 即破坏）；按子树/可配置的失效消费（sky 恒 `always-full`，虚拟层的细粒度失效在 sky 上无意义）。

### 行列头层级

- 行头/列头/左上角是 body 层内的普通 CellNode，`rebuildScene` 按"滚动区→合并区→冻结带→冻结角→行列头"顺序挂载，表头层内最顶（`list-table.ts:632-675, 924-985`）。滚动时整树重建 + band 失效，band 起点对齐表头边界，纯文本内容下遮挡关系正确、无残影。
- 一处实质缺陷：media 层叠在 body 之上，而图片格可越出 bodyViewport——`ImageCellNode.paint` 无自裁剪（`packages/core/src/media/image-cell-node.ts:52-62`），图片落定的 cell 级定向失效用全包围盒、几何变更走 media full 重绘，边缘半格图片会画进表头区域并盖住表头，且后续 band 重绘不清残影。
- sky 层：InteractionOverlay 整体 clip 到 bodyViewport，选区/hover/resize 线不跨表头（`packages/core/src/interaction-overlay.ts:52-56`，选整行整列时表头无高亮，低于 Excel 表现但自洽）；FloatObjectLayer 无裁剪、在 sky 最顶，浮动对象可盖表头，符合惯例。

## 结论

1. **加层容易，但有两个前置缺陷。** render 包内注册新层是编译器兜底的个位数行改动；真正的成本在 core 侧层职责的内联管理。且 `mount()` 的 DOM 叠放顺序缺陷意味着任何惰性创建的新层都可能叠错——这是加层前必须先修的。
2. **并非每层都必须独立 canvas，架构的支点是 sky/body 二分离。** sky 独立必要性最强且被实际消费；media 中等（图片隔离真实，chart 预留未兑现）；ground 是死重（从未创建，其设计收益依赖 core 未接入的 blit 链路）。失效模型本身是逻辑概念，与 canvas 数量无关。
3. **没有正式虚拟分层，但已有两个事实虚拟层。** FloatObjectLayer 与 InteractionOverlay 证明模式可行；缺节点级自动失效、层内 z 序、按子树的失效消费三者才能机制化。
4. **"行列头应在最上层"部分成立、过度泛化。** 正确 z 序是：行列头高于滚动格内容（已实现，body 层内最顶）、低于交互浮层与浮动对象（也已是）。当前层级设计本身没有错；若实际看到表头被盖，根因是 media 层图片越界绘制的 bug，而非层级安排。

## 建议

1. 修 `mount()`：按 `LAYER_ORDER` insertBefore 或设 z-index，使 DOM 叠放与声明 z 序一致（加层前置）。
2. 修 media 越界：给 `ImageCellNode.paint` 或 media 增量/full 重绘加 bodyViewport 裁剪。
3. 删除 ground kind（或等静态层缓存需求真实出现再建），收敛 API 表面积与"四层"叙事。
4. 若推进虚拟分层：优先引入节点级 dirty 上报与层内 zIndex/insertAt；短期可先把 FloatObjectLayer 的注入式模式固化，core 自身的 body/media/sky 管理也收敛为同模式，降低加层成本。
5. 对齐文档：`translateBy`、`setSize` core 均未消费，`exportCanvas` 未实现；`docs/perf-redesign` 已删但 `ARCHITECTURE.md:12` 与 `invalidation-queue.ts:4-6` 注释仍引用（死链），`CODE-MAP.md` 关键路径描述偏强——走 sync-docs 修正。
