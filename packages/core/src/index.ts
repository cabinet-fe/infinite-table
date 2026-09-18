// 表格主体公共入口：公共 API 显式导出（禁止 export *）
export { ListTable } from './list-table'
export { ScrollManager } from './scroll-manager'
export type { ScrollDelta, ScrollListener, ScrollState } from './scroll-manager'
export { ModelBinding } from './model-binding'
export { SheetModel } from './sheet-model'
export { CellValuePipeline } from './cell-value'
export type { CellValuePipelineInit } from './cell-value'
export { CellNode } from './cell-node'
export type { CellNodeInit } from './cell-node'
export { MergeCellMap, normalizeCellRange, rangeContains, rangeCrossesBoundary } from './cell-range'
export type { CellRange } from './cell-range'
export { BUILTIN_CELL_RENDERERS, renderCheckboxCell, renderTextCell } from './cell-renderer'
export type { CellRenderTarget, CellRenderer, CellType, ResolveCellRenderer } from './cell-renderer'
export { projectCellStyle } from './cell-style'
export type {
  CellBorder,
  CellBorderEdge,
  CellBorderStyle,
  CellPadding,
  CellStyle,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
  ResolveCellStyle,
} from './cell-style'
export {
  clampFrozenCount,
  computeColOffsets,
  computeColWindow,
  computeRowOffsets,
  computeRowWindow,
  computeRowWindowFromOffsets,
  computeScrollableColWindow,
  computeScrollableRowWindow,
  computeScrollableRowWindowFromOffsets,
  findColAt,
  findRowAt,
  resolveCellX,
  resolveCellY,
  resolveCellYFromOffsets,
  unionRegions,
} from './grid-layout'
export type { WindowRange } from './grid-layout'
// 查询 API（getCellRelativeRect/getDrawRange）返回的矩形类型（渲染窄接口复用）
export type { Region } from '@infinite-table/render'
export { defaultTheme, extendsTheme } from './theme'
export type {
  CellStyleTokens,
  FrameStyle,
  InteractionTokens,
  TableTheme,
  ThemeOverride,
} from './theme'
export { EditorRegistry } from './editor-registry'
export type { CellEditor, EditorRoute } from './editor-registry'
export { EditManager } from './editing/edit-manager'
export type { EditCommitMove, EditManagerInit, EditWriteTarget } from './editing/edit-manager'
export { createTextEditor } from './editing/text-editor'
export type {
  EditorKeyEvent,
  TextEditor,
  TextEditorDoc,
  TextEditorElement,
  TextEditorElementStyle,
  TextEditorHost,
  TextEditorInit,
  TextEditorKeyAction,
} from './editing/text-editor'
export type { TablePlugin } from './plugin'
export { SelectionState, normalizeRange } from './selection'
export type { RangeBounds, SelectionListener, SelectionRange, SelectionSnapshot } from './selection'
export { HoverState } from './hover-state'
export type { HoverListener } from './hover-state'
export { InteractionOverlay } from './interaction-overlay'
export type { OverlayContent, OverlayGeometry, ResizeLine } from './interaction-overlay'
// 填充柄交互原语：画柄几何 + 命中 + 按下/拖拽结束两个公开事件（填充生成不在内核）
export { FILL_HANDLE_SIZE, fillHandleRect, hitFillHandle, resolveFocusRange } from './fill-handle'
export type {
  FillDragEndEvent,
  FillDragEndListener,
  FillHandleDownEvent,
  FillHandleDownListener,
} from './fill-handle'
export { nextActiveCell, revealAxis } from './keyboard-navigation'
export { hitResizeHandle, ResizeSession } from './resize'
export type {
  ColResizeEndEvent,
  ResizeCapability,
  ResizeGeometry,
  ResizeTarget,
  RowResizeEndEvent,
} from './resize'
export { InertiaScroller, TouchScrollTracker } from './touch-scroll'
export type { InertiaVelocity, ScrollDelta2D, TouchPoint } from './touch-scroll'
export type { ScrollFrameListener } from './list-table'
export { ImageService } from './media/image-service'
export type {
  ImageErrorEvent,
  ImageLoader,
  ImageLoadEvent,
  ImageServiceOptions,
  ImageState,
  LoadedImage,
} from './media/image-service'
export { MediaCache } from './media/media-cache'
export type { MediaCacheOptions } from './media/media-cache'
export { ImageCellNode } from './media/image-cell-node'
export type { ImageCellNodeInit } from './media/image-cell-node'
export type { ImageFit } from './media/draw-image'
export { FloatObjectLayer } from './float/float-object-layer'
export type { FloatGeometry, FloatObject, FloatObjectChange } from './float/float-object-layer'
export type {
  CellChangeEvent,
  CellRef,
  ColumnDefine,
  ContextMenuListener,
  DataRecord,
  EditEndEvent,
  EditStartEvent,
  ListTableOptions,
  ResolveCellImage,
  ResolveDisplayValue,
  TableContextMenuEvent,
  TableModel,
} from './types'
