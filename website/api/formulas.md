---
title: 公式引擎（formulas）
description: 公式引擎公共 API：A1 地址与区域、错误值体系、Pratt 解析与 AST、引用收集与容错扫描、依赖图、引用平移、纯函数求值，以及可扩展函数注册表与 49 个内置函数。
---

# 公式引擎（formulas）

`formulas` 是无 UI、无状态的纯函数公式层：

- A1 地址解析与格式化（0 基坐标、`$` 绝对标记、跨表表名）
- 公式文本 → AST（Pratt 解析），AST → 标量求值
- 静态引用收集、容错引用扫描、依赖图反向索引
- 行列插删与填充柄的引用平移
- 模块级函数注册表与 49 个内置函数

所有符号从 `infinitable` 主入口导入。`@infinitable/formulas` 是仓库内部包名，发布形态为单包 `infinitable`。

```ts
import {
  parseCellRef,
  formatRangeRef,
  parseFormula,
  collectAstReferences,
  evaluate,
  registerFormulaFunction,
} from 'infinitable'
```

::: tip 与 sheet 层的关系
`infinitable/sheet` 的 `FormulaEngine` 组合本层：依赖索引用 `DependencyGraph`，求值用 `evaluate`，自身只负责工作簿联动、别名解析与增量重算编排。模型侧用法见 [电子表格（sheet）](/api/sheet)。
:::

## 地址系统

坐标统一 0 基：`{ col: 0, row: 0 }` 即 A1。区域为闭区间，构造时保证 `start ≤ end`。

### 类型

```ts
interface CellRef {
  sheet?: string
  col: number
  row: number
  colAbsolute: boolean
  rowAbsolute: boolean
}

interface RangeRef {
  sheet?: string
  startCol: number
  startRow: number
  endCol: number
  endRow: number
}
```

| 字段                    | 类型             | 说明                                                             |
| ----------------------- | ---------------- | ---------------------------------------------------------------- |
| `sheet`                 | `string`（可选） | 跨表引用的表名；缺省表示公式所在表，由宿主 resolver 决定缺省路由 |
| `col` / `row`           | `number`         | 0 基列号 / 行号                                                  |
| `colAbsolute`           | `boolean`        | `$A1` 形态：列绝对                                               |
| `rowAbsolute`           | `boolean`        | `A$1` 形态：行绝对                                               |
| `startCol` / `startRow` | `number`         | 区域左上角（0 基）                                               |
| `endCol` / `endRow`     | `number`         | 区域右下角（0 基）                                               |

`RangeRef` 不携带绝对标记，区域两角点解析出的 `$` 会在构造区域时丢弃；引用平移按起始引用的绝对标记决定整段行为。

### 函数

```ts
function parseCellRef(text: string): CellRef | null
function formatCellRef(ref: CellRef): string
function colLetters(col: number): string
function createRangeRef(a: CellRef, b: CellRef): RangeRef
function formatRangeRef(ref: RangeRef): string
```

| 函数             | 行为                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `parseCellRef`   | 解析 `A1` / `$A$1` 形态；输入会 `trim`；不解析跨表前缀（`Sheet2!A1` 返回 `null`）；行号从 1 起且不允许 `0`；非法返回 `null` |
| `formatCellRef`  | 输出 A1 记法，含 `$` 与可选的 `Sheet!` 前缀                                                                                 |
| `colLetters`     | 0 基列号 → 列字母（`0 → A`、`25 → Z`、`26 → AA`）；非非负整数抛 `RangeError`                                                |
| `createRangeRef` | 由两个角点构造规范化区域；`sheet` 取起点 `a.sheet`                                                                          |
| `formatRangeRef` | 单格输出 `B2`，多格输出 `B2:D5`；含 `$` 无来源、含可选的表名前缀                                                            |

表名格式化规则：匹配 `^[A-Za-z_][A-Za-z0-9_.]*$` 的安全表名直出，其余用单引号包裹并把字面单引号转义为 `''`（如 `Sheet 2` → `'Sheet 2'`）。

```ts
import {
  parseCellRef,
  formatCellRef,
  colLetters,
  createRangeRef,
  formatRangeRef,
} from 'infinitable'

const ref = parseCellRef('$B$3')!
// { col: 1, row: 2, colAbsolute: true, rowAbsolute: true }

formatCellRef(ref) // '$B$3'
colLetters(26) // 'AA'
formatRangeRef(createRangeRef(ref, parseCellRef('D5')!)) // 'B3:D5'
formatCellRef({ ...ref, sheet: 'Sheet 2' }) // `'Sheet 2'!$B$3`
```

## 错误体系

求值过程中的错误是带 brand 的对象，不是字符串；遇到运算即传播（左操作数优先）。

### 错误码

| 错误码    | 典型来源                                                               |
| --------- | ---------------------------------------------------------------------- |
| `#DIV/0!` | 除数为 0、`0` 的负数次幂、`AVERAGE` 空集、部分财务函数除零             |
| `#VALUE!` | 类型无法强转、区域作为标量参与运算、函数参数个数非法、幂结果为非有限值 |
| `#NAME?`  | 调用了未注册函数、裸标识符被解析为未知名称                             |
| `#REF!`   | 引用的表不存在、resolver 读取抛错、查找/索引函数越界                   |
| `#N/A`    | 查找未命中、`RANK` 的目标值不在集合中                                  |
| `#ERROR!` | 公式解析失败、公式格缺少可求值文本                                     |
| `#CYCLE!` | 循环引用保留码；由宿主的递归护栏产出                                   |

### 函数

```ts
interface FormulaError {
  readonly code: FormulaErrorCode
}

function formulaError(code: FormulaErrorCode): FormulaError
function isFormulaError(value: unknown): value is FormulaError
function isFormulaErrorCode(value: unknown): value is FormulaErrorCode
```

| 符号                 | 说明                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `FormulaError`       | 错误标记对象；用 `isFormulaError` 判定，不要按普通对象读取内部字段 |
| `formulaError`       | 构造错误标记                                                       |
| `isFormulaError`     | 类型守卫                                                           |
| `isFormulaErrorCode` | 判定字符串是否为 7 个合法错误码之一                                |

::: warning 错误码常量未导出
`FORMULA_ERROR_CODES` 与 `FormulaErrorCode` 类型均未从公共入口导出。需要枚举或校验时使用 `isFormulaErrorCode`；需要构造时使用 `formulaError(code)`。
:::

### 解析异常

```ts
class FormulaParseError extends Error {
  name: 'FormulaParseError'
}
```

`parseFormula` 在词法或语法非法时抛 `FormulaParseError`（`name` 为 `'FormulaParseError'`）。`evaluate` 捕获它并返回 `#ERROR!`；其他异常继续向上抛。

## 解析

```ts
function parseFormula(text: string): AstNode
```

`text` 为不含前导 `=` 的公式文本。传 `'=1+1'` 会因 `=` 出现在表达式起始位置而抛 `FormulaParseError`。

### AST

```ts
type AstNode =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; code: FormulaErrorCode }
  | { kind: 'name'; name: string }
  | { kind: 'cell'; ref: CellRef }
  | { kind: 'range'; ref: RangeRef }
  | { kind: 'unary'; op: '-' | '+'; operand: AstNode }
  | { kind: 'percent'; operand: AstNode }
  | { kind: 'binary'; op: BinaryOperator; left: AstNode; right: AstNode }
  | { kind: 'call'; name: string; args: AstNode[] }
```

| `kind`    | 字段                  | 求值语义                        |
| --------- | --------------------- | ------------------------------- |
| `number`  | `value`               | 数字字面量                      |
| `string`  | `value`               | 字符串字面量（`""` 转义）       |
| `boolean` | `value`               | `TRUE` / `FALSE`                |
| `error`   | `code`                | 错误字面量，求值为对应错误      |
| `name`    | `name`                | 未知名称，求值为 `#NAME?`       |
| `cell`    | `ref`                 | 单格引用，经 resolver 读取      |
| `range`   | `ref`                 | 区域引用，经 resolver 展开      |
| `unary`   | `op`、`operand`       | 一元 `+` / `-`                  |
| `percent` | `operand`             | 后缀 `%`，即除以 100            |
| `binary`  | `op`、`left`、`right` | 二元运算，`BinaryOperator` 见下 |
| `call`    | `name`、`args`        | 函数调用                        |

```ts
type BinaryOperator = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>='
```

运算符优先级由低到高：

| 优先级 | 运算符                     | 结合性 |
| ------ | -------------------------- | ------ |
| 1      | `=` `<>` `<` `<=` `>` `>=` | 左     |
| 2      | `&`                        | 左     |
| 3      | `+` `-`                    | 左     |
| 4      | `*` `/`                    | 左     |
| 6      | 一元 `+` `-`               | —      |
| 6 / 5  | `^`                        | 右结合 |
| 7      | 后缀 `%`                   | —      |

一元运算紧于幂次（Excel 行为）：`-2^2` 解析为 `(-2)^2 = 4`。

### tokenText

```ts
function tokenText(token: FormulaToken): string
```

把 token 还原为文本：数字按原文输出（保留精度）、字符串与引号表名补回转义、错误字面量按规范码、运算符原样。

::: details tokenText 的可见性
`FormulaToken` 类型与分词函数 `tokenizeFormula` 不从公共入口导出。`tokenText` 主要供引用改写等包内路径使用；外部通常不需要直接调用。
:::

## 引用分析

### 收集 AST 引用

```ts
function collectAstReferences(
  node: AstNode,
): Array<{ kind: 'cell'; ref: CellRef } | { kind: 'range'; ref: RangeRef }>
```

递归遍历 AST 的 `cell` / `range` 节点，包含函数实参、一元/百分号操作数与二元操作数。它是纯语法遍历：lazy 函数未被选中的分支也会被收集，依赖图按「可能读」建边，宁多勿漏。`sheet` 缺省值原样保留，归一为公式所在表是宿主职责。

```ts
import { parseFormula, collectAstReferences } from 'infinitable'

const ast = parseFormula('SUM(A1:B2) + Sheet2!C3')
collectAstReferences(ast)
// [{ kind: 'range', ref: { startCol: 0, startRow: 0, endCol: 1, endRow: 1 } },
//  { kind: 'cell', ref: { sheet: 'Sheet2', col: 2, row: 2, ... } }]
```

### 易失函数检测

```ts
function astHasVolatileCall(node: AstNode): boolean
```

AST 中是否含易失函数调用，递归检查函数名与实参。判定以注册表的 `volatile` 元数据为准，内置易失函数为 `TODAY` / `NOW` / `RAND` / `RANDBETWEEN`；自定义函数注册时标记 `volatile: true` 同样生效。

### 容错引用扫描

```ts
interface ScannedReference {
  ref: CellRef | RangeRef
  isRange: boolean
  start: number
  end: number
}

function scanFormulaReferences(text: string): ScannedReference[]
```

扫描公式文本中出现的引用，用于编辑期染色框。与 `parseFormula` 的区别是容错：输入可以是半截公式（含或不含前导 `=`），未闭合的字符串、引号表名、区域尾巴都不会抛错。

| 字段            | 说明                                                     |
| --------------- | -------------------------------------------------------- |
| `ref`           | 解析出的单格或区域引用                                   |
| `isRange`       | 是否为区域                                               |
| `start` / `end` | 原文本字符偏移（`end` 排他）；跨表引用时 span 含表名前缀 |

消歧规则与解析器同源：标识符后随 `(` 视为函数名跳过（`LOG10(` 不是引用）；后随 `!` 视为表名前缀；字符串字面量与错误字面量内部不扫描；`1E5` 不会被误读为 `E5`。区域尾巴非法时只报告起点单格。

## 依赖图

`DependencyGraph` 是「公式格 → 静态引用」的反向索引，供宿主做变更扩散（标脏）。它不做循环检测，也不执行求值。

```ts
interface SheetCellCoord {
  sheet: string
  col: number
  row: number
}

type FormulaRefCoord =
  | { kind: 'cell'; ref: SheetCellCoord }
  | {
      kind: 'range'
      ref: { sheet: string; startCol: number; startRow: number; endCol: number; endRow: number }
    }
```

`FormulaRefCoord` 的 `sheet` 必须是宿主解析后的规范表名；裸引用需要宿主先填入公式所在表。

### 方法

```ts
class DependencyGraph {
  setFormula(
    cell: SheetCellCoord,
    refs: readonly FormulaRefCoord[],
    options?: { volatile?: boolean },
  ): void
  remove(cell: SheetCellCoord): void
  removeSheet(sheet: string): void
  affectedBy(changed: Iterable<SheetCellCoord>): SheetCellCoord[]
  volatileCells(): SheetCellCoord[]
  formulasOf(sheet: string): SheetCellCoord[]
  affectedBySheet(sheet: string): SheetCellCoord[]
  has(cell: SheetCellCoord): boolean
  get size(): number
}
```

| 方法              | 说明                                                                                |
| ----------------- | ----------------------------------------------------------------------------------- |
| `setFormula`      | 注册或更新公式格的依赖，**全量替换**该格旧边；引用去重；`volatile: true` 记入易失集 |
| `remove`          | 移除公式格及其反向边；非公式格为空操作                                              |
| `removeSheet`     | 移除整表：该表全部公式格，以及其它表指向该表的边                                    |
| `affectedBy`      | 变更传递闭包：直接或间接依赖 `changed` 中任一格的公式格（去重）；环上格也会出现     |
| `volatileCells`   | 全部易失公式格坐标（副本）                                                          |
| `formulasOf`      | 指定表的全部公式格坐标（副本）                                                      |
| `affectedBySheet` | 直接或经区域引用指定表的全部公式格（去重）                                          |
| `has`             | 指定格是否已注册为公式格                                                            |
| `size`            | 公式格数量                                                                          |

`affectedBy` 分两段执行：初始变更按表分组批量点查单格索引，区域依赖把同表坐标合并为行列区间后做相交判定；命中的公式格再沿闭包 BFS 扩散。连续矩形批量写因此只需一次批处理成本。

```ts
import { DependencyGraph } from 'infinitable'

const graph = new DependencyGraph()
graph.setFormula({ sheet: 'Sheet1', col: 0, row: 0 }, [
  { kind: 'range', ref: { sheet: 'Sheet1', startCol: 1, startRow: 0, endCol: 1, endRow: 9 } },
])

graph.affectedBy([{ sheet: 'Sheet1', col: 1, row: 3 }])
// [{ sheet: 'Sheet1', col: 0, row: 0 }]
```

## 引用平移

引用平移用于行列插入/删除与填充柄复制。实现是 token 级改写：只改引用 token，数字原文、运算符、函数名等其余文本原样保留。

### 行列插删

```ts
interface FormulaShiftResult {
  text: string
  broken: boolean
}

function shiftFormulaText(
  formula: string,
  axis: 'rows' | 'cols',
  at: number,
  count: number,
  mode: 'insert' | 'delete',
): FormulaShiftResult
```

| 字段     | 说明                                                  |
| -------- | ----------------------------------------------------- |
| `text`   | 平移后的公式文本；被删除区间覆盖的引用以 `#REF!` 占位 |
| `broken` | 是否存在被删除区间覆盖的引用                          |

规则（以行为例，列对称）：

- 插入 `at, count`：引用起点 `≥ at` 整体后移；`start < at ≤ end` 区域扩展。
- 删除 `[at, at+count)`：引用完全在上方不动；完全在下方整体前移；相交时按保留量裁剪。
- 保留量为 0（单格被删或区域被删空）→ `broken`，输出 `#REF!`。
- 绝对引用按轴锁定：`A$1` 不随行平移，`$A1` 不随列平移；区域起点绝对时整区域不随该轴移动。
- 解析失败时原样返回输入文本，`broken` 为 `false`。

### 增量平移

```ts
function shiftFormulaRefs(formula: string, deltaRow: number, deltaCol: number): string
```

填充柄复制语义：每个引用按行列增量平移，`$` 锁定的轴不变；任一端点出界（负坐标）时整个引用转为 `#REF!`。`deltaRow` 与 `deltaCol` 均为 0 时直接返回原文本。

```ts
import { shiftFormulaRefs, shiftFormulaText } from 'infinitable'

shiftFormulaRefs('SUM($A1:B2)', 1, 0) // 'SUM($A2:B3)'
shiftFormulaText('SUM(A1:B2)', 'rows', 1, 1, 'insert')
// { text: 'SUM(A2:B3)', broken: false }
```

## 求值

### 类型

```ts
type ScalarValue = number | string | boolean | null

interface FormulaResolver {
  cell(ref: CellRef): unknown
  range(ref: RangeRef): unknown[]
}

interface FormulaEvalContext {
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
```

| 类型                 | 说明                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `ScalarValue`        | 单元格/字面量可取的全集；`null` 表示空单元格                                   |
| `FormulaResolver`    | 求值唯一的外部依赖；`cell` 读单格，`range` 先行后列展开                        |
| `FormulaEvalContext` | lazy 函数经它回读单元格/区域、调用函数；由 `evaluate` 内部构造并透传给函数实现 |

`EvalValue`（标量、错误或区域展开数组）未从公共入口导出；函数实现内部可见。

### evaluate

```ts
function evaluate(
  formula: string,
  resolver: FormulaResolver,
  options?: {
    sheet?: string
    cell?: { col: number; row: number }
  },
): number | string | boolean | FormulaError
```

`formula` 不含前导 `=`。`options.sheet` 是公式所在表名，用于给裸引用填缺省表；`options.cell` 是公式所在格（`ROW()` / `COLUMN()` 省参语义），缺省 `{ col: 0, row: 0 }`。

求值语义：

| 场景                               | 结果                              |
| ---------------------------------- | --------------------------------- |
| 解析失败（`FormulaParseError`）    | `#ERROR!`                         |
| resolver 读取抛错                  | `#REF!`                           |
| resolver 返回 `undefined` / `null` | 归一为 `null`，按空单元格参与运算 |
| resolver 返回标量或错误            | 原样使用                          |
| resolver 返回其他对象              | `#VALUE!`                         |
| 区域作为最终结果（非函数参数）     | `#VALUE!`（v1 不支持数组公式）    |
| 最终值为 `null`                    | `0`（空引用按 Excel 观感显示 0）  |
| 除零、`0` 的负数次幂               | `#DIV/0!`                         |
| `^` 结果非有限                     | `#VALUE!`                         |
| 未注册函数                         | `#NAME?`                          |
| 函数参数个数越界                   | `#VALUE!`                         |

强制转换与比较：

- 数字上下文：`null → 0`、布尔 → `1/0`、数字文本 → 数字、`"TRUE"/"FALSE"` → `1/0`；空字符串或不可转文本 → `#VALUE!`。
- 文本上下文：`null → ''`、布尔 → `TRUE/FALSE`、数字 → 十进制字符串。
- 布尔上下文：`null → FALSE`、数字 `≠ 0` 为真、文本只接受 `TRUE/FALSE`。
- 比较：同类型按类型规则（文本大小写不敏感）；混合类型按 `数字 < 文本 < 布尔`；`null` 归一为对方类型的零值。
- 四则运算走精确十进制实现，结果仍为 JS `number`。

```ts
import { evaluate, type FormulaResolver } from 'infinitable'

const values: Record<string, unknown> = { '0,0': 10, '0,1': 20 }
const resolver: FormulaResolver = {
  cell: (ref) => values[`${ref.col},${ref.row}`],
  range: (ref) => [10, 20],
}

evaluate('SUM(A1:A2)', resolver) // 30
evaluate('A1 / 0', resolver) // FormulaError，code 为 '#DIV/0!'
evaluate('A1 & " / " & A2', resolver) // '10 / 20'
```

::: tip 缺省表路由
`evaluate` 只给裸引用补上 `options.sheet` 的表名；`resolver` 仍需自行决定 `sheet` 缺省时读哪张表。跨表读取失败应返回 `formulaError('#REF!')`，而不是抛错。
:::

## 函数注册表

注册表是模块级全局的 `Map`：名称大小写不敏感，同名注册直接覆盖。

### 分类

```ts
type FormulaFunctionCategory =
  | '常用' | '财务' | '日期与时间' | '数学'
  | '统计' | '查找与引用' | '文本' | '逻辑'

const FORMULA_FUNCTION_CATEGORIES: readonly FormulaFunctionCategory[]
```

数组顺序即函数面板的分组展示顺序：常用、财务、日期与时间、数学、统计、查找与引用、文本、逻辑。「全部」是宿主导航概念，不在数组内。

### 定义与信息

```ts
type FormulaFunctionMeta = {
  description: string
  category: FormulaFunctionCategory
  params: { name: string; optional?: boolean }[]
}

type FormulaFunctionBase = {
  minArgs?: number
  maxArgs?: number
  volatile?: boolean
  meta?: FormulaFunctionMeta
}

type FormulaFunction =
  | (FormulaFunctionBase & {
      kind?: 'normal'
      impl: (args: EvalValue[], ctx?: FormulaEvalContext) => EvalValue
    })
  | (FormulaFunctionBase & {
      kind: 'lazy'
      impl: (
        nodes: AstNode[],
        evalNode: (node: AstNode) => EvalValue,
        ctx?: FormulaEvalContext,
      ) => EvalValue
    })

interface FormulaFunctionInfo {
  name: string
  signature: string
  description: string
  category: FormulaFunctionCategory | undefined
  params: { name: string; optional?: boolean }[]
  volatile: boolean
}
```

`FormulaFunctionMeta` 与 `FormulaFunctionBase` 不是公共导出类型，仅用于展示结构；注册时直接传对象字面量即可。

| `FormulaFunctionInfo` 字段 | 说明                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `name`                     | 规范化的函数名（大写）                                            |
| `signature`                | 由参数表生成，如 `SUM(number1, [number2], ...)`；无参为 `TODAY()` |
| `description`              | 元数据描述；第三方函数未给时为 `''`                               |
| `category`                 | 未声明分类时为 `undefined`（只出现在「全部」）                    |
| `params`                   | 参数元数据；`name: '...'` 表示可变参数尾巴                        |
| `volatile`                 | 是否易失                                                          |

`normal` 函数先求值全部实参再调用；`lazy` 函数拿到 AST 节点与 `evalNode`，自行决定求值哪些参数（`IF` 的短路、查找函数的区域几何回读）。

### API

```ts
function registerFormulaFunction(name: string, def: FormulaFunction): void
function getFormulaFunction(name: string): FormulaFunction | undefined
function getFormulaFunctionInfo(name: string): FormulaFunctionInfo | undefined
function listFormulaFunctions(): FormulaFunctionInfo[]
```

| 函数                      | 说明                                            |
| ------------------------- | ----------------------------------------------- |
| `registerFormulaFunction` | 注册函数；名称转大写存储；同名覆盖              |
| `getFormulaFunction`      | 按名称查询定义（大小写不敏感）                  |
| `getFormulaFunctionInfo`  | 查询完整信息；未注册返回 `undefined`            |
| `listFormulaFunctions`    | 枚举全部函数信息，按名称升序（`localeCompare`） |

```ts
import { registerFormulaFunction, listFormulaFunctions } from 'infinitable'

registerFormulaFunction('DOUBLE', {
  minArgs: 1,
  maxArgs: 1,
  meta: {
    description: '返回参数的两倍',
    category: '数学',
    params: [{ name: 'number' }],
  },
  impl: (args) => Number(args[0]) * 2,
})

listFormulaFunctions().find((info) => info.name === 'DOUBLE')?.signature
// 'DOUBLE(number)'
```

::: warning 注册是全局的
注册表没有实例隔离，也不提供注销接口。库作者或应用应在启动阶段一次性注册，避免运行时反复覆盖同名函数。
:::

### 内置函数

共 49 个。签名中的 `[...]` 表示可选参数，`...` 表示可变参数尾巴。

#### 常用（10）

| 函数      | 签名                                                | 说明                   |
| --------- | --------------------------------------------------- | ---------------------- |
| `SUM`     | `SUM(number1, [number2], ...)`                      | 求和                   |
| `AVERAGE` | `AVERAGE(number1, [number2], ...)`                  | 平均值；空集 `#DIV/0!` |
| `MAX`     | `MAX(number1, [number2], ...)`                      | 最大值；空集返回 `0`   |
| `MIN`     | `MIN(number1, [number2], ...)`                      | 最小值；空集返回 `0`   |
| `COUNT`   | `COUNT(value1, [value2], ...)`                      | 统计数字个数           |
| `IF`      | `IF(logical_test, value_if_true, [value_if_false])` | 条件分支（lazy，短路） |
| `AND`     | `AND(logical1, [logical2], ...)`                    | 全部为真               |
| `OR`      | `OR(logical1, [logical2], ...)`                     | 任一为真               |
| `ROUND`   | `ROUND(number, num_digits)`                         | 四舍五入到指定小数位   |
| `ABS`     | `ABS(number)`                                       | 绝对值                 |

#### 财务（5）

| 函数   | 签名                                      | 说明                 |
| ------ | ----------------------------------------- | -------------------- |
| `PMT`  | `PMT(rate, nper, pv, [fv], [type])`       | 等额分期付款额       |
| `FV`   | `FV(rate, nper, pmt, [pv], [type])`       | 年金终值             |
| `PV`   | `PV(rate, nper, pmt, [fv], [type])`       | 年金现值             |
| `IPMT` | `IPMT(rate, per, nper, pv, [fv], [type])` | 某期付款中的利息部分 |
| `PPMT` | `PPMT(rate, per, nper, pv, [fv], [type])` | 某期付款中的本金部分 |

#### 日期与时间（2）

| 函数    | 签名      | 说明                                   |
| ------- | --------- | -------------------------------------- |
| `TODAY` | `TODAY()` | 当天日期的 1900 序列数（易失）         |
| `NOW`   | `NOW()`   | 当前日期时间序列数，含时间小数（易失） |

#### 数学（2）

| 函数          | 签名                       | 说明                                   |
| ------------- | -------------------------- | -------------------------------------- |
| `RAND`        | `RAND()`                   | `[0, 1)` 随机数（易失）                |
| `RANDBETWEEN` | `RANDBETWEEN(bottom, top)` | `[bottom, top]` 闭区间随机整数（易失） |

#### 统计（7）

| 函数         | 签名                              | 说明                              |
| ------------ | --------------------------------- | --------------------------------- |
| `COUNTA`     | `COUNTA(value1, [value2], ...)`   | 非空值个数                        |
| `COUNTIF`    | `COUNTIF(range, criteria)`        | 满足条件的格数                    |
| `COUNTBLANK` | `COUNTBLANK(range)`               | 空白格数（lazy，按区域几何计算）  |
| `MEDIAN`     | `MEDIAN(number1, [number2], ...)` | 中位数                            |
| `LARGE`      | `LARGE(array, k)`                 | 第 k 个最大值；`k` 越界 `#VALUE!` |
| `SMALL`      | `SMALL(array, k)`                 | 第 k 个最小值；`k` 越界 `#VALUE!` |
| `RANK`       | `RANK(number, ref, [order])`      | 名次；`order = 0` 降序，缺省降序  |

#### 查找与引用（7）

| 函数      | 签名                                                                | 说明                               |
| --------- | ------------------------------------------------------------------- | ---------------------------------- |
| `VLOOKUP` | `VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])` | 按首列匹配（lazy）                 |
| `HLOOKUP` | `HLOOKUP(lookup_value, table_array, row_index_num, [range_lookup])` | 按首行匹配（lazy）                 |
| `MATCH`   | `MATCH(lookup_value, lookup_array, [match_type])`                   | 一维查找，返回 1 基位置（lazy）    |
| `INDEX`   | `INDEX(array, row_num, [column_num])`                               | 按 1 基行列取区域中的值（lazy）    |
| `CHOOSE`  | `CHOOSE(index_num, value1, [value2], ...)`                          | 按 1 基序号返回第 n 个参数（lazy） |
| `ROW`     | `ROW([reference])`                                                  | 引用起始行号，省略时取公式所在行   |
| `COLUMN`  | `COLUMN([reference])`                                               | 引用起始列号，省略时取公式所在列   |

`VLOOKUP` / `HLOOKUP` 的 `range_lookup`：为 `TRUE` 或缺省时按升序近似匹配，`FALSE` 时精确匹配。

#### 文本（11）

| 函数          | 签名                                                   | 说明                         |
| ------------- | ------------------------------------------------------ | ---------------------------- |
| `CONCATENATE` | `CONCATENATE(text1, [text2], ...)`                     | 连接文本                     |
| `LEN`         | `LEN(text)`                                            | 字符个数                     |
| `LEFT`        | `LEFT(text, [num_chars])`                              | 左侧字符；缺省 1             |
| `RIGHT`       | `RIGHT(text, [num_chars])`                             | 右侧字符；缺省 1             |
| `MID`         | `MID(text, start_num, num_chars)`                      | 从 1 基位置截取              |
| `UPPER`       | `UPPER(text)`                                          | 转大写                       |
| `LOWER`       | `LOWER(text)`                                          | 转小写                       |
| `TRIM`        | `TRIM(text)`                                           | 去首尾空格并压缩内部连续空格 |
| `EXACT`       | `EXACT(text1, text2)`                                  | 区分大小写的文本相等         |
| `SUBSTITUTE`  | `SUBSTITUTE(text, old_text, new_text, [instance_num])` | 替换子串；省略则全部替换     |
| `REPLACE`     | `REPLACE(old_text, start_num, num_chars, new_text)`    | 按位置与长度替换             |

#### 逻辑（5）

| 函数      | 签名                             | 说明                       |
| --------- | -------------------------------- | -------------------------- |
| `NOT`     | `NOT(logical)`                   | 取反                       |
| `XOR`     | `XOR(logical1, [logical2], ...)` | 真值个数为奇数             |
| `IFERROR` | `IFERROR(value, value_if_error)` | 首参为任意错误时返回替代值 |
| `TRUE`    | `TRUE()`                         | 逻辑值 TRUE                |
| `FALSE`   | `FALSE()`                        | 逻辑值 FALSE               |

易失函数共 4 个：`TODAY`、`NOW`、`RAND`、`RANDBETWEEN`。宿主在任意变更后应重算易失公式所在格及其下游依赖。

## 边界

- **不实现数组公式**：区域只有在函数参数位置才会展开为数组；区域作为最终结果返回 `#VALUE!`。
- **不做循环检测**：`DependencyGraph` 只维护静态反向索引，`#CYCLE!` 是保留错误码，由宿主递归护栏产出（`infinitable/sheet` 的 `FormulaEngine` 已实现）。
- **不实现命名区域**：裸标识符求值为 `#NAME?`。
- **不支持空格交集运算符**：分词阶段忽略空白。
- **绝对标记不参与求值**：`$` 只影响引用平移与展示。
- **函数集合是 Excel 子集**：内置 49 个函数，未列出的函数需自行注册。
