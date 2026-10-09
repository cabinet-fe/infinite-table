// 公式引用平移（行列插入/删除，Excel 语义）：token 级处理，只平移引用 token
// （含 `$` 绝对引用、跨表 `Sheet!A1` 前缀、区域 `A1:B2`），其余 token 原样保留——
// 数字精度、运算符、函数名等公式文本不被规范化。引用识别与格式化复用
// tokenizer / address（tokenizeFormula + parseCellRef + formatCellRef），不另设词法与地址工具。
//
// 平移规则（以行为例，列对称）：
// - 插入 at, count：start >= at → 整体后移 count；start < at <= end → 区域扩展；
// - 删除 [at, at+count)：end < at → 不动；start >= at+count → 整体前移 count；
//   相交 → 按保留量裁剪（区域收缩）；保留 0 / 单格被删 → broken（#REF!）。
// - 绝对引用：`A$1`（行绝对）不随行平移，`$A1`（列绝对）不随列平移；
//   区域起点绝对时整区域不随该轴移动（Excel 行为）。

import { formatCellRef, formatSheetName, parseCellRef, type CellRef } from './address'
import { FormulaParseError, tokenizeFormula, tokenText, type FormulaToken } from './tokenizer'

/** 公式平移结果 */
export interface FormulaShiftResult {
  /** 平移后的公式文本（broken 时被删引用以 `#REF!` 占位，由调用方决定落库策略） */
  text: string
  /** 存在被删除区间覆盖的引用（需转 #REF!） */
  broken: boolean
}

/** 平移后的引用区间（0 基闭区间坐标；broken 时保留原区间） */
export interface ShiftedRange {
  start: CellCoord
  end: CellCoord
  broken: boolean
}

/** 裸坐标（0 基）；CellRef 结构兼容，可直接传入 */
interface CellCoord {
  row: number
  col: number
}

/** 平移单轴区间 [min, max]（单格 = min === max；abs 时该轴整体不动） */
function shiftInterval(
  min: number,
  max: number,
  at: number,
  count: number,
  mode: 'insert' | 'delete',
  abs: boolean,
): { start: number; end: number; broken: boolean } {
  if (abs) return { start: min, end: max, broken: false }
  if (mode === 'insert') {
    if (min >= at) return { start: min + count, end: max + count, broken: false }
    if (max >= at) return { start: min, end: max + count, broken: false }
    return { start: min, end: max, broken: false }
  }
  if (max < at) return { start: min, end: max, broken: false }
  if (min >= at + count) return { start: min - count, end: max - count, broken: false }
  // 相交：按区间外保留量裁剪；单格落在删除区间内时保留量为 0 → broken
  const above = Math.max(0, Math.min(max, at - 1) - min + 1)
  const below = Math.max(0, max - Math.max(min, at + count) + 1)
  const kept = above + below
  if (kept <= 0) return { start: min, end: max, broken: true }
  const start = min < at ? min : at
  return { start, end: start + kept - 1, broken: false }
}

/**
 * 平移一个引用（单格 = start === end，两角点先规范化）。
 * 绝对标记取 absRef（一般是起始引用）：`A$1` 行绝对不随行平移、`$A1` 列绝对不随列平移；
 * 区域起点绝对时整区域不随该轴移动（Excel 行为）。
 */
export function shiftRange(
  start: CellCoord,
  end: CellCoord,
  axis: 'rows' | 'cols',
  at: number,
  count: number,
  mode: 'insert' | 'delete',
  absRef?: CellRef,
): ShiftedRange {
  const min = { row: Math.min(start.row, end.row), col: Math.min(start.col, end.col) }
  const max = { row: Math.max(start.row, end.row), col: Math.max(start.col, end.col) }
  if (axis === 'rows') {
    const shifted = shiftInterval(min.row, max.row, at, count, mode, absRef?.rowAbsolute ?? false)
    return {
      start: { row: shifted.start, col: min.col },
      end: { row: shifted.end, col: max.col },
      broken: shifted.broken,
    }
  }
  const shifted = shiftInterval(min.col, max.col, at, count, mode, absRef?.colAbsolute ?? false)
  return {
    start: { row: min.row, col: shifted.start },
    end: { row: max.row, col: shifted.end },
    broken: shifted.broken,
  }
}

/** 按原引用的绝对标记格式化平移后坐标 */
function formatShifted(ref: CellRef, addr: CellCoord): string {
  return formatCellRef({
    row: addr.row,
    col: addr.col,
    colAbsolute: ref.colAbsolute,
    rowAbsolute: ref.rowAbsolute,
  })
}

/** 平移公式文本中的全部引用；解析失败时原样返回（broken=false） */
export function shiftFormulaText(
  formula: string,
  axis: 'rows' | 'cols',
  at: number,
  count: number,
  mode: 'insert' | 'delete',
): FormulaShiftResult {
  let tokens: FormulaToken[]
  try {
    tokens = tokenizeFormula(formula)
  } catch (error) {
    if (error instanceof FormulaParseError) return { text: formula, broken: false }
    throw error
  }

  const out: string[] = []
  let broken = false
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]!
    // 跨表前缀：ident / quoted-name + '!'
    let sheet: string | null = null
    let j = i
    if (tok.type === 'ident' || tok.type === 'quoted-name') {
      const bang = tokens[j + 1]
      if (bang?.type === 'op' && bang.op === '!') {
        sheet = tok.name
        j += 2
      }
    }
    const refTok = tokens[j]
    const startRef = refTok?.type === 'ident' ? parseCellRef(refTok.name) : null
    // 引用形态后紧跟 '(' → 函数名（如 LOG10(），不平移
    const after = tokens[j + 1]
    const isFunctionName = after?.type === 'op' && after.op === '('
    if (startRef === null || isFunctionName) {
      // 原样输出（含跨表前缀：无引用时前缀是函数名/表名的一部分）
      if (sheet !== null && j > i) {
        out.push(formatSheetName(sheet), '!')
        i = j
      } else {
        out.push(tokenText(tok))
        i++
      }
      continue
    }
    // 区域终点（A1:B2 的 B2；尾巴非法时按单格处理，`:` 留给后续 token）
    let endRef: CellRef | null = null
    let k = j + 1
    const colon = tokens[k]
    const endTok = tokens[k + 1]
    if (colon?.type === 'op' && colon.op === ':' && endTok?.type === 'ident') {
      endRef = parseCellRef(endTok.name)
      if (endRef) k += 2
    }
    const shifted = shiftRange(startRef, endRef ?? startRef, axis, at, count, mode, startRef)
    if (shifted.broken) broken = true
    if (sheet !== null) out.push(formatSheetName(sheet), '!')
    if (shifted.broken) {
      out.push('#REF!')
    } else {
      out.push(formatShifted(startRef, shifted.start))
      if (endRef) out.push(':', formatShifted(endRef, shifted.end))
    }
    i = k
  }
  return { text: out.join(''), broken }
}
