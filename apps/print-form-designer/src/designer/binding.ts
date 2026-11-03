// 绑定域（P6）：取数路径的解析/还原/求值 + 绑定树构建。
//
// 路径语法（P3 schema 定型，只是点分寻址记法，不自造 DSL）：
// - 对象段点分：`customer.name`（键名兼容 SQL 列名，除 `.` `[` `]` 外任意字符）；
// - 数组下标：`items[0].name`；
// - 空下标 `[]` = 循环标记：明细区内逐行取值（`items[].price`），
//   非明细语境配合聚合遍历（`items[].price` + sum）；
// - 根为数组时首段可直接写下标：`[0].name` / `[]`（原始行数组直取）。
// 嵌套数组任意深度由「键步 / 下标步」交替序列自然承载（`a[0][1]`、`orders[].lines[].qty`）。
import type { CellValue } from '@infinitable/sheet'

import { reshapeRows, type SourceRow } from '../transform/reshape'
import type { FormCellBinding } from './template'

/** 路径步：对象键步或数组下标步（'each' = 空下标循环标记） */
export type BindingPathStep = { key: string } | { index: number | 'each' }

/** 非空对象判定（数组另判） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析点分路径为步序列；非法形态（空路径、空段、非整数下标、多循环标记）抛错 */
export function parseBindingPath(path: string): BindingPathStep[] {
  if (path.trim() === '') throw new Error('路径不能为空')
  const steps: BindingPathStep[] = []
  for (const part of path.split('.')) {
    const match = /^([^.[\]]*)((?:\[[^\]]*\])*)$/.exec(part)
    const key = match?.[1]
    const brackets = match?.[2]
    if (!match || (key === '' && brackets === '')) {
      throw new Error(`路径段非法：${part === '' ? '（空段）' : part}`)
    }
    if (key) steps.push({ key })
    for (const bracket of brackets!.matchAll(/\[([^\]]*)\]/g)) {
      const inner = bracket[1]!
      if (inner === '') {
        steps.push({ index: 'each' })
        continue
      }
      const index = Number(inner)
      if (!Number.isInteger(index)) throw new Error(`数组下标非法：${part}`)
      steps.push({ index })
    }
  }
  if (steps.filter((step) => 'index' in step && step.index === 'each').length > 1) {
    // 一个绑定只循环一个数组：嵌套二级数组把 [] 放在目标层（如 orders[0].lines[].qty）
    throw new Error('路径最多一个 [] 循环标记')
  }
  return steps
}

/** 步序列还原为规范路径字符串（树形选择器生成路径用） */
export function formatBindingPath(steps: readonly BindingPathStep[]): string {
  let path = ''
  for (const step of steps) {
    if ('key' in step) path = path ? `${path}.${step.key}` : step.key
    else path += step.index === 'each' ? '[]' : `[${step.index}]`
  }
  return path
}

/** 聚合实现：映射值数组 → 聚合结果（null/undefined 不计，数值聚合只吃 number） */
function aggregateValues(
  values: unknown[],
  kind: NonNullable<FormCellBinding['aggregate']>,
): CellValue | undefined {
  const present = values.filter((value) => value !== undefined && value !== null)
  if (kind === 'count') return present.length
  const numbers = present.filter((value): value is number => typeof value === 'number')
  if (kind === 'sum') return numbers.reduce((total, value) => total + value, 0)
  if (numbers.length === 0) return undefined
  if (kind === 'avg') return numbers.reduce((total, value) => total + value, 0) / numbers.length
  return kind === 'max' ? Math.max(...numbers) : Math.min(...numbers)
}

/** 沿步序列取值：each 步以传入下标代换（无循环语境传 -1 时该步自然取不到值） */
function walkSteps(current: unknown, steps: readonly BindingPathStep[], each: number): unknown {
  let value = current
  for (const step of steps) {
    if (value === undefined || value === null) return undefined
    if ('key' in step) value = isRecord(value) ? value[step.key] : undefined
    else if (step.index === 'each') value = Array.isArray(value) ? value[each] : undefined
    else value = Array.isArray(value) ? value[step.index] : undefined
  }
  return value
}

/** 求值结果收敛为格值：非原始类型（对象/数组/null/undefined）视为无值，不进格 */
function toCellValue(value: unknown): CellValue | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : undefined
}

/** 绑定求值语境：明细区内 each = 当前行对应的数组元素下标 */
export interface BindingResolveContext {
  each?: number
}

/**
 * 绑定 → 格值：数据形态内沿路径取值。
 * - 循环标记 `[]`：明细语境（ctx.each）取当前元素继续下探；非明细语境走聚合
 *   （aggregate 缺省 = 无值，避免隐式取首元素）；
 * - 聚合在明细语境忽略（P3 口径：明细区格忽略聚合）。
 */
export function resolveBindingValue(
  data: unknown,
  binding: FormCellBinding,
  context: BindingResolveContext = {},
): CellValue | undefined {
  const steps = parseBindingPath(binding.path)
  const eachAt = steps.findIndex((step) => 'index' in step && step.index === 'each')
  if (eachAt === -1) return toCellValue(walkSteps(data, steps, -1))
  // 明细语境：整条路径从根下探，each 步代换为当前元素下标
  if (context.each !== undefined) return toCellValue(walkSteps(data, steps, context.each))
  // 非明细语境：each 前缀定位数组，各元素对余步求值后聚合
  if (!binding.aggregate) return undefined
  const array = walkSteps(data, steps.slice(0, eachAt), -1)
  if (!Array.isArray(array)) return undefined
  const rest = steps.slice(eachAt + 1)
  return aggregateValues(
    array.map((element) => walkSteps(element, rest, -1)),
    binding.aggregate,
  )
}

/**
 * 绑定的明细循环数组：第一个 `[]` 步之前的路径解析结果为数组时返回之；
 * 供明细区确定展开行数（行数 = 数组长度）。
 */
export function detailLoopArray(data: unknown, binding: FormCellBinding): unknown[] | undefined {
  const steps = parseBindingPath(binding.path)
  const eachAt = steps.findIndex((step) => 'index' in step && step.index === 'each')
  if (eachAt === -1) return undefined
  const array = walkSteps(data, steps.slice(0, eachAt), -1)
  return Array.isArray(array) ? array : undefined
}

/**
 * 数据集原始行 → 绑定取数形态：有表达式经 reshapeRows 唯一重塑管线，
 * 缺省 = 原始行数组直接作形态。预览树与数据态渲染共用本入口。
 */
export function reshapeDatasetData(expression: string | undefined, rows: SourceRow[]): unknown {
  const trimmed = expression?.trim()
  return trimmed ? reshapeRows({ expression: trimmed }, rows) : rows
}

// ─── 绑定树（绑定编辑 UI 的路径选择器数据源） ────────────────────────────────

/** 树节点：label 显示、path 为点选即得的取数路径、children 下钻 */
export interface BindingTreeNode {
  label: string
  path: string
  kind: 'object' | 'array' | 'value'
  children?: BindingTreeNode[]
}

/** 数组元素形状采样：首个非空元素（形状混合时以首个为准，路径仍可手输兜底） */
function sampleElement(array: unknown[]): unknown {
  return array.find((item) => item !== undefined && item !== null) ?? array[0]
}

/** 对象形态 → 按键名排序的子节点列表 */
function objectChildren(
  value: Record<string, unknown>,
  steps: readonly BindingPathStep[],
  depth: number,
  eachUsed: boolean,
): BindingTreeNode[] {
  return Object.keys(value)
    .sort()
    .map((key) => buildNode(key, [...steps, { key }], value[key], depth + 1, eachUsed))
}

/**
 * 数组的下钻分支：`[]`（明细循环取值）与 `[0]`（固定下标采样）；
 * 已在 `[]` 分支内不再提供第二层 `[]`（一个绑定只循环一个数组）。
 */
function arrayBranches(
  array: unknown[],
  steps: readonly BindingPathStep[],
  depth: number,
  eachUsed: boolean,
): BindingTreeNode[] {
  const element = depth < 12 ? sampleElement(array) : undefined
  return (eachUsed ? ([0] as const) : (['each', 0] as const)).map((index) => {
    const branchSteps = [...steps, { index }]
    return {
      label: index === 'each' ? '[]' : '[0]',
      path: formatBindingPath(branchSteps),
      kind: isRecord(element) ? 'object' : 'value',
      children:
        isRecord(element) && depth < 12
          ? objectChildren(element, branchSteps, depth + 1, eachUsed || index === 'each')
          : undefined,
    }
  })
}

function buildNode(
  label: string,
  steps: readonly BindingPathStep[],
  value: unknown,
  depth: number,
  eachUsed: boolean,
): BindingTreeNode {
  if (Array.isArray(value)) {
    return {
      label,
      path: formatBindingPath(steps),
      kind: 'array',
      children: depth < 12 ? arrayBranches(value, steps, depth, eachUsed) : undefined,
    }
  }
  return {
    label,
    path: formatBindingPath(steps),
    kind: isRecord(value) ? 'object' : 'value',
    children:
      isRecord(value) && depth < 12 ? objectChildren(value, steps, depth, eachUsed) : undefined,
  }
}

/** 重塑后数据形态 → 顶层绑定树（根数组时直接给 `[]` / `[0]` 入口，无壳层） */
export function buildBindingTree(data: unknown): BindingTreeNode[] {
  if (Array.isArray(data)) return arrayBranches(data, [], 0, false)
  return isRecord(data) ? objectChildren(data, [], 0, false) : []
}
