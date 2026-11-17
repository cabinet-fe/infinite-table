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

  it('空字符串单元格按 0 参与算术、支持列顺序无关拓扑求值与清空公式清理旧值', () => {
    const cols: SmartColumn[] = [
      // 引用排在后面的公式列 [total]
      {
        key: 'double_total',
        title: '双倍合计',
        type: 'formula',
        width: 100,
        formulaExpr: '[total] * 2',
      },
      { key: 'a', title: 'A', type: 'number', width: 100 },
      { key: 'b', title: 'B', type: 'text', width: 100 },
      {
        key: 'total',
        title: '合计',
        type: 'formula',
        width: 100,
        formulaExpr: '[a] + [b]',
      },
      {
        key: 'cleared',
        title: '已清空公式',
        type: 'formula',
        width: 100,
        formulaExpr: '',
      },
    ]

    const res = evaluateFormulaColumns(cols, [{ _id: '1', a: 10, b: '', cleared: 999 }])
    expect(res[0]!['total']).toBe(10)
    expect(res[0]!['double_total']).toBe(20)
    expect(res[0]!['cleared']).toBeNull()
  })

  it('拒绝单元格/区域坐标引用、检测循环依赖并安全处理含 ] 及重名列标题', () => {
    const cols: SmartColumn[] = [
      { key: 'price_a', title: '单价[元]', type: 'number', width: 100 },
      { key: 'dup_1', title: '金额', type: 'number', width: 100 },
      { key: 'dup_2', title: '金额', type: 'number', width: 100 },
      { key: 'f1', title: 'F1', type: 'formula', width: 100, formulaExpr: '[f2] + 1' },
      { key: 'f2', title: 'F2', type: 'formula', width: 100, formulaExpr: '[f1] + 1' },
      {
        key: 'calc_bracket',
        title: '含括号计算',
        type: 'formula',
        width: 100,
        formulaExpr: '[单价[元]] * 2',
      },
    ]

    // 拒绝手写 A1 / A1:B2 / [a]:[b]
    const cellRef = validateFormulaExpr('A1 + 1', cols)
    expect(cellRef.valid).toBe(false)
    expect(cellRef.error).toContain('暂不支持区域/单元格坐标引用')

    const rangeRef = validateFormulaExpr('SUM(A1:B2)', cols)
    expect(rangeRef.valid).toBe(false)
    expect(rangeRef.error).toContain('暂不支持区域/单元格坐标引用')

    const mappedRange = validateFormulaExpr('SUM([price_a]:[dup_1])', cols)
    expect(mappedRange.valid).toBe(false)
    expect(mappedRange.error).toContain('暂不支持区域/单元格坐标引用')

    // 重名标题提示使用唯一字段名，使用 key 则合法
    const dupRes = validateFormulaExpr('[金额] + 1', cols)
    expect(dupRes.valid).toBe(false)
    expect(dupRes.error).toContain('重名')
    expect(validateFormulaExpr('[dup_1] + 1', cols)).toEqual({ valid: true })

    // 含 ']' 的标题安全引用
    expect(validateFormulaExpr('[单价[元]] * 2', cols)).toEqual({ valid: true })

    // 直接与间接循环检测
    const selfCycle = validateFormulaExpr('[f1] + 1', cols, 'f1')
    expect(selfCycle.valid).toBe(false)
    expect(selfCycle.error).toContain('循环引用')

    const indirectCycle = validateFormulaExpr('[f2] + 1', cols, 'f1')
    expect(indirectCycle.valid).toBe(false)
    expect(indirectCycle.error).toContain('循环引用')

    // 运行时成环列收敛为 null，含 ']' 列正常计算
    const evalRes = evaluateFormulaColumns(cols, [{ _id: '1', price_a: 15, f1: 100, f2: 200 }])
    expect(evalRes[0]!['f1']).toBeNull()
    expect(evalRes[0]!['f2']).toBeNull()
    expect(evalRes[0]!['calc_bracket']).toBe(30)
  })
})
