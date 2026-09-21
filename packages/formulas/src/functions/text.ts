// 文本函数集：CONCATENATE / LEN / LEFT / RIGHT / MID / UPPER / LOWER / TRIM / EXACT / SUBSTITUTE / REPLACE。

import { formulaError, isFormulaError } from '../errors'
import { coerceToNumber, coerceToText } from '../evaluator'
import { registerFormulaFunction } from './registry'

registerFormulaFunction('CONCATENATE', {
  minArgs: 1,
  meta: {
    params: [{ name: 'text1' }, { name: 'text2', optional: true }, { name: '...' }],
    description: '将多个文本连接成一个字符串',
    category: '文本',
  },
  impl(args) {
    let text = ''
    for (const arg of args) {
      const values = Array.isArray(arg) ? arg : [arg]
      for (const value of values) {
        const piece = coerceToText(value)
        if (isFormulaError(piece)) {
          return piece
        }
        text += piece
      }
    }
    return text
  },
})

registerFormulaFunction('LEN', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    params: [{ name: 'text' }],
    description: '返回文本的字符个数',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    return text.length
  },
})

/** LEFT / RIGHT 共用：count < 0 → #VALUE!；take 从左 / 右取 count 个字符 */
function takeText(text: string, count: number, fromRight: boolean): string {
  if (fromRight) {
    return text.slice(Math.max(0, text.length - count))
  }
  return text.slice(0, count)
}

registerFormulaFunction('LEFT', {
  minArgs: 1,
  maxArgs: 2,
  meta: {
    params: [{ name: 'text' }, { name: 'num_chars', optional: true }],
    description: '返回文本左侧指定个数的字符',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    let count = 1
    if (args.length > 1) {
      const countArg = coerceToNumber(args[1]!)
      if (isFormulaError(countArg)) {
        return countArg
      }
      count = Math.trunc(countArg)
    }
    if (count < 0) {
      return formulaError('#VALUE!')
    }
    return takeText(text, count, false)
  },
})

registerFormulaFunction('RIGHT', {
  minArgs: 1,
  maxArgs: 2,
  meta: {
    params: [{ name: 'text' }, { name: 'num_chars', optional: true }],
    description: '返回文本右侧指定个数的字符',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    let count = 1
    if (args.length > 1) {
      const countArg = coerceToNumber(args[1]!)
      if (isFormulaError(countArg)) {
        return countArg
      }
      count = Math.trunc(countArg)
    }
    if (count < 0) {
      return formulaError('#VALUE!')
    }
    return takeText(text, count, true)
  },
})

registerFormulaFunction('MID', {
  minArgs: 3,
  maxArgs: 3,
  meta: {
    params: [{ name: 'text' }, { name: 'start_num' }, { name: 'num_chars' }],
    description: '从指定位置起返回指定个数的字符',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    const startArg = coerceToNumber(args[1]!)
    if (isFormulaError(startArg)) {
      return startArg
    }
    const countArg = coerceToNumber(args[2]!)
    if (isFormulaError(countArg)) {
      return countArg
    }
    const start = Math.trunc(startArg)
    const count = Math.trunc(countArg)
    if (start < 1 || count < 0) {
      return formulaError('#VALUE!')
    }
    return text.slice(start - 1, start - 1 + count)
  },
})

registerFormulaFunction('UPPER', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    params: [{ name: 'text' }],
    description: '将文本转换为大写',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    return text.toUpperCase()
  },
})

registerFormulaFunction('LOWER', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    params: [{ name: 'text' }],
    description: '将文本转换为小写',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    return text.toLowerCase()
  },
})

registerFormulaFunction('TRIM', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    params: [{ name: 'text' }],
    description: '去除首尾空格并把内部连续空格压缩为一个',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    return text.replace(/ +/g, ' ').replace(/^ | $/g, '')
  },
})

registerFormulaFunction('EXACT', {
  minArgs: 2,
  maxArgs: 2,
  meta: {
    params: [{ name: 'text1' }, { name: 'text2' }],
    description: '比较两个文本是否完全相同（区分大小写）',
    category: '文本',
  },
  impl(args) {
    const left = coerceToText(args[0]!)
    if (isFormulaError(left)) {
      return left
    }
    const right = coerceToText(args[1]!)
    if (isFormulaError(right)) {
      return right
    }
    return left === right
  },
})

registerFormulaFunction('SUBSTITUTE', {
  minArgs: 3,
  maxArgs: 4,
  meta: {
    params: [
      { name: 'text' },
      { name: 'old_text' },
      { name: 'new_text' },
      { name: 'instance_num', optional: true },
    ],
    description: '替换文本中的子串（可指定第几次出现，省略替换全部）',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    const oldText = coerceToText(args[1]!)
    if (isFormulaError(oldText)) {
      return oldText
    }
    const newText = coerceToText(args[2]!)
    if (isFormulaError(newText)) {
      return newText
    }
    if (oldText === '') {
      return text
    }
    let instance: number | undefined
    if (args.length > 3) {
      const instanceArg = coerceToNumber(args[3]!)
      if (isFormulaError(instanceArg)) {
        return instanceArg
      }
      instance = Math.trunc(instanceArg)
      if (instance < 1) {
        return formulaError('#VALUE!')
      }
    }
    if (instance === undefined) {
      return text.split(oldText).join(newText)
    }
    // 只替换第 instance 次出现（不重叠计数）；出现次数不足则原样返回
    let from = 0
    for (let nth = 1; nth <= instance; nth++) {
      const found = text.indexOf(oldText, from)
      if (found < 0) {
        return text
      }
      if (nth === instance) {
        return text.slice(0, found) + newText + text.slice(found + oldText.length)
      }
      from = found + oldText.length
    }
    return text
  },
})

registerFormulaFunction('REPLACE', {
  minArgs: 4,
  maxArgs: 4,
  meta: {
    params: [
      { name: 'old_text' },
      { name: 'start_num' },
      { name: 'num_chars' },
      { name: 'new_text' },
    ],
    description: '按字符位置与个数替换文本中的一段',
    category: '文本',
  },
  impl(args) {
    const text = coerceToText(args[0]!)
    if (isFormulaError(text)) {
      return text
    }
    const startArg = coerceToNumber(args[1]!)
    if (isFormulaError(startArg)) {
      return startArg
    }
    const countArg = coerceToNumber(args[2]!)
    if (isFormulaError(countArg)) {
      return countArg
    }
    const newText = coerceToText(args[3]!)
    if (isFormulaError(newText)) {
      return newText
    }
    const start = Math.trunc(startArg)
    const count = Math.trunc(countArg)
    if (start < 1 || count < 0) {
      return formulaError('#VALUE!')
    }
    return text.slice(0, start - 1) + newText + text.slice(start - 1 + count)
  },
})
