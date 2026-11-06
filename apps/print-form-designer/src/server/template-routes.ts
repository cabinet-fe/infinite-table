// 模板 REST：区域式 JSON 增删改查。
// 库表 name 列独立存名，bands 列存模板文档（历史列名，内容为 v2 的 regions 形态），
// 读取时回填 name——服务端对文档字段透传不重塑，保存→加载 round-trip 等价由前后端共用
// FormDoc 序列化入口保证；区域重叠/越界等深层校验在加载侧 FormDoc.fromTemplate 把关，
// 此处只做浅层形状校验，并对 v1（bands 形态）调用 migrateTemplateV1 迁移到 v2。
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { migrateTemplateV1, type FormTemplate } from '../designer/template'
import type { TemplateRow } from './rows'

/** 模板行 → API 记录视图（template 为解析后回填 name 的完整模板 JSON） */
function toRecord(row: TemplateRow): {
  id: string
  name: string
  created_at: string
  template: FormTemplate
} {
  // 库列名仍叫 bands（历史列名），内容是 v2 的 regions 形态
  const parsed = JSON.parse(row.bands) as Record<string, unknown> & { schemaVersion?: number }
  // 旧库里的 v1 文档（bands 五类区域）读出来即迁移到 v2，前端统一只认 regions
  const template: FormTemplate =
    parsed.schemaVersion === 1
      ? migrateTemplateV1({ ...parsed, name: row.name })
      : ({ ...parsed, name: row.name } as unknown as FormTemplate)
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    template,
  }
}

function findTemplateRow(db: Database, id: string): TemplateRow | undefined {
  return db.query('SELECT * FROM template WHERE id = ?').get(id) as TemplateRow | undefined
}

function isTemplateBody(body: unknown): body is FormTemplate {
  if (typeof body !== 'object' || body === null) return false
  const { name, schemaVersion, regions, cols, sheet } = body as Record<string, unknown>
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    typeof schemaVersion === 'number' &&
    Array.isArray(regions) &&
    regions.length > 0 &&
    typeof cols === 'number' &&
    Number.isInteger(cols) &&
    cols > 0 &&
    typeof sheet === 'object' &&
    sheet !== null
  )
}

const BAD_BODY_MESSAGE =
  '请求体不合法：需含非空 name、数字 schemaVersion、非空数组 regions、正整数 cols、对象 sheet'

export function mountTemplateRoutes(app: Hono, db: Database): void {
  // 清单只回摘要（模板文档经详情路由读取）
  app.get('/api/templates', (c) =>
    c.json(db.query('SELECT id, name, created_at FROM template ORDER BY created_at DESC').all()),
  )

  app.post('/api/templates', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isTemplateBody(body)) return c.json({ message: BAD_BODY_MESSAGE }, 400)
    const { name, ...payload } = body
    const row: TemplateRow = {
      id: crypto.randomUUID(),
      name,
      bands: JSON.stringify(payload),
      created_at: new Date().toISOString(),
    }
    db.query('INSERT INTO template (id, name, bands, created_at) VALUES (?, ?, ?, ?)').run(
      row.id,
      row.name,
      row.bands,
      row.created_at,
    )
    return c.json(toRecord(row), 201)
  })

  app.get('/api/templates/:id', (c) => {
    const row = findTemplateRow(db, c.req.param('id'))
    return row ? c.json(toRecord(row)) : c.json({ message: '模板不存在' }, 404)
  })

  app.put('/api/templates/:id', async (c) => {
    const id = c.req.param('id')
    if (!findTemplateRow(db, id)) return c.json({ message: '模板不存在' }, 404)
    const body = await c.req.json().catch(() => null)
    if (!isTemplateBody(body)) return c.json({ message: BAD_BODY_MESSAGE }, 400)
    const { name, ...payload } = body
    db.query('UPDATE template SET name = ?, bands = ? WHERE id = ?').run(
      name,
      JSON.stringify(payload),
      id,
    )
    return c.json(toRecord(findTemplateRow(db, id)!))
  })

  app.delete('/api/templates/:id', (c) => {
    const deleted = db.query('DELETE FROM template WHERE id = ?').run(c.req.param('id'))
    return deleted.changes > 0 ? c.body(null, 204) : c.json({ message: '模板不存在' }, 404)
  })
}
