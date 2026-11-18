// ListTable 引擎公共入口：公共 API 显式导出（禁止 export *）。
export { ListTable } from './list-table'
export type { ScrollFrameListener } from './list-table'
export { SheetModel } from './sheet-model'
export {
  MergeCellMap,
  MergeOverlapError,
  normalizeCellRange,
  normalizeRange,
  sanitizeMerges,
  warnMergeConflicts,
  extendsTheme,
} from '@infinitable/grid'
export type {
  CellRange,
  FloatTransformHandle,
  LoadedImage,
  MergeConflict,
  RangeBounds,
  SanitizedMerges,
  SelectionSnapshot,
  TableTheme,
  ThemeOverride,
} from '@infinitable/grid'
export type { CellRenderer, CellRenderTarget, ResolveCellRenderer } from './cell-renderer'
export { projectCellStyle } from './cell-style'
export type { CellBorder, CellBorderEdge, CellStyle } from './cell-style'
export { EditorRegistry } from './editor-registry'
export type { CellEditor, CellEditorSession } from './editor-registry'
export type { EditCommitMove } from './editing/edit-manager'
export type {
  EngineAssembly,
  EngineCapabilities,
  EnginePlugin,
  GridReadView,
  LayerPainter,
  PainterRegistration,
  PainterSlot,
} from '@infinitable/protocol'
export type { TableEngine } from './engine'
export type { HighlightRange } from './interaction-overlay'
export type { FillDragEndEvent } from './fill-handle'
export type { RenderContext, Size } from '@infinitable/render'
export { FloatObjectLayer } from './float/float-object-layer'
export type {
  FloatContextMenuEvent,
  FloatDragEndEvent,
  FloatObject,
  FloatTransformEndEvent,
} from './float/float-object-layer'
export type {
  CanvasDocSource,
  CellAddress,
  CellChangeEvent,
  CellChartMedia,
  CellLink,
  CellLinkClickEvent,
  CellLinkHoverEvent,
  CellLinkLeaveEvent,
  ColHeaderClickEvent,
  ColHeaderClickListener,
  ColumnDefine,
  DataRecord,
  ImageLinkClickEvent,
  ImageLinkClickListener,
  ListTableOptions,
  ResolveCellChart,
  ResolveCellImage,
  ResolveCellImageFit,
  ResolveCellImageLink,
  ResolveCellLink,
  ResolveDisplayValue,
  ScrollbarMode,
  ScrollbarOptions,
  TableContextMenuEvent,
  TableModel,
} from './types'
