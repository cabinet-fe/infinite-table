// 注册表：大小写不敏感 / 同名覆盖 / 自定义注册 / 元数据与签名 / 分类与易失性查询

import { describe, expect, it } from 'vitest'

import {
  FORMULA_FUNCTION_CATEGORIES,
  evaluate,
  formatFunctionSignature,
  getFormulaFunction,
  getFormulaFunctionInfo,
  isVolatileFormulaFunction,
  listFormulaFunctions,
  registerFormulaFunction,
} from '../../src/index'
import { EMPTY_RESOLVER } from '../testing/fake-resolver'

describe('内置函数注册表', () => {
  it('49 个内置函数全部注册且元数据齐备（分类/描述/签名）', () => {
    const all = listFormulaFunctions()
    expect(all).toHaveLength(49)
    for (const info of all) {
      expect(info.category, `${info.name} 缺分类`).toBeDefined()
      expect(FORMULA_FUNCTION_CATEGORIES).toContain(info.category)
      expect(info.description, `${info.name} 缺描述`).not.toBe('')
      expect(info.signature.startsWith(`${info.name}(`), `${info.name} 签名异常`).toBe(true)
    }
    // 列表按名称升序
    expect(all.map((info) => info.name)).toEqual(
      all.map((info) => info.name).sort((a, b) => a.localeCompare(b)),
    )
  })

  it('签名格式：可选参数加 []，可变参数渲染 ...，无参为 ()', () => {
    expect(getFormulaFunctionInfo('SUM')?.signature).toBe('SUM(number1, [number2], ...)')
    expect(getFormulaFunctionInfo('IF')?.signature).toBe(
      'IF(logical_test, value_if_true, [value_if_false])',
    )
    expect(getFormulaFunctionInfo('TODAY')?.signature).toBe('TODAY()')
    expect(formatFunctionSignature('X', [{ name: 'a' }, { name: 'b', optional: true }])).toBe(
      'X(a, [b])',
    )
  })

  it('易失性标记：TODAY/NOW/RAND/RANDBETWEEN 为易失', () => {
    for (const name of ['TODAY', 'NOW', 'RAND', 'RANDBETWEEN']) {
      expect(isVolatileFormulaFunction(name)).toBe(true)
    }
    expect(isVolatileFormulaFunction('SUM')).toBe(false)
    expect(isVolatileFormulaFunction('NOPE')).toBe(false)
    expect(getFormulaFunctionInfo('RAND')?.volatile).toBe(true)
  })

  it('大小写不敏感查询', () => {
    expect(getFormulaFunction('sum')).toBeDefined()
    expect(getFormulaFunctionInfo('sum')?.name).toBe('SUM')
    expect(getFormulaFunctionInfo('NOPE')).toBeUndefined()
    expect(evaluate('sum(1,2)', EMPTY_RESOLVER)).toBe(3)
  })

  it('自定义注册（大小写不敏感）与同名覆盖', () => {
    registerFormulaFunction('DOUBLE', {
      minArgs: 1,
      maxArgs: 1,
      meta: { params: [{ name: 'value' }], description: '翻倍', category: '数学' },
      impl: (args) => (typeof args[0] === 'number' ? args[0] * 2 : 0),
    })
    expect(evaluate('double(21)', EMPTY_RESOLVER)).toBe(42)
    expect(getFormulaFunctionInfo('DOUBLE')?.category).toBe('数学')

    // 同名覆盖：临时替换 DOUBLE 实现
    registerFormulaFunction('double', { impl: () => 'covered' })
    expect(evaluate('DOUBLE(21)', EMPTY_RESOLVER)).toBe('covered')

    // 覆盖内置：SUM 替换后生效，测试末位恢复语义由文件隔离保证（vitest 每文件独立模块图）
    registerFormulaFunction('SUM', { impl: () => -1 })
    expect(evaluate('SUM(1,2)', EMPTY_RESOLVER)).toBe(-1)
  })

  it('参数个数校验：minArgs/maxArgs 越界 → #VALUE!', () => {
    expect(evaluate('ABS()', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('ABS(1,2)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
    expect(evaluate('TODAY(1)', EMPTY_RESOLVER)).toMatchObject({ code: '#VALUE!' })
  })
})
