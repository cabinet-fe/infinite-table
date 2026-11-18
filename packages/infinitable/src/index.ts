// 统一发布入口：单包显式转售六层公共 API（含纯类型的引擎装配协议层）（仓内按 workspace 分包开发，仅发布时合并）。
// 导出判据（逐项判定，全量清单与移出项过渡方案见 agent-docs/apis/exports.md）：
// 稳定公共 API（类型 / 配置 / 注册函数 / 插件接口 / 插件工厂）→ 导出；内部实现
// 细节、实验性 API、跨层内部工具 → 不导出。各层各自的 src/index.ts 已按同判据
// 先行收敛（子包公共面即红线文档面），本入口显式转售、不二次放大。
// 禁止星号导出（export star）：导出符号集合由 tests/public-surface.test.ts 快照冻结，
// 增删导出必须显式改快照。同源符号去重：RenderContext/Size（render 定义、
// table 亦转出）与 EnginePlugin（protocol 定义、table/plugins 亦转出）各从定义包导出一次；
// CellRef 同名消歧见文件末尾。
// ./sheet 子路径（@infinitable/sheet 全量白名单）见 src/sheet.ts，不经本入口转售。

// ---- render 层（canvas 渲染引擎窄接口：宿主装配 / 场景树 / 层句柄与失效档）----
export {
  createRenderHost,
  // 命令式路径助手：RenderContext 无 setLineDash/roundRect 的 overlay painter 消费者直用
  dashedLine,
  roundRectPath,
  SceneNode,
} from '@infinitable/render'
export type {
  CanvasFactory,
  DashLineContext,
  DashPattern,
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
  RoundRectPathContext,
  SceneEvent,
  SceneEventListener,
  SceneNodeInit,
  SceneEventType,
  Size,
} from '@infinitable/render'

// ---- grid 层（共享网格内核：合并区 / 选区 / 主题与样式词汇 / 浮动对象 / 区域交互几何 / 滚动条配置）----
export {
  MergeCellMap,
  MergeOverlapError,
  REGION_EDGE_HIT_PX,
  REGION_HANDLE_INSET,
  REGION_HANDLE_SIZE,
  REGION_HANDLE_SIZE_ACTIVE,
  cellKey,
  cursorForEdge,
  extendsTheme,
  floatHandleEdge,
  hitRegionEdge,
  hitRegionHandle,
  normalizeCellRange,
  normalizeRange,
  regionBoundsOf,
  regionHandleRect,
  resizeRegionRect,
  sanitizeMerges,
  warnMergeConflicts,
} from '@infinitable/grid'
export type {
  CellBorder,
  CellBorderEdge,
  CellRange,
  CellRectSource,
  CellStyle,
  FloatAnchor,
  FloatGeometry,
  FloatTransformHandle,
  LoadedImage,
  MergeConflict,
  RangeBounds,
  RegionHitTarget,
  RegionRect,
  ResizeEdge,
  // 内建滚动条配置（ListTableOptions.scrollbar 对象形态；mode: 'native' 原生滚动条档）
  ScrollbarMode,
  ScrollbarOptions,
  SanitizedMerges,
  SelectionSnapshot,
  TableTheme,
  ThemeOverride,
} from '@infinitable/grid'

// ---- protocol 层（引擎装配协议：四类平级引擎的公共装配契约，纯类型零运行时）----
export type {
  CellAddress,
  CellChangeEvent,
  EngineAssembly,
  EngineCapabilities,
  EngineFrameStyle,
  EnginePlugin,
  EngineScrollbarTokens,
  EngineTheme,
  EngineThemeOverride,
  GridDataModel,
  GridReadView,
  LayerPainter,
  PainterRegistration,
  PainterSlot,
  WritableGridDataModel,
} from '@infinitable/protocol'

// ---- table 层（表格主体：主类 / 模型 / 编辑 / 媒体 / 表格引擎协议面）----
export { EditorRegistry, ListTable, SheetModel, projectCellStyle } from '@infinitable/table'
export type {
  // 文档源注入形态（ListTableOptions.doc：无 DOM 环境经它创建 canvas 构造出图）
  BottomCellClickEvent,
  BottomCellClickListener,
  CanvasDocSource,
  CellChartMedia,
  CellEditor,
  CellEditorSession,
  CellLink,
  CellLinkClickEvent,
  CellLinkHoverEvent,
  CellLinkLeaveEvent,
  CellRenderer,
  ColHeaderClickEvent,
  ColHeaderClickListener,
  ColHeaderHitRegion,
  ColumnDefine,
  DataRecord,
  FillDragEndEvent,
  FloatContextMenuEvent,
  FloatDragEndEvent,
  FloatObject,
  FloatTransformEndEvent,
  HighlightRange,
  ImageLinkClickEvent,
  ImageLinkClickListener,
  ListTableOptions,
  ResolveBottomCellRenderer,
  ResolveBottomCellStyle,
  ResolveBottomRowHeaderRenderer,
  ResolveBottomRowHeaderStyle,
  ResolveCellImageLink,
  ResolveCellLink,
  ResolveColHeaderRegions,
  ResolveColHeaderStyle,
  ResolveDisplayValue,
  TableContextMenuEvent,
  TableEngine,
  TableModel,
} from '@infinitable/table'

// ---- formulas 层（公式引擎：A1 地址 / 解析与求值 / 函数注册表 / 依赖图 / 引用平移）----
export {
  DependencyGraph,
  FormulaLookupCache,
  FormulaParseError,
  FORMULA_FUNCTION_CATEGORIES,
  astHasVolatileCall,
  collectAstReferences,
  colLetters,
  createRangeRef,
  evaluate,
  evaluateAst,
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
  CellRef,
  EvalValue,
  ExactLookupIndex,
  FormulaError,
  FormulaEvalContext,
  FormulaEvaluateOptions,
  FormulaFunction,
  FormulaFunctionCategory,
  FormulaFunctionInfo,
  FormulaFunctionOverrides,
  FormulaRefCoord,
  FormulaResolver,
  FormulaShiftResult,
  RangeRef,
  ScalarValue,
  ScannedReference,
  SheetCellCoord,
} from '@infinitable/formulas'

// ---- plugins 层（官方插件工厂与配置：chart / watermark / print；print 通过协议
// 契约 GridReadView 直接读取引擎视图面，供宿主或协议插件打印引擎实例）----
export {
  createChartPlugin,
  createPrintPlugin,
  createWatermarkPlugin,
  // 纸张可打印区推导（mm → px）：宿主侧纸张/分页几何与 print 插件同口径
  derivePrintableArea,
} from '@infinitable/plugins'
export type {
  ChartCellDeclaration,
  ChartCellMedia,
  ChartCellMediaSize,
  ChartDatasetDeclaration,
  ChartDatasetSpec,
  ChartPluginHandle,
  ChartPluginOptions,
  ChartSpec,
  ChartSpecType,
  ChartType,
  PrintableArea,
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
  WatermarkHandle,
  WatermarkPluginOptions,
  WatermarkTextConfig,
} from '@infinitable/plugins'
