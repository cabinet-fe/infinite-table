---
title: formulas 公式引擎
description: infinitable 公式引擎：A1 地址系统（parseCellRef/formatCellRef/colLetters）、tokenizeFormula 分词 + parseFormula Pratt 解析、evaluate/evaluateAst 求值（FormulaResolver 宿主取值）、49 个内置函数注册表（registerFormulaFunction/listFormulaFunctions）、7 种错误值、DependencyGraph 依赖图增量重算与 scanFormulaReferences 容错引用扫描。四则与 SUM/AVERAGE/ROUND/ABS 走 @cat-kit/core $n 精确计算。
aliases: [Formula, 公式, 公式引擎, formula, evaluate, A1]
keywords: [evaluate, parseFormula, parseCellRef, formatCellRef, colLetters, formatRangeRef, FormulaError, FORMULA_ERROR_CODES, "#DIV/0!", "#VALUE!", "#NAME?", DependencyGraph, affectedBy, scanFormulaReferences, registerFormulaFunction, FormulaResolver, SUM, 依赖图, 求值, 跨表引用]
---

# formulas 公式引擎

`infinitable`（formulas 层）导出公式引擎：A1 地址系统（0 基坐标 + `$` 绝对标记 + 跨表名）、分词器与 Pratt 解析器、纯函数求值器（单元格读取经 `FormulaResolver` 由宿主注入）、49 个内置函数的注册表（大小写不敏感、可扩展）、7 种错误值体系、依赖图（公式格 → 静态引用的反向索引，宿主驱动增量重算）与容错引用扫描（编辑染色框用）。四则与 SUM/AVERAGE/ROUND/ABS 走 `@cat-kit/core` 的 `$n` 精确计算（结果仍 JS number）。v1 不做：循环引用检测（`#CYCLE!` 枚举保留）、数组公式（区域作为最终结果求值为 `#VALUE!`）。

## 快速上手

```ts
import { evaluate, isFormulaError } from 'infinitable'

// 求值公式文本（不含前导 '='）；单元格读取经 resolver 注入
const result = evaluate('SUM(A1:A3) * 2', {
  cell: () => null, // 单格读取（本公式的取值走区域）
  range: () => [1, 2, 3], // A1:A3 展开为 [1, 2, 3]
})
console.log(result) // => 12

const bad = evaluate('1/0', { cell: () => null, range: () => [] })
console.log(isFormulaError(bad) ? bad.code : bad) // => '#DIV/0!'
```

## API 签名

```ts
// ---- A1 地址系统（坐标统一 0 基：{ col: 0, row: 0 } 即 A1） ----

/** 单元格引用（0 基坐标 + 绝对标记 + 可选跨表名） */
export interface CellRef {
  /** 跨表引用表名；缺省 = 公式所在表（由宿主 resolver 决定缺省表） */
  sheet?: string
  col: number
  row: number
  /** `$A1` 形态：列绝对 */
  colAbsolute: boolean
  /** `A$1` 形态：行绝对 */
  rowAbsolute: boolean
}

/** 区域引用（闭区间，经规范化：start ≤ end） */
export interface RangeRef {
  sheet?: string
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 0 基列号 → 列字母：0 → 'A'，26 → 'AA'；非负整数之外抛 RangeError */
export function colLetters(col: number): string
/** 列字母 → 0 基列号：'A' → 0；非法返回 -1 */
export function parseColLetters(letters: string): number
/** 解析 A1 记法（兼容 $A$1）→ CellRef；非法返回 null */
export function parseCellRef(text: string): CellRef | null
/** CellRef → A1 记法（含 $ 与跨表前缀） */
export function formatCellRef(ref: CellRef): string
/** 表名格式化：裸表名安全字符直出，其余加单引号（'' 转义字面单引号） */
export function formatSheetName(name: string): string
/** 由两个角点构造规范化区域（start ≤ end；sheet 取起点引用） */
export function createRangeRef(a: CellRef, b: CellRef): RangeRef
/** 区域 → 记法：单格 → 'B2'，多格 → 'B2:D5' */
export function formatRangeRef(ref: RangeRef): string

// ---- 错误值体系 ----

/** 公式错误码（Excel 子集 + 解析失败 #ERROR!、循环引用 #CYCLE!） */
export const FORMULA_ERROR_CODES = [
  '#DIV/0!', '#VALUE!', '#NAME?', '#REF!', '#N/A', '#ERROR!', '#CYCLE!',
] as const
export type FormulaErrorCode = (typeof FORMULA_ERROR_CODES)[number]

/** 求值过程中的错误标记（遇运算即传播，左操作数优先） */
export interface FormulaError {
  readonly code: FormulaErrorCode
}
export function formulaError(code: FormulaErrorCode): FormulaError
export function isFormulaError(value: unknown): value is FormulaError
export function isFormulaErrorCode(value: unknown): value is FormulaErrorCode

// ---- 分词与解析 ----

/** 解析失败异常（evaluate 捕获 → 求值结果 #ERROR!；name 为 FormulaParseError） */
export class FormulaParseError extends Error

export type FormulaOperator =
  | '+' | '-' | '*' | '/' | '^' | '&' | '%' | '(' | ')' | ',' | '!' | ':'
  | '=' | '<>' | '<' | '<=' | '>' | '>='

export type FormulaToken =
  | { type: 'number'; value: number; raw: string }
  | { type: 'string'; value: string }
  | { type: 'ident'; name: string }
  | { type: 'quoted-name'; name: string }
  | { type: 'error'; code: FormulaErrorCode }
  | { type: 'op'; op: FormulaOperator }

export function tokenizeFormula(text: string): FormulaToken[]
export function parseFormula(text: string): AstNode
export type AstNode = /* 字面量/引用/一元/二元/调用 等判别联合 */
export type BinaryOperator = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>='

// ---- AST 引用收集 ----

export type AstReference = { kind: 'cell'; ref: CellRef } | { kind: 'range'; ref: RangeRef }
export function collectAstReferences(node: AstNode): AstReference[]
/** 含易失性函数调用（TODAY/NOW/RAND/RANDBETWEEN）判定 */
export function astHasVolatileCall(node: AstNode): boolean

// ---- 依赖图 ----

export interface SheetCellCoord {
  sheet: string
  col: number
  row: number
}
export interface SheetRangeCoord {
  sheet: string
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}
export type FormulaRefCoord =
  | { kind: 'cell'; ref: SheetCellCoord }
  | { kind: 'range'; ref: SheetRangeCoord }

export class DependencyGraph {
  setFormula(cell: SheetCellCoord, refs: readonly FormulaRefCoord[], options?: { volatile?: boolean }): void
  /** 移除公式格（被覆盖为字面量/清空）；非公式格为空操作 */
  remove(cell: SheetCellCoord): void
  /** 移除整表：该表全部公式格 + 其它表公式指向该表的边 */
  removeSheet(sheet: string): void
  /** 变更传递闭包：直接或间接依赖 changed 中任一格的公式格（去重；环上格也会出现） */
  affectedBy(changed: Iterable<SheetCellCoord>): SheetCellCoord[]
  /** 易失公式格快照（任意变更后宿主把它们标脏） */
  volatileCells(): SheetCellCoord[]
  has(cell: SheetCellCoord): boolean
  get size(): number
}

// ---- 容错引用扫描 ----

/** 扫描到的引用：ref 为解析结果；start/end 为原文本字符偏移（end 排他），span 含表名前缀 */
export interface ScannedReference {
  ref: CellRef | RangeRef
  isRange: boolean
  start: number
  end: number
}
/** 扫描公式文本中的引用片段（容错：编辑中的半截公式不抛错，未闭合字符串/区域尾巴扫到多少算多少） */
export function scanFormulaReferences(text: string): ScannedReference[]

// ---- 求值器 ----

/** 标量值（null = 空单元格） */
export type ScalarValue = number | string | boolean | null
/** 求值结果：标量 / 错误 / 区域展开数组（数组仅作为函数参数形态出现） */
export type EvalValue = ScalarValue | FormulaError | (ScalarValue | FormulaError)[]

/** 宿主取值接口（求值的唯一外部依赖） */
export interface FormulaResolver {
  cell(ref: CellRef): unknown
  /** 读区域：先行后列展开 */
  range(ref: RangeRef): unknown[]
}

export interface EvaluateOptions {
  /** 公式所在表名：填入缺省 sheet 的引用后传给 resolver */
  sheet?: string
  /** 公式所在格（ROW()/COLUMN() 省参语义）；缺省 { col: 0, row: 0 } */
  cell?: { col: number; row: number }
}

export interface FormulaEvalContext {
  readonly currentSheet: string | undefined
  readonly currentCell: { col: number; row: number }
  readCell(ref: CellRef): ScalarValue | FormulaError
  readRange(ref: RangeRef): (ScalarValue | FormulaError)[] | FormulaError
  callFunction(
    name: string,
    nodes: AstNode[],
    evalNode: (node: AstNode) => EvalValue,
    ctx?: FormulaEvalContext,
  ): EvalValue
}

export function evaluate(
  formula: string,
  resolver: FormulaResolver,
  options?: EvaluateOptions,
): number | string | boolean | FormulaError
export function evaluateAst(node: AstNode, ctx: FormulaEvalContext): EvalValue
export function coerceToNumber(value: EvalValue): number | FormulaError
export function coerceToText(value: EvalValue): string | FormulaError
export function coerceToBoolean(value: EvalValue): boolean | FormulaError

// ---- 函数注册表 ----

export type FormulaFunctionCategory =
  | '常用' | '财务' | '日期与时间' | '数学' | '统计' | '查找与引用' | '文本' | '逻辑'

export const FORMULA_FUNCTION_CATEGORIES: readonly FormulaFunctionCategory[]

export interface FormulaFunctionParam {
  name: string
  optional?: boolean
}
export interface FormulaFunctionMeta {
  description: string
  category: FormulaFunctionCategory
  params: FormulaFunctionParam[]
}
export interface FormulaFunctionInfo {
  name: string
  signature: string
  description: string
  category: FormulaFunctionCategory | undefined
  params: FormulaFunctionParam[]
  volatile: boolean
}

export type FormulaFunction =
  | {
      kind?: 'normal'
      minArgs?: number
      maxArgs?: number
      volatile?: boolean
      meta?: FormulaFunctionMeta
      impl: (args: EvalValue[], ctx?: FormulaEvalContext) => EvalValue
    }
  | {
      /** lazy 函数自行求值参数（IF 的短路分支、查找函数的区域几何回读） */
      kind: 'lazy'
      minArgs?: number
      maxArgs?: number
      volatile?: boolean
      meta?: FormulaFunctionMeta
      impl: (
        nodes: AstNode[],
        evalNode: (node: AstNode) => EvalValue,
        ctx?: FormulaEvalContext,
      ) => EvalValue
    }

export function registerFormulaFunction(name: string, def: FormulaFunction): void
export function getFormulaFunction(name: string): FormulaFunction | undefined
export function getFormulaFunctionInfo(name: string): FormulaFunctionInfo | undefined
export function listFormulaFunctions(): FormulaFunctionInfo[]
export function isVolatileFormulaFunction(name: string): boolean
export function invokeFormulaFunction(
  name: string,
  nodes: AstNode[],
  evalNode: (node: AstNode) => EvalValue,
  ctx?: FormulaEvalContext,
): EvalValue
export function formatFunctionSignature(
  name: string,
  params: readonly FormulaFunctionParam[],
): string
```

49 个内置函数（按名称升序）：ABS AND AVERAGE CHOOSE COLUMN CONCATENATE COUNT COUNTA COUNTBLANK COUNTIF EXACT FALSE FV HLOOKUP IF IFERROR INDEX IPMT LARGE LEFT LEN LOWER MATCH MAX MEDIAN MID MIN NOT NOW OR PMT PPMT PV RAND RANDBETWEEN RANK REPLACE RIGHT ROUND ROW SMALL SUBSTITUTE SUM TODAY TRIM TRUE UPPER VLOOKUP XOR。易失函数：NOW、RAND、RANDBETWEEN、TODAY。

## 参数说明

`evaluate(formula, resolver, options?)`：

| 参数 | 类型 | 默认 | 必填 | 约束 |
| --- | --- | --- | :---: | --- |
| `formula` | `string` | — | 是 | 公式体，**不含前导 `=`**（宿主剥离后传入） |
| `resolver` | `FormulaResolver` | — | 是 | 实现约定：空格返回 null/undefined；不抛错（未知表等失败回落 `formulaError('#REF!')` 由引擎转换） |
| `options.sheet` | `string` | 保持 undefined | 否 | 填入裸引用的 `sheet` 后传给 resolver |
| `options.cell` | `{col, row}` | `{0, 0}` | 否 | 公式所在格（ROW()/COLUMN() 省参语义） |

`registerFormulaFunction(name, def)`：名称大小写不敏感；同名覆盖（扩展/自定义）；`meta` 缺省时候选仅显示函数名、不出现在分类面板。

`colLetters(col)`：`col` 必须是非负整数，否则抛 `RangeError: 列号必须是非负整数: <col>`。

`parseCellRef` 正则口径：`^(\$?)([A-Za-z]+)(\$?)([1-9]\d*)$`（行号从 1 起、不允许 0 行）；非法返回 null。

`FormulaRefCoord` 的 `sheet` 必须已被宿主解析为规范 id（裸引用由宿主填公式所在表）。

## 方法与事件

`evaluate(formula, resolver, options): number | string | boolean | FormulaError` — 同步纯函数：

- 解析失败（`FormulaParseError`）→ `#ERROR!`（不抛异常）。
- 区域作为最终结果（非函数参数）→ `#VALUE!`（v1 不做数组公式）。
- 空格引用作为终值按 Excel 观感返回 `0`。
- 四则 `+ - * /` 与 `^`：走 `$n` 精确计算（结果仍 JS number）；`=1/0` → `#DIV/0!`；`0^负数` → `#DIV/0!`；`^` 结果非有限 → `#VALUE!`。
- `&` 文本连接；比较运算 `= <> < <= > >=`（文本大小写不敏感；混合类型 数字 < 文本 < 布尔；null 归一为对方零值）。
- 空格（null）参与运算规则同 Excel：数字上下文按 0、文本上下文按 `''`、布尔上下文按 FALSE；空字符串字面量参与算术 → `#VALUE!`。
- 错误值遇运算即传播（左操作数优先）。

`coerceToNumber(value)`：null→0；布尔→1/0；数字文本→数字；`TRUE`/`FALSE` 文本→1/0；其余文本→`#VALUE!`；数组→`#VALUE!`；错误传播。`coerceToText`：null→`''`；布尔→`TRUE`/`FALSE`；数字→String。`coerceToBoolean`：null→false；数字≠0；`TRUE`/`FALSE` 文本；其余文本→`#VALUE!`。

`invokeFormulaFunction`：名称未知 → `#NAME?`；参数个数少于 `minArgs` 或多于 `maxArgs` → `#VALUE!`；`kind: 'lazy'` 分发 `(nodes, evalNode, ctx)`，normal 先逐参求值再分发 `(args, ctx)`。

`DependencyGraph`：

- `setFormula(cell, refs, options?)` — 全量替换该格旧边（先清后建）；`refs` 去重；`volatile: true` 记入易失集。
- `affectedBy(changed)` — 变更传递闭包：直接或间接依赖 `changed` 中任一格的公式格（去重；公式格自身被引用会继续扩散；环上格也会出现）——宿主据此标脏级联重算。
- `volatileCells()` — 易失公式格快照（任意变更后宿主把它们一并标脏）。
- `remove(cell)` / `removeSheet(sheet)` / `has(cell)` / `size`。

`scanFormulaReferences(text)` — 容错扫描：输入含/不含前导 `=` 均可、永不抛错；产物 `{ ref, isRange, start, end }`（偏移 end 排他、span 含表名前缀），供编辑器引用染色框定位。

## 典型示例

### A1 地址工具（报表地址解析）

```ts
import {
  colLetters,
  createRangeRef,
  formatCellRef,
  formatRangeRef,
  parseCellRef,
} from 'infinitable'

console.log(parseCellRef('$B$3')) // => { col: 1, row: 2, colAbsolute: true, rowAbsolute: true }
console.log(parseCellRef('Sheet2!A1')) // 裸表名 + ! 前缀由 tokenize/parse 处理；parseCellRef 只认纯 A1 记法 → null
console.log(parseCellRef('B0')) // => null（行号从 1 起）
console.log(formatCellRef({ col: 2, row: 4, colAbsolute: false, rowAbsolute: true, sheet: 'Sheet 2' })) // => "'Sheet 2'!C$5"
console.log(colLetters(26)) // => 'AA'
const range = createRangeRef(
  { col: 3, row: 1, colAbsolute: false, rowAbsolute: false },
  { col: 1, row: 4, colAbsolute: false, rowAbsolute: false },
)
console.log(formatRangeRef(range)) // => 'B2:D5'（自动归一化）
```

### 自定义公式函数注册

```ts
import {
  evaluate,
  formatFunctionSignature,
  formulaError,
  listFormulaFunctions,
  registerFormulaFunction,
} from 'infinitable'

registerFormulaFunction('DOUBLE', {
  impl: (args) => {
    return typeof args[0] === 'number' ? args[0] * 2 : formulaError('#VALUE!')
  },
  minArgs: 1,
  maxArgs: 1,
  meta: {
    description: '数值翻倍',
    category: '数学',
    params: [{ name: 'number' }],
  },
})

const resolver = { cell: () => 21, range: () => [] }
console.log(evaluate('DOUBLE(A1)', resolver)) // => 42（A1 取 21）
console.log(formatFunctionSignature('DOUBLE', [{ name: 'number' }])) // => 'DOUBLE(number)'
console.log(listFormulaFunctions().length) // => 50（49 内置 + 1 自定义）
```

### 依赖图驱动增量重算

```ts
import {
  collectAstReferences,
  DependencyGraph,
  evaluate,
  parseFormula,
} from 'infinitable'

const values = new Map<string, number>([
  ['0,0', 10], // A1
  ['0,1', 20], // A2
])
const resolver = {
  cell: (ref: { col: number; row: number }) => values.get(`${ref.col},${ref.row}`) ?? null,
  range: () => [],
}

const graph = new DependencyGraph()
/** 公式所在格 B1（{col:1,row:0}）：=SUM(A1:A2) */
const ast = parseFormula('SUM(A1:A2)')
const refs = collectAstReferences(ast).map((r) =>
  r.kind === 'range'
    ? { kind: 'range' as const, ref: { sheet: 'Sheet1', ...r.ref } }
    : { kind: 'cell' as const, ref: { sheet: 'Sheet1', ...r.ref } },
)
graph.setFormula({ sheet: 'Sheet1', col: 1, row: 0 }, refs)

// A1（{col:0,row:0}）变更 → 传递闭包找到受影响公式格并重算
values.set('0,0', 100)
for (const dependent of graph.affectedBy([{ sheet: 'Sheet1', col: 0, row: 0 }])) {
  const result = evaluate('SUM(A1:A2)', resolver, { sheet: dependent.sheet })
  console.log(dependent, result) // => { sheet: 'Sheet1', col: 1, row: 0 } 120
}
```

## 注意事项

> [!WARNING]
> - `evaluate` 的入参不含前导 `=`：宿主剥离 `=` 后传入（`=SUM(A1)` 传入 `SUM(A1)`）；传带 `=` 的文本会得到 `#ERROR!`。
> - 本库 `CellRef`（formulas）是 A1 引用（含 `colAbsolute`/`rowAbsolute`/`sheet`），与 core 的格坐标（统一入口别名 `GridCellRef`，仅 `{col, row}`）是不同类型；跨层换算时自行映射。
> - 坐标一律 0 基：`{ col: 0, row: 0 }` 是 A1；`parseCellRef('B3')` 返回 `{ col: 1, row: 2 }`。
> - 求值是纯函数：不做循环引用检测（互相引用会栈溢出，宿主须用 DependencyGraph 自建递归护栏，可产出 `#CYCLE!`）；不做数组公式（区域终值 `#VALUE!`）。
> - 函数注册表是模块级全局（大小写不敏感、同名覆盖）：跨表/多实例共享同一注册表，测试间注册会互相可见。
> - `FormulaResolver.cell/range` 约定不抛错：抛错由引擎捕获并转为 `#REF!`。
> - `registerFormulaFunction` 后自定义函数未带 `meta` 时不出现在分类列表，但 `getFormulaFunction`/求值可命中。

## 常见问题

### evaluate 返回 FormulaError 对象而不是值

原因：公式求值产出错误标记（解析失败/除零/未知函数/类型不匹配）。修复：用 `isFormulaError` 判定并读 `code`。

```ts
import { evaluate, isFormulaError } from 'infinitable'

const resolver = { cell: () => null, range: () => [] }
const result = evaluate('SUM(1, 2) / 0', resolver)
if (isFormulaError(result)) {
  console.log(result.code) // => '#DIV/0!'
} else {
  console.log(result)
}
```

### 自定义函数名带小写查不到 / 覆盖了内置函数

原因：注册表按名称大写存取（大小写不敏感）；注册 `sum` 会覆盖内置 `SUM`。修复：自定义函数避开内置 49 个名称，或确认要覆盖。

```ts
import { getFormulaFunctionInfo, registerFormulaFunction } from 'infinitable'

registerFormulaFunction('myround', {
  impl: (args) => (typeof args[0] === 'number' ? Math.ceil(args[0]) : 0),
  minArgs: 1,
  maxArgs: 1,
})
console.log(getFormulaFunctionInfo('MYROUND')?.name) // => 'MYROUND'（存储名大写）
```
