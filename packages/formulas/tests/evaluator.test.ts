// 求值器：四则精确计算 / 运算符语义 / 强转规则 / 比较 / 错误传播 / 引用与跨表 / 终值形态

import { describe, expect, it } from 'vitest'

import { evaluate, isFormulaError, type FormulaError, type FormulaResolver } from '../src/index'
import { EMPTY_RESOLVER, createFakeResolver } from './testing/fake-resolver'

/** 断言错误码 */
function expectError(result: unknown, code: string): void {
  expect(isFormulaError(result)).toBe(true)
  expect((result as FormulaError).code).toBe(code)
}

describe('evaluate：四则与精确计算（@cat-kit/core $n）', () => {
  it('浮点精确：0.1+0.2 = 0.3', () => {
    expect(evaluate('0.1+0.2', EMPTY_RESOLVER)).toBe(0.3)
    expect(evaluate('1.0-0.9', EMPTY_RESOLVER)).toBe(0.1)
    expect(evaluate('19.9*100', EMPTY_RESOLVER)).toBe(1990)
    expect(evaluate('0.3/0.1', EMPTY_RESOLVER)).toBe(3)
  })

  it('优先级：乘除 > 加减；括号；幂右结合；一元紧于幂；百分号', () => {
    expect(evaluate('1+2*3', EMPTY_RESOLVER)).toBe(7)
    expect(evaluate('(1+2)*3', EMPTY_RESOLVER)).toBe(9)
    expect(evaluate('2^3^2', EMPTY_RESOLVER)).toBe(512)
    expect(evaluate('-2^2', EMPTY_RESOLVER)).toBe(4)
    expect(evaluate('2^-2', EMPTY_RESOLVER)).toBe(0.25)
    expect(evaluate('10%', EMPTY_RESOLVER)).toBe(0.1)
    expect(evaluate('10%*2', EMPTY_RESOLVER)).toBe(0.2)
    expect(evaluate('-50%', EMPTY_RESOLVER)).toBe(-0.5)
  })

  it('除零与非法幂 → 错误值', () => {
    expectError(evaluate('1/0', EMPTY_RESOLVER), '#DIV/0!')
    expectError(evaluate('0/0', EMPTY_RESOLVER), '#DIV/0!')
    expectError(evaluate('0^-1', EMPTY_RESOLVER), '#DIV/0!')
  })
})

describe('evaluate：文本与比较', () => {
  it('& 连接（数字/布尔强转文本）', () => {
    expect(evaluate('"a"&"b"', EMPTY_RESOLVER)).toBe('ab')
    expect(evaluate('"a"&1', EMPTY_RESOLVER)).toBe('a1')
    expect(evaluate('"a"&TRUE', EMPTY_RESOLVER)).toBe('aTRUE')
  })

  it('比较：数值 / 文本大小写不敏感 / 混合类型 数字<文本<布尔', () => {
    expect(evaluate('1=1', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('1<>2', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('"a"="A"', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('"b">"A"', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('1<"a"', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('"a"<TRUE', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('2>=2', EMPTY_RESOLVER)).toBe(true)
    expect(evaluate('1<=0', EMPTY_RESOLVER)).toBe(false)
  })
})

describe('evaluate：强转规则（Excel 语义）', () => {
  it('空格按 0；数字文本强转；布尔强转', () => {
    const resolver = createFakeResolver({ Sheet1: {} })
    expect(evaluate('A1+1', resolver)).toBe(1)
    expect(evaluate('"5"+1', EMPTY_RESOLVER)).toBe(5 + 1)
    expect(evaluate('TRUE+1', EMPTY_RESOLVER)).toBe(2)
    expect(evaluate('"TRUE"+1', EMPTY_RESOLVER)).toBe(2)
    expect(evaluate('"FALSE"*5', EMPTY_RESOLVER)).toBe(0)
  })

  it('非法文本参与算术 → #VALUE!；空串字面量算术 → #VALUE!', () => {
    expectError(evaluate('"abc"+1', EMPTY_RESOLVER), '#VALUE!')
    expectError(evaluate('""+1', EMPTY_RESOLVER), '#VALUE!')
  })

  it('空格引用作终值显示为 0', () => {
    expect(evaluate('Z99', EMPTY_RESOLVER)).toBe(0)
  })
})

describe('evaluate：错误传播与错误值', () => {
  it('错误字面量求值为对应错误；随运算传播（左操作数优先）', () => {
    expectError(evaluate('#N/A', EMPTY_RESOLVER), '#N/A')
    expectError(evaluate('#N/A+1', EMPTY_RESOLVER), '#N/A')
    expectError(evaluate('#DIV/0!+#N/A', EMPTY_RESOLVER), '#DIV/0!')
    expectError(evaluate('#N/A&"x"', EMPTY_RESOLVER), '#N/A')
  })

  it('解析失败 → #ERROR!；未知名称 → #NAME?；未知函数 → #NAME?', () => {
    expectError(evaluate('1 +', EMPTY_RESOLVER), '#ERROR!')
    expectError(evaluate('', EMPTY_RESOLVER), '#ERROR!')
    expectError(evaluate('Sheet2', EMPTY_RESOLVER), '#NAME?')
    expectError(evaluate('NOPE(1)', EMPTY_RESOLVER), '#NAME?')
  })

  it('区域作为终值（非函数参数）→ #VALUE!（v1 不做数组公式）', () => {
    expectError(evaluate('A1:A2', EMPTY_RESOLVER), '#VALUE!')
  })

  it('resolver 抛错 → #REF!', () => {
    const boom: FormulaResolver = {
      cell: () => {
        throw new Error('boom')
      },
      range: () => {
        throw new Error('boom')
      },
    }
    expectError(evaluate('A1', boom), '#REF!')
    expectError(evaluate('SUM(A1:A2)', boom), '#REF!')
  })
})

describe('evaluate：引用与跨表', () => {
  it('单元格/区域经 resolver 取值（0 基坐标 + 绝对标记透传）', () => {
    const resolver = createFakeResolver({ Sheet1: { A1: 7, A2: 5, B1: 1, B2: 2 } })
    expect(evaluate('A1+A2', resolver)).toBe(12)
    expect(evaluate('SUM(A1:B2)', resolver)).toBe(15)
    evaluate('$A$1', resolver)
    const ref = resolver.cellCalls.at(-1)!
    expect(ref).toMatchObject({ col: 0, row: 0, colAbsolute: true, rowAbsolute: true })
  })

  it('跨表引用：resolver 收到正确 sheet 名（裸表名与引号表名）', () => {
    const resolver = createFakeResolver({
      Sheet1: {},
      Sheet2: { A1: 41, A2: 1 },
      'Sheet 2': { C3: 9 },
    })
    expect(evaluate('Sheet2!A1+1', resolver)).toBe(42)
    expect(resolver.cellCalls.at(-1)).toMatchObject({ sheet: 'Sheet2', col: 0, row: 0 })
    expect(evaluate('SUM(Sheet2!A1:A2)', resolver)).toBe(42)
    expect(resolver.rangeCalls.at(-1)).toMatchObject({
      sheet: 'Sheet2',
      startCol: 0,
      startRow: 0,
      endCol: 0,
      endRow: 1,
    })
    expect(evaluate("'Sheet 2'!C3*2", resolver)).toBe(18)
    expect(resolver.cellCalls.at(-1)).toMatchObject({ sheet: 'Sheet 2' })
  })

  it('未知表 → resolver 返回的错误值传播', () => {
    const resolver = createFakeResolver({ Sheet1: {} })
    expectError(evaluate('Nope!A1', resolver), '#REF!')
  })

  it('options.sheet 填入裸引用缺省表名；options.cell 供 ROW/COLUMN 省参', () => {
    const resolver = createFakeResolver({ Main: { B2: 3 } }, 'Main')
    expect(evaluate('B2*2', resolver, { sheet: 'Main' })).toBe(6)
    expect(resolver.cellCalls.at(-1)).toMatchObject({ sheet: 'Main', col: 1, row: 1 })
    expect(evaluate('ROW()', resolver, { cell: { col: 2, row: 4 } })).toBe(5)
    expect(evaluate('COLUMN()', resolver, { cell: { col: 2, row: 4 } })).toBe(3)
  })

  it('区域展开先行后列且空格不进（稀疏语义）', () => {
    const resolver = createFakeResolver({ Sheet1: { A1: 1, B1: 2, B2: 3 } })
    expect(evaluate('SUM(A1:B2)', resolver)).toBe(6)
    expect(evaluate('COUNT(A1:B2)', resolver)).toBe(3)
  })
})
