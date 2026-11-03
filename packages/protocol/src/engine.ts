// 引擎装配协议（P7）：四类平级引擎（表格 / sheet / 透视 / 甘特）的公共装配契约。
// 自 packages/table 迁出为独立契约包——协议类型只有一个家，不消费 TableEngine 的
// 引擎与插件不再依赖任何具体引擎包即可完成契约消费。全部成员是既有原语的组合
// ——数据面（TableModel 形态）、渲染宿主（@infinitable/render 的 RenderHost 窄接口）、
// 主题（grid 主题投影 token）、生命周期（注册 / 销毁）、painter 槽位（underlay /
// overlay 整层绘制）、插件槽位（EnginePlugin 注册路径）——不引入新引擎概念。
// 纯类型包：零运行时代码，实现由各引擎自行落地（table 引擎即 ListTable）。
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
// - G2/G21 插件槽位不绑定具体事件类型：EnginePlugin.mount 只收 EngineAssembly，
//   事件订阅由各引擎领域面（如 TableEngine）增量承载。
// - G12-G15 导出读取面：EngineReadView（可选能力成员 read）让导出类插件读取引擎
//   有效数据 / 样式 / 几何 / 合并区，而非只能拿具体引擎类型。

import type { CellRange, CellStyle, TableTheme, ThemeOverride } from '@infinitable/grid'
import type { RenderContext, RenderHost, Size } from '@infinitable/render'

import type { EnginePlugin } from './plugin'

/** 模型单元格变更事件（协议数据面的变更通知词汇） */
export interface CellChangeEvent {
  col: number
  row: number
  /** 变更前取值（外部模型给不出时为 undefined） */
  oldValue: unknown
  /** 变更后取值 */
  newValue: unknown
}

/**
 * 内容之下整层绘制预留位（underlay 档）：宿主 / 插件注入的整层绘制回调
 * （衬底水印等绘制在表格内容之下的内容）。每次整层重绘（painter 变更、容器
 * resize、整层失效）时以层上下文与视口尺寸调用。
 */
export type UnderlayPainter = (ctx: RenderContext, viewport: Size) => void

/**
 * 顶层 overlay 绘制预留位（与 UnderlayPainter 完全对称）：宿主 / 插件注入的整层
 * 绘制回调（水印等覆盖在表格内容之上的内容）。每次整层重绘（painter 变更、容器
 * resize、整层失效）时以层上下文与视口尺寸调用。
 */
export type OverlayPainter = (ctx: RenderContext, viewport: Size) => void

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
  /** 内容之下整层绘制预留位（传 null 还原空置） */
  setUnderlayPainter(painter: UnderlayPainter | null): void
  /** 内容之上整层绘制预留位（最顶层；传 null 还原空置） */
  setOverlayPainter(painter: OverlayPainter | null): void

  // ---- 插件槽位：注册即挂载生效，销毁时逆序卸载（不绑定具体事件类型 G2/G21） ----
  use(plugin: EnginePlugin): void

  // ---- 生命周期 ----
  /** 销毁引擎：卸载全部插件、解绑事件、回收渲染资源（幂等） */
  destroy(): void

  // ---- 导出读取面（可选能力，G12-G15；table 引擎恒提供） ----
  /** 导出类插件的引擎快照读取面；不提供导出能力的引擎为 undefined */
  readonly read?: EngineReadView
}
