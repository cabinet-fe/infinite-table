// REST API 路由：智能表清单、建表（可携带初始行）、删表、同步、更新元数据、行记录增删改、进阶 SQL 物理表导入、种子数据重置。
import type { Database } from 'bun:sqlite'
import type { Context, Hono } from 'hono'
import type {
  AllAppsResponse,
  AllTablesResponse,
  AllViewsResponse,
  CreateAppRequest,
  CreateRecordRequest,
  CreateTableRequest,
  CreateViewRequest,
  ImportCommitRequest,
  KanbanMoveCardRequest,
  ReorderAppsRequest,
  ReorderViewsRequest,
  UpdateAppRequest,
  UpdateRecordRequest,
  UpdateTableMetaRequest,
  UpdateViewRequest,
} from '../shared/api-types'
import {
  ValidationError,
  createTableRecord,
  deleteTable,
  deleteTableRecord,
  getTableBundle,
  insertNormalTable,
  isPlainObject,
  listTableBundles,
  updateTableMeta,
  updateTableRecord,
} from './db'
import { commitImport } from './import'
import { seedSmartTableDemo } from './seed'
import {
  createSmartApp,
  createWorkspaceView,
  deleteSmartApp,
  deleteWorkspaceView,
  getSmartApp,
  getWorkspaceView,
  listSmartApps,
  listWorkspaceViews,
  moveKanbanCard,
  reorderSmartApps,
  reorderWorkspaceViews,
  updateSmartApp,
  updateWorkspaceView,
} from './views-store'

function isCreateTableBody(body: unknown): body is CreateTableRequest {
  if (!isPlainObject(body)) return false
  if (typeof body.name !== 'string' || body.name.trim() === '') return false
  if (body.description !== undefined && typeof body.description !== 'string') return false
  if (body.columns !== undefined && !Array.isArray(body.columns)) return false
  if (
    body.records !== undefined &&
    (!Array.isArray(body.records) || !body.records.every((record) => isPlainObject(record)))
  ) {
    return false
  }
  return true
}

function isUpdateMetaBody(body: unknown): body is UpdateTableMetaRequest {
  if (!isPlainObject(body)) return false
  const meta = body.meta
  if (!isPlainObject(meta)) return false
  return (
    typeof meta.name === 'string' &&
    meta.name.trim() !== '' &&
    Array.isArray(meta.columns) &&
    Array.isArray(meta.views) &&
    isPlainObject(meta.summaries)
  )
}

function isCreateRecordBody(body: unknown): body is CreateRecordRequest {
  if (!isPlainObject(body)) return false
  return isPlainObject(body.record)
}

function isUpdateRecordBody(body: unknown): body is UpdateRecordRequest {
  if (!isPlainObject(body)) return false
  return isPlainObject(body.patch)
}

function isImportCommitBody(body: unknown): body is ImportCommitRequest {
  if (!isPlainObject(body)) return false
  if (body.kind !== 'normal' && body.kind !== 'advanced') return false
  if (typeof body.tableName !== 'string' || body.tableName.trim() === '') return false
  return Array.isArray(body.columns) && Array.isArray(body.rows)
}

function isCreateAppBody(body: unknown): body is CreateAppRequest {
  if (!isPlainObject(body)) return false
  if (typeof body.name !== 'string' || body.name.trim() === '') return false
  if (typeof body.tableId !== 'string' || body.tableId.trim() === '') return false
  if (body.description !== undefined && typeof body.description !== 'string') return false
  return true
}

function isReorderAppsBody(body: unknown): body is ReorderAppsRequest {
  return isPlainObject(body) && Array.isArray(body.appIds)
}

function isCreateViewBody(body: unknown): body is CreateViewRequest {
  if (!isPlainObject(body)) return false
  const hasAppId = typeof body.appId === 'string' && body.appId.trim() !== ''
  const hasTableId = typeof body.tableId === 'string' && body.tableId.trim() !== ''
  return (
    typeof body.name === 'string' &&
    body.name.trim() !== '' &&
    typeof body.type === 'string' &&
    (hasAppId || hasTableId)
  )
}

function isReorderViewsBody(body: unknown): body is ReorderViewsRequest {
  return isPlainObject(body) && Array.isArray(body.viewIds)
}

function isKanbanMoveCardBody(body: unknown): body is KanbanMoveCardRequest {
  if (!isPlainObject(body)) return false
  if (body.field !== undefined && typeof body.field !== 'string') return false
  return 'targetValue' in body
}

function handleRouteError(c: Context, error: unknown, uniquePrefix: string): Response {
  if (error instanceof ValidationError) {
    return c.json({ message: error.message }, 400)
  }
  const message = (error as Error)?.message ?? ''
  if (message.includes('UNIQUE constraint')) {
    return c.json({ message: `${uniquePrefix}：${message}` }, 409)
  }
  if (
    message.includes('NOT NULL constraint') ||
    message.includes('CHECK constraint') ||
    message.includes('FOREIGN KEY constraint') ||
    message.includes('datatype mismatch')
  ) {
    return c.json({ message: `数据约束校验失败：${message}` }, 400)
  }
  throw error
}

export function mountSmartTableRoutes(app: Hono, db: Database): void {
  app.get('/api/tables', (c) => {
    const response: AllTablesResponse = { tables: listTableBundles(db) }
    return c.json(response)
  })

  app.post('/api/tables', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isCreateTableBody(body)) {
      return c.json({ message: '请求体不合法：需提供非空表名 name' }, 400)
    }
    try {
      const bundle = insertNormalTable(db, body, { records: body.records })
      return c.json(bundle, 201)
    } catch (error) {
      return handleRouteError(c, error, '表配置冲突')
    }
  })

  app.put('/api/tables/:id/meta', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isUpdateMetaBody(body)) {
      return c.json({ message: '请求体不合法：需提供完整的 meta 对象' }, 400)
    }
    try {
      const updated = updateTableMeta(db, c.req.param('id'), body.meta)
      if (!updated) {
        return c.json({ message: '数据表不存在' }, 404)
      }
      return c.json({ meta: updated })
    } catch (error) {
      return handleRouteError(c, error, '表元数据冲突')
    }
  })

  app.delete('/api/tables/:id', (c) => {
    try {
      const deleted = deleteTable(db, c.req.param('id'))
      if (!deleted) {
        return c.json({ message: '数据表不存在' }, 404)
      }
      return c.json({ ok: true })
    } catch (error) {
      return handleRouteError(c, error, '删除失败')
    }
  })

  app.post('/api/tables/:id/sync', (c) => {
    const bundle = getTableBundle(db, c.req.param('id'))
    if (!bundle) {
      return c.json({ message: '数据表不存在' }, 404)
    }
    return c.json(bundle)
  })

  app.post('/api/tables/:id/records', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isCreateRecordBody(body)) {
      return c.json({ message: '请求体不合法：需提供 record 对象' }, 400)
    }
    try {
      const created = createTableRecord(db, c.req.param('id'), body.record)
      if (!created) {
        return c.json({ message: '数据表不存在或无法写入' }, 404)
      }
      return c.json({ record: created }, 201)
    } catch (error) {
      return handleRouteError(c, error, '主键值已存在，请更换唯一标识')
    }
  })

  app.patch('/api/tables/:id/records/:recordId', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isUpdateRecordBody(body)) {
      return c.json({ message: '请求体不合法：需提供 patch 对象' }, 400)
    }
    try {
      const updated = updateTableRecord(db, c.req.param('id'), c.req.param('recordId'), body.patch)
      if (!updated) {
        return c.json({ message: '数据表或记录不存在' }, 404)
      }
      return c.json({ record: updated })
    } catch (error) {
      return handleRouteError(c, error, '主键值冲突')
    }
  })

  app.delete('/api/tables/:id/records/:recordId', (c) => {
    const deleted = deleteTableRecord(db, c.req.param('id'), c.req.param('recordId'))
    if (!deleted) {
      return c.json({ message: '数据表或记录不存在' }, 404)
    }
    return c.json({ ok: true })
  })

  // 进阶导入提交：文件解析在前端完成，这里消费列配置与行数据建 SQL 物理表并批量插行
  // （普通表导入走 POST /api/tables 携带初始 records，不经此端点）
  app.post('/api/import/commit', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isImportCommitBody(body)) {
      return c.json({ message: '请求体不合法：需提供 kind、非空 tableName、columns 与 rows' }, 400)
    }
    try {
      const bundle = commitImport(db, body)
      return c.json(bundle, 201)
    } catch (error) {
      return handleRouteError(c, error, '导入建表失败')
    }
  })

  app.get('/api/apps', (c) => {
    const response: AllAppsResponse = { apps: listSmartApps(db) }
    return c.json(response)
  })

  app.post('/api/apps', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isCreateAppBody(body)) {
      return c.json({ message: '请求体不合法：需提供非空 name 与 tableId' }, 400)
    }
    try {
      const created = createSmartApp(db, body)
      return c.json(created, 201)
    } catch (error) {
      return handleRouteError(c, error, '智能表格冲突')
    }
  })

  app.put('/api/apps/reorder', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isReorderAppsBody(body)) {
      return c.json({ message: '请求体不合法：需提供 appIds 数组' }, 400)
    }
    try {
      const apps = reorderSmartApps(db, body.appIds)
      return c.json({ apps })
    } catch (error) {
      return handleRouteError(c, error, '智能表格重排失败')
    }
  })

  app.get('/api/apps/:id', (c) => {
    const found = getSmartApp(db, c.req.param('id'))
    if (!found) {
      return c.json({ message: '智能表格不存在' }, 404)
    }
    return c.json({ app: found })
  })

  const handleUpdateSmartApp = async (c: Context, appId: string) => {
    const body = await c.req.json().catch(() => null)
    if (!isPlainObject(body)) {
      return c.json({ message: '请求体不合法：需提供智能表格更新对象' }, 400)
    }
    try {
      const updated = updateSmartApp(db, appId, body as UpdateAppRequest)
      if (!updated) {
        return c.json({ message: '智能表格不存在' }, 404)
      }
      return c.json({ app: updated })
    } catch (error) {
      return handleRouteError(c, error, '智能表格更新失败')
    }
  }

  app.put('/api/apps/:id', (c) => handleUpdateSmartApp(c, c.req.param('id')))
  app.patch('/api/apps/:id', (c) => handleUpdateSmartApp(c, c.req.param('id')))

  app.delete('/api/apps/:id', (c) => {
    const deleted = deleteSmartApp(db, c.req.param('id'))
    if (!deleted) {
      return c.json({ message: '智能表格不存在' }, 404)
    }
    return c.json({ ok: true })
  })

  app.get('/api/views', (c) => {
    const response: AllViewsResponse = { views: listWorkspaceViews(db) }
    return c.json(response)
  })

  app.post('/api/views', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isCreateViewBody(body)) {
      return c.json({ message: '请求体不合法：需提供非空 name、type 与 appId/tableId' }, 400)
    }
    try {
      const view = createWorkspaceView(db, body)
      return c.json({ view }, 201)
    } catch (error) {
      return handleRouteError(c, error, '视图冲突')
    }
  })

  app.put('/api/views/reorder', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isReorderViewsBody(body)) {
      return c.json({ message: '请求体不合法：需提供 viewIds 数组' }, 400)
    }
    try {
      const views = reorderWorkspaceViews(db, body.viewIds)
      return c.json({ views })
    } catch (error) {
      return handleRouteError(c, error, '视图重排失败')
    }
  })

  app.get('/api/views/:id', (c) => {
    const view = getWorkspaceView(db, c.req.param('id'))
    if (!view) {
      return c.json({ message: '视图不存在' }, 404)
    }
    return c.json({ view })
  })

  const handleUpdateWorkspaceView = async (c: Context, viewId: string) => {
    const body = await c.req.json().catch(() => null)
    if (!isPlainObject(body)) {
      return c.json({ message: '请求体不合法：需提供视图更新对象' }, 400)
    }
    try {
      const updated = updateWorkspaceView(db, viewId, body as UpdateViewRequest)
      if (!updated) {
        return c.json({ message: '视图不存在' }, 404)
      }
      return c.json({ view: updated })
    } catch (error) {
      return handleRouteError(c, error, '视图配置冲突')
    }
  }

  app.put('/api/views/:id', (c) => handleUpdateWorkspaceView(c, c.req.param('id')))
  app.patch('/api/views/:id', (c) => handleUpdateWorkspaceView(c, c.req.param('id')))

  app.delete('/api/views/:id', (c) => {
    const deleted = deleteWorkspaceView(db, c.req.param('id'))
    if (!deleted) {
      return c.json({ message: '视图不存在' }, 404)
    }
    return c.json({ ok: true })
  })

  app.patch('/api/views/:id/kanban/cards/:recordId', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isKanbanMoveCardBody(body)) {
      return c.json({ message: '请求体不合法：需提供 targetValue' }, 400)
    }
    try {
      const updated = moveKanbanCard(
        db,
        c.req.param('id'),
        c.req.param('recordId'),
        body.targetValue,
        body.field,
      )
      if (!updated) {
        return c.json({ message: '视图或记录不存在' }, 404)
      }
      return c.json({ record: updated })
    } catch (error) {
      return handleRouteError(c, error, '看板写回冲突')
    }
  })

  app.post('/api/reset-seed', (c) => {
    seedSmartTableDemo(db, { force: true })
    const response: AllTablesResponse = {
      tables: listTableBundles(db),
      apps: listSmartApps(db),
      views: listWorkspaceViews(db),
    }
    return c.json(response)
  })
}
