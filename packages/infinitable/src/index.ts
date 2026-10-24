// 统一发布入口：单包显式转售五层公共 API（仓内按 workspace 分包开发，仅发布时合并）。
// 导出判据（逐项判定，全量清单与移出项过渡方案见 agent-docs/apis/exports.md）：
// 稳定公共 API（类型 / 配置 / 注册函数 / 插件接口 / 插件工厂）→ 导出；内部实现
// 细节、实验性 API、跨层内部工具 → 不导出。各层各自的 src/index.ts 已按同判据
// 先行收敛（子包公共面即红线文档面），本入口显式转售、不二次放大。
// 禁止星号导出（export star）：导出符号集合由 tests/public-surface.test.ts 快照冻结，
// 增删导出必须显式改快照。同源符号去重：RenderContext/Size（render 定义、
// table 亦转出）与 TablePlugin（table 定义、plugins 亦转出）各从定义包导出一次；
// CellRef 同名消歧见文件末尾。
// ./sheet 子路径（@infinitable/sheet 全量白名单）见 src/sheet.ts，不经本入口转售。

// ---- render 层（canvas 渲染引擎窄接口：宿主装配 / 场景树 / 层句柄与失效档）----
export { createRenderHost, SceneNode } from '@infinitable/render'
export type {
  FrameTask,
  Invalidation,
  LayerHandle,
  LayerKind,
  LayerOpts,
  Region,
  RenderCanvas,
  RenderContext,
  RenderHost,
  RenderHostOptions,
  RenderImageSource,
  SceneEvent,
  SceneEventListener,
  SceneNodeInit,
  SceneEventType,
  Size,
} from '@infinitable/render'

// ---- grid 层（共享网格内核：合并区 / 选区 / 主题与样式词汇 / 浮动对象 / 滚动条配置）----
export {
  MergeCellMap,
  MergeOverlapError,
  extendsTheme,
  normalizeCellRange,
  normalizeRange,
  sanitizeMerges,
  warnMergeConflicts,
} from '@infinitable/grid'
export type {
  CellBorder,
  CellBorderEdge,
  CellRange,
  CellStyle,
  FloatContextMenuEvent,
  FloatObject,
  FloatTransformEndEvent,
  FloatTransformHandle,
  LoadedImage,
  MergeConflict,
  RangeBounds,
  // 内建滚动条配置（ListTableOptions.scrollbar 对象形态；mode: 'native' 原生滚动条档）
  ScrollbarMode,
  ScrollbarOptions,
  SanitizedMerges,
  SelectionSnapshot,
  TableTheme,
  ThemeOverride,
} from '@infinitable/grid'

// ---- table 层（表格主体：主类 / 模型 / 编辑 / 媒体 / 插件契约 / 引擎装配协议）----
export { EditorRegistry, ListTable, SheetModel, projectCellStyle } from '@infinitable/table'
export type {
  // 文档源注入形态（ListTableOptions.doc：无 DOM 环境经它创建 canvas 构造出图）
  CanvasDocSource,
  CellChangeEvent,
  CellChartMedia,
  CellLink,
  CellLinkClickEvent,
  CellLinkHoverEvent,
  CellLinkLeaveEvent,
  CellRenderer,
  ColumnDefine,
  DataRecord,
  // 引擎装配协议（中立本体 / 可选导出读取面 / 表格引擎协议面，SheetGrid 等适配层消费）
  EngineAssembly,
  EngineReadView,
  FillDragEndEvent,
  HighlightRange,
  ImageLinkClickEvent,
  ImageLinkClickListener,
  ListTableOptions,
  OverlayPainter,
  ResolveCellImageLink,
  ResolveCellLink,
  ResolveDisplayValue,
  TableContextMenuEvent,
  TableEngine,
  TableModel,
  TablePlugin,
  UnderlayPainter,
} from '@infinitable/table'

// ---- formulas 层（公式引擎：A1 地址 / 解析与求值 / 函数注册表 / 依赖图 / 引用平移）----
export {
  DependencyGraph,
  FormulaParseError,
  FORMULA_FUNCTION_CATEGORIES,
  astHasVolatileCall,
  collectAstReferences,
  colLetters,
  createRangeRef,
  evaluate,
  formulaError,
  formatCellRef,
  formatRangeRef,
  getFormulaFunction,
  getFormulaFunctionInfo,
  isFormulaError,
  isFormulaErrorCode,
  listFormulaFunctions,
  parseCellRef,
  parseFormula,
  registerFormulaFunction,
  scanFormulaReferences,
  shiftFormulaRefs,
  shiftFormulaText,
  tokenText,
} from '@infinitable/formulas'
export type {
  AstNode,
  FormulaError,
  FormulaEvalContext,
  FormulaFunction,
  FormulaFunctionCategory,
  FormulaFunctionInfo,
  FormulaRefCoord,
  FormulaResolver,
  FormulaShiftResult,
  RangeRef,
  ScalarValue,
  ScannedReference,
  SheetCellCoord,
} from '@infinitable/formulas'

// ---- plugins 层（官方插件工厂与配置：chart / watermark / print；print 的引擎
// 供数适配 createEnginePrintSource 面向装配协议导出读取面，供宿主直接打印引擎实例）----
export {
  createChartPlugin,
  createEnginePrintSource,
  createPrintPlugin,
  createWatermarkPlugin,
} from '@infinitable/plugins'
export type {
  ChartCellDeclaration,
  ChartDatasetDeclaration,
  ChartDatasetSpec,
  ChartPluginHandle,
  ChartPluginOptions,
  ChartSpec,
  ChartSpecType,
  ChartType,
  PrintConfig,
  PrintHeaderFooterConfig,
  PrintHeaderFooterSection,
  PrintMargin,
  PrintOrientation,
  PrintPagingMode,
  PrintPaperPreset,
  PrintPaperSpec,
  PrintPluginHandle,
  PrintPluginOptions,
  PrintScaleMode,
  PrintSource,
  WatermarkHandle,
  WatermarkTextConfig,
} from '@infinitable/plugins'

// ---- 同名消歧 ----
// grid 的格坐标 CellRef 与 formulas 的 A1 引用 CellRef 同名：A1 引用保留原名（配
// parseCellRef/formatCellRef/createRangeRef），格坐标以 GridCellRef 别名导出。
export type { CellRef } from '@infinitable/formulas'
export type { CellRef as GridCellRef } from '@infinitable/grid'
