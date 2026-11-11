// 骨架口径：内存库上验证启动建表、清单路由空集/直查库、数据源提供者注册点。
// 模板 CRUD 行为与 round-trip 在 template.test.ts 覆盖（P5 落实后占位 501 断言移除）。
import { describe, expect, test } from 'vitest'
import { openDatabase, resolveDbPath } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import {
  getDataSourceProvider,
  registerDataSourceProvider,
  type DataSourceProvider,
} from '../../src/server/datasource-provider'

describe('资源路由骨架', () => {
  test('空库时三组清单路由都返回空集', async () => {
    const app = createApp(openDatabase(':memory:'))
    for (const resource of ['datasources', 'datasets', 'templates']) {
      const res = await app.request(`/api/${resource}`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual([])
    }
  })

  test('清单路由直查库表（openDatabase 已完成启动建表）', async () => {
    const db = openDatabase(':memory:')
    db.exec(
      "INSERT INTO datasource (id, name, type, path, created_at) VALUES ('d1', '演练库', 'sqlite', 'demo.db', '2026-11-02')",
    )
    const res = await createApp(db).request('/api/datasources')
    expect(await res.json()).toEqual([
      { id: 'd1', name: '演练库', type: 'sqlite', path: 'demo.db', created_at: '2026-11-02' },
    ])
  })
})

describe('数据库路径配置', () => {
  test('PRINT_FORM_DB 环境变量可覆盖默认路径', () => {
    const previous = process.env.PRINT_FORM_DB
    process.env.PRINT_FORM_DB = '/tmp/pfd-test.sqlite'
    try {
      expect(resolveDbPath()).toBe('/tmp/pfd-test.sqlite')
    } finally {
      if (previous === undefined) {
        delete process.env.PRINT_FORM_DB
      } else {
        process.env.PRINT_FORM_DB = previous
      }
    }
  })
})

describe('数据源提供者注册点', () => {
  test('注册后可按 kind 发现，未注册返回 undefined', () => {
    const provider: DataSourceProvider = {
      kind: 'concept-only',
      async testConnection() {},
      async execute() {
        return { columns: [], rows: [] }
      },
    }
    registerDataSourceProvider(provider)
    expect(getDataSourceProvider('concept-only')).toBe(provider)
    expect(getDataSourceProvider('mysql')).toBeUndefined()
  })
})
