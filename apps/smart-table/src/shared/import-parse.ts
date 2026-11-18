// Excel/CSV 浏览器端导入解析：hucre 纯前端读取文件二进制 → 首行表头 + 列类型推断 + 行规整，
// 与服务端 commit 共用同一套口径（数值/日期模式与列 key 清洗规则单一事实源）。
import type { CellValue, Workbook as HucreWorkbook } from 'hucre'
import { parseCsv } from 'hucre/csv'
import { readXlsx } from 'hucre/xlsx'
import type { ImportColumnType, ImportPreviewColumn, ImportPreviewResponse } from './api-types'
import { validateAndCoerceCellValue } from './record-validation'
import { filterRawColumns, type SmartColumn } from './schema'

/** 导入网格规模上限：超出截断并在预览标注 truncated */
export const IMPORT_MAX_ROWS = 5000
export const IMPORT_MAX_COLUMNS = 50
const CSV_FALLBACK_NAME = '导入数据'

/** 整数/小数/科学计数（前导零数字串如工号 "007" 视为文本保留原样） */
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const LEADING_ZERO_PATTERN = /^0\d/
/** 常见日期样式：YYYY-MM-DD / YYYY/M/D / YYYY.M.D（配 Date.parse 一致性校验） */
const DATE_PATTERN = /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

/** 魔数 PK → xlsx（ZIP 容器）；否则按 UTF-8 文本走 CSV 解析 */
async function parseImportBuffer(buffer: ArrayBuffer): Promise<{
  sheetName: string
  grid: string[][]
}> {
  const bytes = new Uint8Array(buffer)
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const workbook: HucreWorkbook = await readXlsx(bytes)
    const sheet = workbook.sheets[0]
    if (!sheet) {
      throw new Error('Excel 文件中没有工作表')
    }
    const sheetName = sheet.name.trim() === '' ? CSV_FALLBACK_NAME : sheet.name
    return { sheetName, grid: (sheet.rows ?? []).map((row) => row.map(cellToString)) }
  }
  const text = new TextDecoder('utf-8').decode(bytes)
  const rows = parseCsv(text, { typeInference: false })
  return { sheetName: CSV_FALLBACK_NAME, grid: rows.map((row) => row.map(cellToString)) }
}

/** 列类型推断：非空值全为数字 → number；全为常见日期样式且 Date.parse 一致 → date；其余 text */
function inferColumnType(values: readonly string[]): ImportColumnType {
  const nonEmpty = values.filter((value) => value.trim() !== '')
  if (nonEmpty.length === 0) return 'text'
  const isNumber = nonEmpty.every((value) => {
    const trimmed = value.trim()
    return (
      !LEADING_ZERO_PATTERN.test(trimmed) &&
      NUMBER_PATTERN.test(trimmed) &&
      Number.isFinite(Number(trimmed))
    )
  })
  if (isNumber) return 'number'
  const isDate = nonEmpty.every((value) => {
    const trimmed = value.trim()
    return DATE_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(trimmed))
  })
  if (isDate) return 'date'
  return 'text'
}

/** 表头 → 合法列 key：非法字符转下划线、去重（追加 _2/_3…）、空则 col_N */
function buildColumnKey(label: string, index: number, used: Set<string>): string {
  let key = label
    .trim()
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
  if (/^\d/.test(key)) key = `c_${key}`
  if (key === '') key = `col_${index + 1}`
  let candidate = key
  for (let n = 2; used.has(candidate); n++) candidate = `${key}_${n}`
  used.add(candidate)
  return candidate
}

/** 行规整到固定宽度（补空串/截断） */
function normalizeRow(row: readonly string[] | undefined, width: number): string[] {
  const cells: string[] = []
  for (let i = 0; i < width; i++) cells.push(row?.[i] ?? '')
  return cells
}

/** 浏览器端解析导入文件并产出预览：建议表名、列推断、总行数、全量行与截断标志（无服务端交互） */
export async function parseImportFile(file: File): Promise<ImportPreviewResponse> {
  const { sheetName, grid } = await parseImportBuffer(await file.arrayBuffer())
  if (grid.length === 0) {
    throw new Error('文件内容为空：缺少表头行')
  }

  let rawWidth = 0
  for (const row of grid) rawWidth = Math.max(rawWidth, row.length)
  const width = Math.min(rawWidth, IMPORT_MAX_COLUMNS)
  const truncated = grid.length - 1 > IMPORT_MAX_ROWS || rawWidth > IMPORT_MAX_COLUMNS

  const header = normalizeRow(grid[0], width)
  const body = grid.slice(1, 1 + IMPORT_MAX_ROWS).map((row) => normalizeRow(row, width))

  const used = new Set<string>()
  const columns: ImportPreviewColumn[] = header.map((label, index) => {
    const trimmed = label.trim()
    return {
      key: buildColumnKey(trimmed, index, used),
      label: trimmed === '' ? `列${index + 1}` : trimmed,
      type: inferColumnType(body.map((row) => row[index]!)),
    }
  })

  return {
    suggestedName: sheetName,
    columns,
    totalRows: grid.length - 1,
    // 截断上限内的全量数据行：commit 需要完整 rows，前端预览自行截取展示
    rows: body,
    truncated,
  }
}

/**
 * 单元格字符串按列类型规整：number 列转数字（空 → null），其余保持字符串。
 * 无效数字抛错（消息带行列位置，供调用方就地提示）。
 */
export function coerceImportCell(raw: string, type: ImportColumnType): string | number | null {
  if (type !== 'number') return raw
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const num = Number(trimmed)
  if (!Number.isFinite(num)) {
    throw new Error(`数值列存在非法值 "${trimmed}"`)
  }
  return num
}

/** 行矩阵 → 建表初始记录：列对齐 + 数值列转数字（空值跳过不写入） */
export function buildImportRecords(
  columns: readonly ImportPreviewColumn[],
  rows: readonly (readonly string[])[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const record: Record<string, unknown> = {}
    columns.forEach((column, index) => {
      const value = coerceImportCell(row[index] ?? '', column.type)
      if (value !== null) record[column.key] = value
    })
    return record
  })
}

/** 导入列与目标数据源表原始列的映射项（targetField 为 null 表示跳过该导入列） */
export interface ImportColumnMapping {
  sourceIndex: number
  sourceLabel: string
  sourceKey: string
  targetField: string | null
}

function normalizeHeaderToken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s_\-*＊]+/g, '')
}

/**
 * 基于导入表头与目标表原始列自动匹配列映射：
 * 优先级：列标题精确匹配 → 列 key 精确匹配 → 归一化（忽略大小写/空白/下划线/星号）匹配。
 * 仅匹配目标表原始列（自动过滤 lookup / formula），且每个目标列最多自动分配一次。
 */
export function matchImportColumns(
  importColumns: readonly ImportPreviewColumn[],
  targetColumns: readonly SmartColumn[],
): ImportColumnMapping[] {
  const rawTargets = filterRawColumns(targetColumns)
  const assignments: Array<string | null> = importColumns.map(() => null)
  const usedTargets = new Set<string>()

  const tryAssignPass = (
    predicate: (src: ImportPreviewColumn, target: SmartColumn) => boolean,
  ): void => {
    for (let i = 0; i < importColumns.length; i++) {
      if (assignments[i] !== null) continue
      const src = importColumns[i]!
      const matched = rawTargets.find(
        (target) => !usedTargets.has(target.key) && predicate(src, target),
      )
      if (matched) {
        assignments[i] = matched.key
        usedTargets.add(matched.key)
      }
    }
  }

  // 1. 表头与目标列标题精确匹配
  tryAssignPass(
    (src, target) => src.label.trim() !== '' && src.label.trim() === target.title.trim(),
  )

  // 2. 表头或清洗 key 与目标列 key 精确匹配
  tryAssignPass((src, target) => src.label.trim() === target.key)
  tryAssignPass((src, target) => !/^col_\d+$/.test(src.key) && src.key === target.key)

  // 3. 常见归一化匹配（忽略大小写、空白、下划线、连字符与必填星号）
  tryAssignPass((src, target) => {
    const srcNorm = normalizeHeaderToken(src.label)
    if (srcNorm === '') return false
    return (
      srcNorm === normalizeHeaderToken(target.title) || srcNorm === normalizeHeaderToken(target.key)
    )
  })

  return importColumns.map((col, index) => ({
    sourceIndex: index,
    sourceLabel: col.label,
    sourceKey: col.key,
    targetField: assignments[index] ?? null,
  }))
}

/**
 * 按列映射将导入字符串矩阵转换为待校验/提交的记录数组：
 * 仅保留映射到目标原始列的非空单元格，有效值按目标列类型规整，非法值保留原串供 validateBatchRecords 收集行级错误。
 */
export function buildMappedImportRecords(
  mappings: readonly ImportColumnMapping[],
  targetColumns: readonly SmartColumn[],
  rows: readonly (readonly string[])[],
): Record<string, unknown>[] {
  const rawByKey = new Map(filterRawColumns(targetColumns).map((col) => [col.key, col]))

  return rows.map((row) => {
    const record: Record<string, unknown> = {}
    for (const mapping of mappings) {
      if (!mapping.targetField) continue
      const targetCol = rawByKey.get(mapping.targetField)
      if (!targetCol) continue
      const raw = row[mapping.sourceIndex] ?? ''
      if (raw.trim() === '') continue
      const coerced = validateAndCoerceCellValue(targetCol, raw)
      record[targetCol.key] = coerced.valid ? coerced.value : raw
    }
    return record
  })
}
