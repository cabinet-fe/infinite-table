// 主题系统：默认主题全套 token（颜色/字体/边框/行高/交互浮层/外框）+ extends 深覆盖派生。
// 派生主题经 ListTableOptions.theme 接入样式管线；显式 options（rowHeight 等）仍优先于主题。

import type {
  CellBorder,
  CellBorderEdge,
  CellPadding,
  CellStyle,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
} from './cell-style'

/**
 * 单元格样式 token（body 数据格与行列头各一份；corner 与行号列有独立分区，缺省随 header 派生）。
 * 字段名与 CellStyle 对齐：token 经样式解析链路落入格样式，被列级/按格 hook 逐字段覆盖。
 */
export interface CellStyleTokens {
  font: string
  color: string
  background: string
  /** 网格线色：投影为每格右/下 1px 默认网格边（收入本格，对齐 VTable cellBorderClipDirection: 'bottom-right'） */
  borderColor: string
  /** 水平对齐；缺省 left */
  textAlign?: CellTextAlign
  /** 垂直对齐；缺省 middle */
  verticalAlign?: CellVerticalAlign
  /** 字重（CSS font-weight：数值 100~900 或 bold 等关键字） */
  fontWeight?: number | string
  /** 字形（CSS font-style：italic 等） */
  fontStyle?: string
  /** 字号（CSS 像素数值） */
  fontSize?: number
  /** 字族（CSS font-family 串） */
  fontFamily?: string
  /** 下划线 */
  underline?: boolean
  /** 删除线 */
  lineThrough?: boolean
  /** 超宽文本处理；缺省数据格保持 Excel 式溢出，行列头由表侧兜底 ellipsis */
  textOverflow?: CellTextOverflow
  /** 格内边距 [上,右,下,左]；缺省 [0, 8, 0, 8] */
  padding?: CellPadding
  /** 逐边边框（各边 width/color/线型 style 独立）；缺省的边不绘制 */
  border?: CellBorder
}

/** 交互浮层样式 token：选区/填充柄/resize 拖拽线/内建滚动条的唯一颜色与尺寸来源 */
export interface InteractionTokens {
  /** 选区段填充色 */
  selectionFill: string
  /** 选区段边框色 */
  selectionBorder: string
  /** 选区段边框宽（CSS 像素） */
  selectionBorderWidth: number
  /** 填充柄方点颜色 */
  fillHandle: string
  /** resize 拖拽指示线颜色 */
  resizeLine: string
  /** resize 拖拽指示线宽（CSS 像素） */
  resizeLineWidth: number
  /** 整行/整列选区覆盖时行号格/列头格的高亮背景 */
  headerHighlight: string
  /** 冻结行/列分隔线颜色（冻结数为 0 的轴不绘制） */
  freezeDividerColor: string
  /** 冻结分隔线宽（CSS 像素） */
  freezeDividerWidth: number
  /** 内建滚动条滑块默认色（灰阶三档的基准，随主题基调协调） */
  scrollbarThumb: string
  /** 内建滚动条滑块 hover 色（指针悬停滑块即时切换，一帧内反馈） */
  scrollbarThumbHover: string
  /** 内建滚动条滑块拖拽激活色（拖拽会话期间） */
  scrollbarThumbActive: string
  /** 内建滚动条圆角半径（CSS 像素；绘制时钳到厚度一半成胶囊形） */
  scrollbarRadius: number
  /** 内建滚动条条带厚度（CSS 像素；两轴交汇的右下空白角同厚） */
  scrollbarSize: number
  /** 滑块与条带边缘的内缩边距（仅横向内缩变细；纵向行程换算不受影响） */
  scrollbarMargin: number
  /** hover/拖拽态的内缩边距（收窄即视觉变粗，参照 univer margin 2→1） */
  scrollbarMarginHover: number
  /** 'scrolling' 显隐档静止后隐藏延时（ms；options.scrollbar.hideDelay 显式给定时优先） */
  scrollbarHideDelay: number
}

/** 表格外框样式 token */
export interface FrameStyle {
  /** 外框线宽（CSS 像素）；0 不绘制 */
  lineWidth: number
  /** 外框线色 */
  color: string
  /** 是否绘制外框阴影 */
  shadow: boolean
}

/** 表格主题：几何尺寸 + 数据格/行列头样式 + 交互/外框 token */
export interface TableTheme {
  rowHeight: number
  headerHeight: number
  rowHeaderWidth: number
  defaultColWidth: number
  body: CellStyleTokens
  header: CellStyleTokens
  /** 行号列样式分区（缺省随生效 header 派生） */
  rowHeader: CellStyleTokens
  /** 左上角样式分区（缺省随生效 header 派生） */
  corner: CellStyleTokens
  /** 数据区底色：格背景之下铺设（数据区外空白处直接可见） */
  underlayBackgroundColor: string
  /** 交互浮层 token */
  interaction: InteractionTokens
  /** 表格外框 */
  frameStyle: FrameStyle
}

/** extends 入参：token 全可选，嵌套对象按键深覆盖 */
export interface ThemeOverride {
  rowHeight?: number
  headerHeight?: number
  rowHeaderWidth?: number
  defaultColWidth?: number
  body?: Partial<CellStyleTokens>
  header?: Partial<CellStyleTokens>
  /** 缺省随生效 header 派生；给定的键覆盖派生值 */
  rowHeader?: Partial<CellStyleTokens>
  /** 缺省随生效 header 派生；给定的键覆盖派生值 */
  corner?: Partial<CellStyleTokens>
  underlayBackgroundColor?: string
  interaction?: Partial<InteractionTokens>
  frameStyle?: Partial<FrameStyle>
}

/** 默认主题：开箱可用（interaction 各值与既有交互浮层视觉一致） */
export const defaultTheme: TableTheme = {
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  body: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#ffffff',
    borderColor: '#e5e6eb',
  },
  header: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#f5f6f7',
    borderColor: '#e5e6eb',
  },
  rowHeader: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#f5f6f7',
    borderColor: '#e5e6eb',
  },
  corner: {
    font: '12px sans-serif',
    color: '#1f2329',
    background: '#f5f6f7',
    borderColor: '#e5e6eb',
  },
  underlayBackgroundColor: '#ffffff',
  interaction: {
    selectionFill: 'rgba(46, 106, 219, 0.08)',
    selectionBorder: '#2e6adb',
    selectionBorderWidth: 2,
    fillHandle: '#2e6adb',
    resizeLine: '#2e6adb',
    resizeLineWidth: 2,
    headerHighlight: 'rgba(46, 106, 219, 0.18)',
    // 比默认网格线（#e5e6eb）深一档，对齐 Excel 冻结分隔观感
    freezeDividerColor: '#c9cdd4',
    freezeDividerWidth: 1,
    // 滚动条三态色：基准灰（#1f2329 同源）按透明度分档，hover/激活逐级加深
    scrollbarThumb: 'rgba(31, 35, 41, 0.4)',
    scrollbarThumbHover: 'rgba(31, 35, 41, 0.55)',
    scrollbarThumbActive: 'rgba(31, 35, 41, 0.7)',
    scrollbarRadius: 4,
    scrollbarSize: 10,
    // 缺省内缩 2px（厚度 10 − 2×2 = 6），hover/拖拽收窄到 1px（厚度 8，视觉变粗）
    scrollbarMargin: 2,
    scrollbarMarginHover: 1,
    // 'scrolling' 档静止 1s 后隐藏（对齐 VTable autoHide 1000ms）
    scrollbarHideDelay: 1000,
  },
  frameStyle: {
    lineWidth: 0,
    color: '#e5e6eb',
    shadow: false,
  },
}

/**
 * 基于 base（缺省默认主题）派生主题：覆盖键生效，未覆盖的 token 继承 base。
 * rowHeader/corner 随「生效 header」（base+override 合并结果）派生，分区显式覆盖键最后生效——
 * 与拆分前行号列/角落直接沿用 header 样式的行为逐点一致。
 */
export function extendsTheme(
  override: ThemeOverride = {},
  base: TableTheme = defaultTheme,
): TableTheme {
  const header = { ...base.header, ...override.header }
  return {
    rowHeight: override.rowHeight ?? base.rowHeight,
    headerHeight: override.headerHeight ?? base.headerHeight,
    rowHeaderWidth: override.rowHeaderWidth ?? base.rowHeaderWidth,
    defaultColWidth: override.defaultColWidth ?? base.defaultColWidth,
    body: { ...base.body, ...override.body },
    header,
    rowHeader: { ...header, ...override.rowHeader },
    corner: { ...header, ...override.corner },
    underlayBackgroundColor: override.underlayBackgroundColor ?? base.underlayBackgroundColor,
    interaction: { ...base.interaction, ...override.interaction },
    frameStyle: { ...base.frameStyle, ...override.frameStyle },
  }
}

/**
 * 分区 token → 格样式基底（样式投影链的 base）：borderColor token 转右/下 1px
 * 默认网格边（收入本格，与逐格边框经 projectCellStyle 逐边合并——用户给了的边
 * 覆盖网格边，未给的边保留网格线）；显式 border token 逐边优先于网格边。
 */
export function themeCellBase(tokens: CellStyleTokens): CellStyle {
  const { borderColor, border, ...style } = tokens
  // 网格边打 grid 标记：共享边裁决（shared-edges.ts）据此让显式边恒胜网格派生边
  const grid: CellBorderEdge = { width: 1, color: borderColor, grid: true }
  return {
    ...style,
    border: { ...border, right: border?.right ?? grid, bottom: border?.bottom ?? grid },
  }
}

/** CSS 颜色的 rgba 分量（r/g/b 0~255，a 0~1） */
interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

/**
 * 解析主题 token 实际使用的 CSS 颜色形态：hex（#rgb/#rgba/#rrggbb/#rrggbbaa）、
 * rgb()/rgba()（逗号或空格斜杠分隔）、transparent 关键字；命名色等其余形态
 * 与含百分比的写法不解析（返回 null），调用方原样回退保旧观感。
 */
function parseColorToken(color: string): RgbaColor | null {
  const value = color.trim().toLowerCase()
  if (value === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      // 3/4 位 hex 只含 ASCII 码位，按码元拆分与码点等价
      const channels = hex.split('').map((c) => parseInt(c + c, 16))
      if (channels.some((c) => Number.isNaN(c))) {
        return null
      }
      return { r: channels[0]!, g: channels[1]!, b: channels[2]!, a: (channels[3] ?? 255) / 255 }
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
        return null
      }
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255
      return Number.isNaN(a) ? null : { r, g, b, a: a / 255 }
    }
    return null
  }
  const match = value.match(/^rgba?\(([^)]+)\)$/)
  if (!match || match[1]!.includes('%')) {
    return null
  }
  const parts = match[1]!.split(/[\s,/]+/).filter(Boolean)
  if (parts.length !== 3 && parts.length !== 4) {
    return null
  }
  const nums = parts.map((part) => Number.parseFloat(part))
  if (nums.some((n) => !Number.isFinite(n))) {
    return null
  }
  const [r, g, b] = nums
  const a = nums.length === 4 ? nums[3]! : 1
  return {
    r: Math.min(255, Math.max(0, r!)),
    g: Math.min(255, Math.max(0, g!)),
    b: Math.min(255, Math.max(0, b!)),
    a: Math.min(1, Math.max(0, a)),
  }
}

/**
 * 表头高亮合成辅助：interaction.headerHighlight 与表头分区铬底（header/rowHeader/
 * corner 各自 background）做 alpha 预混，产出不透明色——表头格以结果色替换背景后，
 * 其下滑入的正文内容不再透出（半透明 token 的透出缺陷）。token 本身不透明时结果
 * 等于原值；token 或铬底为不可解析形态、或铬底缺省时原样返回 highlight
 * （保持既有行为）。
 */
export function opaqueHeaderHighlight(
  highlight: string,
  chromeBackground: string | undefined,
): string {
  const overlay = parseColorToken(highlight)
  if (!overlay || overlay.a >= 1) {
    return highlight
  }
  const base = chromeBackground === undefined ? null : parseColorToken(chromeBackground)
  if (!base) {
    return highlight
  }
  const mix = (overlay_: number, chrome: number) =>
    Math.round(overlay_ * overlay.a + chrome * (1 - overlay.a))
  return `rgb(${mix(overlay.r, base.r)}, ${mix(overlay.g, base.g)}, ${mix(overlay.b, base.b)})`
}
