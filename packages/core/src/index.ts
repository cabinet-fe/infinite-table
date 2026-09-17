import { RENDER_PACKAGE_NAME } from '@infinite-table/render'

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
export type { CellBorder, CellBorderEdge, CellStyle, ResolveCellStyle } from './cell-style'
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
export { defaultTheme, extendsTheme } from './theme'
export type { CellStyleTokens, TableTheme, ThemeOverride } from './theme'
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
export { nextActiveCell, revealAxis } from './keyboard-navigation'
export { hitResizeHandle, ResizeSession } from './resize'
export type { ResizeCapability, ResizeGeometry, ResizeTarget } from './resize'
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
  ListTableOptions,
  ResolveCellImage,
  ResolveDisplayValue,
  TableContextMenuEvent,
  TableModel,
} from './types'

export const CORE_PACKAGE_NAME = '@infinite-table/core'

// 依赖边占位：core → render
export const CORE_DEPENDENCY_CHAIN = `${CORE_PACKAGE_NAME} -> ${RENDER_PACKAGE_NAME}`
