// Excel/CSV 导入提交：文件解析在前端完成（shared/import-parse），服务端只消费
// （可编辑过的）列配置与行数据，负责建表 + 事务批量插行（normal 走普通表路径，advanced 落 SQL 物理表）。
import type { Database } from 'bun:sqlite'
import type { ImportCommitRequest, TableBundle } from '../shared/api-types'
import type { SmartColumn } from '../shared/schema'
import { coerceImportCell } from '../shared/import-parse'
import {
  ValidationError,
  createAdvancedPhysicalTable,
  getTableBundle,
  insertNormalTable,
  runInTransaction,
  validateColumns,
} from './db'

/** 单元格字符串 → 按列类型规整（数值非法时报出精确行列位置） */
function toTypedCell(raw: string, column: SmartColumn, rowIndex: number): string | number | null {
  if (column.type === 'number' || column.type === 'progress') {
    try {
      return coerceImportCell(raw, 'number')
    } catch {
      throw new ValidationError(`第 ${rowIndex + 1} 行列 "${column.title}" 必须是有效数字`)
    }
  }
  return raw
}

/** commit 请求的行矩阵 → 与 columns 对齐的规整值矩阵（number 列已转数字/空为 null） */
function rowsToTypedCells(rows: readonly (readonly string[])[], columns: readonly SmartColumn[]) {
  return rows.map((row, rowIndex) =>
    columns.map((column, colIndex) => toTypedCell(row[colIndex] ?? '', column, rowIndex)),
  )
}

/**
 * 提交导入：normal 走普通建表路径扩展（带初始行）；advanced 复用 createAdvancedPhysicalTable
 * 建物理表（首列数据列为主键）后事务批量插行。返回建好的表捆绑数据。
 */
export function commitImport(db: Database, req: ImportCommitRequest): TableBundle {
  if (req.kind !== 'normal' && req.kind !== 'advanced') {
    throw new ValidationError('kind 必须为 normal 或 advanced')
  }
  if (typeof req.tableName !== 'string' || req.tableName.trim() === '') {
    throw new ValidationError('表名 tableName 不能为空')
  }
  if (!Array.isArray(req.columns) || req.columns.length === 0) {
    throw new ValidationError('columns 必须为非空数组')
  }
  if (!Array.isArray(req.rows)) {
    throw new ValidationError('rows 必须为字符串二维数组')
  }
  const columns: SmartColumn[] = validateColumns(
    req.columns.map((column) => ({
      key: column.key,
      title: column.label,
      type: column.type,
      width: 140,
    })),
  )
  const typedRows = rowsToTypedCells(req.rows, columns)

  if (req.kind === 'normal') {
    const records = typedRows.map((cells) => {
      const record: Record<string, unknown> = {}
      columns.forEach((column, index) => {
        const value = cells[index]!
        if (value !== null) record[column.key] = value
      })
      return record
    })
    const created = insertNormalTable(db, { name: req.tableName, columns }, { records })
    return getTableBundle(db, created.meta.id)!
  }

  const primaryKeyIndex = 0
  typedRows.forEach((cells, rowIndex) => {
    const pk = cells[primaryKeyIndex]
    if (pk === null || pk === '') {
      throw new ValidationError(`进阶表导入的首列为主键：第 ${rowIndex + 1} 行主键值为空`)
    }
  })

  const meta = runInTransaction(db, () => {
    const created = createAdvancedPhysicalTable(db, {
      name: req.tableName,
      physicalName: req.tableName,
      columns,
    })
    const columnSql = columns.map((column) => `"${column.key}"`).join(', ')
    const placeholders = columns.map(() => '?').join(', ')
    const stmt = db.query(
      `INSERT INTO "${created.sourceSqlTable}" (${columnSql}) VALUES (${placeholders})`,
    )
    for (const cells of typedRows) {
      stmt.run(...columns.map((_, index) => cells[index] ?? null))
    }
    return created
  })
  return getTableBundle(db, meta.id)!
}
