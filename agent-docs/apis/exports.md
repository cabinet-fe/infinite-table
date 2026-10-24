---
title: 导出面判据与清单
description: infinitable 对外导出面的判定判据、逐项清单（导出/不导出与理由）、core 拆分更名迁移登记（无兼容层，破坏性变更明示）、移出项与过渡方案、0.1.x 已发布使用者兼容结论。主入口（render/grid/table/formulas/plugins 五层显式转售 + CellRef 消歧）、./sheet 子路径（@infinitable/sheet 白名单）与 ./pivot 子路径（@infinitable/pivot 白名单）的符号集合由 packages/infinitable/tests/public-surface.test.ts 快照冻结。
aliases: [exports, 导出面, 公共 API, public surface, API 面, 导出清单]
keywords: [导出面, public API, export, 快照冻结, public-surface, 显式导出, 星号导出, 0.1.x, 兼容性, CellRef, GridCellRef, ScrollbarOptions, ScrollbarMode, 移出, deprecation, core 拆分, grid, table, EngineAssembly, EngineReadView, TableEngine, createEnginePrintSource, 引擎装配协议]
---

# 导出面判据与清单

infinitable 对外只有三个发布入口：主入口 `infinitable`（npm 单包，re-export render / grid / table / formulas / plugins 五层公共 API）、子路径 `infinitable/sheet`（`@infinitable/sheet` 白名单全量转售）与子路径 `infinitable/pivot`（`@infinitable/pivot` 白名单全量转售——透视表领域引擎，下游不依赖仓内私有包 `@infinitable/pivot`）。三个入口的导出符号集合由 `packages/infinitable/tests/public-surface.test.ts` 以显式快照冻结——增删导出必须显式改快照才能通过，防止内部实现经星号转售泄漏成事实公共 API。源码同时断言各入口不含星号导出语句（仓内 grep `export *` 于 `packages/infinitable/src/` 应零命中）。

## 判据

三层入口（主入口 / `./sheet` 子路径 / 各子包 `src/index.ts`）同一判据，逐项判定：

**导出**——稳定公共 API：

- 类型：构造/选项/事件载荷/插件契约等对外形态（`ListTableOptions`、`SheetGridOptions`、`TablePlugin`、命令参数类型族…）。
- 配置对象与常量：主题、样式键集、边框预设等可定制面（`extendsTheme`、`BORDER_SIDES`…）。
- 注册函数：宿主注入扩展点的写入面（`registerFormulaFunction`、`EditorRegistry`、`defaultCommandRegistry`…）。
- 插件接口与工厂：`TablePlugin` 契约、`createChartPlugin` / `createWatermarkPlugin` / `createPrintPlugin` 工厂及其 handle/配置类型。

**不导出**——下列性质的符号不进发布面（包间接线统一走子包公共入口，深路径消费已移除）：

- 内部实现细节：滚动状态源（`ScrollManager`）、模型绑定（`ModelBinding`）、取值管线（`CellValuePipeline`）、分词/AST 原语（`tokenizeFormula`、`evaluateAst`）、`coerceTo*` 强转族、chart-loader/渲染实现等。
- 实验性 API：未定稿能力，不进发布面。
- 跨层内部工具：为其它包内部接线服务的原语（grid 布局/滚动/滚动条装配纯函数族、`MediaCache`、`CellNode` 等；包间接线统一走子包公共入口——table 经 `@infinitable/grid/src/<module>` 的深路径消费与 grid 的 `./src/*` exports 条目已移除，仓内 `@infinitable/grid/src` 零引用）。

支撑口径（满足其一即可保留在公共面）：仓内非测试消费（playground / 跨包公共入口）、红线文档面（`docs/plugin-interface-map.md` 红线 + `agent-docs/index.md` 速查表逐项覆盖）。同名消歧：grid 的格坐标 `CellRef` 与 formulas 的 A1 引用 `CellRef` 同名——A1 引用保留原名（配 `parseCellRef`/`formatCellRef`/`createRangeRef`），格坐标以 `GridCellRef` 别名从主入口导出。同源去重：`RenderContext`/`Size`（render 定义、table 亦转出）与 `TablePlugin`（table 定义、plugins 亦转出）在主入口各从定义包导出一次。

## 主入口逐项清单（src/index.ts，40 值 + 96 类型）

按包分组；组内符号的保留理由是组级判据，个别符号另有特别说明。全部符号可在 `agent-docs/index.md` 速查表逐项 grep 到文档路径。

| 分组 | 符号 | 理由 |
| --- | --- | --- |
| render 值 | `createRenderHost`、`SceneNode` | 渲染宿主装配唯一入口与场景树节点（宿主注入 host 必用） |
| render 类型 | `RenderHostOptions`、`SceneEventListener`、`SceneNodeInit`、`SceneEvent`、`SceneEventType`、`FrameTask`、`Invalidation`、`LayerHandle`、`LayerKind`、`LayerOpts`、`Region`、`RenderCanvas`、`RenderContext`、`RenderHost`、`RenderImageSource`、`Size` | 渲染窄接口的对外形态：宿主选项、federated 事件、层句柄与三档失效、绘制上下文与基础几何（自定义 CellRenderer / underlay/overlay painter 消费） |
| grid 值 | `extendsTheme`、`normalizeCellRange`、`normalizeRange`、`MergeCellMap`、`MergeOverlapError`、`sanitizeMerges`、`warnMergeConflicts` | 共享网格内核的合并区集合与重叠消解、选区段归一化、主题派生公共工具（`MergeCellMap`/`MergeOverlapError`/`sanitizeMerges`/`warnMergeConflicts` 为合并区集合与重叠消解，0.2.0 起新增） |
| grid 类型 | `CellRange`、`CellRef`→`GridCellRef`、`CellStyle`、`CellBorder`、`CellBorderEdge`、`TableTheme`、`ThemeOverride`、`RangeBounds`、`SelectionSnapshot`、`SanitizedMerges`、`MergeConflict`、`LoadedImage`、`FloatObject`、`FloatTransformEndEvent`、`FloatTransformHandle`、`FloatContextMenuEvent`、`ScrollbarOptions`、`ScrollbarMode` | 网格内核的格/样式/主题/选区/媒体/浮动层词汇：选区状态（G18 下游剪贴板路径）与视口/文本读取所依赖的选区快照形态在此层；`GridCellRef` 为消歧别名；`ScrollbarOptions`/`ScrollbarMode` 为内建滚动条配置（`scrollbar` 选项对象形态，`mode: 'native'` 原生滚动条档，0.1.4 起新增） |
| table 值 | `ListTable`、`SheetModel`、`EditorRegistry`、`projectCellStyle` | 表格主类、内置模型、编辑器注册表、样式投影纯函数（G7/G9 样式解析链公共面可达） |
| table 类型 | `ListTableOptions`、`CanvasDocSource`、`ColumnDefine`、`DataRecord`、`TableModel`、`ResolveDisplayValue`、`CellChangeEvent`、`TableContextMenuEvent`、`CellRenderer`、`TablePlugin`、`UnderlayPainter`、`OverlayPainter`、`HighlightRange`、`FillDragEndEvent`、`CellChartMedia`、`CellLink`、`CellLinkClickEvent`、`CellLinkHoverEvent`、`CellLinkLeaveEvent`、`ResolveCellLink`、`ResolveCellImageLink`、`ImageLinkClickEvent`、`ImageLinkClickListener` | 构造/列/模型/事件/选区/媒体/浮动层/插件契约的公共形态；`CanvasDocSource` 为文档源注入形态（`ListTableOptions.doc`：无 DOM 环境经它创建 canvas，构造与出图不依赖全局 document）；`CellLink`/`ResolveCellLink` 与三个链接事件为单元格超链接载荷与事件，`ResolveCellImageLink`/`ImageLinkClick*` 为嵌入图链接 hook 与点击事件 |
| table 协议 | `EngineAssembly`、`EngineReadView`、`TableEngine` | 引擎装配协议（0.4.0 起新增，P7 落地）：中立本体（渲染宿主 + 数据面 + 主题 + painter/插件槽位 + 生命周期，四类平级引擎的公共装配路径）与可选导出读取面（G12-G15 导出类插件读取引擎有效数据/样式/几何/合并区）；`TableEngine` 为表格领域公共操作增量，SheetGrid 等适配层按协议面消费 table 引擎 |
| formulas 值 | `colLetters`、`parseCellRef`、`formatCellRef`、`formatRangeRef`、`createRangeRef`、`formulaError`、`isFormulaError`、`isFormulaErrorCode`、`FormulaParseError`、`tokenText`、`parseFormula`、`astHasVolatileCall`、`collectAstReferences`、`DependencyGraph`、`scanFormulaReferences`、`shiftFormulaText`、`shiftFormulaRefs`、`evaluate`、`FORMULA_FUNCTION_CATEGORIES`、`getFormulaFunction`、`getFormulaFunctionInfo`、`listFormulaFunctions`、`registerFormulaFunction` | A1 地址系统、错误值体系、Pratt 解析、AST 静态分析、依赖图、容错引用扫描、引用平移（`tokenText` 随引用级文本改出公共化）、求值器、函数注册表读写（宿主自定义函数注册面） |
| formulas 类型 | `CellRef`（原名）、`RangeRef`（A1 区间引用）、`FormulaError`、`AstNode`、`FormulaRefCoord`、`SheetCellCoord`、`FormulaShiftResult`、`FormulaEvalContext`、`FormulaResolver`、`ScalarValue`、`ScannedReference`（容错引用扫描结果）、`FormulaFunction`、`FormulaFunctionCategory`、`FormulaFunctionInfo` | 地址/区间/错误/AST/依赖/平移/求值上下文（自定义函数求值需要）/扫描/注册表元数据形态 |
| plugins 值 | `createChartPlugin`、`createWatermarkPlugin`、`createPrintPlugin`、`createEnginePrintSource` | 官方插件三工厂（插件对象形态：同时是 TablePlugin 与运行时 handle）；`createEnginePrintSource` 为引擎供数适配（0.4.0 起新增，P7 落地）：把装配协议的导出读取面（`engine.read`）适配为 `PrintSource`，宿主打印引擎实例不再自写适配器 |
| plugins 类型 | `ChartPluginOptions`、`ChartPluginHandle`、`ChartCellDeclaration`、`ChartDatasetDeclaration`、`ChartDatasetSpec`、`ChartSpec`、`ChartSpecType`、`ChartType`、`WatermarkHandle`、`WatermarkTextConfig`、`PrintPluginOptions`、`PrintPluginHandle`、`PrintConfig`、`PrintSource`、`PrintPaperPreset`、`PrintPaperSpec`、`PrintOrientation`、`PrintMargin`、`PrintScaleMode`、`PrintPagingMode`、`PrintHeaderFooterConfig`、`PrintHeaderFooterSection` | 三插件的配置与声明/预设形态（`WatermarkTextConfig` 与打印水印共享同一模型，经插件入口一并转出；`PrintSource` 纯表格供数） |

## ./sheet 子路径逐项清单（src/sheet.ts，79 值 + 94 类型）

与 `packages/sheet/src/index.ts` 白名单同步维护（同判据、同集合）。公式引擎 API 不在此转售（下游直接 `import '@infinitable/formulas'`）。分组与理由：

| 分组 | 符号 |
| --- | --- |
| 地址系统 | `cellKey`、`colIndexToName`、`colNameToIndex`、`parseAddress`、`formatAddress`、`createRange`、`parseRange`、`formatRange`、`rangesEqual`、`rangesIntersect`、`rangeContainsAddress`、`boundingBox`、`iterateRange`；类型 `CellAddress`、`CellRange` |
| 单元格存储 | `NUMERIC_TEXT_RE`（输入归一化判值口径，伴生公共）、`normalizeInputValue`、`inferCellType`、`isEmptyCellData`、`cellDataEqual`、`CellStore`；类型 `CellType`、`CellValue`、`CellData`、`CellSnapshotItem` |
| 单元格元数据 | `cellMetaKey`、`cellMetaKeyFrom`、`cloneCellMetaPayload`、`cellMetaPayloadEqual`、`CellMetaStore`、`CELL_READONLY_META_NAMESPACE`、`CELL_IMAGE_META_NAMESPACE`、`CELL_LINK_META_NAMESPACE`；类型 `CellMetaSnapshotItem`、`CellImagePayload`、`CellLinkPayload` |
| 样式 | `BORDER_SIDES`、`BORDER_STYLE_WIDTH`、`BORDER_EDGE_DEFAULTS`、`FONT_STYLE_KEYS`、`ALIGN_STYLE_KEYS`、`StylePool`、`composeCellStyles`、`buildBorderPresetItems`；类型 `BorderLineStyle`、`BorderSide`、`BorderEdge`、`HorizontalAlign`、`VerticalAlign`、`CellFont`、`CellAlign`、`CellStyle`、`StyleId`、`CellStylePatch`、`NumFmt`、`BorderPreset`、`BorderPresetItem` |
| 合并/选区/填充/查找 | `MergeManager`、`SelectionModel`、`computeFillTargetRange`、`generateFill`、`findAll`、`findNext`、`findNextFrom`、`findPrev`、`findPrevFrom`；类型 `MergedCellKind`、`CellInfo`、`MergeResult`、`SelectionState`、`FillDirection`、`GenerateFillOptions`、`FindOptions`、`FindMatch` |
| 模型与簿 | `Sheet`、`Workbook`、`FormulaEngine`（组合 @infinitable/formulas 的图簿联动门面）、`TypedEventEmitter`（Sheet/Workbook 事件基类，宿主自定义事件源同基类）；类型 `FrozenState`、`SheetSnapshot`、`SheetEvents`、`WorkbookEvents`、`AddSheetOptions`、`AddSheetCellInput` |
| 命令与撤销 | `HistoryManager`、`CommandRegistry`、`defaultCommandRegistry` 与 17 个 `XxxCommand` 类；类型 `HistoryState`、`PatchDirection`、`CellPatch`、`MergePatch`、`StructureChange`、`StructurePatch`、`SnapshotPatch`、`ImagePatch`、`CellMetaPatch`、`AxisStylePatch`、`Patch`、`Mutation`、`CommandResult`、`CommandContext`、`Command`、`SetCellValueItem` 与各命令 `*Params` 族 |
| 图片 | `createImageId`、`cloneImageAnchor`、`cloneSheetImage`、`IMAGE_MIME`；类型 `SheetImageType`、`SheetImageAnchor`、`SheetImage`、`ImageInput`、`ImageFitMode` |
| IO | `exportWorkbookXlsx`、`exportSheetXlsx`、`exportSheetCsv`、`importXlsx`、`importCsv`、`replaceWorkbookWithSnapshots`；类型 `SheetReplaceItem` |
| SheetGrid 适配 | `SheetGrid`；类型 `ResolveCellRenderer`、`SheetGridHighlight`（公式引用拾取染色框条目）、`SheetGridOptions`、`SelectionInterceptMeta`（选区拦截手势载荷，配 `SheetGridOptions.interceptSelection`/`onSelectionIntercept`）、`ScrollbarOptions`（grid 同形再导出，`mode: 'native'` 原生滚动条档，0.1.4 起新增）、`ResolveCellStyleHook`、`ResolveDisplayValue`、`SheetGridContextMenuInfo`、`SheetGridContextMenuKind`、`SheetGridHeaderOptions`、`GridCellEditor`、`GridEditorRect`、`GridEditorSession`、`SheetGridEditorsOptions`、`CellRenderer`、`CellRenderTarget` |

## ./pivot 子路径逐项清单（src/pivot.ts，6 值 + 8 类型）

与 `packages/pivot/src/index.ts` 白名单同步维护（同判据、同集合）。`@infinitable/pivot` 为透视表领域引擎（平级引擎经引擎装配协议接入 table 引擎的参考实现），本子路径即其唯一对外发布面（包本体 private 不发布）。分组与理由：

| 分组 | 符号 |
| --- | --- |
| 引擎与模型 | `PivotGrid`（领域引擎：内部构造 ListTable 后以 TableEngine 协议面持有，对外实现 EngineAssembly 转发面）、`PivotModel`（行/列维度树 × 度量交叉聚合模型，实现 TableModel 数据面）；类型 `PivotGridOptions`（装配选项：维度池/度量池/记录/初始勾选序列）、`PivotColumn`、`PivotRow`（模型展平结构） |
| 领域词汇 | 类型 `PivotDimension`（分组字段）、`PivotMeasure`（聚合字段：key/title/field/agg/width）、`PivotAggregator`（聚合器枚举）、`PivotRecord`（记录，与 DataRecord 同形）、`PivotCellDrillEvent`（双击下钻事件载荷） |
| 冒烟锚点常量 | `PIVOT_ROW_HEIGHT`、`PIVOT_HEADER_BACKGROUND`、`PIVOT_SUBTOTAL_BACKGROUND`、`PIVOT_GRAND_BACKGROUND`（行高与表头/折叠载体/总计行底色，playground 冒烟像素断言锚点） |

## 各子包 src/index.ts 复核结论

`packages/{render,grid,table,formulas,plugins,sheet}` 六包公共入口按同一判据复核：原 core 公共面在 P4 拆分时逐项重判后按定义层落入 grid（合并/选区/主题/样式词汇/浮动对象/滚动条配置）与 table（表格主体/编辑/媒体/插件契约），集合不变零移出；P7 新增 table 协议类型（`EngineAssembly`/`EngineReadView`/`TableEngine`）与 plugins 引擎供数适配（`createEnginePrintSource`/`EnginePrintSourceOptions`，后者留在子包面、主入口经 `createEnginePrintSource` 函数签名可达）。子包公共面同时是主入口显式清单的来源与插件红线边界（`docs/plugin-interface-map.md`：插件包只允许依赖 table/grid 公共入口显式导出的 API）。

## core 拆分更名迁移登记（0.4.0 起，无兼容层）

`@infinitable/core` 已删除并拆为 `@infinitable/grid`（共享网格内核：合并区/选区/主题投影/格坐标/样式词汇/浮动对象/滚动条配置）与 `@infinitable/table`（ListTable 引擎：主类/模型/编辑/媒体/插件契约/装配协议）。按 spec 非目标约定：不提供兼容层、deprecation 垫片或迁移工具（用户明示忽略兼容性），破坏性变更明示如下：

- **对 `infinitable` 主入口消费者：零迁移成本。** 原 core 组符号在主入口全部保留（来源换为定义包，import 语句不变），仅新增 4 个协议符号（`EngineAssembly`/`EngineReadView`/`TableEngine`/`createEnginePrintSource`）。快照由 39 值 + 92 类型扩为 40 值 + 95 类型。
- **对 `@infinitable/core` 直接消费者（仅仓内 workspace，该包从未发布到 npm）：全部 import 失效。** 仓内消费方（playground/website/各包测试）已随拆分全量迁移至 `@infinitable/grid` / `@infinitable/table`（符号级对照：合并/选区/主题/滚动条词汇 → grid，ListTable/模型/编辑/媒体/插件契约 → table）。
- **grid 深路径消费口径（已移除）：** 0.4.0 拆分时 table 曾对 grid 内部原语（布局/滚动/滚动条装配等）经 `@infinitable/grid/src/<module>` 深路径接线，grid 的 `./src/*` exports 条目（types/dev/import 三条件，import 指源码）是该接线的契约；后续已移除该口径——grid exports 仅剩 `.`，仓内 `@infinitable/grid/src` 深路径零引用，包间消费统一走公共入口。

## 移出项与过渡方案

**本轮（core 拆分同步）移出项：无。** 主入口符号集合对拆分前逐符号保留（见上节迁移登记），无 import 受影响。

后续清理轮移出登记（0.2.x 死代码清理）：

- 主入口删类型 `PrintImagePayload`：print 浮动图「收数口存在、渲染口从未实现」的死链整体删除（`PrintSource.images`/`imageData` 字段与 plugins print 的 `waitForImages` 同删），`PrintSource` 收缩为纯表格供数；过渡方案：打印场景无需迁移——该载荷从未有生效的输出路径。
- `@infinitable/formulas` 子包 8 个内部符号去 export（`evaluateAst`、`EvaluateOptions`、`FormulaOperator`、`AstReference`、`ShiftedRange`、`FlatArg`、`FormulaFunctionParam`、`FormulaFunctionMeta`）：主入口本就未转售（0.1.2 起列入不导出），下游应改经 `parseFormula`/`evaluate`/`collectAstReferences` 与注册表读写面消费；词法原语收敛到包内 `src/lexicon.ts`。
- `@infinitable/sheet` 类方法收缩（非导出面变化，类仍导出）：`MergeManager.merge/unmerge/isMerged/isCovered`、`CellMetaStore.delete/has/entries`、`SelectionModel.clear`、`CellStore.setCellValue/peekEntries`、`Sheet.entriesCellMeta`——等价能力一律走 `Sheet` 门面方法（`mergeCells`/`getCellMeta`/`selectCell`/`setCells` 等）。

历史移出（0.1.2 收敛，已生效于 0.1.3，非本轮；当时相关符号属 core 包，现按定义层分属 grid/table）：core 的 `ScrollManager`/`ModelBinding`/`CellValuePipeline`/`SelectionState`（core 内部）/`InteractionOverlay`/`EditManager`/`createTextEditor`/`ImageService`/`MediaCache`/`FloatObjectLayer`/`CellNode`/网格布局纯函数族、formulas 的 `tokenizeFormula`/`evaluateAst`/`coerceTo*` 族、plugins 的 `SheetStore`/`SheetBook`/`snapshot`/`restore`/`excelKeymapPreset`/`bindFillGeneration`/`UndoStack`/`paginate`/`printPages`/`openPrintPreview`、`defaultTheme`——逐条理由与替代路径见 `agent-docs/index.md` 速查表后的破坏性变更警示。后续如需再移出：必须「保留导出 + deprecation 注释（至少一个次版本）或移入包内深路径 + 版本化说明」，并在本文档登记名称、理由、过渡方案，无静默移除。

## 0.1.x 已发布使用者兼容结论

- **主入口**：0.1.3 事实导出面（星号转售四层）与 0.1.4 显式面逐符号一致（快照即两版本交集的显式化）；core 拆分（0.4.0）后主入口符号继续逐符号保留、仅增不改（见迁移登记）——**既有 import 全部不受影响，零迁移成本**。
- **./sheet 子路径**：纯新增 `ScrollbarOptions`（配合 `SheetGridOptions.scrollbar` 全形态透传）；既有 import 不受影响。
- **新增能力**：`ScrollbarMode` 与 `ScrollbarOptions.mode`（`'canvas'` 缺省 / `'native'` 原生滚动条档）随主入口与 `./sheet` 子路径一并导出；缺省 `'canvas'` 与旧语义完全一致。
- **升级路径**：无需任何代码改动即可升级；启用原生滚动条见 `apis/list-table.md` 滚动条节与 `apis/sheet.md` 注意事项的滚动条透传条目。
- **维护约束**：自 0.1.4 起主入口与 `./sheet` 的导出集合被 `packages/infinitable/tests/public-surface.test.ts` 快照冻结——新增/移除导出须同步改快照、速查表（`agent-docs/index.md`）与本文档清单；dist 类型垫片由 `packages/infinitable/scripts/build-types.mjs` 从 src 同口径生成（公共入口与深路径裸说明符均改写为 dist/types 内相对路径），`bun run build` 后 `node scripts/check-package-exports.mjs` 校验外部消费姿态。
