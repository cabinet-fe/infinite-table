# 差距分析：infinite-table 作为 ultra-ui sheet / sheet-core 底层还差多少

> **⚠️ 本文已过时（2026-09-18）**：下文列出的 P0 十项差距（文本样式管线、多选区、填充柄、几何查询 API、运行时冻结/合并、resize 事件、Enter 编辑开关等）**已全部落地并有单测**（commits `af5a41a`~`be28c05`）。当前真实剩余差距与后续计划以「插件化形态可替换 ultra-ui 底层引擎」实现计划（S1~S6，cooking 单位 `s1-engine-closeout` 起）为准，本文仅存档。

## 结论（TL;DR）

替换边界比想象的小：**ultra-ui 的 sheet-core 分两层，无头模型层 `core/`（Workbook/Sheet/公式/命令/撤销/样式池/XLSX-CSV IO，与渲染无关）不需要动；Vue 层 `@veltra/sheet` 基本不需要动。真正要替换的是 `grid/` 适配层下面的 `@visactor/vtable` ListTable**——即 infinite-table 的 ListTable 要能顶住 `SheetGrid`（`ultra-ui/packages/sheet-core/src/grid/`，10 文件 2919 行）所依赖的 VTable 接口面。

按这个标准衡量：

- **渲染与交互骨架已就绪约七成**：虚拟滚动、行列头/行号列、冻结、合并、选区、resize、键盘导航、编辑生命周期、主题 extends、格内图片、浮动对象、按格 value/style/renderer hook（API 形状与 SheetGrid 的三个 resolve hook 一一对应，显然是对着这个目标设计的）。
- **但"Excel 化"的最后一段路全部未开工**，缺口集中在四块：
  1. **结构化文本样式渲染管线**（对齐/加粗斜体/下划线删除线/字号/省略号/格内边距/边框线型）——infinite-table 的 CellStyle 只有 `background/color/font(CSS 简写)/textWrap/border{width,color}`，文本绘制硬编码左对齐+垂直居中+8px 内边距，完全没有这些维度。这是最大单项，没有它 sheet 的样式池/工具栏全部白搭。
  2. **多选区与几何/滚动查询 API 面**——SheetGrid 日常调用的 `selectCells/getSelectedCellRanges/scrollToCell/getCellRelativeRect/getCellAtRelativePosition/getDrawRange/getBodyVisibleCellRange` 等公开 API 缺失（内部布局函数大多已有，缺封装）。
  3. **填充柄（fill handle）交互**——完全没有；好在填充生成逻辑在 ultra-ui 模型侧（`generateFill`），内核只需画柄+抛事件。
  4. **运行时结构可变**——冻结数、合并区目前只能构造期给定，Sheet 的冻结/合并命令需要运行时改。
- 另有 2 个自家分析（`.agents/analysis/layer-architecture.md`）发现的现存缺陷（mount DOM 叠放 z 序、media 层图片越界画进表头）属于"接上前必修"。
- 工程量粗估：P0 缺口合计约 **3~5k 行**（含测试），主要集中在 `packages/core` 的 cell-style / cell-renderer / cell-node / theme / list-table 公开 API；另需重写 grid 适配层约 3k 行（可放 ultra-ui 侧，或本仓出 `@infinite-table/sheet-adapter`）。

---

## 一、替换边界：三层各归哪里

```text
@veltra/sheet (Vue, 58 文件 ~8.9k 行)
  │  公式栏/建议列表/工具栏/sheet tabs/右键菜单/查找替换/插图片——全部走 facade 与无头模型
  ▼
@veltra/sheet-core
  ├─ core/  无头模型层（~22k 行含测试）：Workbook/Sheet/CellStore/SelectionModel/
  │         MergeManager/StylePool/命令注册表+HistoryManager/公式引擎(自研)/IO(hucre XLSX+CSV)
  │         ★ 与渲染零耦合，不替换
  └─ grid/  VTable 适配层（10 文件 2919 行）：SheetGrid facade + GridSyncManager/
            GridSelectionController/GridStyleResolver/GridRowHeightEngine/ImageLayer/
            GridCoords/FormulaAwareInputEditor/vtable-theme
            ★ infinite-table 替换的就是这一层脚下的 ListTable
```

关键证据：
- `sheet-core/src/index.ts` 注释明确"主入口不 re-export grid，避免无头 API 把 @visactor/vtable 类型图拉进 TS 程序"——模型层对 VTable 零依赖，VTable 只出现在 `src/grid/`（grep 证实：全部 9 处 import 都在 grid/ 下）。
- Vue 层 `use-sheet-grid.ts` 只消费 `SheetGrid` facade + core 符号；直接摸 ListTable 的只有测试（`getCellValue/changeCellValue/startEditCell/completeEditCell/frozenRowCount/rowCount`）。
- hucre 是 XLSX/CSV 读取库（`core/io/import.ts`），与表格内核无关，不受替换影响。

## 二、SheetGrid 依赖的 VTable 接口面（完整清单）

以下是从 grid/ 逐文件提取的**全部** VTable 表面积，即适配层需要 infinite-table 等价支撑的最小集合。

### 构造 options（`sheet-grid.ts buildOptions()`）

| VTable option | 用途 | ultra-ui 取值 |
| --- | --- | --- |
| `records` + `columns[]`（field/title/width/style 回调/editor 回调/customLayout 回调） | 数据与列定义 | 26 列起步，style 为按格回调，editor 按格返回编辑器名或 `''`（只读格） |
| `widthMode: 'standard'` / `defaultRowHeight: 28` | 几何 | 固定 |
| `enableLineBreak` + `maxCharactersNumber: 50000` | 格内换行、编辑字符上限 | 开 |
| `customComputeRowHeight({row})` | 稀疏行高（读模型 Map） | 回调读 `sheet.getRowHeight` |
| `resize: {columnResizeMode:'header', rowResizeMode:'all'}` | 列宽拖表头、行高拖任意行 | readonly 时 'none' |
| `theme: themes.DEFAULT.extends(...)` | 主题 | 见下文主题节 |
| `showHeader` / `rowSeriesNumber{width:46,style}` | 列头/行号列 | 可关 |
| `excelOptions: {fillHandle}` | **填充柄** | 非 readonly 开 |
| `editor: EDITOR_NAME` + `editCellTrigger: 'doubleclick'` | 编辑器与触发 | 单例编辑器 |
| `frozenRowCount/frozenColCount` | 冻结（**含表头计数**：数据冻结数+1） | 随 Sheet.frozen |
| `keyboardOptions` | Tab 移动 / Enter 编辑并下移 / Ctrl+A 全选 / **ctrlMultiSelect:false** | 固定 |
| `customMergeCell(col,row,table)` | 按格动态合并回调（每次 setRecords 重算） | 读 `sheet.merges` |
| `hover:{disableHover:true}` / `eventOptions:{preventDefaultContextMenu:true}` | 关 hover、右键自管 | 固定 |

### 实例方法/属性

`setRecords`（全量重建）、`changeCellValue(col,row,value,false,false)`（写值+局部刷新）、`updateCellContent(col,row)`（局部刷新）、`selectCells(ranges[])` / `getSelectedCellRanges()`、`scrollToCell({col,row})`、`getCellAtRelativePosition(x,y)`、`getCellRelativeRect(col,row)`、`getDrawRange()`、`getBodyVisibleCellRange()`、`isSeriesNumber(col,row)`、`columnHeaderLevelCount`、`rowCount/colCount`、`frozenRowCount/frozenColCount`（**可写属性**）、`get/setColWidth`、`get/setRowHeight`、`get/setScrollLeft/get/setScrollTop`（+`scrollLeft/scrollTop` 属性兜底）、`on/off`、`release()`、以及一个**私有 API 猴补丁** `table._canResizeRow = (col,row)=> isSeriesNumber && …`（限制行高拖拽只在行号列）。

### 事件（`ListTable.EVENT_TYPE`）

`CHANGE_CELL_VALUE`（编辑提交→写模型，含"程序化绕行时回滚视图"语义）、`RESIZE_ROW_END`、`RESIZE_COLUMN_END`（→写模型行高列宽）、`CONTEXTMENU_CELL`、`SELECTED_CELL`、`DRAG_SELECT_END`、`MOUSEDOWN_FILL_HANDLE`、`DRAG_FILL_HANDLE_END`（填充柄）、`SCROLL`（浮动图片层跟随）。

### 按格样式回调（`grid-style-resolver.ts` 产出的 ITextStyleOption 字段）

`bgColor`、`color`、`fontWeight`、`fontStyle`、`underline`、`lineThrough`、`fontSize`（pt→px 换算）、`fontFamily`、`textAlign`、`padding`，以及**逐边数组** `borderColor[4] / borderLineWidth[4] / borderLineDash[4]`（5 种线型→dash 映射，`double` 线型 dash 表达不了，VTable 原生支持）。模型样式来自 StylePool（fill/border 五线型/font 七字段/align 含 wrap）。

### 主题（`vtable-theme.ts`）

`themes.DEFAULT.extends`：`underlayBackgroundColor`、`cellBorderClipDirection:'bottom-right'`（右边框收入本格，解决邻格覆盖）、`defaultStyle/headerStyle/cornerHeaderStyle/rowHeaderStyle/bodyStyle`（bgColor/borderColor/padding[2,6,2,6]/textOverflow:'ellipsis'/textAlign/fontWeight/fontSize）、`frameStyle`（外框线宽/阴影）、`selectionStyle`（选区填充/边框/线宽）。

### 编辑器（`grid-editor-router.ts`）

`register.editor(name, editor)` 全局注册表 + `@visactor/vtable-editors` 的 `InputEditor`/`EditContext`（onStart 拿 `{table,col,row,value}`，可替换初值——公式格显示 `=原文`；onEnd 通知公式栏退出镜像）。编辑器单例 + WeakMap 路由是为绕 VTable 注册表无单条注销、闭包拖死 GC 的**已知泄露坑**（#1 修复注释）。

### 自定义渲染（`sheet-grid.ts` + Vue 层）

按列 `customLayout` 分发器（ADR-0004）：每格回调宿主 `resolveCellRenderer(addr, dataValue)`，返回 `CustomLayout` 对象树（Container/Text/Rect…，从 vtable 导入）或 undefined 回落默认渲染。注意 VTable 有 customLayout 即关 fast-update 快路径——又是绕坑注释。

## 三、已对齐项（infinite-table 已有，概念一一对应）

| SheetGrid 需要 | infinite-table 现状 | 证据 |
| --- | --- | --- |
| 虚拟滚动 + 行列头 + 行号列 + 冻结 + 合并 | 全部已实现；冻结不跨边界、合并不跨冻结边界（语义更严） | `packages/core/src/list-table.ts`、`grid-layout.ts`、`cell-range.ts` |
| records / 按格 hook / 模型订阅三形态 | `records/columns`、`resolveDisplayValue/resolveCellStyle/resolveCellRenderer/resolveCellImage/resolveEditable`、`model: TableModel`+ModelBinding 防回环 | `packages/core/src/types.ts`、`model-binding.ts` |
| 编辑：双击触发、按格可编判定、编辑器路由、Enter/Tab 提交移动、Esc 取消、滚动跟随、滚出自动提交 | EditManager+EditorRegistry+DOM 浮层文本编辑器全有；`resolveEditable` 对应 VTable `editor:'')` 技巧 | `editing/edit-manager.ts`、`editor-registry.ts` |
| CHANGE_CELL_VALUE | `onCellChange`（oldValue/newValue）+ 提交后本格 cell 级失效 | `list-table.ts:542` |
| CONTEXTMENU_CELL / SCROLL | `onContextMenu` / `onScrollFrame`（帧级，比 VTable SCROLL 更强） | `list-table.ts:499,505` |
| SELECTED_CELL / DRAG_SELECT_END | 选区状态机（拖选/整行整列/shift 扩展/回驱防递归）+ `onSelectionChange` + `applyExternalSelection` | `selection.ts` |
| 列宽/行高拖拽 + 上限 | `ResizeSession` + `canResizeCol/canResizeRow` **公开 options**（VTable 只能猴补丁 `_canResizeRow`） | `resize.ts`、`types.ts:186` |
| 触控滚动 | `InertiaScroller/TouchScrollTracker` 已实现 | `touch-scroll.ts` |
| 行高稀疏模型 + wrap 估算 | `get/setRowHeight/colWidth` 逐行逐列可设 | `list-table.ts:470-497` |
| 主题派生 | `extendsTheme`（token 全可选深覆盖） | `theme.ts` |
| 浮动图片层 | ultra-ui ImageLayer 是 DOM 浮层；infinite-table FloatObjectLayer（sky 最顶、滚动帧跟随、onChange 回调）能力对上，适配时二选一 | `float/float-object-layer.ts` |
| 批量更新收敛 | `batchUpdate` 合并单次 band 失效 | `list-table.ts:414` |

## 四、差距清单

### P0 —— 阻断级（不补就无法接 SheetGrid）

1. **结构化文本样式管线**（最大单项）。`CellStyle`（`packages/core/src/cell-style.ts:20`）需扩充：`textAlign`（left/center/right）、`verticalAlign`（top/middle/bottom）、`fontWeight`、`fontStyle`、`fontSize`、`fontFamily`、`underline`、`lineThrough`。现状：文本绘制硬编码左对齐+垂直居中（`cell-renderer.ts:71,75` 的 `TEXT_PADDING_X, height/2+4`），`font` 是 CSS 简写字符串（表达不了下划线/删除线，也没有对齐维度）。样式来源要同时打通：主题分区 token（body/header/corner 行列头各一份）→ 列级 → 按格 hook，逐字段覆盖（对齐 VTable style 合成语义，`grid-style-resolver.ts` 的 `cellStyleToVTableStyle` 就是现成的字段映射参照）。checkbox 等非文本内容也应跟随对齐。
2. **文本溢出模式 + 格内边距**。需要 `textOverflow: 'ellipsis' | 'clip'`（表头/行号列用 ellipsis，数据格按格可选）与每格/主题级 `padding: [上,右,下,左]`（ultra-ui 用 `[2,6,2,6]`）。现状是写死 8px、无省略号、"Excel 式溢出到右侧空格"一种模式（`cell-renderer.ts:44-72`）。溢出模式本身保留，作为 ellipsis 之外的默认。
3. **边框线型**。`CellBorderEdge`（`cell-style.ts:5`）只有 `{width,color}`，缺 `style`（solid/dashed/dotted/double…）。ultra-ui 样式池五线型全部要落渲染；`double` 需要双线绘制而非 dash 近似。同时按格逐边数组语义（四边各自 color/width/style）已有骨架，补线型即可。
4. **`\n` 强制换行（enableLineBreak 等价）**。`wrapTextLines`（`cell-renderer.ts:99`）把文本当无换行符字符流，不识别 `\n`。sheet 单元格粘贴多行文本是常态。`maxCharactersNumber`（5 万字符截断）可放编辑器层做，不算内核缺口。
5. **多选区公开 API + Ctrl 多选开关**。需要 `selectCells(ranges[])`、`getSelectedCellRanges()`，以及 `ctrlMultiSelect` 可配置（ultra-ui 关闭 Ctrl 加选）。现状：`SelectionSnapshot.ranges` 数据结构支持多段，公开 API 只有 `selectCell/selectRow/selectCol/selectAll/applyExternalSelection`（`list-table.ts:441-467`）。
6. **填充柄**。需在选区右下角绘制填充柄（方点）+ 命中检测 + `MOUSEDOWN_FILL_HANDLE`/`DRAG_FILL_HANDLE_END` 两个事件（带拖拽矩形范围）。生成算法不需要——`sheet-core/core/fill.ts` 的 `generateFill` 已有，内核只出交互原语。
7. **几何/滚动查询 API 面**。内部函数大多已有，缺公开封装：`getCellRelativeRect(col,row)`（≈`resolveCellX/resolveCellY` 组装）、`getCellAtRelativePosition(x,y)`（≈`findColAt/findRowAt`）、`scrollToCell({col,row})`（键盘 `revealAxis` 已有等价逻辑，`keyboard-navigation.ts`）、`setScrollLeft/setScrollTop/getScrollLeft/getScrollTop`（现有 `scrollTo/scrollBy` 双轴版）、`getDrawRange()`（画布内容区）、`getBodyVisibleCellRange()`（≈已有 `getVisibleRange`，补冻结区/表头偏移语义）、`isSeriesNumber(col,row)` 与表头层数查询（固定 1 层，暴露常量/查询即可）。
8. **运行时可变冻结与合并**。`applyFrozen()` 每次切 sheet 都要改冻结数（`sheet-grid.ts:343-353` 以可写属性改）；合并随命令撤销/重做变化。现状 `frozenColCount/frozenRowCount/mergeCells` 全是构造期 options（`types.ts:101-110`），需要 setter 或允许经 batchUpdate 后重建窗口（合并区"不允许跨冻结边界"的校验要跟着走）。
9. **RESIZE_ROW_END / RESIZE_COLUMN_END 事件**。resize 会话已有，缺结束回调（带终值与行列号），适配层靠它回写 `sheet.setRowHeight/setColWidth`。
10. **编辑键位开关：Enter 直接进入编辑**（`editCellOnEnter`）。现状 Enter 是提交后下移（`edit-manager.ts:28`），需要"非编辑态按 Enter 进入编辑、提交后按开关决定是否下移"的模式开关；Tab 移动已 ✓。

### P1 —— 体验对齐（接得上但观感/细节不达标）

11. **主题 token 补齐 + 选区/hover 去硬编码**：`underlayBackgroundColor`（表格底衬）、`frameStyle`（外框边线/阴影，ultra-ui 关了阴影）、`selectionStyle`（ultra-ui 选区 `#2170E7` 边框 + 12% 填充；infinite-table 硬编码 `#2e6adb` 常量，`interaction-overlay.ts:10-15`）、header/corner/rowHeader 分区样式（字号 12/常规字重/居中）。
12. **`cellBorderClipDirection: 'bottom-right'` 语义**：右/下边框 1px 收进本格。infinite-table 逐边边框绘制已解决大部分，但需确认邻格覆盖方向与 ultra-ui 一致（这是他们踩过的"外边框不生效"坑）。
13. **表头高亮**：选整行/整列时行号列/列头高亮（自家分析已注明"低于 Excel 表现但自洽"，`interaction-overlay` clip 到 bodyViewport）。Excel 惯例需要。
14. **两个现存渲染缺陷（接前必修，自家 `.agents/analysis/layer-architecture.md` 已定性）**：`mount()` 按创建顺序 appendChild 导致惰性创建的 media 层压在 sky 之上；`ImageCellNode.paint` 无 bodyViewport 裁剪，边缘半格图片画进表头区。
15. **行号列/表头样式可定制**：`rowSeriesNumber{width, style}` 的逐区样式（infinite-table 有 rowHeaderWidth 几何，样式走 header token，需确认够用）。
16. **编辑器契约**：infinite-table 的 `TextEditor`/`EditorRegistry` 接口与 vtable-editors 的 `InputEditor/EditContext` 不同构，适配层要写一个桥（可编三级判定已有）。`resolveEditText`（进编辑显示公式原文）在 infinite-table 侧对应"编辑初值取 resolveValue 基础值"，需确认能拿到 `=formula` 原文（这要求把 Sheet 的 displayValue/f 原文传进来——走 `resolveDisplayValue` hook 应该可覆盖，适配层职责）。

### P2 —— 工程化

17. **可消费的包形态**：infinite-table 各包 `exports` 直指 `./src/index.ts`（未构建），ultra-ui 以 `dist` + `veltra-dev` 双条件导出消费。需要 vite-plus 构建产物 + d.ts 或对齐 veltra-dev 约定（vite-lib-config 已在仓库根，推进即可）。
18. **happy-dom 测试兼容**：ultra-ui 用 happy-dom 跑 Vue 组件测试（canvas 环境下 VTable 有"element 未挂载安全 no-op"的教训，`grid-editor-router.ts:61`）；infinite-table 冒烟走真实浏览器（`?smoke=1`）。适配层测试策略要对齐。
19. **性能对照基线**：bench（TTFF/滚动 FPS/失效面积）已有，建议加"ultra-ui sheet 场景口径"（切 sheet、逐格写、粘贴大块）作替换前后对照。
20. **死链清理**（顺带）：`ARCHITECTURE.md` 与 `invalidation-queue.ts` 注释仍引用已删除的 `docs/perf-redesign`（自家分析建议 5）。

### 架构优势项（替换时 infinite-table 反而更好的地方）

- **模型直挂，免 records 全量重放**：infinite-table 的 `model: TableModel` 订阅形态可让适配层把 ultra-ui 的 `Sheet` 直接挂为模型（按格 O(1) 读），不需要 VTable 那套 `buildRecords()` 展开稀疏 Map → 全量 records 数组，也不需要"批量 >64 格就 setRecords 全量刷"的绕法（`grid-sync-manager.ts:8` BATCH_FULL_REBUILD_THRESHOLD）。
- **ultra-ui 代码里四处 VTable 性能/泄露坑及其绕法全部消失**：逐列 setColWidth 重建 scenegraph（438 行×130 列实测 ~3s）、rowHeightConfig 数组触发 isAutoRowHeight 主线程卡死、customLayout 关 fast-update、编辑器全局注册表闭包拖死 GC（#1 泄露）。这些坑的绕行注释占了 grid 层相当比例的复杂度。
- **`canResizeCol/canResizeRow` 是公开能力**（vs `_canResizeRow` 猴补丁）；**`onScrollFrame` 帧级同步**（vs SCROLL 事件后知后觉）；**失效模型 cell/row-band/full 三档**对"逐格写"场景天然是增量。

## 五、建议路线

1. **P0-1~4（文本样式渲染管线）先行**——它是体量最大、最靠底层的一项，且完全在本仓内闭环；以 `grid-style-resolver.ts` 的字段映射为验收清单，逐字段在 `cell-style/cell-node/cell-renderer/theme` 落地并补单测。
2. **P0-5~10（API 面与交互）随后**——多数是内部能力公开化 + 小交互（填充柄、Enter 编辑、resize end 事件）。
3. **P1-14 两个渲染缺陷与 P0 并行修掉**（改动小、是接上的前置）。
4. 适配层放 ultra-ui 侧重写 `grid/`（改 import 面），还是本仓出 `@infinite-table/sheet-adapter` 包——建议后者：适配逻辑依赖本仓内部语义（模型/编辑器/浮动层），放本仓可随内核演进同步测试；ultra-ui 侧只改 `@veltra/sheet-core/grid` 的实现指向。
5. 全程以 `apps/bench` + demo 冒烟守住回归，P2-19 补 sheet 场景口径。

## 附：体量对照

| | 行数 | 说明 |
| --- | --- | --- |
| infinite-table core | 4,411 行（28 文件） | 表格主体全量 |
| infinite-table render | 1,078 行（13 文件） | 自研渲染引擎 |
| VTable（被替换物） | 巨石级（含 vrender 全家） | ultra-ui 实际用到的面即本文清单 |
| ultra-ui sheet-core/grid | 2,919 行（10 文件） | 适配层，其中大量是绕 VTable 坑的代码，重写后预计显著缩短 |
| ultra-ui sheet-core/core | ~22k 行（含测试） | 不替换 |
| ultra-ui sheet (Vue) | ~8.9k 行（58 文件） | 基本不替换 |
