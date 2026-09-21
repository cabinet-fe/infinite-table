// 分词器：数字 / 字符串 / 标识符 / 引号表名 / 错误字面量 / 运算符；非法输入抛 FormulaParseError

import { describe, expect, it } from 'vitest'

import { FormulaParseError, tokenizeFormula } from '../src/index'

describe('tokenizeFormula', () => {
  it('数字：整数 / 小数 / 前导点 / 科学计数', () => {
    expect(tokenizeFormula('123')).toEqual([{ type: 'number', value: 123, raw: '123' }])
    expect(tokenizeFormula('1.5')).toEqual([{ type: 'number', value: 1.5, raw: '1.5' }])
    expect(tokenizeFormula('.5')).toEqual([{ type: 'number', value: 0.5, raw: '.5' }])
    expect(tokenizeFormula('1e3')).toEqual([{ type: 'number', value: 1000, raw: '1e3' }])
    expect(tokenizeFormula('1.5E-2')).toEqual([{ type: 'number', value: 0.015, raw: '1.5E-2' }])
  })

  it('字符串字面量："" 转义为字面双引号', () => {
    expect(tokenizeFormula('"abc"')).toEqual([{ type: 'string', value: 'abc' }])
    expect(tokenizeFormula('"a""b"')).toEqual([{ type: 'string', value: 'a"b' }])
    expect(() => tokenizeFormula('"abc')).toThrow(FormulaParseError)
  })

  it("带引号表名：'' 转义为字面单引号", () => {
    expect(tokenizeFormula("'Sheet 2'!A1")).toEqual([
      { type: 'quoted-name', name: 'Sheet 2' },
      { type: 'op', op: '!' },
      { type: 'ident', name: 'A1' },
    ])
    expect(tokenizeFormula("'It''s'!A1")[0]).toEqual({ type: 'quoted-name', name: "It's" })
    expect(() => tokenizeFormula("'abc")).toThrow(FormulaParseError)
  })

  it('标识符：$ 绝对写法与非 ASCII（中文表名）都属标识符', () => {
    expect(tokenizeFormula('$A$1')).toEqual([{ type: 'ident', name: '$A$1' }])
    expect(tokenizeFormula('数据!A1')).toEqual([
      { type: 'ident', name: '数据' },
      { type: 'op', op: '!' },
      { type: 'ident', name: 'A1' },
    ])
  })

  it('错误字面量：大小写不敏感归一为错误码', () => {
    expect(tokenizeFormula('#DIV/0!')).toEqual([{ type: 'error', code: '#DIV/0!' }])
    expect(tokenizeFormula('#n/a')).toEqual([{ type: 'error', code: '#N/A' }])
    expect(tokenizeFormula('#NAME?')[0]).toEqual({ type: 'error', code: '#NAME?' })
    expect(() => tokenizeFormula('#FOO')).toThrow(FormulaParseError)
  })

  it('运算符：双字符优先于单字符', () => {
    const ops = tokenizeFormula('<> <= >= < > =')
    expect(ops.map((token) => (token.type === 'op' ? token.op : ''))).toEqual([
      '<>',
      '<=',
      '>=',
      '<',
      '>',
      '=',
    ])
    expect(tokenizeFormula('A1:B2').map(String)).toHaveLength(3)
  })

  it('空白忽略（空格/制表/换行）', () => {
    expect(tokenizeFormula(' 1 +\t2\n')).toEqual([
      { type: 'number', value: 1, raw: '1' },
      { type: 'op', op: '+' },
      { type: 'number', value: 2, raw: '2' },
    ])
  })

  it('无法识别的字符抛 FormulaParseError', () => {
    expect(() => tokenizeFormula('@')).toThrow(FormulaParseError)
    expect(() => tokenizeFormula('1 ~ 2')).toThrow(FormulaParseError)
  })
})
