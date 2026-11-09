// 通用受限求值管线（expr.ts）测试：单表达式与函数体两种形态的形参白名单注入、
// 严格模式、入参按引用共享（只读约定）、错误分类（compile/runtime）与 what 前缀。
// reshape/aggregation/cell-function 三方共用本管线，各自的行为测试在对应文件。
import { describe, expect, test } from 'bun:test'

import {
  compileExpr,
  compileFunctionBody,
  evaluateExpr,
  evaluateFunctionBody,
  ExprError,
} from '../../src/transform/expr'

describe('compileExpr（单表达式）', () => {
  test('形参与 new Function 声明一一对应，构造期即暴露语法错误', () => {
    const fn = compileExpr(['a', 'b'], 'a + b')
    expect(fn(1, 2)).toBe(3)
    expect(() => compileExpr(['a'], 'a +')).toThrow(SyntaxError)
  })
})

describe('compileFunctionBody（函数体）', () => {
  test('语句序列 + return 求值正确，构造期即暴露语法错误', () => {
    const fn = compileFunctionBody(
      ['rows'],
      'let total = 0\nfor (const r of rows) total += r.qty\nreturn total',
    )
    expect(fn([{ qty: 2 }, { qty: 3 }])).toBe(5)
    expect(() => compileFunctionBody([], 'return (')).toThrow(SyntaxError)
  })

  test('缺 return 的函数体语法合法但返回 undefined（return 把关在 normalize 层）', () => {
    expect(compileFunctionBody([], '1 + 1')()).toBeUndefined()
  })
})

describe('evaluateExpr（单表达式）', () => {
  test('多形参求值 + what 前缀错误消息', () => {
    expect(evaluateExpr('测试', ['x', 'y'], [2, 3], 'x * y')).toBe(6)
    try {
      evaluateExpr('测试', ['x'], [1], 'x.')
      expect.unreachable()
    } catch (error) {
      expect((error as ExprError).phase).toBe('compile')
      expect((error as Error).message).toContain('测试编译失败')
    }
    try {
      evaluateExpr('测试', ['x'], [{} as never], 'x.a.b.c')
      expect.unreachable()
    } catch (error) {
      expect((error as ExprError).phase).toBe('runtime')
      expect((error as Error).message).toContain('测试求值失败')
    }
  })

  test('严格模式：未声明赋值直接抛错', () => {
    expect(() => evaluateExpr('测试', [], [], 'leak = 1')).toThrow(ExprError)
  })

  test('入参按引用传入（只读约定：不做防御性拷贝）', () => {
    const rows = [{ v: 1 }]
    expect(evaluateExpr('测试', ['rows'], [rows], 'rows[0].v')).toBe(1)
    evaluateExpr('测试', ['rows'], [rows], 'rows[0].v = 99')
    expect(rows[0]!.v).toBe(99)
  })
})

describe('evaluateFunctionBody（函数体）', () => {
  test('多语句函数体求值 + 错误分类与 what 前缀同单表达式口径', () => {
    expect(
      evaluateFunctionBody('测试', ['rows'], [[1, 2, 3]], 'const n = rows.length\nreturn n * 2'),
    ).toBe(6)
    try {
      evaluateFunctionBody('测试', [], [], 'return (')
      expect.unreachable()
    } catch (error) {
      expect((error as ExprError).phase).toBe('compile')
      expect((error as Error).message).toContain('测试编译失败')
    }
    try {
      evaluateFunctionBody('测试', [], [], 'return null.x')
      expect.unreachable()
    } catch (error) {
      expect((error as ExprError).phase).toBe('runtime')
      expect((error as Error).message).toContain('测试求值失败')
    }
  })
})
