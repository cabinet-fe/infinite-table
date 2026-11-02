// 数据集 REST：创建/保存/编辑（关联数据源）、删除、执行（跑 SQL 返回原始行——列名 + 行数组，不做服务端重塑）。
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getDataSourceProvider } from './datasource-provider'
import type { DatasourceRow, DatasetRow } from './rows'

interface DatasetBody {
  name: string
  datasource_id: string
  sql: string
}

function isDatasetBody(body: unknown): body is DatasetBody {
  if (typeof body !== 'object' || body === null) return false
  const { name, datasource_id, sql } = body as Record<string, unknown>
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    typeof datasource_id === 'string' &&
    datasource_id !== '' &&
    typeof sql === 'string' &&
    sql.trim() !== ''
  )
}

// 只读护栏：仅放行 SELECT / WITH 开头的单条查询（语句串直接拒绝；写入另有 SQLite 只读打开兜底）。
function readOnlyQueryViolation(sql: string): string | null {
  const single = sql.trim().replace(/;\s*$/, '')
  if (!/^\s*(select|with)\b/i.test(single)) {
    return '数据集 SQL 仅支持 SELECT / WITH 开头的只读查询'
  }
  if (single.includes(';')) {
    return '数据集 SQL 仅支持单条语句'
  }
  return null
}

function findDatasource(db: Database, id: string): DatasourceRow | undefined {
  return db.query('SELECT * FROM datasource WHERE id = ?').get(id) as DatasourceRow | undefined
}

export function mountDatasetRoutes(app: Hono, db: Database): void {
  app.get('/api/datasets', (c) => c.json(db.query('SELECT * FROM dataset').all()))

  app.post('/api/datasets', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isDatasetBody(body)) {
      return c.json({ message: '请求体不合法：需含非空 name、datasource_id、sql' }, 400)
    }
    if (!findDatasource(db, body.datasource_id)) {
      return c.json({ message: '关联数据源不存在' }, 422)
    }
    const violation = readOnlyQueryViolation(body.sql)
    if (violation) {
      return c.json({ message: violation }, 422)
    }
    const row: DatasetRow = {
      id: crypto.randomUUID(),
      datasource_id: body.datasource_id,
      name: body.name,
      sql: body.sql,
      created_at: new Date().toISOString(),
    }
    db.query(
      'INSERT INTO dataset (id, datasource_id, name, sql, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(row.id, row.datasource_id, row.name, row.sql, row.created_at)
    return c.json(row, 201)
  })

  app.get('/api/datasets/:id', (c) => {
    const row = db.query('SELECT * FROM dataset WHERE id = ?').get(c.req.param('id')) as
      | DatasetRow
      | undefined
    return row ? c.json(row) : c.json({ message: '数据集不存在' }, 404)
  })

  app.put('/api/datasets/:id', async (c) => {
    const id = c.req.param('id')
    const existing = db.query('SELECT * FROM dataset WHERE id = ?').get(id) as
      | DatasetRow
      | undefined
    if (!existing) {
      return c.json({ message: '数据集不存在' }, 404)
    }
    const body = await c.req.json().catch(() => null)
    if (!isDatasetBody(body)) {
      return c.json({ message: '请求体不合法：需含非空 name、datasource_id、sql' }, 400)
    }
    if (!findDatasource(db, body.datasource_id)) {
      return c.json({ message: '关联数据源不存在' }, 422)
    }
    const violation = readOnlyQueryViolation(body.sql)
    if (violation) {
      return c.json({ message: violation }, 422)
    }
    db.query('UPDATE dataset SET name = ?, datasource_id = ?, sql = ? WHERE id = ?').run(
      body.name,
      body.datasource_id,
      body.sql,
      id,
    )
    return c.json({ ...existing, ...body })
  })

  app.delete('/api/datasets/:id', (c) => {
    const deleted = db.query('DELETE FROM dataset WHERE id = ?').run(c.req.param('id'))
    return deleted.changes > 0 ? c.body(null, 204) : c.json({ message: '数据集不存在' }, 404)
  })

  app.post('/api/datasets/:id/execute', async (c) => {
    const dataset = db.query('SELECT * FROM dataset WHERE id = ?').get(c.req.param('id')) as
      | DatasetRow
      | undefined
    if (!dataset) {
      return c.json({ message: '数据集不存在' }, 404)
    }
    const datasource = findDatasource(db, dataset.datasource_id)
    if (!datasource) {
      return c.json({ message: '关联数据源不存在' }, 422)
    }
    const provider = getDataSourceProvider(datasource.type)
    if (!provider) {
      return c.json({ message: `暂不支持的数据源类型：${datasource.type}` }, 422)
    }
    try {
      // 原始行直出：列名与行数组来自 SQLite 语句本身，服务端不聚合、不重排、不补值。
      return c.json(await provider.execute({ path: datasource.path }, dataset.sql))
    } catch (error) {
      return c.json({ message: `SQL 执行失败：${(error as Error).message}` }, 422)
    }
  })
}
