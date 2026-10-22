# 更新日志

当前版本 **0.3.4**。完整、逐提交的变更记录见 [`packages/infinitable/CHANGELOG.md`](https://github.com/cabinet-fe/infinite-table/blob/main/packages/infinitable/CHANGELOG.md)。

## 0.3.x

### 0.3.4

- 修复：格内图片不再盖住单元格边框。media 层绘制区按本格生效边框线宽内缩（默认网格线右/下 1px），显式边框变化经 `refreshCell` 联动同步。

### 0.3.3

- 修复：容器宽度连续变化时防抖后再调整表格视口，避免拖动浏览器宽度时画布反复清空闪烁。

### 0.3.2

- 修复：xlsx 导出后行高整体偏小、单元格垂直对齐与 UI 不一致。

### 0.3.1

- 新增：打印横向分页（列切带）、打印区域 `rowRange` / `colRange`、自定义百分比缩放。
- 修复：真实打印路径延迟回收 iframe，修复 Firefox / Safari 打印截断。
- 修复：`resize` 沿构造期显式 dpr，不再被环境值覆盖。
- 修复：xlsx 导出物化合并区覆盖格有效样式，补全多行/列合并外边框。

### 0.3.0

- 公共面收缩：移除从未实现的 `PrintImagePayload` 及其 `PrintSource.images` / `imageData` 字段；`./sheet` 子路径移除零调用的模型方法（`MergeManager.merge/unmerge/isMerged/isCovered`、`CellMetaStore.delete/has/entries`、`SelectionModel.clear`、`CellStore.setCellValue/peekEntries`、`Sheet.entriesCellMeta`），补齐 `SelectionInterceptMeta` 类型转出。
- 修复：xlsx 导出通用格式关键字由中文 UI 写法改为跨 locale 的 `General`。

## 0.2.x

### 0.2.4

- 修复：`growOnScroll: false` 的固定尺寸网格不再被容器 resize 撑大；滚动接线、容器 resize 补增长、初始网格估算三处共用同一门控。

### 0.2.3

- 修复：编辑提交空值不再清掉单元格样式；无变化提交跳过写回与变更事件，不污染数据与 undo 栈。

### 0.2.2

- 新增：编辑浮层边框内缩 `editorInsideBorder`（`ListTableOptions` / `SheetGridOptions`），对齐 Excel / WPS 的编辑期边框可见行为。

### 0.2.1

- 新增：公式引用拾取染色框，`SheetGrid.setHighlightRanges` 透出引擎 sky 浮层高亮通道；根包补导出 `scanFormulaReferences` 关联类型 `ScannedReference` / `RangeRef`。

### 0.2.0

- 合并区重叠不再打断渲染：脏合并区在批量数据入口自动规范化，保留先声明区间、丢弃冲突项并 console 提示。
- 新增 `MergeOverlapError`、`sanitizeMerges`、`warnMergeConflicts` 与 `MergeConflict` / `SanitizedMerges` 类型。
- `setMergeCells` 重叠不再抛错（改为规范化 + warning）；模型越界校验不变。
- 修复：同格替换或移除后再嵌入图片始终显示第一张图（换 URL / 移除时同步失效 cell 级位图缓存）。
- 新增 `resolveShiftSelectAnchor` 锚点解析 hook 与 `SelectionInterceptMeta`，支持函数参数格 shift+点选批量扩展。

## 0.1.x 摘要

| 版本  | 主要内容                                                                                                    |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| 0.1.8 | 图片格白底收窄到位图实际区域，contain 留白不再盖住网格线                                                    |
| 0.1.7 | `affectedBy` 批量点查恢复两段式，修复百万格批量写 O(n²) 卡死；sheet 超链接与单元格嵌入图全链路              |
| 0.1.4 | 主入口改为显式具名导出，公共面由 `public-surface` 快照冻结；新增浏览器原生滚动条 `scrollbar.mode: 'native'` |
| 0.1.3 | 公共导出面大幅收敛，内部原语不再从 `infinitable` 导出                                                       |
| 0.1.2 | 公共导出面收敛（`ScrollManager`、`ModelBinding`、`CellValuePipeline` 等移出）                               |
| 0.1.0 | 首个发布版本：`ListTable` + 自研渲染引擎 + 公式引擎 + 插件体系                                              |
