# infinitable

## 0.3.3

### Patch Changes

- 9c79d35: fix: 容器宽度连续变化时防抖后再调整表格视口，避免拖动浏览器宽度时画布反复清空闪烁

## 0.3.2

### Patch Changes

- ad92ae3: fix: 修复 xlsx 导出后行高整体偏小及单元格垂直对齐与 UI 不一致

## 0.3.1

### Patch Changes

- 55cd6d8: feat(print): 横向分页（列切带）、打印区域 rowRange/colRange、自定义百分比缩放
  fix(print): 真实打印路径延迟回收 iframe，修复 Firefox/Safari 打印截断
  fix(core,sheet): resize 沿构造期显式 dpr，不再被环境值覆盖
  fix(sheet): xlsx 导出物化合并区覆盖格有效样式，修复多行/列合并外边框缺失

## 0.3.0

### Minor Changes

- 99f3b23: chore: 清理死代码与迁移遗留，公共面收缩——主入口移除从未实现的 print 浮动图类型 `PrintImagePayload`（`PrintSource.images`/`imageData` 字段随删：收数口存在但渲染链路从未实现，声明即撒谎）；`./sheet` 子路径移除零调用的模型方法（`MergeManager.merge/unmerge/isMerged/isCovered`、`CellMetaStore.delete/has/entries`、`SelectionModel.clear`、`CellStore.setCellValue/peekEntries`、`Sheet.entriesCellMeta`，均为 sheet 自 plugins 迁入后失去消费方的旧 handle 面），并补齐 `SelectionInterceptMeta` 类型转出（`@infinitable/sheet` 已导出而 `./sheet` 快照漏转，两包面对齐）。其余为包内死代码删除与重复实现收敛（core 等行高旧布局三函数、formulas 词法原语收敛 lexicon.ts、playground 孤儿组件与未用依赖），不影响公共 API。

### Patch Changes

- 3d26714: fix: cnUpper 导出 xlsx 的通用格式关键字由中文 UI 写法 `G/通用格式` 改为跨 locale 标准写法 `General`（`[DBNum2][$-804]General`）——中文关键字在非中文 locale 的 Excel 中不被识别，格式码尾部被当字面量显示为「/通用格式」；`General` 中文 Excel 同样识别，导入侧按 `[DBNum2` 前缀识别不受影响，查看态显示路径不变。

## 0.2.4

### Patch Changes

- 1bfe209: fix: growOnScroll: false 固定尺寸网格不再被容器 resize 撑大——此前 bindResize 回调无条件调 growOnNearEdge，违背该选项「滚动与 resize 均不增长」的语义。growOnScroll 提为实例字段统一门控：滚动接线、容器 resize 补增长、初始网格估算三处同源；缺省（true）行为不变，容器放大后仍按新视口补增长

## 0.2.3

### Patch Changes

- 6b37b46: fix: 修复编辑提交空值清掉单元格样式——仅设样式（如边框）无值的格，双击进入编辑后失焦提交不再丢失样式。SetCellValueCommand 清值分支保留既有样式（清样式仍走 setCellStyle 独立通道）；EditManager 无变化提交跳过写回与变更事件，不再污染数据与 undo 栈；导入清空适配为值/样式两步清除（同一事务单 undo 单元）

## 0.2.2

### Patch Changes

- 4662fc3: feat(core,sheet): 编辑浮层边框内缩 editorInsideBorder——ListTableOptions/SheetGridOptions 新增 opt-in 开关（缺省 false 行为不变），开启后编辑浮层按锚定格（合并主格归一）四周可视边框线宽内缩（含浮层自带边框骑缘补偿 1px），浮层落在边框内侧、格边框编辑期保持可见（对齐 Excel/WPS），双击编辑不再吞掉本格自画的 right/bottom 粗边框；只读查看器不开编辑浮层不受影响

## 0.2.1

### Patch Changes

- a1b104d: feat(core,sheet): 公式引用拾取染色框——`SheetGrid.setHighlightRanges` 门面透出引擎 sky 浮层宿主高亮通道（每引用段一圈彩色细边框，随滚动/选区重绘，空数组清除），根包补导出 `scanFormulaReferences` 关联类型 `ScannedReference`/`RangeRef`，宿主可按公式文本扫描逐引用上框对齐 Excel 点选反馈

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
