// 查找与引用函数集：VLOOKUP / HLOOKUP / MATCH / INDEX / CHOOSE / ROW / COLUMN。
//
// 查找类函数不走「区域 → 稀疏数组」的参数形态（稀疏数组丢失位置信息），
// 而是按 lazy 参数的 AST 引用节点取区域几何：
// - 精确匹配在持有 FormulaLookupCache 时按首列/首行懒构建哈希索引（O(N) 建表、O(1) 命中）；
// - 无缓存或近似匹配按流式/稀疏向量逐格读取，避免分配整列 O(N) 临时数组。

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
import {
  buildLookupVectorKey,
  type ExactLookupIndex,
  type FormulaLookupCache,
} from '../lookup-cache'
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

/** 补齐缺省表名（供 readSparseVector 路由当前公式所在表） */
function fillRefSheet(ref: RangeRef, sheet: string | undefined): RangeRef {
  return sheet === undefined || ref.sheet === sheet ? ref : { ...ref, sheet }
}

/** 查找向量长度 */
function vectorLength(ref: RangeRef, along: 'column' | 'row'): number {
  return along === 'column' ? ref.endRow - ref.startRow + 1 : ref.endCol - ref.startCol + 1
}

/** 按 0 基偏移读取查找向量的单格值（空格为 null） */
function readVectorCell(
  ctx: FormulaEvalContext,
  sheet: string | undefined,
  ref: RangeRef,
  along: 'column' | 'row',
  offset: number,
): ScalarValue | FormulaError {
  return along === 'column'
    ? ctx.readCell(cellAt(sheet, ref.startCol, ref.startRow + offset))
    : ctx.readCell(cellAt(sheet, ref.startCol + offset, ref.startRow))
}

/** Excel 通配符判断（* 任意串 / ? 单字符 / ~ 转义符） */
const HAS_WILDCARD_RE = /[*?~]/
const REGEXP_SPECIAL_RE = /[.*+?^${}()|[\]\\]/g

/** 将 Excel 大小写不敏感通配符模式编译为匹配大写候选文本的正则 */
function compileWildcardRegex(pattern: string): RegExp {
  const upper = pattern.toUpperCase()
  let source = '^'
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i]!
    if (ch === '~' && i + 1 < upper.length) {
      source += upper[++i]!.replace(REGEXP_SPECIAL_RE, '\\$&')
    } else if (ch === '*') {
      source += '[\\s\\S]*'
    } else if (ch === '?') {
      source += '[\\s\\S]'
    } else {
      source += ch.replace(REGEXP_SPECIAL_RE, '\\$&')
    }
  }
  source += '$'
  return new RegExp(source)
}

/** 构造无缓存场景的精确匹配谓词（严守类型区分与文本大小写不敏感） */
function createExactPredicate(
  key: Exclude<ScalarValue, null>,
  isWildcard: boolean,
): (candidate: ScalarValue) => boolean {
  if (isWildcard && typeof key === 'string') {
    const regex = compileWildcardRegex(key)
    return (candidate) => typeof candidate === 'string' && regex.test(candidate.toUpperCase())
  }
  if (typeof key === 'string') {
    const upper = key.toUpperCase()
    return (candidate) => typeof candidate === 'string' && candidate.toUpperCase() === upper
  }
  return (candidate) => typeof candidate === typeof key && candidate === key
}

/** 懒构建并缓存首列/首行的精确查找索引（首次出现优先） */
function getOrBuildExactIndex(
  cache: FormulaLookupCache,
  ctx: FormulaEvalContext,
  sheet: string | undefined,
  ref: RangeRef,
  along: 'column' | 'row',
): ExactLookupIndex {
  const cacheKey = buildLookupVectorKey(sheet, ref, along)
  const cached = cache.getExactIndex(cacheKey)
  if (cached !== undefined) {
    return cached
  }
  const map = new Map<string | number | boolean, number>()
  let error: FormulaError | undefined
  const record = (offset: number, value: ScalarValue | FormulaError): boolean => {
    if (isFormulaError(value)) {
      error = value
      return false
    }
    if (value === null) {
      return true
    }
    const normalized = typeof value === 'string' ? value.toUpperCase() : value
    if (!map.has(normalized)) {
      map.set(normalized, offset)
    }
    return true
  }

  const sparse = ctx.readSparseVector?.(fillRefSheet(ref, sheet), along)
  if (sparse !== undefined) {
    for (const [offset, value] of sparse) {
      if (!record(offset, value)) {
        break
      }
    }
  } else {
    const length = vectorLength(ref, along)
    for (let offset = 0; offset < length; offset++) {
      if (!record(offset, readVectorCell(ctx, sheet, ref, along, offset))) {
        break
      }
    }
  }

  const index: ExactLookupIndex = error ? { map, error } : { map }
  cache.setExactIndex(cacheKey, index)
  return index
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

/** 精确匹配（支持批内哈希缓存、通配符与流式早停）：返回 0 基下标，未命中 -1，遇错误传播 */
function findExactMatch(
  ctx: FormulaEvalContext,
  sheet: string | undefined,
  ref: RangeRef,
  along: 'column' | 'row',
  key: ScalarValue,
): number | FormulaError {
  if (key === null) {
    return -1
  }
  const isWildcard = typeof key === 'string' && HAS_WILDCARD_RE.test(key)
  if (ctx.lookupCache) {
    const index = getOrBuildExactIndex(ctx.lookupCache, ctx, sheet, ref, along)
    if (isWildcard) {
      const regex = compileWildcardRegex(key)
      for (const [candidate, offset] of index.map) {
        if (typeof candidate === 'string' && regex.test(candidate)) {
          return offset
        }
      }
      return index.error ?? -1
    }
    const normalized = typeof key === 'string' ? key.toUpperCase() : key
    const hit = index.map.get(normalized)
    if (hit !== undefined) {
      return hit
    }
    return index.error ?? -1
  }

  const matches = createExactPredicate(key, isWildcard)
  const sparse = ctx.readSparseVector?.(fillRefSheet(ref, sheet), along)
  if (sparse !== undefined) {
    for (const [offset, value] of sparse) {
      if (isFormulaError(value)) {
        return value
      }
      if (matches(value)) {
        return offset
      }
    }
    return -1
  }
  const length = vectorLength(ref, along)
  for (let offset = 0; offset < length; offset++) {
    const value = readVectorCell(ctx, sheet, ref, along, offset)
    if (isFormulaError(value)) {
      return value
    }
    if (matches(value)) {
      return offset
    }
  }
  return -1
}

/**
 * 近似匹配（流式/稀疏读取，零向量拷贝）：
 * - descending=false（升序）：≤ key 的最大项 0 基下标（遇首个大于项即停）；
 * - descending=true（降序）：≥ key 的最小项 0 基下标（遇首个小于项即停）。
 */
function findApproximateMatch(
  ctx: FormulaEvalContext,
  sheet: string | undefined,
  ref: RangeRef,
  along: 'column' | 'row',
  key: ScalarValue,
  descending: boolean,
): number | FormulaError {
  const stopSign = descending ? -1 : 1
  let best = -1
  const sparse = ctx.readSparseVector?.(fillRefSheet(ref, sheet), along)
  if (sparse !== undefined) {
    for (const [offset, value] of sparse) {
      if (isFormulaError(value)) {
        return value
      }
      const compared = compareForMatch(value, key)
      if (compared === null) {
        continue
      }
      if (compared === stopSign) {
        break
      }
      best = offset
    }
    return best
  }
  const length = vectorLength(ref, along)
  for (let offset = 0; offset < length; offset++) {
    const value = readVectorCell(ctx, sheet, ref, along, offset)
    if (isFormulaError(value)) {
      return value
    }
    const compared = compareForMatch(value, key)
    if (compared === null) {
      continue
    }
    if (compared === stopSign) {
      break
    }
    best = offset
  }
  return best
}

/** VLOOKUP / HLOOKUP 共用：沿 along 方向匹配首列 / 首行，取第 index 列 / 行（1 基）的值 */
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
  const sheet = table.sheet ?? ctx.currentSheet
  // 空查找值按 0 参与数值匹配（与引擎空格 → 0 的约定一致）
  const key = lookup === null ? 0 : lookup
  const matched = exact
    ? findExactMatch(ctx, sheet, ref, along, key)
    : findApproximateMatch(ctx, sheet, ref, along, key, false)
  if (isFormulaError(matched)) {
    return matched
  }
  if (matched < 0) {
    return formulaError('#N/A')
  }
  return along === 'column'
    ? ctx.readCell(cellAt(sheet, ref.startCol + index - 1, ref.startRow + matched))
    : ctx.readCell(cellAt(sheet, ref.startCol + matched, ref.startRow + index - 1))
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
    const along = rows > 1 ? 'column' : 'row'
    const sheet = arrayRef.sheet ?? ctx.currentSheet
    const key = lookup === null ? 0 : lookup
    const index =
      matchType === 0
        ? findExactMatch(ctx, sheet, arrayRef.ref, along, key)
        : findApproximateMatch(ctx, sheet, arrayRef.ref, along, key, matchType < 0)
    if (isFormulaError(index)) {
      return index
    }
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
