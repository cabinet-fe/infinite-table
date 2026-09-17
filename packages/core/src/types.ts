// core 公共类型：数据供给三形态（records/columns、按格 hook、模型事件订阅）与 ListTable 配置

import type { RenderHost, RenderHostOptions, SceneEvent } from '@infinite-table/render'

import type { CellRange } from './cell-range'
import type { CellType, ResolveCellRenderer } from './cell-renderer'
import type { CellStyle, ResolveCellStyle } from './cell-style'
import type { EditorRegistry } from './editor-registry'
import type { ImageServiceOptions } from './media/image-service'
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
}

/** contextmenu 事件（右键菜单 UI 为非目标，仅保留事件） */
export interface TableContextMenuEvent {
  /** 命中的数据格；点在行列头/空白处为 null */
  cell: CellRef | null
  /** 层坐标（CSS 像素） */
  x: number
  y: number
  originalEvent: SceneEvent['originalEvent']
}

export type ContextMenuListener = (event: TableContextMenuEvent) => void
