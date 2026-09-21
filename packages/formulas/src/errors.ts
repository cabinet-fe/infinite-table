// 公式错误值体系：求值器内部以 FormulaError 标记对象传递错误（随运算传播，左操作数优先）。
// `#CYCLE!` 为循环引用保留枚举（v1 无依赖图/循环检测，宿主递归护栏可产出）。

/** 公式错误码（Excel 子集 + 解析失败 #ERROR!、循环引用 #CYCLE!） */
export const FORMULA_ERROR_CODES = [
  '#DIV/0!',
  '#VALUE!',
  '#NAME?',
  '#REF!',
  '#N/A',
  '#ERROR!',
  '#CYCLE!',
] as const

export type FormulaErrorCode = (typeof FORMULA_ERROR_CODES)[number]

const ERROR_BRAND: unique symbol = Symbol('infinite-table.formula-error')

/** 求值过程中的错误标记（不参与普通值运算，遇运算即传播） */
export interface FormulaError {
  readonly [ERROR_BRAND]: true
  readonly code: FormulaErrorCode
}

/** 构造错误标记 */
export function formulaError(code: FormulaErrorCode): FormulaError {
  return { [ERROR_BRAND]: true, code }
}

/** 判定错误标记 */
export function isFormulaError(value: unknown): value is FormulaError {
  return typeof value === 'object' && value !== null && ERROR_BRAND in value
}

/** 判定合法错误码 */
export function isFormulaErrorCode(value: unknown): value is FormulaErrorCode {
  return typeof value === 'string' && (FORMULA_ERROR_CODES as readonly string[]).includes(value)
}
