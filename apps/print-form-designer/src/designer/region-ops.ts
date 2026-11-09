// 数据块结构的纯变换：校验 + 产出新数据块序列，不碰 Sheet 模型、不碰撤销门面。
//
// 为什么独立成文件：form-doc.ts 已经接近单文件行数上限，而这些操作本身只是
// 「旧数组 → 新数组」的纯函数（重叠判定、改名去空白、数据源清洗、行数增减的下移量）。
// 抽出来后 FormDoc 上的方法只负责「捕获前后态 → 调这里 → 记撤销链」，职责边界更清楚。

import {
  normalizeRegions,
  regionsOverlap,
  type FormAggregation,
  type FormRegion,
  type RegionExpand,
  type RegionRowRole,
  type RegionSource,
} from './template'

/** 目标数据块下标越界时抛错（面板禁用已保证，防御性兜底） */
export function regionAt(regions: readonly FormRegion[], index: number): FormRegion {
  const region = regions[index]
  if (!region) throw new Error(`数据块下标越界: ${index}`)
  return region
}

/**
 * 把数据块矩形框成新数据块（已有数据块重叠即拒绝）。
 * 编辑期保留数据源；建数据块、绑数据源、设展开方式的顺序随意（展开未绑源是合法中间态）。
 */
export function appendRegionRect(
  regions: readonly FormRegion[],
  rect: FormRegion,
  aggregations: readonly FormAggregation[] = [],
): FormRegion[] {
  if (regions.some((region) => regionsOverlap(region, rect))) {
    throw new Error('选区包含已有数据块的单元格，无法再设为数据块')
  }
  return [...regions, normalizeRegions([rect], aggregations)[0]!]
}

/**
 * 改展开方式：`down` / `right` 各最多一个；数据源可后绑——`expand !== 'none'`
 * 且无 source 是合法中间态（渲染暂按 1 份）。
 * v4 起改回 `none` **保留**数据源（不展开 + 带源 = 静态取第 1 条）；
 * 离开 `down` 时分组配置与行角色一并清除（它们只对向下展开有意义）。
 */
export function regionsWithExpand(
  regions: readonly FormRegion[],
  index: number,
  expand: RegionExpand,
  aggregations: readonly FormAggregation[] = [],
): FormRegion[] {
  regionAt(regions, index)
  if (expand !== 'none') {
    const existing = regions.findIndex((r, i) => i !== index && r.expand === expand)
    if (existing >= 0) {
      const label = expand === 'down' ? '纵向列表' : '横向列表'
      throw new Error(`已经有数据块 ${existing + 1} 在「${label}」了：同一模板只能有一个`)
    }
  }
  return normalizeRegions(
    regions.map((r, i) => {
      if (i !== index) return r
      if (expand === 'down') return { ...r, expand }
      // 离开 down：分组与行角色失去语义，随之清除（数据源保留）
      const { groupBy: _groupBy, rowRoles: _rowRoles, ...rest } = r
      return { ...rest, expand }
    }),
    aggregations,
  )
}

/** 设置/替换数据源（清空后展开方式保留——回到展开未绑源的合法中间态；不展开的数据块可带源做静态取值） */
export function regionsWithSource(
  regions: readonly FormRegion[],
  index: number,
  source: RegionSource | undefined,
  aggregations: readonly FormAggregation[] = [],
): FormRegion[] {
  regionAt(regions, index)
  const next: RegionSource | undefined = source
    ? source.kind === 'dataset'
      ? {
          kind: 'dataset',
          datasetId: source.datasetId.trim(),
          ...(source.expression?.trim() ? { expression: source.expression.trim() } : {}),
          path: source.path,
        }
      : { kind: 'agg', aggName: source.aggName.trim(), path: source.path }
    : undefined
  return normalizeRegions(
    regions.map((r, i) => {
      if (i !== index) return r
      const { source: _old, ...rest } = r
      return next ? { ...rest, source: next } : rest
    }),
    aggregations,
  )
}

/** 重命名（空名 = 回到缺省的「数据块 N」） */
export function regionsWithName(
  regions: readonly FormRegion[],
  index: number,
  name: string,
): FormRegion[] {
  regionAt(regions, index)
  const trimmed = name.trim()
  return regions.map((r, i) => {
    if (i !== index) return r
    const { name: _old, ...rest } = r
    return trimmed ? { ...rest, name: trimmed } : rest
  })
}

/** 改范围/命名/数据源等基础字段（不移动画布内容；无限画布下没有尺寸上界；越界角色行被规范化剔除） */
export function regionsWithFields(
  regions: readonly FormRegion[],
  index: number,
  patch: Partial<Omit<FormRegion, 'expand' | 'groupBy' | 'rowRoles'>>,
  aggregations: readonly FormAggregation[] = [],
): FormRegion[] {
  regionAt(regions, index)
  return normalizeRegions(
    regions.map((region, i) => (i === index ? { ...region, ...patch } : region)),
    aggregations,
  )
}

/**
 * 典型分组布局的行角色预填：第 1 行组头、最后一行合计、数据块 ≥4 行时倒数第 2 行小计，
 * 其余留默认明细。行数不足降级：3 行 → 组头+明细+合计；2 行 → 组头+合计；
 * 1 行 → 仅组头（组头与合计撞行，保留更能体现分组的组头）。
 */
function typicalGroupRowRoles(region: FormRegion): { row: number; role: RegionRowRole }[] {
  const rows = region.endRow - region.startRow + 1
  if (rows < 2) return [{ row: region.startRow, role: 'groupHeader' }]
  const roles: { row: number; role: RegionRowRole }[] = [
    { row: region.startRow, role: 'groupHeader' },
  ]
  if (rows >= 4) roles.push({ row: region.endRow - 1, role: 'groupFooter' })
  roles.push({ row: region.endRow, role: 'summary' })
  return roles
}

/**
 * 设置分组字段（空数组/undefined = 清除）。
 * 从 0 → ≥1 且行角色全是默认明细时，顺手按典型布局预填（免逐行手配，用户可任意改）；
 * 手动配过任何角色则不动。反向清除（≥1 → 0）时组头/小计失去依持，随之剔除
 * （合计行不依赖分组，保留）——否则刚预填的角色会让「加个字段又移掉」被校验卡住。
 */
export function regionsWithGroupBy(
  regions: readonly FormRegion[],
  index: number,
  paths: string[] | undefined,
  aggregations: readonly FormAggregation[] = [],
): FormRegion[] {
  regionAt(regions, index)
  return normalizeRegions(
    regions.map((region, i) => {
      if (i !== index) return region
      const next = paths?.map((path) => path.trim()).filter((path) => path !== '')
      const { groupBy: _old, rowRoles: _oldRoles, ...rest } = region
      if (!next?.length) {
        const rowRoles = region.rowRoles?.filter(
          (entry) => entry.role !== 'groupHeader' && entry.role !== 'groupFooter',
        )
        return rowRoles?.length ? { ...rest, rowRoles } : rest
      }
      const untouched = region.rowRoles?.some((entry) => entry.role !== 'detail')
      return {
        ...rest,
        groupBy: next,
        rowRoles: untouched ? region.rowRoles : typicalGroupRowRoles(region),
      }
    }),
    aggregations,
  )
}

/** 设置某行的角色（'detail' = 清除标记，回到默认明细行） */
export function regionsWithRowRole(
  regions: readonly FormRegion[],
  index: number,
  row: number,
  role: RegionRowRole,
  aggregations: readonly FormAggregation[] = [],
): FormRegion[] {
  regionAt(regions, index)
  return normalizeRegions(
    regions.map((region, i) => {
      if (i !== index) return region
      const roles = (region.rowRoles ?? []).filter((entry) => entry.row !== row)
      if (role !== 'detail') roles.push({ row, role })
      const { rowRoles: _old, ...rest } = region
      return roles.length ? { ...rest, rowRoles: roles } : rest
    }),
    aggregations,
  )
}

/** 行数调整计划：数据块变高/变矮时下方数据块的位移量与快照插删落点 */
interface RowResizePlan {
  regions: FormRegion[]
  /** 插行/删行的起点（数据块底部边界） */
  at: number
  /** 行数增量（正数插行、负数删行） */
  delta: number
}

/** 平移数据块的行角色标记（插删行后下方数据块整体位移，角色行号跟着走） */
function shiftRowRoles(region: FormRegion, delta: number): FormRegion {
  if (!region.rowRoles?.length) return region
  return {
    ...region,
    rowRoles: region.rowRoles.map((entry) => ({ ...entry, row: entry.row + delta })),
  }
}

/**
 * 调整数据块行数：变高在数据块底部插空行、变矮删底行（内容留原处），
 * 下方数据块整体平移（行角色标记随之平移）；行数不变或小于 1 时返回 null（调用方不入撤销链）。
 */
export function planRegionRowResize(
  regions: readonly FormRegion[],
  index: number,
  rows: number,
  aggregations: readonly FormAggregation[] = [],
): RowResizePlan | null {
  const region = regionAt(regions, index)
  const delta = rows - (region.endRow - region.startRow + 1)
  if (rows < 1 || delta === 0) return null
  const at = delta > 0 ? region.endRow + 1 : region.endRow + delta + 1
  // 行区调整后不得与其它数据块重叠（下方数据块起点可能被吃进来）
  const shifted = regions.map((r, i) =>
    shiftRowRoles(
      {
        ...r,
        startRow: r.startRow + (i > index ? delta : 0),
        endRow: r.endRow + (i >= index ? delta : 0),
      },
      i > index ? delta : 0,
    ),
  )
  return { regions: normalizeRegions(shifted, aggregations), at, delta }
}
