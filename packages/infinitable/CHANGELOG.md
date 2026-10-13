# infinitable

## 0.2.0

### Minor Changes

- a87051d: 合并区重叠不再打断渲染：脏合并区（历史模板/外部导入/程序化拼装）在批量数据入口自动规范化——保留先声明区间、丢弃冲突项并 console 提示，不再以未捕获异常打断网格重建与快照恢复

  - 新增类型化错误 `MergeOverlapError`：`MergeCellMap` 构造与 `addMergeCell`（程序化单命令 fail-fast 层）重叠时抛出，携带冲突坐标与两条冲突区间原文，宿主可 `instanceof` 定位
  - 新增 `sanitizeMerges(ranges)` 纯函数导出：与 `MergeCellMap` 同一套归一化语义，宿主可在写快照前自救脏数据；`ListTable` 构造参数与 `setMergeCells` 内部同源消解（附带 `warnMergeConflicts` 与 `MergeConflict`/`SanitizedMerges` 类型导出）
  - sheet 快照恢复（`restore` / `restoreContent`，含 RestoreSheetCommand 与 undo/redo 回放）对重叠合并区先规范化再入模型，脏快照的单条重叠不再污染合并索引
  - 行为变更：`setMergeCells` 重叠不再抛错（改为规范化 + warning）；模型越界校验不变仍抛错保持原状

### Patch Changes

- e014376: fix(core,media): 同格替换或移除后再嵌入图片，不再始终显示第一张图——`refreshImageCell` 在换 URL / 移除时同步失效 cell 级位图缓存（缓存 key 不含 URL，旧条目残留会让新 URL 永不发起加载）；undo/redo 回放 clone 载荷换 URL 的同源场景一并修复

  feat(core,sheet): 函数参数格支持 shift+点选批量扩展——新增 `resolveShiftSelectAnchor` 锚点解析 hook 与选区拦截回交元信息 `SelectionInterceptMeta`（shiftKey/extend），引用拾取手势以上次拾取锚点连续扩展（宿主据此替换上次插入的引用）；普通模式 shift+点选按画布选区末段锚点扩展（键盘 shift 扩展的同语义指针版）

## 0.1.8

### Patch Changes

- 589da32: 图片格白底收窄到位图实际区域：contain 缩放的留白不再整格填充白底（原实现把网格线盖住），格底色与网格线从留白处透出；透明位图在位图区域内仍有白底兜底保证可读。fill 铺满语义不变

## 0.1.7

### Patch Changes

- ac0e5ff: fix(formulas): affectedBy 恢复批量点查两段式（#8）并修复百万格批量写 O(n²) 卡死

  - `affectedBy` 曾用 `queue.shift()` 排空整批变更坐标（V8 下每次搬移剩余元素，O(n²)）：十万行 × 12 列单批 `setCells` 主线程阻塞数分钟，且与有无公式无关
  - 两段式恢复旧 sheet-core 的批量口径：初始变更坐标按表分组——单格依赖逐点 O(1) 点查，区域依赖合并为按行列区间后每条目一次相交判定（连续矩形批量变更区间数 ≪ 格数，随机分散退化同阶不更差）；仅命中公式格进 BFS 队列（游标消费）
  - 空图快路径：全簿无公式格时闭包必空，直接返回，跳过逐格遍历与按表分组
  - `FormulaEngine.recalc` 空簿早退：无公式数据下百万级批量初始化写重算编排零开销（恢复 Phase 6 文档承诺）
  - 回归防护：15 万坐标级大批量用例 + 随机图 × 随机变更集与朴素参考闭包的 30 轮差分等价测试

- 79cca48: feat: sheet 超链接与图片能力（对齐 WPS 桌面核心体验）

  - 单元格超链接全链路：sheet 模型按格存链接（URL+可选显示文本，可 undo/redo、随结构平移）；有链接格自动蓝字下划线（resolveCellStyle 可覆盖，主题 token `linkColor`）；悬停 pointer 光标 + hover/leave 事件；单击打开（`openCellLinkOnClick` 默认开、可关给宿主接管）；框选/拖选/键盘选中不误触；SheetGrid 经 `GridCellLinks` 桥自动接线，宿主零 hook
  - 图片嵌入单元格：模型按格存图（字节或 URL），自动接入 media 渲染通道，随格缩放（contain 默认/fill 可选）、随行列插删平移；`insertCellImage`/`removeCellImage` 可 undo，`cell-image-change` 事件，`hasCellImage` 查询 API
  - 浮动图片右键不穿透：contextmenu 优先命中浮动层，命中图片改派发 `floatObjects.onContextMenu`（带图片 id/位置），不再落到单元格菜单
  - 图片超链接：`SheetImage`/嵌入图新增 `link` 字段（可 undo 写入/清除），带链接图片单击打开链接、无链接保持原选中行为
  - 公共面新增 23 个类型与值导出（infinitable 主入口 + `infinitable/sheet` 子路径），快照与 agent-docs 同步；playground 新增 `hyperlink-image` 演示页
