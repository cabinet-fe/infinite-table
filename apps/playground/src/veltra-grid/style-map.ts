// ultra-ui CellStyle（core/style）→ infinite-table CellStyle 的字段映射，
// 以及 sheet 铬合金观（表头/选区/网格线）的主题 token（对齐 ultra-ui vtable-theme 视觉值）。

import type { CellStyle as EngineCellStyle } from '@infinite-table/core'
import type { ThemeOverride } from '@infinite-table/core'
import type { CellStyle as VeltraCellStyle } from '@veltra/sheet-core'

const CHROME_BG = '#F5F5F5'
const GRID_BORDER = '#E1E4E8'
const SELECTION_BORDER = '#2170E7'
const SELECTION_BG = 'rgba(33, 112, 231, 0.12)'
/** VTable 全局默认字族（DEFAULTFONTFAMILY）：ultra-ui 各分区均未设字族，缺省即此值 */
const FONT_FAMILY = 'Arial,sans-serif'

/** ultra-ui BorderLineStyle → 引擎边框线型（宽度语义保留在 width 字段） */
function mapLineStyle(style: string): 'solid' | 'dashed' | 'dotted' {
  if (style === 'dashed') return 'dashed'
  if (style === 'dotted') return 'dotted'
  return 'solid'
}

/** ultra-ui CellStyle → 引擎 CellStyle；空样式返回 null（沿用基础样式） */
export function veltraStyleToEngine(style: VeltraCellStyle | undefined): EngineCellStyle | null {
  if (!style) return null
  const out: EngineCellStyle = {}
  if (style.fill) out.background = style.fill.color
  if (style.font) {
    if (style.font.color != null) out.color = style.font.color
    if (style.font.bold) out.fontWeight = 'bold'
    if (style.font.italic) out.fontStyle = 'italic'
    if (style.font.underline) out.underline = true
    if (style.font.strikethrough) out.lineThrough = true
    // ultra-ui 字号为 pt，引擎为 CSS 像素（×96/72）
    if (style.font.size != null) out.fontSize = Math.round((style.font.size * 4) / 3)
  }
  if (style.align) {
    if (style.align.horizontal) out.textAlign = style.align.horizontal
    if (style.align.vertical) out.verticalAlign = style.align.vertical
    if (style.align.wrap) out.textWrap = true
  }
  if (style.border) {
    const border: NonNullable<EngineCellStyle['border']> = {}
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const edge = style.border[side]
      if (edge) {
        border[side] = { width: edge.width, color: edge.color, style: mapLineStyle(edge.style) }
      }
    }
    out.border = border
  }
  return out
}

/** sheet 铬观主题：对齐 ultra-ui vtable-theme 的视觉值（表头/网格线/选区/hover 关闭） */
export function sheetChromeTheme(): ThemeOverride {
  return {
    rowHeight: 28,
    headerHeight: 28,
    rowHeaderWidth: 46,
    defaultColWidth: 80,
    underlayBackgroundColor: '#ffffff',
    body: {
      background: '#ffffff',
      borderColor: GRID_BORDER,
      padding: [2, 6, 2, 6],
      textOverflow: 'ellipsis',
      // 无样式格文本对齐 ultra-ui（VTable DEFAULT bodyStyle.fontSize 14 + 全局字色
      // #000、字族 Arial,sans-serif）；引擎缺省为 12px sans-serif #1f2329，需显式给出
      color: '#000',
      fontFamily: FONT_FAMILY,
      fontSize: 14,
    },
    header: {
      background: CHROME_BG,
      borderColor: GRID_BORDER,
      textAlign: 'center',
      fontWeight: 'normal',
      fontSize: 12,
      textOverflow: 'ellipsis',
      padding: [2, 6, 2, 6],
      // ultra-ui 表头字色走 VTable 全局默认 #000（defaultStyle.color）；字族同全局默认
      color: '#000',
      fontFamily: FONT_FAMILY,
    },
    rowHeader: {
      background: CHROME_BG,
      textAlign: 'center',
      fontWeight: 'normal',
      fontSize: 12,
    },
    interaction: {
      // ultra-ui 关闭 hover（hover: { disableHover: true }）：全透明等价
      hoverCell: 'rgba(0,0,0,0)',
      hoverBand: 'rgba(0,0,0,0)',
      selectionFill: SELECTION_BG,
      selectionBorder: SELECTION_BORDER,
      selectionBorderWidth: 2,
      // 整行/整列选区的表头带高亮：ultra-ui 由选区填充叠在 chrome 底色上（0.12 蓝 ×
      // #F5F5F5）；引擎为整格替换背景，取预混等价色 rgb(220,229,243)
      headerHighlight: '#dce5f3',
      // 冻结分隔线对齐 VTable frozenColumnLine.shadow（3px 浅灰带 rgba(225,228,232,.6)）。
      // 已知不可对齐项，注明原因：① VTable 无行冻结分隔线主题项，引擎两轴共用此 token，
      // 行分隔浅灰带为超集；② VTable 分隔线在组件层、绘于选区之上，引擎绘于选区之下，
      // 选区态叠加层序相反，但两侧均为半透明浅色、叠后不可辨；③ VTable 阴影带纵贯
      // 表头带，引擎分隔裁剪在 body 视口（表头段只有 1px 网格边）。另：dashed 边框
      // 段长 ultra-ui 为 borderLineDash [4,2]，引擎为 6/4（cell-node DASHED_SEGMENT，
      // 主题层不可配），点线 [1,2] 两侧一致。④ 整行/整列选区的 2px 边框 ultra-ui
      // 包住表头带（VTable 选区含表头格），引擎选区浮层裁剪在 body 视口、表头带以
      // headerHighlight 同色高亮替代（见上），边框顶边停在列头下缘。
      freezeDividerColor: 'rgba(225, 228, 232, 0.6)',
      freezeDividerWidth: 3,
    },
    frameStyle: { lineWidth: 1, color: GRID_BORDER, shadow: false },
  }
}

export { CHROME_BG, GRID_BORDER, SELECTION_BORDER }
