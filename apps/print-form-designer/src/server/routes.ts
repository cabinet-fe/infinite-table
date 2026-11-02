// 资源路由装配：数据源/数据集（P2）与模板（P5）三组 REST。
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { mountDatasourceRoutes } from './datasource-routes'
import { mountDatasetRoutes } from './dataset-routes'
import { mountTemplateRoutes } from './template-routes'

export function mountResourceRoutes(app: Hono, db: Database): void {
  mountDatasourceRoutes(app, db)
  mountDatasetRoutes(app, db)
  mountTemplateRoutes(app, db)
}
