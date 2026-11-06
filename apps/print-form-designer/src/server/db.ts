// 应用数据库：bun:sqlite 持久化到独立 SQLite 文件；路径经 PRINT_FORM_DB 环境变量可配，
// 默认落应用根 data/ 目录（git 忽略）。测试与临时场景可传 ':memory:' 用内存库。
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

export const DEFAULT_DB_PATH = resolve(import.meta.dir, '../../data/print-form-designer.sqlite')

export function resolveDbPath(): string {
  return process.env.PRINT_FORM_DB ?? DEFAULT_DB_PATH
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  discardLegacyTemplateTable(db, path)
  createTables(db)
  return db
}

// 三张表对齐三组 REST 资源（数据源/数据集/模板）；模板 template 列存模板文档 JSON 文本
// （FormTemplate 去掉 name 后原样序列化，name 走独立列供清单查询）。
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
  template TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`

function createTables(db: Database): void {
  db.exec(SCHEMA)
}

/**
 * 旧库清理：模板表曾以 `bands` 列存文档（模板 schemaVersion ≤ 2 时代）。
 *
 * 列名换代连带文档结构换代（v3 起区域自带数据源、画布不再声明 cols），两版之间没有
 * 可用迁移——加载链只认当前版本，读到旧文档就抛错。这里把旧表整表丢弃、由建表语句
 * 重建，旧模板一并丢弃并在 stderr 报出条数（不静默吞掉用户数据）；数据源与数据集
 * 两张表结构和口径都没变，原样保留。
 */
function discardLegacyTemplateTable(db: Database, path: string): void {
  const columns = db.query("PRAGMA table_info('template')").all() as { name: string }[]
  // 新库（表还不存在）与已换代库（列已叫 template）都不动
  if (columns.length === 0 || columns.some((column) => column.name === 'template')) return
  const { dropped } = db.query('SELECT count(*) AS dropped FROM template').get() as {
    dropped: number
  }
  db.exec('DROP TABLE template')
  if (dropped > 0) {
    console.warn(
      `[print-form-designer] ${path}：旧版模板表（bands 列）无法迁移到 v3，已丢弃 ${dropped} 个模板`,
    )
  }
}
