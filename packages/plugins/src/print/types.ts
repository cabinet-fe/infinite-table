// 打印插件类型面（P1 headless 内核的数据面抽象与配置模型，ureport2 双模式移植）。
// 分层：本目录 P1 = headless 内核（types / paper / paginate，纯函数零 DOM，meta 可在测试
// 环境直接消费）；P2 = 页面 HTML 构建（页眉页脚占位符求值 + 表格页 + 水印平铺 + iframe
// 打印输出）；P3 = DOM 薄壳预览（openPrintPreview）。P1/P2 均不依赖引擎内部 API，
// 只依赖 @infinitable/core 公共类型。

import type { CellRange, CellStyle, FloatObject } from '@infinitable/core'

// ---- 打印数据源（数据面抽象） ----

/**
 * 打印数据源：宿主/适配器供数的窄接口，签名以能同时适配 plugins 侧 SheetStore 与
 * meta 侧 SheetSnapshot 为准（适配层做字段映射，本接口不绑定任何具体模型类）。
 * - SheetStore 适配：rowCount/colCount → getRowCount/getColCount、rowHeight/colWidth
 *   → getRowHeight/getColWidth、merges → getMerges、cellValue → getValue、
 *   cellStyle → getEffectiveStyle、displayValue → getDisplayValue。
 * - meta SheetSnapshot 适配：cells 稀疏条目映射为 cellValue/displayValue、
 *   rowHeights/colWidths 元组映射为 rowHeight/colWidth、images 映射为 FloatObject 形态。
 * 单位约定：行高/列宽一律 px（96dpi，与引擎行列尺寸同口径）。
 */
export interface PrintSource {
  /** 表名（页面标题缺省源，P2 占位符求值消费） */
  name: string
  /** 数据行数（含重复表头行在内的全表行数） */
  rowCount: number
  /** 数据列数 */
  colCount: number
  /** 行高读取（px；越界行为由适配层保证确定性） */
  rowHeight(row: number): number
  /** 列宽读取（px） */
  colWidth(col: number): number
  /** 合并单元格区域列表 */
  merges(): readonly CellRange[]
  /** 原始格值（分组换页按此判定分组语义，不受显示链影响） */
  cellValue(col: number, row: number): unknown
  /** 有效格样式（P2 页面构建消费；无样式返回 undefined） */
  cellStyle(col: number, row: number): CellStyle | undefined
  /** 显示值（P2 页面构建消费；经显示链产出展示形态） */
  displayValue(col: number, row: number): unknown
  /** 浮动图列表（与 xlsx 导出 SheetExportSource.images 同构；P2 绝对定位渲染） */
  images?: readonly FloatObject[]
  /** 浮动图字节解析（kind === 'image' 且解析到字节才进打印输出；src 形态由宿主决定） */
  imageData?: (object: FloatObject) => PrintImagePayload | undefined
}

/** 打印浮动图字节载荷（页面构建编码为 data URL 内嵌） */
export interface PrintImagePayload {
  /** 图片 MIME 类型（如 image/png） */
  mime: string
  /** 字节内容 */
  data: Uint8Array
}

// ---- 纸张与布局 ----

/** 纸张预设代号（尺寸表见 paper.ts PAPER_PRESETS_MM，portrait 口径） */
export type PrintPaperPreset = 'A3' | 'A4' | 'A5' | 'Letter'

/** 纸张规格：预设代号，或自定义 mm 尺寸（portrait 口径宽高，landscape 自动交换） */
export type PrintPaperSpec = PrintPaperPreset | { widthMm: number; heightMm: number }

/** 纸张方向：portrait 纵向（缺省）/ landscape 横向（宽高交换） */
export type PrintOrientation = 'portrait' | 'landscape'

/** 页边距（px，96dpi 口径；未给的边回落 paper.ts 缺省值） */
export interface PrintMargin {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

/** 缩放模式：origin 原始尺寸（缺省）/ fit-width 按可用页宽等比缩放（只缩不放） */
export type PrintScaleMode = 'origin' | 'fit-width'

/** 分页模式：fitpage 按行高累加分页（缺省）/ fixrows 固定行数分页（套打） */
export type PrintPagingMode = 'fitpage' | 'fixrows'

// ---- 页眉页脚 ----

/** 页眉/页脚单段配置：三段文本，占位符（{page}/{pageCount}/{date}/{time}/{title} 与
 *  页级聚合 {pageSum:COL} 等）由 P2 求值；未给段为空 */
export interface PrintHeaderFooterSection {
  left?: string
  center?: string
  right?: string
}

/**
 * 页眉页脚配置：P1 只消费高度（参与可用页高推导）；文本渲染与占位符求值在 P2。
 * 高度规则：section 存在即预留高度（缺省 paper.ts DEFAULT_HEADER_FOOTER_HEIGHT_PX），
 * 可显式覆盖；section 缺省不预留。
 */
export interface PrintHeaderFooterConfig {
  /** 页眉（页面顶部三段） */
  header?: PrintHeaderFooterSection | null
  /** 页脚（页面底部三段） */
  footer?: PrintHeaderFooterSection | null
  /** 页眉预留高（px；缺省按 header 是否存在自动） */
  headerHeight?: number
  /** 页脚预留高（px；缺省按 footer 是否存在自动） */
  footerHeight?: number
}

// ---- 水印（共享配置模型） ----

/**
 * 文字平铺水印配置：打印水印（P2）与水印插件（P6）共用同一配置模型。
 * enabled/text 必填，样式字段可选（缺省值见 WATERMARK_TEXT_DEFAULTS，
 * 取值对齐 meta ReportWatermarkConfig 既有缺省，三端呈现一致）。
 */
export interface WatermarkTextConfig {
  /** 是否启用水印 */
  enabled: boolean
  /** 水印文本 */
  text: string
  /** 字号（px；缺省 14） */
  fontSize?: number
  /** 文本颜色（缺省 #000000） */
  color?: string
  /** 整体不透明度 0-1（缺省 0.12） */
  opacity?: number
  /** 旋转角度（度，负值为逆时针；缺省 -30） */
  rotate?: number
  /** 平铺密度：相邻水印单元横向间距（px；缺省 160） */
  gapX?: number
  /** 平铺密度：相邻水印单元纵向间距（px；缺省 120） */
  gapY?: number
}

/** 文字水印样式缺省值（对齐 meta REPORT_WATERMARK_DEFAULTS，三端共用） */
export const WATERMARK_TEXT_DEFAULTS = Object.freeze({
  fontSize: 14,
  color: '#000000',
  opacity: 0.12,
  rotate: -30,
  gapX: 160,
  gapY: 120,
})

// ---- 打印配置 ----

/**
 * 打印配置（ureport2 打印模型移植）：纸张/方向/边距/缩放/分页/重复表头/分组换页/
 * 页眉页脚/水印。全字段可选（各字段缺省值见对应模块注释），只描述布局意图，
 * 不含 DOM 引用——headless 内核在测试环境可直接消费。
 */
export interface PrintConfig {
  /** 纸张（缺省 A4） */
  paperSize?: PrintPaperSpec
  /** 方向（缺省 portrait） */
  orientation?: PrintOrientation
  /** 页边距 px（缺省四边 paper.ts DEFAULT_PRINT_MARGIN_PX；单值四边同距） */
  margin?: number | PrintMargin
  /** 缩放模式（缺省 origin） */
  scale?: PrintScaleMode
  /** 分页模式（缺省 fitpage） */
  paging?: PrintPagingMode
  /** fixrows 模式必填：每页总行数（含重复表头行；须大于 headerRepeatRows） */
  fixRows?: number
  /** 每页重复的表头行数（取源表前 N 行；缺省 0 不重复） */
  headerRepeatRows?: number
  /** 分组换页列索引（单个或多个；列值变化处强制换页，与分页模式正交组合） */
  groupBreakBy?: number | readonly number[]
  /** 页眉页脚（P1 消费高度，P2 求值渲染） */
  headerFooter?: PrintHeaderFooterConfig
  /** 打印水印（与水印插件 P6 同一配置模型；enabled 才平铺） */
  watermark?: WatermarkTextConfig
}
