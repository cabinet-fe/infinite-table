// 共享网格内核公共入口：公共 API 显式导出（禁止 export *）。
// 导出判据：与拆分前 core 公共面同集合（合并/选区/主题/滚动条配置/格坐标/样式词汇/
// 浮动对象形态）或跨包消费（table 引擎装配及包内测试）所需词汇；grid 不提供深路径
// 导出，滚动源、布局纯函数族、滚动条装配等原语同样经此公共面消费。
export { cellKey, normalizeCellRange, rangeCrossesBoundary } from './cell-range'
export { MergeCellMap, sanitizeMerges, warnMergeConflicts } from './cell-range'
export { MergeOverlapError } from './cell-range'
export type { CellRange, MergeConflict, SanitizedMerges } from './cell-range'
export type {
  CellBorder,
  CellBorderStyle,
  CellBorderEdge,
  CellPadding,
  CellStyle,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
} from './cell-style'
export {
  clampFrozenCount,
  computeColOffsets,
  computeRowOffsets,
  computeScrollableColWindow,
  computeScrollableRowWindowFromOffsets,
  expandWindowRange,
  findColAt,
  findRowAt,
  resolveCellX,
  resolveCellYFromOffsets,
  spanHeight,
  spanWidth,
  unionRegions,
} from './grid-layout'
export type { WindowRange } from './grid-layout'
export { ScrollManager } from './scroll-manager'
export type { ScrollDelta, ScrollState } from './scroll-manager'
export {
  hitScrollbar,
  mapScrollbarThumbDrag,
  mapScrollbarTrackPoint,
  MIN_SCROLLBAR_THUMB_PX,
  planScrollbarThumb,
  resolveScrollbarConfig,
  scrollbarThumbThickness,
} from './scrollbar'
export type {
  ScrollbarAxisView,
  ScrollbarConfig,
  ScrollbarDragSession,
  ScrollbarHit,
  ScrollbarThumbGeometry,
} from './scrollbar'
export { NativeScrollbarHost } from './native-scrollbar'
export { InertiaScroller, TouchScrollTracker } from './touch-scroll'
export { normalizeRange, SelectionState } from './selection'
export type { RangeBounds, SelectionListener, SelectionRange, SelectionSnapshot } from './selection'
export { resolveSharedEdges, strongerEdge } from './shared-edges'
export { defaultTheme, extendsTheme, opaqueHeaderHighlight, themeCellBase } from './theme'
export type { FrameStyle, InteractionTokens, TableTheme, ThemeOverride } from './theme'
export type { CellRef, ScrollbarMode, ScrollbarOptions } from './types'
export { FloatObjectLayer } from './float/float-object-layer'
export type {
  FloatContextMenuEvent,
  FloatDragEndEvent,
  FloatObject,
  FloatTransformEndEvent,
  FloatTransformHandle,
} from './float/float-object-layer'
export {
  bodyViewportClip,
  drawFittedImage,
  fittedRect,
  MEDIA_CELL_BACKGROUND,
  paintImagePlaceholder,
} from './media/draw-image'
export type { ImageFit } from './media/draw-image'
export { ImageService } from './media/image-service'
export type { ImageLoadEvent, ImageServiceOptions, LoadedImage } from './media/image-service'
