// 模板 REST：区域式 JSON 增删改查（P5 落实，替换 P1 占位路由）。
// 库表 name 列独立存名，bands 列存模板文档（name 之外的 FormTemplate 字段原样序列化），
// 读取时回填 name——服务端对文档字段透传不重塑，保存→加载 round-trip 等价由前后端共用
// FormDoc 序列化入口保证；区域行区连续性等深层校验在加载侧 FormDoc.fromTemplate 把关，
// 此处只做浅层形状校验。
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import type { FormTemplate } from '../designer/template'
import type { TemplateRow } from './rows'

/** 模板行 → API 记录视图（template 为解析后回填 name 的完整模板 JSON） */
function toRecord(row: TemplateRow): {
  id: string
  name: string
  created_at: string
  template: FormTemplate
} {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    template: { ...(JSON.parse(row.bands) as Omit<FormTemplate, 'name'>), name: row.name },
  }
}

function findTemplateRow(db: Database, id: string): TemplateRow | undefined {
  return db.query('SELECT * FROM template WHERE id = ?').get(id) as TemplateRow | undefined
}

function isTemplateBody(body: unknown): body is FormTemplate {
  if (typeof body !== 'object' || body === null) return false
  const { name, schemaVersion, bands, cols, sheet } = body as Record<string, unknown>
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    typeof schemaVersion === 'number' &&
    Array.isArray(bands) &&
    bands.length > 0 &&
    typeof cols === 'number' &&
    Number.isInteger(cols) &&
    cols > 0 &&
    typeof sheet === 'object' &&
    sheet !== null
  )
}

const BAD_BODY_MESSAGE =
  '请求体不合法：需含非空 name、数字 schemaVersion、非空数组 bands、正整数 cols、对象 sheet'

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
