// 公式分词器：数字 / 字符串 / 布尔与标识符（函数名、引用、表名）/ 带引号表名 / 错误字面量 / 运算符。
// 不做语义消歧：`A1`（引用）、`SUM`（函数名）、`Sheet2`（表名）统一产出 ident，
// 由 parser 依据后随 token（`(` / `!` / `:` / 运算位）判定。

import { FORMULA_ERROR_CODES, type FormulaErrorCode } from './errors'

/** 解析失败异常（evaluate 捕获 → 求值结果为 #ERROR!） */
export class FormulaParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormulaParseError'
  }
}

export type FormulaOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '^'
  | '&'
  | '%'
  | '('
  | ')'
  | ','
  | '!'
  | ':'
  | '='
  | '<>'
  | '<'
  | '<='
  | '>'
  | '>='

export type FormulaToken =
  | { type: 'number'; value: number; raw: string }
  | { type: 'string'; value: string }
  /** 标识符：函数名 / 单元格引用形态 / 裸表名（含 $ 绝对引用写法）；TRUE/FALSE 由 parser 归约为布尔 */
  | { type: 'ident'; name: string }
  /** 带单引号的表名（'' 转义为字面单引号） */
  | { type: 'quoted-name'; name: string }
  /** 错误字面量（如 #DIV/0!，大小写不敏感） */
  | { type: 'error'; code: FormulaErrorCode }
  | { type: 'op'; op: FormulaOperator }

const NUMBER_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/

/** 标识符首字符：字母 / _ / $ / 非 ASCII（中文表名等） */
function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char) || char.charCodeAt(0) >= 0x80
}

/** 标识符后续字符：首字符集 + 数字 + . */
function isIdentPart(char: string): boolean {
  return /[A-Za-z0-9_.$]/.test(char) || char.charCodeAt(0) >= 0x80
}

const TWO_CHAR_OPS = ['<>', '<=', '>='] as const
const ONE_CHAR_OPS = [
  '+',
  '-',
  '*',
  '/',
  '^',
  '&',
  '%',
  '(',
  ')',
  ',',
  '!',
  ':',
  '=',
  '<',
  '>',
] as const

// 长的错误码在前，避免前缀误匹配（如 #N/A 与 #NAME? 无公共前缀，此处为防御性排序）
const ERROR_LITERALS = [...FORMULA_ERROR_CODES].sort((a, b) => b.length - a.length)

/** 匹配错误字面量（大小写不敏感）；命中返回错误码，未命中返回 null */
function matchErrorLiteral(text: string, at: number): FormulaErrorCode | null {
  const rest = text.slice(at).toUpperCase()
  for (const code of ERROR_LITERALS) {
    if (rest.startsWith(code)) {
      return code
    }
  }
  return null
}

/** 公式文本（不含 '='）→ token 序列；非法输入抛 FormulaParseError */
export function tokenizeFormula(text: string): FormulaToken[] {
  const tokens: FormulaToken[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    // 空白忽略（不支持 Excel 的空格交集运算符）
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index++
      continue
    }
    // 错误字面量（#DIV/0! 等）
    if (char === '#') {
      const code = matchErrorLiteral(text, index)
      if (!code) {
        throw new FormulaParseError(`无法识别的错误字面量（位置 ${index + 1}）`)
      }
      tokens.push({ type: 'error', code })
      index += code.length
      continue
    }
    // 数字
    if (
      (char >= '0' && char <= '9') ||
      (char === '.' && text[index + 1]! >= '0' && text[index + 1]! <= '9')
    ) {
      const match = NUMBER_RE.exec(text.slice(index))
      if (!match) {
        throw new FormulaParseError(`非法数字（位置 ${index + 1}）`)
      }
      tokens.push({ type: 'number', value: Number.parseFloat(match[0]), raw: match[0] })
      index += match[0].length
      continue
    }
    // 字符串字面量（"..."，"" 转义）
    if (char === '"') {
      let value = ''
      let end = index + 1
      for (;;) {
        if (end >= text.length) {
          throw new FormulaParseError('字符串缺少结束引号')
        }
        if (text[end] === '"') {
          if (text[end + 1] === '"') {
            value += '"'
            end += 2
            continue
          }
          break
        }
        value += text[end]
        end++
      }
      tokens.push({ type: 'string', value })
      index = end + 1
      continue
    }
    // 带引号表名（'...'，'' 转义）
    if (char === "'") {
      let name = ''
      let end = index + 1
      for (;;) {
        if (end >= text.length) {
          throw new FormulaParseError('表名缺少结束引号')
        }
        if (text[end] === "'") {
          if (text[end + 1] === "'") {
            name += "'"
            end += 2
            continue
          }
          break
        }
        name += text[end]
        end++
      }
      tokens.push({ type: 'quoted-name', name })
      index = end + 1
      continue
    }
    // 标识符（函数名 / 引用 / 裸表名）
    if (isIdentStart(char)) {
      let end = index + 1
      while (end < text.length && isIdentPart(text[end]!)) {
        end++
      }
      tokens.push({ type: 'ident', name: text.slice(index, end) })
      index = end
      continue
    }
    // 双字符运算符优先
    const two = text.slice(index, index + 2)
    if ((TWO_CHAR_OPS as readonly string[]).includes(two)) {
      tokens.push({ type: 'op', op: two as FormulaOperator })
      index += 2
      continue
    }
    if ((ONE_CHAR_OPS as readonly string[]).includes(char)) {
      tokens.push({ type: 'op', op: char as FormulaOperator })
      index++
      continue
    }
    throw new FormulaParseError(`无法识别的字符 "${char}"（位置 ${index + 1}）`)
  }
  return tokens
}
