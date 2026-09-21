// ast-refs：静态引用收集（含 lazy 分支）与易失调用检测

import { describe, expect, it } from 'vitest'

import { astHasVolatileCall, collectAstReferences, parseFormula } from '../src/index'

describe('collectAstReferences', () => {
  it('字面量与未知名称无引用', () => {
    expect(collectAstReferences(parseFormula('42'))).toEqual([])
    expect(collectAstReferences(parseFormula('"A1"'))).toEqual([])
    expect(collectAstReferences(parseFormula('foo'))).toEqual([])
  })

  it('单格与区域引用（含 $ 绝对与跨表）', () => {
    expect(collectAstReferences(parseFormula('$A$1'))).toEqual([
      { kind: 'cell', ref: { col: 0, row: 0, colAbsolute: true, rowAbsolute: true } },
    ])
    expect(collectAstReferences(parseFormula('Sheet2!A1:B2'))).toEqual([
      { kind: 'range', ref: { sheet: 'Sheet2', startCol: 0, startRow: 0, endCol: 1, endRow: 1 } },
    ])
  })

  it('遍历 unary / percent / binary / call 全部操作数', () => {
    const refs = collectAstReferences(parseFormula('-A1 + B2% * SUM(C1, D1:E2)'))
    expect(refs.map((r) => r.kind)).toEqual(['cell', 'cell', 'cell', 'range'])
  })

  it('lazy 函数未求值分支的引用也收集（纯静态）', () => {
    const refs = collectAstReferences(parseFormula('IF(TRUE, A1, B1)'))
    expect(refs).toHaveLength(2)
  })

  it('重复引用不去重（去重是 DependencyGraph 的职责）', () => {
    expect(collectAstReferences(parseFormula('A1+A1'))).toHaveLength(2)
  })
})

describe('astHasVolatileCall', () => {
  it('易失函数命中（含嵌套与非求值分支）', () => {
    expect(astHasVolatileCall(parseFormula('TODAY()'))).toBe(true)
    expect(astHasVolatileCall(parseFormula('IF(FALSE, NOW(), 1)'))).toBe(true)
    expect(astHasVolatileCall(parseFormula('SUM(A1, RAND())'))).toBe(true)
  })

  it('非易失与无调用为 false', () => {
    expect(astHasVolatileCall(parseFormula('SUM(A1:B2)'))).toBe(false)
    expect(astHasVolatileCall(parseFormula('A1+1'))).toBe(false)
    expect(astHasVolatileCall(parseFormula('42'))).toBe(false)
  })

  it('未知函数按注册表元数据判定（未注册 = 非易失）', () => {
    expect(astHasVolatileCall(parseFormula('NOSUCHFN(A1)'))).toBe(false)
  })
})
