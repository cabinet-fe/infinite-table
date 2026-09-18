# 插件化接口面清单（ultra-ui SheetGrid → infinite-table）

> 定位：本清单是「以插件化形态把 infinite-table 做到可替换 ultra-ui 底层引擎」的**验收红线文档**。
> S3（sheet 插件）、S4（demo sheet）、S5（工程化收口）以此为准逐条对照；S6（替换路线图）以它为输入。
> 映射来源：`.agents/analysis/ultra-ui-sheet-gap.md` 第二节（ultra-ui `sheet-core/src/grid/` 逐文件提取的 VTable 依赖面）。

## 红线：零引擎内部 API

**sheet 能力（packages/plugins 的 sheet 插件与 apps/demo 的 sheet 区）只允许依赖 `@infinite-table/core` 与 `@infinite-table/plugins` 两个公共入口（`src/index.ts`）显式导出的 API；禁止 import 引擎任何内部模块、`@internal` 成员与未导出符号。**

- review 把关：S3/S4 每阶段对照本清单与两包 `src/index.ts` 导出面核查 import 语句。
- 引擎若确需新增公开面，必须在对应阶段的 spec「影响文件」中显式列出 `packages/core/src/index.ts` 并说明新增符号（S1 的 `onEditStart/onEditEnd` 即按此先例）。

## 一、构造 options 回调面（`buildOptions()`）

| ultra-ui（VTable option） | infinite-table 对应 | 状态 |
| --- | --- | --- |
| `records` + `columns[]`（field/title/width/style 回调/editor 回调/customLayout 回调） | `ListTableOptions.records/columns`（`ColumnDefine.style` 列级样式、`editor`、`editorMultiline`） | 已有 |
| `customLayout` 按格自定义渲染分发 | `resolveCellRenderer` 按格 hook | 已有 |
| `widthMode: 'standard'` / `defaultRowHeight` | `rowHeight` options / 主题 `rowHeight` token | 已有 |
| `enableLineBreak`（`\n` 强制换行） | 文本管线识别 `\n` 换行 | 已有 |
| `maxCharactersNumber: 50000` | 编辑器层职责（长度截断） | 明确不做（编辑器层职责，需要时立项） |
| `customComputeRowHeight({row})` 稀疏行高 | `get/setRowHeight` 逐行覆盖 + 插件侧 SheetStore 持久化行列尺寸 | 已有（S3 SheetStore 已落地） |
| `resize: {columnResizeMode, rowResizeMode}` | `canResizeCol/canResizeRow` 公开 options（替代 VTable `_canResizeRow` 猴补丁） | 已有 |
| `theme: themes.DEFAULT.extends(...)` | `extendsTheme` 派生 + 分区 token（见「四、主题面」） | 已有 |
| `showHeader` | 无开关（sheet 场景恒显示行列头）；行号列宽 `rowHeaderWidth` | 明确不做（如替换时需要再立项） |
| `rowSeriesNumber{width, style}` | `rowHeaderWidth` 几何 + 主题 `rowHeader` 分区 token（S1） | 已有 |
| `excelOptions: {fillHandle}` | 内置填充柄交互原语 + `onFillHandleDown/onFillDragEnd`（生成算法在插件层） | 已有（S3 generateFill 已落地） |
| `editor` + `editCellTrigger: 'doubleclick'` | `EditorRegistry` 注册表 + 双击触发 + `editCellOnEnter` 开关 | 已有 |
| `frozenRowCount/frozenColCount`（含表头计数） | 构造 options + `setFrozenRowCount/setFrozenColCount` 运行时；注意 ultra-ui 计数含表头，适配时 ±1 | 已有 |
| `keyboardOptions`（Tab/Enter/Ctrl+A/ctrlMultiSelect） | `editCellOnEnter`、`ctrlMultiSelect`、键盘导航；Excel 键位组合预设 | 已有（S3 excelKeymapPreset 已落地） |
| `customMergeCell(col,row,table)` | 构造 `mergeCells` + `setMergeCells/addMergeCell/removeMergeCell` 运行时替换 | 已有 |
| `hover:{disableHover:true}` | 主题 `interaction.hoverCell/hoverBand` 置全透明即可等价关闭 | 已有（token 化） |
| `eventOptions:{preventDefaultContextMenu:true}` | 引擎无默认菜单，`onContextMenu` 纯事件 | 已有 |

## 二、实例方法/属性面

| ultra-ui SheetGrid 调用 | infinite-table 公开 API | 状态 |
| --- | --- | --- |
| `setRecords`（全量重建） | 多 sheet 切换全量重挂由插件负责；值写入走模型直挂免全量重放（`model: TableModel` 形态） | 已有（S3 SheetBook 实例池已落地） |
| `changeCellValue(col,row,value)` | `updateCell(col,row,value)` 回驱模型 + `batchUpdate` 收敛；SheetStore 写路径 | 已有（S3 SheetStore 已落地） |
| `updateCellContent(col,row)` | `refreshCell(col,row)` 局部 cell 级刷新 | 已有 |
| `selectCells(ranges[])` | `selectCells`（多段选区） | 已有 |
| `getSelectedCellRanges()` | `getSelectedCellRanges` | 已有 |
| 外部选区回写 | `applyExternalSelection`（防回环）+ `onSelectionChange` | 已有（S3 bindSelectionSync 已落地） |
| `scrollToCell({col,row})` | `scrollToCell` | 已有 |
| `getCellAtRelativePosition(x,y)` | `getCellAtRelativePosition` | 已有 |
| `getCellRelativeRect(col,row)` | `getCellRelativeRect` | 已有 |
| `getDrawRange()` | `getDrawRange` | 已有 |
| `getBodyVisibleCellRange()` | `getBodyVisibleCellRange` | 已有 |
| `isSeriesNumber(col,row)` | `isSeriesNumber` | 已有 |
| `columnHeaderLevelCount` | `getHeaderLevelCount()`（恒 1 层） | 已有 |
| `rowCount/colCount` | 引擎未公开维度访问器；SheetStore 提供行列维数 | 已有（S3 SheetStore getRowCount/getColCount） |
| `frozenRowCount/frozenColCount`（可写属性） | `getFrozenRowCount/getFrozenColCount` + `setFrozenRowCount/setFrozenColCount` | 已有 |
| `get/setColWidth` | `getColWidth/setColWidth` | 已有 |
| `get/setRowHeight` | `getRowHeight/setRowHeight` | 已有 |
| `get/setScrollLeft/get/setScrollTop` | `get/setScrollLeft`、`get/setScrollTop` | 已有 |
| `on/off` | 实例级 `on*` 订阅方法（返回退订函数，等价 off） | 已有 |
| `release()` | `destroy()` | 已有 |
| `table._canResizeRow` 私有猴补丁 | `canResizeCol/canResizeRow` 公开能力 | 已有（架构优势项） |
| 撤销/重做（Sheet 命令栈的视图侧配合） | `onCellChange` oldValue/newValue + 结构命令记录 | 已有（S3 UndoStack/bindCellChangeUndo 已落地） |

## 三、事件面（`ListTable.EVENT_TYPE`）

| ultra-ui 事件 | infinite-table 对应 | 状态 |
| --- | --- | --- |
| `CHANGE_CELL_VALUE` | `onCellChange`（col/row/oldValue/newValue） | 已有 |
| 编辑会话开始/结束（公式栏镜像，`EditContext` onStart/onEnd 语义） | `onEditStart` / `onEditEnd`（S1：col/row/初值/终值/是否提交） | 已有 |
| `RESIZE_ROW_END` / `RESIZE_COLUMN_END` | `onRowResizeEnd` / `onColResizeEnd` | 已有 |
| `CONTEXTMENU_CELL` | `onContextMenu` | 已有 |
| `SELECTED_CELL` / `DRAG_SELECT_END` | `onSelectionChange`（变更级粒度，比拖选结束更细；适配层可自行节流） | 已有 |
| `MOUSEDOWN_FILL_HANDLE` / `DRAG_FILL_HANDLE_END` | `onFillHandleDown` / `onFillDragEnd` | 已有 |
| `SCROLL` | `onScrollFrame`（帧级同步，强于事件后知后觉） | 已有 |

## 四、主题面（`vtable-theme.ts` extends）

| ultra-ui 主题项 | infinite-table 对应（S1 落地） | 状态 |
| --- | --- | --- |
| `underlayBackgroundColor` | `TableTheme.underlayBackgroundColor` | 已有 |
| `frameStyle`（外框线宽/色/阴影） | `TableTheme.frameStyle`（lineWidth/color/shadow） | 已有 |
| `selectionStyle`（选区填充/边框/线宽） | `TableTheme.interaction`（selectionFill/selectionBorder/selectionBorderWidth） | 已有 |
| hover 关闭/变色 | `interaction.hoverCell/hoverBand` | 已有 |
| `defaultStyle`（数据格） | `TableTheme.body` 分区 | 已有 |
| `headerStyle` / `cornerHeaderStyle` / `rowHeaderStyle` | `TableTheme.header/corner/rowHeader` 三分区（缺省随 header 派生） | 已有 |
| 填充柄颜色 | `interaction.fillHandle`；resize 线 `interaction.resizeLine/resizeLineWidth`；整行/整列表头高亮 `interaction.headerHighlight` | 已有 |

## 五、编辑器契约

| ultra-ui（vtable-editors） | infinite-table 对应 | 状态 |
| --- | --- | --- |
| `register.editor(name, editor)` 全局注册表 | `EditorRegistry.registerEditor`（实例级，无全局闭包泄露坑） | 已有 |
| `InputEditor/EditContext` onStart（可替换初值：公式格显示 `=原文`） | 编辑初值取基础值口径（`resolveValue`），插件把 `=formula` 原文作为基础值喂入即等价；进编辑会话 `onEditStart` 携带初值 | 已有（S3 createFormulaDisplay 已落地） |
| onEnd（通知公式栏退出镜像） | `onEditEnd`（committed 区分提交/取消） | 已有 |
| 编辑器单例 + WeakMap 路由（绕 VTable 注册表泄露坑 #1） | 不适用：引擎注册表按名注册、随表实例生命周期 | 已有（架构优势项） |
| `resolveEditText` 语义 | 同 onStart 行；displayValue/f 原文经 `resolveDisplayValue` hook 或 SheetStore 提供 | 已有（S3 createFormulaDisplay） |

## 六、与后续阶段的衔接

- **S3 sheet 插件**（`packages/plugins/src/sheet`）：已全部落地——SheetStore（值/样式/合并/行列尺寸/冻结 + asModel 模型适配）、generateFill 填充生成与 bindFillGeneration 接线、bindSelectionSync 选区双向同步、createFormulaDisplay 公式显示、excelKeymapPreset 键位预设、SheetBook 多 sheet 实例池、UndoStack/bindCellChangeUndo 最小撤销栈。全部只依赖 core 公开入口（测试基础设施除外，见包内说明）。
- **S4 demo sheet**：在插件 API 之上复现 ultra-ui playground sheet 功能，产出功能对照表；UI 归下游，不碰引擎内部。
- **S5 工程化收口**：已落地——包 `exports` 三条件（types/dev/import→dist，仓内 apps 走 dev 条件）、`scripts/check-package-exports.mjs` 消费冒烟、bench sheet 四场景口径与阈值、happy-dom 挂载安全单测。消费面以本清单允许面为准。
- **S6 替换路线图**：`docs/replace-vtable-roadmap.md` 直接引用本清单作为 VTable 接口面 → infinite-table 接口面的映射基准，并补测试改写与灰度顺序。

**红线重申**：S3/S4 每阶段 review 核对 import 面——sheet 能力零引擎内部 API；违反即评审不通过。
