// SQLite 数据库连接、建表与双模式表（普通自建表 + 进阶 SQL 物理表）读写封装。
// 路径支持 SMART_TABLE_DB 环境变量覆盖；测试传入 ':memory:' 使用内存数据库。
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'
import type { CreateTableRequest, TableBundle } from '../shared/api-types'
import type {
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
  SmartView,
  SummaryType,
  TableKind,
} from '../shared/schema'

export const DEFAULT_DB_PATH = resolve(import.meta.dirname, '../../data/smart-table.sqlite')

export function resolveDbPath(): string {
  return process.env.SMART_TABLE_DB ?? DEFAULT_DB_PATH
}

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
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL,
  row_order INTEGER NOT NULL,
  data_json TEXT NOT NULL
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
  amount REAL NOT NULL,
  pay_method TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pay_project ON biz_payments(project_code);
`

export function openDatabase(path: string): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new Database(path)
  db.exec(SCHEMA_SQL)
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
}

interface AdvancedTableSpec {
  tableName: 'biz_employees' | 'biz_payments'
  primaryKey: string
  idPrefix: string
  columns: readonly string[]
  numericColumns: ReadonlySet<string>
}

// 进阶物理表白名单：避免直接拼接客户端传入的 sourceSqlTable 引发 SQL 注入
const ADVANCED_TABLE_MAP: Record<string, AdvancedTableSpec> = {
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
      'amount',
      'pay_method',
    ],
    numericColumns: new Set(['amount']),
  },
}

function getAdvancedSpec(sourceSqlTable: string | null | undefined): AdvancedTableSpec | null {
  if (!sourceSqlTable) return null
  return ADVANCED_TABLE_MAP[sourceSqlTable] ?? null
}

function serializeSchemaPayload(meta: {
  description?: string
  columns: SmartColumn[]
  summaries: Record<string, SummaryType>
}): string {
  const payload: StoredSchemaPayload = {
    columns: meta.columns,
    summaries: meta.summaries,
  }
  if (meta.description !== undefined) {
    payload.description = meta.description
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
    const spec = getAdvancedSpec(meta.sourceSqlTable)
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

export function insertNormalTable(db: Database, req: CreateTableRequest): TableBundle {
  const id = `tbl_${crypto.randomUUID().slice(0, 8)}`
  const columns: SmartColumn[] = req.columns ?? [
    { key: 'title', title: '名称', type: 'text', width: 200 },
  ]
  const views: SmartView[] = [
    {
      id: `view_${crypto.randomUUID().slice(0, 8)}`,
      name: '全部数据',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: [],
      sortRules: [],
    },
  ]
  const meta: SmartTableMeta = {
    id,
    name: req.name.trim(),
    kind: 'normal',
    columns,
    views,
    summaries: {},
  }
  if (req.description !== undefined) {
    meta.description = req.description
  }

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

  return { meta, records: [] }
}

export function updateTableMeta(
  db: Database,
  tableId: string,
  meta: SmartTableMeta,
): SmartTableMeta | null {
  const existingRow = readTableRow(db, tableId)
  if (!existingRow) return null

  const existingMeta = parseTableRow(existingRow)
  const nextMeta: SmartTableMeta = {
    ...existingMeta,
    name: meta.name,
    columns: meta.columns,
    views: meta.views,
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
}

function normalizeSqlValue(
  spec: AdvancedTableSpec,
  column: string,
  value: unknown,
): string | number {
  if (spec.numericColumns.has(column)) {
    const num = typeof value === 'number' ? value : Number(value ?? 0)
    return Number.isFinite(num) ? num : 0
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

export function createTableRecord(
  db: Database,
  tableId: string,
  record: Omit<SmartRecord, '_id'> & { _id?: string },
): SmartRecord | null {
  const row = readTableRow(db, tableId)
  if (!row) return null

  if (row.kind === 'advanced') {
    const spec = getAdvancedSpec(row.source_sql_table)
    if (!spec) return null

    const rawPk = record[spec.primaryKey]
    const pkFromField = typeof rawPk === 'string' && rawPk.trim() !== '' ? rawPk.trim() : null
    const pkFromId =
      typeof record._id === 'string' && record._id.trim() !== '' ? record._id.trim() : null
    const pkValue = pkFromField ?? pkFromId ?? `${spec.idPrefix}-${crypto.randomUUID().slice(0, 8)}`

    const values = spec.columns.map((col) =>
      col === spec.primaryKey ? pkValue : normalizeSqlValue(spec, col, record[col]),
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

  const recordId =
    typeof record._id === 'string' && record._id.trim() !== ''
      ? record._id.trim()
      : `rec_${crypto.randomUUID().slice(0, 8)}`
  const orderRow = db
    .query(
      'SELECT COALESCE(MAX(row_order), -1) + 1 AS next_order FROM smart_table_records WHERE table_id = ?',
    )
    .get(tableId) as { next_order: number } | undefined | null
  const nextOrder = orderRow?.next_order ?? 0

  const storedRecord: SmartRecord = {
    ...record,
    _id: recordId,
  }
  db.query(
    'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
  ).run(recordId, tableId, nextOrder, JSON.stringify(storedRecord))
  touchTableUpdatedAt(db, tableId)
  return storedRecord
}

export function updateTableRecord(
  db: Database,
  tableId: string,
  recordId: string,
  patch: Record<string, unknown>,
): SmartRecord | null {
  const row = readTableRow(db, tableId)
  if (!row) return null

  if (row.kind === 'advanced') {
    const spec = getAdvancedSpec(row.source_sql_table)
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
      const normalized = normalizeSqlValue(spec, col, patch[col])
      if (col === spec.primaryKey) {
        const candidatePk = String(normalized).trim()
        if (candidatePk === '') continue
        nextPk = candidatePk
        setColumns.push(`${col} = ?`)
        setValues.push(candidatePk)
      } else {
        setColumns.push(`${col} = ?`)
        setValues.push(normalized)
      }
    }

    if (setColumns.length > 0) {
      db.query(
        `UPDATE ${spec.tableName} SET ${setColumns.join(', ')} WHERE ${spec.primaryKey} = ?`,
      ).run(...setValues, recordId)
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

  const existing = JSON.parse(recordRow.data_json) as SmartRecord
  const merged: SmartRecord = {
    ...existing,
    ...patch,
    _id: recordId,
  }
  if (patch._lookupOverrides === null) {
    delete merged._lookupOverrides
  }

  db.query('UPDATE smart_table_records SET data_json = ? WHERE table_id = ? AND id = ?').run(
    JSON.stringify(merged),
    tableId,
    recordId,
  )
  touchTableUpdatedAt(db, tableId)
  return merged
}

export function deleteTableRecord(db: Database, tableId: string, recordId: string): boolean {
  const row = readTableRow(db, tableId)
  if (!row) return false

  if (row.kind === 'advanced') {
    const spec = getAdvancedSpec(row.source_sql_table)
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
}
