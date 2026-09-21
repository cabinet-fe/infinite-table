// parser：优先级 / 结合性 / 引用消歧 / 跨表 / 函数调用 / 错误字面量 / 解析失败

import { describe, expect, it } from 'vitest'

import { FormulaParseError, parseFormula } from '../src/index'
import type { AstNode } from '../src/index'

describe('parseFormula：字面量与原子', () => {
  it('数字 / 字符串 / 布尔 / 错误字面量', () => {
    expect(parseFormula('42')).toEqual({ kind: 'number', value: 42 })
    expect(parseFormula('"hi"')).toEqual({ kind: 'string', value: 'hi' })
    expect(parseFormula('TRUE')).toEqual({ kind: 'boolean', value: true })
    expect(parseFormula('false')).toEqual({ kind: 'boolean', value: false })
    expect(parseFormula('#N/A')).toEqual({ kind: 'error', code: '#N/A' })
  })

  it('单元格引用：0 基坐标 + $ 绝对标记', () => {
    expect(parseFormula('$A$1')).toEqual({
      kind: 'cell',
      ref: { col: 0, row: 0, colAbsolute: true, rowAbsolute: true },
    })
  })

  it('区域规范化：乱序角点归一', () => {
    expect(parseFormula('B3:A1')).toEqual({
      kind: 'range',
      ref: { startCol: 0, startRow: 0, endCol: 1, endRow: 2 },
    })
  })

  it('未知名称（非引用形态 ident）→ name 节点', () => {
    expect(parseFormula('Sheet2')).toEqual({ kind: 'name', name: 'Sheet2' })
    // 列超 3 字母不按引用处理
    expect(parseFormula('ABCD1')).toEqual({ kind: 'name', name: 'ABCD1' })
  })
})

describe('parseFormula：跨表引用', () => {
  it('裸表名与引号表名', () => {
    expect(parseFormula('Sheet2!A1')).toEqual({
      kind: 'cell',
      ref: { sheet: 'Sheet2', col: 0, row: 0, colAbsolute: false, rowAbsolute: false },
    })
    expect(parseFormula("'Sheet 2'!A1")).toEqual({
      kind: 'cell',
      ref: { sheet: 'Sheet 2', col: 0, row: 0, colAbsolute: false, rowAbsolute: false },
    })
  })

  it('跨表区域', () => {
    expect(parseFormula('Sheet2!A1:B2')).toEqual({
      kind: 'range',
      ref: { sheet: 'Sheet2', startCol: 0, startRow: 0, endCol: 1, endRow: 1 },
    })
  })
})

describe('parseFormula：优先级与结合性（同 Excel）', () => {
  const shape = (node: AstNode): unknown => {
    switch (node.kind) {
      case 'binary':
        return [node.op, shape(node.left), shape(node.right)]
      case 'unary':
        return [`unary${node.op}`, shape(node.operand)]
      case 'percent':
        return ['%', shape(node.operand)]
      case 'number':
        return node.value
      case 'call':
        return [node.name, ...node.args.map(shape)]
      default:
        return node.kind
    }
  }

  it('乘除优先于加减，比较最低', () => {
    expect(shape(parseFormula('1+2*3'))).toEqual(['+', 1, ['*', 2, 3]])
    expect(shape(parseFormula('1+2=3'))).toEqual(['=', ['+', 1, 2], 3])
    expect(shape(parseFormula('"a"&"b"="ab"'))).toEqual(['=', ['&', 'string', 'string'], 'string'])
  })

  it('幂右结合；一元紧于幂（-2^2 = (-2)^2）', () => {
    expect(shape(parseFormula('2^3^2'))).toEqual(['^', 2, ['^', 3, 2]])
    expect(shape(parseFormula('-2^2'))).toEqual(['^', ['unary-', 2], 2])
  })

  it('百分号后缀最高优先级', () => {
    expect(shape(parseFormula('10%+1'))).toEqual(['+', ['%', 10], 1])
  })

  it('括号改写优先级', () => {
    expect(shape(parseFormula('(1+2)*3'))).toEqual(['*', ['+', 1, 2], 3])
  })
})

describe('parseFormula：函数调用', () => {
  it('参数列表 / 嵌套 / 空调用', () => {
    expect(parseFormula('SUM(A1, B1:B2)')).toMatchObject({
      kind: 'call',
      name: 'SUM',
      args: [{ kind: 'cell' }, { kind: 'range' }],
    })
    expect(parseFormula('IF(TRUE, SUM(1,2), 0)')).toMatchObject({
      kind: 'call',
      name: 'IF',
      args: [{ kind: 'boolean' }, { kind: 'call', name: 'SUM' }, { kind: 'number' }],
    })
    expect(parseFormula('TODAY()')).toEqual({ kind: 'call', name: 'TODAY', args: [] })
  })
})

describe('parseFormula：解析失败', () => {
  it('多余输入 / 缺右括号 / 不完整表达式', () => {
    expect(() => parseFormula('1 2')).toThrow(FormulaParseError)
    expect(() => parseFormula('(1+2')).toThrow(FormulaParseError)
    expect(() => parseFormula('1+')).toThrow(FormulaParseError)
    expect(() => parseFormula('')).toThrow(FormulaParseError)
  })

  it('表名后非引用 / 区域缺终点 / 引号表名缺 !', () => {
    expect(() => parseFormula('Sheet2!foo')).toThrow(FormulaParseError)
    expect(() => parseFormula('A1:')).toThrow(FormulaParseError)
    expect(() => parseFormula("'Sheet 2'")).toThrow(FormulaParseError)
  })

  it('意外运算符', () => {
    expect(() => parseFormula('*2')).toThrow(FormulaParseError)
    expect(() => parseFormula('SUM(1,)')).toThrow(FormulaParseError)
  })
})
