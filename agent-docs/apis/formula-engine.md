---
title: formulas 公式引擎
description: infinitable 公式引擎：A1 地址系统（parseCellRef/formatCellRef/colLetters/createRangeRef）、parseFormula Pratt 解析、evaluate 求值（FormulaResolver 宿主取值注入）、函数注册表读写（49 个内置函数元数据查询 + registerFormulaFunction 自定义函数注册）、7 种错误值（isFormulaErrorCode 错误码判定）、DependencyGraph 依赖图增量重算与按表查询（formulasOf/affectedBySheet）、shiftFormulaText 引用平移与 scanFormulaReferences 容错引用扫描。四则与 SUM/AVERAGE/ROUND/ABS 走 @cat-kit/core $n 精确计算。
aliases: [Formula, 公式, 公式引擎, formula, evaluate, A1, registerFormulaFunction, tokenizeFormula]
keywords: [evaluate, parseFormula, parseCellRef, formatCellRef, colLetters, formatRangeRef, createRangeRef, FormulaError, formulaError, isFormulaError, isFormulaErrorCode, FormulaParseError, "#DIV/0!", "#VALUE!", "#NAME?", DependencyGraph, affectedBy, affectedBySheet, formulasOf, scanFormulaReferences, collectAstReferences, listFormulaFunctions, getFormulaFunctionInfo, registerFormulaFunction, getFormulaFunction, FormulaFunction, FormulaEvalContext, FormulaResolver, shiftFormulaText, SUM, 依赖图, 求值, 跨表引用, 自定义函数, 引用平移]
---

# formulas 公式引擎

`infinitable`（formulas 层）导出公式引擎：A1 地址系统（0 基坐标 + `$` 绝对标记 + 跨表名）、Pratt 解析器（`parseFormula`）、纯函数求值器（`evaluate`，单元格读取经 `FormulaResolver` 由宿主注入）、函数注册表（49 个内置函数元数据查询 + `registerFormulaFunction` 自定义函数注册，大小写不敏感、同名覆盖）、7 种错误值体系（`isFormulaErrorCode` 错误码判定）、依赖图（公式格 → 静态引用的反向索引，宿主驱动增量重算；`formulasOf`/`affectedBySheet` 按表查询）、引用平移（`shiftFormulaText`：行列插删时 token 级改写公式文本，`@infinitable/sheet` 模型消费）与容错引用扫描（编辑染色框用）。四则与 SUM/AVERAGE/ROUND/ABS 走 `@cat-kit/core` 的 `$n` 精确计算（结果仍 JS number）。分词/AST 细节/强制转换原语（原 `tokenizeFormula`/`evaluateAst`/`coerceTo*`，0.1.2 起不再导出）为包内深路径能力；注册表写入（`registerFormulaFunction` 族）与求值上下文类型（`FormulaEvalContext`）已随 `@infinitable/sheet` 模型层落地公共化。v1 不做：循环引用检测（`#CYCLE!` 枚举保留）、数组公式（区域作为最终结果求值为 `#VALUE!`）。

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

/** 区域引用（闭区间，经规范化：start ≤ end；未导出为独立类型，createRangeRef/formatRangeRef 的出入参形态） */
interface RangeRef {
  sheet?: string
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}

/** 0 基列号 → 列字母：0 → 'A'，26 → 'AA'；非负整数之外抛 RangeError */
export function colLetters(col: number): string
/** 解析 A1 记法（兼容 $A$1）→ CellRef；非法返回 null */
export function parseCellRef(text: string): CellRef | null
/** CellRef → A1 记法（含 $ 与跨表前缀） */
export function formatCellRef(ref: CellRef): string
/** 由两个角点构造规范化区域（start ≤ end；sheet 取起点引用） */
export function createRangeRef(a: CellRef, b: CellRef): RangeRef
/** 区域 → 记法：单格 → 'B2'，多格 → 'B2:D5' */
export function formatRangeRef(ref: RangeRef): string

// ---- 错误值体系 ----

/**
 * 求值过程中的错误标记（遇运算即传播，左操作数优先）。
 * code 取值 7 种（错误码常量 0.1.2 起不再导出）：'#DIV/0!' | '#VALUE!' | '#NAME?' |
 * '#REF!' | '#N/A' | '#ERROR!' | '#CYCLE!'
 */
export interface FormulaError {
  readonly code:
    | '#DIV/0!'
    | '#VALUE!'
    | '#NAME?'
    | '#REF!'
    | '#N/A'
    | '#ERROR!'
    | '#CYCLE!'
}
export function formulaError(code: FormulaError['code']): FormulaError
export function isFormulaError(value: unknown): value is FormulaError
/** 判定是否 7 种错误码字符串之一 */
export function isFormulaErrorCode(value: unknown): value is FormulaError['code']

// ---- 解析 ----

/** 解析失败异常（evaluate 捕获 → 求值结果 #ERROR!；name 为 FormulaParseError） */
export class FormulaParseError extends Error

/** token → 文本（数字按原文保精度，字符串/引号表名补回转义；token 类型 FormulaToken 未单独导出，分词本身为深路径） */
export function tokenText(token: FormulaToken): string

export function parseFormula(text: string): AstNode
export type AstNode = /* 字面量/引用/一元/二元/调用 等判别联合（AST 细节类型未单独导出） */

// ---- AST 引用收集 ----

/** 收集 AST 的静态引用（产物形态 `{ kind: 'cell'; ref: CellRef } | { kind: 'range'; ref: RangeRef }`，未导出为独立类型） */
export function collectAstReferences(node: AstNode): ReadonlyArray<
  { kind: 'cell'; ref: CellRef } | { kind: 'range'; ref: RangeRef }
>
/** 含易失性函数调用（TODAY/NOW/RAND/RANDBETWEEN）判定 */
export function astHasVolatileCall(node: AstNode): boolean

// ---- 依赖图 ----

export interface SheetCellCoord {
  sheet: string
  col: number
  row: number
}
export type FormulaRefCoord =
  | { kind: 'cell'; ref: SheetCellCoord }
  | {
      kind: 'range'
      ref: { sheet: string; startCol: number; startRow: number; endCol: number; endRow: number }
    }

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
  /** 指定表的全部公式格坐标（副本；宿主 rebuildSheet / 改名重排用） */
  formulasOf(sheet: string): SheetCellCoord[]
  /** 反向边查询：直接或经区域引用指定表的全部公式格（去重，含该表上自引用本表的公式） */
  affectedBySheet(sheet: string): SheetCellCoord[]
  has(cell: SheetCellCoord): boolean
  get size(): number
}

// ---- 容错引用扫描 ----

/**
 * 扫描公式文本中的引用片段（容错：编辑中的半截公式不抛错，未闭合字符串/区域尾巴
 * 扫到多少算多少）。产物 `{ ref, isRange, start, end }`（偏移 end 排他、span 含表名
 * 前缀），未导出为独立类型。
 */
export function scanFormulaReferences(text: string): ReadonlyArray<{
  ref: CellRef | RangeRef
  isRange: boolean
  start: number
  end: number
}>

// ---- 引用平移（行列插删） ----

/** 平移结果：broken = 存在被删区间覆盖的引用（被删引用以 `#REF!` 占位，落库策略由调用方决定） */
export interface FormulaShiftResult {
  text: string
  broken: boolean
}

/** token 级平移公式文本中的全部引用（含 `$` 绝对、跨表 `Sheet!A1` 前缀与区域扩展/收缩）；解析失败原样返回 */
export function shiftFormulaText(
  formula: string,
  axis: 'rows' | 'cols',
  at: number,
  count: number,
  mode: 'insert' | 'delete',
): FormulaShiftResult

// ---- 求值器 ----

/** 标量值（null = 空单元格） */
export type ScalarValue = number | string | boolean | null

/** 宿主取值接口（求值的唯一外部依赖） */
export interface FormulaResolver {
  cell(ref: CellRef): unknown
  /** 读区域：先行后列展开 */
  range(ref: RangeRef): unknown[]
}

/** 求值上下文（registerFormulaFunction 的 impl 第二参：公式所在环境与回读能力） */
export interface FormulaEvalContext {
  /** 当前公式所在表（裸引用缺省表；未提供为 undefined） */
  readonly currentSheet: string | undefined
  /** 公式所在格（0 基） */
  readonly currentCell: { col: number; row: number }
  /** 读取单格（归一化标量/错误标记；resolver 抛错 → #REF!） */
  readCell(ref: CellRef): ScalarValue | FormulaError
  /** 读取区域（逐项归一化；resolver 抛错 → #REF!） */
  readRange(ref: RangeRef): (ScalarValue | FormulaError)[] | FormulaError
  /** 调用函数（名称未知 → #NAME?；参数个数非法 → #VALUE!；ctx 透传给函数实现） */
  callFunction(
    name: string,
    nodes: AstNode[],
    evalNode: (node: AstNode) => unknown,
    ctx?: FormulaEvalContext,
  ): unknown
}

export function evaluate(
  formula: string,
  resolver: FormulaResolver,
  options?: {
    /** 公式所在表名：填入缺省 sheet 的引用后传给 resolver */
    sheet?: string
    /** 公式所在格（ROW()/COLUMN() 省参语义）；缺省 { col: 0, row: 0 } */
    cell?: { col: number; row: number }
  },
): number | string | boolean | FormulaError

// ---- 函数注册表（写入与查询均公共：49 内置 + 自定义函数） ----

/** 内置函数分类（8 类字面量联合；分类面板分组固定集合） */
export type FormulaFunctionCategory =
  | '常用'
  | '财务'
  | '日期与时间'
  | '数学'
  | '统计'
  | '查找与引用'
  | '文本'
  | '逻辑'
export const FORMULA_FUNCTION_CATEGORIES: readonly FormulaFunctionCategory[]

/** 注册元数据（FormulaFunction.meta 的形态；未导出为独立类型） */
interface FormulaFunctionMeta {
  description: string
  category: FormulaFunctionCategory
  /** 参数表（`name: '...'` 表示可变参数尾巴） */
  params: { name: string; optional?: boolean }[]
}

/**
 * 函数定义（normal | lazy 判别联合，公共基座 minArgs/maxArgs/volatile/meta；
 * impl 的入参与返回为求值中间值：标量 / FormulaError / 区域数组）。
 */
export type FormulaFunction =
  | {
      /** 缺省 'normal'：参数已按序求值后传入 impl */
      kind?: 'normal'
      /** 参数个数校验（缺省不校验；非法 → #VALUE!；两臂同） */
      minArgs?: number
      maxArgs?: number
      /** 易失性：任意单元格变更后所在公式格必重算（astHasVolatileCall 以注册表元数据为准） */
      volatile?: boolean
      /** 补全/函数面板元数据；缺省时候选仅显示函数名、不出现在分类面板 */
      meta?: FormulaFunctionMeta
      impl: (args: unknown[], ctx?: FormulaEvalContext) => unknown
    }
  | {
      /** lazy：自行求值参数（IF 的短路分支、查找函数的区域几何回读） */
      kind: 'lazy'
      minArgs?: number
      maxArgs?: number
      volatile?: boolean
      meta?: FormulaFunctionMeta
      impl: (nodes: AstNode[], evalNode: (node: AstNode) => unknown, ctx?: FormulaEvalContext) => unknown
    }

/** 注册函数（大小写不敏感、同名覆盖；扩展/自定义函数） */
export function registerFormulaFunction(name: string, def: FormulaFunction): void
/** 查询函数定义（大小写不敏感；未注册返回 undefined） */
export function getFormulaFunction(name: string): FormulaFunction | undefined

export interface FormulaFunctionInfo {
  name: string
  signature: string
  description: string
  category: FormulaFunctionCategory | undefined
  /** 参数清单 `{ name: string; optional?: boolean }[]`（条目类型未单独导出） */
  params: readonly { name: string; optional?: boolean }[]
  volatile: boolean
}

export function getFormulaFunctionInfo(name: string): FormulaFunctionInfo | undefined
export function listFormulaFunctions(): FormulaFunctionInfo[]
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
- 函数调用：名称未知 → `#NAME?`；参数个数非法 → `#VALUE!`。

`DependencyGraph`：

- `setFormula(cell, refs, options?)` — 全量替换该格旧边（先清后建）；`refs` 去重；`volatile: true` 记入易失集。
- `affectedBy(changed)` — 变更传递闭包：直接或间接依赖 `changed` 中任一格的公式格（去重；公式格自身被引用会继续扩散；环上格也会出现）——宿主据此标脏级联重算。
- `volatileCells()` — 易失公式格快照（任意变更后宿主把它们一并标脏）。
- `formulasOf(sheet)` — 指定表的全部公式格坐标（副本）；宿主 rebuildSheet / 改名重排用。
- `affectedBySheet(sheet)` — 反向边查询：直接或经区域引用该表的全部公式格（去重，含该表上自引用本表的公式）；删除/改名整表时先取引用者，再 `removeSheet` / 重排索引。
- `remove(cell)` / `removeSheet(sheet)` / `has(cell)` / `size`。

`scanFormulaReferences(text)` — 容错扫描：输入含/不含前导 `=` 均可、永不抛错；产物 `{ ref, isRange, start, end }`（偏移 end 排他、span 含表名前缀），供编辑器引用染色框定位。

`parseFormula(text)` — Pratt 解析，非法公式抛 `FormulaParseError`（求值侧已捕获转 `#ERROR!`，独立调用须自行捕获）。

`getFormulaFunctionInfo(name)` / `listFormulaFunctions()` — 同步元数据查询：名称大小写不敏感；返回函数名/签名/描述/分类/参数清单/易失标记。

`registerFormulaFunction(name, def)` / `getFormulaFunction(name)` — 注册表读写（模块级全局注册表，大小写不敏感、同名覆盖）：自定义函数经 `def.impl` 参与 `evaluate` 求值（第二参为 `FormulaEvalContext` 求值上下文）；`volatile: true` 经 `astHasVolatileCall`（以注册表元数据为准）被宿主识别为易失；带 `meta` 的注册进分类面板与参数提示，缺省 `meta` 的注册仍出现在 `listFormulaFunctions`（description 为空、category 为 undefined，仅显示函数名）。

`isFormulaErrorCode(value)` — 判定是否 7 种错误码字符串之一（错误码字符串反序列化校验用）。

`shiftFormulaText(formula, axis, at, count, mode)` — 行列插删时 token 级平移全部引用（`at`/`count` 0 基）：插入 `start >= at` 整体后移、跨插入点的区域扩展；删除按保留量裁剪（区域收缩），保留 0 或单格被删 → `broken: true`（被删引用以 `#REF!` 占位，落库策略由调用方决定）；`A$1` 行绝对不随行平移、`$A1` 列绝对不随列平移（区域起点绝对时整区域不随该轴移动）；引用形态后紧跟 `(` 的函数名（如 `LOG10(`）不平移；解析失败原样返回（`broken: false`）。`tokenText(token)` — token → 文本（数字按原文保精度，字符串/引号表名补回转义）。

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
console.log(parseCellRef('Sheet2!A1')) // parseCellRef 只认纯 A1 记法 → null（跨表前缀由 parseFormula 处理）
console.log(parseCellRef('B0')) // => null（行号从 1 起）
console.log(formatCellRef({ col: 2, row: 4, colAbsolute: false, rowAbsolute: true, sheet: 'Sheet 2' })) // => "'Sheet 2'!C$5"
console.log(colLetters(26)) // => 'AA'
const range = createRangeRef(
  { col: 3, row: 1, colAbsolute: false, rowAbsolute: false },
  { col: 1, row: 4, colAbsolute: false, rowAbsolute: false },
)
console.log(formatRangeRef(range)) // => 'B2:D5'（自动归一化）
```

### 函数面板元数据查询

```ts
import { FORMULA_FUNCTION_CATEGORIES, getFormulaFunctionInfo, listFormulaFunctions } from 'infinitable'

console.log(listFormulaFunctions().length) // => 49（内置函数）
console.log(FORMULA_FUNCTION_CATEGORIES) // => ['常用', '财务', '日期与时间', '数学', '统计', '查找与引用', '文本', '逻辑']

const sum = getFormulaFunctionInfo('sum') // 名称大小写不敏感
console.log(sum?.name, sum?.category, sum?.signature) // => 'SUM' '常用' 'SUM(number1, [number2], ...)'
console.log(getFormulaFunctionInfo('NOW')?.volatile) // => true（易失函数）
console.log(getFormulaFunctionInfo('NOT_EXIST')) // => undefined
```

### 自定义函数注册

```ts
import { evaluate, formulaError, isFormulaError, registerFormulaFunction } from 'infinitable'

// 大小写不敏感、同名覆盖；带 meta 才出现在补全/函数面板
registerFormulaFunction('TAX', {
  minArgs: 1,
  maxArgs: 2,
  meta: {
    description: '按税率求税额（rate 缺省 0.13）',
    category: '数学',
    params: [{ name: 'amount' }, { name: 'rate', optional: true }],
  },
  impl: (args) => {
    const amount = args[0]
    const rate = args[1]
    if (typeof amount !== 'number') return formulaError('#VALUE!')
    return amount * (typeof rate === 'number' ? rate : 0.13)
  },
})

const resolver = { cell: () => 1000, range: () => [] }
console.log(evaluate('TAX(A1)', resolver)) // => 130（A1 读到 1000，缺省税率 0.13）
console.log(isFormulaError(evaluate('TAX(A1, 0.2)', resolver))) // => false
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
> - `FormulaResolver.cell/range` 约定不抛错：抛错由引擎捕获并转为 `#REF!`。
> - 函数注册表读写均在公共面（`registerFormulaFunction`/`getFormulaFunction`/`getFormulaFunctionInfo`/`listFormulaFunctions`）：自定义函数注册是公共能力（模块级全局注册表、大小写不敏感、同名覆盖）；仍为深路径的只有分词/AST 细节/强制转换原语（原 `tokenizeFormula`/`evaluateAst`/`coerceTo*`，0.1.2 起不再导出）。

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

### parseCellRef('B3') 返回的 col 是 1 不是 2

原因：坐标一律 0 基（`{ col: 0, row: 0 }` 是 A1），`B3` 是第 2 列第 3 行 → `{ col: 1, row: 2 }`。修复：换算显示序号时 +1，比较坐标时保持 0 基。

```ts
import { colLetters, formatCellRef, parseCellRef } from 'infinitable'

const ref = parseCellRef('B3')!
console.log(ref.col, ref.row) // => 1 2（0 基）
console.log(colLetters(ref.col)) // => 'B'
console.log(formatCellRef({ col: ref.col, row: ref.row, colAbsolute: false, rowAbsolute: false })) // => 'B3'
```
