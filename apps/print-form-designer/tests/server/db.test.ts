// 建库口径：新库直接建三表；旧库（模板表还是 bands 列）在启动时整表换代，
// 数据源/数据集两张表原样保留。
import { beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { openDatabase } from '../../src/server/db'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pfd-db-'))
  path = join(dir, 'app.sqlite')
})

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
    db.close()
    expect(templateColumns).toEqual(['id', 'name', 'template', 'created_at'])
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
      "INSERT INTO template (id, name, template, created_at) VALUES ('t2', '新模板', '{}', '2026-11-03')",
    )
    second.close()
    const third = openDatabase(path)
    const kept = third.query('SELECT id FROM template').all()
    third.close()
    expect(kept).toEqual([{ id: 't2' }])
    rmSync(dir, { recursive: true, force: true })
  })
})
