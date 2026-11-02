// 应用数据库：bun:sqlite 持久化到独立 SQLite 文件；路径经 PRINT_FORM_DB 环境变量可配，
// 默认落应用根 data/ 目录（git 忽略）。测试与临时场景可传 ':memory:' 用内存库。
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

export const DEFAULT_DB_PATH = resolve(import.meta.dir, '../../data/print-form-designer.sqlite')

export function resolveDbPath(): string {
  return process.env.PRINT_FORM_DB ?? DEFAULT_DB_PATH
}

export function openDatabase(path: string = resolveDbPath()): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  createTables(db)
  return db
}

// 三张表对齐三组 REST 资源（数据源/数据集/模板）；模板 bands 存波段式 JSON 文本。
// 列在 P2/P5 落实读写时按需扩展。
const SCHEMA = `
CREATE TABLE IF NOT EXISTS datasource (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset (
  id TEXT PRIMARY KEY,
  datasource_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sql TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS template (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bands TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`

function createTables(db: Database): void {
  db.exec(SCHEMA)
}
