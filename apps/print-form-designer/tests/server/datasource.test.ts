// 数据源 REST：创建校验（路径可建/文件可达、类型白名单）、清单、详情、删除级联。
import { describe, expect, test } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { createDemoSqliteFile, createTempDir } from './testing/demo-source'

describe('数据源 REST', () => {
  test('创建可达的既有 SQLite 文件返回 201 并落库', async () => {
    const dir = createTempDir()
    const path = createDemoSqliteFile(dir)
    const app = createApp(openDatabase(':memory:'))

    const res = await app.request('/api/datasources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '样例库', type: 'sqlite', path }),
    })
    expect(res.status).toBe(201)
    const row = (await res.json()) as { id: string; path: string }
    expect(row.path).toBe(path)

    const list = (await (await app.request('/api/datasources')).json()) as unknown[]
    expect(list).toHaveLength(1)

    const detail = await app.request(`/api/datasources/${row.id}`)
    expect(detail.status).toBe(200)
  })

  test('路径可建：缺失文件与父目录时创建数据源即递归建目录与空库文件', async () => {
    const dir = createTempDir()
    const path = join(dir, 'nested', 'new.sqlite')
    const app = createApp(openDatabase(':memory:'))

    const res = await app.request('/api/datasources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '新库', type: 'sqlite', path }),
    })
    expect(res.status).toBe(201)
    expect(existsSync(path)).toBe(true)
  })

  test('文件不可达：坏文件（非 SQLite 内容）返回 422', async () => {
    const dir = createTempDir()
    const path = join(dir, 'junk.txt')
    writeFileSync(path, 'not a sqlite file')
    const app = createApp(openDatabase(':memory:'))

    const res = await app.request('/api/datasources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '坏库', type: 'sqlite', path }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('校验失败')
  })

  test('非 sqlite 类型返回 422，缺字段请求体返回 400', async () => {
    const app = createApp(openDatabase(':memory:'))
    const unsupported = await app.request('/api/datasources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'mysql 库', type: 'mysql', path: 'host' }),
    })
    expect(unsupported.status).toBe(422)

    const malformed = await app.request('/api/datasources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', type: 'sqlite', path: 'a.sqlite' }),
    })
    expect(malformed.status).toBe(400)
  })

  test('删除数据源返回 204 并级联删除其数据集，删除不存在的返回 404', async () => {
    const dir = createTempDir()
    const app = createApp(openDatabase(':memory:'))
    const created = (await (
      await app.request('/api/datasources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '样例库', type: 'sqlite', path: createDemoSqliteFile(dir) }),
      })
    ).json()) as { id: string }
    const dataset = (await (
      await app.request('/api/datasets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: '明细',
          datasource_id: created.id,
          sql: 'SELECT * FROM item',
        }),
      })
    ).json()) as { id: string }
    expect(dataset.id).toBeTruthy()

    const deleted = await app.request(`/api/datasources/${created.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(204)
    expect(await (await app.request('/api/datasources')).json()).toEqual([])
    expect(await (await app.request('/api/datasets')).json()).toEqual([])

    const again = await app.request(`/api/datasources/${created.id}`, { method: 'DELETE' })
    expect(again.status).toBe(404)
  })
})
