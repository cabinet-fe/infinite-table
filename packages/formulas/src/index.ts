// @infinitable/formulas 公共入口（唯一；显式导出，禁止 export *）。
//
// 公式引擎 v1：A1 地址 / Pratt 解析 / 求值 / 49 个内置函数 / 7 种错误值 / 函数注册表
// 元数据查询 / 依赖图（DependencyGraph，宿主驱动增量重算）/ 容错引用扫描（编辑染色框用）。
// 四则与 SUM/AVERAGE/ROUND/ABS 走 @cat-kit/core 的 $n 精确计算（结果仍 JS number）。
// 导出判据同 core：仓内非测试消费（playground / 跨包公共入口）或红线文档面；分词 /
// AST 细节 / 强制转换原语 / 注册表写入（registerFormulaFunction）为包内深路径能力，不占公共面。
//
// v1 明确不做（后续单独立项）：
// - 循环引用检测（#CYCLE! 枚举保留，宿主递归护栏可产出）；
// - 数组公式（区域作为最终结果求值为 #VALUE!）。

import './functions'

export { colLetters, createRangeRef, formatCellRef, formatRangeRef, parseCellRef } from './address'
export type { CellRef } from './address'

export { formulaError, isFormulaError } from './errors'
export type { FormulaError } from './errors'

export { FormulaParseError } from './tokenizer'

export type { AstNode } from './ast'

export { parseFormula } from './parser'

export { astHasVolatileCall, collectAstReferences } from './ast-refs'

export { DependencyGraph } from './dependency-graph'
export type { FormulaRefCoord, SheetCellCoord } from './dependency-graph'

export { scanFormulaReferences } from './scan-refs'

export { evaluate } from './evaluator'
export type { FormulaResolver, ScalarValue } from './evaluator'

export {
  FORMULA_FUNCTION_CATEGORIES,
  getFormulaFunctionInfo,
  listFormulaFunctions,
} from './functions/registry'
export type { FormulaFunctionInfo } from './functions/registry'
