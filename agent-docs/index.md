---
title: infinitable 总览
description: infinitable 是高性能 canvas 表格引擎（多层 canvas 失效驱动渲染 + 全量虚拟滚动），npm 包名 infinitable，@cat-kit/core 为 peerDependency 须自装。含四层模块（render/core/formulas/plugins）与全部公共导出到文档路径的速查表（主入口显式导出 + ./sheet 子路径逐项）；plugins 层三插件（chart/watermark/print）均为 createXxxPlugin 工厂对象形态，sheet 能力由 @infinitable/sheet 提供、经 infinitable 的 ./sheet 子路径转出。导出面判据与移出项过渡方案见 apis/exports.md，符号集合被 public-surface 快照测试冻结。
aliases: [infinitable, infinite-table, InfiniTable, 表格引擎, canvas 表格]
keywords: [infinitable, ListTable, createRenderHost, extendsTheme, evaluate, parseFormula, @infinitable/sheet, createChartPlugin, createWatermarkPlugin, createPrintPlugin, ScrollbarOptions, ScrollbarMode, EditorRegistry, CellChartMedia, 虚拟滚动, 安装, 模块列表, canvas, 表格, 插件, 导出面]
---

# infinitable 总览

infinitable 是多层 canvas 失效驱动渲染 + 全量虚拟滚动的高性能表格引擎，npm 包名 `infinitable`（当前 0.1.3，MIT）。构造与首次渲染只处理可视区窗口，10 万~100 万行数据下性能不随数据量劣化；最小构建 gzip 27KB。统一入口 `import { ... } from 'infinitable'` 单包显式 re-export 四层：render（canvas 渲染引擎）、core（表格主体）、formulas（公式引擎）、plugins（官方插件，全部为 `createXxxPlugin` 工厂返回的插件对象：同时是 `TablePlugin` 与运行时 handle）。运行环境为浏览器 DOM（离屏/无 window 环境可构造，编辑与事件能力受限）。电子表格能力经 `infinitable/sheet` 子路径转出（`@infinitable/sheet` 白名单全量）。两入口导出符号集合由 `packages/infinitable/tests/public-surface.test.ts` 快照冻结，判据与逐项清单见 `apis/exports.md`。

## 安装

```bash
bun add infinitable @cat-kit/core
# npm / pnpm / yarn 同理：
# npm install infinitable @cat-kit/core
```

- `@cat-kit/core`（`^1.2.1`）是 peerDependency，必须与 `infinitable` 一起安装：公式引擎的四则运算与 SUM/AVERAGE/ROUND/ABS 精确计算依赖其 `$n`。
- `chart.js` 不在依赖里：chart 插件按需动态 `import('chart.js')`，只用到单元格图表时才安装。
- 仓内 monorepo 开发分层引用（`@infinitable/render` / `core` / `formulas` / `plugins`），发布为单包 `infinitable`；使用方一律从 `infinitable` 导入。

## 模块速查

统一入口与 `./sheet` 子路径全部公共导出（含 `CellRef` 消歧：formulas 的 A1 引用保留 `CellRef`，core 的格坐标以 `GridCellRef` 别名导出）按下表定位篇目，逐项可 grep 核对。

| 导出名 | 用途 | 文档路径 |
| --- | --- | --- |
| `ListTable` | 表格主类：构造选项、生命周期、滚动/冻结/合并/事件/插件注册 | `apis/list-table.md` |
| `ListTableOptions` / `ColumnDefine` / `DataRecord` | 构造选项与列定义 | `apis/list-table.md` |
| `TableModel` / `SheetModel` | 模型直挂接口与内置内存坐标模型 | `apis/list-table.md` |
| `ResolveDisplayValue` | 按格显示 hook（取值管线末端） | `apis/list-table.md` |
| `ScrollbarOptions` / `ScrollbarMode` | 内建滚动条配置（`scrollbar` 选项对象形态：mode/visibility/hideDelay；`mode: 'native'` 浏览器原生滚动条档，0.1.4 起） | `apis/list-table.md` |
| `CellChangeEvent` / `CellRef` / `GridCellRef` / `TableContextMenuEvent` | 格坐标与事件载荷 | `apis/list-table.md` |
| `TablePlugin` | 插件契约（构造 plugins 或 table.use） | `apis/list-table.md` |
| `UnderlayPainter` / `OverlayPainter` | ground/sky 整层绘制预留位 | `apis/list-table.md` |
| `extendsTheme` / `TableTheme` / `ThemeOverride` | 主题深覆盖派生与分区 token（含滚动条 token） | `apis/theme-style.md` |
| `CellStyle` / `CellBorder` / `CellBorderEdge` / `projectCellStyle` | 逐格样式、逐边边框与样式投影 | `apis/theme-style.md` |
| `SelectionSnapshot` / `RangeBounds` / `normalizeRange` | 选区快照与归一化 | `apis/interaction-selection.md` |
| `HighlightRange` / `FillDragEndEvent` | sky 浮层高亮区与填充柄拖拽结束事件 | `apis/interaction-selection.md` |
| `EditorRegistry` | 编辑器注册表与格级路由 | `apis/editing.md` |
| `CellRenderer` | 自定义单元格渲染器（`resolveCellRenderer` hook） | `apis/cell-rendering.md` |
| `CellRange` / `normalizeCellRange` | 合并单元格区间模型 | `apis/cell-rendering.md` |
| `LoadedImage` / `CellChartMedia` | 加载完成的位图（图片加载器注入面）与图表格媒体描述 | `apis/media-float.md` |
| `FloatObject` / `FloatTransformEndEvent` / `FloatTransformHandle` | 浮动对象与变换事件（`table.floatObjects` 实例面） | `apis/media-float.md` |
| `createRenderHost` / `RenderHostOptions` / `RenderHost` | 渲染宿主（窄接口唯一实现入口） | `apis/render-engine.md` |
| `SceneNode` / `SceneNodeInit` / `SceneEvent` / `SceneEventType` / `SceneEventListener` | 场景树与 federated 事件 | `apis/render-engine.md` |
| `LayerHandle` / `LayerKind` / `LayerOpts` / `Invalidation` / `FrameTask` | 层句柄与三档失效 | `apis/render-engine.md` |
| `Region` / `Size` / `RenderContext` / `RenderCanvas` / `RenderImageSource` | 渲染基础类型（render 层导出，core 层亦转出 `RenderContext`/`Size`） | `apis/render-engine.md` |
| `parseCellRef` / `formatCellRef` / `colLetters` / `formatRangeRef` / `createRangeRef` / `CellRef` | A1 地址系统（0 基坐标） | `apis/formula-engine.md` |
| `FormulaError` / `formulaError` / `isFormulaError` / `isFormulaErrorCode` / `FormulaParseError` | 公式错误值体系（7 种错误码） | `apis/formula-engine.md` |
| `parseFormula` / `AstNode` | Pratt 解析器与 AST | `apis/formula-engine.md` |
| `collectAstReferences` / `astHasVolatileCall` | AST 静态引用收集 | `apis/formula-engine.md` |
| `DependencyGraph` / `FormulaRefCoord` / `SheetCellCoord` | 公式依赖图（增量重算标脏；formulasOf/affectedBySheet 按表查询） | `apis/formula-engine.md` |
| `scanFormulaReferences` | 容错引用扫描（编辑染色框） | `apis/formula-engine.md` |
| `shiftFormulaText` / `shiftFormulaRefs` / `FormulaShiftResult` / `tokenText` | 公式引用平移（行列插删改写公式文本；`shiftFormulaRefs` 填充柄按行列增量平移）与 token 文本 | `apis/formula-engine.md` |
| `evaluate` / `FormulaResolver` / `FormulaEvalContext` / `ScalarValue` | 求值器与宿主取值接口（含自定义函数求值上下文） | `apis/formula-engine.md` |
| `FORMULA_FUNCTION_CATEGORIES` / `registerFormulaFunction` / `getFormulaFunction` / `getFormulaFunctionInfo` / `listFormulaFunctions` / `FormulaFunction` / `FormulaFunctionInfo` / `FormulaFunctionCategory` | 函数注册表读写（49 内置函数元数据 + 自定义函数注册） | `apis/formula-engine.md` |
| `@infinitable/sheet` 全部符号经 `infinitable` 的 `./sheet` 子路径转出（电子表格核心，原 plugins 的 sheet 插件族整体迁入，`createSheetPlugin` 已删），按域分见下列各行 | 电子表格核心模型/命令/IO/SheetGrid 适配 | `apis/sheet-plugin.md` |
| `cellKey` / `colIndexToName` / `colNameToIndex` / `parseAddress` / `formatAddress` / `createRange` / `parseRange` / `formatRange` / `rangesEqual` / `rangesIntersect` / `rangeContainsAddress` / `boundingBox` / `iterateRange` / `CellAddress` / `CellRange` | sheet 地址系统（A1 名称与区间运算，与 formulas 的 A1 坐标系统分立） | `apis/sheet-plugin.md` |
| `NUMERIC_TEXT_RE` / `normalizeInputValue` / `inferCellType` / `isEmptyCellData` / `cellDataEqual` / `CellStore` / `CellType` / `CellValue` / `CellData` / `CellSnapshotItem` | sheet 单元格存储与输入归一化 | `apis/sheet-plugin.md` |
| `cellMetaKey` / `cellMetaKeyFrom` / `cloneCellMetaPayload` / `cellMetaPayloadEqual` / `CellMetaStore` / `CELL_READONLY_META_NAMESPACE` / `CellMetaSnapshotItem` | sheet 单元格元数据存储 | `apis/sheet-plugin.md` |
| `BORDER_SIDES` / `BORDER_STYLE_WIDTH` / `BORDER_EDGE_DEFAULTS` / `FONT_STYLE_KEYS` / `ALIGN_STYLE_KEYS` / `StylePool` / `composeCellStyles` / `buildBorderPresetItems` / `BorderLineStyle` / `BorderSide` / `BorderEdge` / `HorizontalAlign` / `VerticalAlign` / `CellFont` / `CellAlign` / `CellStyle` / `StyleId` / `CellStylePatch` / `NumFmt` / `BorderPreset` / `BorderPresetItem` | sheet 样式池、样式合成与边框预设 | `apis/sheet-plugin.md` |
| `MergeManager` / `SelectionModel` / `computeFillTargetRange` / `generateFill` / `findAll` / `findNext` / `findNextFrom` / `findPrev` / `findPrevFrom` / `MergedCellKind` / `CellInfo` / `MergeResult` / `SelectionState` / `FillDirection` / `GenerateFillOptions` / `FindOptions` / `FindMatch` | sheet 合并区、选区模型、填充生成与查找 | `apis/sheet-plugin.md` |
| `Sheet` / `Workbook` / `FormulaEngine` / `TypedEventEmitter` / `FrozenState` / `SheetSnapshot` / `SheetEvents` / `WorkbookEvents` / `AddSheetOptions` / `AddSheetCellInput` | sheet 模型、多表簿、公式引擎门面与事件基类 | `apis/sheet-plugin.md` |
| `HistoryManager` / `CommandRegistry` / `defaultCommandRegistry` / `SetCellValueCommand` / `SetCellFormulaCommand` / `SetCellStyleCommand` / `SetAxisStyleCommand` / `InsertCellsCommand` / `MergeCellsCommand` / `UnmergeCellsCommand` / `MergeCellsBatchCommand` / `InsertImageCommand` / `RemoveImageCommand` / `UpdateImageCommand` / `SetCellMetaCommand` / `ClearCellMetaCommand` / `HistoryState` / `PatchDirection` / `CellPatch` / `MergePatch` / `StructureChange` / `StructurePatch` / `SnapshotPatch` / `ImagePatch` / `CellMetaPatch` / `AxisStylePatch` / `Patch` / `Mutation` / `CommandResult` / `CommandContext` / `Command` / `SetCellValueItem` / `SetCellValueParams` / `SetCellFormulaParams` / `SetCellStyleItem` / `SetCellStyleParams` / `SetAxisStyleItem` / `SetAxisStyleParams` / `InsertCellsParams` / `MergeCellsParams` / `UnmergeCellsParams` / `MergeCellsBatchParams` / `InsertImageParams` / `RemoveImageParams` / `ImageUpdateFields` / `UpdateImageParams` / `SetCellMetaParams` / `ClearCellMetaParams` | sheet 命令族（撤销栈与可注册命令面） | `apis/sheet-plugin.md` |
| `createImageId` / `cloneImageAnchor` / `cloneSheetImage` / `SheetImageType` / `SheetImageAnchor` / `SheetImage` / `ImageInput` | sheet 浮动图片锚点与克隆 | `apis/sheet-plugin.md` |
| `exportWorkbookXlsx` / `exportSheetXlsx` / `exportSheetCsv` / `importXlsx` / `importCsv` / `replaceWorkbookWithSnapshots` / `SheetReplaceItem` | sheet xlsx/csv 导入导出与快照替换 | `apis/sheet-plugin.md` |
| `SheetGrid` / `ResolveCellRenderer` / `SheetGridOptions` / `ScrollbarOptions`（core 同形再导出，`mode: 'native'` 档） / `ResolveCellStyleHook` / `ResolveDisplayValue` / `SheetGridContextMenuInfo` / `SheetGridContextMenuKind` / `SheetGridHeaderOptions` / `GridCellEditor` / `GridEditorRect` / `GridEditorSession` / `SheetGridEditorsOptions` / `CellRenderer` / `CellRenderTarget` | SheetGrid 装配（Sheet 模型 ↔ ListTable 适配层） | `apis/sheet-plugin.md` |
| `createChartPlugin` / `ChartPluginOptions` / `ChartPluginHandle` | 图表插件工厂与句柄 | `apis/chart-watermark-plugin.md` |
| `ChartCellDeclaration` / `ChartDatasetDeclaration` / `ChartDatasetSpec` / `ChartSpec` / `ChartSpecType` / `ChartType` | 单元格图表声明与规范化类型 | `apis/chart-watermark-plugin.md` |
| `createWatermarkPlugin` / `WatermarkHandle` / `WatermarkTextConfig` | 水印插件工厂、句柄与配置 | `apis/chart-watermark-plugin.md` |
| `createPrintPlugin` / `PrintPluginOptions` / `PrintPluginHandle` | 打印插件工厂与句柄（分页/文档构建/打印输出/预览经 handle 方法） | `apis/print-plugin.md` |
| `PrintConfig` / `PrintSource` / `PrintPaperPreset` / `PrintPaperSpec` / `PrintOrientation` / `PrintMargin` / `PrintScaleMode` / `PrintPagingMode` / `PrintHeaderFooterConfig` / `PrintHeaderFooterSection` / `PrintImagePayload` | 打印配置与数据源 | `apis/print-plugin.md` |
| （导出面判据、逐项清单、移出项过渡方案、0.1.x 兼容结论） | 主入口与 `./sheet` 子路径导出集合的判定依据与冻结机制 | `apis/exports.md` |

指南：`guide/quick-start.md`（快速上手）、`guide/performance-virtual-scroll.md`（大数据量性能与虚拟滚动）、`guide/plugin-integration.md`（插件接入：图表/水印/表格插件契约）。

> [!WARNING]
> - 0.1.2 起公共导出面大幅收敛（已生效于现行 0.1.3）：core 的 `ScrollManager`/`ModelBinding`/`CellValuePipeline`/`SelectionState`/`InteractionOverlay`/`EditManager`/`createTextEditor`/`ImageService`/`MediaCache`/`FloatObjectLayer`/`CellNode`/网格布局纯函数族、formulas 的 `tokenizeFormula`/`evaluateAst`/`coerceTo*` 族（注册表写入 `registerFormulaFunction` 族后随 `@infinitable/sheet` 模型层公共化）、plugins 的 `SheetStore`/`SheetBook`/`snapshot`/`restore`/`excelKeymapPreset`/`bindFillGeneration`/`UndoStack`/`paginate`/`printPages`/`openPrintPreview` 等散装符号不再从 `infinitable` 导出——滚动/选区/编辑/媒体/布局等内部原语经引擎内置接线消费，插件能力改经 `createXxxPlugin` 工厂的 handle 方法消费（逐篇见各 API 文档「注意事项」的破坏性变更条目）。
> - `defaultTheme` 不再导出：默认主题值经 `extendsTheme()` 派生结果或 `table.getTheme()` 读取。
> - `scrollbar` 选项类型从 `boolean` 变为 `boolean | ScrollbarOptions`（`true`/缺省语义不变）。
> - 0.1.4 起主入口消灭星号导出、改为显式具名导出，且与 `./sheet` 子路径的符号集合被 `public-surface.test.ts` 快照冻结（判据与清单见 `apis/exports.md`）——显式面与 0.1.3 事实面逐符号一致，既有 import 不受影响；此后增删导出必须显式改快照与本文档速查表。
