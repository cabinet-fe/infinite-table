// SQLite 文件数据源提供者（当前唯一内置 kind）：连通性校验（文件可达，缺失则按路径可建）与只读执行。
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { DEFAULT_DB_PATH } from './db'
import {
  registerDataSourceProvider,
  type DataSourceConfig,
  type DataSourceProvider,
} from './datasource-provider'

export const SQLITE_KIND = 'sqlite'

// 用户建源传相对路径时统一落在应用数据目录（与应用元数据库同目录），避免受启动 cwd 影响。
const DATA_DIR = dirname(DEFAULT_DB_PATH)

export function resolveSqlitePath(input: string): string {
  return isAbsolute(input) ? input : join(DATA_DIR, input)
}

function requirePath(config: DataSourceConfig): string {
  const raw = config.path
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('缺少文件路径')
  }
  return resolveSqlitePath(raw)
}

// SQLite 文件数据源提供者：testConnection 兼做创建时的路径校验（可达/可建），execute 只读打开执行单条 SQL。
const sqliteProvider: DataSourceProvider = {
  kind: SQLITE_KIND,

  // 可达：已有文件必须能作为 SQLite 库打开（坏文件在读 schema 时报错）；
  // 可建：缺失文件先递归确保父目录，再以默认 create 语义创建空库。
  async testConnection(config: DataSourceConfig): Promise<void> {
    const path = requirePath(config)
    mkdirSync(dirname(path), { recursive: true })
    const db = new Database(path)
    try {
      db.query('PRAGMA schema_version').get()
    } finally {
      db.close()
    }
  },

  // 只读打开：即使 SQL 逃过只读校验，SQLite 层也拒绝写入。
  async execute(config: DataSourceConfig, sql: string) {
    const path = requirePath(config)
    const db = new Database(path, { readonly: true })
    try {
      const stmt = db.prepare(sql)
      return { columns: stmt.columnNames, rows: stmt.values() }
    } finally {
      db.close()
    }
  },
}

export function registerSqliteDataSource(): void {
  registerDataSourceProvider(sqliteProvider)
}
