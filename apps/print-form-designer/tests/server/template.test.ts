// P5 模板持久化：REST CRUD 行为、保存→加载→再保存 round-trip 等价（含波段结构/
// 格样式/合并/行高列宽/绑定 sidecar）、模板 JSON 不含打印弹框配置的键集守护。
import { describe, expect, test } from 'bun:test'

import { FormDoc } from '../../src/designer/form-doc'
import type { FormTemplate } from '../../src/designer/template'
import { createApp } from '../../src/server/index'
import { openDatabase } from '../../src/server/db'

const ADDR = (row: number, col: number) => ({ row, col })
const RANGE = (r1: number, c1: number, r2: number, c2: number) => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 },
})

const JSON_HEADERS = { 'content-type': 'application/json' }

/** hono request 返回 Response | Promise<Response>，统一收窄为 Promise 供 await */
async function postApp(template: unknown): Promise<Response> {
  return await createApp(openDatabase(':memory:')).request('/api/templates', {
    method: 'POST',
    body: JSON.stringify(template),
    headers: JSON_HEADERS,
  })
}

/** 带完整内容形态的样例模板（值/样式/合并/行高列宽/绑定 sidecar/波段类型） */
function sampleTemplate(name: string): FormTemplate {
  const doc = FormDoc.create()
  doc.sheet.setCellValue(ADDR(0, 0), '出库单')
  doc.sheet.setCellStyle(RANGE(0, 0, 0, 5), {
    font: { bold: true, size: 16 },
    align: { horizontal: 'center' },
  })
  doc.sheet.mergeCells(RANGE(0, 0, 0, 5))
  doc.setRowHeight(0, 40)
  doc.setColWidth(1, 120)
  doc.setCellBinding(ADDR(4, 1), { datasetId: 'ds1', path: 'items[].name' })
  doc.setCellBinding(ADDR(6, 2), { datasetId: 'ds1', path: 'items[].amount', aggregate: 'sum' })
  doc.setBandKind(3, 'detail')
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
    edited.addBand('summary')
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
    const doc =
      '{"schemaVersion":1,"bands":[{"kind":"info","startRow":0,"endRow":0}],"cols":4,"sheet":{"rows":1,"cols":4,"cells":[]}}'
    db.exec(
      `INSERT INTO template (id, name, bands, created_at) VALUES
        ('old', '旧模板', '${doc}', '2020-01-01T00:00:00.000Z'),
        ('new', '新模板', '${doc}', '2026-11-02T00:00:00.000Z')`,
    )
    const rows = (await (await createApp(db).request('/api/templates')).json()) as {
      id: string
    }[]
    expect(rows.map((row) => row.id)).toEqual(['new', 'old'])
  })

  test('请求体形状校验：缺字段/空波段/非正整数 cols 均 400', async () => {
    const base = sampleTemplate('合法')
    for (const bad of [
      {},
      { ...base, name: ' ' },
      { ...base, schemaVersion: '1' },
      { ...base, bands: [] },
      { ...base, cols: 0 },
      { ...base, cols: 2.5 },
      { ...base, sheet: null },
    ]) {
      const res = await postApp(bad)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { message: string }).message).toContain('请求体不合法')
    }
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

describe('保存 → 加载 round-trip（经 REST 边界）', () => {
  test('再保存 JSON 与原模板等价，画布内容完整还原', async () => {
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
    expect(restored.bands[3]!.kind).toBe('detail')
    // 绑定 sidecar 整体随行；绑定格存储值保持空（配置态口径）
    expect(restored.getCellBinding(ADDR(4, 1))).toEqual({
      datasetId: 'ds1',
      path: 'items[].name',
    })
    expect(restored.getCellBinding(ADDR(6, 2))).toEqual({
      datasetId: 'ds1',
      path: 'items[].amount',
      aggregate: 'sum',
    })
    expect(restored.sheet.getDisplayValue(ADDR(4, 1))).toBeUndefined()
    // 无绑定格 round-trip 后仍为空
    expect(restored.getCellBinding(ADDR(1, 1))).toBeUndefined()
  })
})

describe('打印配置键集守护（弹框配置不落模板）', () => {
  test('REST 边界透出的模板 JSON 键集仅含模板自身字段', async () => {
    const created = await postApp(sampleTemplate('键集守护'))
    const record = (await created.json()) as { template: FormTemplate }
    expect(Object.keys(record.template).sort()).toEqual([
      'bands',
      'cols',
      'name',
      'schemaVersion',
      'sheet',
    ])
    for (const forbidden of ['paper', 'margin', 'scale', 'pagination', 'pageSize', 'orientation']) {
      expect(JSON.stringify(record)).not.toContain(`"${forbidden}"`)
    }
  })
})
