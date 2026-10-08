---
title: infinitable 总览
description: infinitable 是高性能 canvas 表格引擎（多层 canvas 失效驱动渲染 + 全量虚拟滚动），npm 包名 infinitable，@cat-kit/core 为 peerDependency 须自装。含四层模块（render/core/formulas/plugins）与全部公共导出到文档路径的速查表。
aliases: [infinitable, infinite-table, InfiniTable, 表格引擎, canvas 表格]
keywords: [infinitable, ListTable, createRenderHost, SheetStore, SheetBook, evaluate, parseFormula, createChartPlugin, createWatermarkPlugin, printPages, paginate, snapshot, restore, 虚拟滚动, 安装, 模块列表, canvas, 表格]
---

# infinitable 总览

infinitable 是多层 canvas 失效驱动渲染 + 全量虚拟滚动的高性能表格引擎，npm 包名 `infinitable`（当前 0.1.2，MIT）。构造与首次渲染只处理可视区窗口，10 万~100 万行数据下性能不随数据量劣化；最小构建 gzip 27KB。统一入口 `import { ... } from 'infinitable'` 单包 re-export 四层：render（canvas 渲染引擎）、core（表格主体）、formulas（公式引擎）、plugins（官方插件）。运行环境为浏览器 DOM（离屏/无 window 环境可构造，编辑与事件能力受限）。

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

统一入口全部公共导出（含 `CellRef` 消歧：formulas 的 A1 引用保留 `CellRef`，core 的格坐标以 `GridCellRef` 别名导出）按下表定位篇目。

| 导出名 | 用途 | 文档路径 |
| --- | --- | --- |
| `ListTable` | 表格主类：构造选项、生命周期、滚动/冻结/合并/事件 | `apis/list-table.md` |
| `ListTableOptions` / `ColumnDefine` / `DataRecord` | 构造选项与列定义 | `apis/list-table.md` |
| `TableModel` / `ModelBinding` / `SheetModel` | 数据模型三件套（模型直挂/事件绑定/内存坐标模型） | `apis/list-table.md` |
| `CellValuePipeline` / `CellValuePipelineInit` / `ResolveDisplayValue` | 取值管线与按格显示 hook | `apis/list-table.md` |
| `ScrollManager` / `ScrollState` / `ScrollDelta` / `ScrollListener` | 滚动唯一状态源 | `apis/list-table.md` |
| `CellChangeEvent` / `EditStartEvent` / `EditEndEvent` | 编辑与模型变更事件 | `apis/list-table.md` |
| `CellRef` / `GridCellRef` | 格坐标（统一入口：A1 引用 / 格坐标消歧名） | `apis/list-table.md` |
| `TableContextMenuEvent` / `ContextMenuListener` | 右键事件 | `apis/list-table.md` |
| `ScrollFrameListener` / `UnderlayPainter` / `OverlayPainter` | 帧级滚动回调与整层绘制预留位 | `apis/list-table.md` |
| `TablePlugin` | 插件契约（构造 plugins 或 table.use） | `apis/list-table.md` |
| `WindowRange` | 可视窗口行列区间（[start, end)） | `apis/list-table.md` |
| `defaultTheme` / `extendsTheme` / `TableTheme` / `ThemeOverride` | 默认主题与深覆盖派生 | `apis/theme-style.md` |
| `CellStyleTokens` / `InteractionTokens` / `FrameStyle` | 主题分区 token | `apis/theme-style.md` |
| `CellStyle` / `CellBorder` / `CellBorderEdge` / `CellBorderStyle` / `CellPadding` / `CellTextAlign` / `CellTextOverflow` / `CellVerticalAlign` | 逐格样式与边框 | `apis/theme-style.md` |
| `projectCellStyle` / `ResolveCellStyle` | 样式投影与按格样式 hook | `apis/theme-style.md` |
| `SelectionState` / `normalizeRange` / `SelectionRange` / `SelectionSnapshot` / `RangeBounds` / `SelectionBounds` / `SelectionListener` | 选区状态机 | `apis/interaction-selection.md` |
| `InteractionOverlay` / `OverlayContent` / `OverlayGeometry` / `ResizeLine` / `HighlightRange` | sky 层交互浮层 | `apis/interaction-selection.md` |
| `FILL_HANDLE_SIZE` / `fillHandleRect` / `hitFillHandle` / `resolveFocusRange` | 填充柄几何原语 | `apis/interaction-selection.md` |
| `FillHandleDownEvent` / `FillHandleDownListener` / `FillDragEndEvent` / `FillDragEndListener` / `FillHandleDoubleClickEvent` / `FillHandleDoubleClickListener` | 填充柄事件 | `apis/interaction-selection.md` |
| `hitResizeHandle` / `ResizeSession` / `ResizeTarget` / `ResizeGeometry` / `ResizeCapability` / `ColResizeEndEvent` / `RowResizeEndEvent` | 行列 resize 原语 | `apis/interaction-selection.md` |
| `InertiaScroller` / `TouchScrollTracker` / `TouchPoint` / `ScrollDelta2D` / `InertiaVelocity` | 触控惯性滚动 | `apis/interaction-selection.md` |
| `nextActiveCell` / `revealAxis` | 键盘导航纯函数 | `apis/interaction-selection.md` |
| `EditorRegistry` / `CellEditor` / `EditorRoute` | 编辑器注册表与格级路由 | `apis/editing.md` |
| `EditManager` / `EditManagerInit` / `EditWriteTarget` / `EditCommitMove` | 编辑会话生命周期 | `apis/editing.md` |
| `createTextEditor` / `TextEditor` / `TextEditorInit` / `TextEditorKeyAction` / `TextEditorDoc` / `TextEditorElement` / `TextEditorElementStyle` / `TextEditorHost` / `EditorKeyEvent` | DOM 浮层文本编辑器 | `apis/editing.md` |
| `CellType` / `CellRenderer` / `CellRenderTarget` / `ResolveCellRenderer` / `BUILTIN_CELL_RENDERERS` / `renderTextCell` / `renderCheckboxCell` | 单元格渲染（内置 text/checkbox 与自定义） | `apis/cell-rendering.md` |
| `CellRange` / `MergeCellMap` / `normalizeCellRange` / `rangeContains` / `rangeCrossesBoundary` | 合并单元格区间模型 | `apis/cell-rendering.md` |
| `CellNode` / `CellNodeInit` | 数据格场景节点 | `apis/cell-rendering.md` |
| `clampFrozenCount` / `computeColOffsets` / `computeRowOffsets` / `computeColWindow` / `computeRowWindow` / `computeRowWindowFromOffsets` / `computeScrollableColWindow` / `computeScrollableRowWindow` / `computeScrollableRowWindowFromOffsets` / `findColAt` / `findRowAt` / `resolveCellX` / `resolveCellY` / `resolveCellYFromOffsets` / `unionRegions` | 网格布局纯函数（偏移/窗口/坐标换算） | `apis/cell-rendering.md` |
| `ImageService` / `ImageServiceOptions` / `ImageLoader` / `LoadedImage` / `ImageState` / `ImageLoadEvent` / `ImageErrorEvent` | 图片窗口化加载服务 | `apis/media-float.md` |
| `MediaCache` / `MediaCacheOptions` | cell 级位图 LRU 缓存 | `apis/media-float.md` |
| `ImageCellNode` / `ImageCellNodeInit` / `ChartCellNode` / `ChartCellNodeInit` / `ImageFit` | media 层格节点 | `apis/media-float.md` |
| `ResolveCellImage` / `CellChartMedia` / `CellChartMediaSize` / `ResolveCellChart` | 按格图片/图表媒体 hook | `apis/media-float.md` |
| `FloatObjectLayer` / `FloatObject` / `FloatGeometry` / `FloatObjectChange` / `FloatDragEndEvent` / `FloatTransformEndEvent` / `FloatTransformHandle` | 浮动对象层（拖拽/缩放/旋转） | `apis/media-float.md` |
| `createRenderHost` / `RenderHostOptions` / `RenderHost` | 渲染宿主（窄接口唯一实现入口） | `apis/render-engine.md` |
| `SceneNode` / `SceneNodeInit` / `SceneEvent` / `SceneEventType` / `SceneEventListener` | 场景树与 federated 事件 | `apis/render-engine.md` |
| `LayerHandle` / `LayerKind` / `LayerOpts` / `Invalidation` / `FrameTask` | 层句柄与三档失效 | `apis/render-engine.md` |
| `Region` / `Size` / `RenderContext` / `RenderCanvas` / `RenderImageSource` | 渲染基础类型 | `apis/render-engine.md` |
| `parseCellRef` / `formatCellRef` / `parseColLetters` / `colLetters` / `formatRangeRef` / `createRangeRef` / `formatSheetName` / `CellRef` / `RangeRef` | A1 地址系统（0 基坐标） | `apis/formula-engine.md` |
| `FORMULA_ERROR_CODES` / `FormulaError` / `FormulaErrorCode` / `formulaError` / `isFormulaError` / `isFormulaErrorCode` | 公式错误值体系（7 种错误码） | `apis/formula-engine.md` |
| `tokenizeFormula` / `FormulaToken` / `FormulaOperator` / `FormulaParseError` | 公式分词器 | `apis/formula-engine.md` |
| `parseFormula` / `AstNode` / `BinaryOperator` | Pratt 解析器与 AST | `apis/formula-engine.md` |
| `collectAstReferences` / `astHasVolatileCall` / `AstReference` | AST 静态引用收集 | `apis/formula-engine.md` |
| `DependencyGraph` / `FormulaRefCoord` / `SheetCellCoord` / `SheetRangeCoord` | 公式依赖图（增量重算标脏） | `apis/formula-engine.md` |
| `scanFormulaReferences` / `ScannedReference` | 容错引用扫描（编辑染色框） | `apis/formula-engine.md` |
| `evaluate` / `evaluateAst` / `coerceToNumber` / `coerceToText` / `coerceToBoolean` / `EvalValue` / `EvaluateOptions` / `FormulaEvalContext` / `FormulaResolver` / `ScalarValue` | 求值器 | `apis/formula-engine.md` |
| `registerFormulaFunction` / `getFormulaFunction` / `getFormulaFunctionInfo` / `listFormulaFunctions` / `invokeFormulaFunction` / `isVolatileFormulaFunction` / `formatFunctionSignature` / `FORMULA_FUNCTION_CATEGORIES` / `FormulaFunction` / `FormulaFunctionCategory` / `FormulaFunctionInfo` / `FormulaFunctionMeta` / `FormulaFunctionParam` | 函数注册表（49 内置函数） | `apis/formula-engine.md` |
| `SheetStore` / `SheetStoreOptions` / `SheetStoreChangeEvent` / `SheetStoreChangeType` / `SheetStoreChangeListener` / `SheetStoreMetaChangeEvent` / `SheetStoreMetaChangeListener` / `SheetCellMetaEntry` / `SheetCellStyleEntry` / `SheetColumnStyleEntry` / `SheetDisplayResolver` / `SheetFrozen` | sheet 坐标模型（值/样式/meta/尺寸/冻结/合并） | `apis/sheet-plugin.md` |
| `SheetBook` / `SheetBookOptions` / `SheetBookChangeEvent` / `SheetDef` / `HostFactory` | 多 sheet 实例池 | `apis/sheet-plugin.md` |
| `snapshot` / `restore` / `SheetSnapshot` / `SheetSnapshotCell` / `SheetSnapshotCellStyle` / `SheetSnapshotColumnStyle` / `SheetSnapshotStyles` / `SheetSnapshotMeta` / `SheetSnapshotRowHeight` / `SheetSnapshotColWidth` / `SheetSnapshotExtras` / `SheetRestoreWiring` | 快照采集与灌回 | `apis/sheet-plugin.md` |
| `createFormulaDisplay` / `FormulaDisplayFn` / `FormulaEvaluator` | 公式感知显示 | `apis/sheet-plugin.md` |
| `excelKeymapPreset` | Excel 键位预设 | `apis/sheet-plugin.md` |
| `bindFillGeneration` / `generateFill` / `resolveAutoFillTarget` / `FillCell` / `FillRead` / `FillGenerationOptions` | 填充生成 | `apis/sheet-plugin.md` |
| `bindSelectionSync` / `SelectionSyncController` / `SelectionSyncOptions` | 选区双向同步 | `apis/sheet-plugin.md` |
| `UndoStack` / `UndoCommand` / `bindCellChangeUndo` / `CellChangeUndoBinding` / `CellChangeUndoOptions` | 撤销栈 | `apis/sheet-plugin.md` |
| `borderPresetLine` / `buildBorderPresetCells` / `BorderPreset` / `BorderLineStyle` / `BorderPresetCell` | 边框预设展开 | `apis/sheet-plugin.md` |
| `sheetToWriteSheet` / `numFmtToXlsxCode` / `decodeDataUrlImage` / `SheetExportSource` / `SheetImagePayload` / `SheetNumFmt` | xlsx 导出映射 | `apis/sheet-plugin.md` |
| `createChartPlugin` / `CHART_PLUGIN_NAME` / `ChartPluginHandle` / `ChartPluginOptions` | 图表插件 | `apis/chart-watermark-plugin.md` |
| `loadChartJs` / `ChartJsModule` | Chart.js 按需加载 | `apis/chart-watermark-plugin.md` |
| `parseChartDeclaration` / `ChartParseResult` / `ChartCellDeclaration` / `ChartDatasetDeclaration` / `ChartSpec` / `ChartSpecType` / `ChartType` / `ChartDatasetSpec` | 图表声明解析 | `apis/chart-watermark-plugin.md` |
| `chartContentKey` / `renderChartBitmap` / `ChartRenderOptions` | 图表内容 key 与离屏出图 | `apis/chart-watermark-plugin.md` |
| `createWatermarkPlugin` / `WATERMARK_PLUGIN_NAME` / `WatermarkHandle` / `WatermarkTextConfig` / `WATERMARK_TEXT_DEFAULTS` | 水印插件 | `apis/chart-watermark-plugin.md` |
| `paginate` / `PrintPage` / `PrintRowRange` | 打印分页 | `apis/print-plugin.md` |
| `buildPrintDocumentHtml` / `buildPrintPageHtml` | 打印页面 HTML 构建 | `apis/print-plugin.md` |
| `evaluatePlaceholders` / `renderHeaderFooter` / `PlaceholderContext` | 页眉页脚占位符求值 | `apis/print-plugin.md` |
| `printPages` / `PrintHooks` | iframe 打印输出 | `apis/print-plugin.md` |
| `openPrintPreview` / `PrintPreviewHandle` | 打印预览弹层 | `apis/print-plugin.md` |
| `PrintConfig` / `PrintSource` / `PrintPaperPreset` / `PrintPaperSpec` / `PrintOrientation` / `PrintMargin` / `PrintScaleMode` / `PrintPagingMode` / `PrintHeaderFooterConfig` / `PrintHeaderFooterSection` / `PrintImagePayload` | 打印配置与数据源 | `apis/print-plugin.md` |

指南：`guide/quick-start.md`（快速上手）、`guide/performance-virtual-scroll.md`（大数据量性能与虚拟滚动）、`guide/plugin-integration.md`（插件接入：图表/水印/表格插件契约）。
