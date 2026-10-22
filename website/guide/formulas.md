---
title: 公式引擎
description: formulas 层的能力边界、A1 地址、Pratt 解析与 evaluate、49 个内置函数、7 种错误值、自定义函数注册、DependencyGraph 增量重算、引用扫描与平移，以及宿主侧表格 + 公式重算装配。
---

# 公式引擎

`@infinitable/formulas` 是一个不依赖 core 的纯公式层：负责 A1 地址、公式文本解析、标量求值、函数注册表、依赖图、引用扫描与引用平移。它不知道表格、画布、Sheet 模型或撤销栈，单元格读取完全由宿主通过 `FormulaResolver` 注入。

`infinitable` 主入口转出了 formulas 的全部公共 API。电子表格场景通常不直接装配 formulas，而是使用 `infinitable/sheet` 里的 `FormulaEngine`；后者把依赖图、增量重算、跨表联动与 `#CYCLE!` 护栏封装在 Sheet 模型内。见 [电子表格（sheet）](/guide/sheet)。完整签名见 [公式引擎（formulas）](/api/formulas)。

<script setup>
import FormulaDemo from '../.vitepress/theme/components/FormulaDemo.vue'
import DemoBlock from '../.vitepress/theme/components/DemoBlock.vue'
</script>

## 在线试算

编辑公式或点击示例，`evaluate` 会通过宿主提供的 `FormulaResolver` 实时读取 A1:C4 并返回结果。切换到「源码」可以直接查看这个试算的完整实现。

<DemoBlock>

<FormulaDemo />

<template #source>

<<< @/.vitepress/theme/components/FormulaDemo.vue

</template>

</DemoBlock>

## 能力边界

| 能力     | 说明                                                          |
| -------- | ------------------------------------------------------------- |
| A1 地址  | 0 基坐标；`$` 绝对标记；`Sheet2!A1` / `'Sheet 2'!A1` 跨表前缀 |
| 解析     | Pratt 解析器 `parseFormula`；分词器为包内深路径，不对外导出   |
| 求值     | `evaluate` 为同步纯函数；单元格读取经 `FormulaResolver`       |
| 函数     | 49 个内置函数；模块级注册表，大小写不敏感，同名覆盖           |
| 错误     | 7 种错误值；错误对象随运算传播                                |
| 依赖     | `DependencyGraph` 静态引用反向索引；宿主驱动标脏与重算        |
| 引用扫描 | `scanFormulaReferences` 容错扫描，供编辑期引用高亮            |
| 引用平移 | `shiftFormulaText` 行列插删；`shiftFormulaRefs` 填充柄增量    |

明确不做：

- 不检测循环引用。互相引用会递归到栈溢出；宿主必须自建护栏，可产出 `#CYCLE!`。
- 不做数组公式。区域可以作为函数参数，但区域作为最终结果求值为 `#VALUE!`。
- 不做自动重算、缓存、脏区管理。这些由宿主或 `@infinitable/sheet` 的 `FormulaEngine` 负责。
- 不做跨表查找。`FormulaResolver` 自己决定表名如何路由。
- 不处理前导 `=`。宿主剥离 `=` 后再传入；带 `=` 的文本会解析失败并得到 `#ERROR!`。
- 不做数字格式化、公式栏、函数面板 UI。注册表只提供元数据。

## A1 地址系统

坐标统一 0 基：`{ col: 0, row: 0 }` 就是 A1。

```ts
import {
  colLetters,
  createRangeRef,
  formatCellRef,
  formatRangeRef,
  parseCellRef,
} from 'infinitable'

console.log(colLetters(0)) // => 'A'
console.log(colLetters(26)) // => 'AA'
console.log(parseCellRef('$B$3'))
// => { col: 1, row: 2, colAbsolute: true, rowAbsolute: true }
console.log(parseCellRef('Sheet2!A1')) // => null（纯 A1 记法；跨表前缀由 parseFormula 处理）
console.log(parseCellRef('B0')) // => null（行号从 1 起）

console.log(
  formatCellRef({
    sheet: 'Sheet 2',
    col: 2,
    row: 4,
    colAbsolute: false,
    rowAbsolute: true,
  }),
) // => "'Sheet 2'!C$5"

const range = createRangeRef(
  { col: 3, row: 1, colAbsolute: false, rowAbsolute: false },
  { col: 1, row: 4, colAbsolute: false, rowAbsolute: false },
)
console.log(formatRangeRef(range)) // => 'B2:D5'（自动归一化为 start ≤ end）
```

签名：

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

function colLetters(col: number): string // 非负整数之外抛 RangeError
function parseCellRef(text: string): CellRef | null
function formatCellRef(ref: CellRef): string
function createRangeRef(a: CellRef, b: CellRef): RangeRef
function formatRangeRef(ref: RangeRef): string
```

`parseCellRef` 只接受纯 A1 记法，正则口径为 `^(\$?)([A-Za-z]+)(\$?)([1-9]\d*)$`。跨表引用、区域引用、函数调用都由 `parseFormula` / `scanFormulaReferences` 解析。

## 解析与求值

```ts
import { evaluate, formulaError, isFormulaError } from 'infinitable'

const result = evaluate('SUM(A1:A3) * 2', {
  cell: () => null,
  range: () => [1, 2, 3],
})

console.log(result) // => 12

const bad = evaluate('1/0', { cell: () => null, range: () => [] })
console.log(isFormulaError(bad) ? bad.code : bad) // => '#DIV/0!'
```

`FormulaResolver` 是求值的唯一外部依赖：

```ts
interface FormulaResolver {
  /** 读单格；空格返回 null/undefined */
  cell(ref: CellRef): unknown
  /** 读区域：先行后列展开；建议空格不进数组 */
  range(ref: RangeRef): unknown[]
}

function evaluate(
  formula: string,
  resolver: FormulaResolver,
  options?: {
    /** 公式所在表名：裸引用由引擎填入此表后传给 resolver */
    sheet?: string
    /** 公式所在格（ROW()/COLUMN() 省参语义）；缺省 { col: 0, row: 0 } */
    cell?: { col: number; row: number }
  },
): number | string | boolean | FormulaError
```

求值语义：

- `formula` 不含前导 `=`。
- 解析失败（`FormulaParseError`）返回 `#ERROR!`，不抛异常。
- 区域作为最终结果返回 `#VALUE!`；区域作为函数参数按数组传入函数实现。
- 空格引用作为最终值返回 `0`。
- `FormulaResolver.cell/range` 约定不抛错；抛错被引擎捕获并转为 `#REF!`。
- 四则运算与 `^` 使用 `@cat-kit/core` 的 `$n` 精确计算，结果仍是 JS number。
- `1/0` 与 `0^负数` 返回 `#DIV/0!`；`^` 结果非有限返回 `#VALUE!`。
- `&` 连接文本；比较运算为 `= <> < <= > >=`，文本大小写不敏感，混合类型排序为数字 < 文本 < 布尔，`null` 归一为对方的零值。
- 空单元格参与算术按 0、文本上下文按空串、布尔上下文按 FALSE；空字符串字面量参与算术返回 `#VALUE!`。
- 错误值遇运算即传播，左操作数优先。
- 未知函数返回 `#NAME?`；参数个数不合法返回 `#VALUE!`。

`FormulaEvalContext` 是自定义函数拿到的求值上下文：

```ts
interface FormulaEvalContext {
  readonly currentSheet: string | undefined
  readonly currentCell: { col: number; row: number }
  readCell(ref: CellRef): ScalarValue | FormulaError
  readRange(ref: RangeRef): (ScalarValue | FormulaError)[] | FormulaError
  callFunction(
    name: string,
    nodes: AstNode[],
    evalNode: (node: AstNode) => unknown,
    ctx?: FormulaEvalContext,
  ): unknown
}
```

`parseFormula(text)` 返回 AST，非法公式抛 `FormulaParseError`。独立调用时需要自行捕获；`evaluate` 已经内部捕获。`tokenText(token)` 可把 token 还原为文本（数字按原文保精度，字符串与引号表名补回转义），分词器本身不在公共面。

## 内置函数与错误值

49 个内置函数按名称升序：

::: details 49 个内置函数
ABS、AND、AVERAGE、CHOOSE、COLUMN、CONCATENATE、COUNT、COUNTA、COUNTBLANK、COUNTIF、EXACT、FALSE、FV、HLOOKUP、IF、IFERROR、INDEX、IPMT、LARGE、LEFT、LEN、LOWER、MATCH、MAX、MEDIAN、MID、MIN、NOT、NOW、OR、PMT、PPMT、PV、RAND、RANDBETWEEN、RANK、REPLACE、RIGHT、ROUND、ROW、SMALL、SUBSTITUTE、SUM、TODAY、TRIM、TRUE、UPPER、VLOOKUP、XOR。
:::

分类固定为 8 组：`常用`、`财务`、`日期与时间`、`数学`、`统计`、`查找与引用`、`文本`、`逻辑`。

```ts
import {
  FORMULA_FUNCTION_CATEGORIES,
  getFormulaFunctionInfo,
  listFormulaFunctions,
} from 'infinitable'

console.log(listFormulaFunctions().length) // => 49
console.log(FORMULA_FUNCTION_CATEGORIES)
// => ['常用', '财务', '日期与时间', '数学', '统计', '查找与引用', '文本', '逻辑']

const sum = getFormulaFunctionInfo('sum') // 名称大小写不敏感
console.log(sum?.name, sum?.category, sum?.signature)
// => 'SUM' '常用' 'SUM(number1, [number2], ...)'

console.log(getFormulaFunctionInfo('NOW')?.volatile) // => true
console.log(getFormulaFunctionInfo('NOT_EXIST')) // => undefined
```

7 种错误值：

| 错误码    | 产生时机                                                     |
| --------- | ------------------------------------------------------------ |
| `#DIV/0!` | 除零；`0` 的负数次幂                                         |
| `#VALUE!` | 类型强转失败；函数参数个数非法；区域作为最终结果；非标量对象 |
| `#NAME?`  | 函数名未注册                                                 |
| `#REF!`   | resolver 抛错；宿主无法解析目标表                            |
| `#N/A`    | `MATCH` / `VLOOKUP` 等查找函数未命中                         |
| `#ERROR!` | 公式解析失败；宿主适配层兜底的未预期异常                     |
| `#CYCLE!` | 保留错误码；formulas 本身不检测循环，由宿主护栏产出          |

```ts
import { formulaError, isFormulaError, isFormulaErrorCode } from 'infinitable'

const error = formulaError('#N/A')
console.log(isFormulaError(error)) // => true
console.log(isFormulaErrorCode('#DIV/0!')) // => true
console.log(isFormulaErrorCode('boom')) // => false
```

## 注册自定义函数

函数注册表是模块级全局表，大小写不敏感，同名覆盖：

```ts
import { evaluate, formulaError, registerFormulaFunction } from 'infinitable'

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
console.log(evaluate('TAX(A1)', resolver)) // => 130
```

`FormulaFunction` 有两种形态：

- `normal`（缺省）：参数先求值，`impl(args, ctx)` 收到参数值数组（元素为标量、错误标记或区域展开数组）。
- `lazy`：`kind: 'lazy'`，`impl(nodes, evalNode, ctx)` 自行决定哪些参数要求值；`IF` 的短路分支、`VLOOKUP` 的区域几何回读属于这种形态。

可选字段：

- `minArgs` / `maxArgs`：参数个数校验；非法返回 `#VALUE!`。
- `volatile: true`：标记易失函数；`astHasVolatileCall` 以注册表元数据为准。
- `meta`：`{ description, category, params }`，用于补全与函数面板。没有 `meta` 的函数仍会出现在 `listFormulaFunctions`，但描述为空、分类为 `undefined`。

注册后可通过 `getFormulaFunction(name)` 取定义，通过 `getFormulaFunctionInfo(name)` 取签名与元数据。

## 依赖图与增量重算

`DependencyGraph` 只维护「公式格 → 静态引用」的反向索引，不保存值、不负责求值。

```ts
import { DependencyGraph } from 'infinitable'

const graph = new DependencyGraph()
graph.setFormula(
  { sheet: 'Sheet1', col: 1, row: 0 }, // B1
  [
    {
      kind: 'range',
      ref: { sheet: 'Sheet1', startCol: 0, startRow: 0, endCol: 0, endRow: 1 },
    },
  ],
)

console.log(graph.affectedBy([{ sheet: 'Sheet1', col: 0, row: 0 }]))
// => [{ sheet: 'Sheet1', col: 1, row: 0 }]
```

主要方法：

| 方法                               | 作用                                                    |
| ---------------------------------- | ------------------------------------------------------- |
| `setFormula(cell, refs, options?)` | 全量替换该公式格的依赖边；`options.volatile` 记入易失集 |
| `remove(cell)`                     | 移除公式格；被覆盖为字面量或清空时调用                  |
| `removeSheet(sheet)`               | 移除整表公式节点与指向该表的边                          |
| `affectedBy(changed)`              | 变更传递闭包：直接或间接受影响的公式格，去重            |
| `volatileCells()`                  | 易失公式格快照；任意变更后宿主应把它们一并标脏          |
| `formulasOf(sheet)`                | 指定表的全部公式格坐标                                  |
| `affectedBySheet(sheet)`           | 反向边查询：直接或经区域引用该表的公式格                |
| `has(cell)` / `size`               | 点查与计数                                              |

建图时通常配合 `parseFormula` + `collectAstReferences`：

```ts
import { collectAstReferences, parseFormula } from 'infinitable'

const ast = parseFormula('SUM(A1:A2)')
const refs = collectAstReferences(ast)
// => [{ kind: 'range', ref: { startCol: 0, startRow: 0, endCol: 0, endRow: 1 } }]
```

`collectAstReferences` 是纯语法遍历：`IF` 未命中分支里的引用也会被收集，依赖图按「可能读」建边，宁多勿漏。`sheet` 缺省为 `undefined`，需要宿主归一为公式所在表或显式表名后再传给 `setFormula`。

易失函数：内置 `NOW`、`TODAY`、`RAND`、`RANDBETWEEN`；自定义函数可设 `volatile: true`。`astHasVolatileCall(ast)` 依据注册表元数据判断整条公式是否易失。宿主在任意单元格变更后，应把 `graph.volatileCells()` 一并加入脏集合并继续沿依赖图传播。

循环引用：`DependencyGraph.affectedBy` 会把环上的格也返回，但它不做循环检测。宿主求值时必须维护「在途集合」，遇到回边返回 `#CYCLE!`，否则互相引用会无限递归。`@infinitable/sheet` 的 `FormulaEngine` 已经实现了这套护栏。

## 引用扫描与平移

### 容错扫描

`scanFormulaReferences(text)` 供公式编辑器做引用染色框。输入可以带或不带前导 `=`，可以是编辑中的半截公式，永不抛错：

```ts
import { scanFormulaReferences } from 'infinitable'

const refs = scanFormulaReferences('SUM(A1:B2, Sheet2!C3')
console.log(refs)
// => [
//   { ref: { ...range A1:B2... }, isRange: true, start: 4, end: 9 },
//   { ref: { ...cell Sheet2!C3... }, isRange: false, start: 11, end: 20 },
// ]
```

产物：

```ts
interface ScannedReference {
  ref: CellRef | RangeRef
  isRange: boolean
  /** 原文本字符偏移；end 排他 */
  start: number
  end: number
}
```

扫描规则与 tokenizer / parser 同源：标识符后紧跟 `(` 视为函数名；字符串字面量内不扫描；引号表名与 `!` 前缀计入 span；未闭合字符串或区域尾巴按「扫到多少算多少」处理。

### 行列插删平移

`shiftFormulaText` 在插入/删除行或列时按 token 级改写公式文本：

```ts
import { shiftFormulaText } from 'infinitable'

console.log(shiftFormulaText('SUM(A1:A3)', 'rows', 1, 1, 'insert'))
// => { text: 'SUM(A1:A4)', broken: false }

console.log(shiftFormulaText('A2', 'rows', 1, 1, 'delete'))
// => { text: '#REF!', broken: true }
```

签名：

```ts
function shiftFormulaText(
  formula: string,
  axis: 'rows' | 'cols',
  at: number,
  count: number,
  mode: 'insert' | 'delete',
): { text: string; broken: boolean }
```

规则：

- 插入：`start >= at` 的引用整体后移；跨插入点的区域扩展。
- 删除：按保留量裁剪区域；保留 0 或单格被删时 `broken: true`，被删引用以 `#REF!` 占位。
- `A$1` 的行绝对不随行平移，`$A1` 的列绝对不随列平移；区域起点绝对时整区域不随该轴移动。
- 函数名后紧跟 `(` 的标识符（如 `LOG10(`）不会被当成引用。
- 解析失败原样返回，`broken: false`。

`shiftFormulaRefs` 是填充柄复制语义的增量平移：

```ts
import { shiftFormulaRefs } from 'infinitable'

console.log(shiftFormulaRefs('A1 + $B$2', 1, 0)) // => 'A2 + $B$2'
console.log(shiftFormulaRefs('A1', -1, 0)) // => '#REF!'
```

- `$` 绝对轴坐标锁定不动，非绝对轴整体加 delta。
- 任一端出界（负坐标）时整个引用以 `#REF!` 占位。
- delta 全 0 或解析失败时原样返回。

## 宿主装配：表格 + 公式重算

下面的例子用 `ListTable` + formulas 搭一张最小公式表：A1、A2 是输入，B1 是 `=SUM(A1:A2)`。它展示了完整的宿主职责：解析建图、递归求值、循环护栏、变更闭包、局部刷新。

```html
<div id="formula-table" style="width: 360px; height: 160px"></div>
<button id="bump">A1 + 5</button>
```

```ts
import {
  DependencyGraph,
  ListTable,
  astHasVolatileCall,
  collectAstReferences,
  evaluate,
  formulaError,
  isFormulaError,
  parseFormula,
  type FormulaError,
  type FormulaRefCoord,
  type RangeRef,
  type SheetCellCoord,
} from 'infinitable'

type CellValue = number | string | boolean | null
type HostValue = CellValue | FormulaError

const SHEET = 'Sheet1'
const key = (col: number, row: number) => `${col},${row}`

const cells = new Map<string, CellValue>([
  ['0,0', 10],
  ['0,1', 20],
])
const formulas = new Map<string, string>()
const computed = new Map<string, HostValue>()
const graph = new DependencyGraph()

function registerFormula(col: number, row: number, text: string): void {
  try {
    const ast = parseFormula(text)
    const refs: FormulaRefCoord[] = collectAstReferences(ast).map((item) =>
      item.kind === 'cell'
        ? {
            kind: 'cell' as const,
            ref: {
              sheet: item.ref.sheet ?? SHEET,
              col: item.ref.col,
              row: item.ref.row,
            },
          }
        : {
            kind: 'range' as const,
            ref: {
              sheet: item.ref.sheet ?? SHEET,
              startCol: item.ref.startCol,
              startRow: item.ref.startRow,
              endCol: item.ref.endCol,
              endRow: item.ref.endRow,
            },
          },
    )
    graph.setFormula({ sheet: SHEET, col, row }, refs, {
      volatile: astHasVolatileCall(ast),
    })
  } catch {
    // 解析失败：保留公式节点但无依赖，求值时由 evaluate 返回 #ERROR!
    graph.setFormula({ sheet: SHEET, col, row }, [])
  }
}

function readRange(ref: RangeRef, visiting: Set<string>): HostValue[] {
  if (ref.sheet !== undefined && ref.sheet !== SHEET) return [formulaError('#REF!')]
  const values: HostValue[] = []
  for (let row = ref.startRow; row <= ref.endRow; row++) {
    for (let col = ref.startCol; col <= ref.endCol; col++) {
      const value = readCell(col, row, visiting)
      if (value !== null) values.push(value)
    }
  }
  return values
}

function readCell(col: number, row: number, visiting: Set<string>): HostValue {
  const k = key(col, row)
  const cached = computed.get(k)
  if (cached !== undefined) return cached

  const text = formulas.get(k)
  if (!text) return cells.get(k) ?? null
  if (visiting.has(k)) return formulaError('#CYCLE!')

  visiting.add(k)
  try {
    const result = evaluate(
      text,
      {
        cell: (ref) => {
          if (ref.sheet !== undefined && ref.sheet !== SHEET) return formulaError('#REF!')
          return readCell(ref.col, ref.row, visiting)
        },
        range: (ref) => readRange(ref, visiting),
      },
      { sheet: SHEET, cell: { col, row } },
    )
    computed.set(k, result)
    return result
  } catch {
    return formulaError('#ERROR!')
  } finally {
    visiting.delete(k)
  }
}

function display(col: number, row: number): string {
  const value = readCell(col, row, new Set())
  if (isFormulaError(value)) return value.code
  return value == null ? '' : String(value)
}

let table: ListTable | null = null

function writeCell(col: number, row: number, input: unknown): void {
  const k = key(col, row)

  if (typeof input === 'string' && input.startsWith('=') && input.length > 1) {
    const text = input.slice(1)
    formulas.set(k, text)
    registerFormula(col, row, text)
  } else {
    formulas.delete(k)
    graph.remove({ sheet: SHEET, col, row })
    cells.set(k, input as CellValue)
  }

  const changed: SheetCellCoord = { sheet: SHEET, col, row }
  const dirty = new Map<string, SheetCellCoord>()
  dirty.set(k, changed)
  for (const coord of graph.affectedBy([changed])) {
    dirty.set(key(coord.col, coord.row), coord)
  }
  for (const coord of graph.volatileCells()) {
    dirty.set(key(coord.col, coord.row), coord)
  }

  for (const dirtyKey of dirty.keys()) computed.delete(dirtyKey)
  for (const coord of dirty.values()) table?.refreshCell(coord.col, coord.row)
}

// B1 = SUM(A1:A2)
formulas.set(key(1, 0), 'SUM(A1:A2)')
registerFormula(1, 0, 'SUM(A1:A2)')

const container = document.querySelector<HTMLDivElement>('#formula-table')!
table = new ListTable({
  width: 360,
  height: 160,
  columns: [
    { title: 'A', width: 160 },
    { title: 'B', width: 160 },
  ],
  rowCount: 3,
  model: {
    rowCount: 3,
    getCellValue: (col, row) => {
      const k = key(col, row)
      const text = formulas.get(k)
      return text ? `=${text}` : (cells.get(k) ?? null)
    },
    setCellValue: (col, row, value) => writeCell(col, row, value),
    onCellChange: () => () => {},
  },
  resolveDisplayValue: (col, row) => display(col, row),
  hostOptions: { container },
})

document.querySelector<HTMLButtonElement>('#bump')!.addEventListener('click', () => {
  writeCell(0, 0, Number(cells.get('0,0') ?? 0) + 5)
})

window.addEventListener('beforeunload', () => table?.destroy())
```

几个关键点：

- 表格模型返回公式原文（`'=' + f`）作为编辑初值，`resolveDisplayValue` 返回计算结果；编辑与显示两条链分开。
- `readCell` 用 `computed` 缓存结果，形成按需的拓扑求值；`visiting` 负责循环检测，回边返回 `#CYCLE!`。
- 每次写入先清掉脏格的缓存，再通过 `graph.affectedBy` 找出所有下游格，逐个 `refreshCell`。
- `graph.volatileCells()` 无条件加入脏集合，保证易失函数在任意变更后重算。
- 由公式自身引发的派生变更也应进入同一个撤销单元；上面的最小例子没有撤销栈，真实宿主可参考 `@infinitable/sheet` 的做法：公式重算补丁与命令 mutation 合并后入栈。

## 与 sheet 层的关系

`@infinitable/sheet` 的 `FormulaEngine` 是 formulas 在电子表格场景的参考装配：

- 每个 `Workbook` 共享一个 `FormulaEngine`，跨表引用与改名联动在门面层完成。
- `Sheet` 的每次命令执行后，`FormulaEngine.recalc` 提取变更格，用 `DependencyGraph.affectedBy` 与 `volatileCells` 标脏，递归求值，产出派生补丁。
- 求值期遇到在途回边，环上格记为 `#CYCLE!`；环外格只传播错误。
- 删除表时先取 `affectedBySheet`，注销后让引用方变 `#REF!`；改名时重排索引并用别名链解析旧表名。
- 派生补丁与命令 mutation 合并为同一个 undo 单元；undo/redo 回放补丁，不重新求值。

需要公式但不需要电子表格模型时，直接按上一节装配；需要完整工作簿语义时，使用 `infinitable/sheet`。
