// UI 选项常量与中文展示名：下拉/分段按钮的选项文案（value + label + hint）、侧栏、
// chip、悬停 pill 共用的 label 函数，与列表方式色表。只服务表现层——schema 类型与
// 校验在 shared/template-schema.ts，这里不含任何模型逻辑。
import type {
  AggregationType,
  FormRegion,
  RegionExpand,
  RegionRowRole,
} from '../shared/template-schema'

/** 聚合类型选项（UI 分段按钮直接消费；hint 写清两类产物的用途差异） */
export const AGGREGATION_TYPE_OPTIONS: { value: AggregationType; label: string; hint: string }[] = [
  { value: 'array', label: '数组型', hint: '产出一列数据，可绑成数据块逐条打印' },
  { value: 'value', label: '非数组型', hint: '产出一个值或对象，任意单元格直接引用' },
]

/** 列表方式选项（UI select 直接消费；hint 写清行为，面板在 select 下方灰字展示） */
export const REGION_EXPAND_OPTIONS: { value: RegionExpand; label: string; hint: string }[] = [
  {
    value: 'none',
    label: '非列表（固定一块）',
    hint: '固定内容，只打印一份（适合标题、签字栏）',
  },
  {
    value: 'down',
    label: '纵向列表（一条一行）',
    hint: '每条数据向下复制一份整块（如订单明细行）',
  },
  {
    value: 'right',
    label: '横向列表（一条一列）',
    hint: '每条数据向右复制一份整块',
  },
]

/** 列表方式 → 强调色（画布描边/手柄与侧栏圆点、数据块弹框标签共用同一份，保证「列表 ↔ 画布」同色直觉） */
export const REGION_EXPAND_COLORS: Record<RegionExpand, string> = {
  none: '#98a2b3',
  down: '#f79009',
  right: '#2f62f0',
}

/** 列表方式的展示名（非列表返回空串）；侧栏标签、绑定面板、悬停 pill 共用 */
export function regionExpandLabel(expand: RegionExpand): string {
  return expand === 'none'
    ? ''
    : (REGION_EXPAND_OPTIONS.find((option) => option.value === expand)?.label ?? '')
}

/**
 * 数据块展示名：`数据块 N · 纵向列表` / `数据块 N`（非列表不加后缀）。
 * 侧栏列表、绑定面板、选区 chip、画布悬停 pill 共用同一份文案，四处口径不会走偏。
 */
export function regionLabel(region: FormRegion, index: number): string {
  const expand = regionExpandLabel(region.expand)
  return expand ? `数据块 ${index + 1} · ${expand}` : `数据块 ${index + 1}`
}

/** 行角色选项（右键菜单与数据块弹框共用；顺序即菜单顺序）。hint 是「这行打印什么」的白话说明 */
export const REGION_ROW_ROLES: { value: RegionRowRole; label: string; hint: string }[] = [
  { value: 'detail', label: '明细行', hint: '每条数据占一行（默认）' },
  { value: 'groupHeader', label: '组头行', hint: '每组开头一行，显示分组名（如客户名）' },
  { value: 'groupFooter', label: '小计行', hint: '每组末尾一行，显示这一组的小计' },
  { value: 'summary', label: '合计行', hint: '所有组结束后的一行，显示总计' },
]

/** 行角色展示名（detail 返回空串，与展开方式的展示名口径一致） */
export function regionRowRoleLabel(role: RegionRowRole): string {
  return role === 'detail' ? '' : (REGION_ROW_ROLES.find((r) => r.value === role)?.label ?? '')
}
