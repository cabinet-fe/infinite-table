// seed 演练库：首次落库即存在演练数据源/数据集与演练 SQLite 文件；二次 seed 不重复建、不重复插。
import { describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedDemoLibrary, SEED_DATASOURCE_ID } from '../../src/server/seed'
import type { DatasetRow, DatasourceRow } from '../../src/server/rows'
import { createTempDir } from './testing/demo-source'

describe('seed 演练库', () => {
  test('首次 seed：演练数据源与三个数据集落库，演练文件含两表样例数据', () => {
    const dir = createTempDir()
    const demoPath = join(dir, 'demo.sqlite')
    const db = openDatabase(':memory:')

    const seeded = seedDemoLibrary(db, { demoPath })
    expect(seeded.path).toBe(demoPath)
    expect(existsSync(demoPath)).toBe(true)

    const datasources = db.query('SELECT * FROM datasource').all() as DatasourceRow[]
    expect(datasources).toHaveLength(1)
    expect(datasources[0]!.id).toBe(SEED_DATASOURCE_ID)
    expect(datasources[0]!.name).toBe('销售演练库')

    const datasets = db.query('SELECT * FROM dataset').all() as DatasetRow[]
    expect(datasets.map((row) => row.id).sort()).toEqual([
      'seed-dataset-order-header',
      'seed-dataset-order-items',
      'seed-dataset-sales-lines',
    ])

    const demo = new Database(demoPath, { readonly: true })
    expect(demo.query('SELECT count(*) AS c FROM sales_order').get()).toEqual({ c: 2 })
    expect(demo.query('SELECT count(*) AS c FROM sales_order_item').get()).toEqual({ c: 5 })
    demo.close()
  })

  test('二次 seed 幂等：库表行数与演练文件数据都不重复', () => {
    const dir = createTempDir()
    const demoPath = join(dir, 'demo.sqlite')
    const db = openDatabase(':memory:')

    seedDemoLibrary(db, { demoPath })
    seedDemoLibrary(db, { demoPath })

    expect(db.query('SELECT count(*) AS c FROM datasource').get()).toEqual({ c: 1 })
    expect(db.query('SELECT count(*) AS c FROM dataset').get()).toEqual({ c: 3 })
    const demo = new Database(demoPath, { readonly: true })
    expect(demo.query('SELECT count(*) AS c FROM sales_order').get()).toEqual({ c: 2 })
    expect(demo.query('SELECT count(*) AS c FROM sales_order_item').get()).toEqual({ c: 5 })
    demo.close()
  })

  test('seed 后经 REST 可见演练数据源，且演练数据集可执行出原始行', async () => {
    const dir = createTempDir()
    const demoPath = join(dir, 'demo.sqlite')
    const db = openDatabase(':memory:')
    seedDemoLibrary(db, { demoPath })
    const app = createApp(db)

    const datasources = (await (await app.request('/api/datasources')).json()) as DatasourceRow[]
    expect(datasources).toHaveLength(1)

    const execute = await app.request('/api/datasets/seed-dataset-sales-lines/execute', {
      method: 'POST',
    })
    expect(execute.status).toBe(200)
    const result = (await execute.json()) as { columns: string[]; rows: unknown[][] }
    expect(result.columns).toEqual([
      'order_no',
      'order_date',
      'customer',
      'line_no',
      'item_name',
      'spec',
      'unit',
      'qty',
      'unit_price',
      'amount',
    ])
    expect(result.rows).toHaveLength(5)
    expect(result.rows[0]![0]).toBe('SO-2026-001')
  })
})
