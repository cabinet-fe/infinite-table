// 查找与引用函数集：VLOOKUP / HLOOKUP / MATCH / INDEX / CHOOSE / ROW / COLUMN。
//
// 查找类函数不走「区域 → 稀疏数组」的参数形态（稀疏数组丢失位置信息），
// 而是按 lazy 参数的 AST 引用节点取区域几何，经 ctx.readCell 逐格读取
// （空格为 null，错误传播）。

import type { AstNode } from '../ast'
import { formulaError, isFormulaError, type FormulaError } from '../errors'
import {
  coerceToBoolean,
  coerceToNumber,
  type EvalValue,
  type FormulaEvalContext,
  type ScalarValue,
} from '../evaluator'
import type { RangeRef } from '../address'
import { registerFormulaFunction } from './registry'

/** 引用参数（cell / range 节点）→ 目标区域（sheet 缺省保持 undefined，由 resolver 路由缺省表）；非引用节点 → null */
function referenceArg(node: AstNode): { sheet: string | undefined; ref: RangeRef } | null {
  if (node.kind === 'cell') {
    const { ref } = node
    return {
      sheet: ref.sheet,
      ref: { startCol: ref.col, startRow: ref.row, endCol: ref.col, endRow: ref.row },
    }
  }
  if (node.kind === 'range') {
    return { sheet: node.ref.sheet, ref: node.ref }
  }
  return null
}

/** 区域坐标 → 单格引用（供 ctx.readCell） */
function cellAt(sheet: string | undefined, col: number, row: number) {
  return { sheet, col, row, colAbsolute: false, rowAbsolute: false }
}

/** 读取区域首列（column）/ 首行（row）的一维向量，保留位置语义（空格为 null）；错误传播 */
function readVector(
  ctx: FormulaEvalContext,
  sheet: string | undefined,
  ref: RangeRef,
  along: 'column' | 'row',
): ScalarValue[] | FormulaError {
  const values: ScalarValue[] = []
  if (along === 'column') {
    for (let row = ref.startRow; row <= ref.endRow; row++) {
      const value = ctx.readCell(cellAt(sheet, ref.startCol, row))
      if (isFormulaError(value)) {
        return value
      }
      values.push(value)
    }
  } else {
    for (let col = ref.startCol; col <= ref.endCol; col++) {
      const value = ctx.readCell(cellAt(sheet, col, ref.startRow))
      if (isFormulaError(value)) {
        return value
      }
      values.push(value)
    }
  }
  return values
}

/** Excel 匹配比较：同类型按类型规则（文本大小写不敏感）；类型不同或含空格 → null（不参与匹配） */
function compareForMatch(left: ScalarValue, right: ScalarValue): number | null {
  if (left === null || right === null || typeof left !== typeof right) {
    return null
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left < right ? -1 : left > right ? 1 : 0
  }
  if (typeof left === 'string' && typeof right === 'string') {
    const a = left.toUpperCase()
    const b = right.toUpperCase()
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return left === right ? 0 : left ? 1 : -1
  }
  return null
}

/** 精确匹配：首个相等项的 0 基下标，未命中 -1 */
function exactMatchIndex(vector: readonly ScalarValue[], lookup: ScalarValue): number {
  for (let index = 0; index < vector.length; index++) {
    if (compareForMatch(vector[index]!, lookup) === 0) {
      return index
    }
  }
  return -1
}

/** 升序近似：≤ lookup 的最大项的 0 基下标（升序约定下遇首个大于项即停），未命中 -1 */
function ascendingMatchIndex(vector: readonly ScalarValue[], lookup: ScalarValue): number {
  let best = -1
  for (let index = 0; index < vector.length; index++) {
    const compared = compareForMatch(vector[index]!, lookup)
    if (compared === null) {
      continue
    }
    if (compared > 0) {
      break
    }
    best = index
  }
  return best
}

/** 降序近似：≥ lookup 的最小项的 0 基下标（降序约定下遇首个小于项即停），未命中 -1 */
function descendingMatchIndex(vector: readonly ScalarValue[], lookup: ScalarValue): number {
  let best = -1
  for (let index = 0; index < vector.length; index++) {
    const compared = compareForMatch(vector[index]!, lookup)
    if (compared === null) {
      continue
    }
    if (compared < 0) {
      break
    }
    best = index
  }
  return best
}

/** VLOOKUP / HLOOKUP 共用：沿 along 方向扫描首列 / 首行做匹配，取第 index 列 / 行（1 基）的值 */
function vectorLookup(
  nodes: AstNode[],
  evalNode: (node: AstNode) => EvalValue,
  ctx: FormulaEvalContext | undefined,
  along: 'column' | 'row',
): EvalValue {
  if (!ctx) {
    return formulaError('#VALUE!')
  }
  const lookup = evalNode(nodes[0]!)
  if (isFormulaError(lookup)) {
    return lookup
  }
  if (Array.isArray(lookup)) {
    return formulaError('#VALUE!')
  }
  const table = referenceArg(nodes[1]!)
  if (!table) {
    return formulaError('#VALUE!')
  }
  const indexArg = coerceToNumber(evalNode(nodes[2]!))
  if (isFormulaError(indexArg)) {
    return indexArg
  }
  let exact = false
  if (nodes[3]) {
    const flag = coerceToBoolean(evalNode(nodes[3]))
    if (isFormulaError(flag)) {
      return flag
    }
    exact = !flag
  }
  const { ref } = table
  const span = along === 'column' ? ref.endCol - ref.startCol + 1 : ref.endRow - ref.startRow + 1
  const index = Math.trunc(indexArg)
  if (index < 1) {
    return formulaError('#VALUE!')
  }
  if (index > span) {
    return formulaError('#REF!')
  }
  const vector = readVector(ctx, table.sheet, ref, along)
  if (isFormulaError(vector)) {
    return vector
  }
  // 空查找值按 0 参与数值匹配（与引擎空格 → 0 的约定一致）
  const key = lookup === null ? 0 : lookup
  const matched = exact ? exactMatchIndex(vector, key) : ascendingMatchIndex(vector, key)
  if (matched < 0) {
    return formulaError('#N/A')
  }
  return along === 'column'
    ? ctx.readCell(cellAt(table.sheet, ref.startCol + index - 1, ref.startRow + matched))
    : ctx.readCell(cellAt(table.sheet, ref.startCol + matched, ref.startRow + index - 1))
}

registerFormulaFunction('VLOOKUP', {
  kind: 'lazy',
  minArgs: 3,
  maxArgs: 4,
  meta: {
    params: [
      { name: 'lookup_value' },
      { name: 'table_array' },
      { name: 'col_index_num' },
      { name: 'range_lookup', optional: true },
    ],
    description: '按首列匹配查找值，返回区域内对应行的指定列的值',
    category: '查找与引用',
  },
  impl: (nodes, evalNode, ctx) => vectorLookup(nodes, evalNode, ctx, 'column'),
})

registerFormulaFunction('HLOOKUP', {
  kind: 'lazy',
  minArgs: 3,
  maxArgs: 4,
  meta: {
    params: [
      { name: 'lookup_value' },
      { name: 'table_array' },
      { name: 'row_index_num' },
      { name: 'range_lookup', optional: true },
    ],
    description: '按首行匹配查找值，返回区域内对应列的指定行的值',
    category: '查找与引用',
  },
  impl: (nodes, evalNode, ctx) => vectorLookup(nodes, evalNode, ctx, 'row'),
})

registerFormulaFunction('MATCH', {
  kind: 'lazy',
  minArgs: 2,
  maxArgs: 3,
  meta: {
    params: [
      { name: 'lookup_value' },
      { name: 'lookup_array' },
      { name: 'match_type', optional: true },
    ],
    description: '在一维区域中查找值，返回 1 基相对位置',
    category: '查找与引用',
  },
  impl(nodes, evalNode, ctx) {
    if (!ctx) {
      return formulaError('#VALUE!')
    }
    const lookup = evalNode(nodes[0]!)
    if (isFormulaError(lookup)) {
      return lookup
    }
    if (Array.isArray(lookup)) {
      return formulaError('#VALUE!')
    }
    const arrayRef = referenceArg(nodes[1]!)
    if (!arrayRef) {
      return formulaError('#VALUE!')
    }
    let matchType = 1
    if (nodes[2]) {
      const typeArg = coerceToNumber(evalNode(nodes[2]))
      if (isFormulaError(typeArg)) {
        return typeArg
      }
      matchType = Math.trunc(typeArg)
    }
    const rows = arrayRef.ref.endRow - arrayRef.ref.startRow + 1
    const cols = arrayRef.ref.endCol - arrayRef.ref.startCol + 1
    // 查找区域必须是一维（单行或单列）
    if (rows > 1 && cols > 1) {
      return formulaError('#N/A')
    }
    const vector = readVector(ctx, arrayRef.sheet, arrayRef.ref, rows > 1 ? 'column' : 'row')
    if (isFormulaError(vector)) {
      return vector
    }
    const key = lookup === null ? 0 : lookup
    const index =
      matchType === 0
        ? exactMatchIndex(vector, key)
        : matchType > 0
          ? ascendingMatchIndex(vector, key)
          : descendingMatchIndex(vector, key)
    if (index < 0) {
      return formulaError('#N/A')
    }
    return index + 1
  },
})

registerFormulaFunction('INDEX', {
  kind: 'lazy',
  minArgs: 2,
  maxArgs: 3,
  meta: {
    params: [{ name: 'array' }, { name: 'row_num' }, { name: 'column_num', optional: true }],
    description: '按 1 基行 / 列序号取区域中的值',
    category: '查找与引用',
  },
  impl(nodes, evalNode, ctx) {
    if (!ctx) {
      return formulaError('#VALUE!')
    }
    const target = referenceArg(nodes[0]!)
    if (!target) {
      return formulaError('#VALUE!')
    }
    const rowArg = coerceToNumber(evalNode(nodes[1]!))
    if (isFormulaError(rowArg)) {
      return rowArg
    }
    const rowNum = Math.trunc(rowArg)
    let colNum = 1
    let colGiven = false
    if (nodes[2]) {
      const colArg = coerceToNumber(evalNode(nodes[2]))
      if (isFormulaError(colArg)) {
        return colArg
      }
      colNum = Math.trunc(colArg)
      colGiven = true
    }
    const rows = target.ref.endRow - target.ref.startRow + 1
    const cols = target.ref.endCol - target.ref.startCol + 1
    let row = rowNum
    if (!colGiven) {
      // 单行区域省略列序号时 row_num 实为列序号（Excel 语义）；其余省略取首列
      if (rows === 1 && cols > 1) {
        row = 1
        colNum = rowNum
      } else {
        colNum = 1
      }
    }
    if (row < 1 || colNum < 1) {
      return formulaError('#VALUE!')
    }
    if (row > rows || colNum > cols) {
      return formulaError('#REF!')
    }
    return ctx.readCell(
      cellAt(target.sheet, target.ref.startCol + colNum - 1, target.ref.startRow + row - 1),
    )
  },
})

registerFormulaFunction('CHOOSE', {
  kind: 'lazy',
  minArgs: 2,
  meta: {
    params: [
      { name: 'index_num' },
      { name: 'value1' },
      { name: 'value2', optional: true },
      { name: '...' },
    ],
    description: '按 1 基序号返回第 n 个参数的值',
    category: '查找与引用',
  },
  impl(nodes, evalNode) {
    const indexArg = coerceToNumber(evalNode(nodes[0]!))
    if (isFormulaError(indexArg)) {
      return indexArg
    }
    const index = Math.trunc(indexArg)
    if (index < 1 || index > nodes.length - 1) {
      return formulaError('#VALUE!')
    }
    // 只求值被选中的参数（未选参数的副作用 / 错误不产生，Excel 短路语义）
    return evalNode(nodes[index]!)
  },
})

registerFormulaFunction('ROW', {
  kind: 'lazy',
  minArgs: 0,
  maxArgs: 1,
  meta: {
    params: [{ name: 'reference', optional: true }],
    description: '返回引用起始格的行号（省略时取公式所在行，1 基）',
    category: '查找与引用',
  },
  impl(nodes, _evalNode, ctx) {
    if (!ctx) {
      return formulaError('#VALUE!')
    }
    if (nodes.length === 0) {
      return ctx.currentCell.row + 1
    }
    const target = referenceArg(nodes[0]!)
    if (!target) {
      return formulaError('#VALUE!')
    }
    return target.ref.startRow + 1
  },
})

registerFormulaFunction('COLUMN', {
  kind: 'lazy',
  minArgs: 0,
  maxArgs: 1,
  meta: {
    params: [{ name: 'reference', optional: true }],
    description: '返回引用起始格的列号（省略时取公式所在列，1 基）',
    category: '查找与引用',
  },
  impl(nodes, _evalNode, ctx) {
    if (!ctx) {
      return formulaError('#VALUE!')
    }
    if (nodes.length === 0) {
      return ctx.currentCell.col + 1
    }
    const target = referenceArg(nodes[0]!)
    if (!target) {
      return formulaError('#VALUE!')
    }
    return target.ref.startCol + 1
  },
})
