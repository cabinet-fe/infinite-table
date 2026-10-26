---
title: API 导出总览
description: infinitable 的三个发布入口（主入口、./sheet、./pivot）、导出判据与稳定性、按模块分组的导出速查表、CellRef 同名消歧，以及公共导出面如何被快照测试冻结。
---

# API 导出总览

`infinitable` 是单包发布的聚合入口：仓库内按 workspace 分包开发，发布时把 render、grid、table、formulas、plugins 五层的公共 API 显式转售到主入口。另有两个子路径：`infinitable/sheet` 转售电子表格形态的 `@infinitable/sheet` 公共面，`infinitable/pivot` 转售透视表引擎 `@infinitable/pivot` 公共面。

本页给出三个入口的边界、导出判据、按模块分组的符号速查表，以及 `CellRef` 同名消歧规则。逐项签名与默认值见各分页：

- 表格主类与配置：[/api/list-table](/api/list-table)
- 渲染引擎：[/api/render](/api/render)
- 共享类型、主题、选区、合并、媒体：[/api/grid-table](/api/grid-table)
- 公式引擎：[/api/formulas](/api/formulas)
- 官方插件：[/api/plugins](/api/plugins)
- 电子表格：[/api/sheet](/api/sheet)
- 透视表：[/guide/pivot](/guide/pivot)

## 三个入口

| 入口   | 导入路径            | 转售内容                                                                                                                                         | 适用场景                                                       |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| 主入口 | `infinitable`       | `@infinitable/render` + `@infinitable/grid` + `@infinitable/table` + `@infinitable/formulas` + `@infinitable/plugins` 的公共 API                 | 绘制表格、嵌入自研渲染宿主、公式计算、挂官方插件               |
| 子路径 | `infinitable/sheet` | `@infinitable/sheet` 白名单全量（地址系统、单元格存储、样式池、合并/选区/填充/查找、`Sheet`/`Workbook`、命令与撤销、图片、IO、`SheetGrid` 适配） | 需要电子表格模型、命令栈、xlsx/csv 导入导出或 `SheetGrid` 装配 |
| 子路径 | `infinitable/pivot` | `@infinitable/pivot` 白名单全量（`PivotGrid` 引擎与 `PivotModel`、维度/度量/记录类型、断言锚点常量）                                            | 透视表 / 交叉表形态：行列维度分组、多级表头、聚合与小计        |

```ts
// 主入口
import { ListTable, createRenderHost, evaluate, createChartPlugin } from 'infinitable'

// 子路径（电子表格能力）
import { Sheet, Workbook, SheetGrid, importXlsx } from 'infinitable/sheet'

// 子路径（透视表引擎）
import { PivotGrid, type PivotDimension } from 'infinitable/pivot'
```

::: tip
`infinitable/sheet` 不转售公式引擎 API。需要在 sheet 场景直接使用公式引擎时，从主入口（或 `@infinitable/formulas`）导入 `parseFormula`、`evaluate`、`DependencyGraph` 等符号。
:::

## 导出判据与稳定性

四层入口（主入口、`./sheet` 子路径、`./pivot` 子路径、各子包 `src/index.ts`）使用同一判据，逐项判定。

**导出（稳定公共 API）**

- 类型：构造选项、事件载荷、插件契约等对外形态（`ListTableOptions`、`SheetGridOptions`、`TablePlugin`、命令参数类型族等）。
- 配置对象与常量：主题、样式键集、边框预设等可定制面（`extendsTheme`、`BORDER_SIDES` 等）。
- 注册函数：宿主注入扩展点的写入面（`registerFormulaFunction`、`EditorRegistry`、`defaultCommandRegistry` 等）。
- 插件接口与工厂：`TablePlugin` 契约，`createChartPlugin` / `createWatermarkPlugin` / `createPrintPlugin` 及其配置与 handle 类型。

**不导出（包内实现细节，不属于公共契约）**

- 内部实现细节：滚动状态源 `ScrollManager`、模型绑定 `ModelBinding`、取值管线 `CellValuePipeline`、公式词法/AST 求值原语 `tokenizeFormula` / `evaluateAst`、`coerceTo*` 强制转换族、图表加载与渲染实现等。
- 实验性 API：未定稿能力不进入发布面。
- 跨层内部工具：网格布局纯函数族、`MediaCache`、`CellNode`、`ImageService`、`FloatObjectLayer` 等。

**稳定性的实际含义**

- 主入口与 `./sheet`、`./pivot` 的导出符号集合由 `packages/infinitable/tests/public-surface.test.ts` 用显式快照冻结。新增或删除导出必须同步修改快照才能通过测试，防止内部实现经星号转售泄漏成事实公共 API。
- `packages/infinitable/src/` 内禁止 `export *` 语句；所有转售都是显式具名导出。
- 同源符号只从定义包导出一次：`RenderContext` / `Size` 由 render 定义（table 也转出同名类型），`TablePlugin` 由 table 定义；主入口各取一处。
- 符号被移出公共面时，会保留至少一个次版本的 deprecation 或改为包内深路径，并在发布说明中登记替代路径；不做静默移除。

::: warning
深路径导入（如从 `@infinitable/table/src/...` 取内部模块）不属于公共契约，升级时可能直接失效。宿主代码应只依赖 `infinitable`、`infinitable/sheet` 与 `infinitable/pivot` 的公共导出。
:::

## CellRef 同名消歧

grid/formulas 两层里有两个不同的 `CellRef`。主入口做了显式消歧：

| 主入口符号    | 定义层   | 字段                                                                                           | 语义                                                                                            |
| ------------- | -------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GridCellRef` | grid     | `col: number`、`row: number`                                                                   | 格坐标（0 基），用于命中测试、选区、图片窗口、浮动对象锚点、编辑定位                            |
| `CellRef`     | formulas | `col: number`、`row: number`、`colAbsolute: boolean`、`rowAbsolute: boolean`、`sheet?: string` | A1 引用（含绝对/相对标记与跨表名），配 `parseCellRef` / `formatCellRef` / `createRangeRef` 使用 |

```ts
import type { CellRef, GridCellRef } from 'infinitable'

const grid: GridCellRef = { col: 2, row: 5 } // 表格格坐标
const a1: CellRef = { col: 2, row: 5, colAbsolute: false, rowAbsolute: false } // "C6"
```

::: tip
两者的 `col` / `row` 都是 0 基数字，区别在于 formulas 的 `CellRef` 还携带 A1 绝对引用标记与可选表名。`ListTable.getCellAtRelativePosition`、`scrollToCell`、`setSelectionAnchor` 等表格方法消费的是 `GridCellRef`。
:::

## 公共面由快照测试冻结

- 快照文件：`packages/infinitable/tests/public-surface.test.ts`。
- 该测试同时断言主入口与 `./sheet`、`./pivot` 子路径不含星号导出。
- dist 类型垫片由 `packages/infinitable/scripts/build-types.mjs` 从 `src` 同口径生成；构建后可用 `node scripts/check-package-exports.mjs` 校验外部消费姿态。

因此在贡献代码时：

1. 新增公共符号必须同时改 `src/index.ts` / `src/sheet.ts` / `src/pivot.ts`、快照测试与本页速查表。
2. 只改内部模块不会影响快照，但也不会成为公共 API。
3. 若只想给仓内其它包使用，应走包内深路径或 workspace 依赖，而不是扩大公共面。

## 主入口导出速查表

以下符号均可 `import { ... } from 'infinitable'`。带「类型」的行只能以 `import type` 消费。

### render 层

| 符号                                                                     | 用途                                                               | 详细页面                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------- |
| `createRenderHost`                                                       | 创建 `RenderHost` 窄接口实例的唯一入口                             | [/api/render](/api/render) |
| `SceneNode`                                                              | 场景树节点基类，子类覆盖 `paint` 绘制内容                          | [/api/render](/api/render) |
| `RenderHostOptions`                                                      | `createRenderHost` 的构造参数（尺寸、dpr、容器、事件源、离屏注入） | [/api/render](/api/render) |
| `RenderHost`                                                             | 宿主窄接口：建层、提交失效、请求帧、文本测量、resize、destroy      | [/api/render](/api/render) |
| `LayerHandle`                                                            | 单层句柄：场景根、画布、`setSize`、`invalidate`                   | [/api/render](/api/render) |
| `LayerKind` / `LayerOpts`                                                | 层标识 `'ground' \| 'body' \| 'media' \| 'sky'` 与建层参数（含 `consumption` 失效消费策略） | [/api/render](/api/render) |
| `Invalidation`                                                           | 三档失效联合：`region` / `band` / `full`                           | [/api/render](/api/render) |
| `FrameTask`                                                              | 下一渲染帧执行一次的任务签名                                       | [/api/render](/api/render) |
| `SceneEvent` / `SceneEventType` / `SceneEventListener` / `SceneNodeInit` | 场景事件、事件类型、监听器与节点构造参数                           | [/api/render](/api/render) |
| `Region` / `Size`                                                        | 矩形与尺寸基础类型                                                 | [/api/render](/api/render) |
| `RenderContext` / `RenderCanvas` / `RenderImageSource`                   | 引擎使用的 2D 上下文、canvas 与位图源的最小子集                    | [/api/render](/api/render) |

### grid / table 层（值）

| 符号                 | 用途                                                                   | 详细页面                           |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| `ListTable`          | 表格主类：数据供给、虚拟滚动、选区、编辑、冻结、合并、媒体、插件挂载   | [/api/list-table](/api/list-table) |
| `SheetModel`         | 内置内存坐标模型，实现 `TableModel`，写值同步通知订阅者                | [/api/list-table](/api/list-table) |
| `EditorRegistry`     | 编辑器注册表与格级路由                                                 | [/api/grid-table](/api/grid-table)             |
| `extendsTheme`       | 基于默认主题或给定 base 深覆盖派生 `TableTheme`                        | [/api/grid-table](/api/grid-table)             |
| `projectCellStyle`   | 逐字段投影样式，边框逐边独立合并                                       | [/api/grid-table](/api/grid-table)             |
| `normalizeRange`     | 选区段归一化为 min/max 边界                                            | [/api/grid-table](/api/grid-table)             |
| `normalizeCellRange` | 合并区间归一化为 start ≤ end                                           | [/api/grid-table](/api/grid-table)             |
| `MergeCellMap`       | 合并区集合：覆盖查询、主格判定，构造时拒绝重叠                         | [/api/grid-table](/api/grid-table)             |
| `MergeOverlapError`  | 合并区重叠的具类型错误（`coord` / `range` / `existing`）               | [/api/grid-table](/api/grid-table)             |
| `sanitizeMerges`     | 归一化并消解重叠：保留先声明、丢弃冲突项，返回 `ranges` 与 `conflicts` | [/api/grid-table](/api/grid-table)             |
| `warnMergeConflicts` | 冲突的 console 提示工具，同一冲突只提示一次                            | [/api/grid-table](/api/grid-table)             |

### grid / table 层（类型）

| 符号                                                                                                                                    | 用途                                               | 详细页面                           |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| `ListTableOptions` / `ColumnDefine` / `DataRecord` / `TableModel` / `ResolveDisplayValue` / `CellChangeEvent` / `TableContextMenuEvent` | 表格构造、列定义、数据供给与基础事件载荷           | [/api/list-table](/api/list-table) |
| `GridCellRef`                                                                                                                           | grid 格坐标 `{ col, row }` 的消歧别名              | [/api/grid-table](/api/grid-table)             |
| `CellRange` / `MergeConflict` / `SanitizedMerges`                                                                                       | 合并区间、冲突详情与消解结果                       | [/api/grid-table](/api/grid-table)             |
| `CellStyle` / `CellBorder` / `CellBorderEdge`                                                                                           | 逐格样式与逐边边框                                 | [/api/grid-table](/api/grid-table)             |
| `TableTheme` / `ThemeOverride`                                                                                                          | 生效主题结构与深覆盖入参                           | [/api/grid-table](/api/grid-table)             |
| `RangeBounds` / `SelectionSnapshot` / `HighlightRange` / `FillDragEndEvent`                                                             | 选区边界、选区快照、宿主高亮区、填充柄拖拽结束载荷 | [/api/grid-table](/api/grid-table)             |
| `CellRenderer`                                                                                                                          | 自定义单元格渲染器                                 | [/api/grid-table](/api/grid-table)             |
| `UnderlayPainter` / `OverlayPainter`                                                                                                    | ground 层与 sky 层整层绘制预留位                   | [/api/grid-table](/api/grid-table)             |
| `LoadedImage` / `CellChartMedia`                                                                                                        | 加载完成的位图与格内图表媒体描述                   | [/api/grid-table](/api/grid-table)             |
| `FloatObject` / `FloatTransformEndEvent` / `FloatTransformHandle` / `FloatContextMenuEvent`                                             | 浮动对象、缩放/旋转手柄、变换结束与右键事件        | [/api/grid-table](/api/grid-table)             |
| `CellLink` / `CellLinkClickEvent` / `CellLinkHoverEvent` / `CellLinkLeaveEvent` / `ResolveCellLink`                                     | 单元格超链接描述、链接事件与按格链接 hook          | [/api/list-table](/api/list-table) |
| `ResolveCellImageLink` / `ImageLinkClickEvent` / `ImageLinkClickListener`                                                               | 嵌入图链接 hook 与图片链接点击事件                 | [/api/list-table](/api/list-table) |
| `TablePlugin`                                                                                                                           | 插件契约：`name` + `mount`（`EngineAssembly` 参数）+ 可选 `unmount` | [/api/grid-table](/api/grid-table)             |
| `EngineAssembly` / `TableEngine` / `EngineReadView`                                                                                      | 引擎装配协议面、表格引擎协议面与导出读取面（插件与适配层消费）      | [/api/list-table](/api/list-table)             |
| `CanvasDocSource`                                                                                                                       | 文档源注入形态（`ListTableOptions.doc`：无 DOM 环境构造出图）      | [/api/list-table](/api/list-table)             |
| `ScrollbarOptions` / `ScrollbarMode`                                                                                                    | 内建滚动条配置与形态（`'canvas' \| 'native'`）     | [/api/list-table](/api/list-table) |

### formulas 层（值）

| 符号                                                                                                                                 | 用途                                   | 详细页面                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------ |
| `colLetters`                                                                                                                         | 0 基列号转列字母（0 → `A`，26 → `AA`） | [/api/formulas](/api/formulas) |
| `parseCellRef` / `formatCellRef` / `formatRangeRef` / `createRangeRef`                                                               | A1 单元格/区间引用的解析与格式化       | [/api/formulas](/api/formulas) |
| `formulaError` / `isFormulaError` / `isFormulaErrorCode` / `FormulaParseError`                                                       | 公式错误值体系与解析错误               | [/api/formulas](/api/formulas) |
| `tokenText` / `parseFormula`                                                                                                         | 词法 token 文本与 Pratt 解析入口       | [/api/formulas](/api/formulas) |
| `astHasVolatileCall` / `collectAstReferences`                                                                                        | AST 静态分析：易变函数检测与引用收集   | [/api/formulas](/api/formulas) |
| `DependencyGraph`                                                                                                                    | 公式依赖图                             | [/api/formulas](/api/formulas) |
| `scanFormulaReferences`                                                                                                              | 容错引用扫描                           | [/api/formulas](/api/formulas) |
| `shiftFormulaText` / `shiftFormulaRefs`                                                                                              | 公式文本与引用的平移                   | [/api/formulas](/api/formulas) |
| `evaluate`                                                                                                                           | 公式求值器                             | [/api/formulas](/api/formulas) |
| `FORMULA_FUNCTION_CATEGORIES` / `getFormulaFunction` / `getFormulaFunctionInfo` / `listFormulaFunctions` / `registerFormulaFunction` | 函数分类与注册表读写                   | [/api/formulas](/api/formulas) |

### formulas 层（类型）

| 符号                                                                  | 用途                            | 详细页面                       |
| --------------------------------------------------------------------- | ------------------------------- | ------------------------------ |
| `CellRef` / `RangeRef` / `FormulaRefCoord` / `SheetCellCoord`         | A1 单元格与区间引用、坐标形态   | [/api/formulas](/api/formulas) |
| `FormulaError` / `ScalarValue`                                        | 错误值与标量值                  | [/api/formulas](/api/formulas) |
| `AstNode` / `ScannedReference` / `FormulaShiftResult`                 | AST、容错扫描结果、引用平移结果 | [/api/formulas](/api/formulas) |
| `FormulaEvalContext` / `FormulaResolver`                              | 求值上下文与宿主解析器          | [/api/formulas](/api/formulas) |
| `FormulaFunction` / `FormulaFunctionCategory` / `FormulaFunctionInfo` | 自定义函数与注册表元数据        | [/api/formulas](/api/formulas) |

### plugins 层

| 符号                                                                                                                                                                                                                                                    | 用途                                           | 详细页面                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------- |
| `createChartPlugin`                                                                                                                                                                                                                                     | 图表插件工厂（插件对象同时是运行时 handle）    | [/api/plugins](/api/plugins) |
| `createWatermarkPlugin`                                                                                                                                                                                                                                 | 水印插件工厂                                   | [/api/plugins](/api/plugins) |
| `createPrintPlugin`                                                                                                                                                                                                                                     | 打印插件工厂                                   | [/api/plugins](/api/plugins) |
| `createEnginePrintSource`                                                                                                                                                                                                                               | 引擎供数适配：`EngineAssembly.read` → `PrintSource` | [/api/plugins](/api/plugins) |
| `ChartPluginOptions` / `ChartPluginHandle` / `ChartCellDeclaration` / `ChartDatasetDeclaration` / `ChartDatasetSpec` / `ChartSpec` / `ChartSpecType` / `ChartType`                                                                                      | 图表插件配置、声明与 handle                    | [/api/plugins](/api/plugins) |
| `WatermarkHandle` / `WatermarkTextConfig`                                                                                                                                                                                                               | 水印 handle 与文本配置（打印水印共享同一模型） | [/api/plugins](/api/plugins) |
| `PrintPluginOptions` / `PrintPluginHandle` / `PrintConfig` / `PrintSource` / `PrintPaperPreset` / `PrintPaperSpec` / `PrintOrientation` / `PrintMargin` / `PrintScaleMode` / `PrintPagingMode` / `PrintHeaderFooterConfig` / `PrintHeaderFooterSection` | 打印配置、纸张预设、分页/缩放/页眉页脚         | [/api/plugins](/api/plugins) |

## `infinitable/sheet` 子路径速查表

子路径只转售 `@infinitable/sheet` 白名单，公式引擎不经此入口。完整签名见 [/api/sheet](/api/sheet)。

| 分组                      | 值                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 类型                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 地址系统                  | `cellKey`、`colIndexToName`、`colNameToIndex`、`parseAddress`、`formatAddress`、`createRange`、`parseRange`、`formatRange`、`rangesEqual`、`rangesIntersect`、`rangeContainsAddress`、`boundingBox`、`iterateRange`                                                                                                                                                                                                                                                       | `CellAddress`、`CellRange`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 单元格存储                | `NUMERIC_TEXT_RE`、`normalizeInputValue`、`inferCellType`、`isEmptyCellData`、`cellDataEqual`、`CellStore`                                                                                                                                                                                                                                                                                                                                                                | `CellType`、`CellValue`、`CellData`、`CellSnapshotItem`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 单元格元数据              | `cellMetaKey`、`cellMetaKeyFrom`、`cloneCellMetaPayload`、`cellMetaPayloadEqual`、`CellMetaStore`、`CELL_READONLY_META_NAMESPACE`、`CELL_IMAGE_META_NAMESPACE`、`CELL_LINK_META_NAMESPACE`                                                                                                                                                                                                                                                                                | `CellMetaSnapshotItem`、`CellImagePayload`、`CellLinkPayload`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 样式                      | `BORDER_SIDES`、`BORDER_STYLE_WIDTH`、`BORDER_EDGE_DEFAULTS`、`FONT_STYLE_KEYS`、`ALIGN_STYLE_KEYS`、`StylePool`、`composeCellStyles`、`buildBorderPresetItems`                                                                                                                                                                                                                                                                                                           | `BorderLineStyle`、`BorderSide`、`BorderEdge`、`HorizontalAlign`、`VerticalAlign`、`CellFont`、`CellAlign`、`CellStyle`、`StyleId`、`CellStylePatch`、`NumFmt`、`BorderPreset`、`BorderPresetItem`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 合并 / 选区 / 填充 / 查找 | `MergeManager`、`SelectionModel`、`computeFillTargetRange`、`generateFill`、`findAll`、`findNext`、`findNextFrom`、`findPrev`、`findPrevFrom`                                                                                                                                                                                                                                                                                                                             | `MergedCellKind`、`CellInfo`、`MergeResult`、`SelectionState`、`FillDirection`、`GenerateFillOptions`、`FindOptions`、`FindMatch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 模型与簿                  | `Sheet`、`Workbook`、`FormulaEngine`、`TypedEventEmitter`                                                                                                                                                                                                                                                                                                                                                                                                                 | `FrozenState`、`SheetSnapshot`、`SheetEvents`、`WorkbookEvents`、`AddSheetOptions`、`AddSheetCellInput`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 命令与撤销                | `HistoryManager`、`CommandRegistry`、`defaultCommandRegistry`、`SetCellValueCommand`、`SetCellFormulaCommand`、`SetCellStyleCommand`、`SetAxisStyleCommand`、`InsertCellsCommand`、`MergeCellsCommand`、`UnmergeCellsCommand`、`MergeCellsBatchCommand`、`InsertImageCommand`、`RemoveImageCommand`、`UpdateImageCommand`、`SetCellMetaCommand`、`ClearCellMetaCommand`、`SetCellLinkCommand`、`ClearCellLinkCommand`、`InsertCellImageCommand`、`RemoveCellImageCommand` | `HistoryState`、`PatchDirection`、`CellPatch`、`MergePatch`、`StructureChange`、`StructurePatch`、`SnapshotPatch`、`ImagePatch`、`CellMetaPatch`、`AxisStylePatch`、`Patch`、`Mutation`、`CommandResult`、`CommandContext`、`Command`、`SetCellValueItem`、`SetCellValueParams`、`SetCellFormulaParams`、`SetCellStyleItem`、`SetCellStyleParams`、`SetAxisStyleItem`、`SetAxisStyleParams`、`InsertCellsParams`、`MergeCellsParams`、`UnmergeCellsParams`、`MergeCellsBatchParams`、`InsertImageParams`、`RemoveImageParams`、`ImageUpdateFields`、`UpdateImageParams`、`SetCellMetaParams`、`ClearCellMetaParams`、`SetCellLinkParams`、`ClearCellLinkParams`、`InsertCellImageParams`、`RemoveCellImageParams` |
| 图片                      | `createImageId`、`cloneImageAnchor`、`cloneSheetImage`、`IMAGE_MIME`                                                                                                                                                                                                                                                                                                                                                                                                      | `SheetImageType`、`SheetImageAnchor`、`SheetImage`、`ImageInput`、`ImageFitMode`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| IO                        | `exportWorkbookXlsx`、`exportSheetXlsx`、`exportSheetCsv`、`importXlsx`、`importCsv`、`replaceWorkbookWithSnapshots`                                                                                                                                                                                                                                                                                                                                                      | `SheetReplaceItem`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| SheetGrid 适配            | `SheetGrid`                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `ResolveCellRenderer`、`SheetGridHighlight`、`SheetGridOptions`、`SelectionInterceptMeta`、`ScrollbarOptions`、`ResolveCellStyleHook`、`ResolveDisplayValue`、`SheetGridContextMenuInfo`、`SheetGridContextMenuKind`、`SheetGridHeaderOptions`、`GridCellEditor`、`GridEditorRect`、`GridEditorSession`、`SheetGridEditorsOptions`、`CellRenderer`、`CellRenderTarget`                                                                                                                                                                                                                                                                                                                                            |

::: tip
`infinitable/sheet` 的 `CellStyle`、`CellRange`、`CellRenderer`、`ScrollbarOptions` 与主入口同名但定义来源不同：子路径的类型来自 `@infinitable/sheet`，主入口的类型来自 grid / table。跨入口混用同名类型时以 `import type` 的显式来源为准。
:::

## `infinitable/pivot` 子路径速查表

子路径只转售 `@infinitable/pivot` 白名单。装配方式、领域操作与协议面见[透视表（pivot）](/guide/pivot)。

| 分组         | 值                                                                                             | 类型                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 引擎与模型   | `PivotGrid`、`PivotModel`                                                                      | `PivotGridOptions`、`PivotCellDrillEvent`、`PivotColumn`、`PivotRow`                             |
| 维度与度量   | —                                                                                              | `PivotDimension`、`PivotMeasure`、`PivotAggregator`、`PivotRecord`                               |
| 断言锚点常量 | `PIVOT_ROW_HEIGHT`、`PIVOT_HEADER_BACKGROUND`、`PIVOT_SUBTOTAL_BACKGROUND`、`PIVOT_GRAND_BACKGROUND` | —                                                                                               |

## 如何查类型

1. **先看本目录的分页**：每个模块页都有签名代码块与字段表，覆盖公共导出面。
2. **编辑器跳定义**：在 IDE 中对 `import type` 的符号执行「转到定义」，会落到 `packages/*/src/*.ts` 或构建后的 `.d.ts`。
3. **构建产物**：`packages/infinitable/dist` 下的类型声明与 `src/index.ts`、`src/sheet.ts` 同口径生成；两者出现差异时以源码为准。
4. **未导出的类型**：不要从包内深路径取。它们通常以实例方法签名或事件回调参数出现，直接按方法签名消费即可，例如：

| 未导出类型                                                                                | 在哪里出现                                            | 消费方式                                                 |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| `SelectionRange`                                                                          | `SelectionSnapshot.ranges`、`getSelectedCellRanges()` | 按 `{ start: { col, row }, end: { col, row } }` 结构读取 |
| `ScrollState`                                                                             | `getScrollState()`、`onScrollFrame` 载荷              | 读取 `{ left, top }`                                     |
| `WindowRange`                                                                             | `getVisibleRange()` 返回值                            | 读取 `{ start, end }`                                    |
| `EditStartEvent` / `EditEndEvent`                                                         | `onEditStart` / `onEditEnd` 载荷                      | 按事件字段解构                                           |
| `ColResizeEndEvent` / `RowResizeEndEvent`                                                 | `onColResizeEnd` / `onRowResizeEnd` 载荷              | 按 `{ col, width }` / `{ row, height }` 读取             |
| `FillHandleDownEvent` / `FillHandleDoubleClickEvent`                                      | 填充柄按下/双击载荷                                   | 读取 `{ range }`                                         |
| `ScrollManager` / `CellValuePipeline` / `ModelBinding` / `SelectionState` / `EditManager` | 引擎内部实现                                          | 经 `ListTable` 方法消费，不直接实例化                    |
| `ImageService` / `FloatObjectLayer`                                                       | `table.imageService` / `table.floatObjects`           | 经实例面方法消费                                         |
| `CellRenderTarget`                                                                        | `CellRenderer` 的入参                                 | 自定义渲染器按参数结构解构                               |
| `ImageServiceOptions`                                                                     | `ListTableOptions.imageServiceOptions`                | 按字段结构传对象                                         |
| `CellChartMediaSize`                                                                      | `CellChartMedia.produce(size)` 入参                   | 读取 `{ width, height, dpr }`                            |

::: warning
公共面以 `packages/infinitable/tests/public-surface.test.ts` 的快照为准。本页速查表与快照、源码三者不一致时，以源码与快照为准。
:::
