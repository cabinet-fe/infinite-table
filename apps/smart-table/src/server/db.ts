// SQLite 数据库连接、建表、旧库平滑迁移与双模式表（普通自建表 + 进阶 SQL 物理表）读写封装。
// 路径支持 SMART_TABLE_DB 环境变量覆盖；测试传入 ':memory:' 使用内存数据库。
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import type {
  BatchImportRecordsResponse,
  BatchImportRowError,
  CreateTableRequest,
  TableBundle,
} from '../shared/api-types'
import {
  validateBatchRecords,
  validateRecordForCreate,
  validateRecordPatch,
} from '../shared/record-validation'
import {
  MAX_DECIMAL_PLACES,
  MIN_DECIMAL_PLACES,
  isDerivedColumnType,
  isValidDecimalPlaces,
  splitColumnsByLayer,
  type CellTextAlign,
  type MemberAccessLevel,
  type SmartColumn,
  type SmartColumnType,
  type SmartRecord,
  type SmartTableMeta,
  type SmartView,
  type SmartViewType,
  type SummaryType,
  type TableKind,
  type TableRowScope,
} from '../shared/schema'
import { ensureBuiltinDemoUsers } from './auth'

const DEFAULT_DB_PATH = resolve(import.meta.dirname, '../../data/smart-table.sqlite')

export function resolveDbPath(): string {
  return process.env.SMART_TABLE_DB ?? DEFAULT_DB_PATH
}

/** 服务端请求参数与数据校验错误（在路由层映射为 HTTP 400） */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

/** 未登录或认证无效错误（HTTP 401） */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

/** 权限不足错误（HTTP 403） */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** 资源不存在错误（HTTP 404） */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/** 资源已失效或过期错误（HTTP 410） */
export class ShareGoneError extends Error {
  readonly statusKind: 'revoked' | 'expired'

  constructor(message: string, statusKind: 'revoked' | 'expired') {
    super(message)
    this.name = 'ShareGoneError'
    this.statusKind = statusKind
  }
}

/** 批量导入校验错误（在路由层映射为 HTTP 400 并附带逐行错误明细） */
export class BatchValidationError extends ValidationError {
  readonly errors: BatchImportRowError[]

  constructor(message: string, errors: BatchImportRowError[]) {
    super(message)
    this.name = 'BatchValidationError'
    this.errors = errors
  }
}

/** 校验可选小数位数（必须为 0~6 的整数，否则抛出 ValidationError -> HTTP 400） */
export function assertValidDecimalPlaces(value: unknown, subject: string): void {
  if (value !== undefined && !isValidDecimalPlaces(value)) {
    throw new ValidationError(
      `${subject} 的 decimalPlaces 必须为 ${MIN_DECIMAL_PLACES}~${MAX_DECIMAL_PLACES} 的整数`,
    )
  }
}

/** 校验透视配置内所有度量项的 decimalPlaces */
export function validatePivotMeasuresDecimalPlaces(pivotConfig: unknown, scopePrefix = ''): void {
  if (!isPlainObject(pivotConfig) || !Array.isArray(pivotConfig.measures)) {
    return
  }
  for (const measure of pivotConfig.measures) {
    if (isPlainObject(measure)) {
      const measureKey =
        typeof measure.key === 'string' && measure.key.trim() !== '' ? measure.key : '未命名'
      const label = `透视指标 "${measureKey}"`
      assertValidDecimalPlaces(
        measure.decimalPlaces,
        scopePrefix ? `${scopePrefix} ${label}` : label,
      )
    }
  }
}

let savepointSeq = 0

/** 事务执行封装：优先调用 bun:sqlite 原生 db.transaction，Vitest node:sqlite shim 下回退 SAVEPOINT */
export function runInTransaction<T>(db: Database, fn: () => T): T {
  if (typeof (db as { transaction?: unknown }).transaction === 'function') {
    return db.transaction(fn)()
  }
  const sp = `sp_${++savepointSeq}`
  db.exec(`SAVEPOINT ${sp};`)
  try {
    const result = fn()
    db.exec(`RELEASE SAVEPOINT ${sp};`)
    return result
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${sp};`)
    db.exec(`RELEASE SAVEPOINT ${sp};`)
    throw error
  }
}

const VALID_COLUMN_TYPES: ReadonlySet<SmartColumnType> = new Set([
  'text',
  'number',
  'select',
  'date',
  'checkbox',
  'person',
  'progress',
  'image',
  'link',
  'lookup',
  'formula',
])

const VALID_CELL_ALIGNS: ReadonlySet<CellTextAlign> = new Set(['left', 'center', 'right'])

export const VALID_VIEW_TYPES: ReadonlySet<SmartViewType> = new Set([
  'table',
  'kanban',
  'pivot',
  'dashboard',
])

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#2563eb',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS server_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS smart_tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  primary_key_field TEXT,
  source_sql_table TEXT,
  schema_json TEXT NOT NULL,
  views_json TEXT NOT NULL,
  created_by TEXT,
  row_scope TEXT NOT NULL DEFAULT 'all',
  owner_column_key TEXT,
  member_access TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS smart_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  derived_columns_json TEXT NOT NULL DEFAULT '[]',
  lookup_overrides_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT,
  visibility_scope TEXT NOT NULL DEFAULT 'all',
  manager_user_ids_json TEXT NOT NULL DEFAULT '[]',
  member_access TEXT NOT NULL DEFAULT 'readonly',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_smart_apps_order ON smart_apps(sort_order);

CREATE TABLE IF NOT EXISTS workspace_views (
  id TEXT PRIMARY KEY,
  app_id TEXT REFERENCES smart_apps(id) ON DELETE CASCADE,
  table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_by TEXT,
  visibility_scope TEXT NOT NULL DEFAULT 'all',
  manager_user_ids_json TEXT NOT NULL DEFAULT '[]',
  member_access TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspace_views_order ON workspace_views(sort_order);

CREATE TABLE IF NOT EXISTS smart_table_records (
  id TEXT NOT NULL,
  table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
  row_order INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (table_id, id)
);
CREATE INDEX IF NOT EXISTS idx_records_table ON smart_table_records(table_id, row_order);

CREATE TABLE IF NOT EXISTS record_ownership (
  table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (table_id, record_id)
);
CREATE INDEX IF NOT EXISTS idx_record_ownership_creator ON record_ownership(created_by);

CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);
CREATE INDEX IF NOT EXISTS idx_shares_creator ON shares(created_by);
CREATE INDEX IF NOT EXISTS idx_shares_target ON shares(target_type, target_id);

CREATE TABLE IF NOT EXISTS biz_employees (
  emp_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT NOT NULL,
  level TEXT NOT NULL,
  region TEXT NOT NULL,
  email TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emp_name ON biz_employees(name);

CREATE TABLE IF NOT EXISTS biz_payments (
  pay_id TEXT PRIMARY KEY,
  project_code TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  year TEXT NOT NULL,
  month TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  pay_method TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_project ON biz_payments(project_code);
`

/** 兼容升级已有数据库文件：迁移单主键 smart_table_records 为复合主键 + 级联外键，并补齐 biz_payments.region */
function migrateLegacySchema(db: Database): void {
  const recordCols = db.query('PRAGMA table_info(smart_table_records)').all() as {
    name: string
    pk: number
  }[]
  const pkCols = new Set(recordCols.filter((c) => c.pk > 0).map((c) => c.name))
  const fkList = db.query('PRAGMA foreign_key_list(smart_table_records)').all() as {
    table: string
    on_delete: string
  }[]
  const hasCascadeFk = fkList.some(
    (fk) => fk.table === 'smart_tables' && fk.on_delete.toUpperCase() === 'CASCADE',
  )

  if (!pkCols.has('table_id') || !pkCols.has('id') || !hasCascadeFk) {
    db.exec('PRAGMA foreign_keys = OFF;')
    try {
      runInTransaction(db, () => {
        db.exec(`
          CREATE TABLE smart_table_records_v2 (
            id TEXT NOT NULL,
            table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
            row_order INTEGER NOT NULL,
            data_json TEXT NOT NULL,
            PRIMARY KEY (table_id, id)
          );
          INSERT INTO smart_table_records_v2 (id, table_id, row_order, data_json)
          SELECT id, table_id, row_order, data_json
          FROM smart_table_records
          WHERE table_id IN (SELECT id FROM smart_tables);
          DROP TABLE smart_table_records;
          ALTER TABLE smart_table_records_v2 RENAME TO smart_table_records;
          CREATE INDEX IF NOT EXISTS idx_records_table ON smart_table_records(table_id, row_order);
        `)
      })
    } finally {
      db.exec('PRAGMA foreign_keys = ON;')
    }
  }

  const tableCols = db.query('PRAGMA table_info(smart_tables)').all() as { name: string }[]
  const tableColNames = new Set(tableCols.map((c) => c.name))
  const ensureColumns = (
    table: string,
    existing: Set<string>,
    defs: readonly [string, string][],
  ) => {
    for (const [col, sqlType] of defs) {
      if (!existing.has(col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${sqlType};`)
        existing.add(col)
      }
    }
  }
  ensureColumns('smart_tables', tableColNames, [
    ['created_by', 'TEXT'],
    ['row_scope', "TEXT NOT NULL DEFAULT 'all'"],
    ['owner_column_key', 'TEXT'],
    ['member_access', 'TEXT'],
  ])

  const paymentCols = db.query('PRAGMA table_info(biz_payments)').all() as { name: string }[]
  if (!paymentCols.some((c) => c.name === 'region')) {
    db.exec("ALTER TABLE biz_payments ADD COLUMN region TEXT NOT NULL DEFAULT '';")
  }

  const viewCols = db.query('PRAGMA table_info(workspace_views)').all() as { name: string }[]
  const viewColNames = new Set(viewCols.map((c) => c.name))
  if (!viewColNames.has('app_id')) {
    db.exec(
      'ALTER TABLE workspace_views ADD COLUMN app_id TEXT REFERENCES smart_apps(id) ON DELETE CASCADE;',
    )
    viewColNames.add('app_id')
  }
  ensureColumns('workspace_views', viewColNames, [
    ['created_by', 'TEXT'],
    ['visibility_scope', "TEXT NOT NULL DEFAULT 'all'"],
    ['manager_user_ids_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['member_access', 'TEXT'],
  ])
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_workspace_views_app ON workspace_views(app_id, sort_order);',
  )

  const appCols = db.query('PRAGMA table_info(smart_apps)').all() as { name: string }[]
  const appColNames = new Set(appCols.map((c) => c.name))
  ensureColumns('smart_apps', appColNames, [
    ['derived_columns_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['lookup_overrides_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['created_by', 'TEXT'],
    ['visibility_scope', "TEXT NOT NULL DEFAULT 'all'"],
    ['manager_user_ids_json', "TEXT NOT NULL DEFAULT '[]'"],
    ['member_access', "TEXT NOT NULL DEFAULT 'readonly'"],
  ])
}

/** 将未归属 app_id 的历史视图自动按数据源表分组挂接到对应的智能表格应用 */
function backfillAppsForOrphanViews(db: Database): void {
  const orphanRows = db
    .query(
      "SELECT DISTINCT v.table_id, t.name AS table_name, t.updated_at FROM workspace_views v JOIN smart_tables t ON t.id = v.table_id WHERE v.app_id IS NULL OR v.app_id = '' ORDER BY t.rowid ASC",
    )
    .all() as { table_id: string; table_name: string; updated_at: string }[]
  if (orphanRows.length === 0) return

  runInTransaction(db, () => {
    const orderRow = db
      .query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM smart_apps')
      .get() as { next_order: number } | undefined | null
    let nextOrder = orderRow?.next_order ?? 0
    const findExistingApp = db.query(
      'SELECT id FROM smart_apps WHERE table_id = ? ORDER BY sort_order ASC, rowid ASC LIMIT 1',
    )
    const insertApp = db.query(
      'INSERT INTO smart_apps (id, name, description, table_id, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    const attachViews = db.query(
      "UPDATE workspace_views SET app_id = ? WHERE table_id = ? AND (app_id IS NULL OR app_id = '')",
    )

    for (const row of orphanRows) {
      const existing = findExistingApp.get(row.table_id) as { id: string } | undefined | null
      let appId = existing?.id
      if (!appId) {
        appId = `app_${row.table_id}`
        while (db.query('SELECT 1 FROM smart_apps WHERE id = ?').get(appId)) {
          appId = `app_${crypto.randomUUID().slice(0, 8)}`
        }
        insertApp.run(
          appId,
          row.table_name,
          null,
          row.table_id,
          nextOrder,
          row.updated_at || new Date().toISOString(),
        )
        nextOrder += 1
      }
      attachViews.run(appId, row.table_id)
    }
  })
}

/**
 * 旧库平滑升级：将 smart_tables.views_json 中的内嵌视图迁移到独立的 workspace_views 表。
 * 仅在本次启动首次创建 workspace_views 表且表内尚无数据时执行，避免已迁移库清空视图后回流。
 */
function migrateLegacyViewsToWorkspace(db: Database): void {
  const existingCount = db.query('SELECT COUNT(*) AS cnt FROM workspace_views').get() as
    | { cnt: number }
    | undefined
    | null
  if (existingCount && existingCount.cnt > 0) return

  const tableRows = db
    .query('SELECT id, name, views_json, updated_at FROM smart_tables ORDER BY rowid ASC')
    .all() as { id: string; name: string; views_json: string; updated_at: string }[]
  if (tableRows.length === 0) return

  const usedIds = new Set<string>()
  const insertAppStmt = db.query(
    'INSERT OR IGNORE INTO smart_apps (id, name, description, table_id, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const insertStmt = db.query(
    'INSERT INTO workspace_views (id, app_id, table_id, name, type, sort_order, config_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )

  runInTransaction(db, () => {
    let sortOrder = 0
    let appOrder = 0
    for (const row of tableRows) {
      let parsedViews: unknown
      try {
        parsedViews = JSON.parse(row.views_json)
      } catch {
        continue
      }
      if (!Array.isArray(parsedViews)) continue

      const appId = `app_${row.id}`
      insertAppStmt.run(
        appId,
        row.name,
        null,
        row.id,
        appOrder,
        row.updated_at || new Date().toISOString(),
      )
      appOrder += 1

      for (const rawView of parsedViews) {
        if (!isPlainObject(rawView)) continue
        const rawId =
          typeof rawView.id === 'string' && rawView.id.trim() !== ''
            ? rawView.id.trim()
            : `view_${sortOrder}`
        let viewId = rawId
        if (usedIds.has(viewId)) {
          viewId = `${rawId}_${row.id}`
        }
        while (usedIds.has(viewId)) {
          viewId = `${rawId}_${row.id}_${sortOrder}`
        }
        usedIds.add(viewId)

        const viewName =
          typeof rawView.name === 'string' && rawView.name.trim() !== ''
            ? rawView.name.trim()
            : '未命名视图'
        const viewType: SmartViewType =
          typeof rawView.type === 'string' && VALID_VIEW_TYPES.has(rawView.type as SmartViewType)
            ? (rawView.type as SmartViewType)
            : 'table'

        const {
          id: _id,
          name: _name,
          type: _type,
          tableId: _tid,
          sortOrder: _so,
          updatedAt: _ua,
          ...rest
        } = rawView
        const config = {
          filterGroup: isPlainObject(rest.filterGroup)
            ? rest.filterGroup
            : { conjunction: 'and', conditions: [] },
          quickFilterFields: Array.isArray(rest.quickFilterFields) ? rest.quickFilterFields : [],
          sortRules: Array.isArray(rest.sortRules) ? rest.sortRules : [],
          ...rest,
        }

        insertStmt.run(
          viewId,
          appId,
          row.id,
          viewName,
          viewType,
          sortOrder,
          JSON.stringify(config),
          row.updated_at || new Date().toISOString(),
        )
        sortOrder += 1
      }
    }
  })
}

function normalizeLegacyLookupOverrides(raw: unknown): Record<string, string> | null {
  if (!isPlainObject(raw)) return null
  const out: Record<string, string> = {}
  for (const [groupId, targetId] of Object.entries(raw)) {
    const normalized = extractNonEmptyId(targetId)
    if (groupId.trim() !== '' && normalized !== null) {
      out[groupId] = normalized
    }
  }
  return Object.keys(out).length > 0 ? out : null
}

function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * 旧库派生层自动迁移：
 * 扫描 smart_tables 中的 lookup/formula 列与 smart_table_records 中的 _lookupOverrides，
 * 提升至关联 SmartApp（无关联 App 时按表自动补建），并从源表 schema_json（含 summaries）及 data_json 中剔除。
 */
function migrateDerivedLayerToSmartApps(db: Database): void {
  const tableRows = db
    .query('SELECT id, name, kind, schema_json, updated_at FROM smart_tables ORDER BY rowid ASC')
    .all() as Pick<SmartTableRow, 'id' | 'name' | 'kind' | 'schema_json' | 'updated_at'>[]
  if (tableRows.length === 0) return

  runInTransaction(db, () => {
    const orderRow = db
      .query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM smart_apps')
      .get() as { next_order: number } | undefined | null
    let nextOrder = orderRow?.next_order ?? 0
    const now = new Date().toISOString()

    for (const tableRow of tableRows) {
      const parsedSchema = parseJsonSafe<StoredSchemaPayload | SmartColumn[] | null>(
        tableRow.schema_json,
        null,
      )
      if (!parsedSchema) continue

      const isLegacyArray = Array.isArray(parsedSchema)
      const allColumns = isLegacyArray
        ? parsedSchema
        : Array.isArray(parsedSchema.columns)
          ? parsedSchema.columns
          : []
      const { rawColumns, derivedColumns } = splitColumnsByLayer(allColumns)
      const derivedKeySet = new Set(derivedColumns.map((col) => col.key))

      const rawSummaries = isLegacyArray ? {} : (parsedSchema.summaries ?? {})
      const cleanedSummaries: Record<string, SummaryType> = {}
      let summariesChanged = false
      for (const [key, summaryType] of Object.entries(rawSummaries)) {
        if (derivedKeySet.has(key)) {
          summariesChanged = true
          continue
        }
        cleanedSummaries[key] = summaryType
      }

      const tableOverrides: Record<string, Record<string, string>> = {}
      const recordsToClean: Array<{ id: string; nextJson: string }> = []

      if (tableRow.kind === 'normal') {
        const recordRows = db
          .query('SELECT id, data_json FROM smart_table_records WHERE table_id = ?')
          .all(tableRow.id) as { id: string; data_json: string }[]

        for (const recRow of recordRows) {
          const parsedRec = parseJsonSafe<Record<string, unknown> | null>(recRow.data_json, null)
          if (!isPlainObject(parsedRec)) continue

          const hasOverridesField = '_lookupOverrides' in parsedRec
          if (hasOverridesField) {
            const normalized = normalizeLegacyLookupOverrides(parsedRec._lookupOverrides)
            if (normalized) {
              tableOverrides[recRow.id] = normalized
            }
          }

          const hasDerivedField =
            derivedKeySet.size > 0 && Object.keys(parsedRec).some((k) => derivedKeySet.has(k))
          if (hasOverridesField || hasDerivedField) {
            const cleanedRec: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(parsedRec)) {
              if (k === '_lookupOverrides' || derivedKeySet.has(k)) continue
              cleanedRec[k] = v
            }
            recordsToClean.push({ id: recRow.id, nextJson: JSON.stringify(cleanedRec) })
          }
        }
      }

      const hasOverridesToLift = Object.keys(tableOverrides).length > 0
      if (derivedColumns.length > 0 || hasOverridesToLift) {
        const appRows = db
          .query(
            'SELECT id, derived_columns_json, lookup_overrides_json FROM smart_apps WHERE table_id = ? ORDER BY sort_order ASC, rowid ASC',
          )
          .all(tableRow.id) as {
          id: string
          derived_columns_json: string
          lookup_overrides_json: string
        }[]

        if (appRows.length === 0) {
          let appId = `app_${tableRow.id}`
          while (db.query('SELECT 1 FROM smart_apps WHERE id = ?').get(appId)) {
            appId = `app_${crypto.randomUUID().slice(0, 8)}`
          }
          db.query(
            'INSERT INTO smart_apps (id, name, description, table_id, sort_order, derived_columns_json, lookup_overrides_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          ).run(
            appId,
            tableRow.name,
            null,
            tableRow.id,
            nextOrder,
            JSON.stringify(derivedColumns),
            JSON.stringify(tableOverrides),
            tableRow.updated_at || now,
          )
          nextOrder += 1
        } else {
          for (const appRow of appRows) {
            const existingDerived = parseJsonSafe<SmartColumn[]>(appRow.derived_columns_json, [])
            const nextDerived = Array.isArray(existingDerived) ? [...existingDerived] : []
            const existingKeys = new Set(nextDerived.map((c) => c.key))
            let appChanged = false

            for (const col of derivedColumns) {
              if (!existingKeys.has(col.key)) {
                nextDerived.push(col)
                existingKeys.add(col.key)
                appChanged = true
              }
            }

            const existingOverridesRaw = parseJsonSafe<Record<string, Record<string, string>>>(
              appRow.lookup_overrides_json,
              {},
            )
            const nextOverrides: Record<string, Record<string, string>> = isPlainObject(
              existingOverridesRaw,
            )
              ? { ...existingOverridesRaw }
              : {}

            for (const [recId, groupMap] of Object.entries(tableOverrides)) {
              const currGroupMap = isPlainObject(nextOverrides[recId])
                ? { ...nextOverrides[recId] }
                : {}
              let recChanged = false
              for (const [groupId, targetId] of Object.entries(groupMap)) {
                if (!(groupId in currGroupMap)) {
                  currGroupMap[groupId] = targetId
                  recChanged = true
                }
              }
              if (recChanged) {
                nextOverrides[recId] = currGroupMap
                appChanged = true
              }
            }

            if (appChanged) {
              db.query(
                'UPDATE smart_apps SET derived_columns_json = ?, lookup_overrides_json = ? WHERE id = ?',
              ).run(JSON.stringify(nextDerived), JSON.stringify(nextOverrides), appRow.id)
            }
          }
        }
      }

      if (derivedColumns.length > 0 || summariesChanged) {
        const nextPayload: StoredSchemaPayload = {
          columns: rawColumns,
          summaries: cleanedSummaries,
        }
        if (!isLegacyArray && parsedSchema.description !== undefined) {
          nextPayload.description = parsedSchema.description
        }
        if (!isLegacyArray && parsedSchema.system !== undefined) {
          nextPayload.system = parsedSchema.system
        }
        db.query('UPDATE smart_tables SET schema_json = ? WHERE id = ?').run(
          JSON.stringify(nextPayload),
          tableRow.id,
        )
      }

      if (recordsToClean.length > 0) {
        const updateRecStmt = db.query(
          'UPDATE smart_table_records SET data_json = ? WHERE table_id = ? AND id = ?',
        )
        for (const item of recordsToClean) {
          updateRecStmt.run(item.nextJson, tableRow.id, item.id)
        }
      }
    }
  })
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA foreign_keys = ON;')
  const hadWorkspaceViews = physicalTableExists(db, 'workspace_views')
  db.exec(SCHEMA_SQL)
  migrateLegacySchema(db)
  if (!hadWorkspaceViews) {
    migrateLegacyViewsToWorkspace(db)
  }
  backfillAppsForOrphanViews(db)
  migrateDerivedLayerToSmartApps(db)
  ensureBuiltinDemoUsers(db)
  return db
}

interface SmartTableRow {
  id: string
  name: string
  kind: TableKind
  primary_key_field: string | null
  source_sql_table: string | null
  schema_json: string
  views_json: string
  created_by: string | null
  row_scope: TableRowScope | null
  owner_column_key: string | null
  member_access: MemberAccessLevel | null
  updated_at: string
}

const SMART_TABLE_SELECT_SQL =
  'SELECT id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, created_by, row_scope, owner_column_key, member_access, updated_at FROM smart_tables'

interface StoredSchemaPayload {
  description?: string
  columns: SmartColumn[]
  summaries: Record<string, SummaryType>
  system?: boolean
}

interface AdvancedTableSpec {
  tableName: string
  primaryKey: string
  idPrefix: string
  columns: readonly string[]
  numericColumns: ReadonlySet<string>
}

// 进阶物理表白名单的内置默认（两张种子表）。其余成员在运行时从 smart_tables 元数据
// （kind='advanced' 的 sourceSqlTable）动态装配：白名单语义不变——所有表名先过
// isSafePhysicalIdentifier 再核对 sqlite_master，避免直接拼接客户端传入的 sourceSqlTable 引发 SQL 注入
const BUILTIN_ADVANCED_TABLES: Record<string, AdvancedTableSpec> = {
  biz_employees: {
    tableName: 'biz_employees',
    primaryKey: 'emp_id',
    idPrefix: 'EMP',
    columns: ['emp_id', 'name', 'dept', 'level', 'region', 'email'],
    numericColumns: new Set(),
  },
  biz_payments: {
    tableName: 'biz_payments',
    primaryKey: 'pay_id',
    idPrefix: 'PAY',
    columns: [
      'pay_id',
      'project_code',
      'customer_name',
      'pay_date',
      'year',
      'month',
      'region',
      'amount',
      'pay_method',
    ],
    numericColumns: new Set(['amount']),
  },
}

/** 物理表标识符规则：字母/下划线开头，仅含字母数字下划线 */
const PHYSICAL_IDENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** SQLite 关键字（建物理表名/列名禁止撞上；DDL 虽有双引号保护，仍按白名单语义显式拒绝） */
const SQLITE_RESERVED_WORDS = new Set([
  'ABORT',
  'ACTION',
  'ADD',
  'AFTER',
  'ALL',
  'ALTER',
  'ALWAYS',
  'ANALYZE',
  'AND',
  'AS',
  'ASC',
  'ATTACH',
  'AUTOINCREMENT',
  'BEFORE',
  'BEGIN',
  'BETWEEN',
  'BY',
  'CASCADE',
  'CASE',
  'CAST',
  'CHECK',
  'COLLATE',
  'COLUMN',
  'COMMIT',
  'CONFLICT',
  'CONSTRAINT',
  'CREATE',
  'CROSS',
  'CURRENT',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'DATABASE',
  'DEFAULT',
  'DEFERRABLE',
  'DEFERRED',
  'DELETE',
  'DESC',
  'DETACH',
  'DISTINCT',
  'DO',
  'DROP',
  'EACH',
  'ELSE',
  'END',
  'ESCAPE',
  'EXCEPT',
  'EXCLUDE',
  'EXCLUSIVE',
  'EXISTS',
  'EXPLAIN',
  'FAIL',
  'FILTER',
  'FIRST',
  'FOLLOWING',
  'FOR',
  'FOREIGN',
  'FROM',
  'FULL',
  'GENERATED',
  'GLOB',
  'GROUP',
  'GROUPS',
  'HAVING',
  'IF',
  'IGNORE',
  'IMMEDIATE',
  'IN',
  'INDEX',
  'INDEXED',
  'INITIALLY',
  'INNER',
  'INSERT',
  'INSTEAD',
  'INTERSECT',
  'INTO',
  'IS',
  'ISNULL',
  'JOIN',
  'KEY',
  'LAST',
  'LEFT',
  'LIKE',
  'LIMIT',
  'MATCH',
  'MATERIALIZED',
  'NATURAL',
  'NO',
  'NOT',
  'NOTHING',
  'NOTNULL',
  'NULL',
  'NULLS',
  'OF',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OTHERS',
  'OUTER',
  'OVER',
  'PARTITION',
  'PLAN',
  'PRAGMA',
  'PRECEDING',
  'PRIMARY',
  'QUERY',
  'RAISE',
  'RANGE',
  'RECURSIVE',
  'REFERENCES',
  'REGEXP',
  'REINDEX',
  'RELEASE',
  'RENAME',
  'REPLACE',
  'RESTRICT',
  'RETURNING',
  'RIGHT',
  'ROLLBACK',
  'ROW',
  'ROWS',
  'SAVEPOINT',
  'SELECT',
  'SET',
  'TABLE',
  'TEMP',
  'TEMPORARY',
  'THEN',
  'TIES',
  'TO',
  'TRANSACTION',
  'TRIGGER',
  'UNBOUNDED',
  'UNION',
  'UNIQUE',
  'UPDATE',
  'USING',
  'VACUUM',
  'VALUES',
  'VIEW',
  'VIRTUAL',
  'WHEN',
  'WHERE',
  'WINDOW',
  'WITH',
  'WITHOUT',
])

/** 物理标识符（表名/物理列名）合法性：正则 + 不撞 SQLite 关键字与 sqlite_ 系统前缀 */
export function isSafePhysicalIdentifier(name: string): boolean {
  if (!PHYSICAL_IDENT_PATTERN.test(name)) return false
  if (name.toLowerCase().startsWith('sqlite_')) return false
  return !SQLITE_RESERVED_WORDS.has(name.toUpperCase())
}

function physicalTableExists(db: Database, tableName: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined | null
  return row != null
}

function physicalObjectNameTaken(db: Database, name: string): boolean {
  const row = db.query('SELECT name FROM sqlite_master WHERE name = ?').get(name) as
    | { name: string }
    | undefined
    | null
  return row != null
}

/** PRAGMA 实测的物理列（name + SQLite 声明类型），动态装配 spec 的物理层唯一事实源 */
function readPhysicalColumns(db: Database, tableName: string): { name: string; type: string }[] {
  return db.query(`PRAGMA table_info("${tableName}")`).all() as { name: string; type: string }[]
}

const NUMERIC_SQL_TYPES: ReadonlySet<string> = new Set([
  'REAL',
  'INT',
  'INTEGER',
  'FLOAT',
  'DOUBLE',
  'NUMERIC',
])

/**
 * 进阶表白名单解析：内置默认表直接返回；其余从 smart_tables 元数据动态装配
 * （主键取 meta.primaryKeyField，物理列与数值列以 PRAGMA 实测为准）。
 * 物理表在 sqlite_master 缺失时降级告警并视为未注册。
 */
function getAdvancedSpec(
  db: Database,
  sourceSqlTable: string | null | undefined,
): AdvancedTableSpec | null {
  if (!sourceSqlTable || !isSafePhysicalIdentifier(sourceSqlTable)) return null
  if (!physicalTableExists(db, sourceSqlTable)) {
    console.warn(`[smart-table] 进阶物理表 ${sourceSqlTable} 在库中缺失，已降级忽略`)
    return null
  }
  const builtin = BUILTIN_ADVANCED_TABLES[sourceSqlTable]
  if (builtin) return builtin

  const metaRow = db
    .query(
      "SELECT primary_key_field FROM smart_tables WHERE kind = 'advanced' AND source_sql_table = ? ORDER BY rowid ASC LIMIT 1",
    )
    .get(sourceSqlTable) as { primary_key_field: string | null } | undefined | null
  if (!metaRow) return null

  const physicalColumns = readPhysicalColumns(db, sourceSqlTable)
  if (physicalColumns.length === 0) return null
  const columns = physicalColumns.map((col) => col.name)
  const primaryKey =
    metaRow.primary_key_field !== null && columns.includes(metaRow.primary_key_field)
      ? metaRow.primary_key_field
      : (columns[0] as string)
  const numericColumns = new Set(
    physicalColumns
      .filter((col) => NUMERIC_SQL_TYPES.has(col.type.toUpperCase()))
      .map((col) => col.name),
  )
  return { tableName: sourceSqlTable, primaryKey, idPrefix: 'ADV', columns, numericColumns }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验数据源表列定义合法性、key 唯一性及基础属性（拒绝 lookup / formula 派生列） */
export function validateColumns(columns: readonly unknown[]): SmartColumn[] {
  const seenKeys = new Set<string>()
  const validated: SmartColumn[] = []

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    if (!isPlainObject(col)) {
      throw new ValidationError(`第 ${i + 1} 列配置必须为对象`)
    }
    if (typeof col.key !== 'string' || col.key.trim() === '') {
      throw new ValidationError(`第 ${i + 1} 列缺少非空字段 key`)
    }
    if (typeof col.title !== 'string' || col.title.trim() === '') {
      throw new ValidationError(`列 "${col.key}" 缺少非空标题 title`)
    }
    if (typeof col.type !== 'string' || !VALID_COLUMN_TYPES.has(col.type as SmartColumnType)) {
      throw new ValidationError(`列 "${col.key}" 的类型 "${String(col.type)}" 不合法`)
    }
    if (isDerivedColumnType(col.type as SmartColumnType)) {
      throw new ValidationError(
        `数据源表列 "${col.key}" 不允许保存派生列类型 "${col.type}"，请在智能表格层配置`,
      )
    }
    if (col.required !== undefined && typeof col.required !== 'boolean') {
      throw new ValidationError(`列 "${col.key}" 的 required 必须为布尔值`)
    }
    if (
      col.align !== undefined &&
      (typeof col.align !== 'string' || !VALID_CELL_ALIGNS.has(col.align as CellTextAlign))
    ) {
      throw new ValidationError(`列 "${col.key}" 的 align 必须为 left / center / right`)
    }
    assertValidDecimalPlaces(col.decimalPlaces, `列 "${col.key}"`)
    if (seenKeys.has(col.key)) {
      throw new ValidationError(`存在重复列 key: "${col.key}"`)
    }
    seenKeys.add(col.key)
    validated.push(col as unknown as SmartColumn)
  }

  return validated
}

function validateViews(views: readonly unknown[]): SmartView[] {
  if (views.length === 0) {
    throw new ValidationError('views 必须为非空数组')
  }
  const seenViewIds = new Set<string>()
  for (let i = 0; i < views.length; i++) {
    const view = views[i]
    if (!isPlainObject(view)) {
      throw new ValidationError(`第 ${i + 1} 个视图配置必须为对象`)
    }
    if (typeof view.id !== 'string' || view.id.trim() === '') {
      throw new ValidationError(`第 ${i + 1} 个视图缺少非空 id`)
    }
    if (typeof view.name !== 'string' || view.name.trim() === '') {
      throw new ValidationError(`视图 "${view.id}" 缺少非空名称`)
    }
    if (typeof view.type !== 'string' || !VALID_VIEW_TYPES.has(view.type as SmartViewType)) {
      throw new ValidationError(`视图 "${view.id}" 的类型必须为 table / kanban / pivot / dashboard`)
    }
    if (seenViewIds.has(view.id)) {
      throw new ValidationError(`存在重复视图 id: "${view.id}"`)
    }
    validatePivotMeasuresDecimalPlaces(view.pivotConfig, `视图 "${view.id}"`)
    if (isPlainObject(view.dashboardConfig) && Array.isArray(view.dashboardConfig.kpis)) {
      for (const kpi of view.dashboardConfig.kpis) {
        if (isPlainObject(kpi)) {
          const kpiId = typeof kpi.id === 'string' && kpi.id.trim() !== '' ? kpi.id : '未命名'
          assertValidDecimalPlaces(kpi.decimalPlaces, `视图 "${view.id}" KPI "${kpiId}"`)
        }
      }
    }
    seenViewIds.add(view.id)
  }
  return views as unknown as SmartView[]
}

function serializeSchemaPayload(meta: {
  description?: string
  columns: SmartColumn[]
  summaries: Record<string, SummaryType>
  system?: boolean
}): string {
  const payload: StoredSchemaPayload = {
    columns: meta.columns,
    summaries: meta.summaries,
  }
  if (meta.description !== undefined) {
    payload.description = meta.description
  }
  if (meta.system !== undefined) {
    payload.system = meta.system
  }
  return JSON.stringify(payload)
}

export function parseTableRow(row: SmartTableRow): SmartTableMeta {
  const parsedSchema = JSON.parse(row.schema_json) as StoredSchemaPayload | SmartColumn[]
  const parsedViews = JSON.parse(row.views_json) as SmartView[]
  const isLegacyArray = Array.isArray(parsedSchema)

  const meta: SmartTableMeta = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    columns: isLegacyArray ? parsedSchema : (parsedSchema.columns ?? []),
    views: parsedViews,
    summaries: isLegacyArray ? {} : (parsedSchema.summaries ?? {}),
    rowScope: row.row_scope ?? 'all',
  }

  if (!isLegacyArray && parsedSchema.description !== undefined) {
    meta.description = parsedSchema.description
  }
  if (!isLegacyArray && parsedSchema.system === true) {
    meta.system = true
  }
  if (row.primary_key_field !== null) {
    meta.primaryKeyField = row.primary_key_field
  }
  if (row.source_sql_table !== null) {
    meta.sourceSqlTable = row.source_sql_table
  }
  if (row.created_by !== null) {
    meta.createdBy = row.created_by
  }
  if (row.owner_column_key !== null) {
    meta.ownerColumnKey = row.owner_column_key
  }
  if (row.member_access !== null) {
    meta.memberAccess = row.member_access
  }
  return meta
}

function readTableRow(db: Database, tableId: string): SmartTableRow | null {
  const row = db.query(`${SMART_TABLE_SELECT_SQL} WHERE id = ?`).get(tableId) as
    | SmartTableRow
    | undefined
    | null
  return row ?? null
}

function toPrimitiveString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return fallback
}

function extractNonEmptyId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function attachAdvancedRecordId(
  row: Record<string, unknown>,
  primaryKey: string,
  fallbackId = '',
  createdBy?: string,
): SmartRecord {
  const out: SmartRecord = {
    ...row,
    _id: toPrimitiveString(row[primaryKey], fallbackId),
  }
  if (createdBy !== undefined) {
    out.createdBy = createdBy
  }
  return out
}

function readOwnershipMap(db: Database, tableId: string): Map<string, string> {
  const rows = db
    .query('SELECT record_id, created_by FROM record_ownership WHERE table_id = ?')
    .all(tableId) as { record_id: string; created_by: string }[]
  return new Map(rows.map((r) => [r.record_id, r.created_by]))
}

function readRecordOwner(db: Database, tableId: string, recordId: string): string | undefined {
  const row = db
    .query('SELECT created_by FROM record_ownership WHERE table_id = ? AND record_id = ?')
    .get(tableId, recordId) as { created_by: string } | undefined | null
  return row?.created_by
}

export function setRecordOwnership(
  db: Database,
  tableId: string,
  entries: readonly { recordId: string; createdBy: string }[],
): void {
  if (entries.length === 0) return
  const now = new Date().toISOString()
  const stmt = db.query(`
    INSERT INTO record_ownership (table_id, record_id, created_by, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(table_id, record_id) DO UPDATE SET created_by = excluded.created_by
  `)
  for (const item of entries) {
    stmt.run(tableId, item.recordId, item.createdBy, now)
  }
}

function readRecordsForMeta(db: Database, meta: SmartTableMeta): SmartRecord[] {
  const ownershipMap = readOwnershipMap(db, meta.id)
  if (meta.kind === 'advanced') {
    const spec = getAdvancedSpec(db, meta.sourceSqlTable)
    if (!spec) return []
    const rows = db.query(`SELECT * FROM ${spec.tableName} ORDER BY rowid ASC`).all() as Record<
      string,
      unknown
    >[]
    return rows.map((row) => {
      const recId = toPrimitiveString(row[spec.primaryKey])
      return attachAdvancedRecordId(row, spec.primaryKey, '', ownershipMap.get(recId))
    })
  }

  const rows = db
    .query(
      'SELECT id, data_json FROM smart_table_records WHERE table_id = ? ORDER BY row_order ASC, rowid ASC',
    )
    .all(meta.id) as { id: string; data_json: string }[]

  return rows.map((row) => {
    const parsed = JSON.parse(row.data_json) as SmartRecord
    const createdBy = ownershipMap.get(row.id) ?? parsed.createdBy
    const rec: SmartRecord = {
      ...parsed,
      _id: row.id,
    }
    if (createdBy !== undefined) {
      rec.createdBy = createdBy
    }
    return rec
  })
}

export function listTableMetas(db: Database): SmartTableMeta[] {
  const tableRows = db
    .query(`${SMART_TABLE_SELECT_SQL} ORDER BY rowid ASC`)
    .all() as SmartTableRow[]
  return tableRows.map(parseTableRow)
}

export function listTableBundles(db: Database): TableBundle[] {
  const tableRows = db
    .query(`${SMART_TABLE_SELECT_SQL} ORDER BY rowid ASC`)
    .all() as SmartTableRow[]

  return tableRows.map((row) => {
    const meta = parseTableRow(row)
    return {
      meta,
      records: readRecordsForMeta(db, meta),
    }
  })
}

export function getTableMeta(db: Database, tableId: string): SmartTableMeta | null {
  const row = readTableRow(db, tableId)
  return row ? parseTableRow(row) : null
}

export function getTableBundle(db: Database, tableId: string): TableBundle | null {
  const row = readTableRow(db, tableId)
  if (!row) return null
  const meta = parseTableRow(row)
  return {
    meta,
    records: readRecordsForMeta(db, meta),
  }
}

export function getTableRecordById(
  db: Database,
  tableId: string,
  recordId: string,
): SmartRecord | null {
  const row = readTableRow(db, tableId)
  if (!row) return null
  const meta = parseTableRow(row)
  const owner = readRecordOwner(db, tableId, recordId)

  if (meta.kind === 'advanced') {
    const spec = getAdvancedSpec(db, meta.sourceSqlTable)
    if (!spec) return null
    const found = db
      .query(`SELECT * FROM ${spec.tableName} WHERE ${spec.primaryKey} = ?`)
      .get(recordId) as Record<string, unknown> | undefined | null
    if (!found) return null
    return attachAdvancedRecordId(found, spec.primaryKey, recordId, owner)
  }

  const recordRow = db
    .query('SELECT data_json FROM smart_table_records WHERE table_id = ? AND id = ?')
    .get(tableId, recordId) as { data_json: string } | undefined | null
  if (!recordRow) return null
  const parsed = JSON.parse(recordRow.data_json) as SmartRecord
  const createdBy = owner ?? parsed.createdBy
  return {
    ...parsed,
    _id: recordId,
    ...(createdBy !== undefined ? { createdBy } : {}),
  }
}

/** 新表默认表格视图（普通表与导入建的进阶表共用） */
function buildDefaultTableView(): SmartView {
  return {
    id: `view_${crypto.randomUUID().slice(0, 8)}`,
    name: '全部数据',
    type: 'table',
    filterGroup: { conjunction: 'and', conditions: [] },
    quickFilterFields: [],
    sortRules: [],
  }
}

export function insertNormalTable(
  db: Database,
  req: CreateTableRequest,
  options?: { records?: readonly Record<string, unknown>[]; actorUserId?: string },
): TableBundle {
  if (typeof req.name !== 'string' || req.name.trim() === '') {
    throw new ValidationError('表名 name 不能为空')
  }
  const columns: SmartColumn[] =
    req.columns !== undefined
      ? validateColumns(req.columns)
      : [{ key: 'title', title: '名称', type: 'text', width: 200 }]

  const id = `tbl_${crypto.randomUUID().slice(0, 8)}`
  const actorUserId = options?.actorUserId
  const meta: SmartTableMeta = {
    id,
    name: req.name.trim(),
    kind: 'normal',
    columns,
    views: [buildDefaultTableView()],
    summaries: {},
    rowScope: 'all',
    ...(actorUserId !== undefined ? { createdBy: actorUserId } : {}),
  }
  if (req.description !== undefined) {
    meta.description = req.description
  }

  const storedRecords: SmartRecord[] = []
  const ownershipEntries: { recordId: string; createdBy: string }[] = []
  runInTransaction(db, () => {
    db.query(
      'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, created_by, row_scope, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      meta.id,
      meta.name,
      meta.kind,
      null,
      null,
      serializeSchemaPayload(meta),
      JSON.stringify(meta.views),
      actorUserId ?? null,
      'all',
      new Date().toISOString(),
    )
    if (options?.records && options.records.length > 0) {
      const stmt = db.query(
        'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
      )
      options.records.forEach((record, index) => {
        const recordId = extractNonEmptyId(record._id) ?? `rec_${crypto.randomUUID().slice(0, 8)}`
        const clean = { ...record }
        delete clean.createdBy
        const persisted: SmartRecord = { ...clean, _id: recordId }
        stmt.run(recordId, meta.id, index, JSON.stringify(persisted))
        if (actorUserId !== undefined) {
          ownershipEntries.push({ recordId, createdBy: actorUserId })
          storedRecords.push({ ...persisted, createdBy: actorUserId })
        } else {
          storedRecords.push(persisted)
        }
      })
      if (ownershipEntries.length > 0) {
        setRecordOwnership(db, meta.id, ownershipEntries)
      }
    }
  })

  return { meta, records: storedRecords }
}

/** SmartColumnType → SQLite 物理列类型；formula/lookup 为计算列不落物理列（仅存 meta），返回 null */
function toSqlColumnType(type: SmartColumnType): string | null {
  if (type === 'formula' || type === 'lookup') return null
  if (type === 'number' || type === 'progress') return 'REAL'
  return 'TEXT'
}

export interface CreateAdvancedTableOptions {
  /** 显示表名 */
  name: string
  columns: SmartColumn[]
  /** 期望物理表名：合法标识符且未被占用才采用，否则自动生成 adv_ 前缀名 */
  physicalName?: string
  description?: string
  /** 系统内置表禁止删除；用户自建表默认不带 */
  system?: boolean
  /** 创建人 userId */
  actorUserId?: string
}

/** 分配物理表名：优先采用合法且未占用的期望名，否则生成 adv_ 随机名 */
function allocatePhysicalTableName(db: Database, desired?: string): string {
  if (desired && isSafePhysicalIdentifier(desired) && !physicalObjectNameTaken(db, desired)) {
    return desired
  }
  for (;;) {
    const candidate = `adv_${crypto.randomUUID().slice(0, 8)}`
    if (!physicalObjectNameTaken(db, candidate)) return candidate
  }
}

/**
 * 创建进阶 SQL 物理表：首列数据列为主键（PRIMARY KEY），建表后即在 smart_tables 注册
 * kind='advanced' 元数据，动态白名单随即生效——既有行级 CRUD 路由可直接读写。
 * 与批量插行同事务时由调用方包 runInTransaction（嵌套走 SAVEPOINT）。
 */
export function createAdvancedPhysicalTable(
  db: Database,
  options: CreateAdvancedTableOptions,
): SmartTableMeta {
  const name = options.name.trim()
  if (name === '') {
    throw new ValidationError('表名 name 不能为空')
  }
  const columns = validateColumns(options.columns)
  const physicalColumns = columns.filter((col) => toSqlColumnType(col.type) !== null)
  if (physicalColumns.length === 0) {
    throw new ValidationError('进阶表至少需要一列数据列（formula/lookup 为计算列，不能单独成表）')
  }
  for (const col of physicalColumns) {
    if (!isSafePhysicalIdentifier(col.key)) {
      throw new ValidationError(`进阶表物理列 key 必须为合法标识符: "${col.key}"`)
    }
  }

  return runInTransaction(db, () => {
    const physicalName = allocatePhysicalTableName(db, options.physicalName)
    const primaryKey = physicalColumns[0]!.key
    const columnDefs = physicalColumns.map(
      (col) =>
        `"${col.key}" ${toSqlColumnType(col.type)}${col.key === primaryKey ? ' PRIMARY KEY' : ''}`,
    )
    db.exec(`CREATE TABLE "${physicalName}" (${columnDefs.join(', ')});`)

    const meta: SmartTableMeta = {
      id: `tbl_${crypto.randomUUID().slice(0, 8)}`,
      name,
      kind: 'advanced',
      columns,
      views: [buildDefaultTableView()],
      summaries: {},
      primaryKeyField: primaryKey,
      sourceSqlTable: physicalName,
      rowScope: 'all',
      ...(options.actorUserId !== undefined ? { createdBy: options.actorUserId } : {}),
    }
    if (options.description !== undefined) {
      meta.description = options.description
    }
    if (options.system === true) {
      meta.system = true
    }
    db.query(
      'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, created_by, row_scope, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      meta.id,
      meta.name,
      meta.kind,
      primaryKey,
      physicalName,
      serializeSchemaPayload(meta),
      JSON.stringify(meta.views),
      options.actorUserId ?? null,
      'all',
      new Date().toISOString(),
    )
    return meta
  })
}

export function updateTableMeta(
  db: Database,
  tableId: string,
  meta: SmartTableMeta,
): SmartTableMeta | null {
  return runInTransaction(db, () => {
    const existingRow = readTableRow(db, tableId)
    if (!existingRow) return null

    if (typeof meta.name !== 'string' || meta.name.trim() === '') {
      throw new ValidationError('表名 name 不能为空')
    }
    const validatedColumns = validateColumns(meta.columns)
    const validatedViews = validateViews(meta.views)

    const existingMeta = parseTableRow(existingRow)
    if (existingMeta.kind === 'advanced') {
      if (meta.kind && meta.kind !== 'advanced') {
        throw new ValidationError('进阶数据源表不可更改表类型')
      }
      const spec = getAdvancedSpec(db, existingMeta.sourceSqlTable)
      if (spec) {
        const nextColMap = new Map(validatedColumns.map((col) => [col.key, col]))
        const existingColMap = new Map(existingMeta.columns.map((col) => [col.key, col]))
        for (const physicalCol of spec.columns) {
          const nextCol = nextColMap.get(physicalCol)
          if (!nextCol) {
            throw new ValidationError(`进阶数据源表禁止删除物理列: "${physicalCol}"`)
          }
          const origCol = existingColMap.get(physicalCol)
          if (origCol && nextCol.type !== origCol.type) {
            throw new ValidationError(`进阶数据源表禁止修改物理列 "${physicalCol}" 的字段类型`)
          }
        }
      }
    }

    const nextMeta: SmartTableMeta = {
      ...existingMeta,
      name: meta.name.trim(),
      columns: validatedColumns,
      views: validatedViews,
      summaries: meta.summaries ?? {},
    }
    if (meta.description !== undefined) {
      nextMeta.description = meta.description
    } else {
      delete nextMeta.description
    }
    if (
      nextMeta.ownerColumnKey &&
      !validatedColumns.some((c) => c.key === nextMeta.ownerColumnKey && c.type === 'person')
    ) {
      delete nextMeta.ownerColumnKey
    }

    db.query(
      'UPDATE smart_tables SET name = ?, schema_json = ?, views_json = ?, owner_column_key = ?, updated_at = ? WHERE id = ?',
    ).run(
      nextMeta.name,
      serializeSchemaPayload(nextMeta),
      JSON.stringify(nextMeta.views),
      nextMeta.ownerColumnKey ?? null,
      new Date().toISOString(),
      tableId,
    )

    return nextMeta
  })
}

/**
 * 删除表：普通表删 meta（记录级联）；进阶表仅用户自建可删（DROP 物理表 + 删 meta 同事务），
 * 系统内置（system 标记或内置默认物理表）拒绝删除。
 */
export function deleteTable(db: Database, tableId: string): boolean {
  return runInTransaction(db, () => {
    const row = readTableRow(db, tableId)
    if (!row) return false
    if (row.kind === 'advanced') {
      const meta = parseTableRow(row)
      if (
        meta.system === true ||
        (meta.sourceSqlTable && meta.sourceSqlTable in BUILTIN_ADVANCED_TABLES)
      ) {
        throw new ValidationError('系统内置进阶表不可删除')
      }
      if (
        meta.sourceSqlTable &&
        isSafePhysicalIdentifier(meta.sourceSqlTable) &&
        physicalTableExists(db, meta.sourceSqlTable)
      ) {
        db.exec(`DROP TABLE "${meta.sourceSqlTable}";`)
      }
    }
    const result = db.query('DELETE FROM smart_tables WHERE id = ?').run(tableId)
    return result.changes > 0
  })
}

function normalizeSqlValue(
  spec: AdvancedTableSpec,
  column: string,
  value: unknown,
  allowUndefinedZero: boolean,
): string | number {
  if (spec.numericColumns.has(column)) {
    if (value === undefined && allowUndefinedZero) {
      return 0
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new ValidationError(`列 "${column}" 必须是有限数字`)
      }
      return value
    }
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '') {
        throw new ValidationError(`列 "${column}" 不能为空字符串，请输入有效数字`)
      }
      const num = Number(trimmed)
      if (!Number.isFinite(num)) {
        throw new ValidationError(`列 "${column}" 必须是有效数字`)
      }
      return num
    }
    throw new ValidationError(`列 "${column}" 必须是有效数字`)
  }
  if (value === null || value === undefined) return ''
  return toPrimitiveString(value)
}

function touchTableUpdatedAt(db: Database, tableId: string): void {
  db.query('UPDATE smart_tables SET updated_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    tableId,
  )
}

/** 获取某数据源表及其关联 SmartApp 下的派生列 key 集合，写入磁盘前需剔除 */
function getDerivedColumnKeysForTable(db: Database, meta: SmartTableMeta): Set<string> {
  const keys = new Set<string>()
  for (const col of meta.columns) {
    if (isDerivedColumnType(col.type)) {
      keys.add(col.key)
    }
  }
  const appRows = db
    .query('SELECT derived_columns_json FROM smart_apps WHERE table_id = ?')
    .all(meta.id) as { derived_columns_json: string }[]
  for (const appRow of appRows) {
    const parsed = parseJsonSafe<unknown[]>(appRow.derived_columns_json, [])
    if (!Array.isArray(parsed)) continue
    for (const col of parsed) {
      if (isPlainObject(col) && typeof col.key === 'string') {
        keys.add(col.key)
      }
    }
  }
  return keys
}

function stripNonStoredFields(
  obj: Record<string, unknown>,
  derivedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (key === '_lookupOverrides' || key === 'createdBy' || derivedKeys.has(key)) {
      continue
    }
    cleaned[key] = val
  }
  return cleaned
}

/** 当进阶表主键变更时，同步更新所有 SmartApp 中引用该表的 lookupOverrides 映射 */
function syncLookupOverridesOnPkChange(
  db: Database,
  targetTableId: string,
  oldPk: string,
  newPk: string,
): void {
  if (oldPk === newPk) return

  const appRows = db
    .query('SELECT id, derived_columns_json, lookup_overrides_json FROM smart_apps')
    .all() as { id: string; derived_columns_json: string; lookup_overrides_json: string }[]

  const now = new Date().toISOString()
  for (const appRow of appRows) {
    const derivedColumns = parseJsonSafe<SmartColumn[]>(appRow.derived_columns_json, [])
    if (!Array.isArray(derivedColumns)) continue

    const affectedGroupIds = new Set<string>()
    for (const col of derivedColumns) {
      if (
        col.type === 'lookup' &&
        col.lookupConfig?.mode === 'one' &&
        col.lookupConfig.targetTableId === targetTableId
      ) {
        affectedGroupIds.add(col.lookupConfig.groupId)
      }
    }
    if (affectedGroupIds.size === 0) continue

    const lookupOverrides = parseJsonSafe<Record<string, Record<string, string>>>(
      appRow.lookup_overrides_json,
      {},
    )
    if (!isPlainObject(lookupOverrides)) continue

    let appChanged = false
    const nextOverrides: Record<string, Record<string, string>> = {}
    for (const [recId, groupMap] of Object.entries(lookupOverrides)) {
      if (!isPlainObject(groupMap)) continue
      const nextGroupMap: Record<string, string> = { ...groupMap }
      for (const groupId of affectedGroupIds) {
        if (nextGroupMap[groupId] === oldPk) {
          nextGroupMap[groupId] = newPk
          appChanged = true
        }
      }
      nextOverrides[recId] = nextGroupMap
    }

    if (appChanged) {
      db.query('UPDATE smart_apps SET lookup_overrides_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(nextOverrides),
        now,
        appRow.id,
      )
    }
  }
}

export function createTableRecord(
  db: Database,
  tableId: string,
  record: Omit<SmartRecord, '_id'> & { _id?: string },
  options?: { actorUserId?: string },
): SmartRecord | null {
  return runInTransaction(db, () => {
    const row = readTableRow(db, tableId)
    if (!row) return null

    const meta = parseTableRow(row)
    const validation = validateRecordForCreate(meta.columns, record)
    if (!validation.valid) {
      throw new ValidationError(validation.errors.map((err) => err.message).join('；'))
    }
    const actorUserId = options?.actorUserId

    if (row.kind === 'advanced') {
      const spec = getAdvancedSpec(db, row.source_sql_table)
      if (!spec) return null

      const pkFromField = extractNonEmptyId(validation.record[spec.primaryKey])
      const pkFromId = extractNonEmptyId(record._id)
      const pkValue =
        pkFromField ?? pkFromId ?? `${spec.idPrefix}-${crypto.randomUUID().slice(0, 8)}`

      const values = spec.columns.map((col) =>
        col === spec.primaryKey
          ? pkValue
          : normalizeSqlValue(spec, col, validation.record[col], true),
      )
      const placeholders = spec.columns.map(() => '?').join(', ')
      db.query(
        `INSERT INTO ${spec.tableName} (${spec.columns.join(', ')}) VALUES (${placeholders})`,
      ).run(...values)

      const inserted = db
        .query(`SELECT * FROM ${spec.tableName} WHERE ${spec.primaryKey} = ?`)
        .get(pkValue) as Record<string, unknown> | undefined | null
      if (!inserted) return null
      if (actorUserId !== undefined) {
        setRecordOwnership(db, tableId, [{ recordId: pkValue, createdBy: actorUserId }])
      }
      touchTableUpdatedAt(db, tableId)
      return attachAdvancedRecordId(inserted, spec.primaryKey, pkValue, actorUserId)
    }

    const derivedKeys = getDerivedColumnKeysForTable(db, meta)
    const cleanBody = stripNonStoredFields(validation.record, derivedKeys)
    delete cleanBody._id

    const recordId = extractNonEmptyId(record._id) ?? `rec_${crypto.randomUUID().slice(0, 8)}`
    const orderRow = db
      .query(
        'SELECT COALESCE(MAX(row_order), -1) + 1 AS next_order FROM smart_table_records WHERE table_id = ?',
      )
      .get(tableId) as { next_order: number } | undefined | null
    const nextOrder = orderRow?.next_order ?? 0

    const storedRecord: SmartRecord = {
      ...cleanBody,
      _id: recordId,
    }
    db.query(
      'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
    ).run(recordId, tableId, nextOrder, JSON.stringify(storedRecord))
    if (actorUserId !== undefined) {
      setRecordOwnership(db, tableId, [{ recordId, createdBy: actorUserId }])
      storedRecord.createdBy = actorUserId
    }
    touchTableUpdatedAt(db, tableId)
    return storedRecord
  })
}

/** 批量向普通数据源表追加记录：全量行校验失败时事务零写入并抛出 BatchValidationError */
export function batchCreateTableRecords(
  db: Database,
  tableId: string,
  rawRecords: readonly Record<string, unknown>[],
  options?: { actorUserId?: string },
): BatchImportRecordsResponse | null {
  return runInTransaction(db, () => {
    const row = readTableRow(db, tableId)
    if (!row) return null
    if (row.kind !== 'normal') {
      throw new ValidationError('仅普通数据源表支持批量追加导入')
    }
    if (rawRecords.length === 0) {
      throw new ValidationError('请至少提供一条待导入记录')
    }

    const meta = parseTableRow(row)
    const validation = validateBatchRecords(meta.columns, rawRecords)
    if (!validation.valid) {
      const first = validation.errors[0]!
      throw new BatchValidationError(
        `批量校验失败：共 ${validation.errors.length} 处错误（第 ${first.rowIndex + 1} 行「${first.columnTitle}」：${first.message}）`,
        validation.errors,
      )
    }

    const derivedKeys = getDerivedColumnKeysForTable(db, meta)
    const orderRow = db
      .query(
        'SELECT COALESCE(MAX(row_order), -1) + 1 AS next_order FROM smart_table_records WHERE table_id = ?',
      )
      .get(tableId) as { next_order: number } | undefined | null
    let nextOrder = orderRow?.next_order ?? 0

    const insertStmt = db.query(
      'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
    )
    const inserted: SmartRecord[] = []
    const actorUserId = options?.actorUserId
    const ownershipEntries: { recordId: string; createdBy: string }[] = []

    for (const validatedRec of validation.records) {
      const cleanBody = stripNonStoredFields(validatedRec, derivedKeys)
      const recordId = extractNonEmptyId(cleanBody._id) ?? `rec_${crypto.randomUUID().slice(0, 8)}`
      delete cleanBody._id
      const persistedRecord: SmartRecord = {
        ...cleanBody,
        _id: recordId,
      }
      insertStmt.run(recordId, tableId, nextOrder, JSON.stringify(persistedRecord))
      if (actorUserId !== undefined) {
        ownershipEntries.push({ recordId, createdBy: actorUserId })
        inserted.push({ ...persistedRecord, createdBy: actorUserId })
      } else {
        inserted.push(persistedRecord)
      }
      nextOrder += 1
    }

    if (ownershipEntries.length > 0) {
      setRecordOwnership(db, tableId, ownershipEntries)
    }

    touchTableUpdatedAt(db, tableId)
    return {
      insertedCount: inserted.length,
      records: inserted,
    }
  })
}

export function updateTableRecord(
  db: Database,
  tableId: string,
  recordId: string,
  patch: Record<string, unknown>,
): SmartRecord | null {
  return runInTransaction(db, () => {
    const row = readTableRow(db, tableId)
    if (!row) return null

    const meta = parseTableRow(row)
    const validation = validateRecordPatch(meta.columns, patch)
    if (!validation.valid) {
      throw new ValidationError(validation.errors.map((err) => err.message).join('；'))
    }
    const existingOwner = readRecordOwner(db, tableId, recordId)

    if (row.kind === 'advanced') {
      const spec = getAdvancedSpec(db, row.source_sql_table)
      if (!spec) return null

      const existing = db
        .query(`SELECT * FROM ${spec.tableName} WHERE ${spec.primaryKey} = ?`)
        .get(recordId) as Record<string, unknown> | undefined | null
      if (!existing) return null

      const setColumns: string[] = []
      const setValues: (string | number)[] = []
      let nextPk = recordId

      for (const col of spec.columns) {
        if (!(col in patch)) continue
        if (col === spec.primaryKey) {
          const candidatePk = extractNonEmptyId(validation.record[col])
          if (candidatePk === null) {
            throw new ValidationError(`主键值 "${col}" 不能为空`)
          }
          nextPk = candidatePk
          setColumns.push(`${col} = ?`)
          setValues.push(candidatePk)
        } else {
          if (patch[col] === undefined) continue
          const normalized = normalizeSqlValue(spec, col, validation.record[col], false)
          setColumns.push(`${col} = ?`)
          setValues.push(normalized)
        }
      }

      if (setColumns.length > 0) {
        db.query(
          `UPDATE ${spec.tableName} SET ${setColumns.join(', ')} WHERE ${spec.primaryKey} = ?`,
        ).run(...setValues, recordId)
        if (nextPk !== recordId) {
          db.query(
            'UPDATE record_ownership SET record_id = ? WHERE table_id = ? AND record_id = ?',
          ).run(nextPk, tableId, recordId)
          syncLookupOverridesOnPkChange(db, tableId, recordId, nextPk)
        }
        touchTableUpdatedAt(db, tableId)
      }

      const updated = db
        .query(`SELECT * FROM ${spec.tableName} WHERE ${spec.primaryKey} = ?`)
        .get(nextPk) as Record<string, unknown> | undefined | null
      if (!updated) return null
      return attachAdvancedRecordId(updated, spec.primaryKey, nextPk, existingOwner)
    }

    const recordRow = db
      .query('SELECT data_json FROM smart_table_records WHERE table_id = ? AND id = ?')
      .get(tableId, recordId) as { data_json: string } | undefined | null
    if (!recordRow) return null

    const derivedKeys = getDerivedColumnKeysForTable(db, meta)
    const parsedExisting = JSON.parse(recordRow.data_json) as SmartRecord
    const legacyOwner = existingOwner ?? parsedExisting.createdBy
    const existing = stripNonStoredFields(parsedExisting, derivedKeys)
    const cleanPatch = stripNonStoredFields(validation.record, derivedKeys)
    delete cleanPatch._id

    const persisted: SmartRecord = {
      ...existing,
      ...cleanPatch,
      _id: recordId,
    }

    db.query('UPDATE smart_table_records SET data_json = ? WHERE table_id = ? AND id = ?').run(
      JSON.stringify(persisted),
      tableId,
      recordId,
    )
    touchTableUpdatedAt(db, tableId)
    return legacyOwner !== undefined ? { ...persisted, createdBy: legacyOwner } : persisted
  })
}

export function deleteTableRecord(db: Database, tableId: string, recordId: string): boolean {
  return runInTransaction(db, () => {
    const row = readTableRow(db, tableId)
    if (!row) return false

    if (row.kind === 'advanced') {
      const spec = getAdvancedSpec(db, row.source_sql_table)
      if (!spec) return false
      const result = db
        .query(`DELETE FROM ${spec.tableName} WHERE ${spec.primaryKey} = ?`)
        .run(recordId)
      if (result.changes > 0) {
        db.query('DELETE FROM record_ownership WHERE table_id = ? AND record_id = ?').run(
          tableId,
          recordId,
        )
        touchTableUpdatedAt(db, tableId)
        return true
      }
      return false
    }

    const result = db
      .query('DELETE FROM smart_table_records WHERE table_id = ? AND id = ?')
      .run(tableId, recordId)
    if (result.changes > 0) {
      db.query('DELETE FROM record_ownership WHERE table_id = ? AND record_id = ?').run(
        tableId,
        recordId,
      )
      touchTableUpdatedAt(db, tableId)
      return true
    }
    return false
  })
}
