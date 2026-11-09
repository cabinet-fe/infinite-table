// 数据集 REST：创建/保存/编辑（关联数据源）、删除、执行（跑 SQL 返回原始行——列名 + 行
// 数组，不做服务端重塑）与取字段（跑一次 SQL 出列名 + 前几行样例，配合 PUT 持久化字段
// 命名：alias 只影响展示，绑定/取数仍用 SQL 原始列名）。
import type { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { getDataSourceProvider, type QueryResult } from './datasource-provider'
import type { DatasetField, DatasourceRow, DatasetRow } from './rows'

/** REST 记录视图：库行 fields 列的 JSON 文本解析为数组透出 */
type DatasetRecord = Omit<DatasetRow, 'fields'> & { fields: DatasetField[] }

/** 取字段的样例行数上限（够辨认字段含义即可，不整表回传） */
const FIELD_SAMPLE_ROWS = 5

interface DatasetBody {
  name: string
  datasource_id: string
  sql: string
  /** 字段命名（可选；PUT 不带 = 保留已存命名，编辑表单只改名称/SQL 时不误清） */
  fields?: DatasetField[]
}

const BAD_BODY_MESSAGE =
  '请求体不合法：需含非空 name、datasource_id、sql（fields 可选，形如 [{ name, alias? }]）'

/** 字段命名结构：每条非空 name 字符串，alias 可缺省或字符串 */
function isDatasetFields(value: unknown): value is DatasetField[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { name?: unknown }).name === 'string' &&
      (item as { name: string }).name.trim() !== '' &&
      ((item as { alias?: unknown }).alias === undefined ||
        typeof (item as { alias?: unknown }).alias === 'string'),
  )
}

function isDatasetBody(body: unknown): body is DatasetBody {
  if (typeof body !== 'object' || body === null) return false
  const { name, datasource_id, sql, fields } = body as Record<string, unknown>
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    typeof datasource_id === 'string' &&
    datasource_id !== '' &&
    typeof sql === 'string' &&
    sql.trim() !== '' &&
    (fields === undefined || isDatasetFields(fields))
  )
}

/** 落库归一：alias 去空白，空串/纯空白 = 未命名（缺省） */
function normalizeFields(fields: DatasetField[]): DatasetField[] {
  return fields.map(({ name, alias }) => {
    const trimmed = alias?.trim()
    return trimmed ? { name, alias: trimmed } : { name }
  })
}

/** 库行 → API 记录视图：fields 由 JSON 文本解析（列只经本校验写入，坏文本直接抛错暴露） */
function toRecord(row: DatasetRow): DatasetRecord {
  const { fields, ...rest } = row
  return { ...rest, fields: JSON.parse(fields) as DatasetField[] }
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

function findDataset(db: Database, id: string): DatasetRow | undefined {
  return db.query('SELECT * FROM dataset WHERE id = ?').get(id) as DatasetRow | undefined
}

/** 数据集跑一次 SQL 的共用前置：数据源缺失 / 类型不支持 / 执行失败以异常抛出（统一 422 口径） */
async function executeDatasetSql(db: Database, dataset: DatasetRow): Promise<QueryResult> {
  const datasource = findDatasource(db, dataset.datasource_id)
  if (!datasource) {
    throw new Error('关联数据源不存在')
  }
  const provider = getDataSourceProvider(datasource.type)
  if (!provider) {
    throw new Error(`暂不支持的数据源类型：${datasource.type}`)
  }
  try {
    // 原始行直出：列名与行数组来自 SQLite 语句本身，服务端不聚合、不重排、不补值。
    return await provider.execute({ path: datasource.path }, dataset.sql)
  } catch (error) {
    throw new Error(`SQL 执行失败：${(error as Error).message}`)
  }
}

export function mountDatasetRoutes(app: Hono, db: Database): void {
  app.get('/api/datasets', (c) =>
    c.json((db.query('SELECT * FROM dataset').all() as DatasetRow[]).map(toRecord)),
  )

  app.post('/api/datasets', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isDatasetBody(body)) {
      return c.json({ message: BAD_BODY_MESSAGE }, 400)
    }
    if (!findDatasource(db, body.datasource_id)) {
      return c.json({ message: '关联数据源不存在' }, 422)
    }
    const violation = readOnlyQueryViolation(body.sql)
    if (violation) {
      return c.json({ message: violation }, 422)
    }
    const fields = body.fields ? normalizeFields(body.fields) : []
    const row: DatasetRow = {
      id: crypto.randomUUID(),
      datasource_id: body.datasource_id,
      name: body.name,
      sql: body.sql,
      fields: JSON.stringify(fields),
      created_at: new Date().toISOString(),
    }
    db.query(
      'INSERT INTO dataset (id, datasource_id, name, sql, fields, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(row.id, row.datasource_id, row.name, row.sql, row.fields, row.created_at)
    return c.json(toRecord(row), 201)
  })

  app.get('/api/datasets/:id', (c) => {
    const row = findDataset(db, c.req.param('id'))
    return row ? c.json(toRecord(row)) : c.json({ message: '数据集不存在' }, 404)
  })

  app.put('/api/datasets/:id', async (c) => {
    const id = c.req.param('id')
    const existing = findDataset(db, id)
    if (!existing) {
      return c.json({ message: '数据集不存在' }, 404)
    }
    const body = await c.req.json().catch(() => null)
    if (!isDatasetBody(body)) {
      return c.json({ message: BAD_BODY_MESSAGE }, 400)
    }
    if (!findDatasource(db, body.datasource_id)) {
      return c.json({ message: '关联数据源不存在' }, 422)
    }
    const violation = readOnlyQueryViolation(body.sql)
    if (violation) {
      return c.json({ message: violation }, 422)
    }
    const fields = body.fields
      ? normalizeFields(body.fields)
      : (JSON.parse(existing.fields) as DatasetField[])
    db.query('UPDATE dataset SET name = ?, datasource_id = ?, sql = ?, fields = ? WHERE id = ?').run(
      body.name,
      body.datasource_id,
      body.sql,
      JSON.stringify(fields),
      id,
    )
    return c.json({
      id,
      datasource_id: body.datasource_id,
      name: body.name,
      sql: body.sql,
      fields,
      created_at: existing.created_at,
    })
  })

  app.delete('/api/datasets/:id', (c) => {
    const deleted = db.query('DELETE FROM dataset WHERE id = ?').run(c.req.param('id'))
    return deleted.changes > 0 ? c.body(null, 204) : c.json({ message: '数据集不存在' }, 404)
  })

  app.post('/api/datasets/:id/execute', async (c) => {
    const dataset = findDataset(db, c.req.param('id'))
    if (!dataset) {
      return c.json({ message: '数据集不存在' }, 404)
    }
    try {
      return c.json(await executeDatasetSql(db, dataset))
    } catch (error) {
      return c.json({ message: (error as Error).message }, 422)
    }
  })

  // 取字段：对已保存 SQL 跑一次查询，返回原始列名与前几行样例（列名 → 值）；
  // 已存命名不在此返回——调用方手里有数据集行，按 name 自行合并保留已填别名。
  app.post('/api/datasets/:id/fields', async (c) => {
    const dataset = findDataset(db, c.req.param('id'))
    if (!dataset) {
      return c.json({ message: '数据集不存在' }, 404)
    }
    try {
      const result = await executeDatasetSql(db, dataset)
      return c.json({
        fields: result.columns,
        sample: result.rows.slice(0, FIELD_SAMPLE_ROWS).map((row) =>
          Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
        ),
      })
    } catch (error) {
      return c.json({ message: (error as Error).message }, 422)
    }
  })
}
