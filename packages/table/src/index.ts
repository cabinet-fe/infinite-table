// ListTable 引擎公共入口：公共 API 显式导出（禁止 export *）。
// 导出判据：仓内非测试消费（playground / plugins 源码 / 跨包公共入口）或
// docs/plugin-interface-map.md 红线面；布局 / 交互 / 滚动等内部原语经包内深路径消费，不占公共面。
// 自 core 拆出（领域代码原样搬运），原 core 公共面符号集合不变：
// 通用网格机器（滚动/几何/选区/共享边/主题投影/浮动层/合并区）经 @infinitable/grid 转出，
// 渲染窄接口词汇（RenderContext/Size）经 @infinitable/render 转出。
export { ListTable } from './list-table'
export { SheetModel } from './sheet-model'
export { normalizeCellRange } from '@infinitable/grid'
export {
  MergeCellMap,
  MergeOverlapError,
  sanitizeMerges,
  warnMergeConflicts,
} from '@infinitable/grid'
export type { CellRange, MergeConflict, SanitizedMerges } from '@infinitable/grid'
export type { CellRenderer } from './cell-renderer'
export { projectCellStyle } from './cell-style'
export type { CellBorder, CellBorderEdge, CellStyle } from './cell-style'
export { extendsTheme } from '@infinitable/grid'
export type { TableTheme, ThemeOverride } from '@infinitable/grid'
export { EditorRegistry } from './editor-registry'
export type { TablePlugin } from './plugin'
// 引擎装配协议（P7）：中立本体（EngineAssembly，四类平级引擎的公共装配路径）+
// 导出读取面（EngineReadView）+ 表格引擎协议面（TableEngine，领域公共操作增量，
// SheetGrid 等适配层消费）；ListTable 为协议的 table 引擎实现
export type { EngineAssembly, EngineReadView, TableEngine } from './engine'
export { normalizeRange } from '@infinitable/grid'
export type { RangeBounds, SelectionSnapshot } from '@infinitable/grid'
export type { HighlightRange } from './interaction-overlay'
// 填充柄拖拽结束事件（onFillDragEnd 回调入参形态；填充生成不在内核）
export type { FillDragEndEvent } from './fill-handle'
// ground / sky 整层绘制预留位（水印等 underlay/overlay 绘制方挂点）：painter 类型
// + 其收到的绘制上下文与视口尺寸（渲染窄接口复用转出，消费方零引擎内部依赖）
export type { UnderlayPainter } from './list-table'
export type { OverlayPainter } from './list-table'
export type { RenderContext, Size } from '@infinitable/render'
export type { LoadedImage } from '@infinitable/grid'
export type {
  FloatContextMenuEvent,
  FloatObject,
  FloatTransformEndEvent,
  FloatTransformHandle,
} from '@infinitable/grid'
export type {
  CellChangeEvent,
  // 格坐标类型（infinitable 聚合包以 GridCellRef 消歧转出）
  CellRef,
  CellChartMedia,
  CellLink,
  CellLinkClickEvent,
  CellLinkHoverEvent,
  CellLinkLeaveEvent,
  ColumnDefine,
  DataRecord,
  ImageLinkClickEvent,
  ImageLinkClickListener,
  ListTableOptions,
  ResolveCellImageLink,
  ResolveCellLink,
  ResolveDisplayValue,
  // 内建滚动条配置（ListTableOptions.scrollbar 的对象形态；mode: 'native' 启用浏览器原生滚动条）
  ScrollbarOptions,
  ScrollbarMode,
  TableContextMenuEvent,
  TableModel,
} from './types'
