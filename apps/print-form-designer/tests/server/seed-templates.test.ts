// P9 内置起点模板：seed 幂等落两份模板（列表样/中式单据）；空库首启经 REST 加载 →
// FormDoc 还原画布 → 打印会话直接产出两种形态成品（列表样多列明细；中式单据框线/
// 合计大写/签字区），明细展开与分页正确，且模板 JSON 不含打印弹框配置键。
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { toSourceRows, type QueryResult, type TemplateRecord } from '../../src/data/api'
import { FormDoc } from '../../src/designer/form-doc'
import { DEFAULT_PRINT_SETTINGS, toPrintConfig } from '../../src/designer/PrintDialog'
import { preparePrintSession } from '../../src/designer/print-source'
import { TEMPLATE_SCHEMA_VERSION, type RegionSource } from '../../src/designer/template'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedDemoLibrary } from '../../src/server/seed'
import { SEED_TEMPLATE_CN_DOC_ID, SEED_TEMPLATE_LIST_ID } from '../../src/server/seed-templates'
import type { SourceRow } from '../../src/transform/reshape'
import { createTempDir } from './testing/demo-source'

/** A4 纵向缺省弹框配置（表头不重复；单页形态断言用） */
const PRINT_CONFIG = toPrintConfig({ ...DEFAULT_PRINT_SETTINGS, headerRepeatRows: 0 })

/** 空库首启环境：内存库 seed 一次，提供 REST 直连的模板加载与数据集取数 */
async function bootSeededApp() {
  const db = openDatabase(':memory:')
  seedDemoLibrary(db, { demoPath: join(createTempDir(), 'demo.sqlite') })
  const app = createApp(db)
  const loadTemplate = async (id: string): Promise<TemplateRecord> =>
    (await (await app.request(`/api/templates/${id}`)).json()) as TemplateRecord
  const fetchRows = async (datasetId: string): Promise<SourceRow[]> =>
    toSourceRows(
      (await (
        await app.request(`/api/datasets/${datasetId}/execute`, { method: 'POST' })
      ).json()) as QueryResult,
    )
  return { loadTemplate, fetchRows }
}

describe('seed 幂等落内置模板', () => {
  test('空库 seed 后两份内置模板经 REST 可见可加载，二次 seed 不重复', async () => {
    const db = openDatabase(':memory:')
    const demoPath = join(createTempDir(), 'demo.sqlite')
    seedDemoLibrary(db, { demoPath })
    seedDemoLibrary(db, { demoPath })
    const app = createApp(db)

    const list = (await (await app.request('/api/templates')).json()) as TemplateRecord[]
    const seedIds = list
      .map((item) => item.id)
      .filter((id) => id === SEED_TEMPLATE_LIST_ID || id === SEED_TEMPLATE_CN_DOC_ID)
    expect(seedIds.sort()).toEqual([SEED_TEMPLATE_CN_DOC_ID, SEED_TEMPLATE_LIST_ID])

    for (const id of [SEED_TEMPLATE_LIST_ID, SEED_TEMPLATE_CN_DOC_ID]) {
      const res = await app.request(`/api/templates/${id}`)
      expect(res.status).toBe(200)
      const record = (await res.json()) as TemplateRecord
      expect(record.template.name).toBe(record.name)
      expect(record.template.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
      // 模板四键：画布尺寸由内容包围盒推导，不含声明 cols
      expect(Object.keys(record.template).sort()).toEqual([
        'name',
        'regions',
        'schemaVersion',
        'sheet',
      ])
    }
  })
})

describe('列表样：加载还原并打印出多列明细成品', () => {
  test('画布还原：区域/合并/绑定 sidecar 与行列几何齐备', async () => {
    const { loadTemplate } = await bootSeededApp()
    const doc = FormDoc.fromTemplate((await loadTemplate(SEED_TEMPLATE_LIST_ID)).template)
    // 标题+列头（每页重复）/ 明细（区域自带根即数组的数据源，向下展开）/ 合计+签字（静态）
    expect(
      doc.regions.map((region) => [
        region.startRow,
        region.endRow,
        region.expand,
        region.repeat,
        region.name,
      ]),
    ).toEqual([
      [0, 1, 'none', true, '标题与列头'],
      [2, 2, 'down', undefined, '明细行'],
      [3, 4, 'none', undefined, '合计与签字'],
    ])
    // 明细区驱动源：销售明细原始行数组直接作形态（形态根即数组）
    expect(doc.regions[1]!.source).toEqual({
      datasetId: 'seed-dataset-sales-lines',
      path: '',
    } satisfies RegionSource)
    expect(doc.rows).toBe(5)
    expect(doc.cols).toBe(9)
    expect(doc.sheet.merges.getMerges()).toHaveLength(4)
    // 明细格绑定是条目内相对字段（不带 datasetId，继承区域 source）
    expect(doc.getCellBinding({ row: 2, col: 0 })).toEqual({ path: 'order_no' })
    expect(doc.getCellBinding({ row: 2, col: 8 })).toEqual({ path: 'amount' })
    // 合计落在展开区之外：绝对循环路径 + 纵向聚合
    expect(doc.getCellBinding({ row: 3, col: 8 })).toEqual({
      datasetId: 'seed-dataset-sales-lines',
      path: '[].amount',
      aggregate: 'sum',
    })
  })

  test('预览打印：五行明细全展开、聚合合计与表头框线进产物，A4 纵向单页', async () => {
    const { loadTemplate, fetchRows } = await bootSeededApp()
    const record = await loadTemplate(SEED_TEMPLATE_LIST_ID)
    const rows = await fetchRows('seed-dataset-sales-lines')
    const session = preparePrintSession(
      FormDoc.fromTemplate(record.template),
      new Map([['seed-dataset-sales-lines', rows]]),
      record.template.name,
    )

    const pages = session.plugin.paginate(PRINT_CONFIG)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.colRange).toEqual({ start: 0, end: 9 })
    // 4 行模板外行 + 5 行明细展开 = 9 行
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 9 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      '销售明细清单',
      '全棉精梳府绸',
      '涤纶四面弹面料',
      '涤纶缝纫线',
      '铜版纸',
      '哑粉纸',
      '3925',
      '33130.00',
      '制表人：',
    ]) {
      expect(html).toContain(text)
    }
    // 标题合并跨全宽、列头/明细带框线
    expect(html).toContain('colspan="9"')
    expect(html).toContain('solid #000000')
  })

  test('fixrows 分页：明细展开后按固定行数分页且行覆盖连续完整', async () => {
    const { loadTemplate, fetchRows } = await bootSeededApp()
    const record = await loadTemplate(SEED_TEMPLATE_LIST_ID)
    const rows = await fetchRows('seed-dataset-sales-lines')
    const session = preparePrintSession(
      FormDoc.fromTemplate(record.template),
      new Map([['seed-dataset-sales-lines', rows]]),
      record.template.name,
    )
    const config = toPrintConfig({
      ...DEFAULT_PRINT_SETTINGS,
      headerRepeatRows: 2,
      paging: 'fixrows',
      fixRows: 4,
    })
    const pages = session.plugin.paginate(config)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages[0]!.rowRange.start).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i]!.rowRange.start).toBe(pages[i - 1]!.rowRange.end)
    }
    expect(pages[pages.length - 1]!.rowRange.end).toBe(9)
  })
})

describe('中式单据：五块区域齐备并打印出单据成品', () => {
  test('画布还原：标题/客户地址/明细/合计/签字齐备，只有标题块每页重复', async () => {
    const { loadTemplate } = await bootSeededApp()
    const doc = FormDoc.fromTemplate((await loadTemplate(SEED_TEMPLATE_CN_DOC_ID)).template)
    // 标题+单号（每页重复 2 行）/ 客户地址+列头（数据流，不重复）/
    // 明细（区域自带归组表达式 + [0].items 循环源，向下展开）/ 合计 / 签字
    expect(
      doc.regions.map((region) => [
        region.startRow,
        region.endRow,
        region.expand,
        region.repeat,
        region.name,
      ]),
    ).toEqual([
      [0, 1, 'none', true, '单据头'],
      [2, 4, 'none', undefined, '客户信息与列头'],
      [5, 5, 'down', undefined, '明细'],
      [6, 6, 'none', undefined, '合计'],
      [7, 8, 'none', undefined, '签字'],
    ])
    // 明细区驱动源：订单明细经归组表达式重塑为 [{ order_no, items }]，循环源取首单 items
    const lines = doc.regions[2]!.source
    expect(lines).toMatchObject({
      datasetId: 'seed-dataset-order-items',
      path: '[0].items',
    })
    // 归组表达式非空，且与合计绑定共用同一形态（明细循环与聚合必须同源）
    expect(lines?.expression).toContain('reduce')
    expect(doc.getCellBinding({ row: 6, col: 7 })?.expression).toBe(lines?.expression)
    expect(doc.rows).toBe(9)
    expect(doc.cols).toBe(8)
    // 订单头绑定带重塑表达式；明细绑定是条目内相对字段（不带 datasetId）
    expect(doc.getCellBinding({ row: 2, col: 1 })).toEqual({
      datasetId: 'seed-dataset-order-header',
      expression: 'rows[0]',
      path: 'customer',
    })
    expect(doc.getCellBinding({ row: 5, col: 7 })).toEqual({ path: 'amount' })
    // 合计落在展开区之外：绝对循环路径 + 聚合
    expect(doc.getCellBinding({ row: 6, col: 7 })).toMatchObject({
      datasetId: 'seed-dataset-order-items',
      path: '[0].items[].amount',
      aggregate: 'sum',
    })
  })

  test('预览打印：首单信息/明细循环/合计大写/签字进产物且不混入他单', async () => {
    const { loadTemplate, fetchRows } = await bootSeededApp()
    const record = await loadTemplate(SEED_TEMPLATE_CN_DOC_ID)
    const rowsByDataset = new Map<string, SourceRow[]>([
      ['seed-dataset-order-header', await fetchRows('seed-dataset-order-header')],
      ['seed-dataset-order-items', await fetchRows('seed-dataset-order-items')],
    ])
    const session = preparePrintSession(
      FormDoc.fromTemplate(record.template),
      rowsByDataset,
      record.template.name,
    )

    const pages = session.plugin.paginate(PRINT_CONFIG)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.colRange).toEqual({ start: 0, end: 8 })
    // 6 行模板外行 + 3 行明细展开 = 11 行
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 11 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      '销售出库单',
      'SO-2026-001',
      '2026-11-01',
      '杭州锦绣纺织有限公司',
      '杭州市萧山区金城路 77 号',
      '全棉精梳府绸',
      '涤纶四面弹面料',
      '涤纶缝纫线',
      '壹万贰仟伍佰捌拾元整',
      '3820',
      '12580.00',
      '经手人：',
      '陈明',
      '李小红',
      '王志强',
      '赵伟',
    ]) {
      expect(html).toContain(text)
    }
    // 只打首单：第二张订单的品名/单号不进产物
    expect(html).not.toContain('铜版纸')
    expect(html).not.toContain('SO-2026-002')
    // 列头不随明细逐行重复（明细波段只含循环行）
    expect(html.match(/品名/g)).toHaveLength(1)
    // 表格框线与合并（标题跨全宽）
    expect(html).toContain('solid #000000')
    expect(html).toContain('colspan="8"')
  })
})

describe('内置模板 JSON 口径', () => {
  test('不含打印弹框配置键（纸张/边距/缩放/分页只在弹框）', async () => {
    const { loadTemplate } = await bootSeededApp()
    for (const id of [SEED_TEMPLATE_LIST_ID, SEED_TEMPLATE_CN_DOC_ID]) {
      const json = JSON.stringify((await loadTemplate(id)).template)
      for (const forbidden of [
        'paperSize',
        'paper',
        'margin',
        'scale',
        'orientation',
        'paging',
        'fixRows',
        'headerRepeatRows',
        'groupBreakBy',
      ]) {
        expect(json).not.toContain(`"${forbidden}"`)
      }
    }
  })
})
