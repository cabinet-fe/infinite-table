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
import type { SmartColumn, SmartRecord } from '../shared/schema'

type CompileResult = { ok: true; mappedFormula: string } | { ok: false; error: string }

interface ColumnLookupIndex {
  byKey: Map<string, number>
  byTitle: Map<string, number>
}

function buildColumnLookupIndex(columns: readonly SmartColumn[]): ColumnLookupIndex {
  const byKey = new Map<string, number>()
  const byTitle = new Map<string, number>()
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!
    if (!byKey.has(col.key)) {
      byKey.set(col.key, i)
    }
    if (!byTitle.has(col.title)) {
      byTitle.set(col.title, i)
    }
  }
  return { byKey, byTitle }
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

  let output = ''
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
      output += body.slice(i, end)
      i = end
      continue
    }

    if (ch === '[') {
      const closeIdx = body.indexOf(']', i + 1)
      if (closeIdx === -1) {
        return { ok: false, error: '存在未闭合的字段引用 "["' }
      }
      const token = body.slice(i + 1, closeIdx)
      const trimmedToken = token.trim()
      const colIdx =
        index.byKey.get(token) ??
        index.byTitle.get(token) ??
        (trimmedToken !== token
          ? (index.byKey.get(trimmedToken) ?? index.byTitle.get(trimmedToken))
          : undefined)

      if (colIdx === undefined) {
        return { ok: false, error: `未找到引用列: [${token}]` }
      }
      output += `${colLetters(colIdx)}1`
      i = closeIdx + 1
      continue
    }

    output += ch
    i += 1
  }

  return { ok: true, mappedFormula: output }
}

function validateAstNode(node: AstNode): string | undefined {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'error':
    case 'cell':
    case 'range':
      return undefined
    case 'name':
      return `未知标识符: ${node.name}`
    case 'unary':
    case 'percent':
      return validateAstNode(node.operand)
    case 'binary':
      return validateAstNode(node.left) ?? validateAstNode(node.right)
    case 'call': {
      if (!getFormulaFunction(node.name)) {
        return `未知函数: ${node.name}`
      }
      for (const arg of node.args) {
        const argErr = validateAstNode(arg)
        if (argErr !== undefined) {
          return argErr
        }
      }
      return undefined
    }
  }
}

/** 将记录中的任意值规范化为公式引擎可消费的 ScalarValue */
function toFormulaScalar(value: unknown): ScalarValue {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  return null
}

/**
 * 校验列公式表达式语法及字段引用是否有效，供公式列配置 UI 使用。
 */
export function validateFormulaExpr(
  expr: string,
  columns: readonly SmartColumn[],
): { valid: boolean; error?: string } {
  const index = buildColumnLookupIndex(columns)
  const compiled = compileFormulaExpr(expr, index)
  if (!compiled.ok) {
    return { valid: false, error: compiled.error }
  }

  let ast: AstNode
  try {
    ast = parseFormula(compiled.mappedFormula)
  } catch (error) {
    if (error instanceof FormulaParseError) {
      return { valid: false, error: error.message }
    }
    return { valid: false, error: '公式解析失败' }
  }

  const astError = validateAstNode(ast)
  if (astError !== undefined) {
    return { valid: false, error: astError }
  }

  return { valid: true }
}

/**
 * 按列顺序对所有 `type === 'formula'` 且存在 `formulaExpr` 的列求值，并返回浅拷贝新记录数组。
 */
export function evaluateFormulaColumns(
  columns: readonly SmartColumn[],
  records: readonly SmartRecord[],
): SmartRecord[] {
  const nextRecords: SmartRecord[] = records.map((record) => ({ ...record }))
  const index = buildColumnLookupIndex(columns)

  for (const col of columns) {
    if (col.type !== 'formula' || !col.formulaExpr || col.formulaExpr.trim() === '') {
      continue
    }

    const compiled = compileFormulaExpr(col.formulaExpr, index)
    if (!compiled.ok) {
      for (const record of nextRecords) {
        record[col.key] = null
      }
      continue
    }

    for (const record of nextRecords) {
      const resolver: FormulaResolver = {
        cell(ref) {
          if (ref.row !== 0) {
            return null
          }
          const targetCol = columns[ref.col]
          if (!targetCol) {
            return null
          }
          return toFormulaScalar(record[targetCol.key])
        },
        range() {
          return []
        },
      }

      try {
        const result = evaluate(compiled.mappedFormula, resolver)
        if (isFormulaError(result)) {
          // 除零收敛为 0（如达成率分母为 0 场景），其余公式错误收敛为 null
          record[col.key] = result.code === '#DIV/0!' ? 0 : null
        } else if (typeof result === 'number') {
          record[col.key] = Number.isFinite(result) ? result : null
        } else {
          record[col.key] = result
        }
      } catch {
        record[col.key] = null
      }
    }
  }

  return nextRecords
}
