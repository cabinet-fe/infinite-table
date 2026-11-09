// 通用受限 JS 求值管线：重塑（reshape）、聚合（aggregation）、单元格函数
// （cell-function）三方共用。两种形态：
// - 单表达式（compileExpr/evaluateExpr）：重塑与单元格函数，表达式值即求值结果；
// - 函数体（compileFunctionBody/evaluateFunctionBody）：聚合，语句序列、必须自带
//   return，调用返回值即求值结果。
//
// 受限求值口径（与重塑管线同源）：new Function 包裹 + 明确形参白名单——表达式体内
// 只能访问声明过的形参与语言内建（Math/JSON 等），严格模式求值（this 为 undefined、
// 未声明赋值直接抛错）。这是同源用户自写表达式的受限求值，不是硬安全沙箱。
// 求值环境按只读约定共享：入参按引用传入，用户表达式承诺不做原地改写。
import { describeError } from '../errors'

/** 表达式错误：compile 为编译失败，runtime 为求值期抛错；供编辑与预览 UI 呈现 */
export class ExprError extends Error {
  readonly phase: 'compile' | 'runtime'

  constructor(phase: 'compile' | 'runtime', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ExprError'
    this.phase = phase
  }
}

/** 已编译表达式：形参与 new Function 声明一一对应 */
export type CompiledExpr = (...args: unknown[]) => unknown

/** 编译单表达式：函数体只在调用时执行，构造期即暴露语法错误 */
export function compileExpr(argNames: readonly string[], expression: string): CompiledExpr {
  // 受限求值口径即任务书点名的 new Function 包裹（见文件头注），非隐式 eval 误用
  // oxlint-disable-next-line typescript/no-implied-eval
  return new Function(...argNames, `"use strict";\nreturn (\n${expression}\n);`) as CompiledExpr
}

/** 编译函数体：body 是语句序列（必须自带 return），构造期即暴露语法错误 */
export function compileFunctionBody(argNames: readonly string[], body: string): CompiledExpr {
  // 受限求值口径同 compileExpr（见文件头注），非隐式 eval 误用
  // oxlint-disable-next-line typescript/no-implied-eval
  return new Function(...argNames, `"use strict";\n${body}`) as CompiledExpr
}

/**
 * 求值一次（单表达式）：编译 + 严格模式执行。入参按引用传入（求值环境按只读
 * 约定共享，不做防御性拷贝——用户表达式承诺不改写入参）。
 * 编译/求值失败统一抛 ExprError（phase 区分），message 带 what 前缀定位来源。
 */
export function evaluateExpr(
  what: string,
  argNames: readonly string[],
  args: readonly unknown[],
  expression: string,
): unknown {
  return runCompiled(what, () => compileExpr(argNames, expression), args)
}

/** 求值一次（函数体）：错误分类与 what 前缀口径与 evaluateExpr 一致 */
export function evaluateFunctionBody(
  what: string,
  argNames: readonly string[],
  args: readonly unknown[],
  body: string,
): unknown {
  return runCompiled(what, () => compileFunctionBody(argNames, body), args)
}

/** 编译 + 严格模式执行的公共落点：ExprError 分类（compile/runtime）+ what 前缀 */
function runCompiled(what: string, compile: () => CompiledExpr, args: readonly unknown[]): unknown {
  let evaluate: CompiledExpr
  try {
    evaluate = compile()
  } catch (error) {
    throw new ExprError('compile', `${what}编译失败：${describeError(error)}`, { cause: error })
  }
  try {
    return evaluate(...args)
  } catch (error) {
    throw new ExprError('runtime', `${what}求值失败：${describeError(error)}`, { cause: error })
  }
}
