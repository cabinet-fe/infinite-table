// 公式词法原语（包内共享）：单元格引用形态 / 数字形态 / ident 字符集 / 错误字面量匹配。
// tokenizer / parser / scan-refs 共同消费，消歧口径单一来源。

import { FORMULA_ERROR_CODES, type FormulaErrorCode } from './errors'

/** 单元格引用形态（列限 1-3 字母；合规 ident 交 parseCellRef 产出坐标） */
export const CELL_REF_RE = /^\$?[A-Za-z]{1,3}\$?[1-9]\d*$/

/** 数字字面量形态（含科学计数；scan-refs 借此避免把 1E5 的 E5 误判为引用） */
export const NUMBER_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/

/** 标识符首字符：字母 / _ / $ / 非 ASCII（中文表名等） */
export function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char) || char.charCodeAt(0) >= 0x80
}

/** 标识符后续字符：首字符集 + 数字 + . */
export function isIdentPart(char: string): boolean {
  return /[A-Za-z0-9_.$]/.test(char) || char.charCodeAt(0) >= 0x80
}

// 长的错误码在前，避免前缀误匹配（如 #N/A 与 #NAME? 无公共前缀，此处为防御性排序）
const ERROR_LITERALS = [...FORMULA_ERROR_CODES].sort((a, b) => b.length - a.length)

/** 匹配错误字面量（大小写不敏感）；命中返回错误码，未命中返回 null */
export function matchErrorLiteral(text: string, at: number): FormulaErrorCode | null {
  const rest = text.slice(at).toUpperCase()
  for (const code of ERROR_LITERALS) {
    if (rest.startsWith(code)) {
      return code
    }
  }
  return null
}
