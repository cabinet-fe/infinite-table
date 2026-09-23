// wrap 行高估算：ultra-ui sheet-core grid-row-height-engine 的纯函数等价实现
// （原文件在 grid/ 适配层内，随 VTable 一起被替换，逻辑按行为契约重写）。

export const SHEET_DEFAULT_ROW_HEIGHT = 28
export const SHEET_DEFAULT_COL_WIDTH = 80
const DEFAULT_FONT_SIZE_PT = 11
/** 字符宽度系数（>0x7f 记 1.0 全角单位，否则 0.6） */
const CHAR_WIDTH_RATIO = 0.6
const LINE_HEIGHT_RATIO = 1.25
/** pt → px（96 DPI） */
export function fontSizePtToPx(pt: number): number {
  return Math.round((pt * 4) / 3)
}

/** 水平内边距合计（[2,6,2,6] 上右下左） */
const PAD_X = 6 * 2
const PAD_Y = 2 * 2

/**
 * 估算 wrap 文本行高：按 \n 分段，每段按字符宽度单位折行，行数 × 行高 + 内边距。
 * 与 ultra-ui 口径一致：结果不低于默认行高 28。
 */
export function estimateWrapRowHeight(input: {
  text: string
  colWidth: number
  fontSizePt?: number
}): number {
  const fontPx = fontSizePtToPx(input.fontSizePt ?? DEFAULT_FONT_SIZE_PT)
  const available = Math.max(fontPx, input.colWidth - PAD_X)
  let lines = 0
  for (const seg of input.text.split('\n')) {
    let units = 0
    for (const ch of seg) {
      units += ch.charCodeAt(0) > 0x7f ? 1 : CHAR_WIDTH_RATIO
    }
    lines += Math.max(1, Math.ceil((units * fontPx) / available))
  }
  return Math.max(SHEET_DEFAULT_ROW_HEIGHT, Math.ceil(lines * fontPx * LINE_HEIGHT_RATIO + PAD_Y))
}
