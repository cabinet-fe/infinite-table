// 表格主体公共入口：公共 API 显式导出（禁止 export *）。
// 导出判据：仓内非测试消费（playground / plugins 源码 / 跨包公共入口）或
// docs/plugin-interface-map.md 红线面；布局 / 交互 / 滚动等内部原语经包内深路径消费，不占公共面。
export { ListTable } from './list-table'
export { SheetModel } from './sheet-model'
export { normalizeCellRange } from './cell-range'
export type { CellRange } from './cell-range'
export type { CellRenderer } from './cell-renderer'
export { projectCellStyle } from './cell-style'
export type { CellBorder, CellBorderEdge, CellStyle } from './cell-style'
export { extendsTheme } from './theme'
export type { TableTheme, ThemeOverride } from './theme'
export { EditorRegistry } from './editor-registry'
export type { TablePlugin } from './plugin'
export { normalizeRange } from './selection'
export type { RangeBounds, SelectionSnapshot } from './selection'
export type { HighlightRange } from './interaction-overlay'
// 填充柄拖拽结束事件（onFillDragEnd 回调入参形态；填充生成不在内核）
export type { FillDragEndEvent } from './fill-handle'
// ground / sky 整层绘制预留位（水印等 underlay/overlay 绘制方挂点）：painter 类型
// + 其收到的绘制上下文与视口尺寸（渲染窄接口复用转出，消费方零引擎内部依赖）
export type { UnderlayPainter } from './list-table'
export type { OverlayPainter } from './list-table'
export type { RenderContext, Size } from '@infinitable/render'
export type { LoadedImage } from './media/image-service'
export type {
  FloatObject,
  FloatTransformEndEvent,
  FloatTransformHandle,
} from './float/float-object-layer'
export type {
  CellChangeEvent,
  // 格坐标类型（infinitable 聚合包以 GridCellRef 消歧转出）
  CellRef,
  CellChartMedia,
  ColumnDefine,
  DataRecord,
  ListTableOptions,
  ResolveDisplayValue,
  // 内建滚动条配置（ListTableOptions.scrollbar 的对象形态）
  ScrollbarOptions,
  TableContextMenuEvent,
  TableModel,
} from './types'
