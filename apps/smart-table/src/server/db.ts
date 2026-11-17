// SQLite 数据库连接、建表、旧库平滑迁移与双模式表（普通自建表 + 进阶 SQL 物理表）读写封装。
// 路径支持 SMART_TABLE_DB 环境变量覆盖；测试传入 ':memory:' 使用内存数据库。
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import type { CreateTableRequest, TableBundle } from '../shared/api-types'
import type {
  SmartColumn,
  SmartColumnType,
  SmartRecord,
  SmartTableMeta,
  SmartView,
  SummaryType,
  TableKind,
} from '../shared/schema'

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

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS smart_tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  primary_key_field TEXT,
  source_sql_table TEXT,
  schema_json TEXT NOT NULL,
  views_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS smart_table_records (
  id TEXT NOT NULL,
  table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
  row_order INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (table_id, id)
);
CREATE INDEX IF NOT EXISTS idx_records_table ON smart_table_records(table_id, row_order);

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

  const paymentCols = db.query('PRAGMA table_info(biz_payments)').all() as { name: string }[]
  if (!paymentCols.some((c) => c.name === 'region')) {
    db.exec("ALTER TABLE biz_payments ADD COLUMN region TEXT NOT NULL DEFAULT '';")
  }
}

export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA busy_timeout = 5000;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA_SQL)
  migrateLegacySchema(db)
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
  updated_at: string
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验列定义合法性及 key 唯一性 */
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
    if (view.type !== 'table' && view.type !== 'pivot') {
      throw new ValidationError(`视图 "${view.id}" 的类型必须为 table 或 pivot`)
    }
    if (seenViewIds.has(view.id)) {
      throw new ValidationError(`存在重复视图 id: "${view.id}"`)
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

function parseTableRow(row: SmartTableRow): SmartTableMeta {
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
  return meta
}

function readTableRow(db: Database, tableId: string): SmartTableRow | null {
  const row = db
    .query(
      'SELECT id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at FROM smart_tables WHERE id = ?',
    )
    .get(tableId) as SmartTableRow | undefined | null
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
): SmartRecord {
  return {
    ...row,
    _id: toPrimitiveString(row[primaryKey], fallbackId),
  }
}

function readRecordsForMeta(db: Database, meta: SmartTableMeta): SmartRecord[] {
  if (meta.kind === 'advanced') {
    const spec = getAdvancedSpec(db, meta.sourceSqlTable)
    if (!spec) return []
    const rows = db.query(`SELECT * FROM ${spec.tableName} ORDER BY rowid ASC`).all() as Record<
      string,
      unknown
    >[]
    return rows.map((row) => attachAdvancedRecordId(row, spec.primaryKey))
  }

  const rows = db
    .query(
      'SELECT id, data_json FROM smart_table_records WHERE table_id = ? ORDER BY row_order ASC, rowid ASC',
    )
    .all(meta.id) as { id: string; data_json: string }[]

  return rows.map((row) => {
    const parsed = JSON.parse(row.data_json) as SmartRecord
    return {
      ...parsed,
      _id: row.id,
    }
  })
}

export function listTableBundles(db: Database): TableBundle[] {
  const tableRows = db
    .query(
      'SELECT id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at FROM smart_tables ORDER BY rowid ASC',
    )
    .all() as SmartTableRow[]

  return tableRows.map((row) => {
    const meta = parseTableRow(row)
    return {
      meta,
      records: readRecordsForMeta(db, meta),
    }
  })
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
  options?: { records?: readonly Record<string, unknown>[] },
): TableBundle {
  if (typeof req.name !== 'string' || req.name.trim() === '') {
    throw new ValidationError('表名 name 不能为空')
  }
  const columns: SmartColumn[] =
    req.columns !== undefined
      ? validateColumns(req.columns)
      : [{ key: 'title', title: '名称', type: 'text', width: 200 }]

  const id = `tbl_${crypto.randomUUID().slice(0, 8)}`
  const meta: SmartTableMeta = {
    id,
    name: req.name.trim(),
    kind: 'normal',
    columns,
    views: [buildDefaultTableView()],
    summaries: {},
  }
  if (req.description !== undefined) {
    meta.description = req.description
  }

  const storedRecords: SmartRecord[] = []
  runInTransaction(db, () => {
    db.query(
      'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      meta.id,
      meta.name,
      meta.kind,
      null,
      null,
      serializeSchemaPayload(meta),
      JSON.stringify(meta.views),
      new Date().toISOString(),
    )
    if (options?.records && options.records.length > 0) {
      const stmt = db.query(
        'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
      )
      options.records.forEach((record, index) => {
        const recordId = extractNonEmptyId(record._id) ?? `rec_${crypto.randomUUID().slice(0, 8)}`
        const stored: SmartRecord = { ...record, _id: recordId }
        storedRecords.push(stored)
        stmt.run(recordId, meta.id, index, JSON.stringify(stored))
      })
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
    }
    if (options.description !== undefined) {
      meta.description = options.description
    }
    if (options.system === true) {
      meta.system = true
    }
    db.query(
      'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      meta.id,
      meta.name,
      meta.kind,
      primaryKey,
      physicalName,
      serializeSchemaPayload(meta),
      JSON.stringify(meta.views),
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

    db.query(
      'UPDATE smart_tables SET name = ?, schema_json = ?, views_json = ?, updated_at = ? WHERE id = ?',
    ).run(
      nextMeta.name,
      serializeSchemaPayload(nextMeta),
      JSON.stringify(nextMeta.views),
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

/** 获取普通表中的计算列（lookup / formula）key 集合，写入磁盘前需剔除 */
function getComputedColumnKeys(meta: SmartTableMeta): Set<string> {
  const keys = new Set<string>()
  for (const col of meta.columns) {
    if (col.type === 'lookup' || col.type === 'formula') {
      keys.add(col.key)
    }
  }
  return keys
}

function stripComputedFields(
  obj: Record<string, unknown>,
  computedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    if (computedKeys.has(key)) {
      continue
    }
    cleaned[key] = val
  }
  return cleaned
}

function mergeLookupOverrides(
  existing: Record<string, string> | undefined,
  patchValue: unknown,
): Record<string, string> | undefined {
  if (patchValue === null) {
    return undefined
  }
  if (!isPlainObject(patchValue)) {
    return existing ? { ...existing } : undefined
  }
  const next: Record<string, string> = existing ? { ...existing } : {}
  for (const [groupId, targetId] of Object.entries(patchValue)) {
    const normalizedId = extractNonEmptyId(targetId)
    if (normalizedId === null) {
      delete next[groupId]
    } else {
      next[groupId] = normalizedId
    }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/** 当进阶表主键变更时，同步更新所有引用它的普通表记录中的 _lookupOverrides */
function syncLookupOverridesOnPkChange(
  db: Database,
  targetTableId: string,
  oldPk: string,
  newPk: string,
): void {
  if (oldPk === newPk) return

  const normalTableRows = db
    .query(
      "SELECT id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at FROM smart_tables WHERE kind = 'normal'",
    )
    .all() as SmartTableRow[]

  for (const tableRow of normalTableRows) {
    const meta = parseTableRow(tableRow)
    const affectedGroupIds = new Set<string>()
    for (const col of meta.columns) {
      if (
        col.type === 'lookup' &&
        col.lookupConfig?.mode === 'one' &&
        col.lookupConfig.targetTableId === targetTableId
      ) {
        affectedGroupIds.add(col.lookupConfig.groupId)
      }
    }
    if (affectedGroupIds.size === 0) {
      continue
    }

    const recordRows = db
      .query('SELECT id, data_json FROM smart_table_records WHERE table_id = ?')
      .all(meta.id) as { id: string; data_json: string }[]

    let updatedAny = false
    for (const recRow of recordRows) {
      const parsed = JSON.parse(recRow.data_json) as SmartRecord
      if (!parsed._lookupOverrides) continue

      let rowChanged = false
      const nextOverrides = { ...parsed._lookupOverrides }
      for (const groupId of affectedGroupIds) {
        if (nextOverrides[groupId] === oldPk) {
          nextOverrides[groupId] = newPk
          rowChanged = true
        }
      }
      if (rowChanged) {
        parsed._lookupOverrides = nextOverrides
        db.query('UPDATE smart_table_records SET data_json = ? WHERE table_id = ? AND id = ?').run(
          JSON.stringify(parsed),
          meta.id,
          recRow.id,
        )
        updatedAny = true
      }
    }

    if (updatedAny) {
      touchTableUpdatedAt(db, meta.id)
    }
  }
}

export function createTableRecord(
  db: Database,
  tableId: string,
  record: Omit<SmartRecord, '_id'> & { _id?: string },
): SmartRecord | null {
  return runInTransaction(db, () => {
    const row = readTableRow(db, tableId)
    if (!row) return null

    if (row.kind === 'advanced') {
      const spec = getAdvancedSpec(db, row.source_sql_table)
      if (!spec) return null

      const pkFromField = extractNonEmptyId(record[spec.primaryKey])
      const pkFromId = extractNonEmptyId(record._id)
      const pkValue =
        pkFromField ?? pkFromId ?? `${spec.idPrefix}-${crypto.randomUUID().slice(0, 8)}`

      const values = spec.columns.map((col) =>
        col === spec.primaryKey ? pkValue : normalizeSqlValue(spec, col, record[col], true),
      )
      const placeholders = spec.columns.map(() => '?').join(', ')
      db.query(
        `INSERT INTO ${spec.tableName} (${spec.columns.join(', ')}) VALUES (${placeholders})`,
      ).run(...values)

      const inserted = db
        .query(`SELECT * FROM ${spec.tableName} WHERE ${spec.primaryKey} = ?`)
        .get(pkValue) as Record<string, unknown> | undefined | null
      if (!inserted) return null
      touchTableUpdatedAt(db, tableId)
      return attachAdvancedRecordId(inserted, spec.primaryKey, pkValue)
    }

    const meta = parseTableRow(row)
    const computedKeys = getComputedColumnKeys(meta)
    const cleanBody = stripComputedFields(record, computedKeys)

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
    touchTableUpdatedAt(db, tableId)
    return storedRecord
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
          const candidatePk = extractNonEmptyId(patch[col])
          if (candidatePk === null) {
            throw new ValidationError(`主键值 "${col}" 不能为空`)
          }
          nextPk = candidatePk
          setColumns.push(`${col} = ?`)
          setValues.push(candidatePk)
        } else {
          if (patch[col] === undefined) continue
          const normalized = normalizeSqlValue(spec, col, patch[col], false)
          setColumns.push(`${col} = ?`)
          setValues.push(normalized)
        }
      }

      if (setColumns.length > 0) {
        db.query(
          `UPDATE ${spec.tableName} SET ${setColumns.join(', ')} WHERE ${spec.primaryKey} = ?`,
        ).run(...setValues, recordId)
        if (nextPk !== recordId) {
          syncLookupOverridesOnPkChange(db, tableId, recordId, nextPk)
        }
        touchTableUpdatedAt(db, tableId)
      }

      const updated = db
        .query(`SELECT * FROM ${spec.tableName} WHERE ${spec.primaryKey} = ?`)
        .get(nextPk) as Record<string, unknown> | undefined | null
      if (!updated) return null
      return attachAdvancedRecordId(updated, spec.primaryKey, nextPk)
    }

    const recordRow = db
      .query('SELECT data_json FROM smart_table_records WHERE table_id = ? AND id = ?')
      .get(tableId, recordId) as { data_json: string } | undefined | null
    if (!recordRow) return null

    const meta = parseTableRow(row)
    const computedKeys = getComputedColumnKeys(meta)

    const existing = stripComputedFields(
      JSON.parse(recordRow.data_json) as SmartRecord,
      computedKeys,
    )
    const cleanPatch = stripComputedFields(patch, computedKeys)
    delete cleanPatch._id
    delete cleanPatch._lookupOverrides

    const merged: SmartRecord = {
      ...existing,
      ...cleanPatch,
      _id: recordId,
    }

    if ('_lookupOverrides' in patch) {
      const nextOverrides = mergeLookupOverrides(
        existing._lookupOverrides as Record<string, string> | undefined,
        patch._lookupOverrides,
      )
      if (nextOverrides) {
        merged._lookupOverrides = nextOverrides
      } else {
        delete merged._lookupOverrides
      }
    }

    db.query('UPDATE smart_table_records SET data_json = ? WHERE table_id = ? AND id = ?').run(
      JSON.stringify(merged),
      tableId,
      recordId,
    )
    touchTableUpdatedAt(db, tableId)
    return merged
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
        touchTableUpdatedAt(db, tableId)
        return true
      }
      return false
    }

    const result = db
      .query('DELETE FROM smart_table_records WHERE table_id = ? AND id = ?')
      .run(tableId, recordId)
    if (result.changes > 0) {
      touchTableUpdatedAt(db, tableId)
      return true
    }
    return false
  })
}
