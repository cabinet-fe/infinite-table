// 页面 HTML 构建单测（P2 headless）：@page CSS（纸张/方向/边距）、合并 → rowspan/colspan、
// cellStyle 内联 CSS、fit-width 列宽缩放、fixrows 末页空白行、每页平铺水印、页眉页脚
// 占位符集成。断言全部落在 HTML 字符串上，零 DOM。

import { describe, expect, it } from 'vitest'

import type { CellRange, CellStyle } from '@infinitable/core'

import { buildPrintDocumentHtml, buildPrintPageHtml } from '../../src/print/page-html'
import { paginate } from '../../src/print/paginate'
import type { PrintConfig, PrintSource } from '../../src/print/types'

/** 测试数据源工厂：行高/列宽数组 + 行主序值矩阵 + 合并区 + 逐格样式 */
function makeSource(options: {
  rowHeights: number[]
  colWidths: number[]
  values?: unknown[][]
  merges?: CellRange[]
  styles?: Record<string, CellStyle>
}): PrintSource {
  const { rowHeights, colWidths, values = [], merges = [], styles = {} } = options
  return {
    name: '测试表',
    rowCount: rowHeights.length,
    colCount: colWidths.length,
    rowHeight: (row) => rowHeights[row] ?? 0,
    colWidth: (col) => colWidths[col] ?? 0,
    merges: () => merges,
    cellValue: (col, row) => values[row]?.[col],
    cellStyle: (col, row) => styles[`${row},${col}`],
    displayValue: (col, row) => values[row]?.[col],
  }
}

/**
 * 固定测试纸张（与 paginate.test 同口径）：254mm = 960px，边距 20px → 可用 920×920px。
 * 行高 100px × 10 行 → 两页 [0,9) / [9,10)。
 */
const PAPER_254: PrintConfig = { paperSize: { widthMm: 254, heightMm: 254 }, margin: 20 }

const TWO_PAGE_SOURCE = makeSource({
  rowHeights: Array.from({ length: 10 }, () => 100),
  colWidths: [100, 100, 100],
  values: Array.from({ length: 10 }, (_, row) => [
    `r${row}c0`,
    row < 9 ? row + 1 : 100,
    `r${row}c2`,
  ]),
})

/** 子串出现次数（空白行/行数断言用） */
function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1
}

describe('文档构建：@page CSS 与打印色彩', () => {
  it('预设纸张 + landscape 交换宽高 + 单值边距 px→mm', () => {
    const html = buildPrintDocumentHtml(TWO_PAGE_SOURCE, {
      paperSize: 'A4',
      orientation: 'landscape',
      margin: 20,
    })
    expect(html).toContain('@page { size: 297mm 210mm; margin: 5.29mm 5.29mm 5.29mm 5.29mm; }')
  })

  it('自定义 mm 纸张 + 四边独立边距顺序 top right bottom left', () => {
    const html = buildPrintDocumentHtml(TWO_PAGE_SOURCE, {
      paperSize: { widthMm: 254, heightMm: 127 },
      margin: { top: 10, right: 20, bottom: 30, left: 40 },
    })
    expect(html).toContain('size: 254mm 127mm')
    expect(html).toContain('margin: 2.65mm 5.29mm 7.94mm 10.58mm')
  })

  it('print-color-adjust: exact 输出（打印背景色/水印必需）+ 文档标题取表名', () => {
    const html = buildPrintDocumentHtml(TWO_PAGE_SOURCE, PAPER_254)
    expect(html).toContain('print-color-adjust: exact')
    expect(html).toContain('<title>测试表</title>')
  })

  it('空表兜底：单页空文档（无数据行仍出一页）', () => {
    const empty = makeSource({ rowHeights: [], colWidths: [100] })
    const html = buildPrintDocumentHtml(empty, PAPER_254)
    expect(countOf(html, '<div class="print-page">')).toBe(1)
    expect(html).toContain('<table class="print-table">')
  })
})

describe('页面构建：列宽与 fit-width 缩放', () => {
  /** 内容宽 1840px（10 列 × 184）超 920px 可用页宽 → 系数 0.5 */
  const WIDE_SOURCE = makeSource({
    rowHeights: Array.from({ length: 4 }, () => 100),
    colWidths: Array.from({ length: 10 }, () => 184),
  })

  it('origin：colgroup 直出原始列宽', () => {
    const html = buildPrintDocumentHtml(WIDE_SOURCE, PAPER_254)
    expect(html).toContain('<col style="width:184px">')
    expect(html).not.toContain('width:92px')
  })

  it('fit-width：列宽按缩放系数折半（184 → 92）', () => {
    const html = buildPrintDocumentHtml(WIDE_SOURCE, { ...PAPER_254, scale: 'fit-width' })
    expect(html).toContain('<col style="width:92px">')
    expect(html).not.toContain('width:184px')
  })
})

describe('页面构建：合并单元格与格样式', () => {
  const MERGED_SOURCE = makeSource({
    rowHeights: [30, 30, 30],
    colWidths: [100, 100, 100],
    values: [
      ['A', 'B', 'C'],
      ['D', 'E', 'F'],
      ['G', 'H', 'I'],
    ],
    merges: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 1 }],
    styles: {
      '0,0': { background: '#ffeeee', fontWeight: 'bold', textAlign: 'center' },
      '2,2': { border: { bottom: { width: 1, color: '#000' } } },
    },
  })

  it('主格 rowspan/colspan、客格跳过（值不出现在输出中）', () => {
    const html = buildPrintDocumentHtml(MERGED_SOURCE, PAPER_254)
    expect(html).toContain(
      '<td colspan="2" rowspan="2" style="background-color:#ffeeee;font-weight:bold;text-align:center">A</td>',
    )
    expect(html).not.toContain('>B<')
    expect(html).not.toContain('>D<')
    expect(html).not.toContain('>E<')
    expect(html).toContain('>C<')
    expect(html).toContain('>I<')
  })

  it('cellStyle → td 内联 CSS（含单边边框）', () => {
    const html = buildPrintDocumentHtml(MERGED_SOURCE, PAPER_254)
    expect(html).toMatch(/border-bottom:1px solid #000/)
  })

  it('特殊字符转义：格值含 < > & 时按文本输出', () => {
    const html = buildPrintDocumentHtml(
      makeSource({
        rowHeights: [30],
        colWidths: [100],
        values: [['<b>&"x"</b>']],
      }),
      PAPER_254,
    )
    expect(html).toContain('&lt;b&gt;&amp;"x"&lt;/b&gt;')
  })
})

describe('页面构建：fixrows 末页空白行与重复表头', () => {
  /** 6 行（首行表头）+ fixRows 4（表头 1 + 数据 3）→ 两页，末页 1 空白行 */
  const CONFIG: PrintConfig = { ...PAPER_254, paging: 'fixrows', fixRows: 4, headerRepeatRows: 1 }
  const SOURCE = makeSource({
    rowHeights: Array.from({ length: 6 }, () => 28),
    colWidths: [100, 100, 100],
    values: Array.from({ length: 6 }, (_, row) => [`H${row}`, `d${row}1`, `d${row}2`]),
  })

  it('末页补空白行：每页行数 = fixRows（表头 1 + 数据 + 空白）', () => {
    const pages = paginate(SOURCE, CONFIG)
    expect(pages).toHaveLength(2)
    const lastPage = buildPrintPageHtml(SOURCE, CONFIG, pages[1]!, 2, 2)
    // 表头 1 + 数据 2 + 空白 1 = 4 行；空白行单格跨全列
    expect(countOf(lastPage, '<tr')).toBe(4)
    expect(lastPage).toContain('<td colspan="3"></td>')
  })

  it('每页重复表头：第二页仍含首行表头值', () => {
    const secondPage = buildPrintPageHtml(SOURCE, CONFIG, paginate(SOURCE, CONFIG)[1]!, 2, 2)
    expect(secondPage).toContain('>H0<')
  })
})

describe('页面构建：页眉页脚与页级聚合集成', () => {
  const CONFIG: PrintConfig = {
    ...PAPER_254,
    headerFooter: {
      header: { center: '{title}' },
      footer: {
        left: '第 {page} 页 / 共 {pageCount} 页',
        right: '小计:{pageSum:1}',
      },
    },
  }

  it('两页各出「第 N 页 / 共 M 页」；页级小计按页内数据行求值', () => {
    const html = buildPrintDocumentHtml(TWO_PAGE_SOURCE, CONFIG)
    expect(html).toContain('第 1 页 / 共 2 页')
    expect(html).toContain('第 2 页 / 共 2 页')
    // 页眉页脚各预留 32px → 可用页高 856px → 页 1 数据行 0-7（列 1 合计 36）、页 2 行 8-9（9+100）
    expect(html).toContain('小计:36')
    expect(html).toContain('小计:109')
    expect(html).toContain('<td class="hf-center">测试表</td>')
  })
})

describe('页面构建：打印水印', () => {
  it('enabled 时每页输出平铺水印层（SVG data-URL 平铺单元）', () => {
    const config: PrintConfig = {
      ...PAPER_254,
      watermark: { enabled: true, text: 'CONFIDENTIAL' },
    }
    const pages = paginate(TWO_PAGE_SOURCE, config)
    for (const [index, page] of pages.entries()) {
      const pageHtml = buildPrintPageHtml(TWO_PAGE_SOURCE, config, page, index + 1, pages.length)
      expect(pageHtml).toContain('print-watermark')
      expect(pageHtml).toContain('data:image/svg+xml')
      expect(pageHtml).toContain('CONFIDENTIAL')
    }
  })

  it('水印 style 属性引号边界：URL 经属性转义，HTML 解析后 url(…) 完整不被截断', () => {
    // 文本混入 & < > 双引号 单引号：覆盖 data URL 内容里 encodeURIComponent 不编码的 ' 与转义链全层
    const config: PrintConfig = {
      ...PAPER_254,
      watermark: { enabled: true, text: `A&B"<'>` },
    }
    const pages = paginate(TWO_PAGE_SOURCE, config)
    const pageHtml = buildPrintPageHtml(TWO_PAGE_SOURCE, config, pages[0]!, 1, pages.length)
    // 属性层拦截：双引号属性值内不得出现裸 url("（出现即在 url( 处截断 background-image）
    expect(pageHtml).not.toContain('url("')
    // 解析层拦截：提取 style 属性值并按 HTML 反转义（浏览器喂给 CSS 的实际串），
    // 必须是完整成对引号的 url("data:image/svg+xml,…") 声明，且属性内无裸双引号截断
    const styleValue = /<div class="print-watermark" style="([^"]*)"/.exec(pageHtml)?.[1] ?? ''
    expect(styleValue).not.toBe('')
    const css = styleValue
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    expect(css).toMatch(/^background-image:url\("data:image\/svg\+xml,[^"]*"\)$/)
  })

  it('未配置 / enabled=false 不输出水印层（文档级水印样式常驻，断言只看层节点）', () => {
    expect(buildPrintDocumentHtml(TWO_PAGE_SOURCE, PAPER_254)).not.toContain(
      '<div class="print-watermark"',
    )
    expect(
      buildPrintDocumentHtml(TWO_PAGE_SOURCE, {
        ...PAPER_254,
        watermark: { enabled: false, text: 'CONFIDENTIAL' },
      }),
    ).not.toContain('data:image/svg+xml')
  })
})
