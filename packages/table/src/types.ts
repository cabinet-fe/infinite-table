// table 公共类型：数据供给三形态（records/columns、按格 hook、模型事件订阅）与 ListTable 配置，
// 自 core types.ts 随迁；几何/滚动向词汇（格坐标、滚动条配置）定义在 @infinitable/grid，
// 此处转出维持既有 import 路径。

import type { CellRange, CellRef, ScrollbarOptions, ThemeOverride } from '@infinitable/grid'
import type { ImageFit } from '@infinitable/grid/src/media/draw-image'
import type { ImageServiceOptions, LoadedImage } from '@infinitable/grid/src/media/image-service'
import type { RenderHost, RenderHostOptions, SceneEvent } from '@infinitable/render'

import type { CellType, ResolveCellRenderer } from './cell-renderer'
import type { CellStyle, ResolveCellStyle } from './cell-style'
import type { EditorRegistry } from './editor-registry'
import type { TablePlugin } from './plugin'

export type { CellRef, ScrollbarMode, ScrollbarOptions } from '@infinitable/grid'

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

/**
 * 按格图片 hook：纯函数、同步、O(1)。
 * 返回图片 URL 则该格按图片渲染（L2 media 层 + ImageService 无闪协议），
 * 返回 null/undefined 走常规文本/自定义渲染管线。
 */
export type ResolveCellImage = (col: number, row: number) => string | null | undefined

/**
 * 按格图片缩放 hook：纯函数、同步、O(1)。
 * 返回 fill/contain 覆盖该格图片的缩放语义；null/undefined 回落 contain（保比例）。
 * 与 resolveCellImage 同格命中（返回 URL 的格才消费本 hook）。
 */
export type ResolveCellImageFit = (col: number, row: number) => ImageFit | null | undefined

/** 按格超链接描述（resolveCellLink 的返回形态） */
export interface CellLink {
  /** 链接 URL */
  url: string
  /** 可选显示文本（tooltip 等宿主侧消费；缺省显示单元格原值） */
  text?: string
}

/**
 * 按格超链接 hook：纯函数、同步、O(1)。
 * 返回链接的格自动获得默认链接外观（主题 linkColor 蓝字 + 下划线，被 resolveCellStyle
 * 覆盖）、悬停 pointer 光标与链接 hover/leave/单击事件。
 */
export type ResolveCellLink = (col: number, row: number) => CellLink | null | undefined

/** 链接悬停事件：指针悬停命中链接格时派发（tooltip 由宿主渲染） */
export interface CellLinkHoverEvent {
  col: number
  row: number
  /** 链接 URL */
  url: string
  /** 可选显示文本 */
  text?: string
  /** 层坐标（CSS 像素，悬停落点） */
  x: number
  y: number
  originalEvent: SceneEvent['originalEvent']
}

/** 链接离开事件：指针移出已悬停的链接格（含移到非链接格/表头/空白）时派发 */
export interface CellLinkLeaveEvent {
  /** 刚离开的链接格坐标 */
  col: number
  row: number
}

/**
 * 链接单击事件：真实指针 down+up 命中同一链接格（框选拖拽/键盘选中不触发）时派发；
 * 派发后按 openCellLinkOnClick 决定是否执行引擎默认打开。
 */
export interface CellLinkClickEvent {
  col: number
  row: number
  /** 链接 URL */
  url: string
  /** 可选显示文本 */
  text?: string
  originalEvent: SceneEvent['originalEvent']
}

export type CellLinkHoverListener = (event: CellLinkHoverEvent) => void
export type CellLinkLeaveListener = (event: CellLinkLeaveEvent) => void
export type CellLinkClickListener = (event: CellLinkClickEvent) => void

/**
 * 按格嵌入图超链接 hook：纯函数、同步、O(1)。
 * 返回 URL 的图片格单击派发图片链接点击事件（onImageLinkClick，kind: 'cell'）；
 * 与 resolveCellImage 同链取值（宿主桥接层保证仅有图格返回链接）。
 */
export type ResolveCellImageLink = (col: number, row: number) => string | null | undefined

/**
 * 图片链接单击事件（浮动图与嵌入图两来源，判别字段 kind）：
 * 真实指针 down+up 命中同一带链接图片、位移在阈值内（拖拽/框选不触发）时派发；
 * 派发后按 openCellLinkOnClick 决定是否执行引擎默认打开。
 * 无链接图片单击不派发（保持现有选中行为）。
 */
export type ImageLinkClickEvent =
  | {
      /** 浮动图片（命中浮动层对象） */
      kind: 'float'
      /** 命中的浮动对象 id */
      id: string
      /** 链接 URL */
      url: string
      originalEvent: SceneEvent['originalEvent']
    }
  | {
      /** 嵌入单元格图片（命中有图格） */
      kind: 'cell'
      col: number
      row: number
      /** 链接 URL */
      url: string
      originalEvent: SceneEvent['originalEvent']
    }

export type ImageLinkClickListener = (event: ImageLinkClickEvent) => void

/** 图表位图生产尺寸：width/height 为格 CSS 像素，dpr 为出图设备像素比 */
export interface CellChartMediaSize {
  width: number
  height: number
  dpr: number
}

/**
 * 格内图表媒体描述（L2 media 的 chart 预留位）：table 只认内容 key 与位图生产者，
 * 图表语义（类型/数据/库）全部在插件侧（chart 插件 mount 时注入解析器）。
 * 位图经 cell 级 MediaCache LRU 缓存，滚动滚回命中即首帧直贴（无闪协议同图片）。
 */
export interface CellChartMedia {
  /** 内容 key：按图表声明内容生成（内容变更自然换 key）；table 叠加格尺寸与 DPR 成完整缓存 key */
  key: string
  /** 位图生产：未命中 cell 级缓存时调用；首次含库加载为异步，同 key 并发出图由 table 单飞收敛 */
  produce(size: CellChartMediaSize): Promise<LoadedImage> | LoadedImage
}

/** 按格图表 hook：返回媒体描述的格在 L2 media 层按位图渲染（图表语义在插件侧） */
export type ResolveCellChart = (col: number, row: number) => CellChartMedia | null | undefined

/**
 * 指针捕获接续的事件宿主最小面（真实 Window 天然满足，无头/测试注入替身）：
 * 滚动条拖拽等画布外指针接续会话在它上面挂/解 pointermove/pointerup 监听。
 */
export interface PointerEventHost {
  addEventListener(type: 'pointermove' | 'pointerup', listener: (event: PointerEvent) => void): void
  removeEventListener(
    type: 'pointermove' | 'pointerup',
    listener: (event: PointerEvent) => void,
  ): void
}

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
  /** 按格图片缩放 hook：返回 fill/contain 覆盖缩放语义（缺省 contain 保比例） */
  resolveCellImageFit?: ResolveCellImageFit
  /** 按格超链接 hook：返回链接的格获得默认链接外观与链接 hover/单击事件 */
  resolveCellLink?: ResolveCellLink
  /** 按格嵌入图超链接 hook：返回 URL 的图片格单击派发图片链接点击事件（嵌入图渲染通道之外的独立链接来源） */
  resolveCellImageLink?: ResolveCellImageLink
  /**
   * 链接单击默认打开开关：true（缺省）单击命中链接格或带链接图片（浮动图/嵌入图）时
   * 引擎在派发对应链接点击事件后默认打开 URL（缺省浏览器实现 window.open 新标签 +
   * noopener，无 window 环境静默跳过；可经 openCellLink 注入替身）；false 关闭默认
   * 打开，打开行为由宿主经事件接管。
   */
  openCellLinkOnClick?: boolean
  /**
   * 链接默认打开实现（注入缺省浏览器 window.open）：openCellLinkOnClick 未关闭时
   * 引擎在派发链接点击事件后调用它打开 URL。无头/SSR 宿主注入替身接管打开行为。
   */
  openCellLink?: (url: string) => void
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
  /**
   * 编辑浮层内缩开关：true 时编辑浮层矩形按锚定格四周可视边框内缩（含浮层自带边框
   * 的骑缘外扩补偿），浮层落在边框内侧、格边框编辑期保持可见（对齐 Excel/WPS）；
   * 缺省 false 保持现状（浮层骑格缘，盖住本格自画的 right/bottom 边框）。
   */
  editorInsideBorder?: boolean
  /** ImageService 配置（位图 LRU 预算/并发/占位延迟/加载器注入等） */
  imageServiceOptions?: ImageServiceOptions
  /** 左侧冻结列数（数据列，不含行号列；缺省 0） */
  frozenColCount?: number
  /** 顶部冻结行数（数据行，不含列头；缺省 0）。合并区跨冻结边界合法（主格按冻结带钉固） */
  frozenRowCount?: number
  /**
   * 合并单元格区间列表（闭区间；跨冻结边界合法）。重叠项构造时规范化：
   * 保留先声明、丢弃冲突项并 console 提示，不抛错
   */
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
  /**
   * 指针捕获接续的事件宿主（注入缺省运行环境 window）：滚动条拖拽等画布外指针会话
   * 在它上面挂 pointermove/pointerup 接续监听。真实 Window 天然满足；无 window 环境
   * （无头/SSR）不注入也不缺省可得不挂接续（画布内会话不受影响），测试注入替身可
   * 直接驱动画布外接续。
   */
  pointerEventHost?: PointerEventHost
  /**
   * 宿主环境 dpr 读取源（注入缺省浏览器实现 window.devicePixelRatio，无 window 回落
   * 1）：构造与 resize 每次读取。hostOptions.dpr 显式注入仍优先（确定性场景锁值，
   * 不随本读取源刷新）；无头测试注入固定值驱动像素相关路径。
   */
  resolveDevicePixelRatio?: () => number
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
   * shift+点选扩展的锚点解析 hook：按住 shift 点数据格时以返回格为锚开启拖选扩展
   * （选区段从锚点延伸到点击格，继续拖拽/连续 shift 点选均以它为锚）。返回 undefined
   * 用引擎缺省（画布选区末段 start）；返回 null 不扩展（回落普通点选）。引用拾取等
   * 「画布选区不随拾取流动」的宿主经此自持锚点。
   */
  resolveShiftSelectAnchor?: (target: CellRef) => CellRef | null | undefined
  /**
   * 交互选区开关：false 时指针/键盘不再驱动选区——表体拖选/点选（含 shift/ctrl
   * 扩展）、行/列头与角点拖选全选、方向键/Tab 移动焦点、填充柄（绘制与命中）
   * 一并关闭；选区退化为纯外部回写的高亮面（applyExternalSelection 写入，
   * 照常绘制与广播）。透视表等「选区即领域高亮、无 sheet 式选区交互」的平级
   * 引擎经此关闭。缺省 true 保持现状。
   */
  interactiveSelection?: boolean
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
