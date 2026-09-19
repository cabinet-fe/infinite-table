// mini 公式求值器（演示用，证明公式显示接口；非引擎能力、非 ultra-ui core/ 顶替层）：
// 支持 数字 / 四则运算与括号 / 一元负号 / 单元格引用（A1）/ 区域函数
// SUM | AVERAGE | COUNT | MIN | MAX（参数为引用或区域 A1:B2，逗号分隔）。
// 求值失败（语法错误/未知 token）抛错，由 createFormulaDisplay 回落显示 = 原文。

import type { SheetStore } from '@infinite-table/plugins'

/** 引用坐标（0 基） */
interface CellRef {
  col: number
  row: number
}

/** 列字母 → 0 基列号（A=0, B=1, …, AA=26） */
function parseColLetters(letters: string): number {
  let col = 0
  for (const char of letters) {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) {
      throw new Error(`非法列引用：${letters}`)
    }
    col = col * 26 + (code - 64)
  }
  return col - 1
}

/** A1 形态引用解析 */
function parseRef(text: string): CellRef {
  const match = /^([A-Z]+)([0-9]+)$/.exec(text)
  if (!match) {
    throw new Error(`非法引用：${text}`)
  }
  const row = Number(match[2]) - 1
  if (row < 0) {
    throw new Error(`非法行引用：${text}`)
  }
  return { col: parseColLetters(match[1]!), row }
}

/** 格值 → 数值（数值直取；数字串转换；其余按 0，对齐轻量演示语义） */
function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && !value.startsWith('=')) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return 0
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; text: string }
  | { kind: 'op'; text: string }

/** 词法：数字、引用/函数名、运算符与括号 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < input.length) {
    const char = input[index]!
    if (char === ' ') {
      index++
      continue
    }
    if (/[0-9.]/.test(char)) {
      let end = index
      while (end < input.length && /[0-9.]/.test(input[end]!)) {
        end++
      }
      const value = Number(input.slice(index, end))
      if (Number.isNaN(value)) {
        throw new Error(`非法数字：${input.slice(index, end)}`)
      }
      tokens.push({ kind: 'num', value })
      index = end
      continue
    }
    if (/[A-Za-z]/.test(char)) {
      let end = index
      while (end < input.length && /[A-Za-z0-9]/.test(input[end]!)) {
        end++
      }
      tokens.push({ kind: 'ref', text: input.slice(index, end) })
      index = end
      continue
    }
    if ('+-*/():,'.includes(char)) {
      tokens.push({ kind: 'op', text: char })
      index++
      continue
    }
    throw new Error(`未知字符：${char}`)
  }
  return tokens
}

const RANGE_FUNCTIONS = new Set(['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX'])

/**
 * 求值公式体（不含前导 =）。
 * resolve 由调用方提供（一般读当前 SheetStore：store.getValue）。
 */
export function evaluateFormula(
  formula: string,
  resolve: (col: number, row: number) => unknown,
): number {
  const tokens = tokenize(formula)
  let position = 0

  const peekOp = (...texts: string[]): string | null => {
    const token = tokens[position]
    return token && token.kind === 'op' && texts.includes(token.text) ? token.text : null
  }

  /** 引用或区域 → 数值列表（函数参数用） */
  const evalRefLike = (): number[] => {
    const startToken = tokens[position]
    if (!startToken || startToken.kind !== 'ref') {
      throw new Error('函数参数应为引用或区域')
    }
    position++
    if (peekOp(':')) {
      position++
      const endToken = tokens[position]
      if (!endToken || endToken.kind !== 'ref') {
        throw new Error('区域引用缺少终点')
      }
      position++
      const from = parseRef(startToken.text)
      const to = parseRef(endToken.text)
      const values: number[] = []
      for (let col = Math.min(from.col, to.col); col <= Math.max(from.col, to.col); col++) {
        for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row++) {
          values.push(toNumber(resolve(col, row)))
        }
      }
      return values
    }
    const ref = parseRef(startToken.text)
    return [toNumber(resolve(ref.col, ref.row))]
  }

  const evalAtom = (): number => {
    const token = tokens[position]
    if (!token) {
      throw new Error('表达式意外结束')
    }
    if (token.kind === 'num') {
      position++
      return token.value
    }
    if (token.kind === 'ref') {
      // 函数名（后随 "("）或单元格引用
      if (
        RANGE_FUNCTIONS.has(token.text.toUpperCase()) &&
        tokens[position + 1]?.kind === 'op' &&
        (tokens[position + 1] as { text: string }).text === '('
      ) {
        const fn = token.text.toUpperCase()
        position += 2 // 跳过函数名与 "("
        const values: number[] = []
        if (!peekOp(')')) {
          values.push(...evalRefLike())
          while (peekOp(',')) {
            position++
            values.push(...evalRefLike())
          }
        }
        if (!peekOp(')')) {
          throw new Error('函数缺少右括号')
        }
        position++
        return applyRangeFunction(fn, values)
      }
      position++
      const ref = parseRef(token.text)
      return toNumber(resolve(ref.col, ref.row))
    }
    if (token.text === '(') {
      position++
      const value = evalExpr()
      if (!peekOp(')')) {
        throw new Error('缺少右括号')
      }
      position++
      return value
    }
    if (token.text === '-') {
      position++
      return -evalAtom()
    }
    throw new Error(`意外 token：${token.kind === 'op' ? token.text : String(token)}`)
  }

  const evalTerm = (): number => {
    let value = evalAtom()
    for (let op = peekOp('*', '/'); op !== null; op = peekOp('*', '/')) {
      position++
      const right = evalAtom()
      value = op === '*' ? value * right : value / right
    }
    return value
  }

  const evalExpr = (): number => {
    let value = evalTerm()
    for (let op = peekOp('+', '-'); op !== null; op = peekOp('+', '-')) {
      position++
      const right = evalTerm()
      value = op === '+' ? value + right : value - right
    }
    return value
  }

  const result = evalExpr()
  if (position !== tokens.length) {
    throw new Error('表达式存在多余 token')
  }
  return result
}

function applyRangeFunction(fn: string, values: number[]): number {
  switch (fn) {
    case 'SUM':
      return values.reduce((sum, value) => sum + value, 0)
    case 'AVERAGE':
      return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
    case 'COUNT':
      return values.length
    case 'MIN':
      return values.length === 0 ? 0 : Math.min(...values)
    case 'MAX':
      return values.length === 0 ? 0 : Math.max(...values)
    default:
      throw new Error(`未知函数：${fn}`)
  }
}

/** 产出绑定到指定 Store 的求值器（createFormulaDisplay 的 evaluate 入参） */
export function createStoreEvaluator(store: SheetStore): (formula: string) => number {
  return (formula) => evaluateFormula(formula, (col, row) => store.getValue(col, row))
}
