// 打印输出测试（v4）：PrintSource 适配（数据态快照 → print 插件供数）、同一数据集
// 多表达式形态口径、数据块/聚合取数并集、聚合作数据源与函数求值进打印产物、明细跨页
// 自动分页、弹框配置不落模板、预览与打印同输入同输出（一致性）。打印输出路径
// （iframe 装载）需要 DOM，由 testing/dom 统一挂载。
import { describe, expect, test } from 'bun:test'
import { BORDER_STYLE_WIDTH, Sheet } from '@infinitable/sheet'

import type { SourceRow } from '../../src/transform/reshape'
import { FormDoc } from '../../src/designer/form-doc'
import {
  DEFAULT_PRINT_SETTINGS,
  toPrintConfig,
  type DialogPrintSettings,
} from '../../src/designer/PrintDialog'
import { collectDatasetIds, collectRegionSources, preparePrintSession } from '../../src/designer/print-source'
import {
  TEMPLATE_SCHEMA_VERSION,
  type FormTemplate,
  type RegionSource,
} from '../../src/designer/template'
import { domWindow, setupDom } from './testing/dom'
import { ADDR, relativeBinding } from './testing/fixtures'

setupDom()

/** 明细数据集的数据块源：原始行数组即循环源（列表样口径） */
const DETAIL_SOURCE: RegionSource = { kind: 'dataset', datasetId: 'ds1', path: '' }

/** 单行向下展开区模板：静态首行 / 静态次行 / 展开行 / 静态尾行（4 列） */
function detailDoc(): FormDoc {
  const template: FormTemplate = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 't',
    regions: [
      { startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'none' },
      { startRow: 1, endRow: 1, startCol: 0, endCol: 3, expand: 'none' },
      { startRow: 2, endRow: 2, startCol: 0, endCol: 3, expand: 'down', source: DETAIL_SOURCE },
      { startRow: 3, endRow: 3, startCol: 0, endCol: 3, expand: 'none' },
    ],
    aggregations: [],
    sheet: new Sheet('form').snapshot(),
  }
  return FormDoc.fromTemplate(template)
}

/** N 条明细的原始行（列名 name/no），供数据块 source 循环展开 */
function itemRows(count: number): SourceRow[] {
  return Array.from({ length: count }, (_, i) => ({ name: `货品${i + 1}`, no: i + 1 }))
}

/** 纯展开区模板（1 行明细，4 列）：分组换页断言用最小形态（col 0 组键 / col 1 明细） */
function groupedDoc(): FormDoc {
  const template: FormTemplate = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 't',
    regions: [
      { startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'down', source: DETAIL_SOURCE },
    ],
    aggregations: [],
    sheet: new Sheet('form').snapshot(),
  }
  const doc = FormDoc.fromTemplate(template)
  doc.setCellBinding(ADDR(0, 0), relativeBinding('group'))
  doc.setCellBinding(ADDR(0, 1), relativeBinding('name'))
  return doc
}

describe('PrintSource 适配（数据态快照 → print 插件供数）', () => {
  test('行列几何：自定义行高列宽生效，未自定义回落内置缺省', () => {
    const doc = detailDoc()
    doc.setRowHeight(0, 40)
    doc.setColWidth(0, 120)
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const session = preparePrintSession(doc, new Map([['ds1', itemRows(2)]]), 't')
    // 3 行模板外行 + 2 条明细 = 5 行；4 列（分页列区间覆盖全列）
    expect(session.plugin.paginate({})[0]?.colRange).toEqual({ start: 0, end: 4 })
    // 供数几何：行 0 自定义 40，行 1 缺省 28；列 0 自定义 120，列 1 缺省 80
    const preview = session.previewHtml({})
    expect(preview).toContain('height:40px')
    expect(preview).toContain('height:28px')
    expect(preview).toContain('width:120px')
    expect(preview).toContain('width:80px')
  })

  test('cellValue/displayValue：数据块绑定值进格，numFmt 走显示链（含函数格）', () => {
    const doc = detailDoc()
    // 静态带源的数据块：绑定 + 函数都可取数（第 0 行）
    doc.setRegionSource(0, DETAIL_SOURCE)
    doc.sheet.setCellStyle(
      { start: ADDR(0, 1), end: ADDR(0, 1) },
      {
        numFmt: { type: 'fixed', digits: 2 },
      },
    )
    doc.setCellBinding(ADDR(0, 0), relativeBinding('name'))
    doc.setCellBinding(ADDR(0, 1), relativeBinding('rate'))
    const session = preparePrintSession(doc, new Map([['ds1', [{ name: '甲', rate: 3.14159 }]]]), 't')
    const html = session.previewHtml({})
    expect(html).toContain('甲')
    // 显示值经 numFmt 固定两位小数（打印 HTML 内为转义文本）
    expect(html).toContain('3.14')
    expect(html).not.toContain('3.14159')
  })

  test('cellStyle：fill/字重/边框映射到打印样式投影', () => {
    const doc = detailDoc()
    const edge = { style: 'thin' as const, width: BORDER_STYLE_WIDTH.thin, color: '#112233' }
    doc.sheet.setCellStyle(
      { start: ADDR(0, 0), end: ADDR(0, 0) },
      {
        fill: { color: '#ffeeaa' },
        font: { bold: true },
        border: { top: edge, right: edge, bottom: edge, left: edge },
      },
    )
    const session = preparePrintSession(doc, new Map(), 't')
    const html = session.previewHtml({})
    expect(html).toContain('background-color:#ffeeaa')
    expect(html).toContain('font-weight:bold')
    expect(html).toContain(`border-top:${BORDER_STYLE_WIDTH.thin}px solid #112233`)
  })

  test('merges：模型合并区映射为打印内核扁平区间', () => {
    const doc = detailDoc()
    doc.sheet.mergeCells({ start: ADDR(0, 0), end: ADDR(0, 1) })
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const session = preparePrintSession(doc, new Map([['ds1', itemRows(1)]]), 't')
    const html = session.previewHtml({})
    expect(html).toContain('<td colspan="2"')
  })

  test('同一数据集多表达式：各数据块按自己的 source 表达式取形态', () => {
    const doc = detailDoc()
    const rows = [{ title: '甲公司', name: 'x' }]
    // 展开行用原始行数组形态；第 0 行静态带源的数据块用截取表达式（循环数组第 1 条）
    doc.setRegionSource(0, {
      kind: 'dataset',
      datasetId: 'ds1',
      expression: 'rows.slice(0, 1)',
      path: '',
    })
    doc.setCellBinding(ADDR(0, 0), relativeBinding('title'))
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const html = preparePrintSession(doc, new Map([['ds1', rows]]), 't').previewHtml({})
    // 表达式形态（截取首行）与原始行形态同数据集并存，各取各值
    expect(html).toContain('甲公司')
    expect(html).toContain('>x<')
  })

  test('取数并集：数据块数据源 + 聚合入参都进 collectDatasetIds', () => {
    const doc = detailDoc()
    // 明细格只有相对字段（不带 datasetId），唯一的数据集引用来自数据块 source
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    doc.setAggregations([
      { name: 'n', type: 'value', params: [{ datasetId: 'ds2', varName: 'r' }], expression: 'return r.length' },
    ])
    expect(collectDatasetIds(doc)).toEqual(['ds1', 'ds2'])
    expect(collectRegionSources(doc)).toEqual([DETAIL_SOURCE])
    // 若数据块 source 不进形态集合，这里会一行明细都取不到
    const html = preparePrintSession(doc, new Map([['ds1', itemRows(2)], ['ds2', itemRows(3)]]), 't').previewHtml({})
    expect(html).toContain('货品1')
    expect(html).toContain('货品2')
  })

  test('聚合进打印管线：agg 作数据块数据源 + 函数引用 agg', () => {
    const doc = detailDoc()
    doc.setAggregations([
      {
        // 返回单个订单对象（value 型）：数据块源从其 items 键挖循环数组，函数直接引用其字段
        name: 'first',
        type: 'value',
        params: [{ datasetId: 'ds2', varName: 'r' }],
        expression: 'return r[0]',
      },
    ])
    // 第 0 行静态数据块改吃聚合结果（循环数组第 1 条）
    doc.setRegionSource(0, { kind: 'agg', aggName: 'first', path: 'items' })
    doc.setCellBinding(ADDR(0, 0), relativeBinding('qty'))
    // 数据块外函数引用聚合结果
    doc.setCellFunction(ADDR(3, 0), { expression: "agg.first['label']" })
    const rows = new Map([['ds1', itemRows(1)], ['ds2', [{ label: '首单', items: [{ qty: 7 }] }]]])
    const html = preparePrintSession(doc, rows, 't').previewHtml({})
    expect(html).toContain('>7<')
    expect(html).toContain('首单')
  })
})

describe('展开区跨页自动分页', () => {
  test('长明细展开后按行高分页：页数、行分布与行覆盖正确', () => {
    const doc = detailDoc()
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const count = 60
    const session = preparePrintSession(doc, new Map([['ds1', itemRows(count)]]), 't')
    // A4 纵向缺省边距：可用页高 = 297mm×96/25.4 − 96 ≈ 1026.5px；行高缺省 28px → 每页 36 行
    // 总行数 = 3 行模板外行 + 60 行明细 = 63 → 2 页（36 + 27）
    const config = toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 0 })
    const pages = session.plugin.paginate(config)
    expect(pages.length).toBe(2)
    // 覆盖连续且完整：首页从 0 起，相邻页首尾相接，末页到总行数
    expect(pages[0]!.rowRange.start).toBe(0)
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]!.rowRange.start).toBe(pages[i - 1]!.rowRange.end)
    }
    const total = 3 + count
    expect(pages[pages.length - 1]!.rowRange.end).toBe(total)
    // 行分布上限：每页数据行高和不超过可用页高（单行不截断除外，本例无超高行）
    for (const page of pages) {
      expect((page.rowRange.end - page.rowRange.start) * 28).toBeLessThanOrEqual(1026.5)
    }
    // 打印产物包含首末明细（全部行进入输出）
    const html = session.previewHtml(config)
    expect(html).toContain('货品1')
    expect(html).toContain(`货品${count}`)
  })

  test('重复表头：每页先输出表头行区间，数据域从表头带之后开始', () => {
    const doc = detailDoc()
    doc.sheet.setCellValue(ADDR(0, 0), '页眉标题')
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const count = 60
    const session = preparePrintSession(doc, new Map([['ds1', itemRows(count)]]), 't')
    const config = toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 1 })
    const pages = session.plugin.paginate(config)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      expect(page.headerRows).toEqual({ start: 0, end: 1 })
      expect(page.rowRange.start).toBeGreaterThanOrEqual(1)
    }
    // 每页 HTML 都带表头文本
    const html = session.previewHtml(config)
    expect(html.match(/页眉标题/g)?.length).toBe(pages.length)
  })

  test('分组换页：组值变化处强制分页，每页只含一组明细（不跨组）', () => {
    const doc = groupedDoc()
    const rows: SourceRow[] = [
      { group: '单A', name: '货品1' },
      { group: '单A', name: '货品2' },
      { group: '单B', name: '货品3' },
      { group: '单B', name: '货品4' },
      { group: '单B', name: '货品5' },
    ]
    const session = preparePrintSession(doc, new Map([['ds1', rows]]), 't')
    const config = toPrintConfig({
      ...DEFAULT_PRINT_SETTINGS,
      headerRepeatRows: 0,
      groupBreakCol: 1,
    })
    // 分页产物：两组各一页，行区间恰按组边界切分（2 + 3 行），不跨组
    const pages = session.plugin.paginate(config)
    expect(pages.map((page) => [page.rowRange.start, page.rowRange.end])).toEqual([
      [0, 2],
      [2, 5],
    ])
    // 页面构建产物：每页只含本组明细（分组列值与明细值都不越页）
    const parsed = new domWindow.DOMParser().parseFromString(
      session.previewHtml(config),
      'text/html',
    )
    const pageEls = parsed.querySelectorAll('.print-page')
    expect(pageEls.length).toBe(2)
    expect(pageEls[0]!.textContent).toContain('单A')
    expect(pageEls[0]!.textContent).toContain('货品2')
    expect(pageEls[0]!.textContent).not.toContain('单B')
    expect(pageEls[1]!.textContent).toContain('单B')
    expect(pageEls[1]!.textContent).toContain('货品5')
    expect(pageEls[1]!.textContent).not.toContain('单A')
  })
})

describe('弹框配置不落模板', () => {
  test('完整打印流程后模板 JSON 不变且不含纸张/边距/缩放/分页字段', () => {
    const doc = detailDoc()
    doc.setRowHeight(0, 40)
    doc.sheet.setCellValue(ADDR(0, 0), '标题')
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const before = JSON.stringify(doc.toTemplate('t'))
    // 走完整弹框链路：全量配置取数 → 预览 → 分页 → 打印文档构建
    const settings: DialogPrintSettings = {
      ...DEFAULT_PRINT_SETTINGS,
      headerRepeatRows: 1,
      paper: 'A5',
      orientation: 'landscape',
      marginPx: 20,
      scaleMode: 'percent',
      percent: 80,
      paging: 'fixrows',
      fixRows: 15,
      groupBreakCol: 1,
    }
    const config = toPrintConfig(settings)
    const session = preparePrintSession(doc, new Map([['ds1', itemRows(30)]]), 't')
    expect(session.plugin.paginate(config).length).toBeGreaterThan(0)
    expect(session.previewHtml(config)).toContain('<table class="print-table">')
    const after = JSON.stringify(doc.toTemplate('t'))
    expect(after).toBe(before)
    for (const forbidden of [
      'paperSize',
      'paper',
      'margin',
      'scale',
      'pagination',
      'pageSize',
      'orientation',
      'fixRows',
      'headerRepeatRows',
      'groupBreakBy',
    ]) {
      expect(after).not.toContain(`"${forbidden}"`)
    }
  })
})

describe('预览与打印一致（同输入同输出）', () => {
  test('两个独立会话（预览实例 / 打印实例）构建的文档 HTML 完全一致', () => {
    const doc = detailDoc()
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const rowsByDataset = new Map([['ds1', itemRows(10)]])
    const config = toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 1 })
    const previewSession = preparePrintSession(doc, rowsByDataset, 't')
    const printSession = preparePrintSession(doc, rowsByDataset, 't')
    expect(previewSession.previewHtml(config)).toBe(printSession.previewHtml(config))
  })

  test('打印输出 iframe 装载的文档与预览 HTML 逐字节一致', async () => {
    const doc = detailDoc()
    doc.setCellBinding(ADDR(2, 0), relativeBinding('name'))
    const config = toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 0 })
    const frames: HTMLIFrameElement[] = []
    const printSession = preparePrintSession(doc, new Map([['ds1', itemRows(5)]]), 't', {
      print: (iframe) => {
        frames.push(iframe)
      },
    })
    const previewHtml = preparePrintSession(doc, new Map([['ds1', itemRows(5)]]), 't').previewHtml(
      config,
    )
    await printSession.print(config)
    expect(frames).toHaveLength(1)
    expect(frames[0]!.srcdoc).toBe(previewHtml)
  })
})

describe('弹框配置映射（toPrintConfig）', () => {
  test('缩放档、fixrows 门槛与分组列 1 起转 0 起', () => {
    expect(toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 0 }).scale).toBe('origin')
    expect(
      toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 0, scaleMode: 'fit-width' })
        .scale,
    ).toBe('fit-width')
    expect(
      toPrintConfig({
        ...DEFAULT_PRINT_SETTINGS,
        headerRepeatRows: 0,
        scaleMode: 'percent',
        percent: 80,
      }).scale,
    ).toEqual({ percent: 80 })
    const fixrows = toPrintConfig({
      ...DEFAULT_PRINT_SETTINGS,
      headerRepeatRows: 0,
      paging: 'fixrows',
      fixRows: 15,
      groupBreakCol: 2,
    })
    expect(fixrows.fixRows).toBe(15)
    expect(fixrows.groupBreakBy).toBe(1)
    expect(
      toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 0 }).fixRows,
    ).toBeUndefined()
    expect(
      toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 0 }).groupBreakBy,
    ).toBeUndefined()
  })
})
