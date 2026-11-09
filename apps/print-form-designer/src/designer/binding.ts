// 绑定域：取数路径的解析/还原/求值 + 绑定树构建。
//
// 路径语法（只是点分寻址记法，不自造 DSL）：
// - 对象段点分：`customer.name`（键名兼容 SQL 列名，除 `.` `[` `]` 外任意字符）；
// - 数组下标：`items[0].name`；
// - 空下标 `[]` = 循环标记：仅供数据块数据源路径与绑定树分支使用；
// - 根为数组时首段可直接写下标：`[0].name` / `[]`（原始行数组直取）。
// 嵌套数组任意深度由「键步 / 下标步」交替序列自然承载（`a[0][1]`、`orders[0].lines`）。
//
// v4 口径：字段绑定只剩「条目内相对路径」（resolveItemValue），绝对绑定与
// 单元格聚合已由单元格函数（cell-function.ts）替代。
import type { CellValue } from '@infinitable/sheet'

import { reshapeRows, type SourceRow } from '../transform/reshape'

/** 路径步：对象键步或数组下标步（'each' = 空下标循环标记） */
type BindingPathStep = { key: string } | { index: number | 'each' }

/** 非空对象判定（数组另判） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析点分路径为步序列；非法形态（空路径、空段、非整数下标）抛错 */
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
    // 一条路径只循环一个数组：嵌套二级数组把 [] 放在目标层（如 orders[0].lines[].qty）
    throw new Error('路径最多一个 [] 循环标记')
  }
  return steps
}

/** 步序列还原为规范路径字符串（parseBindingPath 的逆函数；绑定树与 round-trip 测试共用） */
export function formatBindingPath(steps: readonly BindingPathStep[]): string {
  let path = ''
  for (const step of steps) {
    if ('key' in step) path = path ? `${path}.${step.key}` : step.key
    else path += step.index === 'each' ? '[]' : `[${step.index}]`
  }
  return path
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

/**
 * 数据块 source 的循环数组：形态内 `path` 的解析结果即展开份数的来源。
 * - `path === ''` 表示「形态根就是列表」，要求形态本身是数组；
 * - 其余按常规路径寻址（`items` / `[0].items` / `order.lines`），取到的必须是数组；
 * - 形态缺失、路径取不到、取到非数组一律返回 undefined（调用方按「取不到」处理），
 *   路径语法非法由 parseBindingPath 直接抛错（不做静默兜底）。
 */
export function loopArrayAt(shape: unknown, path: string): unknown[] | undefined {
  const trimmed = path.trim()
  if (trimmed === '') return Array.isArray(shape) ? shape : undefined
  const value = walkSteps(shape, parseBindingPath(trimmed), -1)
  return Array.isArray(value) ? value : undefined
}

/**
 * 数据块内绑定的取值：条目 + 条目内相对字段路径 → 格值。
 * - `relativePath === ''` 表示条目本身就是该格的值（仅原始类型进格）；
 * - 相对路径不允许出现 `[]` 循环标记——数据块已按条目分份，条目内再循环没有落点，
 *   出现即抛错（模板写错时快速失败，不做「取第一份」之类的隐式猜测）。
 * 同时也是单元格函数里 `GROUP('字段')` / `SUM('数据块','字段')` 的字段取值器。
 */
export function resolveItemValue(item: unknown, relativePath: string): CellValue | undefined {
  const trimmed = relativePath.trim()
  if (trimmed === '') return toCellValue(item)
  const steps = parseBindingPath(trimmed)
  if (steps.some((step) => 'index' in step && step.index === 'each')) {
    throw new Error(`数据块内的绑定路径不能含 [] 循环标记：${trimmed}`)
  }
  return toCellValue(walkSteps(item, steps, -1))
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
 * 已在 `[]` 分支内不再提供第二层 `[]`（一条路径只循环一个数组）。
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
