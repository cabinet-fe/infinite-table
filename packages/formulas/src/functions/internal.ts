// 函数实现共享的内部工具：参数展开 / 数字与布尔收集 / criteria 条件解析。
// 参数形态约定：区域引用求值为数组（宿主稀疏语义），直接参数为标量。
// 聚合函数据此区分 Excel 语义：区域内的文本/布尔被忽略，直接参数则强转（非法 → #VALUE!）。

import { $n } from '@cat-kit/core'

import { isFormulaError, type FormulaError } from '../errors'
import { coerceToBoolean, coerceToNumber, type EvalValue, type ScalarValue } from '../evaluator'

export interface FlatArg {
  value: ScalarValue | FormulaError
  /** 来自区域展开（区别于直接参数：区域内文本/布尔被聚合函数忽略） */
  fromRange: boolean
}

export function flattenArgs(args: EvalValue[]): FlatArg[] {
  const out: FlatArg[] = []
  for (const arg of args) {
    if (Array.isArray(arg)) {
      for (const value of arg) {
        out.push({ value, fromRange: true })
      }
    } else {
      out.push({ value: arg, fromRange: false })
    }
  }
  return out
}

/** 收集数字：区域内只取数字格；直接参数强转（非法/错误 → 传播） */
export function collectNumbers(args: EvalValue[]): number[] | FormulaError {
  const numbers: number[] = []
  for (const { value, fromRange } of flattenArgs(args)) {
    if (isFormulaError(value)) {
      return value
    }
    if (fromRange) {
      if (typeof value === 'number') {
        numbers.push(value)
      }
      continue
    }
    const num = coerceToNumber(value)
    if (isFormulaError(num)) {
      return num
    }
    numbers.push(num)
  }
  return numbers
}

/** 高精度累加，返回 JS number（空数组为 0） */
export function plusAll(numbers: number[]): number {
  let sum = 0
  for (const num of numbers) {
    sum = $n.plus(sum, num)
  }
  return sum
}

/** 收集布尔：区域内只取布尔格；直接参数强转（非法文本/错误 → 传播）；空值跳过 */
export function collectBooleans(args: EvalValue[]): boolean[] | FormulaError {
  const booleans: boolean[] = []
  for (const { value, fromRange } of flattenArgs(args)) {
    if (isFormulaError(value)) {
      return value
    }
    if (fromRange) {
      if (typeof value === 'boolean') {
        booleans.push(value)
      }
      continue
    }
    if (value === null) {
      continue
    }
    const flag = coerceToBoolean(value)
    if (isFormulaError(flag)) {
      return flag
    }
    booleans.push(flag)
  }
  return booleans
}

/** 依次强转数字参数（缺省位用 fallback；空格按 0；错误传播） */
export function coerceNumberArgs(args: EvalValue[], fallbacks: number[]): number[] | FormulaError {
  const out: number[] = []
  for (let index = 0; index < fallbacks.length; index++) {
    const arg = args[index]
    const num = coerceToNumber(arg === undefined ? fallbacks[index]! : arg)
    if (isFormulaError(num)) {
      return num
    }
    out.push(num)
  }
  return out
}

/** criteria 运算符前缀（双字符在前，避免 `>=` 被截成 `>` + `=`） */
const CRITERIA_OPS = ['>=', '<=', '<>', '>', '<', '='] as const

type CriteriaOp = (typeof CRITERIA_OPS)[number]

function matchesOp(
  left: number | string | boolean,
  right: number | string | boolean,
  op: CriteriaOp,
): boolean {
  switch (op) {
    case '=':
      return left === right
    case '<>':
      return left !== right
    case '>':
      return left > right
    case '>=':
      return left >= right
    case '<':
      return left < right
    default:
      return left <= right
  }
}

/**
 * criteria 解析（COUNTIF 条件统计语义锚点）：
 * 识别 `>` / `>=` / `<` / `<=` / `<>` / `=` 前缀与裸值；
 * 数值按数值比较、文本相等不区分大小写，类型不匹配（数值 criteria 对文本格等）不计。
 */
export function parseCriteria(raw: ScalarValue): (value: ScalarValue) => boolean {
  const text = typeof raw === 'string' ? raw : raw === null ? '' : String(raw)
  let op: CriteriaOp = '='
  let rest = text
  for (const candidate of CRITERIA_OPS) {
    if (text.startsWith(candidate)) {
      op = candidate
      rest = text.slice(candidate.length)
      break
    }
  }
  const upper = rest.toUpperCase()
  if (upper === 'TRUE' || upper === 'FALSE') {
    const target = upper === 'TRUE'
    return (value) => typeof value === 'boolean' && matchesOp(value, target, op)
  }
  const numeric = coerceToNumber(rest)
  if (!isFormulaError(numeric)) {
    return (value) => typeof value === 'number' && matchesOp(value, numeric, op)
  }
  if (rest === '') {
    // `""` 匹配空白格、`<>""` 匹配非空白格（空白主要来自直接引用参数）
    return (value) => (op === '=' ? value === null : op === '<>' ? value !== null : false)
  }
  return (value) => typeof value === 'string' && matchesOp(value.toUpperCase(), upper, op)
}
