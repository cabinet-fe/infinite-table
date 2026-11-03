// 表格引擎协议面：TableEngine——中立本体 EngineAssembly（@infinitable/protocol，
// P7）的表格领域增量（G17：领域需求由 table 公共面增量承载而非协议特例）。
// 全部成员是 ListTable 既有公共 API 的签名集合——sheet 的 SheetGrid 等适配层经
// 本面消费 table 引擎，不触碰具体类；表头层级装配、按格可替换渲染器（G8 扩展缝，
// 构造面 resolveCellRenderer）、行号列等领域概念只出现在本面之下的实现侧，
// 本面仅收敛适配层实际消费的操作签名。

import type {
  CellRange,
  CellRef,
  FloatObjectLayer,
  ImageService,
  SelectionSnapshot,
  WindowRange,
} from '@infinitable/grid'
import type { Region } from '@infinitable/render'
import type { EngineAssembly } from '@infinitable/protocol'

import type { ScrollFrameListener } from './list-table'
import type { ColumnDefine, ContextMenuListener, EditEndEvent, EditStartEvent } from './types'
import type { FillDragEndListener } from './fill-handle'
import type { HighlightRange } from './interaction-overlay'

/**
 * 表格引擎协议面：EngineAssembly + 表格领域公共操作（中立本体的 table 实现）。
 * sheet 的 SheetGrid、透视的 PivotGrid 等适配层经本面消费 table 引擎。
 */
export interface TableEngine extends EngineAssembly {
  // ---- 视口与几何 ----
  /** 表视口宽（CSS 像素；构造后经 resize 原地调整） */
  readonly width: number
  /** 表视口高（CSS 像素） */
  readonly height: number
  /** 列头带高（showColHeader 关闭时为 0） */
  readonly headerHeight: number
  /** 数据列数（setColCount 增删列即时反映） */
  readonly colCount: number
  /** 原地调整视口尺寸（滚动位置与选区保留） */
  resize(width: number, height: number): void
  /** 列宽读取（CSS 像素） */
  getColWidth(col: number): number
  /** 运行时修改列宽 */
  setColWidth(col: number, width: number): void
  /** 行高读取（含逐行覆盖） */
  getRowHeight(row: number): number
  /** 运行时修改行高 */
  setRowHeight(row: number, height: number): void
  /** 运行时修改行数（无限滚动 / 动态增长） */
  setRowCount(count: number): void
  /** 运行时修改列数（增出列回落列定义模板与 resolveColTitle） */
  setColCount(count: number, template?: ColumnDefine): void
  /** 批量更新：fn 内多次变更合并为一次失效提交 */
  batchUpdate(fn: () => void): void
  /** 局部刷新单格（窗外格安全跳过；被合并覆盖坐标路由主格） */
  refreshCell(col: number, row: number): void

  // ---- 滚动与命中 ----
  /** 相对滚动（自动夹取到边界） */
  scrollBy(dx: number, dy: number): void
  getScrollLeft(): number
  getScrollTop(): number
  /** 滚动到目标格完整可见 */
  scrollToCell(cell: CellRef): void
  /** 画布内容区矩形（扣除行列头后的数据区可绘制范围） */
  getDrawRange(): Region
  /** 当前可视数据格范围（[start, end)，冻结行列并入可视范围） */
  getBodyVisibleCellRange(): { rows: WindowRange; cols: WindowRange }
  /** 数据格视口矩形（CSS 像素）；窗口外返回 null */
  getCellRelativeRect(col: number, row: number): Region | null
  /** 视口坐标命中的数据格；行列头 / 空白返回 null */
  getCellAtRelativePosition(x: number, y: number): CellRef | null
  /** 是否装配了浏览器原生滚动条（宿主滚轮接线让位判定） */
  readonly usesNativeScrollbar: boolean

  // ---- 冻结与合并 ----
  getFrozenColCount(): number
  getFrozenRowCount(): number
  setFrozenColCount(count: number): void
  setFrozenRowCount(count: number): void
  /** 运行时整体替换合并区（重叠项规范化，跨冻结边界合法） */
  setMergeCells(ranges: readonly CellRange[]): void

  // ---- 选区 ----
  /** 全选（数据区） */
  selectAll(): void
  /** 外部选区回写（段边界钳制到数据区，不广播防回环） */
  applyExternalSelection(snapshot: SelectionSnapshot): void
  /** 订阅选区变更；返回退订函数 */
  onSelectionChange(listener: (snapshot: SelectionSnapshot) => void): () => void
  /** 选区锚点（编辑拾取等会话的持续绘制锚；null 清除） */
  setSelectionAnchor(anchor: CellRef | null): void
  /** 宿主高亮区域（公式引用染色框等）；空数组清除 */
  setHighlightRanges(ranges: readonly HighlightRange[]): void
  /** 订阅填充柄拖拽结束事件（填充生成不在内核） */
  onFillDragEnd(listener: FillDragEndListener): () => void

  // ---- 编辑 ----
  /** 取消当前编辑会话（不回写不抛事件） */
  cancelEdit(): void
  /** 订阅编辑会话开始事件 */
  onEditStart(listener: (event: EditStartEvent) => void): () => void
  /** 订阅编辑会话结束事件（committed 区分提交 / 取消） */
  onEditEnd(listener: (event: EditEndEvent) => void): () => void

  // ---- 事件订阅（返回退订函数） ----
  /** 滚动帧级同步（滚动发生的帧上带最新位置触发一次） */
  onScrollFrame(listener: ScrollFrameListener): () => void
  /** 右键菜单事件（区域归属见 TableContextMenuEvent.region） */
  onContextMenu(listener: ContextMenuListener): () => void
  /** 列宽拖拽会话结束事件 */
  onColResizeEnd(listener: (event: { col: number; width: number }) => void): () => void
  /** 行高拖拽会话结束事件 */
  onRowResizeEnd(listener: (event: { row: number; height: number }) => void): () => void

  // ---- 媒体与浮动层 ----
  /** 浮动对象层（格上图片 / 图表；惰性创建，锚定格几何 + 拖拽 / 变换会话） */
  readonly floatObjects: FloatObjectLayer
  /** 图片资源服务（窗口化加载 + 位图 LRU；宿主配置 / 订阅事件面） */
  readonly imageService: ImageService
}
