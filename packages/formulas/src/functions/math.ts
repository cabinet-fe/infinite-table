// 数学函数集：SUM / ROUND / ABS / RAND / RANDBETWEEN。
// SUM/ROUND/ABS 走 @cat-kit/core 的 $n / n().fixed 精确计算（对齐 Excel 半进位与浮点观感）。

import { $n, n } from '@cat-kit/core'

import { formulaError, isFormulaError } from '../errors'
import { coerceToNumber } from '../evaluator'
import { collectNumbers, plusAll } from './internal'
import { registerFormulaFunction } from './registry'

registerFormulaFunction('SUM', {
  minArgs: 1,
  meta: {
    params: [{ name: 'number1' }, { name: 'number2', optional: true }, { name: '...' }],
    description: '求参数之和',
    category: '常用',
  },
  impl(args) {
    const numbers = collectNumbers(args)
    if (isFormulaError(numbers)) {
      return numbers
    }
    return plusAll(numbers)
  },
})

registerFormulaFunction('ROUND', {
  minArgs: 2,
  maxArgs: 2,
  meta: {
    params: [{ name: 'number' }, { name: 'num_digits' }],
    description: '按指定位数四舍五入',
    category: '常用',
  },
  impl(args) {
    const value = coerceToNumber(args[0]!)
    if (isFormulaError(value)) {
      return value
    }
    const digitsArg = coerceToNumber(args[1]!)
    if (isFormulaError(digitsArg)) {
      return digitsArg
    }
    const digits = Math.trunc(digitsArg)
    const factor = 10 ** digits
    // 位数超出 double 精度时四舍五入是恒等/归零
    if (!Number.isFinite(factor)) {
      return value
    }
    if (factor === 0) {
      return 0
    }
    // n().fixed 只接受非负位数；负位数先缩放到整数再四舍五入
    if (digits < 0) {
      const scale = 10 ** -digits
      const rounded = Number(n($n.div(value, scale)).fixed(0))
      return $n.mul(rounded, scale)
    }
    return Number(n(value).fixed(digits))
  },
})

registerFormulaFunction('ABS', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    params: [{ name: 'number' }],
    description: '返回数字的绝对值',
    category: '常用',
  },
  impl(args) {
    const value = coerceToNumber(args[0]!)
    if (isFormulaError(value)) {
      return value
    }
    return value < 0 ? $n.minus(0, value) : value
  },
})

registerFormulaFunction('RAND', {
  volatile: true,
  minArgs: 0,
  maxArgs: 0,
  meta: {
    params: [],
    description: '返回 [0, 1) 区间的随机数',
    category: '数学',
  },
  impl: () => Math.random(),
})

registerFormulaFunction('RANDBETWEEN', {
  volatile: true,
  minArgs: 2,
  maxArgs: 2,
  meta: {
    params: [{ name: 'bottom' }, { name: 'top' }],
    description: '返回 [bottom, top] 闭区间的随机整数',
    category: '数学',
  },
  impl(args) {
    const bottom = coerceToNumber(args[0]!)
    if (isFormulaError(bottom)) {
      return bottom
    }
    const top = coerceToNumber(args[1]!)
    if (isFormulaError(top)) {
      return top
    }
    if (!Number.isFinite(bottom) || !Number.isFinite(top)) {
      return formulaError('#VALUE!')
    }
    // 非整数参数向零截断（Excel 语义）
    const lo = Math.trunc(bottom)
    const hi = Math.trunc(top)
    if (lo > hi) {
      return formulaError('#VALUE!')
    }
    return lo + Math.floor(Math.random() * (hi - lo + 1))
  },
})
