// core 公共类型：数据供给三形态（records/columns、按格 hook、模型事件订阅）与 ListTable 配置

import type { RenderHost, RenderHostOptions, SceneEvent } from '@infinitable/render'

import type { CellRange } from './cell-range'
import type { CellType, ResolveCellRenderer } from './cell-renderer'
import type { CellStyle, ResolveCellStyle } from './cell-style'
import type { EditorRegistry } from './editor-registry'
import type { ImageServiceOptions, LoadedImage } from './media/image-service'
import type { TablePlugin } from './plugin'
import type { ThemeOverride } from './theme'

/** records 形态的一行数据 */
export type DataRecord = Record<string, unknown>

/** 列定义（records/columns 数组形态的取值与表头描述） */
export interface ColumnDefine {
  /** records 取值字段；缺省时该列无数组值（仍可经 hook / 模型供给） */
  field?: string
  /** 列头标题 */
  title?: string
  /** 列宽（缺省用 ListTableOptions.defaultColWidth） */
  width?: number
  /** 内置单元格类型（缺省 text） */
  cellType?: CellType
  /** 该列单元格的编辑器注册名（EditorRegistry 格级路由的列级来源） */
  editor?: string
  /** 该列编辑器多行形态：true 走 textarea（缺省单行 input） */
  editorMultiline?: boolean
  /** 该列编辑器字符上限：设定后编辑输入超限截断（覆盖 options.editorMaxLength）；未配置沿 options 级 */
  editorMaxLength?: number
  /** 该列文本自动换行：开启后超宽文本在格内断行，不向右侧空格溢出（可被逐格样式 hook 覆盖） */
  textWrap?: boolean
  /**
   * 列级样式来源：该列数据格的基础样式片段（字段全部可选）。
   * 覆盖链「主题分区 token → 列级 → 按格 hook」：逐字段覆盖主题分区 token、被按格 hook 覆盖，
   * 边框逐边独立合并（只作用于数据格，列头样式走 header 分区 token）。
   */
  style?: CellStyle
}

/**
 * 按格 hook：纯函数、同步、O(1)。
 * value 为取值管线的基础值（模型值或 records 字段值），返回最终显示文本。
 */
export type ResolveDisplayValue = (col: number, row: number, value: unknown) => string

/** 模型单元格变更事件 */
export interface CellChangeEvent {
  col: number
  row: number
  /** 变更前取值（外部模型给不出时为 undefined） */
  oldValue: unknown
  /** 变更后取值 */
  newValue: unknown
}

/** 编辑会话开始事件：会话真正打开（可编判定通过、浮层已开）后通知 */
export interface EditStartEvent {
  col: number
  row: number
  /** 编辑初值（基础值口径，未过 resolveDisplayValue） */
  initialValue: unknown
}

/** 编辑会话结束事件：提交在 onCellChange 之后抛出；取消不回写不抛 onCellChange */
export interface EditEndEvent {
  col: number
  row: number
  /** 编辑初值（基础值口径） */
  initialValue: unknown
  /** 终值；仅 committed=true 时存在 */
  finalValue?: unknown
  /** true=提交回写，false=取消 */
  committed: boolean
}

/** 格坐标引用（图片加载窗口、浮动对象锚点共用） */
export interface CellRef {
  col: number
  row: number
}

/**
 * 按格图片 hook：纯函数、同步、O(1)。
 * 返回图片 URL 则该格按图片渲染（L2 media 层 + ImageService 无闪协议），
 * 返回 null/undefined 走常规文本/自定义渲染管线。
 */
export type ResolveCellImage = (col: number, row: number) => string | null | undefined

/** 图表位图生产尺寸：width/height 为格 CSS 像素，dpr 为出图设备像素比 */
export interface CellChartMediaSize {
  width: number
  height: number
  dpr: number
}

/**
 * 格内图表媒体描述（L2 media 的 chart 预留位）：core 只认内容 key 与位图生产者，
 * 图表语义（类型/数据/库）全部在插件侧（chart 插件 mount 时注入解析器）。
 * 位图经 cell 级 MediaCache LRU 缓存，滚动滚回命中即首帧直贴（无闪协议同图片）。
 */
export interface CellChartMedia {
  /** 内容 key：按图表声明内容生成（内容变更自然换 key）；core 叠加格尺寸与 DPR 成完整缓存 key */
  key: string
  /** 位图生产：未命中 cell 级缓存时调用；首次含库加载为异步，同 key 并发出图由 core 单飞收敛 */
  produce(size: CellChartMediaSize): Promise<LoadedImage> | LoadedImage
}

/** 按格图表 hook：返回媒体描述的格在 L2 media 层按位图渲染（图表语义在插件侧） */
export type ResolveCellChart = (col: number, row: number) => CellChartMedia | null | undefined

/**
 * 外部数据模型（模型事件订阅形态）：
 * 表格经 onCellChange 订阅外部变更做局部刷新；可选 setCellValue 为表格回驱入口，
 * 回驱时模型同步 echo 回来的事件由 ModelBinding 吞掉，防回环。
 */
export interface TableModel {
  readonly rowCount?: number
  getCellValue(col: number, row: number): unknown
  setCellValue?(col: number, row: number, value: unknown): void
  onCellChange(listener: (change: CellChangeEvent) => void): () => void
}

export interface ListTableOptions {
  /** 表格视口尺寸（CSS 像素） */
  width: number
  height: number
  columns: ColumnDefine[]
  /** records/columns 数组形态的数据 */
  records?: readonly DataRecord[]
  /** 行数兜底：无 records、模型也未给 rowCount 时（纯 hook 形态）使用 */
  rowCount?: number
  /** 模型事件订阅形态的数据源 */
  model?: TableModel
  /** 按格 hook，作用于取值管线末端，可与另两形态叠加 */
  resolveDisplayValue?: ResolveDisplayValue
  /** 按格样式 hook：逐格样式投影（含逐边边框），返回 null 沿用基础样式 */
  resolveCellStyle?: ResolveCellStyle
  /** 按格自定义渲染 hook：返回渲染器即接管该格内容绘制（与取值管线解耦） */
  resolveCellRenderer?: ResolveCellRenderer
  /** 按格图片 hook：返回 URL 的格在 L2 media 层按图片渲染（ImageService 窗口化加载 + 无闪协议） */
  resolveCellImage?: ResolveCellImage
  /** 格级可编判定：返回 false 该格不可编（缺省全部可编） */
  resolveEditable?: (col: number, row: number) => boolean
  /**
   * Enter 键位开关：开启后非编辑态按 Enter 进入焦点格编辑（提交后仍按 Enter 语义下移）；
   * 缺省关闭，Enter 行为保持现状（非编辑态无操作）。
   */
  editCellOnEnter?: boolean
  /** 编辑器注册表（可编第一级判定与格级路由）；缺省为空表，也可事后经 table.editorRegistry 注册 */
  editorRegistry?: EditorRegistry
  /** 编辑器字符上限（options 级缺省，可按列 editorMaxLength 覆盖）；未配置不截断 */
  editorMaxLength?: number
  /** ImageService 配置（位图 LRU 预算/并发/占位延迟/加载器注入等） */
  imageServiceOptions?: ImageServiceOptions
  /** 左侧冻结列数（数据列，不含行号列；缺省 0） */
  frozenColCount?: number
  /** 顶部冻结行数（数据行，不含列头；缺省 0）。合并区不允许跨冻结边界 */
  frozenRowCount?: number
  /** 合并单元格区间列表（闭区间；不允许重叠、不允许跨冻结边界） */
  mergeCells?: readonly CellRange[]
  rowHeight?: number
  defaultColWidth?: number
  /** 列头高度 */
  headerHeight?: number
  /** 行号列宽度 */
  rowHeaderWidth?: number
  /**
   * 列头开关：false 关闭列头（构造期归一化为 headerHeight = 0，忽略显式 headerHeight）；
   * 缺省 true 保持现状。关闭后内容原点上移到 y=0，原列头区域的命中/拖选/右键/resize/
   * 角点全选全部走表体分支（与直接传 headerHeight: 0 的零高路径等价）。
   */
  showColHeader?: boolean
  /**
   * 行号列开关：false 关闭行号列（构造期归一化为 rowHeaderWidth = 0，忽略显式
   * rowHeaderWidth）；缺省 true 保持现状。关闭后内容原点左移到 x=0，原行号列区域的
   * 命中/拖选/右键/resize/角点全选全部走表体分支（与直接传 rowHeaderWidth: 0 等价）。
   */
  showRowHeader?: boolean
  /** 注入渲染宿主（测试/自定义管线）；缺省用 hostOptions 创建 */
  host?: RenderHost
  /** 未注入 host 时创建 RenderHost 的参数（width/height 取上面的视口尺寸） */
  hostOptions?: Omit<RenderHostOptions, 'width' | 'height'>
  /** 主题覆盖：基于默认主题 extends 派生（缺省用默认主题） */
  theme?: ThemeOverride
  /** 插件：构造即挂载生效，销毁时逆序卸载 */
  plugins?: readonly TablePlugin[]
  /** 列宽调整能力：返回 false 禁止该列拖拽改宽（缺省全部允许） */
  canResizeCol?: (col: number) => boolean
  /** 行高调整能力：返回 false 禁止该行拖拽改高（canResizeRow 补丁行为，缺省全部允许） */
  canResizeRow?: (row: number) => boolean
  /** Ctrl/Cmd 点选多选：开启后 Ctrl/Cmd 点数据格在既有选区上追加选区段（缺省 false，点选替换选区） */
  ctrlMultiSelect?: boolean
  /**
   * 内建滚动条：false 整体关闭（不绘制、右/下缘条带不拦截指针）；缺省 hover 档
   * （悬停表格内或滚动时显示、静止 hideDelay 后隐藏）；显式 true 常驻（旧语义）；
   * 对象形态配置显示策略——'always' 常驻、'scrolling' 滚动或滚动条交互时显示、
   * 'hover' 悬停或滚动时显示（hideDelay 缺省回落主题 scrollbarHideDelay token）；
   * 对象形态可给 mode: 'native' 切换浏览器原生滚动条（见 ScrollbarOptions.mode）。
   */
  scrollbar?: boolean | ScrollbarOptions
  /**
   * 滚动缓冲（渲染窗口向滚动方向两侧各多建 N 行/列的场景节点，缺省 0 不缓冲）。
   * 只扩大场景装配窗口（节点/文本测量预建），不改变滚动边界与可视判定；
   * 快速滚动时新滚入行列的建格成本摊到缓冲区，减少滚动帧的分配与测量。
   */
  overscanRows?: number
  /** 滚动缓冲列数（语义同 overscanRows） */
  overscanCols?: number
  /**
   * 动态列头标题源：列定义未给 title 的列（setColCount 增出的列等）逐列取标题，
   * 返回值直接作为列头文本；未配置回落空串。电子表格类宿主可用它给增出的列
   * 提供 A/B/C…AA 字母表头。
   */
  resolveColTitle?: (col: number) => string
}

/** 滚动条形态：'canvas' 画布内建（sky 浮层绘制，缺省旧语义）；'native' 浏览器原生滚动条 */
export type ScrollbarMode = 'canvas' | 'native'

/** 内建滚动条配置（ListTableOptions.scrollbar 的对象形态） */
export interface ScrollbarOptions {
  /**
   * 滚动条形态（缺省 'canvas'，旧语义完全保留）：
   * - 'canvas'：画布内建滚动条——sky 浮层绘制 + 右/下缘条带指针拦截（现状路径）；
   * - 'native'：浏览器原生滚动条——引擎在挂载容器内装配真实 DOM 滚动容器
   *   （overflow 滚动 + `scrollbar-gutter: stable`），滚动条由浏览器原生渲染、
   *   不自建 thumb/track，外观/显隐/触控板惯性/辅助功能完全随 OS。此形态下：
   *   visibility/hideDelay/reserve 不适用（原生滚动条显隐随 OS，给出即忽略）；
   *   gutter 预留由滚动容器布局扣除（横向/纵向含右下角 corner 独立预留、
   *   永不覆盖内容），视口口径改取滚动容器 clientWidth/clientHeight（已含扣除）；
   *   画布滚动条不再绘制、右/下缘条带不再拦截指针；引擎滚动状态（ScrollManager）
   *   与原生容器双向同步，scrollTo/scrollBy/键盘导航等程序化滚动照常可用。
   */
  mode?: ScrollbarMode
  /**
   * 显示策略：'hover' 悬停表格内或滚动时显示（缺省，静止 hideDelay 后隐藏）；
   * 'scrolling' 滚动或滚动条交互（拖拽/点按/悬停）时显示，静止 hideDelay 后隐藏；
   * 'always' 常驻（旧 true 语义）（参照 VTable scrollStyle.visible）。
   * 仅 canvas 形态适用（native 形态下忽略）。
   */
  visibility?: 'always' | 'scrolling' | 'hover'
  /**
   * 'scrolling'/'hover' 档静止后隐藏延时（ms）；缺省回落主题 interaction.scrollbarHideDelay。
   * 仅 canvas 形态适用（native 形态下忽略）。
   */
  hideDelay?: number
  /**
   * 预留轨道区：true（缺省）在可滚动轴的画布右/下缘常驻预留一条 scrollbarSize 宽的
   * 轨道条带（轨道底色 + 滑块绘制其上，表格内容不再被滚动条遮挡，桌面 Excel 观感）；
   * false 回悬浮式（滑块浮在内容之上，旧语义）。
   * 仅 canvas 形态适用（native 形态下 gutter 由滚动容器布局扣除）。
   */
  reserve?: boolean
}

/** contextmenu 事件（右键菜单 UI 为非目标，仅保留事件） */
export interface TableContextMenuEvent {
  /** 命中的数据格；点在行列头/空白处为 null */
  cell: CellRef | null
  /**
   * 右键落点区域：'body' 表体 / 'row-header' 行号列 / 'col-header' 列头。
   * 角点（行号列×列头交叉的全选区）归 'body' 且 cell 为 null——右键角点不翻行/列头菜单，
   * 与下游「保留当前选区」语义一致。
   */
  region: 'body' | 'row-header' | 'col-header'
  /** 层坐标（CSS 像素） */
  x: number
  y: number
  originalEvent: SceneEvent['originalEvent']
}

export type ContextMenuListener = (event: TableContextMenuEvent) => void
