// 函数注册表（可扩展）：模块级全局、大小写不敏感、同名覆盖（对齐 ultra-ui 语义）。
// 每个函数携带元数据（签名/描述/分类/参数表）——公式栏补全、参数提示、函数面板的单一数据源。
// 易失性函数（TODAY/NOW/RAND/RANDBETWEEN）带 volatile 标记，宿主缓存策略据此查询。

import type { AstNode } from '../ast'
import { formulaError } from '../errors'
import type { EvalValue, FormulaEvalContext } from '../evaluator'

/** 函数分类（函数面板分组固定集合） */
export type FormulaFunctionCategory =
  | '常用'
  | '财务'
  | '日期与时间'
  | '数学'
  | '统计'
  | '查找与引用'
  | '文本'
  | '逻辑'

/** 分类展示顺序（面板导航顺序即此顺序；「全部」为宿主导航概念，不在其中） */
export const FORMULA_FUNCTION_CATEGORIES: readonly FormulaFunctionCategory[] = [
  '常用',
  '财务',
  '日期与时间',
  '数学',
  '统计',
  '查找与引用',
  '文本',
  '逻辑',
]

/** 函数参数元数据（`name: '...'` 表示可变参数尾巴） */
interface FormulaFunctionParam {
  name: string
  optional?: boolean
}

/** 注册时携带的函数元数据（第三方函数可省略，省略后不出现在分类面板、补全仅显示名称） */
interface FormulaFunctionMeta {
  description: string
  category: FormulaFunctionCategory
  params: FormulaFunctionParam[]
}

/** 列表/查询返回的完整函数信息（补全、参数提示、函数面板共用） */
export interface FormulaFunctionInfo {
  name: string
  /** 签名展示：`SUM(number1, [number2], ...)`；无参数为 `TODAY()` */
  signature: string
  description: string
  /** 未声明分类（第三方函数）为 undefined：仅出现在「全部」 */
  category: FormulaFunctionCategory | undefined
  params: FormulaFunctionParam[]
  /** 易失性：任意单元格变更触发重算时所在公式格必重新求值 */
  volatile: boolean
}

type FormulaFunctionBase = {
  minArgs?: number
  maxArgs?: number
  volatile?: boolean
  /** 补全/帮助元数据；缺省时候选仅显示函数名 */
  meta?: FormulaFunctionMeta
}

export type FormulaFunction =
  | (FormulaFunctionBase & {
      kind?: 'normal'
      impl: (args: EvalValue[], ctx?: FormulaEvalContext) => EvalValue
    })
  | (FormulaFunctionBase & {
      /** lazy 函数自行求值参数（IF 的短路分支、查找函数的区域几何回读） */
      kind: 'lazy'
      impl: (
        nodes: AstNode[],
        evalNode: (node: AstNode) => EvalValue,
        ctx?: FormulaEvalContext,
      ) => EvalValue
    })

const registry = new Map<string, FormulaFunction>()

/**
 * 实例函数集（求值覆盖集）：key 与全局注册表同为函数名大写形态，查询时先于此、
 * 未命中回落全局——多工作簿宿主（@infinitable/sheet 的 FormulaEngine）经它提供
 * 按实例隔离的自定义函数，不改写全局注册表
 */
export type FormulaFunctionOverrides = ReadonlyMap<string, FormulaFunction>

/** 注册函数（名称大小写不敏感；同名覆盖，供扩展/自定义函数；可带 meta） */
export function registerFormulaFunction(name: string, def: FormulaFunction): void {
  registry.set(name.toUpperCase(), def)
}

/** 查询函数定义（大小写不敏感；实例集优先） */
export function getFormulaFunction(
  name: string,
  overrides?: FormulaFunctionOverrides,
): FormulaFunction | undefined {
  return overrides?.get(name.toUpperCase()) ?? registry.get(name.toUpperCase())
}

/** 易失性查询（宿主缓存策略用；实例集优先）：未注册函数返回 false */
export function isVolatileFormulaFunction(name: string, overrides?: FormulaFunctionOverrides): boolean {
  return getFormulaFunction(name, overrides)?.volatile === true
}

/** 格式化函数签名：可选参数加 `[]`，`name: '...'` 渲染为 `...` */
export function formatFunctionSignature(
  name: string,
  params: readonly FormulaFunctionParam[],
): string {
  const parts = params.map((param) => {
    if (param.name === '...') {
      return '...'
    }
    return param.optional ? `[${param.name}]` : param.name
  })
  return `${name}(${parts.join(', ')})`
}

function toInfo(name: string, def: FormulaFunction): FormulaFunctionInfo {
  const params = def.meta?.params ?? []
  return {
    name,
    signature: formatFunctionSignature(name, params),
    description: def.meta?.description ?? '',
    category: def.meta?.category,
    params,
    volatile: def.volatile === true,
  }
}

/** 查询单个函数的完整信息（大小写不敏感；未注册返回 undefined） */
export function getFormulaFunctionInfo(name: string): FormulaFunctionInfo | undefined {
  const def = registry.get(name.toUpperCase())
  return def ? toInfo(name.toUpperCase(), def) : undefined
}

/** 枚举全部已注册函数信息（名称升序） */
export function listFormulaFunctions(): FormulaFunctionInfo[] {
  return [...registry.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => toInfo(name, registry.get(name)!))
}

/** 求值器回调：名称解析 + 参数个数校验 + 按 kind 分发（ctx 为公式所在格的求值上下文；实例集优先） */
export function invokeFormulaFunction(
  name: string,
  nodes: AstNode[],
  evalNode: (node: AstNode) => EvalValue,
  ctx?: FormulaEvalContext,
  overrides?: FormulaFunctionOverrides,
): EvalValue {
  const def = getFormulaFunction(name, overrides)
  if (!def) {
    return formulaError('#NAME?')
  }
  if (def.minArgs !== undefined && nodes.length < def.minArgs) {
    return formulaError('#VALUE!')
  }
  if (def.maxArgs !== undefined && nodes.length > def.maxArgs) {
    return formulaError('#VALUE!')
  }
  if (def.kind === 'lazy') {
    return def.impl(nodes, evalNode, ctx)
  }
  return def.impl(nodes.map(evalNode), ctx)
}
