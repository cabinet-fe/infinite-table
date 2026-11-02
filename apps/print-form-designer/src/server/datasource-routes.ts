// 数据源 REST：创建（经提供者校验路径可达/可建）、清单、详情、删除（级联删除其数据集）。
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getDataSourceProvider } from './datasource-provider'
import { resolveSqlitePath, SQLITE_KIND } from './sqlite-datasource'
import type { DatasourceRow } from './rows'

interface DatasourceBody {
  name: string
  type: string
  path: string
}

function isDatasourceBody(body: unknown): body is DatasourceBody {
  if (typeof body !== 'object' || body === null) return false
  const { name, type, path } = body as Record<string, unknown>
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    typeof type === 'string' &&
    type.trim() !== '' &&
    typeof path === 'string' &&
    path.trim() !== ''
  )
}

export function mountDatasourceRoutes(app: Hono, db: Database): void {
  app.get('/api/datasources', (c) => c.json(db.query('SELECT * FROM datasource').all()))

  app.post('/api/datasources', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isDatasourceBody(body)) {
      return c.json({ message: '请求体不合法：需含非空 name、type、path' }, 400)
    }
    const provider = getDataSourceProvider(body.type)
    if (!provider) {
      return c.json({ message: `暂不支持的数据源类型：${body.type}（当前仅 ${SQLITE_KIND}）` }, 422)
    }
    try {
      await provider.testConnection({ path: body.path })
    } catch (error) {
      return c.json({ message: `数据源文件校验失败：${(error as Error).message}` }, 422)
    }
    // 当前唯一内置 kind，入库统一存解析后的绝对路径，行的展示与后续执行不再二次解析。
    const row: DatasourceRow = {
      id: crypto.randomUUID(),
      name: body.name,
      type: body.type,
      path: resolveSqlitePath(body.path),
      created_at: new Date().toISOString(),
    }
    db.query(
      'INSERT INTO datasource (id, name, type, path, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(row.id, row.name, row.type, row.path, row.created_at)
    return c.json(row, 201)
  })

  app.get('/api/datasources/:id', (c) => {
    const row = db.query('SELECT * FROM datasource WHERE id = ?').get(c.req.param('id')) as
      | DatasourceRow
      | undefined
    return row ? c.json(row) : c.json({ message: '数据源不存在' }, 404)
  })

  app.delete('/api/datasources/:id', (c) => {
    const id = c.req.param('id')
    const deleted = db.query('DELETE FROM datasource WHERE id = ?').run(id)
    if (deleted.changes === 0) {
      return c.json({ message: '数据源不存在' }, 404)
    }
    db.query('DELETE FROM dataset WHERE datasource_id = ?').run(id)
    return c.body(null, 204)
  })
}
