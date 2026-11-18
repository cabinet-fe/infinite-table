// 前后端共享的记录单源校验与类型归一化（必填 required、数值/进度/日期/勾选/链接类型校验与批量错误收集）

import type { BatchImportRowError } from './api-types'
import { filterRawColumns, isDerivedColumnType, type SmartColumn } from './schema'

export type CellValidationResult =
  | { valid: true; value: unknown }
  | { valid: false; message: string }

export interface RecordValidationError {
  field: string
  columnTitle: string
  message: string
}

export interface RecordValidationResult {
  valid: boolean
  record: Record<string, unknown>
  errors: RecordValidationError[]
}

export interface BatchValidationResult {
  valid: boolean
  records: Record<string, unknown>[]
  errors: BatchImportRowError[]
}

const DATE_ONLY_PATTERN = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/
const DATE_TIME_PATTERN = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s].*)?$/

const TRUE_TOKENS = new Set(['true', '1', '是', 'yes', 'y', '✓'])
const FALSE_TOKENS = new Set(['false', '0', '否', 'no', 'n'])

function isLinkObject(value: unknown): value is { url?: unknown; text?: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return 'url' in value || 'text' in value
}

/** 判断单元格值是否为空（null / undefined / 纯空白字符串 / 空链接对象） */
export function isRecordValueEmpty(value: unknown, col?: Pick<SmartColumn, 'type'>): boolean {
  if (value === null || value === undefined) {
    return true
  }
  if (typeof value === 'string') {
    return value.trim() === ''
  }
  if ((col?.type === 'link' || col === undefined) && isLinkObject(value)) {
    const url = typeof value.url === 'string' ? value.url.trim() : ''
    const text = typeof value.text === 'string' ? value.text.trim() : ''
    return url === '' && text === ''
  }
  return false
}

function normalizeDateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }

  const dateOnly = DATE_ONLY_PATTERN.exec(trimmed)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null
    }
    const utc = new Date(Date.UTC(year, month - 1, day))
    if (
      utc.getUTCFullYear() !== year ||
      utc.getUTCMonth() !== month - 1 ||
      utc.getUTCDate() !== day
    ) {
      return null
    }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  if (!DATE_TIME_PATTERN.test(trimmed)) {
    return null
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? trimmed : null
}

function normalizeCheckboxValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (TRUE_TOKENS.has(lower)) return true
    if (FALSE_TOKENS.has(lower)) return false
  }
  return null
}

/** 校验并按列类型归一化单个单元格的值（派生列直接放行） */
export function validateAndCoerceCellValue(col: SmartColumn, value: unknown): CellValidationResult {
  if (isDerivedColumnType(col.type)) {
    return { valid: true, value }
  }

  if (isRecordValueEmpty(value, col)) {
    if (col.required) {
      return { valid: false, message: `${col.title}为必填项` }
    }
    if (col.type === 'number' || col.type === 'progress' || col.type === 'checkbox') {
      return { valid: true, value: null }
    }
    return { valid: true, value: value === undefined ? null : value }
  }

  if (col.type === 'number' || col.type === 'progress') {
    let parsed: number
    if (typeof value === 'number') {
      parsed = value
    } else if (typeof value === 'string') {
      parsed = Number(value.trim())
    } else {
      return { valid: false, message: '请输入有效数值' }
    }
    if (!Number.isFinite(parsed)) {
      return { valid: false, message: '请输入有效数值' }
    }
    const normalized = col.type === 'progress' ? Math.max(0, Math.min(100, parsed)) : parsed
    return { valid: true, value: normalized }
  }

  if (col.type === 'date') {
    const normalized = normalizeDateValue(value)
    if (normalized === null) {
      return { valid: false, message: '请输入有效日期（格式 YYYY-MM-DD）' }
    }
    return { valid: true, value: normalized }
  }

  if (col.type === 'checkbox') {
    const normalized = normalizeCheckboxValue(value)
    if (normalized === null) {
      return { valid: false, message: '勾选列仅支持布尔值' }
    }
    return { valid: true, value: normalized }
  }

  if (col.type === 'link') {
    if (typeof value === 'string') {
      return { valid: true, value }
    }
    if (isLinkObject(value)) {
      const urlOk = value.url === undefined || typeof value.url === 'string'
      const textOk = value.text === undefined || typeof value.text === 'string'
      if (urlOk && textOk) {
        return { valid: true, value }
      }
    }
    return { valid: false, message: '链接列格式无效' }
  }

  if (typeof value === 'string') {
    return { valid: true, value }
  }
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
    return { valid: true, value: String(value) }
  }
  return { valid: false, message: '请输入有效文本' }
}

/** 新增整行记录校验（全量检查原始列的 required 与类型，自动剔除派生列） */
export function validateRecordForCreate(
  columns: readonly SmartColumn[],
  rawRecord: Record<string, unknown>,
): RecordValidationResult {
  const rawColumns = filterRawColumns(columns)
  const colByKey = new Map(columns.map((col) => [col.key, col]))
  const record: Record<string, unknown> = {}
  const errors: RecordValidationError[] = []

  for (const [key, val] of Object.entries(rawRecord)) {
    const existingCol = colByKey.get(key)
    if (existingCol && isDerivedColumnType(existingCol.type)) {
      continue
    }
    if (!existingCol) {
      record[key] = val
    }
  }

  for (const col of rawColumns) {
    const hasKey = Object.prototype.hasOwnProperty.call(rawRecord, col.key)
    const result = validateAndCoerceCellValue(col, rawRecord[col.key])
    if (!result.valid) {
      errors.push({
        field: col.key,
        columnTitle: col.title,
        message: result.message,
      })
      continue
    }
    if (hasKey && result.value !== undefined) {
      record[col.key] = result.value
    }
  }

  return {
    valid: errors.length === 0,
    record,
    errors,
  }
}

/** 局部更新 patch 校验（仅校验 patch 显式包含的原始列，跳过派生列） */
export function validateRecordPatch(
  columns: readonly SmartColumn[],
  patch: Record<string, unknown>,
): RecordValidationResult {
  const colByKey = new Map(columns.map((col) => [col.key, col]))
  const record: Record<string, unknown> = {}
  const errors: RecordValidationError[] = []

  for (const [key, val] of Object.entries(patch)) {
    const col = colByKey.get(key)
    if (!col) {
      record[key] = val
      continue
    }
    if (isDerivedColumnType(col.type)) {
      continue
    }
    const result = validateAndCoerceCellValue(col, val)
    if (!result.valid) {
      errors.push({
        field: col.key,
        columnTitle: col.title,
        message: result.message,
      })
      continue
    }
    record[key] = result.value
  }

  return {
    valid: errors.length === 0,
    record,
    errors,
  }
}

/** 批量追加导入校验：逐行全量收集错误明细，不中断于首行错误 */
export function validateBatchRecords(
  columns: readonly SmartColumn[],
  rawRecords: readonly Record<string, unknown>[],
): BatchValidationResult {
  const normalizedRecords: Record<string, unknown>[] = []
  const errors: BatchImportRowError[] = []

  for (let rowIndex = 0; rowIndex < rawRecords.length; rowIndex++) {
    const rawRow = rawRecords[rowIndex]!
    const res = validateRecordForCreate(columns, rawRow)
    normalizedRecords.push(res.record)
    for (const err of res.errors) {
      errors.push({
        rowIndex,
        field: err.field,
        columnTitle: err.columnTitle,
        message: err.message,
      })
    }
  }

  return {
    valid: errors.length === 0,
    records: normalizedRecords,
    errors,
  }
}
