// 数据集 REST：创建/保存/编辑（关联校验、只读 SQL 护栏）与执行（原始行直出：列名 + 行数组）。
import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { createDemoSqliteFile, createTempDir } from './testing/demo-source'

async function createDatasourceAndDataset(
  app: ReturnType<typeof createApp>,
  path: string,
  sql = 'SELECT name, qty FROM item ORDER BY qty',
): Promise<{ datasourceId: string; datasetId: string }> {
  const datasource = (await (
    await app.request('/api/datasources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '样例库', type: 'sqlite', path }),
    })
  ).json()) as { id: string }
  const dataset = (await (
    await app.request('/api/datasets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '商品明细', datasource_id: datasource.id, sql }),
    })
  ).json()) as { id: string }
  return { datasourceId: datasource.id, datasetId: dataset.id }
}

describe('数据集 REST', () => {
  test('创建返回 201；关联数据源不存在返回 422；缺字段返回 400', async () => {
    const dir = createTempDir()
    const app = createApp(openDatabase(':memory:'))
    const { datasetId } = await createDatasourceAndDataset(app, createDemoSqliteFile(dir))
    expect(datasetId).toBeTruthy()

    const orphan = await app.request('/api/datasets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '孤儿', datasource_id: 'nope', sql: 'SELECT 1' }),
    })
    expect(orphan.status).toBe(422)

    const malformed = await app.request('/api/datasets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', datasource_id: 'nope' }),
    })
    expect(malformed.status).toBe(400)
  })

  test('编辑保存（PUT）更新名称与 SQL，不存在的返回 404', async () => {
    const dir = createTempDir()
    const app = createApp(openDatabase(':memory:'))
    const { datasourceId, datasetId } = await createDatasourceAndDataset(
      app,
      createDemoSqliteFile(dir),
    )

    const updated = await app.request(`/api/datasets/${datasetId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '改名单',
        datasource_id: datasourceId,
        sql: 'SELECT qty FROM item',
      }),
    })
    expect(updated.status).toBe(200)
    const row = (await updated.json()) as { name: string; sql: string }
    expect(row.name).toBe('改名单')
    expect(row.sql).toBe('SELECT qty FROM item')

    const missing = await app.request('/api/datasets/nope', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', datasource_id: datasourceId, sql: 'SELECT 1' }),
    })
    expect(missing.status).toBe(404)
  })

  test('执行返回原始行：列名与行数组直出，无服务端重塑', async () => {
    const dir = createTempDir()
    const app = createApp(openDatabase(':memory:'))
    const { datasetId } = await createDatasourceAndDataset(app, createDemoSqliteFile(dir))

    const res = await app.request(`/api/datasets/${datasetId}/execute`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      columns: ['name', 'qty'],
      rows: [
        ['棉布', 12],
        ['涤纶', 30],
      ],
    })
  })

  test('只读护栏：写入语句创建与执行都被拒；空结果集仍返回列名', async () => {
    const dir = createTempDir()
    const app = createApp(openDatabase(':memory:'))
    const path = createDemoSqliteFile(dir)

    const write = await app.request('/api/datasets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '写入',
        datasource_id: 'x',
        sql: "INSERT INTO item VALUES ('a', 1, 1)",
      }),
    })
    expect(write.status).toBe(422)

    const { datasourceId, datasetId } = await createDatasourceAndDataset(
      app,
      path,
      'SELECT 1 AS a WHERE 1=0',
    )
    const multi = await app.request(`/api/datasets/${datasetId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '串语句',
        datasource_id: datasourceId,
        sql: 'SELECT 1; SELECT 2',
      }),
    })
    expect(multi.status).toBe(422)

    const empty = await app.request(`/api/datasets/${datasetId}/execute`, { method: 'POST' })
    expect(await empty.json()).toEqual({ columns: ['a'], rows: [] })
  })

  test('执行引用不存在的表返回 422；删除数据集返回 204', async () => {
    const dir = createTempDir()
    const app = createApp(openDatabase(':memory:'))
    const { datasetId } = await createDatasourceAndDataset(
      app,
      createDemoSqliteFile(dir),
      'SELECT * FROM no_such_table',
    )

    const failed = await app.request(`/api/datasets/${datasetId}/execute`, { method: 'POST' })
    expect(failed.status).toBe(422)
    const body = (await failed.json()) as { message: string }
    expect(body.message).toContain('no such table')

    const deleted = await app.request(`/api/datasets/${datasetId}`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)
    expect(await (await app.request('/api/datasets')).json()).toEqual([])

    const again = await app.request(`/api/datasets/${datasetId}`, { method: 'DELETE' })
    expect(again.status).toBe(404)
  })
})
