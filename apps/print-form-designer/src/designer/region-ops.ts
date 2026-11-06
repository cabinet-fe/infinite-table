// 区域结构的纯变换：校验 + 产出新区域序列，不碰 Sheet 模型、不碰撤销门面。
//
// 为什么独立成文件：form-doc.ts 已经接近单文件行数上限，而这些操作本身只是
// 「旧数组 → 新数组」的纯函数（重叠判定、改名去空白、数据源清洗、行数增减的下移量）。
// 抽出来后 FormDoc 上的方法只负责「捕获前后态 → 调这里 → 记撤销链」，职责边界更清楚。

import {
  normalizeRegions,
  regionsOverlap,
  type FormRegion,
  type RegionExpand,
  type RegionSource,
} from './template'

/** 目标区域下标越界时抛错（面板禁用已保证，防御性兜底） */
export function regionAt(regions: readonly FormRegion[], index: number): FormRegion {
  const region = regions[index]
  if (!region) throw new Error(`区域下标越界: ${index}`)
  return region
}

/**
 * 把区域矩形框成新区域（已有区域重叠即拒绝）。
 * 编辑期保留数据源：用户通常先建区、再选数据集、最后设展开方式。
 */
export function appendRegionRect(regions: readonly FormRegion[], rect: FormRegion): FormRegion[] {
  if (regions.some((region) => regionsOverlap(region, rect))) {
    throw new Error('选区包含已有区域的单元格，无法再设为区域')
  }
  return [...regions, normalizeRegions([rect])[0]!]
}

/**
 * 改展开方式：`down` / `right` 各最多一个；展开区必须有数据源。
 * 改回 `none` 视为显式放弃展开驱动，这块的数据源一并丢弃。
 */
export function regionsWithExpand(
  regions: readonly FormRegion[],
  index: number,
  expand: RegionExpand,
): FormRegion[] {
  const region = regionAt(regions, index)
  if (expand !== 'none') {
    if (!region.source) {
      throw new Error(`区域 ${index + 1} 还没有数据源：先选数据集与列表路径，再设展开方式`)
    }
    const existing = regions.findIndex((r, i) => i !== index && r.expand === expand)
    if (existing >= 0) {
      const label = expand === 'down' ? '向下展开' : '向右展开'
      throw new Error(`已经有区域 ${existing + 1} 在「${label}」了：同一模板只能有一个`)
    }
  }
  return normalizeRegions(
    regions.map((r, i) => {
      if (i !== index) return r
      if (expand === 'none') {
        const { source: _source, ...rest } = r
        return { ...rest, expand }
      }
      return { ...r, expand }
    }),
  )
}

/** 设置/替换数据源（展开中的区域不允许清空；不展开区域可挂过渡态数据源） */
export function regionsWithSource(
  regions: readonly FormRegion[],
  index: number,
  source: RegionSource | undefined,
): FormRegion[] {
  const region = regionAt(regions, index)
  if (!source && region.expand !== 'none') {
    throw new Error(`区域 ${index + 1} 正在展开：不能清空数据源`)
  }
  if (source && source.datasetId.trim() === '') {
    throw new Error(`区域 ${index + 1} 数据源不完整：数据集不能为空`)
  }
  const next: RegionSource | undefined = source
    ? {
        datasetId: source.datasetId.trim(),
        ...(source.expression?.trim() ? { expression: source.expression.trim() } : {}),
        path: source.path,
      }
    : undefined
  return regions.map((r, i) => {
    if (i !== index) return r
    const { source: _old, ...rest } = r
    return next ? { ...rest, source: next } : rest
  })
}

/** 重命名（空名 = 回到缺省的「区域 N」） */
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

/** 改范围/重复标记（不移动画布内容；无限画布下没有尺寸上界） */
export function regionsWithFields(
  regions: readonly FormRegion[],
  index: number,
  patch: Partial<Omit<FormRegion, 'expand'>>,
): FormRegion[] {
  regionAt(regions, index)
  return normalizeRegions(
    regions.map((region, i) => (i === index ? { ...region, ...patch } : region)),
  )
}

/** 行数调整计划：区域变高/变矮时下方区域的位移量与快照插删落点 */
interface RowResizePlan {
  regions: FormRegion[]
  /** 插行/删行的起点（区域底部边界） */
  at: number
  /** 行数增量（正数插行、负数删行） */
  delta: number
}

/**
 * 调整区域行数：变高在区域底部插空行、变矮删底行（内容留原处），
 * 下方区域整体平移；行数不变或小于 1 时返回 null（调用方不入撤销链）。
 */
export function planRegionRowResize(
  regions: readonly FormRegion[],
  index: number,
  rows: number,
): RowResizePlan | null {
  const region = regionAt(regions, index)
  const delta = rows - (region.endRow - region.startRow + 1)
  if (rows < 1 || delta === 0) return null
  const at = delta > 0 ? region.endRow + 1 : region.endRow + delta + 1
  // 行区调整后不得与其它区域重叠（下方区域起点可能被吃进来）
  const shifted = regions.map((r, i) => ({
    ...r,
    startRow: r.startRow + (i > index ? delta : 0),
    endRow: r.endRow + (i >= index ? delta : 0),
  }))
  // 调行数不该顺手把用户刚选的数据源清掉：normalizeRegions 恒保留 source
  return { regions: normalizeRegions(shifted), at, delta }
}
