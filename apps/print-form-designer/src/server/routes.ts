// 三组资源路由骨架：清单路由直查库表（空库即空集），其余方法为 P2/P5 落实前的占位（501）。
import type { Context, Hono } from 'hono'
import type { Database } from 'bun:sqlite'

// REST 资源名 → 库表名（白名单映射，表名不来自请求输入）
const RESOURCE_TABLES = {
  datasources: 'datasource',
  datasets: 'dataset',
  templates: 'template',
} as const

export function mountResourceRoutes(app: Hono, db: Database): void {
  const stub = (c: Context) => c.json({ message: '占位路由，后续阶段落实' }, 501)

  for (const [resource, table] of Object.entries(RESOURCE_TABLES)) {
    app.get(`/api/${resource}`, (c) => c.json(db.query(`SELECT * FROM ${table}`).all()))
    app.post(`/api/${resource}`, stub)
    app.get(`/api/${resource}/:id`, stub)
    app.put(`/api/${resource}/:id`, stub)
    app.delete(`/api/${resource}/:id`, stub)
  }
}
