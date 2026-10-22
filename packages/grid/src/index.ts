// 共享网格内核公共入口：公共 API 显式导出（禁止 export *）。
// 导出判据：与拆分前 core 公共面同集合（合并/选区/主题/滚动条配置/格坐标/样式词汇/
// 浮动对象形态）或跨包消费所需词汇；滚动源、布局纯函数族、滚动条装配等内部原语
// 经包内深路径消费（@infinitable/grid/src/<module>），不占公共面。
export { normalizeCellRange } from './cell-range'
export { MergeCellMap, MergeOverlapError, sanitizeMerges, warnMergeConflicts } from './cell-range'
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
export { normalizeRange } from './selection'
export type { RangeBounds, SelectionSnapshot } from './selection'
export { extendsTheme } from './theme'
export type { TableTheme, ThemeOverride } from './theme'
export type { CellRef, ScrollbarMode, ScrollbarOptions } from './types'
export type {
  FloatContextMenuEvent,
  FloatObject,
  FloatTransformEndEvent,
  FloatTransformHandle,
} from './float/float-object-layer'
export type { LoadedImage } from './media/image-service'
