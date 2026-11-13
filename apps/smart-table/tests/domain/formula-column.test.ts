import { describe, expect, it } from 'vitest'

import { evaluateFormulaColumns, validateFormulaExpr } from '../../src/domain/formula-column'
import type { SmartColumn, SmartRecord } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'name', title: '项目名称', type: 'text', width: 120 },
  { key: 'paid', title: '累计回款', type: 'lookup', width: 120 },
  { key: 'contract', title: '合同金额', type: 'number', width: 120 },
  {
    key: 'rate',
    title: '达成率',
    type: 'formula',
    width: 100,
    formulaExpr: '=[paid] / [合同金额]',
    numberFormat: 'percent',
  },
  {
    key: 'grade',
    title: '评级',
    type: 'formula',
    width: 100,
    formulaExpr: 'IF([达成率] >= 0.8, "优秀", "[保持]跟进")',
  },
  {
    key: 'bad_formula',
    title: '非法公式',
    type: 'formula',
    width: 100,
    formulaExpr: '[unknown_col] + 1',
  },
]

describe('formula-column', () => {
  it('支持 [fieldKey] 与 [列标题] 引用、顺序链式求值及除零收敛为 0', () => {
    const records: SmartRecord[] = [
      { _id: '1', name: '项目A', paid: 90, contract: 100 },
      { _id: '2', name: '项目B', paid: 50, contract: 100 },
      // 分母为 0 时 #DIV/0! 收敛为 0，随后评级列可立即引用刚算出的达成率
      { _id: '3', name: '项目C', paid: 20, contract: 0 },
    ]

    const res = evaluateFormulaColumns(COLUMNS, records)

    // 原记录不被修改
    expect(records[0]!['rate']).toBeUndefined()

    expect(res[0]!['rate']).toBe(0.9)
    expect(res[0]!['grade']).toBe('优秀')

    expect(res[1]!['rate']).toBe(0.5)
    // 字符串字面量中的 [保持] 不被错误替换
    expect(res[1]!['grade']).toBe('[保持]跟进')

    expect(res[2]!['rate']).toBe(0)
    expect(res[2]!['grade']).toBe('[保持]跟进')

    // 无法编译的公式收敛为 null
    expect(res[0]!['bad_formula']).toBeNull()
  })

  it('除 #DIV/0! 外的错误收敛为 null', () => {
    const cols: SmartColumn[] = [
      { key: 'a', title: 'A', type: 'text', width: 100 },
      {
        key: 'calc',
        title: '计算',
        type: 'formula',
        width: 100,
        formulaExpr: '[a] * 2',
      },
    ]
    const res = evaluateFormulaColumns(cols, [{ _id: '1', a: '非数字文本' }])
    expect(res[0]!['calc']).toBeNull()
  })

  it('validateFormulaExpr 校验合法与非法表达式', () => {
    expect(validateFormulaExpr('[paid] / [合同金额]', COLUMNS)).toEqual({ valid: true })
    expect(validateFormulaExpr('=ROUND([paid] * 1.1, 2)', COLUMNS)).toEqual({ valid: true })

    expect(validateFormulaExpr('   ', COLUMNS).valid).toBe(false)
    expect(validateFormulaExpr('[missing] + 1', COLUMNS).valid).toBe(false)
    expect(validateFormulaExpr('[paid + 1', COLUMNS).valid).toBe(false)
    expect(validateFormulaExpr('"[unclosed', COLUMNS).valid).toBe(false)
    expect(validateFormulaExpr('[paid] + foo', COLUMNS).valid).toBe(false)
    expect(validateFormulaExpr('UNKNOWN_FN([paid])', COLUMNS).valid).toBe(false)
  })
})
