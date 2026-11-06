// 模板 REST：区域式 JSON 增删改查。
// 库表 name 列独立存名，template 列存模板文档（regions 形态），读取时回填 name——
// 服务端对文档字段透传不重塑，保存→加载 round-trip 等价由前后端共用 FormDoc 序列化
// 入口保证；区域重叠/越界等深层校验在加载侧 FormDoc.fromTemplate 把关，此处只做形状校验。
//
// 版本口径：只认当前 schema 版本。schemaVersion 不符的请求体直接 400，不做任何字段清洗或迁移；
// 库里读到不符的文档同样按坏数据处理（抛错暴露，不静默修）。
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { TEMPLATE_SCHEMA_VERSION, type FormTemplate } from '../designer/template'
import type { TemplateRow } from './rows'

/** 模板行 → API 记录视图（template 为回填 name 后的完整模板 JSON） */
function toRecord(row: TemplateRow): {
  id: string
  name: string
  created_at: string
  template: FormTemplate
} {
  const document = JSON.parse(row.template) as Omit<FormTemplate, 'name'>
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    template: { ...document, name: row.name },
  }
}

function findTemplateRow(db: Database, id: string): TemplateRow | undefined {
  return db.query('SELECT * FROM template WHERE id = ?').get(id) as TemplateRow | undefined
}

/** 形状校验：name 非空、schemaVersion 恰为 3、regions 为数组、sheet 为非 null 对象 */
function isTemplateBody(body: unknown): body is FormTemplate {
  if (typeof body !== 'object' || body === null) return false
  const { name, schemaVersion, regions, sheet } = body as Record<string, unknown>
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    schemaVersion === TEMPLATE_SCHEMA_VERSION &&
    Array.isArray(regions) &&
    typeof sheet === 'object' &&
    sheet !== null
  )
}

/** 落库载荷：名字独立存进 name 列，文档其余字段原样序列化 */
function toPayload(body: FormTemplate): Omit<FormTemplate, 'name'> {
  const { name: _name, ...payload } = body
  return payload
}

const BAD_BODY_MESSAGE = `请求体不合法：需含非空 name、schemaVersion ${TEMPLATE_SCHEMA_VERSION}、数组 regions、对象 sheet`

export function mountTemplateRoutes(app: Hono, db: Database): void {
  // 清单只回摘要（模板文档经详情路由读取）
  app.get('/api/templates', (c) =>
    c.json(db.query('SELECT id, name, created_at FROM template ORDER BY created_at DESC').all()),
  )

  app.post('/api/templates', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isTemplateBody(body)) return c.json({ message: BAD_BODY_MESSAGE }, 400)
    const row: TemplateRow = {
      id: crypto.randomUUID(),
      name: body.name,
      template: JSON.stringify(toPayload(body)),
      created_at: new Date().toISOString(),
    }
    db.query('INSERT INTO template (id, name, template, created_at) VALUES (?, ?, ?, ?)').run(
      row.id,
      row.name,
      row.template,
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
    db.query('UPDATE template SET name = ?, template = ? WHERE id = ?').run(
      body.name,
      JSON.stringify(toPayload(body)),
      id,
    )
    return c.json(toRecord(findTemplateRow(db, id)!))
  })

  app.delete('/api/templates/:id', (c) => {
    const deleted = db.query('DELETE FROM template WHERE id = ?').run(c.req.param('id'))
    return deleted.changes > 0 ? c.body(null, 204) : c.json({ message: '模板不存在' }, 404)
  })
}
