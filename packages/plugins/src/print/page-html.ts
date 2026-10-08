// 打印页面 HTML 构建（P2）：分页结果 → 可打印文档。单页 = 页眉带 + 表格体
// （colgroup 列宽应用 fit-width 缩放 / 合并单元格 → rowspan·colspan / cellStyle →
// td 内联 CSS / fixrows 末页空白行补齐）+ 页脚带 + 平铺水印层；文档级输出 @page
// 纸张/方向/边距 CSS 与 print-color-adjust: exact（浏览器打印背景色/水印必需）。
// 水印形态参照 meta export/print.ts 先例：单个平铺单元渲染为 SVG data-URL、
// 页内绝对定位层背景 repeat。纯函数零 DOM（分层见 types.ts 文件头）。

import type { CellStyle } from '@infinitable/core'

import { escapeAttr, escapeHtml } from './escape'
import { renderHeaderFooter, type PlaceholderContext } from './header-footer'
import { paginate, type PrintPage } from './paginate'
import { derivePrintableArea, pxToMm, resolvePaperSizeMm, type PrintableArea } from './paper'
import {
  WATERMARK_TEXT_DEFAULTS,
  type PrintConfig,
  type PrintSource,
  type WatermarkTextConfig,
} from './types'

/** 页面文档基础字号（px，与引擎缺省 12px 对齐） */
const PRINT_FONT_SIZE_PX = 12

/** 页面文档字体栈（对齐 meta 打印先例：西文 + 中文常见回退） */
const PRINT_FONT_STACK = "Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

/** CSS px / mm 数值输出精度（保留 2 位小数：免浮点尾差，px→mm 换算与缩放列宽可读） */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** {date} 求值（本地时区 yyyy-MM-dd） */
function formatPrintDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** {time} 求值（本地时区 HH:mm） */
function formatPrintTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 页级聚合取数：页内数据行在指定列上的有限数值（非数值项滤除，原始值口径） */
function collectColumnNumbers(source: PrintSource, page: PrintPage, col: number): number[] {
  const values: number[] = []
  for (let row = page.rowRange.start; row < page.rowRange.end; row++) {
    const value = source.cellValue(col, row)
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value)
    }
  }
  return values
}

/** 组装单页占位符上下文（页码/总页数/标题/时间戳 + 页级聚合取数闭包） */
function makePageContext(
  source: PrintSource,
  page: PrintPage,
  pageNumber: number,
  pageCount: number,
  date: string,
  time: string,
): PlaceholderContext {
  return {
    page: pageNumber,
    pageCount,
    title: source.name,
    date,
    time,
    columnNumbers: (col: number) => collectColumnNumbers(source, page, col),
  }
}

// ---- 合并单元格 → 本页 rowspan/colspan 映射 ----

/** 格坐标键（页内映射用，row 在前避免跨行串键） */
function cellKeyOf(row: number, col: number): string {
  return `${row},${col}`
}

/** 本页合并索引：主格跨度（rowspan 已按本页实际渲染行截断——跨页续排属非目标）+ 客格集合 */
interface PageMergeIndex {
  spans: Map<string, { rowspan: number; colspan: number }>
  covered: Set<string>
}

/**
 * 构建本页合并索引：
 * - 主格（合并区左上）在本页渲染行内 → 输出 rowspan（沿本页连续渲染行截断）+ colspan；
 * - 合并区覆盖的其余格全部记为客格（跳过渲染），含主格不在本页（在前页）的合并区残段。
 */
function buildPageMergeIndex(source: PrintSource, renderedRows: readonly number[]): PageMergeIndex {
  const positionOf = new Map<number, number>()
  renderedRows.forEach((row, index) => positionOf.set(row, index))
  const spans = new Map<string, { rowspan: number; colspan: number }>()
  const covered = new Set<string>()
  for (const range of source.merges()) {
    const anchorPosition = positionOf.get(range.startRow)
    let rowspan = 0
    if (anchorPosition !== undefined) {
      for (let row = range.startRow; row <= range.endRow; row++) {
        // 只累计本页连续渲染行（渲染行 = 重复表头行块 + 数据行块，块间不连续）
        if (positionOf.get(row) !== anchorPosition + rowspan) {
          break
        }
        rowspan++
      }
    }
    for (let row = range.startRow; row <= range.endRow; row++) {
      if (!positionOf.has(row)) {
        continue
      }
      for (let col = range.startCol; col <= range.endCol; col++) {
        if (rowspan > 0 && row === range.startRow && col === range.startCol) {
          continue // 主格本页输出
        }
        covered.add(cellKeyOf(row, col))
      }
    }
    if (rowspan > 0) {
      spans.set(cellKeyOf(range.startRow, range.startCol), {
        rowspan,
        colspan: range.endCol - range.startCol + 1,
      })
    }
  }
  return { spans, covered }
}

/** 有效格样式 → td 内联 CSS 声明串（字段口径对齐 core CellStyle，未给字段走文档级缺省） */
function cellStyleToCss(style: CellStyle): string {
  const decls: string[] = []
  if (style.background) {
    decls.push(`background-color:${style.background}`)
  }
  if (style.color) {
    decls.push(`color:${style.color}`)
  }
  if (style.font) {
    decls.push(`font:${style.font}`)
  }
  if (style.fontWeight !== undefined) {
    decls.push(`font-weight:${style.fontWeight}`)
  }
  if (style.fontStyle) {
    decls.push(`font-style:${style.fontStyle}`)
  }
  if (style.fontSize !== undefined) {
    decls.push(`font-size:${style.fontSize}px`)
  }
  if (style.fontFamily) {
    decls.push(`font-family:${style.fontFamily}`)
  }
  if (style.textAlign) {
    decls.push(`text-align:${style.textAlign}`)
  }
  if (style.verticalAlign) {
    decls.push(`vertical-align:${style.verticalAlign}`)
  }
  const decoration = [style.underline ? 'underline' : '', style.lineThrough ? 'line-through' : '']
    .filter((part) => part !== '')
    .join(' ')
  if (decoration) {
    decls.push(`text-decoration:${decoration}`)
  }
  if (style.textWrap) {
    decls.push('white-space:normal;word-break:break-word')
  } else if (style.textOverflow) {
    decls.push(`overflow:hidden;text-overflow:${style.textOverflow}`)
  }
  if (style.padding) {
    const [top, right, bottom, left] = style.padding
    decls.push(`padding:${top}px ${right}px ${bottom}px ${left}px`)
  }
  const border = style.border
  if (border) {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const edge = border[side]
      if (edge) {
        decls.push(`border-${side}:${edge.width}px ${edge.style ?? 'solid'} ${edge.color}`)
      }
    }
  }
  return decls.join(';')
}

/** 单元格显示文本（null/undefined 出空串，其余 String 化后转义） */
function cellText(value: unknown): string {
  return value == null ? '' : escapeHtml(String(value))
}

/** 本页表格体：colgroup（列宽 × 本页缩放）+ 重复表头行 + 数据行 + 空白行补齐 */
function buildPageTableHtml(source: PrintSource, page: PrintPage): string {
  const scale = page.scale
  const parts: string[] = ['<table class="print-table">']
  parts.push('<colgroup>')
  for (let col = 0; col < source.colCount; col++) {
    parts.push(`<col style="width:${round2(source.colWidth(col) * scale)}px">`)
  }
  parts.push('</colgroup>')

  // 本页渲染行（源行号，重复表头行在前）
  const renderedRows: number[] = []
  if (page.headerRows) {
    for (let row = page.headerRows.start; row < page.headerRows.end; row++) {
      renderedRows.push(row)
    }
  }
  for (let row = page.rowRange.start; row < page.rowRange.end; row++) {
    renderedRows.push(row)
  }
  const merges = buildPageMergeIndex(source, renderedRows)

  for (const row of renderedRows) {
    parts.push(`<tr style="height:${round2(source.rowHeight(row) * scale)}px">`)
    for (let col = 0; col < source.colCount; col++) {
      const key = cellKeyOf(row, col)
      if (merges.covered.has(key)) {
        continue
      }
      const span = merges.spans.get(key)
      const attrs: string[] = []
      if (span && span.colspan > 1) {
        attrs.push(`colspan="${span.colspan}"`)
      }
      if (span && span.rowspan > 1) {
        attrs.push(`rowspan="${span.rowspan}"`)
      }
      const style = source.cellStyle(col, row)
      const css = style ? cellStyleToCss(style) : ''
      if (css) {
        attrs.push(`style="${escapeAttr(css)}"`)
      }
      parts.push(
        `<td${attrs.length > 0 ? ` ${attrs.join(' ')}` : ''}>${cellText(source.displayValue(col, row))}</td>`,
      )
    }
    parts.push('</tr>')
  }

  // fixrows 末页空白行：高度取表末行高（行栅格口径与数据行一致），单格跨全列
  if (page.blankRows > 0 && source.rowCount > 0) {
    const blankHeight = round2(source.rowHeight(source.rowCount - 1) * scale)
    for (let i = 0; i < page.blankRows; i++) {
      parts.push(`<tr style="height:${blankHeight}px"><td colspan="${source.colCount}"></td></tr>`)
    }
  }

  parts.push('</table>')
  return parts.join('')
}

/**
 * 水印单个平铺单元 → SVG data-URL（文本经 XML 转义 + 整体 URI 编码：内容中的 `"` 与
 * `&` 均 %xx 化，不破坏 CSS `url()` 内边界；嵌入双引号 style 属性的外边界由
 * `buildWatermarkHtml` 过 `escapeAttr` 承担——裸 `url("…")` 会被 HTML 解析在 `url(`
 * 后截断属性值）。
 */
function buildWatermarkTileUrl(watermark: WatermarkTextConfig): string {
  const defaults = WATERMARK_TEXT_DEFAULTS
  const gapX = watermark.gapX ?? defaults.gapX
  const gapY = watermark.gapY ?? defaults.gapY
  const cx = gapX / 2
  const cy = gapY / 2
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${gapX}" height="${gapY}">` +
    `<text x="${cx}" y="${cy}" transform="rotate(${watermark.rotate ?? defaults.rotate} ${cx} ${cy})"` +
    ' text-anchor="middle" dominant-baseline="middle"' +
    ` font-size="${watermark.fontSize ?? defaults.fontSize}"` +
    ` fill="${watermark.color ?? defaults.color}" fill-opacity="${watermark.opacity ?? defaults.opacity}">` +
    `${escapeHtml(watermark.text)}</text></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * 页内平铺水印层：绝对定位铺满页面，背景 repeat（形态对齐 meta 打印先例）。CSS 值
 * 与 td 内联样式同口径过 `escapeAttr` 嵌入双引号 style 属性：HTML 解析反转义后
 * `url("data:…")` 引号完整成对，浏览器拿到合法 background-image。
 */
function buildWatermarkHtml(watermark: WatermarkTextConfig): string {
  const css = `background-image:${buildWatermarkTileUrl(watermark)}`
  return `<div class="print-watermark" style="${escapeAttr(css)}"></div>`
}

/** 单页文档片段：页眉带（预留 headerHeight）+ 表格体 + 页脚带（预留 footerHeight）+ 水印层 */
function buildPageHtml(
  source: PrintSource,
  config: PrintConfig,
  page: PrintPage,
  pageNumber: number,
  pageCount: number,
  date: string,
  time: string,
): string {
  const ctx = makePageContext(source, page, pageNumber, pageCount, date, time)
  const parts: string[] = ['<div class="print-page">']
  parts.push(renderHeaderFooter(config.headerFooter?.header, ctx, 'header'))
  parts.push(`<div class="print-body">${buildPageTableHtml(source, page)}</div>`)
  parts.push(renderHeaderFooter(config.headerFooter?.footer, ctx, 'footer'))
  if (config.watermark?.enabled) {
    parts.push(buildWatermarkHtml(config.watermark))
  }
  parts.push('</div>')
  return parts.join('')
}

/**
 * 文档级 CSS：@page 纸张（landscape 已换宽高）/四边距（px→mm）；页容器 flex 列布局、
 * min-height = 可打印高（纸高 − 边距，页眉页脚预留含其中），页间强制分页；水印层平铺。
 */
function buildDocumentCss(config: PrintConfig, area: PrintableArea): string {
  const { widthMm, heightMm } = resolvePaperSizeMm(config.paperSize, config.orientation)
  const margin = area.margin
  const mm = (px: number): string => `${round2(pxToMm(px))}mm`
  const printableHeight = round2(area.height + area.headerHeight + area.footerHeight)
  return [
    `@page { size: ${round2(widthMm)}mm ${round2(heightMm)}mm;` +
      ` margin: ${mm(margin.top)} ${mm(margin.right)} ${mm(margin.bottom)} ${mm(margin.left)}; }`,
    'html, body { margin: 0; padding: 0; }',
    `body { font-family: ${PRINT_FONT_STACK}; font-size: ${PRINT_FONT_SIZE_PX}px; color: #1f2329;` +
      ' -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
    `.print-page { position: relative; display: flex; flex-direction: column;` +
      ` min-height: ${printableHeight}px; overflow: hidden; page-break-after: always; break-after: page; }`,
    '.print-page:last-child { page-break-after: auto; break-after: auto; }',
    '.print-header, .print-footer { flex: none; width: 100%; border-collapse: collapse; table-layout: fixed; }',
    '.print-header td, .print-footer td { width: 33.33%; padding: 0 4px; white-space: nowrap; overflow: hidden; }',
    '.hf-left { text-align: left; }',
    '.hf-center { text-align: center; }',
    '.hf-right { text-align: right; }',
    '.print-body { flex: 1 1 auto; }',
    '.print-table { border-collapse: collapse; table-layout: fixed; }',
    '.print-table tr { break-inside: avoid; }',
    '.print-table td { box-sizing: border-box; padding: 0 8px; overflow: hidden; white-space: nowrap;' +
      ' vertical-align: middle; text-align: left; }',
    '.print-watermark { position: absolute; inset: 0; background-repeat: repeat; pointer-events: none; }',
  ].join('\n')
}

/** 空表兜底页：重复表头照常输出、无数据行（打印空表仍出一页带页眉页脚的空白纸） */
function emptyPage(config: PrintConfig, rowCount: number): PrintPage {
  const headerRepeat = Math.max(0, Math.min(config.headerRepeatRows ?? 0, rowCount))
  return {
    rowRange: { start: 0, end: 0 },
    headerRows: headerRepeat > 0 ? { start: 0, end: headerRepeat } : null,
    blankRows: 0,
    scale: 1,
  }
}

/**
 * 构建完整打印文档 HTML（headless 纯函数）：分页 → 各页片段拼装。全页共享同一
 * 时间戳（同一次打印的 {date}/{time} 一致）；空表输出单页兜底。P3 预览薄壳与
 * print-output 的 iframe 装载均消费本产物。
 */
export function buildPrintDocumentHtml(source: PrintSource, config: PrintConfig): string {
  const pages = paginate(source, config)
  const area = derivePrintableArea(config)
  const now = new Date()
  const date = formatPrintDate(now)
  const time = formatPrintTime(now)
  const pageList = pages.length > 0 ? pages : [emptyPage(config, source.rowCount)]
  const parts: string[] = []
  parts.push('<!doctype html><html><head><meta charset="utf-8">')
  parts.push(`<title>${escapeHtml(source.name)}</title>`)
  parts.push(`<style>\n${buildDocumentCss(config, area)}\n</style></head><body>`)
  pageList.forEach((page, index) => {
    parts.push(buildPageHtml(source, config, page, index + 1, pageList.length, date, time))
  })
  parts.push('</body></html>')
  return parts.join('')
}

/**
 * 构建单页 HTML 片段（headless 纯函数，P3 预览逐页消费）：页眉 + 表格体 + 页脚 +
 * 水印层。时间戳取调用时刻（逐页单独调用可能跨分钟边界，整文档打印请用
 * buildPrintDocumentHtml 的共享时间戳口径）。
 */
export function buildPrintPageHtml(
  source: PrintSource,
  config: PrintConfig,
  page: PrintPage,
  pageNumber: number,
  pageCount: number,
): string {
  const now = new Date()
  return buildPageHtml(
    source,
    config,
    page,
    pageNumber,
    pageCount,
    formatPrintDate(now),
    formatPrintTime(now),
  )
}
