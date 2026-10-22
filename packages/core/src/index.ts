// 拆分中间态薄壳：原 @infinitable/core 公共面全量显式转售 @infinitable/table 与
// @infinitable/grid，符号集合不变，未迁移消费者（sheet/plugins/playground/website/
// infinitable）零改动继续编译。薄壳不出仓、不发版，消费者迁移完成后即删（非兼容层）；
// 禁止 export *。领域符号自 table 转出；合并/选区/主题/滚动条配置/浮动对象等网格
// 词汇自 grid 转出（table 公共入口转售同源符号，两路同源不歧义）。
export { ListTable, SheetModel, projectCellStyle, EditorRegistry } from '@infinitable/table'
export type {
  CellChangeEvent,
  // 格坐标类型（infinitable 聚合包以 GridCellRef 消歧转出）
  CellChartMedia,
  CellLink,
  CellLinkClickEvent,
  CellLinkHoverEvent,
  CellLinkLeaveEvent,
  CellRenderer,
  ColumnDefine,
  DataRecord,
  FillDragEndEvent,
  HighlightRange,
  ImageLinkClickEvent,
  ImageLinkClickListener,
  ListTableOptions,
  OverlayPainter,
  RenderContext,
  ResolveCellImageLink,
  ResolveCellLink,
  ResolveDisplayValue,
  Size,
  TableContextMenuEvent,
  TableModel,
  TablePlugin,
  UnderlayPainter,
} from '@infinitable/table'
export { normalizeCellRange } from '@infinitable/grid'
export {
  MergeCellMap,
  MergeOverlapError,
  sanitizeMerges,
  warnMergeConflicts,
} from '@infinitable/grid'
export type { CellRange, MergeConflict, SanitizedMerges } from '@infinitable/grid'
export type { CellBorder, CellBorderEdge, CellStyle } from '@infinitable/grid'
export { extendsTheme } from '@infinitable/grid'
export type { TableTheme, ThemeOverride } from '@infinitable/grid'
export { normalizeRange } from '@infinitable/grid'
export type { RangeBounds, SelectionSnapshot } from '@infinitable/grid'
// 内建滚动条配置（ListTableOptions.scrollbar 的对象形态；mode: 'native' 启用浏览器原生滚动条）
export type { CellRef, ScrollbarMode, ScrollbarOptions } from '@infinitable/grid'
export type {
  FloatContextMenuEvent,
  FloatObject,
  FloatTransformEndEvent,
  FloatTransformHandle,
} from '@infinitable/grid'
export type { LoadedImage } from '@infinitable/grid'
