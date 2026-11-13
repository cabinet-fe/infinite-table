// REST API 路由：智能表清单、建表、更新元数据、行记录增删改、种子数据重置。
import type { Database } from 'bun:sqlite'
import type { Hono } from 'hono'
import type {
  AllTablesResponse,
  CreateRecordRequest,
  CreateTableRequest,
  UpdateRecordRequest,
  UpdateTableMetaRequest,
} from '../shared/api-types'
import {
  createTableRecord,
  deleteTableRecord,
  insertNormalTable,
  listTableBundles,
  updateTableMeta,
  updateTableRecord,
} from './db'
import { seedSmartTableDemo } from './seed'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCreateTableBody(body: unknown): body is CreateTableRequest {
  if (!isPlainObject(body)) return false
  if (typeof body.name !== 'string' || body.name.trim() === '') return false
  if (body.description !== undefined && typeof body.description !== 'string') return false
  if (body.columns !== undefined && !Array.isArray(body.columns)) return false
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
    const bundle = insertNormalTable(db, body)
    return c.json(bundle, 201)
  })

  app.put('/api/tables/:id/meta', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isUpdateMetaBody(body)) {
      return c.json({ message: '请求体不合法：需提供完整的 meta 对象' }, 400)
    }
    const updated = updateTableMeta(db, c.req.param('id'), body.meta)
    if (!updated) {
      return c.json({ message: '数据表不存在' }, 404)
    }
    return c.json({ meta: updated })
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
      const message = (error as Error).message ?? ''
      if (message.includes('UNIQUE constraint')) {
        return c.json({ message: `主键值已存在，请更换唯一标识：${message}` }, 409)
      }
      throw error
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
      const message = (error as Error).message ?? ''
      if (message.includes('UNIQUE constraint')) {
        return c.json({ message: `主键值冲突：${message}` }, 409)
      }
      throw error
    }
  })

  app.delete('/api/tables/:id/records/:recordId', (c) => {
    const deleted = deleteTableRecord(db, c.req.param('id'), c.req.param('recordId'))
    if (!deleted) {
      return c.json({ message: '数据表或记录不存在' }, 404)
    }
    return c.json({ ok: true })
  })

  app.post('/api/reset-seed', (c) => {
    seedSmartTableDemo(db, { force: true })
    const response: AllTablesResponse = { tables: listTableBundles(db) }
    return c.json(response)
  })
}
