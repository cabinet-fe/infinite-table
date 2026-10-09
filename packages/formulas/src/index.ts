// @infinitable/formulas 公共入口（唯一；显式导出，禁止 export *）。
//
// 公式引擎 v1：A1 地址 / Pratt 解析 / 求值 / 49 个内置函数 / 7 种错误值 / 函数注册表
// 元数据查询 / 依赖图（DependencyGraph，宿主驱动增量重算）/ 容错引用扫描（编辑染色框用）/
// 引用平移（行列插删时改写公式文本，sheet 模型消费；填充柄增量平移同源；tokenText 随引用级文本改出一并公共化）。
// 四则与 SUM/AVERAGE/ROUND/ABS 走 @cat-kit/core 的 $n 精确计算（结果仍 JS number）。
// 导出判据同 core：仓内非测试消费（playground / 跨包公共入口）或红线文档面；分词 /
// AST 细节 / 强制转换原语为包内深路径能力，不占公共面。函数注册表写入
// （registerFormulaFunction / getFormulaFunction）与求值上下文类型（FormulaEvalContext）
// 随 @infinitable/sheet 模型层落地公共化：sheet 侧自定义函数（易失性探针等）与
// 公式口径等价测试需要经公共面注册；#CYCLE! 检测与增量重算编排在 sheet 适配层。
//
// v1 明确不做（后续单独立项）：
// - 循环引用检测（#CYCLE! 枚举保留，宿主递归护栏可产出）；
// - 数组公式（区域作为最终结果求值为 #VALUE!）。

import './functions'

export { colLetters, createRangeRef, formatCellRef, formatRangeRef, parseCellRef } from './address'
export type { CellRef } from './address'

export { formulaError, isFormulaError, isFormulaErrorCode } from './errors'
export type { FormulaError } from './errors'

export { FormulaParseError, tokenText } from './tokenizer'

export type { AstNode } from './ast'

export { parseFormula } from './parser'

export { astHasVolatileCall, collectAstReferences } from './ast-refs'

export { DependencyGraph } from './dependency-graph'
export type { FormulaRefCoord, SheetCellCoord } from './dependency-graph'

export { scanFormulaReferences } from './scan-refs'

export { shiftFormulaText, shiftFormulaRefs } from './shift'
export type { FormulaShiftResult } from './shift'

export { evaluate } from './evaluator'
export type { FormulaEvalContext, FormulaResolver, ScalarValue } from './evaluator'

export {
  FORMULA_FUNCTION_CATEGORIES,
  getFormulaFunction,
  getFormulaFunctionInfo,
  listFormulaFunctions,
  registerFormulaFunction,
} from './functions/registry'
export type {
  FormulaFunction,
  FormulaFunctionCategory,
  FormulaFunctionInfo,
} from './functions/registry'
