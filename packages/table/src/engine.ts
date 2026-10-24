// 引擎装配协议（P7）：四类平级引擎（表格 / sheet / 透视 / 甘特）的公共装配路径。
// 全部由既有原语组合——数据面（TableModel 形态）、渲染宿主（@infinitable/render 的
// RenderHost 窄接口）、主题（grid 主题投影 token）、生命周期（注册 / 销毁）、
// painter 槽位（underlay / overlay 整层绘制）、插件槽位（TablePlugin 注册路径）——
// 不引入新引擎概念。
// 下游缺口对齐（spec「下游缺口对齐」节）：
// - G17 中立性：协议本体不烧进行号列、表头、合并等表格领域概念——透视表等平级引擎
//   走同一装配路径，其表头 / 分组需求由 table 公共面增量承载（TableEngine）而非协议
//   特例；合并区只以几何区间语言出现在可选的导出读取面（EngineReadView）。
// - G11 数据面扩展位：数据面成员与 TableModel 同形（rowCount / getCellValue /
//   updateCell 回驱 / onCellChange 变更通知），但「同步返回最终值」不是唯一合法形态
//   ——异步 / 窗口取数模型的兼容写法：宿主以「rowCount 兜底 + 按格 hook
//   （resolveDisplayValue / resolveCellImage 等）pull 式供给 + setRowCount 随窗口
//   增长」组合表达窗口语义（ListTableOptions 的纯 hook 形态即是该写法的同步版），
//   新增异步实现类不动装配形状。
// - G2/G21 插件槽位不绑定具体事件类型：TablePlugin.mount 只收 EngineAssembly，
//   事件订阅由各引擎领域面（如 TableEngine）增量承载。
// - G12-G15 导出读取面：EngineReadView（可选能力成员 read）让导出类插件读取引擎
//   有效数据 / 样式 / 几何 / 合并区，而非只能拿具体引擎类型。

import type {
  CellRange,
  CellRef,
  SelectionSnapshot,
  TableTheme,
  ThemeOverride,
} from '@infinitable/grid'
import type { FloatObjectLayer } from '@infinitable/grid'
import type { WindowRange } from '@infinitable/grid'
import type { ImageService } from '@infinitable/grid'
import type { Region, RenderHost } from '@infinitable/render'

import type { CellStyle } from './cell-style'
import type { ScrollFrameListener, OverlayPainter, UnderlayPainter } from './list-table'
import type { TablePlugin } from './plugin'
import type {
  CellChangeEvent,
  ColumnDefine,
  ContextMenuListener,
  EditEndEvent,
  EditStartEvent,
} from './types'
import type { FillDragEndListener } from './fill-handle'
import type { HighlightRange } from './interaction-overlay'

/**
 * 引擎导出读取面（G12-G15，可选能力）：导出类插件（print / 图片导出等）读取引擎
 * 有效数据的窄接口——有效取值（经取值管线）与原始值、有效样式（经样式投影链）、
 * 行列几何、合并区（几何区间语言）。引擎中立：透视 / 甘特等引擎可按自身几何语义
 * 实现或不提供（消费方经 `engine.read` 探测）；宿主快照合成亦可经 render 的
 * paintTree / 分层面离屏重放（本面供数据语义，render 层供像素语义）。
 */
export interface EngineReadView {
  /** 数据行数（动态模型实时反映） */
  readonly rowCount: number
  /** 数据列数 */
  readonly colCount: number
  /** 行高读取（CSS 像素，含逐行覆盖） */
  getRowHeight(row: number): number
  /** 列宽读取（CSS 像素） */
  getColWidth(col: number): number
  /** 单元格有效显示文本（经取值管线；被合并覆盖的格取主格文本） */
  getCellText(col: number, row: number): string
  /** 单元格原始值（数据面口径，未经显示链） */
  getCellValue(col: number, row: number): unknown
  /** 有效格样式（主题分区 token → 列级 → 按格 hook 投影链产物；无样式引擎返回 undefined） */
  getCellStyle(col: number, row: number): CellStyle | undefined
  /** 合并区集合（闭区间几何语言；无合并语义的引擎返回空数组） */
  getMergeRanges(): readonly CellRange[]
}

/**
 * 引擎装配协议（中立本体）：任何引擎（表格 / sheet / 透视 / 甘特）装配进宿主的
 * 公共路径——渲染宿主 + 数据面 + 主题 + painter 槽位 + 插件槽位 + 生命周期。
 * 宿主与官方插件只依赖本面即可完成装配与整层绘制挂载；引擎领域操作（选区 / 编辑 /
 * 表头等）由各引擎公共面增量承载（表格引擎见 TableEngine），不进本协议。
 */
export interface EngineAssembly {
  // ---- 渲染宿主（画布面）：层创建 / 失效提交 / 帧调度 / 文本测量 ----
  readonly host: RenderHost

  // ---- 数据面（TableModel 形态；G11 异步 / 窗口取数扩展位见文件头） ----
  /** 数据行数（模型形态动态读取模型 rowCount） */
  readonly rowCount: number
  /** 单元格原始值读取（数据面口径；合并区路由主格） */
  getCellValue(col: number, row: number): unknown
  /** 回驱数据源（TableModel.setCellValue 对应物：模型形态经绑定回写并刷新派生格） */
  updateCell(col: number, row: number, value: unknown): void
  /** 订阅数据变更（编辑提交回写等；返回退订函数） */
  onCellChange(listener: (change: CellChangeEvent) => void): () => void

  // ---- 主题（token 可配置；图标与提示色经主题 token 承载，协议不内嵌 UI 文案 G20） ----
  /** 当前生效主题 */
  getTheme(): TableTheme
  /** 运行时更新主题（深覆盖合并，不重建装配形状） */
  updateTheme(override: ThemeOverride): void

  // ---- painter 槽位：整层绘制挂载（水印等 underlay/overlay 绘制方） ----
  /** 内容之下整层绘制预留位（ground 档；传 null 还原空置） */
  setUnderlayPainter(painter: UnderlayPainter | null): void
  /** 内容之上整层绘制预留位（最顶层；传 null 还原空置） */
  setOverlayPainter(painter: OverlayPainter | null): void

  // ---- 插件槽位：注册即挂载生效，销毁时逆序卸载（不绑定具体事件类型 G2/G21） ----
  use(plugin: TablePlugin): void

  // ---- 生命周期 ----
  /** 销毁引擎：卸载全部插件、解绑事件、回收渲染资源（幂等） */
  destroy(): void

  // ---- 导出读取面（可选能力，G12-G15；table 引擎恒提供） ----
  /** 导出类插件的引擎快照读取面；不提供导出能力的引擎为 undefined */
  readonly read?: EngineReadView
}

/**
 * 表格引擎协议面：EngineAssembly + 表格领域公共操作（G17：领域需求由 table 公共面
 * 增量承载而非协议特例）。全部成员是 ListTable 既有公共 API 的签名集合——sheet 的
 * SheetGrid 等适配层经本面消费 table 引擎，不触碰具体类；表头层级装配、按格可替换
 * 渲染器（G8 扩展缝，构造面 resolveCellRenderer）、行号列等领域概念只出现在本面
 * 之下的实现侧，本面仅收敛适配层实际消费的操作签名。
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
