// P5 模板持久化：REST CRUD 行为、保存→加载→再保存 round-trip 等价（含数据块数据源/
// 数据块名/格样式/合并/行高列宽/绑定 sidecar 与 v6 聚合类型）、模板 JSON 键集守护
// （四键、不含打印弹框配置），以及请求体形状校验（版本不符直接 400，不做字段清洗与迁移）。
import { describe, expect, test } from 'bun:test'

import { FormDoc } from '../../src/domain/form-doc'
import { TEMPLATE_SCHEMA_VERSION, type FormTemplate } from '../../src/shared/template-schema'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { ADDR, RANGE } from '../designer/testing/fixtures'

const JSON_HEADERS = { 'content-type': 'application/json' }

/** hono request 返回 Response | Promise<Response>，统一收窄为 Promise 供 await */
async function postApp(template: unknown): Promise<Response> {
  return await createApp(openDatabase(':memory:')).request('/api/templates', {
    method: 'POST',
    body: JSON.stringify(template),
    headers: JSON_HEADERS,
  })
}

/**
 * 带完整内容形态的样例模板（值/样式/合并/行高列宽/数据块数据源与名称/绑定与函数
 * sidecar/聚合）：数据块 0 是静态标题块，数据块 1 由选区框出且自带数据源向下展开
 * （区内绑条目内相对字段），合计在展开区之外写单元格函数——v4 的两类取数形态。
 */
function sampleTemplate(name: string): FormTemplate {
  const doc = FormDoc.create(8)
  doc.sheet.setCellValue(ADDR(0, 0), '出库单')
  doc.sheet.setCellStyle(RANGE(0, 0, 0, 5), {
    font: { bold: true, size: 16 },
    align: { horizontal: 'center' },
  })
  doc.sheet.mergeCells(RANGE(0, 0, 0, 5))
  doc.setRowHeight(0, 40)
  doc.setColWidth(1, 120)
  doc.renameRegion(0, '标题')
  // 明细区：选区 → 数据块，数据块自带数据源（根即数组）再设展开方式
  doc.createRegionFromRange(RANGE(3, 0, 3, 7), { name: '明细行' })
  doc.setRegionSource(1, { kind: 'dataset', datasetId: 'ds1', path: '' })
  doc.setRegionExpand(1, 'down')
  doc.setCellBinding(ADDR(3, 1), { path: 'name' })
  doc.setCellBinding(ADDR(3, 2), { path: 'amount' })
  // 合计：展开区之外，单元格函数（同列省字段）
  doc.setCellFunction(ADDR(4, 2), { expression: "SUM('明细行')" })
  return doc.toTemplate(name)
}

describe('模板 REST CRUD', () => {
  test('创建 → 清单 → 读取 → 更新 → 删除 全链路', async () => {
    const app = createApp(openDatabase(':memory:'))
    const template = sampleTemplate('出库单')

    const created = await app.request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(template),
      headers: JSON_HEADERS,
    })
    expect(created.status).toBe(201)
    const record = (await created.json()) as {
      id: string
      name: string
      created_at: string
      template: FormTemplate
    }
    expect(record.id).toBeTruthy()
    expect(record.created_at).toBeTruthy()
    expect(record.template).toEqual(template)

    const list = await app.request('/api/templates')
    expect(await list.json()).toEqual([
      { id: record.id, name: '出库单', created_at: record.created_at },
    ])

    const got = await app.request(`/api/templates/${record.id}`)
    expect(got.status).toBe(200)
    expect(((await got.json()) as { template: FormTemplate }).template).toEqual(template)

    const edited = FormDoc.fromTemplate(template)
    edited.addRegion(3)
    const updated = edited.toTemplate('出库单V2')
    const put = await app.request(`/api/templates/${record.id}`, {
      method: 'PUT',
      body: JSON.stringify(updated),
      headers: JSON_HEADERS,
    })
    expect(put.status).toBe(200)
    const after = (await put.json()) as { name: string; template: FormTemplate }
    expect(after.name).toBe('出库单V2')
    expect(after.template).toEqual(updated)
    expect(
      (
        (await (await app.request(`/api/templates/${record.id}`)).json()) as {
          template: FormTemplate
        }
      ).template,
    ).toEqual(updated)

    const removed = await app.request(`/api/templates/${record.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)
    expect((await app.request(`/api/templates/${record.id}`)).status).toBe(404)
    expect((await app.request(`/api/templates/${record.id}`, { method: 'DELETE' })).status).toBe(
      404,
    )
    expect(await (await app.request('/api/templates')).json()).toEqual([])
  })

  test('清单按创建时间倒序（新保存的排前）', async () => {
    // 直插两行可分辨时间的记录，避免同毫秒创建导致顺序不定
    const db = openDatabase(':memory:')
    const document = JSON.stringify({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      regions: [{ startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'none' }],
      aggregations: [],
      sheet: FormDoc.create(4).sheet.snapshot(),
    })
    db.exec(
      `INSERT INTO template (id, name, template, created_at) VALUES
        ('old', '旧模板', '${document}', '2020-01-01T00:00:00.000Z'),
        ('new', '新模板', '${document}', '2026-11-02T00:00:00.000Z')`,
    )
    const rows = (await (await createApp(db).request('/api/templates')).json()) as {
      id: string
    }[]
    expect(rows.map((row) => row.id)).toEqual(['new', 'old'])
  })

  test('请求体形状校验：缺字段/空名/版本号不符/非对象 sheet/缺聚合键均 400', async () => {
    const base = sampleTemplate('合法')
    for (const bad of [
      {},
      null,
      { ...base, name: ' ' },
      { ...base, name: 42 },
      { ...base, schemaVersion: '4' },
      { ...base, schemaVersion: 3 },
      // v4/v5 只在库启动时迁移，写入侧仍只认当前版（v6）
      { ...base, schemaVersion: 4 },
      { ...base, schemaVersion: 5 },
      { ...base, schemaVersion: undefined },
      { ...base, regions: null },
      { ...base, aggregations: undefined },
      { ...base, aggregations: null },
      { ...base, sheet: null },
      { ...base, sheet: 'sheet' },
    ]) {
      const res = await postApp(bad)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { message: string }).message).toContain('请求体不合法')
    }
  })

  test('v6 请求体：带类型（array/value）的聚合经 REST 写入 → 读取原样保留', async () => {
    const doc = FormDoc.create(8)
    doc.setAggregations([
      { name: '台账', type: 'array', params: [], expression: 'return []' },
      { name: '总览', type: 'value', params: [], expression: 'return { n: 1 }' },
    ])
    const template = doc.toTemplate('带聚合')
    const created = await postApp(template)
    expect(created.status).toBe(201)
    const record = (await created.json()) as { template: FormTemplate }
    expect(record.template.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(record.template.aggregations).toEqual(template.aggregations)
    expect(record.template.aggregations.map((agg) => agg.type)).toEqual(['array', 'value'])
  })

  test('regions / aggregations 允许为空数组（模板可以只有静态内容）', async () => {
    const res = await postApp({ ...sampleTemplate('静态稿'), regions: [] })
    expect(res.status).toBe(201)
    const record = (await res.json()) as { template: FormTemplate }
    expect(record.template.regions).toEqual([])
    expect(record.template.aggregations).toEqual([])
    expect(record.template.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(Object.keys(record.template).sort()).toEqual([
      'aggregations',
      'name',
      'regions',
      'schemaVersion',
      'sheet',
    ])
  })

  test('更新不存在的模板返回 404', async () => {
    const app = createApp(openDatabase(':memory:'))
    const res = await app.request('/api/templates/missing', {
      method: 'PUT',
      body: JSON.stringify(sampleTemplate('任意')),
      headers: JSON_HEADERS,
    })
    expect(res.status).toBe(404)
  })
})

describe('未捕获异常兜底（app.onError 统一 500 JSON）', () => {
  test('坏数据让路由抛错时返回 500 + { message } JSON（与 4xx 形状一致，不泄露堆栈）', async () => {
    const db = openDatabase(':memory:')
    // 直插一行非 JSON 的 template 文档（启动迁移只处理库内已有行）：详情路由
    // toRecord 的 JSON.parse 抛错，走 app.onError 兜底
    db.exec(
      "INSERT INTO template (id, name, template, created_at) VALUES ('bad', '坏文档', '{oops', '2026-11-02')",
    )
    const res = await createApp(db).request('/api/templates/bad')
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toContain('application/json')
    const payload = (await res.json()) as Record<string, unknown>
    expect(Object.keys(payload)).toEqual(['message'])
    expect(typeof payload.message).toBe('string')
    expect(payload.message).not.toContain('\n')
  })
})

describe('保存 → 加载 round-trip（经 REST 边界）', () => {
  test('再保存 JSON 与原模板等价，画布内容与数据块语义完整还原', async () => {
    const app = createApp(openDatabase(':memory:'))
    const first = sampleTemplate('round-trip')
    const created = await app.request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(first),
      headers: JSON_HEADERS,
    })
    const record = (await created.json()) as { template: FormTemplate }

    const restored = FormDoc.fromTemplate(record.template)
    const second = restored.toTemplate('round-trip')
    expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)))

    // 关键内容逐项断言（等价性的人类可读版）
    expect(restored.sheet.getDisplayValue(ADDR(0, 0))).toBe('出库单')
    expect(restored.sheet.getEffectiveStyle(ADDR(0, 2))?.font?.bold).toBe(true)
    expect(restored.sheet.getCellInfo(ADDR(0, 3)).kind).toBe('merged-covered')
    expect(restored.sheet.getRowHeight(0)).toBe(40)
    expect(restored.sheet.getColWidth(1)).toBe(120)
    // 数据块：名称随行，展开区的驱动源（数据集 × 列表路径）独立于格绑定
    expect(restored.regions.map((region) => region.name)).toEqual(['标题', '明细行'])
    expect(restored.regions[1]!.expand).toBe('down')
    expect(restored.regions[1]!.source).toEqual({ kind: 'dataset', datasetId: 'ds1', path: '' })
    // 展开区内绑定：只有相对字段
    expect(restored.getCellBinding(ADDR(3, 1))).toEqual({ path: 'name' })
    expect(restored.getCellBinding(ADDR(3, 2))).toEqual({ path: 'amount' })
    // 展开区外的合计：单元格函数保留（sampleTemplate 写的是旧表达式载荷，
    // setCellFunction 写入即嗅探转换为结构化 fn 形状——文档内不存在旧形状）
    expect(restored.getCellFunction(ADDR(4, 2))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '明细行',
    })
    expect(restored.sheet.getDisplayValue(ADDR(3, 1))).toBeUndefined()
    // 无绑定格 round-trip 后仍为空
    expect(restored.getCellBinding(ADDR(1, 1))).toBeUndefined()
  })
})

describe('打印配置键集守护（弹框配置不落模板）', () => {
  test('REST 边界透出的模板 JSON 键集仅含模板自身字段', async () => {
    const created = await postApp(sampleTemplate('键集守护'))
    const record = (await created.json()) as { template: FormTemplate }
    expect(Object.keys(record.template).sort()).toEqual([
      'aggregations',
      'name',
      'regions',
      'schemaVersion',
      'sheet',
    ])
    for (const forbidden of ['paper', 'margin', 'scale', 'pagination', 'pageSize', 'orientation']) {
      expect(JSON.stringify(record)).not.toContain(`"${forbidden}"`)
    }
  })
})
