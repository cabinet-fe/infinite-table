---
title: 导出面判据与清单
description: infinitable 对外导出面的判定判据、逐项清单（导出/不导出与理由）、移出项与过渡方案、0.1.x 已发布使用者兼容结论。主入口（render/core/formulas/plugins 四层显式转售 + CellRef 消歧）与 ./sheet 子路径（@infinitable/sheet 白名单）的符号集合由 packages/infinitable/tests/public-surface.test.ts 快照冻结。
aliases: [exports, 导出面, 公共 API, public surface, API 面, 导出清单]
keywords: [导出面, public API, export, 快照冻结, public-surface, 显式导出, 星号导出, 0.1.x, 兼容性, CellRef, GridCellRef, ScrollbarOptions, ScrollbarMode, 移出, deprecation]
---

# 导出面判据与清单

infinitable 对外只有两个发布入口：主入口 `infinitable`（npm 单包，re-export render / core / formulas / plugins 四层公共 API）与子路径 `infinitable/sheet`（`@infinitable/sheet` 白名单全量转售）。两个入口的导出符号集合由 `packages/infinitable/tests/public-surface.test.ts` 以显式快照冻结——增删导出必须显式改快照才能通过，防止内部实现经星号转售泄漏成事实公共 API。源码同时断言两入口不含星号导出语句（仓内 grep `export *` 于 `packages/infinitable/src/` 应零命中）。

## 判据

三层入口（主入口 / `./sheet` 子路径 / 各子包 `src/index.ts`）同一判据，逐项判定：

**导出**——稳定公共 API：

- 类型：构造/选项/事件载荷/插件契约等对外形态（`ListTableOptions`、`SheetGridOptions`、`TablePlugin`、命令参数类型族…）。
- 配置对象与常量：主题、样式键集、边框预设等可定制面（`extendsTheme`、`BORDER_SIDES`…）。
- 注册函数：宿主注入扩展点的写入面（`registerFormulaFunction`、`EditorRegistry`、`defaultCommandRegistry`…）。
- 插件接口与工厂：`TablePlugin` 契约、`createChartPlugin` / `createWatermarkPlugin` / `createPrintPlugin` 工厂及其 handle/配置类型。

**不导出**——下列性质的符号只能经包内深路径消费（仓内测试/跨包内部接线）：

- 内部实现细节：滚动状态源（`ScrollManager`）、模型绑定（`ModelBinding`）、取值管线（`CellValuePipeline`）、分词/AST 原语（`tokenizeFormula`、`evaluateAst`）、`coerceTo*` 强转族、chart-loader/渲染实现等。
- 实验性 API：未定稿能力，不进发布面。
- 跨层内部工具：为其它包内部接线服务的原语（网格布局纯函数族、`MediaCache`、`CellNode` 等）。

支撑口径（满足其一即可保留在公共面）：仓内非测试消费（playground / 跨包公共入口）、红线文档面（`docs/plugin-interface-map.md` 红线 + `agent-docs/index.md` 速查表逐项覆盖）。同名消歧：core 的格坐标 `CellRef` 与 formulas 的 A1 引用 `CellRef` 同名——A1 引用保留原名（配 `parseCellRef`/`formatCellRef`/`createRangeRef`），格坐标以 `GridCellRef` 别名从主入口导出。同源去重：`RenderContext`/`Size`（render 定义、core 亦转出）与 `TablePlugin`（core 定义、plugins 亦转出）在主入口各从定义包导出一次。

## 主入口逐项清单（src/index.ts，35 值 + 80 类型）

按包分组；组内符号的保留理由是组级判据，个别符号另有特别说明。全部符号可在 `agent-docs/index.md` 速查表逐项 grep 到文档路径。

| 分组 | 符号 | 理由 |
| --- | --- | --- |
| render 值 | `createRenderHost`、`SceneNode` | 渲染宿主装配唯一入口与场景树节点（宿主注入 host 必用） |
| render 类型 | `RenderHostOptions`、`SceneEventListener`、`SceneNodeInit`、`SceneEvent`、`SceneEventType`、`FrameTask`、`Invalidation`、`LayerHandle`、`LayerKind`、`LayerOpts`、`Region`、`RenderCanvas`、`RenderContext`、`RenderHost`、`RenderImageSource`、`Size` | 渲染窄接口的对外形态：宿主选项、federated 事件、层句柄与三档失效、绘制上下文与基础几何（自定义 CellRenderer / underlay/overlay painter 消费） |
| core 值 | `ListTable`、`SheetModel`、`EditorRegistry`、`extendsTheme`、`normalizeCellRange`、`normalizeRange`、`projectCellStyle` | 表格主类、内置模型、编辑器注册表、主题派生与选区/合并/样式归一化公共工具 |
| core 类型 | `ListTableOptions`、`ColumnDefine`、`DataRecord`、`TableModel`、`ResolveDisplayValue`、`CellChangeEvent`、`TableContextMenuEvent`、`CellRef`→`GridCellRef`、`CellRange`、`CellRenderer`、`CellStyle`、`CellBorder`、`CellBorderEdge`、`TableTheme`、`ThemeOverride`、`RangeBounds`、`SelectionSnapshot`、`HighlightRange`、`FillDragEndEvent`、`UnderlayPainter`、`OverlayPainter`、`LoadedImage`、`CellChartMedia`、`FloatObject`、`FloatTransformEndEvent`、`FloatTransformHandle`、`TablePlugin` | 构造/列/模型/事件/选区/媒体/浮动层/插件契约的公共形态；`GridCellRef` 为消歧别名 |
| core 滚动条 | `ScrollbarOptions`、`ScrollbarMode` | 内建滚动条配置（`scrollbar` 选项对象形态）与形态联合（`mode: 'native'` 原生滚动条档，0.1.4 起新增） |
| formulas 值 | `colLetters`、`parseCellRef`、`formatCellRef`、`formatRangeRef`、`createRangeRef`、`formulaError`、`isFormulaError`、`isFormulaErrorCode`、`FormulaParseError`、`tokenText`、`parseFormula`、`astHasVolatileCall`、`collectAstReferences`、`DependencyGraph`、`scanFormulaReferences`、`shiftFormulaText`、`shiftFormulaRefs`、`evaluate`、`FORMULA_FUNCTION_CATEGORIES`、`getFormulaFunction`、`getFormulaFunctionInfo`、`listFormulaFunctions`、`registerFormulaFunction` | A1 地址系统、错误值体系、Pratt 解析、AST 静态分析、依赖图、容错引用扫描、引用平移（`tokenText` 随引用级文本改出公共化）、求值器、函数注册表读写（宿主自定义函数注册面） |
| formulas 类型 | `CellRef`（原名）、`FormulaError`、`AstNode`、`FormulaRefCoord`、`SheetCellCoord`、`FormulaShiftResult`、`FormulaEvalContext`、`FormulaResolver`、`ScalarValue`、`FormulaFunction`、`FormulaFunctionCategory`、`FormulaFunctionInfo` | 地址/错误/AST/依赖/平移/求值上下文（自定义函数求值需要）/注册表元数据形态 |
| plugins 值 | `createChartPlugin`、`createWatermarkPlugin`、`createPrintPlugin` | 官方插件三工厂（插件对象形态：同时是 TablePlugin 与运行时 handle） |
| plugins 类型 | `ChartPluginOptions`、`ChartPluginHandle`、`ChartCellDeclaration`、`ChartDatasetDeclaration`、`ChartDatasetSpec`、`ChartSpec`、`ChartSpecType`、`ChartType`、`WatermarkHandle`、`WatermarkTextConfig`、`PrintPluginOptions`、`PrintPluginHandle`、`PrintConfig`、`PrintSource`、`PrintPaperPreset`、`PrintPaperSpec`、`PrintOrientation`、`PrintMargin`、`PrintScaleMode`、`PrintPagingMode`、`PrintHeaderFooterConfig`、`PrintHeaderFooterSection`、`PrintImagePayload` | 三插件的配置与声明/预设形态（`WatermarkTextConfig` 与打印水印共享同一模型，经插件入口一并转出） |

## ./sheet 子路径逐项清单（src/sheet.ts，72 值 + 85 类型）

与 `packages/sheet/src/index.ts` 白名单同步维护（同判据、同集合）。公式引擎 API 不在此转售（下游直接 `import '@infinitable/formulas'`）。分组与理由：

| 分组 | 符号 |
| --- | --- |
| 地址系统 | `cellKey`、`colIndexToName`、`colNameToIndex`、`parseAddress`、`formatAddress`、`createRange`、`parseRange`、`formatRange`、`rangesEqual`、`rangesIntersect`、`rangeContainsAddress`、`boundingBox`、`iterateRange`；类型 `CellAddress`、`CellRange` |
| 单元格存储 | `NUMERIC_TEXT_RE`（输入归一化判值口径，伴生公共）、`normalizeInputValue`、`inferCellType`、`isEmptyCellData`、`cellDataEqual`、`CellStore`；类型 `CellType`、`CellValue`、`CellData`、`CellSnapshotItem` |
| 单元格元数据 | `cellMetaKey`、`cellMetaKeyFrom`、`cloneCellMetaPayload`、`cellMetaPayloadEqual`、`CellMetaStore`、`CELL_READONLY_META_NAMESPACE`；类型 `CellMetaSnapshotItem` |
| 样式 | `BORDER_SIDES`、`BORDER_STYLE_WIDTH`、`BORDER_EDGE_DEFAULTS`、`FONT_STYLE_KEYS`、`ALIGN_STYLE_KEYS`、`StylePool`、`composeCellStyles`、`buildBorderPresetItems`；类型 `BorderLineStyle`、`BorderSide`、`BorderEdge`、`HorizontalAlign`、`VerticalAlign`、`CellFont`、`CellAlign`、`CellStyle`、`StyleId`、`CellStylePatch`、`NumFmt`、`BorderPreset`、`BorderPresetItem` |
| 合并/选区/填充/查找 | `MergeManager`、`SelectionModel`、`computeFillTargetRange`、`generateFill`、`findAll`、`findNext`、`findNextFrom`、`findPrev`、`findPrevFrom`；类型 `MergedCellKind`、`CellInfo`、`MergeResult`、`SelectionState`、`FillDirection`、`GenerateFillOptions`、`FindOptions`、`FindMatch` |
| 模型与簿 | `Sheet`、`Workbook`、`FormulaEngine`（组合 @infinitable/formulas 的图簿联动门面）、`TypedEventEmitter`（Sheet/Workbook 事件基类，宿主自定义事件源同基类）；类型 `FrozenState`、`SheetSnapshot`、`SheetEvents`、`WorkbookEvents`、`AddSheetOptions`、`AddSheetCellInput` |
| 命令与撤销 | `HistoryManager`、`CommandRegistry`、`defaultCommandRegistry` 与 13 个 `XxxCommand` 类；类型 `HistoryState`、`PatchDirection`、`CellPatch`、`MergePatch`、`StructureChange`、`StructurePatch`、`SnapshotPatch`、`ImagePatch`、`CellMetaPatch`、`AxisStylePatch`、`Patch`、`Mutation`、`CommandResult`、`CommandContext`、`Command`、`SetCellValueItem` 与各命令 `*Params` 族 |
| 图片 | `createImageId`、`cloneImageAnchor`、`cloneSheetImage`；类型 `SheetImageType`、`SheetImageAnchor`、`SheetImage`、`ImageInput` |
| IO | `exportWorkbookXlsx`、`exportSheetXlsx`、`exportSheetCsv`、`importXlsx`、`importCsv`、`replaceWorkbookWithSnapshots`；类型 `SheetReplaceItem` |
| SheetGrid 适配 | `SheetGrid`；类型 `ResolveCellRenderer`、`SheetGridOptions`、`ScrollbarOptions`（core 同形再导出，`mode: 'native'` 原生滚动条档，0.1.4 起新增）、`ResolveCellStyleHook`、`ResolveDisplayValue`、`SheetGridContextMenuInfo`、`SheetGridContextMenuKind`、`SheetGridHeaderOptions`、`GridCellEditor`、`GridEditorRect`、`GridEditorSession`、`SheetGridEditorsOptions`、`CellRenderer`、`CellRenderTarget` |

## 各子包 src/index.ts 复核结论

`packages/{render,core,formulas,plugins,sheet}` 五包公共入口按同一判据复核（本轮 P4 逐项重判）：全部保留项均有「红线文档面（速查表/插件接口红线清单）或仓内非测试消费」支撑，零移出、零新增（`ScrollbarMode`/`ScrollbarOptions` 系 P1/P2 原生滚动条阶段已入列）。子包公共面同时是主入口显式清单的来源与插件红线边界（`docs/plugin-interface-map.md`：插件包只允许依赖 core 公共入口显式导出的 API）。

## 移出项与过渡方案

**本轮（0.1.4 导出面收敛）移出项：无。** 主入口此前的星号转售面 = 四包子包公共面全量，本轮显式化后集合不变（见上清单）；`./sheet` 子路径为纯新增（`ScrollbarOptions`）。因此无任何 import 受影响、无过渡方案条目。

历史移出（0.1.2 收敛，已生效于 0.1.3，非本轮）：core 的 `ScrollManager`/`ModelBinding`/`CellValuePipeline`/`SelectionState`（core 内部）/`InteractionOverlay`/`EditManager`/`createTextEditor`/`ImageService`/`MediaCache`/`FloatObjectLayer`/`CellNode`/网格布局纯函数族、formulas 的 `tokenizeFormula`/`evaluateAst`/`coerceTo*` 族、plugins 的 `SheetStore`/`SheetBook`/`snapshot`/`restore`/`excelKeymapPreset`/`bindFillGeneration`/`UndoStack`/`paginate`/`printPages`/`openPrintPreview`、`defaultTheme`——逐条理由与替代路径见 `agent-docs/index.md` 速查表后的破坏性变更警示。后续如需再移出：必须「保留导出 + deprecation 注释（至少一个次版本）或移入包内深路径 + 版本化说明」，并在本文档登记名称、理由、过渡方案，无静默移除。

## 0.1.x 已发布使用者兼容结论

- **主入口**：0.1.3 事实导出面（星号转售四层）与 0.1.4 显式面逐符号一致（快照即两版本交集的显式化）——**既有 import 全部不受影响，零迁移成本**。
- **./sheet 子路径**：纯新增 `ScrollbarOptions`（配合 `SheetGridOptions.scrollbar` 全形态透传）；既有 import 不受影响。
- **新增能力**：`ScrollbarMode`（core 层新类型）与 `ScrollbarOptions.mode`（`'canvas'` 缺省 / `'native'` 原生滚动条档）随主入口与 `./sheet` 子路径一并导出；缺省 `'canvas'` 与旧语义完全一致。
- **升级路径**：无需任何代码改动即可从 0.1.3 升级；启用原生滚动条见 `apis/list-table.md` 滚动条节与 `apis/sheet-plugin.md` SheetGrid 滚动条透传节。
- **维护约束**：自 0.1.4 起主入口与 `./sheet` 的导出集合被 `packages/infinitable/tests/public-surface.test.ts` 快照冻结——新增/移除导出须同步改快照、速查表（`agent-docs/index.md`）与本文档清单；dist 类型垫片由 `packages/infinitable/scripts/build-types.mjs` 从 src 同口径生成（`bun run build` 后 `node scripts/check-package-exports.mjs` 校验外部消费姿态）。
