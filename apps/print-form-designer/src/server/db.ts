// 应用数据库：bun:sqlite 持久化到独立 SQLite 文件；路径经 PRINT_FORM_DB 环境变量可配，
// 默认落应用根 data/ 目录（git 忽略）。测试与临时场景可传 ':memory:' 用内存库。
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

import { probeAggregationType } from '../domain/aggregation'
import {
  TEMPLATE_SCHEMA_VERSION,
  migrateTemplateToCurrent,
  type FormTemplate,
} from '../shared/template-schema'

export const DEFAULT_DB_PATH = resolve(import.meta.dirname, '../../data/print-form-designer.sqlite')

export function resolveDbPath(): string {
  return process.env.PRINT_FORM_DB ?? DEFAULT_DB_PATH
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  addDatasetFieldsColumn(db)
  discardLegacyTemplateTable(db, path)
  migrateOutdatedTemplates(db, path)
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
  fields TEXT NOT NULL DEFAULT '[]',
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
 * 数据集表补列：fields 列存字段命名 JSON 文本（`[{ name, alias? }]`，name = SQL 原始列名，
 * alias 为空即用原名）——只影响展示，不改绑定存储值。建表语句自带该列，这里只兜旧库：
 * 无 fields 列的库 ALTER 补列并按默认 '[]'（未命名）回填，数据原样保留、幂等。
 */
function addDatasetFieldsColumn(db: Database): void {
  const columns = db.query("PRAGMA table_info('dataset')").all() as { name: string }[]
  // 新库（表还不存在）与已补列库都不动
  if (columns.length === 0 || columns.some((column) => column.name === 'fields')) return
  db.exec("ALTER TABLE dataset ADD COLUMN fields TEXT NOT NULL DEFAULT '[]'")
}

/**
 * 旧库清理：模板表曾以 `bands` 列存文档（模板 schemaVersion ≤ 2 时代）。
 *
 * 列名换代连带文档结构换代（v3 起数据块自带数据源、画布不再声明 cols），两版之间没有
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
      `[print-form-designer] ${path}：旧版模板表（bands 列）无法迁移到新版，已丢弃 ${dropped} 个模板`,
    )
  }
}

/**
 * 行级换代：v4/v5 → v6 有机械迁移路径（v4 聚合表达式包一层 return、v5 聚合缺 type
 * 由空数据试跑推导，见 shared/template-schema.ts 的 migrateTemplateToCurrent），启动时把 v4/v5 行
 * 原地改写为 v6 保留，不丢数据；比 v4 更早的行（v3 时代：绝对绑定/作用方式被移除）
 * 与 v2 → v3 一样没有可用迁移，连同非 JSON 坏文档一并删除并报出条数。当前版本行
 * 原样保留（幂等，不改写）。
 */
function migrateOutdatedTemplates(db: Database, path: string): void {
  const columns = db.query("PRAGMA table_info('template')").all() as { name: string }[]
  if (columns.length === 0) return
  const rows = db.query('SELECT id, template FROM template').all() as {
    id: string
    template: string
  }[]
  const drop = db.query('DELETE FROM template WHERE id = ?')
  const update = db.query('UPDATE template SET template = ? WHERE id = ?')
  let migrated = 0
  let dropped = 0
  for (const row of rows) {
    let document: FormTemplate
    try {
      document = migrateTemplateToCurrent(
        JSON.parse(row.template) as FormTemplate,
        probeAggregationType,
      )
    } catch {
      drop.run(row.id)
      dropped++
      continue
    }
    const next = JSON.stringify(document)
    if (next !== row.template) {
      update.run(next, row.id)
      migrated++
    }
  }
  if (migrated > 0) {
    console.warn(
      `[print-form-designer] ${path}：${migrated} 个 v4/v5 模板已自动迁移到 v${TEMPLATE_SCHEMA_VERSION}`,
    )
  }
  if (dropped > 0) {
    console.warn(`[print-form-designer] ${path}：${dropped} 个旧版模板无法迁移，已丢弃`)
  }
}
