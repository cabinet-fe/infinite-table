// scan-refs：容错引用扫描（编辑染色框用）——消歧对齐 parser，永不抛错

import { describe, expect, it } from 'vitest'

import { scanFormulaReferences } from '../src/index'

describe('scanFormulaReferences：基础引用', () => {
  it('单格引用与偏移（end 排他）', () => {
    expect(scanFormulaReferences('A1')).toEqual([
      {
        ref: { col: 0, row: 0, colAbsolute: false, rowAbsolute: false },
        isRange: false,
        start: 0,
        end: 2,
      },
    ])
    const refs = scanFormulaReferences('10+BC12*2')
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ isRange: false, start: 3, end: 7 })
    expect(refs[0]!.ref).toMatchObject({ col: 54, row: 11 })
    expect('10+BC12*2'.slice(3, 7)).toBe('BC12')
  })

  it('前导 = 兼容，偏移仍相对原文本', () => {
    const refs = scanFormulaReferences('=A1')
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ start: 1, end: 3 })
  })

  it('$ 绝对标记保留', () => {
    const refs = scanFormulaReferences('$A$1+$B2')
    expect(refs.map((r) => r.ref)).toEqual([
      { col: 0, row: 0, colAbsolute: true, rowAbsolute: true },
      { col: 1, row: 1, colAbsolute: true, rowAbsolute: false },
    ])
  })

  it('区域合成一条（span 覆盖整段）；乱序角点规范化', () => {
    expect(scanFormulaReferences('A1:B2')).toEqual([
      {
        ref: { startCol: 0, startRow: 0, endCol: 1, endRow: 1 },
        isRange: true,
        start: 0,
        end: 5,
      },
    ])
    expect(scanFormulaReferences('B2:A1')[0]!.ref).toEqual({
      startCol: 0,
      startRow: 0,
      endCol: 1,
      endRow: 1,
    })
  })

  it('A1: 尾巴非法时退化只报 A1', () => {
    expect(scanFormulaReferences('A1:')).toEqual([
      {
        ref: { col: 0, row: 0, colAbsolute: false, rowAbsolute: false },
        isRange: false,
        start: 0,
        end: 2,
      },
    ])
    expect(scanFormulaReferences('A1:foo')).toHaveLength(1)
    expect(scanFormulaReferences('A1:foo')[0]).toMatchObject({ isRange: false, end: 2 })
  })
})

describe('scanFormulaReferences：跨表前缀', () => {
  it('裸表名前缀（span 含前缀）', () => {
    expect(scanFormulaReferences('Sheet2!A1')).toEqual([
      {
        ref: { sheet: 'Sheet2', col: 0, row: 0, colAbsolute: false, rowAbsolute: false },
        isRange: false,
        start: 0,
        end: 9,
      },
    ])
  })

  it('引号表名（含双单引号转义）', () => {
    expect(scanFormulaReferences("'My Sheet'!B2")).toEqual([
      {
        ref: { sheet: 'My Sheet', col: 1, row: 1, colAbsolute: false, rowAbsolute: false },
        isRange: false,
        start: 0,
        end: 13,
      },
    ])
    expect(scanFormulaReferences("'It''s'!A1")[0]!.ref).toMatchObject({ sheet: "It's" })
  })

  it('跨表区域', () => {
    const refs = scanFormulaReferences('Sheet2!A1:B2')
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ isRange: true, start: 0, end: 12 })
    expect(refs[0]!.ref).toEqual({
      sheet: 'Sheet2',
      startCol: 0,
      startRow: 0,
      endCol: 1,
      endRow: 1,
    })
  })

  it('表名前缀后非引用 → 无结果且不炸', () => {
    expect(scanFormulaReferences('Sheet2!foo')).toEqual([])
    expect(scanFormulaReferences("'S'!")).toEqual([])
  })
})

describe('scanFormulaReferences：跳过项', () => {
  it('函数名跳过（含 LOG10( 这类撞单元格形态的）', () => {
    expect(scanFormulaReferences('LOG10(100)')).toEqual([])
    expect(scanFormulaReferences('SUM(A1, B2)').map((r) => [r.start, r.end])).toEqual([
      [4, 6],
      [8, 10],
    ])
  })

  it('字符串字面量内不扫描（含 "" 转义）', () => {
    expect(scanFormulaReferences('"A1"')).toEqual([])
    expect(scanFormulaReferences('"a""B2" & C3')).toHaveLength(1)
    expect(scanFormulaReferences('"a""B2" & C3')[0]).toMatchObject({ start: 10, end: 12 })
  })

  it('错误字面量跳过', () => {
    expect(scanFormulaReferences('#DIV/0!')).toEqual([])
    expect(scanFormulaReferences('A1+#N/A')).toHaveLength(1)
  })

  it('未知名称与 TRUE/FALSE 跳过', () => {
    expect(scanFormulaReferences('foo + TRUE')).toEqual([])
    expect(scanFormulaReferences('ABCD1')).toEqual([]) // 列超 3 字母按名称处理
  })

  it('连续 ident 贪婪：A1B 整体不是引用', () => {
    expect(scanFormulaReferences('A1B')).toEqual([])
  })

  it('数字（含科学计数）不产生假引用', () => {
    expect(scanFormulaReferences('1E5')).toEqual([])
    expect(scanFormulaReferences('2.5+A1')).toHaveLength(1)
  })
})

describe('scanFormulaReferences：容错（半截公式不抛错）', () => {
  it('未闭合字符串 / 引号表名 / 缺右括号', () => {
    expect(scanFormulaReferences('"abc')).toEqual([])
    expect(scanFormulaReferences("'abc")).toEqual([])
    expect(scanFormulaReferences('SUM(A1,')).toHaveLength(1)
    expect(scanFormulaReferences('=IF(A1>,')).toHaveLength(1)
  })

  it('空文本与孤立符号', () => {
    expect(scanFormulaReferences('')).toEqual([])
    expect(scanFormulaReferences('=')).toEqual([])
    expect(scanFormulaReferences('#')).toEqual([])
    expect(scanFormulaReferences(':')).toEqual([])
  })
})
