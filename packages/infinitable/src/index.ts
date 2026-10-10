// 统一发布入口：单包显式转售四层公共 API（仓内按 workspace 分包开发，仅发布时合并）。
// 导出判据（逐项判定，全量清单与移出项过渡方案见 agent-docs/apis/exports.md）：
// 稳定公共 API（类型 / 配置 / 注册函数 / 插件接口 / 插件工厂）→ 导出；内部实现
// 细节、实验性 API、跨层内部工具 → 不导出。四层各自的 src/index.ts 已按同判据
// 先行收敛（子包公共面即红线文档面），本入口显式转售、不二次放大。
// 禁止星号导出（export star）：导出符号集合由 tests/public-surface.test.ts 快照冻结，
// 增删导出必须显式改快照。同源符号去重：RenderContext/Size（render 定义、
// core 亦转出）与 TablePlugin（core 定义、plugins 亦转出）各从定义包导出一次；
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

// ---- core 层（表格主体：主类 / 模型 / 主题与样式 / 选区 / 编辑 / 媒体与浮动层）----
export {
  EditorRegistry,
  ListTable,
  SheetModel,
  extendsTheme,
  normalizeCellRange,
  normalizeRange,
  projectCellStyle,
} from '@infinitable/core'
export type {
  CellBorder,
  CellBorderEdge,
  CellChangeEvent,
  CellChartMedia,
  CellRange,
  CellRenderer,
  CellStyle,
  ColumnDefine,
  DataRecord,
  FillDragEndEvent,
  FloatObject,
  FloatTransformEndEvent,
  FloatTransformHandle,
  HighlightRange,
  ListTableOptions,
  LoadedImage,
  OverlayPainter,
  RangeBounds,
  ResolveDisplayValue,
  // 内建滚动条配置（ListTableOptions.scrollbar 对象形态；mode: 'native' 原生滚动条档）
  ScrollbarMode,
  ScrollbarOptions,
  SelectionSnapshot,
  TableContextMenuEvent,
  TableModel,
  TablePlugin,
  TableTheme,
  ThemeOverride,
  UnderlayPainter,
} from '@infinitable/core'

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
  ScalarValue,
  SheetCellCoord,
} from '@infinitable/formulas'

// ---- plugins 层（官方插件工厂与配置：chart / watermark / print）----
export { createChartPlugin, createPrintPlugin, createWatermarkPlugin } from '@infinitable/plugins'
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
  PrintImagePayload,
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
// core 的格坐标 CellRef 与 formulas 的 A1 引用 CellRef 同名：A1 引用保留原名（配
// parseCellRef/formatCellRef/createRangeRef），格坐标以 GridCellRef 别名导出。
export type { CellRef } from '@infinitable/formulas'
export type { CellRef as GridCellRef } from '@infinitable/core'
