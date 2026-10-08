// 打印纸张几何（P1 headless 内核）：纸张预设尺寸表、横竖向、mm→px 换算、
// 可用页宽/页高推导与 fit-width 缩放系数。纯函数零 DOM（分层见 types.ts 文件头）。

import type {
  PrintConfig,
  PrintMargin,
  PrintOrientation,
  PrintPaperPreset,
  PrintPaperSpec,
} from './types'

/** mm → px 换算系数（96dpi：1 inch = 25.4mm = 96px） */
const MM_TO_PX = 96 / 25.4

/** px → mm 换算系数（@page 尺寸输出用，P2 消费） */
const PX_TO_MM = 25.4 / 96

/** mm → px */
export function mmToPx(mm: number): number {
  return mm * MM_TO_PX
}

/** px → mm */
export function pxToMm(px: number): number {
  return px * PX_TO_MM
}

/**
 * 纸张预设尺寸表（mm，portrait 口径宽×高）：
 * ISO A 系列标准值；Letter 为美制 8.5×11 inch（215.9×279.4mm）。
 */
export const PAPER_PRESETS_MM: Readonly<
  Record<PrintPaperPreset, { widthMm: number; heightMm: number }>
> = Object.freeze({
  A3: Object.freeze({ widthMm: 297, heightMm: 420 }),
  A4: Object.freeze({ widthMm: 210, heightMm: 297 }),
  A5: Object.freeze({ widthMm: 148, heightMm: 210 }),
  Letter: Object.freeze({ widthMm: 215.9, heightMm: 279.4 }),
})

/** 页边距缺省值（px，四边同距；≈12.7mm / 0.5 inch） */
export const DEFAULT_PRINT_MARGIN_PX = 48

/** 页眉/页脚缺省预留高（px；section 存在且未显式给高时预留） */
export const DEFAULT_HEADER_FOOTER_HEIGHT_PX = 32

/** 归一化页边距：单值展开四边、缺边回落缺省值 */
function normalizeMargin(margin: number | PrintMargin | undefined): Required<PrintMargin> {
  if (typeof margin === 'number') {
    return { top: margin, right: margin, bottom: margin, left: margin }
  }
  return {
    top: margin?.top ?? DEFAULT_PRINT_MARGIN_PX,
    right: margin?.right ?? DEFAULT_PRINT_MARGIN_PX,
    bottom: margin?.bottom ?? DEFAULT_PRINT_MARGIN_PX,
    left: margin?.left ?? DEFAULT_PRINT_MARGIN_PX,
  }
}

/**
 * 解析纸张实际尺寸（mm，含方向）：预设查表、自定义直取（portrait 口径宽高），
 * landscape 交换宽高。自定义尺寸非有限正数、未知预设代号抛 Error（配置错误快速失败）。
 */
export function resolvePaperSizeMm(
  spec: PrintPaperSpec | undefined,
  orientation: PrintOrientation | undefined,
): { widthMm: number; heightMm: number } {
  let portrait: { widthMm: number; heightMm: number }
  if (typeof spec === 'object') {
    const valid =
      Number.isFinite(spec.widthMm) &&
      spec.widthMm > 0 &&
      Number.isFinite(spec.heightMm) &&
      spec.heightMm > 0
    if (!valid) {
      throw new Error(`自定义纸张尺寸必须为有限正数（mm）：${JSON.stringify(spec)}`)
    }
    portrait = { widthMm: spec.widthMm, heightMm: spec.heightMm }
  } else if (spec === undefined) {
    portrait = PAPER_PRESETS_MM.A4
  } else {
    const preset = PAPER_PRESETS_MM[spec]
    if (!preset) {
      throw new Error(`未知纸张预设：${spec}（可用：A3/A4/A5/Letter 或自定义 mm）`)
    }
    portrait = preset
  }
  return orientation === 'landscape'
    ? { widthMm: portrait.heightMm, heightMm: portrait.widthMm }
    : { widthMm: portrait.widthMm, heightMm: portrait.heightMm }
}

/** 可用打印区域推导产物（px）：@page 全幅尺寸 + 边距 + 页眉页脚预留 + 内容可用宽高 */
export interface PrintableArea {
  /** 纸张全宽（px，@page 宽） */
  pageWidth: number
  /** 纸张全高（px，@page 高） */
  pageHeight: number
  /** 可用页宽（px = 纸宽 − 左右边距；下限 0） */
  width: number
  /** 可用页高（px = 纸高 − 上下边距 − 页眉高 − 页脚高；下限 0） */
  height: number
  /** 页眉预留高（px） */
  headerHeight: number
  /** 页脚预留高（px） */
  footerHeight: number
  /** 归一化后的四边距（px） */
  margin: Required<PrintMargin>
}

/**
 * 推导可用打印区域：纸宽 − 左右边距得可用页宽；纸高 − 上下边距 − 页眉页脚高得可用页高
 * （ureport2 fitpage 口径：页眉页脚不占数据区）。页眉/页脚高度取显式配置，
 * 缺省按 section 是否存在自动（存在预留 DEFAULT_HEADER_FOOTER_HEIGHT_PX，不存在 0）。
 * 边距/预留超出纸面时可用宽高夹取 0（分页退化为每页单行，配置问题在预览一望可知）。
 */
export function derivePrintableArea(config: PrintConfig): PrintableArea {
  const { widthMm, heightMm } = resolvePaperSizeMm(config.paperSize, config.orientation)
  const pageWidth = mmToPx(widthMm)
  const pageHeight = mmToPx(heightMm)
  const margin = normalizeMargin(config.margin)
  const headerHeight =
    config.headerFooter?.headerHeight ??
    (config.headerFooter?.header ? DEFAULT_HEADER_FOOTER_HEIGHT_PX : 0)
  const footerHeight =
    config.headerFooter?.footerHeight ??
    (config.headerFooter?.footer ? DEFAULT_HEADER_FOOTER_HEIGHT_PX : 0)
  return {
    pageWidth,
    pageHeight,
    width: Math.max(0, pageWidth - margin.left - margin.right),
    height: Math.max(0, pageHeight - margin.top - margin.bottom - headerHeight - footerHeight),
    headerHeight,
    footerHeight,
    margin,
  }
}

/**
 * fit-width 缩放系数：内容宽超可用页宽时等比缩小（系数 = 可用页宽 / 内容宽），
 * 内容不超页宽时保持 1（只缩不放——放大既糊版式又可能把行高顶出页高）。
 * 内容宽非正（空表）返回 1。
 */
export function fitWidthScale(contentWidth: number, area: PrintableArea): number {
  if (!(contentWidth > 0) || contentWidth <= area.width) {
    return 1
  }
  return area.width / contentWidth
}
