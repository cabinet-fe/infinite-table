// 资源路由装配：数据源/数据集为完整实现（P2），模板仍为 P5 落实前的占位（501）。
import type { Context, Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { mountDatasourceRoutes } from './datasource-routes'
import { mountDatasetRoutes } from './dataset-routes'

export function mountResourceRoutes(app: Hono, db: Database): void {
  mountDatasourceRoutes(app, db)
  mountDatasetRoutes(app, db)

  const stub = (c: Context) => c.json({ message: '占位路由，后续阶段落实' }, 501)
  app.get('/api/templates', (c) => c.json(db.query('SELECT * FROM template').all()))
  app.post('/api/templates', stub)
  app.get('/api/templates/:id', stub)
  app.put('/api/templates/:id', stub)
  app.delete('/api/templates/:id', stub)
}
