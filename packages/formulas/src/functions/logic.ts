// 逻辑函数集：IF / AND / OR / NOT / XOR / IFERROR / TRUE / FALSE。
// IF 为 lazy（短路分支：未选分支的副作用/错误不产生）。

import { formulaError, isFormulaError } from '../errors'
import { coerceToBoolean } from '../evaluator'
import { collectBooleans } from './internal'
import { registerFormulaFunction } from './registry'

registerFormulaFunction('IF', {
  kind: 'lazy',
  minArgs: 2,
  maxArgs: 3,
  meta: {
    params: [
      { name: 'logical_test' },
      { name: 'value_if_true' },
      { name: 'value_if_false', optional: true },
    ],
    description: '按条件返回不同结果',
    category: '常用',
  },
  impl(nodes, evalNode) {
    const condition = coerceToBoolean(evalNode(nodes[0]!))
    if (isFormulaError(condition)) {
      return condition
    }
    if (condition) {
      return evalNode(nodes[1]!)
    }
    return nodes[2] ? evalNode(nodes[2]) : false
  },
})

registerFormulaFunction('AND', {
  minArgs: 1,
  meta: {
    params: [{ name: 'logical1' }, { name: 'logical2', optional: true }, { name: '...' }],
    description: '全部为真时返回 TRUE',
    category: '常用',
  },
  impl(args) {
    const booleans = collectBooleans(args)
    if (isFormulaError(booleans)) {
      return booleans
    }
    if (booleans.length === 0) {
      return formulaError('#VALUE!')
    }
    return booleans.every(Boolean)
  },
})

registerFormulaFunction('OR', {
  minArgs: 1,
  meta: {
    params: [{ name: 'logical1' }, { name: 'logical2', optional: true }, { name: '...' }],
    description: '任一为真时返回 TRUE',
    category: '常用',
  },
  impl(args) {
    const booleans = collectBooleans(args)
    if (isFormulaError(booleans)) {
      return booleans
    }
    if (booleans.length === 0) {
      return formulaError('#VALUE!')
    }
    return booleans.some(Boolean)
  },
})

registerFormulaFunction('NOT', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    params: [{ name: 'logical' }],
    description: '对逻辑值取反',
    category: '逻辑',
  },
  impl(args) {
    const flag = coerceToBoolean(args[0]!)
    if (isFormulaError(flag)) {
      return flag
    }
    return !flag
  },
})

registerFormulaFunction('XOR', {
  minArgs: 1,
  meta: {
    params: [{ name: 'logical1' }, { name: 'logical2', optional: true }, { name: '...' }],
    description: '真值个数为奇数时返回 TRUE',
    category: '逻辑',
  },
  impl(args) {
    const booleans = collectBooleans(args)
    if (isFormulaError(booleans)) {
      return booleans
    }
    if (booleans.length === 0) {
      return formulaError('#VALUE!')
    }
    return booleans.filter(Boolean).length % 2 === 1
  },
})

registerFormulaFunction('IFERROR', {
  minArgs: 2,
  maxArgs: 2,
  meta: {
    params: [{ name: 'value' }, { name: 'value_if_error' }],
    description: '首参为任意错误（含 #N/A）时返回替代值',
    category: '逻辑',
  },
  impl(args) {
    return isFormulaError(args[0]) ? args[1]! : args[0]!
  },
})

registerFormulaFunction('TRUE', {
  minArgs: 0,
  maxArgs: 0,
  meta: { params: [], description: '返回逻辑值 TRUE', category: '逻辑' },
  impl: () => true,
})

registerFormulaFunction('FALSE', {
  minArgs: 0,
  maxArgs: 0,
  meta: { params: [], description: '返回逻辑值 FALSE', category: '逻辑' },
  impl: () => false,
})
