// 统计函数集：AVERAGE / MAX / MIN / COUNT / COUNTA / COUNTIF / COUNTBLANK / MEDIAN / LARGE / SMALL / RANK。

import { $n } from '@cat-kit/core'

import { formulaError, isFormulaError } from '../errors'
import { coerceToNumber, type EvalValue } from '../evaluator'
import { collectNumbers, flattenArgs, parseCriteria, plusAll } from './internal'
import { registerFormulaFunction } from './registry'

registerFormulaFunction('AVERAGE', {
  minArgs: 1,
  meta: {
    params: [{ name: 'number1' }, { name: 'number2', optional: true }, { name: '...' }],
    description: '求参数的平均值',
    category: '常用',
  },
  impl(args) {
    const numbers = collectNumbers(args)
    if (isFormulaError(numbers)) {
      return numbers
    }
    if (numbers.length === 0) {
      return formulaError('#DIV/0!')
    }
    return $n.div(plusAll(numbers), numbers.length)
  },
})

registerFormulaFunction('MAX', {
  minArgs: 1,
  meta: {
    params: [{ name: 'number1' }, { name: 'number2', optional: true }, { name: '...' }],
    description: '返回参数中的最大值',
    category: '常用',
  },
  impl(args) {
    const numbers = collectNumbers(args)
    if (isFormulaError(numbers)) {
      return numbers
    }
    if (numbers.length === 0) {
      return 0
    }
    // for 循环比较：Math.max(...spread) 对超大区域（实参 > ~6.5 万）会 RangeError 爆栈
    let max = numbers[0]!
    for (let index = 1; index < numbers.length; index++) {
      if (numbers[index]! > max) {
        max = numbers[index]!
      }
    }
    return max
  },
})

registerFormulaFunction('MIN', {
  minArgs: 1,
  meta: {
    params: [{ name: 'number1' }, { name: 'number2', optional: true }, { name: '...' }],
    description: '返回参数中的最小值',
    category: '常用',
  },
  impl(args) {
    const numbers = collectNumbers(args)
    if (isFormulaError(numbers)) {
      return numbers
    }
    if (numbers.length === 0) {
      return 0
    }
    let min = numbers[0]!
    for (let index = 1; index < numbers.length; index++) {
      if (numbers[index]! < min) {
        min = numbers[index]!
      }
    }
    return min
  },
})

registerFormulaFunction('COUNT', {
  minArgs: 1,
  meta: {
    params: [{ name: 'value1' }, { name: 'value2', optional: true }, { name: '...' }],
    description: '计算参数中数字的个数',
    category: '常用',
  },
  impl(args) {
    let count = 0
    for (const { value, fromRange } of flattenArgs(args)) {
      if (isFormulaError(value)) {
        return value
      }
      if (fromRange) {
        if (typeof value === 'number') {
          count++
        }
        continue
      }
      // 直接参数：可强转为数字即计数（含 TRUE/FALSE、数字文本）
      if (!isFormulaError(coerceToNumber(value))) {
        count++
      }
    }
    return count
  },
})

registerFormulaFunction('COUNTA', {
  minArgs: 1,
  meta: {
    params: [{ name: 'value1' }, { name: 'value2', optional: true }, { name: '...' }],
    description: '计算参数中非空值的个数',
    category: '统计',
  },
  impl(args) {
    let count = 0
    for (const { value, fromRange } of flattenArgs(args)) {
      // 直接错误参数传播；区域内的错误格照常计数
      if (!fromRange && isFormulaError(value)) {
        return value
      }
      if (value === null) {
        continue
      }
      count++
    }
    return count
  },
})

registerFormulaFunction('COUNTIF', {
  minArgs: 2,
  maxArgs: 2,
  meta: {
    params: [{ name: 'range' }, { name: 'criteria' }],
    description: '统计区域内满足条件的单元格个数',
    category: '统计',
  },
  impl(args) {
    const criteria = args[1]!
    if (Array.isArray(criteria)) {
      return formulaError('#VALUE!')
    }
    if (isFormulaError(criteria)) {
      return criteria
    }
    const matches = parseCriteria(criteria)
    let count = 0
    for (const { value, fromRange } of flattenArgs([args[0]!])) {
      // 直接错误参数传播；区域内的错误格不参与计数
      if (isFormulaError(value)) {
        if (!fromRange) {
          return value
        }
        continue
      }
      if (matches(value)) {
        count++
      }
    }
    return count
  },
})

registerFormulaFunction('COUNTBLANK', {
  kind: 'lazy',
  minArgs: 1,
  maxArgs: 1,
  meta: {
    params: [{ name: 'range' }],
    description: '统计区域内空白单元格的个数',
    category: '统计',
  },
  impl(nodes, evalNode) {
    const node = nodes[0]!
    // 区域引用求值只含稀疏存在的格，空白数须按引用节点的几何边界推算
    let total: number
    if (node.kind === 'range') {
      const { ref } = node
      total = (ref.endRow - ref.startRow + 1) * (ref.endCol - ref.startCol + 1)
    } else if (node.kind === 'cell') {
      total = 1
    } else {
      return formulaError('#VALUE!')
    }
    const value = evalNode(node)
    if (isFormulaError(value)) {
      return value
    }
    let nonBlank = 0
    for (const cell of Array.isArray(value) ? value : [value]) {
      // 错误格与空串结果均非空白
      if (isFormulaError(cell) || (cell !== null && cell !== '')) {
        nonBlank++
      }
    }
    return total - nonBlank
  },
})

registerFormulaFunction('MEDIAN', {
  minArgs: 1,
  meta: {
    params: [{ name: 'number1' }, { name: 'number2', optional: true }, { name: '...' }],
    description: '返回参数的中位数',
    category: '统计',
  },
  impl(args) {
    const numbers = collectNumbers(args)
    if (isFormulaError(numbers)) {
      return numbers
    }
    if (numbers.length === 0) {
      return formulaError('#VALUE!')
    }
    const sorted = [...numbers].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    // 偶数个取中间两数均值（$n 避免浮点误差）
    return sorted.length % 2 ? sorted[mid]! : $n.div($n.plus(sorted[mid - 1]!, sorted[mid]!), 2)
  },
})

/** LARGE / SMALL 共用：第 k 个极值；k 越界（含空集）→ #VALUE! */
function kthExtreme(args: EvalValue[], smallest: boolean): EvalValue {
  const k = coerceToNumber(args[1]!)
  if (isFormulaError(k)) {
    return k
  }
  const numbers = collectNumbers([args[0]!])
  if (isFormulaError(numbers)) {
    return numbers
  }
  const rank = Math.trunc(k)
  if (rank < 1 || rank > numbers.length) {
    return formulaError('#VALUE!')
  }
  const sorted = [...numbers].sort((a, b) => (smallest ? a - b : b - a))
  return sorted[rank - 1]!
}

registerFormulaFunction('LARGE', {
  minArgs: 2,
  maxArgs: 2,
  meta: {
    params: [{ name: 'array' }, { name: 'k' }],
    description: '返回数据集中第 k 个最大值',
    category: '统计',
  },
  impl(args) {
    return kthExtreme(args, false)
  },
})

registerFormulaFunction('SMALL', {
  minArgs: 2,
  maxArgs: 2,
  meta: {
    params: [{ name: 'array' }, { name: 'k' }],
    description: '返回数据集中第 k 个最小值',
    category: '统计',
  },
  impl(args) {
    return kthExtreme(args, true)
  },
})

registerFormulaFunction('RANK', {
  minArgs: 2,
  maxArgs: 3,
  meta: {
    params: [{ name: 'number' }, { name: 'ref' }, { name: 'order', optional: true }],
    description: '返回数字在数据集中的名次',
    category: '统计',
  },
  impl(args) {
    const target = coerceToNumber(args[0]!)
    if (isFormulaError(target)) {
      return target
    }
    const numbers = collectNumbers([args[1]!])
    if (isFormulaError(numbers)) {
      return numbers
    }
    let descending = true
    if (args[2] !== undefined) {
      const order = coerceToNumber(args[2])
      if (isFormulaError(order)) {
        return order
      }
      descending = order === 0
    }
    if (!numbers.includes(target)) {
      return formulaError('#N/A')
    }
    // 同值同名次（竞赛排名）：名次 = 1 + 更大（降序）/ 更小（升序）值的个数
    let rank = 1
    for (const num of numbers) {
      if (descending ? num > target : num < target) {
        rank++
      }
    }
    return rank
  },
})
