// 内置模板库（v6）：seed 幂等落 2 份完整业务样（按客户分组的列表样/中式单据）+
// 7 份「示例 ·」教学样（横向列表/计算列/聚合链式/非数组聚合引用/重塑表达式/固定排版/
// 组头行）；空库首启经 REST 加载 → FormDoc 还原画布 → 打印会话直接产出成品。
// 每份模板两类断言：normalize round-trip（REST 加载 + fromTemplate/toTemplate 幂等）
// 与数据态渲染冒烟（占位符全部解析出值）。
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { toSourceRows, type QueryResult, type TemplateRecord } from '../../src/data/api'
import { probeAggregationType } from '../../src/designer/aggregation'
import { FormDoc } from '../../src/designer/form-doc'
import { DEFAULT_PRINT_SETTINGS, toPrintConfig } from '../../src/designer/PrintDialog'
import { preparePrintSession } from '../../src/designer/print-source'
import { TEMPLATE_SCHEMA_VERSION } from '../../src/designer/template'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedDemoLibrary } from '../../src/server/seed'
import {
  SEED_TEMPLATE_AGG_ID,
  SEED_TEMPLATE_AGG_VALUE_ID,
  SEED_TEMPLATE_CN_DOC_ID,
  SEED_TEMPLATE_EXPR_ID,
  SEED_TEMPLATE_FIXED_ID,
  SEED_TEMPLATE_GROUP_ID,
  SEED_TEMPLATE_LIST_ID,
  SEED_TEMPLATE_RESHAPE_ID,
  SEED_TEMPLATE_RIGHT_ID,
  SEED_TEMPLATES,
} from '../../src/server/seed-templates'
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

/** 数据态渲染冒烟的公共口径：加载模板 → 取数 → 打印会话（单页/多页由调用方断言） */
async function prepareSeededSession(id: string, datasetIds: string[]) {
  const { loadTemplate, fetchRows } = await bootSeededApp()
  const record = await loadTemplate(id)
  const rowsByDataset = new Map<string, SourceRow[]>()
  for (const datasetId of datasetIds) {
    rowsByDataset.set(datasetId, await fetchRows(datasetId))
  }
  const session = preparePrintSession(
    FormDoc.fromTemplate(record.template),
    rowsByDataset,
    record.template.name,
  )
  return { doc: FormDoc.fromTemplate(record.template), session }
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
      // 模板五键：画布尺寸由内容包围盒推导，不含声明 cols
      expect(Object.keys(record.template).sort()).toEqual([
        'aggregations',
        'name',
        'regions',
        'schemaVersion',
        'sheet',
      ])
    }
  })

  test('全部种子模板经 REST 可加载，fromTemplate / toTemplate 幂等 round-trip', async () => {
    const { loadTemplate } = await bootSeededApp()
    expect(SEED_TEMPLATES).toHaveLength(9)
    for (const { id, template } of SEED_TEMPLATES) {
      const record = await loadTemplate(id)
      expect(record.template.name).toBe(template.name)
      // v6 口径：聚合必有 type，函数体空数据试跑（入参 []、agg {}）不抛错且
      // 返回形态与声明一致——种子聚合全部空数据安全
      for (const agg of template.aggregations) {
        expect(probeAggregationType(agg.params, agg.expression)).toEqual({
          ok: true,
          returns: agg.type,
        })
      }
      // normalize round-trip：REST 载荷 → fromTemplate（校验 + 函数 sidecar 规范化）
      // → toTemplate（再规范化）与原载荷深度等价
      const doc = FormDoc.fromTemplate(record.template)
      const again = doc.toTemplate(record.name)
      expect(JSON.parse(JSON.stringify(again))).toEqual(JSON.parse(JSON.stringify(record.template)))
    }
  })
})

describe('列表样：加载还原并打印出分组小计成品', () => {
  test('画布还原：唯一数据块（分组区）/角色行/绑定与函数 sidecar 齐备', async () => {
    const { loadTemplate } = await bootSeededApp()
    const doc = FormDoc.fromTemplate((await loadTemplate(SEED_TEMPLATE_LIST_ID)).template)
    // 唯一数据块 = 明细区（按客户分组：明细+小计+合计）；标题/列头/签字是数据块外静态内容
    expect(
      doc.regions.map((region) => [
        region.startRow,
        region.endRow,
        region.expand,
        region.name,
      ]),
    ).toEqual([[2, 4, 'down', '明细行']])
    // 明细区驱动源：销售明细原始行数组直接作形态（形态根即数组），按客户分组
    expect(doc.regions[0]!.source).toEqual({
      kind: 'dataset',
      datasetId: 'seed-dataset-sales-lines',
      path: '',
    })
    expect(doc.regions[0]!.groupBy).toEqual(['customer'])
    expect(doc.regions[0]!.rowRoles).toEqual([
      { row: 3, role: 'groupFooter' },
      { row: 4, role: 'summary' },
    ])
    expect(doc.rows).toBe(6)
    expect(doc.cols).toBe(9)
    expect(doc.sheet.merges.getMerges()).toHaveLength(5)
    // 明细格绑定是条目内相对字段（不带数据集，继承数据块 source）
    expect(doc.getCellBinding({ row: 2, col: 0 })).toEqual({ path: 'order_no' })
    expect(doc.getCellBinding({ row: 2, col: 8 })).toEqual({ path: 'amount' })
    // 小计/合计行是结构化单元格函数（组名 + 同列省字段聚合）
    expect(doc.getCellFunction({ row: 3, col: 0 })).toEqual({
      kind: 'fn',
      fn: 'GROUP',
      field: 'customer',
    })
    expect(doc.getCellFunction({ row: 3, col: 8 })).toEqual({
      kind: 'fn',
      fn: 'SUBTOTAL',
      region: '明细行',
    })
    expect(doc.getCellFunction({ row: 4, col: 8 })).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '明细行',
    })
  })

  test('预览打印：两组明细、按组小计与总合计进产物，A4 纵向单页', async () => {
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
    // 2 行表头 + 杭州组(3 明细+1 小计) + 宁波组(2 明细+1 小计) + 1 合计 + 1 签字 = 11 行
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 11 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      '销售明细清单',
      '全棉精梳府绸',
      '涤纶四面弹面料',
      '涤纶缝纫线',
      '铜版纸',
      '哑粉纸',
      '杭州锦绣纺织有限公司', // 小计组名（GROUP）
      '宁波海通印务有限公司',
      '>3820<', // 杭州小计数量
      '12580.00', // 杭州小计金额
      '>105<', // 宁波小计数量
      '20550.00', // 宁波小计金额
      '>3925<', // 总合计数量
      '33130.00', // 总合计金额
      '制表人：',
    ]) {
      expect(html).toContain(text)
    }
    // 标题合并跨全宽、列头/明细带框线
    expect(html).toContain('colspan="9"')
    expect(html).toContain('solid #000000')
  })

  test('fixrows 分页：分组展开后按固定行数分页且行覆盖连续完整', async () => {
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
    expect(pages[pages.length - 1]!.rowRange.end).toBe(11)
  })
})

describe('中式单据：单块明细数据块并打印出单据成品', () => {
  test('画布还原：非数组聚合直引表头字段、明细归组、合计函数齐备', async () => {
    const { loadTemplate } = await bootSeededApp()
    const doc = FormDoc.fromTemplate((await loadTemplate(SEED_TEMPLATE_CN_DOC_ID)).template)
    // 唯一数据块 = 明细（归组表达式 + [0].items 循环源，向下展开）；
    // 表头/客户/列头/合计/签字都是数据块外的内容（静态文字或聚合引用绑定）
    expect(
      doc.regions.map((region) => [
        region.startRow,
        region.endRow,
        region.expand,
        region.name,
      ]),
    ).toEqual([[5, 5, 'down', '明细']])
    // 聚合：非数组型订单头（orders[0] ?? {} 空数据安全），表头/客户/签字字段直引它
    expect(doc.aggregations).toEqual([
      {
        name: '订单头',
        type: 'value',
        params: [{ datasetId: 'seed-dataset-order-header', varName: 'orders' }],
        expression: 'return orders[0] ?? {}',
      },
    ])
    // 明细区驱动源：订单明细经归组表达式重塑为 [{ order_no, items }]，循环源取首单 items
    const linesSource = doc.regions[0]!.source
    expect(linesSource).toMatchObject({
      kind: 'dataset',
      datasetId: 'seed-dataset-order-items',
      path: '[0].items',
    })
    expect(
      linesSource?.kind === 'dataset' ? (linesSource.expression ?? '') : '',
    ).toContain('reduce')
    expect(doc.rows).toBe(9)
    expect(doc.cols).toBe(8)
    // 表头字段是聚合引用绑定（{{agg.订单头.字段}}，不套数据块）；明细绑定是条目内相对字段
    expect(doc.getCellBinding({ row: 1, col: 1 })).toEqual({
      kind: 'agg',
      aggName: '订单头',
      path: 'order_no',
    })
    expect(doc.getCellBinding({ row: 2, col: 1 })).toEqual({
      kind: 'agg',
      aggName: '订单头',
      path: 'customer',
    })
    expect(doc.getCellBinding({ row: 8, col: 1 })).toEqual({
      kind: 'agg',
      aggName: '订单头',
      path: 'maker',
    })
    expect(doc.getCellBinding({ row: 5, col: 7 })).toEqual({ path: 'amount' })
    // 合计是结构化单元格函数（同列省字段；大写金额格在合并锚点列上，写显式字段）
    expect(doc.getCellFunction({ row: 6, col: 7 })).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '明细',
    })
    expect(doc.getCellFunction({ row: 6, col: 2 })).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '明细',
      field: 'amount',
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
    // 8 行模板外行（表头/客户/列头/合计/签字，静态或聚合直引）+ 3 行明细展开 = 11 行
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 11 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      '销售出库单',
      'SO-2026-001', // {{agg.订单头.order_no}} 直引解析出的首单字段
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

describe('示例 · 横向列表：横向商品一览', () => {
  test('画布还原：右展数据块 + 数据集源；渲染按条目横向铺开', async () => {
    const { doc, session } = await prepareSeededSession(SEED_TEMPLATE_RIGHT_ID, [
      'seed-dataset-order-items',
    ])
    // 唯一数据块向右展开；标题与左列标签都在数据块外（数据块不必覆盖整张画布）
    expect(
      doc.regions.map((region) => [
        region.startRow,
        region.endRow,
        region.startCol,
        region.endCol,
        region.expand,
        region.name,
      ]),
    ).toEqual([[1, 4, 1, 1, 'right', '商品']])
    expect(doc.regions[0]!.source).toEqual({
      kind: 'dataset',
      datasetId: 'seed-dataset-order-items',
      path: '',
    })
    expect(doc.getCellBinding({ row: 1, col: 1 })).toEqual({ path: 'item_name' })

    const pages = session.plugin.paginate(PRINT_CONFIG)
    expect(pages).toHaveLength(1)
    // 模板 2 列（标签列 + 商品列）× 5 条明细 → 数据态 6 列；行不展开（5 行）
    expect(pages[0]!.colRange).toEqual({ start: 0, end: 6 })
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 5 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      '商品横向一览',
      '全棉精梳府绸',
      '涤纶四面弹面料',
      '涤纶缝纫线',
      '铜版纸',
      '哑粉纸',
      '>3500<',
      '11200.00',
      '9450.00',
    ]) {
      expect(html).toContain(text)
    }
    // 数据块外的左侧标签列只渲染一份，不随右展复制
    expect(html.match(/品名/g)).toHaveLength(1)
    expect(html).not.toContain('{{')
  })
})

describe('示例 · 非数组聚合引用：汇总卡', () => {
  test('画布还原：零数据块 + value 聚合；值格全是聚合引用绑定', async () => {
    const { doc } = await prepareSeededSession(SEED_TEMPLATE_AGG_VALUE_ID, [
      'seed-dataset-sales-lines',
    ])
    // 整张模板零数据块：不展开的值不需要数据块
    expect(doc.regions).toEqual([])
    expect(doc.aggregations.map((agg) => [agg.name, agg.type])).toEqual([['销售汇总', 'value']])
    // 值格是 { kind: 'agg' } 直引绑定（占位符 {{agg.销售汇总.字段}}）
    expect(doc.getCellBinding({ row: 1, col: 1 })).toEqual({
      kind: 'agg',
      aggName: '销售汇总',
      path: '首单号',
    })
    expect(doc.getCellBinding({ row: 1, col: 3 })).toEqual({
      kind: 'agg',
      aggName: '销售汇总',
      path: '订单数',
    })
    expect(doc.getCellBinding({ row: 2, col: 3 })).toEqual({
      kind: 'agg',
      aggName: '销售汇总',
      path: '总金额',
    })
  })

  test('渲染冒烟：聚合对象的字段直引进产物，无占位符残留', async () => {
    const { session } = await prepareSeededSession(SEED_TEMPLATE_AGG_VALUE_ID, [
      'seed-dataset-sales-lines',
    ])
    const pages = session.plugin.paginate(PRINT_CONFIG)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 3 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      'SO-2026-001', // 首单号
      '>2<', // 订单数
      '>3925<', // 总数量
      '33130.00', // 总金额
    ]) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('{{')
  })
})

describe('示例 · 计算列：自定义 JS 表达式', () => {
  test('画布还原：明细区内两列 expr 函数格，合计行再叠一个调数据块函数的表达式', async () => {
    const { doc } = await prepareSeededSession(SEED_TEMPLATE_EXPR_ID, ['seed-dataset-sales-lines'])
    expect(doc.regions.map((region) => [region.expand, region.name])).toEqual([['down', '明细']])
    expect(doc.getCellFunction({ row: 2, col: 4 })).toEqual({
      kind: 'expr',
      expression: 'item.qty * item.unit_price',
    })
    expect(doc.getCellFunction({ row: 2, col: 5 })).toEqual({
      kind: 'expr',
      expression: 'item.qty * item.unit_price * 0.13',
    })
    expect(doc.getCellFunction({ row: 3, col: 5 })).toEqual({
      kind: 'expr',
      expression: "SUM('明细', 'amount') * 0.13",
    })
  })

  test('渲染冒烟：现算金额与数据集金额一致，税额按 13% 现算', async () => {
    const { session } = await prepareSeededSession(SEED_TEMPLATE_EXPR_ID, ['seed-dataset-sales-lines'])
    const pages = session.plugin.paginate(PRINT_CONFIG)
    // 2 表头 + 5 明细 + 1 合计 = 8 行，A4 单页
    expect(pages).toHaveLength(1)
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 8 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      '金额（现算）',
      '1020.00', // 现算金额 = 数据集 amount（两列同值）
      '11200.00',
      '360.00',
      '132.60', // 税额 = 1020 × 0.13
      '1456.00',
      '46.80',
      '1443.00',
      '1228.50',
      '>3925<', // 合计数量
      '33130.00', // 合计金额（数据集列与现算列同值）
      '4306.90', // 合计税额 = SUM('明细','amount') × 0.13
    ]) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('{{')
  })
})

describe('示例 · 聚合加工与链式引用：订单台账', () => {
  test('画布还原：两个聚合（数组归组 + 非数组链式）、台账块以 agg 为源、总览表达式取值', async () => {
    const { doc } = await prepareSeededSession(SEED_TEMPLATE_AGG_ID, ['seed-dataset-sales-lines'])
    expect(doc.aggregations.map((agg) => [agg.name, agg.type, agg.params.length])).toEqual([
      ['订单台账', 'array', 1],
      ['总览', 'value', 0],
    ])
    // 链式：后序聚合只消费前序结果 agg.订单台账（防御式 ?? []，空数据试跑不炸）
    expect(doc.aggregations[0]!.params).toEqual([
      { datasetId: 'seed-dataset-sales-lines', varName: 'lines' },
    ])
    expect(doc.aggregations[0]!.expression).toContain('return [...byOrder.values()]')
    expect(doc.aggregations[1]!.expression).toContain('agg.订单台账 ?? []')
    expect(doc.regions.map((region) => [region.expand, region.name])).toEqual([['down', '台账']])
    expect(doc.regions[0]!.source).toEqual({ kind: 'agg', aggName: '订单台账', path: '' })
    // 台账行绑定的是聚合算好的字段；总览格用表达式取 agg.总览['键']
    expect(doc.getCellBinding({ row: 2, col: 2 })).toEqual({ path: 'kinds' })
    expect(doc.getCellFunction({ row: 4, col: 1 })).toEqual({
      kind: 'expr',
      expression: "agg.总览['订单数']",
    })
    expect(doc.getCellFunction({ row: 4, col: 3 })).toEqual({
      kind: 'expr',
      expression: "agg.总览['总金额']",
    })
  })

  test('渲染冒烟：聚合台账行、合计 SUM 与总览链式值全部解析出值', async () => {
    const { session } = await prepareSeededSession(SEED_TEMPLATE_AGG_ID, ['seed-dataset-sales-lines'])
    const pages = session.plugin.paginate(PRINT_CONFIG)
    // 2 表头 + 2 台账行 + 1 合计 + 1 总览 = 6 行
    expect(pages).toHaveLength(1)
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 6 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      'SO-2026-001',
      'SO-2026-002',
      '杭州锦绣纺织有限公司',
      '宁波海通印务有限公司',
      '>3<', // 首单品种数
      '>2<', // 次单品种数
      '>5<', // 合计品种数
      '>3820<',
      '>105<',
      '>3925<',
      '12580.00',
      '20550.00',
      '订单数：',
      '总金额：',
      '33130.00',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('{{')
  })
})

describe('示例 · 重塑表达式：明细归组嵌套', () => {
  test('画布还原：数据块源带重塑表达式（rows → 嵌套结构），品种数格下钻 items', async () => {
    const { doc } = await prepareSeededSession(SEED_TEMPLATE_RESHAPE_ID, [
      'seed-dataset-order-items',
    ])
    expect(doc.aggregations).toEqual([])
    expect(doc.regions.map((region) => [region.expand, region.name])).toEqual([['down', '台账']])
    const source = doc.regions[0]!.source
    expect(source).toMatchObject({
      kind: 'dataset',
      datasetId: 'seed-dataset-order-items',
      path: '',
    })
    expect(source?.kind === 'dataset' ? (source.expression ?? '') : '').toContain('reduce')
    // 品种数：表达式下钻条目内的嵌套数组
    expect(doc.getCellFunction({ row: 2, col: 1 })).toEqual({
      kind: 'expr',
      expression: 'item.items.length',
    })
    expect(doc.getCellBinding({ row: 2, col: 2 })).toEqual({ path: 'qty' })
  })

  test('渲染冒烟：归组台账行渲染嵌套合计字段，数据块外 SUM 取值', async () => {
    const { session } = await prepareSeededSession(SEED_TEMPLATE_RESHAPE_ID, [
      'seed-dataset-order-items',
    ])
    const pages = session.plugin.paginate(PRINT_CONFIG)
    // 2 表头 + 2 台账行 + 1 合计 = 5 行
    expect(pages).toHaveLength(1)
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 5 })

    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of [
      'SO-2026-001',
      'SO-2026-002',
      '>3<', // 首单品种数（嵌套 items 长度）
      '>2<',
      '>3820<',
      '>105<',
      '12580.00',
      '20550.00',
      '>3925<',
      '33130.00',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('{{')
  })
})

describe('示例 · 固定排版：空白领料单', () => {
  test('画布还原：零数据块（固定文字不需要数据块），无绑定无函数；空数据渲染出完整版面', async () => {
    const { doc, session } = await prepareSeededSession(SEED_TEMPLATE_FIXED_ID, [])
    expect(doc.regions).toEqual([])
    // 整张单据不绑任何数据源（无数据块、无绑定、无函数）
    expect(doc.rows).toBe(12)
    expect(doc.cols).toBe(6)

    const pages = session.plugin.paginate(PRINT_CONFIG)
    expect(pages).toHaveLength(1)
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 12 })
    const html = session.previewHtml(PRINT_CONFIG)
    for (const text of ['领料单', '领料部门：', '物料名称', '领料人：', '审批人：', '仓管员：', '备注：']) {
      expect(html).toContain(text)
    }
    // 固定版面无占位符、无手写留白被裁剪（空白手写行带框线）
    expect(html).not.toContain('{{')
    expect(html).toContain('solid #000000')
  })
})

describe('示例 · 组头行与小计：按单据分组', () => {
  test('画布还原：groupHeader/groupFooter/summary 三种角色与结构化函数格', async () => {
    const { doc } = await prepareSeededSession(SEED_TEMPLATE_GROUP_ID, ['seed-dataset-sales-lines'])
    const detail = doc.regions[0]!
    expect(detail.groupBy).toEqual(['order_no'])
    expect(detail.rowRoles).toEqual([
      { row: 2, role: 'groupHeader' },
      { row: 4, role: 'groupFooter' },
      { row: 5, role: 'summary' },
    ])
    // 组头行绑定取组内第 1 条（单号 + 客户横条）
    expect(doc.getCellBinding({ row: 2, col: 0 })).toEqual({ path: 'order_no' })
    expect(doc.getCellBinding({ row: 2, col: 2 })).toEqual({ path: 'customer' })
    // 小计行：GROUP 省字段（= 首个分组字段 order_no）；数量列 SUBTOTAL 写显式字段
    // （组头行的 customer 绑定占了本列，同列省字段会取到它）；金额列同列省字段
    expect(doc.getCellFunction({ row: 4, col: 0 })).toEqual({ kind: 'fn', fn: 'GROUP' })
    expect(doc.getCellFunction({ row: 4, col: 2 })).toEqual({
      kind: 'fn',
      fn: 'SUBTOTAL',
      region: '明细',
      field: 'qty',
    })
    expect(doc.getCellFunction({ row: 5, col: 3 })).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '明细',
    })
  })

  test('渲染冒烟：组头横条 + 按单小计 + 总合计进产物', async () => {
    const { session } = await prepareSeededSession(SEED_TEMPLATE_GROUP_ID, ['seed-dataset-sales-lines'])
    const pages = session.plugin.paginate(PRINT_CONFIG)
    // 2 表头 + 首单(组头+3 明细+小计) + 次单(组头+2 明细+小计) + 1 合计 + 1 签字 = 13 行
    expect(pages).toHaveLength(1)
    expect(pages[0]!.rowRange).toEqual({ start: 0, end: 13 })

    const html = session.previewHtml(PRINT_CONFIG)
    // 单号出现两次：组头绑定一次、小计 GROUP() 一次
    expect(html.match(/SO-2026-001/g)).toHaveLength(2)
    expect(html.match(/SO-2026-002/g)).toHaveLength(2)
    for (const text of [
      '杭州锦绣纺织有限公司',
      '宁波海通印务有限公司',
      '>3820<', // 首单小计数量
      '12580.00', // 首单小计金额
      '>105<', // 次单小计数量
      '20550.00', // 次单小计金额
      '>3925<', // 总合计数量
      '33130.00', // 总合计金额
      '制表人：',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('{{')
  })
})

describe('内置模板 JSON 口径', () => {
  test('不含打印弹框配置键（纸张/边距/缩放/分页只在弹框）', async () => {
    const { loadTemplate } = await bootSeededApp()
    for (const { id } of SEED_TEMPLATES) {
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
