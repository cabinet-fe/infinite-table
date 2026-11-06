// 绑定预设的纯映射：区域类型 + 字段名 + 作用方式 → 绑定路径与聚合。
// 抽成独立文件是为了让「一次点击该生成什么绑定」这条规则可被无 DOM 的纯逻辑测试锁住，
// UI 只负责调用它（BindingEditor 内不再散落字符串拼接）。

import type { FormCellBinding } from './template'

/** 非展开区的作用方式：取第 1 条 / 聚合函数 */
export type BindingAggregateMode = NonNullable<FormCellBinding['aggregate']> | 'first'

/** 一次点击要写入的绑定载荷（不含数据集 id 与表达式） */
export interface BindingPreset {
  path: string
  aggregate: FormCellBinding['aggregate']
}

/** 作用方式的可选项（UI 顺序即此顺序） */
export const AGGREGATE_MODES: { value: BindingAggregateMode; label: string; hint: string }[] = [
  { value: 'first', label: '取第 1 条', hint: '只取数据集第一行的这个字段' },
  { value: 'sum', label: '求和', hint: '把该字段所有值加起来（适合金额、数量）' },
  { value: 'avg', label: '平均', hint: '求该字段平均值' },
  { value: 'count', label: '计数', hint: '数一数有多少条' },
  { value: 'max', label: '最大', hint: '取该字段最大值' },
  { value: 'min', label: '最小', hint: '取该字段最小值' },
]

/**
 * 生成绑定预设。
 *
 * - 会被重复复制的区域（`expand !== 'none'`）：永远 `[].<col>` 且无聚合——这块本身
 *   就按数据份数复制，聚合在这里没有意义，即便调用方传了聚合也忽略（测试锁定）。
 * - 静态区：`first` → `[0].<col>` 无聚合（取首条的单个值）；
 *   其余 → `[].<col>` + 对应聚合（对整列取值再聚合）。
 */
export function buildBindingPreset(
  inRepeatable: boolean,
  column: string,
  mode: BindingAggregateMode,
): BindingPreset {
  if (inRepeatable) return { path: `[].${column}`, aggregate: undefined }
  if (mode === 'first') return { path: `[0].${column}`, aggregate: undefined }
  return { path: `[].${column}`, aggregate: mode }
}

/**
 * 反推当前绑定对应的作用方式（用于按钮选中态）。
 * 展开区的绑定恒视为 `first` 语义（按份取值），供 UI 隐藏整组按钮前保持稳定。
 */
export function detectAggregateMode(
  inRepeatable: boolean,
  binding: FormCellBinding | undefined,
): BindingAggregateMode {
  if (inRepeatable) return 'first'
  if (!binding) return 'first'
  if (binding.aggregate) return binding.aggregate
  return 'first'
}

/**
 * 从绑定路径反推字段名（末段 `[].` / `[0].` 之后的列名）。
 * 不是简单直绑（如嵌套 `[0].items[].price`）时返回 undefined——此时 UI 不点亮任何 chip。
 */
export function boundColumnOf(binding: FormCellBinding | undefined): string | undefined {
  if (!binding) return undefined
  const match = /^\[(?:|\d+)\]\.([A-Za-z0-9_\u4e00-\u9fa5]+)$/.exec(binding.path)
  return match ? match[1] : undefined
}
