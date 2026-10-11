# infinitable

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
