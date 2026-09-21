// AST 求值器（纯函数，不持有状态；单元格读取经 FormulaResolver 由宿主注入）。
//
// 空格（null）参与运算的规则同 Excel：
// - 数字上下文按 0（空单元格 +1 = 1）；空字符串字面量参与算术 → #VALUE!
// - 文本上下文按 ''；布尔上下文按 FALSE
// - 比较时空格归一为对方类型的零值
// 错误值遇运算即传播（左操作数优先）。
// 四则运算走 @cat-kit/core 的 $n 精确计算（结果仍 JS number；=1/0 → #DIV/0!）。

import { $n } from '@cat-kit/core'

import type { CellRef, RangeRef } from './address'
import type { AstNode, BinaryOperator } from './ast'
import { formulaError, isFormulaError, type FormulaError } from './errors'
import { invokeFormulaFunction } from './functions/registry'
import { parseFormula } from './parser'
import { FormulaParseError } from './tokenizer'

/** 标量值（单元格/字面量可取的全集；null = 空单元格） */
export type ScalarValue = number | string | boolean | null

/** 求值结果：标量 / 错误 / 区域展开数组（数组仅作为函数参数形态出现） */
export type EvalValue = ScalarValue | FormulaError | (ScalarValue | FormulaError)[]

/**
 * 宿主取值接口（求值的唯一外部依赖）：
 * ref 含 sheet?/col/row（0 基）/绝对标记；sheet 缺省 = 公式所在表（宿主自定缺省路由）。
 * 实现约定：空格返回 null/undefined；不抛错（未知表等失败回落为 formulaError 返回）。
 */
export interface FormulaResolver {
  /** 读单格（原始值；公式格由宿主决定是否先求值） */
  cell(ref: CellRef): unknown
  /** 读区域：先行后列展开（稀疏语义由宿主决定，建议空格不进数组） */
  range(ref: RangeRef): unknown[]
}

/** evaluate 的可选上下文 */
export interface EvaluateOptions {
  /** 公式所在表名：填入缺省 sheet 的引用后传给 resolver（缺省保持 undefined，由 resolver 自定） */
  sheet?: string
  /** 公式所在格（ROW()/COLUMN() 省参语义）；缺省 { col: 0, row: 0 } */
  cell?: { col: number; row: number }
}

/** 求值上下文（函数 lazy 实现经它回读单元格/区域） */
export interface FormulaEvalContext {
  /** 当前公式所在 sheet（裸引用缺省表；未提供为 undefined） */
  readonly currentSheet: string | undefined
  /** 公式所在格地址（0 基） */
  readonly currentCell: { col: number; row: number }
  /** 读取单格（normalize 后；resolver 抛错 → #REF!） */
  readCell(ref: CellRef): ScalarValue | FormulaError
  /** 读取区域（逐项 normalize；resolver 抛错 → #REF!） */
  readRange(ref: RangeRef): (ScalarValue | FormulaError)[] | FormulaError
  /** 调用函数（名称未知 → #NAME?；参数个数非法 → #VALUE!；ctx 透传给函数实现） */
  callFunction(
    name: string,
    nodes: AstNode[],
    evalNode: (node: AstNode) => EvalValue,
    ctx?: FormulaEvalContext,
  ): EvalValue
}

/** 数字文本正则（与 coerceToNumber 配套；不含 TRUE/FALSE） */
const NUMERIC_TEXT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** 宿主返回值归一化：undefined → null；标量/错误原样；其余对象 → #VALUE! */
function normalizeCellValue(value: unknown): ScalarValue | FormulaError {
  if (value === undefined || value === null) {
    return null
  }
  if (isFormulaError(value)) {
    return value
  }
  switch (typeof value) {
    case 'number':
    case 'string':
    case 'boolean':
      return value
    default:
      return formulaError('#VALUE!')
  }
}

/** 强转数字：null→0，布尔→1/0，数字文本→数字，其余文本→#VALUE!，错误传播 */
export function coerceToNumber(value: EvalValue): number | FormulaError {
  if (isFormulaError(value)) {
    return value
  }
  if (Array.isArray(value)) {
    return formulaError('#VALUE!')
  }
  if (value === null) {
    return 0
  }
  switch (typeof value) {
    case 'number':
      return value
    case 'boolean':
      return value ? 1 : 0
    case 'string': {
      const text = value.trim()
      if (text === '') {
        return formulaError('#VALUE!')
      }
      if (text.toUpperCase() === 'TRUE') {
        return 1
      }
      if (text.toUpperCase() === 'FALSE') {
        return 0
      }
      if (NUMERIC_TEXT_RE.test(text)) {
        return Number.parseFloat(text)
      }
      return formulaError('#VALUE!')
    }
  }
}

/** 强转文本：null→''，布尔→TRUE/FALSE，错误传播 */
export function coerceToText(value: EvalValue): string | FormulaError {
  if (isFormulaError(value)) {
    return value
  }
  if (Array.isArray(value)) {
    return formulaError('#VALUE!')
  }
  if (value === null) {
    return ''
  }
  switch (typeof value) {
    case 'string':
      return value
    case 'number':
      return String(value)
    case 'boolean':
      return value ? 'TRUE' : 'FALSE'
  }
}

/** 强转布尔：null→FALSE，数字≠0，TRUE/FALSE 文本，其余文本→#VALUE!，错误传播 */
export function coerceToBoolean(value: EvalValue): boolean | FormulaError {
  if (isFormulaError(value)) {
    return value
  }
  if (Array.isArray(value)) {
    return formulaError('#VALUE!')
  }
  if (value === null) {
    return false
  }
  switch (typeof value) {
    case 'boolean':
      return value
    case 'number':
      return value !== 0
    case 'string': {
      const text = value.trim().toUpperCase()
      if (text === 'TRUE') {
        return true
      }
      if (text === 'FALSE') {
        return false
      }
      return formulaError('#VALUE!')
    }
  }
}

/** 比较：同类型按类型规则（文本大小写不敏感）；混合类型 数字 < 文本 < 布尔；null 归一为对方零值 */
function compareScalars(left: ScalarValue, right: ScalarValue): number {
  if (left === null || right === null) {
    if (left === null && right === null) {
      return 0
    }
    if (left === null) {
      return compareScalars(zeroLike(right), right)
    }
    return compareScalars(left, zeroLike(left))
  }
  const leftType = typeof left
  const rightType = typeof right
  if (leftType === 'number' && rightType === 'number') {
    return left < right ? -1 : left > right ? 1 : 0
  }
  if (leftType === 'string' && rightType === 'string') {
    const a = (left as string).toUpperCase()
    const b = (right as string).toUpperCase()
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (leftType === 'boolean' && rightType === 'boolean') {
    return left === right ? 0 : left ? 1 : -1
  }
  return typeRank(leftType) - typeRank(rightType)
}

function zeroLike(value: ScalarValue): ScalarValue {
  if (typeof value === 'number') {
    return 0
  }
  if (typeof value === 'string') {
    return ''
  }
  return false
}

function typeRank(type: string): number {
  if (type === 'number') {
    return 0
  }
  if (type === 'string') {
    return 1
  }
  return 2
}

const COMPARISON_OPS = new Set(['=', '<>', '<', '<=', '>', '>='])

/** AST 求值 */
export function evaluateAst(node: AstNode, ctx: FormulaEvalContext): EvalValue {
  switch (node.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return node.value
    case 'error':
      return formulaError(node.code)
    case 'name':
      return formulaError('#NAME?')
    case 'cell':
      return ctx.readCell(fillSheet(node.ref, ctx))
    case 'range':
      return ctx.readRange(fillRangeSheet(node.ref, ctx))
    case 'unary': {
      const num = coerceToNumber(evaluateAst(node.operand, ctx))
      if (isFormulaError(num)) {
        return num
      }
      return node.op === '-' ? -num : num
    }
    case 'percent': {
      const num = coerceToNumber(evaluateAst(node.operand, ctx))
      if (isFormulaError(num)) {
        return num
      }
      return num / 100
    }
    case 'binary':
      return evaluateBinary(node.op, node.left, node.right, ctx)
    case 'call':
      return ctx.callFunction(node.name, node.args, (arg) => evaluateAst(arg, ctx), ctx)
  }
}

/** 裸引用填入缺省表名（未提供 currentSheet 时保持 undefined，由 resolver 自定缺省路由） */
function fillSheet(ref: CellRef, ctx: FormulaEvalContext): CellRef {
  if (ref.sheet !== undefined || ctx.currentSheet === undefined) {
    return ref
  }
  return { ...ref, sheet: ctx.currentSheet }
}

function fillRangeSheet(ref: RangeRef, ctx: FormulaEvalContext): RangeRef {
  if (ref.sheet !== undefined || ctx.currentSheet === undefined) {
    return ref
  }
  return { ...ref, sheet: ctx.currentSheet }
}

function evaluateBinary(
  op: BinaryOperator,
  leftNode: AstNode,
  rightNode: AstNode,
  ctx: FormulaEvalContext,
): EvalValue {
  const left = evaluateAst(leftNode, ctx)
  if (isFormulaError(left)) {
    return left
  }
  const right = evaluateAst(rightNode, ctx)
  if (isFormulaError(right)) {
    return right
  }

  if (op === '&') {
    const leftText = coerceToText(left)
    if (isFormulaError(leftText)) {
      return leftText
    }
    const rightText = coerceToText(right)
    if (isFormulaError(rightText)) {
      return rightText
    }
    return leftText + rightText
  }

  if (COMPARISON_OPS.has(op)) {
    if (Array.isArray(left) || Array.isArray(right)) {
      return formulaError('#VALUE!')
    }
    const compared = compareScalars(left, right)
    switch (op) {
      case '=':
        return compared === 0
      case '<>':
        return compared !== 0
      case '<':
        return compared < 0
      case '<=':
        return compared <= 0
      case '>':
        return compared > 0
      default:
        return compared >= 0
    }
  }

  const leftNum = coerceToNumber(left)
  if (isFormulaError(leftNum)) {
    return leftNum
  }
  const rightNum = coerceToNumber(right)
  if (isFormulaError(rightNum)) {
    return rightNum
  }

  switch (op) {
    case '+':
      return $n.plus(leftNum, rightNum)
    case '-':
      return $n.minus(leftNum, rightNum)
    case '*':
      return $n.mul(leftNum, rightNum)
    case '/':
      if (rightNum === 0) {
        return formulaError('#DIV/0!')
      }
      return $n.div(leftNum, rightNum)
    case '^': {
      if (leftNum === 0 && rightNum < 0) {
        return formulaError('#DIV/0!')
      }
      const value = Math.pow(leftNum, rightNum)
      return Number.isFinite(value) ? value : formulaError('#VALUE!')
    }
    // & 与比较运算已在上方提前返回
    default:
      return formulaError('#ERROR!')
  }
}

/** 由 resolver 构造求值上下文 */
function createContext(resolver: FormulaResolver, options: EvaluateOptions): FormulaEvalContext {
  const ctx: FormulaEvalContext = {
    currentSheet: options.sheet,
    currentCell: options.cell ?? { col: 0, row: 0 },
    readCell(ref) {
      try {
        return normalizeCellValue(resolver.cell(ref))
      } catch {
        return formulaError('#REF!')
      }
    },
    readRange(ref) {
      try {
        return resolver.range(ref).map(normalizeCellValue)
      } catch {
        return formulaError('#REF!')
      }
    },
    callFunction(name, nodes, evalNode, fnCtx) {
      return invokeFormulaFunction(name, nodes, evalNode, fnCtx ?? ctx)
    },
  }
  return ctx
}

/**
 * 求值公式文本（不含前导 '='）。
 * 解析失败 → #ERROR!；区域作为最终结果（非函数参数）→ #VALUE!（v1 不做数组公式）。
 */
export function evaluate(
  formula: string,
  resolver: FormulaResolver,
  options: EvaluateOptions = {},
): number | string | boolean | FormulaError {
  let ast: AstNode
  try {
    ast = parseFormula(formula)
  } catch (error) {
    if (error instanceof FormulaParseError) {
      return formulaError('#ERROR!')
    }
    throw error
  }
  const result = evaluateAst(ast, createContext(resolver, options))
  if (Array.isArray(result)) {
    return formulaError('#VALUE!')
  }
  // 空格引用作为终值按 Excel 观感显示为 0
  return result === null ? 0 : result
}
