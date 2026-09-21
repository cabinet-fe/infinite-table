// 容错引用扫描器：供公式编辑染色框用。输入可以是编辑中的半截公式（含/不含前导 `=`），永不抛错。
// 消歧规则对齐 tokenizer/parser：
// - ident 字符集同 tokenizer（首字符 字母/_/$/非 ASCII；后续加 数字/.），贪婪读取（A1B 整体不是引用）；
// - ident 后随 `(` → 函数名跳过（LOG10( 不是引用）；后随 `!` → 表名前缀；匹配单元格形态 → 引用；
// - 引号表名 '...'（'' 转义）+ `!` 前缀；字符串字面量 "..."（"" 转义）内不扫描；错误字面量跳过。
// 与 parser 的差异是容错：未闭合的字符串/引号表名/区域尾巴不抛错，退化为「扫到多少算多少」。

import { createRangeRef, parseCellRef, type CellRef, type RangeRef } from './address'
import { FORMULA_ERROR_CODES } from './errors'

/** 扫描到的引用：ref 为解析结果；start/end 为原文本字符偏移（end 排他），span 含表名前缀 */
export interface ScannedReference {
  ref: CellRef | RangeRef
  isRange: boolean
  start: number
  end: number
}

/** 与 parser 一致的单元格形态（列限 1-3 字母；再交 parseCellRef 产出坐标） */
const CELL_REF_RE = /^\$?[A-Za-z]{1,3}\$?[1-9]\d*$/

/** 与 tokenizer 相同的数字形态：避免把 1E5 的 E5 误判为引用 */
const NUMBER_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/

// 长的错误码在前，避免前缀误匹配（同 tokenizer）
const ERROR_LITERALS = [...FORMULA_ERROR_CODES].sort((a, b) => b.length - a.length)

function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char) || char.charCodeAt(0) >= 0x80
}

function isIdentPart(char: string): boolean {
  return /[A-Za-z0-9_.$]/.test(char) || char.charCodeAt(0) >= 0x80
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/** 跳过空白，返回下一个非空白位置 */
function skipWhitespace(text: string, at: number): number {
  let index = at
  while (index < text.length && isWhitespace(text[index]!)) {
    index++
  }
  return index
}

/** 读取 ident（起始字符已确认）；返回 [name, end) */
function readIdent(text: string, start: number): [string, number] {
  let end = start + 1
  while (end < text.length && isIdentPart(text[end]!)) {
    end++
  }
  return [text.slice(start, end), end]
}

/** 跳过字符串字面量（"..."，"" 转义）；未闭合 → 跳到文本末尾。返回结束后的位置 */
function skipString(text: string, start: number): number {
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '"') {
      if (text[index + 1] === '"') {
        index += 2
        continue
      }
      return index + 1
    }
    index++
  }
  return text.length
}

/** 跳过错误字面量（#DIV/0! 等，大小写不敏感）；无法识别 → 只跳过 '#'。返回结束后的位置 */
function skipErrorLiteral(text: string, start: number): number {
  const rest = text.slice(start).toUpperCase()
  for (const code of ERROR_LITERALS) {
    if (rest.startsWith(code)) {
      return start + code.length
    }
  }
  return start + 1
}

/**
 * 扫描公式文本中的单元格/区域引用（容错，永不抛错）。
 * 表名前缀计入 span（染色框需要覆盖整段 `Sheet2!A1`）；
 * `A1:` 尾巴非法时退化只报 A1（`:` 留给后续扫描当普通字符）。
 */
export function scanFormulaReferences(text: string): ScannedReference[] {
  const refs: ScannedReference[] = []
  let index = text.startsWith('=') ? 1 : 0
  /** 待消费的表名前缀（裸表名或引号表名 + `!` 已读到）；start 用于把前缀计入 span */
  let pendingSheet: { name: string; start: number } | null = null

  while (index < text.length) {
    const char = text[index]!

    if (isWhitespace(char)) {
      index++
      continue
    }
    if (char === '"') {
      index = skipString(text, index)
      pendingSheet = null
      continue
    }
    if (char === '#') {
      index = skipErrorLiteral(text, index)
      pendingSheet = null
      continue
    }
    // 数字（含科学计数）：防止 1E5 留下 E5 假引用
    if (
      (char >= '0' && char <= '9') ||
      (char === '.' && text[index + 1]! >= '0' && text[index + 1]! <= '9')
    ) {
      const match = NUMBER_RE.exec(text.slice(index))
      index += match ? match[0].length : 1
      pendingSheet = null
      continue
    }
    // 引号表名（'...'，'' 转义）：仅当后随 `!` 才作前缀；未闭合 → 扫到末尾
    if (char === "'") {
      const quoteStart = index
      let name = ''
      let end = index + 1
      let closed = false
      while (end < text.length) {
        if (text[end] === "'") {
          if (text[end + 1] === "'") {
            name += "'"
            end += 2
            continue
          }
          closed = true
          break
        }
        name += text[end]
        end++
      }
      if (!closed) {
        break
      }
      const after = skipWhitespace(text, end + 1)
      if (text[after] === '!') {
        pendingSheet = { name, start: quoteStart }
        index = after + 1
      } else {
        pendingSheet = null
        index = end + 1
      }
      continue
    }
    if (isIdentStart(char)) {
      const start = index
      const [ident, end] = readIdent(text, start)
      const after = skipWhitespace(text, end)
      // 函数名（后随 `(`）跳过——LOG10( 形态优先于单元格形态
      if (text[after] === '(') {
        pendingSheet = null
        index = end
        continue
      }
      // 表名前缀（后随 `!`）
      if (text[after] === '!') {
        pendingSheet = { name: ident, start }
        index = after + 1
        continue
      }
      if (CELL_REF_RE.test(ident)) {
        // CELL_REF_RE 是 parseCellRef 形态的子集，解析不会失败
        const ref = parseCellRef(ident)!
        const refStart = pendingSheet?.start ?? start
        if (pendingSheet) {
          ref.sheet = pendingSheet.name
        }
        // 区域尾巴 `:B2`；尾巴非法时退化只报 A1，`:` 留给后续扫描
        if (text[after] === ':') {
          const tailStart = skipWhitespace(text, after + 1)
          if (tailStart < text.length && isIdentStart(text[tailStart]!)) {
            const [tailIdent, tailEnd] = readIdent(text, tailStart)
            const tailRef = CELL_REF_RE.test(tailIdent) ? parseCellRef(tailIdent) : null
            if (tailRef) {
              refs.push({
                ref: createRangeRef(ref, tailRef),
                isRange: true,
                start: refStart,
                end: tailEnd,
              })
              pendingSheet = null
              index = tailEnd
              continue
            }
          }
        }
        refs.push({ ref, isRange: false, start: refStart, end })
        pendingSheet = null
        index = end
        continue
      }
      // 其它 ident：函数名缺括号 / 未知名称 / TRUE/FALSE 等，跳过
      pendingSheet = null
      index = end
      continue
    }
    // 运算符与其余字符
    pendingSheet = null
    index++
  }
  return refs
}
