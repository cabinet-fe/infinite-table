// 建库口径：新库直接建三表；旧库（模板表还是 bands 列）在启动时整表换代，
// 数据源表原样保留，数据集表数据保留并补 fields 列（字段命名 JSON 文本）；
// v3 及更早的行（template 列但 schemaVersion < 4）在启动时行级丢弃，v4 行自动
// 迁移为 v5（聚合表达式包一层 return），当前版行保留。
import { beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { openDatabase } from '../../src/server/db'
import { TEMPLATE_SCHEMA_VERSION } from '../../src/shared/template-schema'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pfd-db-'))
  path = join(dir, 'app.sqlite')
})

/** 最小合法模板文档（schemaVersion 为当前版；行级换代测试用） */
function currentDocument(): string {
  return JSON.stringify({
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    regions: [],
    aggregations: [],
    sheet: { cells: [], styles: [], merges: [], frozen: { rows: 0, cols: 0 }, rows: 0, cols: 0 },
  })
}

/** v4 文档（聚合 expression 还是单表达式；迁移测试用） */
function v4Document(): string {
  return JSON.stringify({
    schemaVersion: 4,
    regions: [],
    aggregations: [
      {
        name: 'order',
        params: [{ datasetId: 'd1', varName: 'orders' }],
        expression: 'orders.slice(0, 1)',
      },
    ],
    sheet: { cells: [], styles: [], merges: [], frozen: { rows: 0, cols: 0 }, rows: 0, cols: 0 },
  })
}

/** 旧版建表语句（模板表列名为 bands），并按旧口径塞一行数据源、一行旧模板 */
function seedLegacyDatabase(): void {
  const db = new Database(path)
  db.exec(`
    CREATE TABLE datasource (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      path TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE dataset (
      id TEXT PRIMARY KEY, datasource_id TEXT NOT NULL, name TEXT NOT NULL,
      sql TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE template (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, bands TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO datasource (id, name, type, path, created_at)
      VALUES ('d1', '演练库', 'sqlite', 'demo.db', '2026-11-02');
    INSERT INTO template (id, name, bands, created_at)
      VALUES ('t1', '旧模板', '{"schemaVersion":2,"regions":[],"cols":8}', '2026-11-02');
  `)
  db.close()
}

describe('启动建库', () => {
  test('新库直接按当前列名建三表', () => {
    const db = openDatabase(path)
    const templateColumns = (
      db.query("PRAGMA table_info('template')").all() as { name: string }[]
    ).map((column) => column.name)
    const datasetColumns = (
      db.query("PRAGMA table_info('dataset')").all() as { name: string }[]
    ).map((column) => column.name)
    db.close()
    expect(templateColumns).toEqual(['id', 'name', 'template', 'created_at'])
    expect(datasetColumns).toEqual(['id', 'datasource_id', 'name', 'sql', 'fields', 'created_at'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('旧库数据集表补列：无 fields 列 → ALTER 后数据原样保留、可读写字段命名', () => {
    const seed = new Database(path)
    seed.exec(`
      CREATE TABLE dataset (
        id TEXT PRIMARY KEY, datasource_id TEXT NOT NULL, name TEXT NOT NULL,
        sql TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO dataset (id, datasource_id, name, sql, created_at)
        VALUES ('ds1', 'd1', '旧数据集', 'SELECT 1', '2026-11-01');
    `)
    seed.close()

    const db = openDatabase(path)
    const columns = (
      db.query("PRAGMA table_info('dataset')").all() as { name: string }[]
    ).map((column) => column.name)
    expect(columns).toEqual(['id', 'datasource_id', 'name', 'sql', 'created_at', 'fields'])

    // 旧行原样保留，fields 回填默认 '[]'（未命名）
    const row = db.query('SELECT * FROM dataset WHERE id = ?').get('ds1') as {
      name: string
      fields: string
    }
    expect(row.name).toBe('旧数据集')
    expect(row.fields).toBe('[]')

    // 补列后可正常读写字段命名（JSON 文本 round-trip）
    db.query('UPDATE dataset SET fields = ? WHERE id = ?').run(
      JSON.stringify([{ name: 'a', alias: '甲' }]),
      'ds1',
    )
    const updated = db.query('SELECT fields FROM dataset WHERE id = ?').get('ds1') as {
      fields: string
    }
    expect(JSON.parse(updated.fields)).toEqual([{ name: 'a', alias: '甲' }])
    db.close()

    // 幂等：已补列库再打开不重复 ALTER
    const again = openDatabase(path)
    const after = (
      again.query("PRAGMA table_info('dataset')").all() as { name: string }[]
    ).map((column) => column.name)
    again.close()
    expect(after).toEqual(columns)
    rmSync(dir, { recursive: true, force: true })
  })

  test('旧库模板表换代：旧模板丢弃，数据源原样保留，再次打开不再改动', () => {
    seedLegacyDatabase()
    const first = openDatabase(path)
    const templates = first.query('SELECT count(*) AS n FROM template').get() as { n: number }
    const datasources = first.query('SELECT id, name FROM datasource').all()
    first.close()

    expect(templates.n).toBe(0)
    expect(datasources).toEqual([{ id: 'd1', name: '演练库' }])

    // 幂等：已换代库再打开不会重复 DROP/重建，也不会碰已有数据
    const second = openDatabase(path)
    second.exec(
      `INSERT INTO template (id, name, template, created_at) VALUES ('t2', '新模板', '${currentDocument()}', '2026-11-03')`,
    )
    second.close()
    const third = openDatabase(path)
    const kept = third.query('SELECT id FROM template').all()
    third.close()
    expect(kept).toEqual([{ id: 't2' }])
    rmSync(dir, { recursive: true, force: true })
  })

  test('行级换代：v3 与坏文档丢弃，v4 行自动迁移为 v5（聚合包 return）并保留', () => {
    const seed = new Database(path)
    seed.exec(`
      CREATE TABLE template (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, template TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO template (id, name, template, created_at) VALUES
        ('v3-row', '旧版行', '{"schemaVersion":3,"regions":[],"sheet":{}}', '2026-10-01'),
        ('bad-row', '坏文档', 'not-json', '2026-10-02'),
        ('v4-row', '待迁移', '${v4Document()}', '2026-10-03'),
        ('v5-row', '当前版', '${currentDocument()}', '2026-11-01');
    `)
    seed.close()

    const db = openDatabase(path)
    const rows = db.query('SELECT id, template FROM template ORDER BY id').all() as {
      id: string
      template: string
    }[]
    db.close()
    expect(rows.map((row) => row.id)).toEqual(['v4-row', 'v5-row'])
    const migrated = JSON.parse(
      rows.find((row) => row.id === 'v4-row')!.template,
    ) as {
      schemaVersion: number
      aggregations: { expression: string }[]
    }
    expect(migrated.schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
    expect(migrated.aggregations[0]!.expression).toBe('return (\norders.slice(0, 1)\n);')
    rmSync(dir, { recursive: true, force: true })
  })
})
