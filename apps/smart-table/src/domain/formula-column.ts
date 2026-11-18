// 整列公式求值引擎：将 [fieldKey] / [列标题] 映射为虚拟单元格坐标并驱动 @infinitable/formulas 求值

import {
  FormulaParseError,
  colLetters,
  evaluate,
  getFormulaFunction,
  isFormulaError,
  parseFormula,
} from '@infinitable/formulas'

import type { AstNode, FormulaResolver, ScalarValue } from '@infinitable/formulas'
import { mergeSmartColumns, type SmartColumn, type SmartRecord } from '../shared/schema'

const UNSUPPORTED_REF_MSG = '暂不支持区域/单元格坐标引用，请使用 [字段名]'

type CompileResult =
  | {
      ok: true
      mappedFormula: string
      sanitizedFormula: string
      referencedColIndices: number[]
    }
  | { ok: false; error: string }

interface ColumnLookupIndex {
  byKey: Map<string, number>
  byTitle: Map<string, number>
  duplicateTitles: Set<string>
  /** 含 ']' 的已知列 key 或唯一 title，按长度降序排列以支持最长前缀匹配 */
  bracketNames: string[]
}

function buildColumnLookupIndex(columns: readonly SmartColumn[]): ColumnLookupIndex {
  const byKey = new Map<string, number>()
  const byTitle = new Map<string, number>()
  const titleCounts = new Map<string, number>()

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!
    if (!byKey.has(col.key)) {
      byKey.set(col.key, i)
    }
    titleCounts.set(col.title, (titleCounts.get(col.title) ?? 0) + 1)
  }

  const duplicateTitles = new Set<string>()
  for (const [title, count] of titleCounts.entries()) {
    if (count > 1) {
      duplicateTitles.add(title)
    }
  }

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!
    if (!duplicateTitles.has(col.title) && !byTitle.has(col.title)) {
      byTitle.set(col.title, i)
    }
  }

  const bracketSet = new Set<string>()
  for (const key of byKey.keys()) {
    if (key.includes(']')) {
      bracketSet.add(key)
    }
  }
  for (const title of byTitle.keys()) {
    if (title.includes(']')) {
      bracketSet.add(title)
    }
  }
  const bracketNames = [...bracketSet].sort((a, b) => b.length - a.length)

  return { byKey, byTitle, duplicateTitles, bracketNames }
}

function resolveColumnToken(
  token: string,
  index: ColumnLookupIndex,
): { ok: true; colIdx: number } | { ok: false; error: string } {
  const trimmedToken = token.trim()
  const candidates = trimmedToken !== token ? [token, trimmedToken] : [token]

  for (const candidate of candidates) {
    const byKeyIdx = index.byKey.get(candidate)
    if (byKeyIdx !== undefined) {
      return { ok: true, colIdx: byKeyIdx }
    }
    if (index.duplicateTitles.has(candidate)) {
      return {
        ok: false,
        error: `列标题 [${candidate}] 存在重名，请使用唯一字段名引用`,
      }
    }
    const byTitleIdx = index.byTitle.get(candidate)
    if (byTitleIdx !== undefined) {
      return { ok: true, colIdx: byTitleIdx }
    }
  }

  return { ok: false, error: `未找到引用列: [${token}]` }
}

/**
 * 从 '[' 后的起始下标提取字段引用 token 与闭合 ']' 下标。
 * 优先匹配含 ']' 的已知列名，也支持 '\]' 转义闭合符。
 */
function readBracketToken(
  body: string,
  openIndex: number,
  index: ColumnLookupIndex,
): { token: string; closeIndex: number } | null {
  const start = openIndex + 1

  for (const name of index.bracketNames) {
    if (body.startsWith(name, start) && body[start + name.length] === ']') {
      return { token: name, closeIndex: start + name.length }
    }
  }

  let token = ''
  let cursor = start
  while (cursor < body.length) {
    const ch = body[cursor]!
    if (ch === '\\' && body[cursor + 1] === ']') {
      token += ']'
      cursor += 2
      continue
    }
    if (ch === ']') {
      return { token, closeIndex: cursor }
    }
    token += ch
    cursor += 1
  }

  return null
}

/** 将列公式文本中的 [fieldKey] / [列标题] 映射为 A1 / B1 ... 虚拟坐标 */
function compileFormulaExpr(expr: string, index: ColumnLookupIndex): CompileResult {
  const trimmed = expr.trim()
  if (trimmed === '') {
    return { ok: false, error: '公式不能为空' }
  }
  const body = trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed
  if (body === '') {
    return { ok: false, error: '公式不能为空' }
  }

  let mappedFormula = ''
  let sanitizedFormula = ''
  const referencedSet = new Set<number>()
  let i = 0

  while (i < body.length) {
    const ch = body[i]!
    // 双引号字符串字面量内部不做 [token] 替换
    if (ch === '"') {
      let end = i + 1
      let closed = false
      while (end < body.length) {
        if (body[end] === '"') {
          if (body[end + 1] === '"') {
            end += 2
            continue
          }
          closed = true
          end += 1
          break
        }
        end += 1
      }
      if (!closed) {
        return { ok: false, error: '字符串缺少结束引号' }
      }
      const literal = body.slice(i, end)
      mappedFormula += literal
      sanitizedFormula += literal
      i = end
      continue
    }

    if (ch === '[') {
      const extracted = readBracketToken(body, i, index)
      if (!extracted) {
        return { ok: false, error: '存在未闭合的字段引用 "["' }
      }
      const resolved = resolveColumnToken(extracted.token, index)
      if (!resolved.ok) {
        return resolved
      }
      referencedSet.add(resolved.colIdx)
      mappedFormula += `${colLetters(resolved.colIdx)}1`
      sanitizedFormula += '1'
      i = extracted.closeIndex + 1
      continue
    }

    mappedFormula += ch
    sanitizedFormula += ch
    i += 1
  }

  return {
    ok: true,
    mappedFormula,
    sanitizedFormula,
    referencedColIndices: [...referencedSet],
  }
}

function validateAstNode(node: AstNode, allowMappedCell = false): string | undefined {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'error':
      return undefined
    case 'range':
      return UNSUPPORTED_REF_MSG
    case 'cell':
      if (
        !allowMappedCell ||
        node.ref.row !== 0 ||
        node.ref.sheet !== undefined ||
        node.ref.colAbsolute ||
        node.ref.rowAbsolute
      ) {
        return UNSUPPORTED_REF_MSG
      }
      return undefined
    case 'name':
      return `未知标识符: ${node.name}`
    case 'unary':
    case 'percent':
      return validateAstNode(node.operand, allowMappedCell)
    case 'binary':
      return (
        validateAstNode(node.left, allowMappedCell) ?? validateAstNode(node.right, allowMappedCell)
      )
    case 'call': {
      if (!getFormulaFunction(node.name)) {
        return `未知函数: ${node.name}`
      }
      for (const arg of node.args) {
        const argErr = validateAstNode(arg, allowMappedCell)
        if (argErr !== undefined) {
          return argErr
        }
      }
      return undefined
    }
  }
}

function compileAndValidateFormula(
  expr: string,
  index: ColumnLookupIndex,
):
  | { ok: true; mappedFormula: string; referencedColIndices: number[] }
  | { ok: false; error: string } {
  const compiled = compileFormulaExpr(expr, index)
  if (!compiled.ok) {
    return compiled
  }

  // 先解析映射后公式以优先捕获 [a]:[b] 等产生的 range AST 节点
  let mappedAst: AstNode
  try {
    mappedAst = parseFormula(compiled.mappedFormula)
  } catch (error) {
    if (error instanceof FormulaParseError) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: '公式解析失败' }
  }

  const mappedAstError = validateAstNode(mappedAst, true)
  if (mappedAstError !== undefined) {
    return { ok: false, error: mappedAstError }
  }

  let sanitizedAst: AstNode
  try {
    sanitizedAst = parseFormula(compiled.sanitizedFormula)
  } catch (error) {
    if (error instanceof FormulaParseError) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: '公式解析失败' }
  }

  const rawAstError = validateAstNode(sanitizedAst, false)
  if (rawAstError !== undefined) {
    return { ok: false, error: rawAstError }
  }

  return {
    ok: true,
    mappedFormula: compiled.mappedFormula,
    referencedColIndices: compiled.referencedColIndices,
  }
}

/** 将记录中的任意值规范化为公式引擎可消费的 ScalarValue（空串转 null 以按 0 参与算术） */
function toFormulaScalar(value: unknown): ScalarValue {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    return value.trim() === '' ? null : value
  }
  if (typeof value === 'boolean') {
    return value
  }
  return null
}

/** 检查从 startIndices 出发沿着已有公式列依赖是否能回到 targetColIdx */
function hasPathToTarget(
  targetColIdx: number,
  startIndices: readonly number[],
  columns: readonly SmartColumn[],
  index: ColumnLookupIndex,
  overrideTargetDeps?: readonly number[],
): boolean {
  const visited = new Set<number>()
  const queue = [...startIndices]

  while (queue.length > 0) {
    const curr = queue.shift()!
    if (curr === targetColIdx) {
      return true
    }
    if (visited.has(curr)) {
      continue
    }
    visited.add(curr)

    const col = columns[curr]
    if (!col || col.type !== 'formula') {
      continue
    }
    if (curr === targetColIdx && overrideTargetDeps) {
      for (const dep of overrideTargetDeps) {
        queue.push(dep)
      }
      continue
    }
    if (!col.formulaExpr || col.formulaExpr.trim() === '') {
      continue
    }
    const compiled = compileFormulaExpr(col.formulaExpr, index)
    if (!compiled.ok) {
      continue
    }
    for (const dep of compiled.referencedColIndices) {
      if (!visited.has(dep)) {
        queue.push(dep)
      }
    }
  }

  return false
}

/**
 * 校验列公式表达式语法、字段引用与循环依赖是否有效，供公式列配置 UI 使用。
 * 可选传入 SmartApp.derivedColumns 与底层原始列合并校验。
 */
export function validateFormulaExpr(
  expr: string,
  columns: readonly SmartColumn[],
  currentColumnKey?: string,
  derivedColumns?: readonly SmartColumn[],
): { valid: boolean; error?: string } {
  const effectiveColumns =
    derivedColumns !== undefined ? mergeSmartColumns(columns, derivedColumns) : columns
  const index = buildColumnLookupIndex(effectiveColumns)
  const validated = compileAndValidateFormula(expr, index)
  if (!validated.ok) {
    return { valid: false, error: validated.error }
  }

  if (currentColumnKey !== undefined) {
    const currentColIdx = index.byKey.get(currentColumnKey)
    if (currentColIdx !== undefined) {
      if (validated.referencedColIndices.includes(currentColIdx)) {
        return { valid: false, error: '检测到循环引用：公式不能直接引用当前列' }
      }
      if (
        hasPathToTarget(
          currentColIdx,
          validated.referencedColIndices,
          effectiveColumns,
          index,
          validated.referencedColIndices,
        )
      ) {
        return { valid: false, error: '检测到循环引用：公式存在间接循环依赖' }
      }
    }
  }

  return { valid: true }
}

interface PreparedFormulaColumn {
  colIndex: number
  key: string
  mappedFormula: string
  formulaDeps: number[]
}

/** 对有效公式列做拓扑排序，返回安全求值顺序与成环（含依赖环）列下标集合 */
function topoSortFormulaColumns(preparedList: readonly PreparedFormulaColumn[]): {
  ordered: PreparedFormulaColumn[]
  cyclicIndices: Set<number>
} {
  const byColIdx = new Map<number, PreparedFormulaColumn>()
  const inDegree = new Map<number, number>()
  const dependents = new Map<number, number[]>()

  for (const item of preparedList) {
    byColIdx.set(item.colIndex, item)
    inDegree.set(item.colIndex, 0)
    dependents.set(item.colIndex, [])
  }

  for (const item of preparedList) {
    for (const depIdx of item.formulaDeps) {
      if (byColIdx.has(depIdx)) {
        inDegree.set(item.colIndex, (inDegree.get(item.colIndex) ?? 0) + 1)
        dependents.get(depIdx)!.push(item.colIndex)
      }
    }
  }

  const queue: number[] = []
  for (const item of preparedList) {
    if ((inDegree.get(item.colIndex) ?? 0) === 0) {
      queue.push(item.colIndex)
    }
  }

  const ordered: PreparedFormulaColumn[] = []
  while (queue.length > 0) {
    const currIdx = queue.shift()!
    ordered.push(byColIdx.get(currIdx)!)
    for (const nextIdx of dependents.get(currIdx) ?? []) {
      const nextDeg = (inDegree.get(nextIdx) ?? 0) - 1
      inDegree.set(nextIdx, nextDeg)
      if (nextDeg === 0) {
        queue.push(nextIdx)
      }
    }
  }

  const cyclicIndices = new Set<number>()
  for (const item of preparedList) {
    if ((inDegree.get(item.colIndex) ?? 0) > 0) {
      cyclicIndices.add(item.colIndex)
    }
  }

  return { ordered, cyclicIndices }
}

/**
 * 按依赖拓扑顺序对所有 `type === 'formula'` 且存在 `formulaExpr` 的列求值，并返回浅拷贝新记录数组。
 * 可选传入 SmartApp.derivedColumns 与底层原始列合并求值。
 */
export function evaluateFormulaColumns(
  columns: readonly SmartColumn[],
  records: readonly SmartRecord[],
  derivedColumns?: readonly SmartColumn[],
): SmartRecord[] {
  const effectiveColumns =
    derivedColumns !== undefined ? mergeSmartColumns(columns, derivedColumns) : columns
  const nextRecords: SmartRecord[] = records.map((record) => ({ ...record }))
  const index = buildColumnLookupIndex(effectiveColumns)

  const formulaColIndexSet = new Set<number>()
  for (let i = 0; i < effectiveColumns.length; i++) {
    if (effectiveColumns[i]!.type === 'formula') {
      formulaColIndexSet.add(i)
    }
  }
  if (formulaColIndexSet.size === 0) {
    return nextRecords
  }

  const preparedList: PreparedFormulaColumn[] = []
  const invalidOrEmptyKeys: string[] = []

  for (let i = 0; i < effectiveColumns.length; i++) {
    const col = effectiveColumns[i]!
    if (col.type !== 'formula') {
      continue
    }
    if (!col.formulaExpr || col.formulaExpr.trim() === '') {
      invalidOrEmptyKeys.push(col.key)
      continue
    }

    const compiled = compileAndValidateFormula(col.formulaExpr, index)
    if (!compiled.ok) {
      invalidOrEmptyKeys.push(col.key)
      continue
    }

    const formulaDeps = compiled.referencedColIndices.filter((depIdx) =>
      formulaColIndexSet.has(depIdx),
    )
    preparedList.push({
      colIndex: i,
      key: col.key,
      mappedFormula: compiled.mappedFormula,
      formulaDeps,
    })
  }

  const { ordered, cyclicIndices } = topoSortFormulaColumns(preparedList)

  for (const key of invalidOrEmptyKeys) {
    for (const record of nextRecords) {
      record[key] = null
    }
  }
  for (const cyclicIdx of cyclicIndices) {
    const key = effectiveColumns[cyclicIdx]!.key
    for (const record of nextRecords) {
      record[key] = null
    }
  }

  // 在列循环外共用 resolver 骨架，避免每行重复查找列元数据与重建映射
  let activeRecord: SmartRecord | null = null
  const resolver: FormulaResolver = {
    cell(ref) {
      if (ref.row !== 0 || !activeRecord) {
        return null
      }
      const targetCol = effectiveColumns[ref.col]
      if (!targetCol) {
        return null
      }
      return toFormulaScalar(activeRecord[targetCol.key])
    },
    range() {
      return []
    },
  }

  for (const prepared of ordered) {
    for (const record of nextRecords) {
      activeRecord = record
      try {
        const result = evaluate(prepared.mappedFormula, resolver)
        if (isFormulaError(result)) {
          // 除零收敛为 0（如达成率分母为 0 场景），其余公式错误收敛为 null
          record[prepared.key] = result.code === '#DIV/0!' ? 0 : null
        } else if (typeof result === 'number') {
          record[prepared.key] = Number.isFinite(result) ? result : null
        } else {
          record[prepared.key] = result
        }
      } catch {
        record[prepared.key] = null
      }
    }
  }

  return nextRecords
}
