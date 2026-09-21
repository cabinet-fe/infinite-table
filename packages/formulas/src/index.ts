// @infinite-table/formulas 公共入口（唯一；显式导出，禁止 export *）。
//
// 公式引擎 v1：A1 解析 / 分词 / Pratt 解析 / 求值 / 47 个内置函数 / 7 种错误值 / 函数注册表元数据
// / 依赖图（DependencyGraph，宿主驱动增量重算）/ 容错引用扫描（编辑染色框用）。
// 四则与 SUM/AVERAGE/ROUND/ABS 走 @cat-kit/core 的 $n 精确计算（结果仍 JS number）。
//
// v1 明确不做（后续单独立项）：
// - 循环引用检测（#CYCLE! 枚举保留，宿主递归护栏可产出）；
// - 数组公式（区域作为最终结果求值为 #VALUE!）。

import './functions'

export {
  colLetters,
  createRangeRef,
  formatCellRef,
  formatRangeRef,
  formatSheetName,
  parseCellRef,
  parseColLetters,
} from './address'
export type { CellRef, RangeRef } from './address'

export { FORMULA_ERROR_CODES, formulaError, isFormulaError, isFormulaErrorCode } from './errors'
export type { FormulaError, FormulaErrorCode } from './errors'

export { FormulaParseError, tokenizeFormula } from './tokenizer'
export type { FormulaOperator, FormulaToken } from './tokenizer'

export type { AstNode, BinaryOperator } from './ast'

export { parseFormula } from './parser'

export { astHasVolatileCall, collectAstReferences } from './ast-refs'
export type { AstReference } from './ast-refs'

export { DependencyGraph } from './dependency-graph'
export type { FormulaRefCoord, SheetCellCoord, SheetRangeCoord } from './dependency-graph'

export { scanFormulaReferences } from './scan-refs'
export type { ScannedReference } from './scan-refs'

export { coerceToBoolean, coerceToNumber, coerceToText, evaluate, evaluateAst } from './evaluator'
export type {
  EvalValue,
  EvaluateOptions,
  FormulaEvalContext,
  FormulaResolver,
  ScalarValue,
} from './evaluator'

export {
  FORMULA_FUNCTION_CATEGORIES,
  formatFunctionSignature,
  getFormulaFunction,
  getFormulaFunctionInfo,
  invokeFormulaFunction,
  isVolatileFormulaFunction,
  listFormulaFunctions,
  registerFormulaFunction,
} from './functions/registry'
export type {
  FormulaFunction,
  FormulaFunctionCategory,
  FormulaFunctionInfo,
  FormulaFunctionMeta,
  FormulaFunctionParam,
} from './functions/registry'
