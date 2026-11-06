import type { SheetSnapshot } from '@infinitable/sheet'

/**
 * 打印单模板 JSON schema（v2：区域模型）。
 *
 * 模板 = 区域序列 + 画布内容快照。区域只是**画布上的一个矩形 + 一个展开属性**，
 * 没有任何类型语义（v1 的「重复区/静态区/展开区/静态区/静态区」已废除：用户反馈
 * 除了会重复展开的那块，其它都是静态渲染，分类纯属多余）。
 *
 * 关键口径：
 * - 区域**不需要连续覆盖画布**。不属于任何区域的行/列就是普通静态内容。
 * - 区域之间**不得重叠**（`normalizeRegions` 校验）。
 * - 展开属性：`down` 按数据条数向下复制、`right` 向右平铺；同一模板内各最多一个。
 * - `repeat` 只对「前导区域」有意义（从第 0 行起连续、`expand === 'none'`）：
 *   打印内核只支持重复源表前 N 行，非前导区域的 repeat 渲染时忽略。
 *
 * 格内容/样式/合并/行高列宽/绑定 sidecar 全部由 SheetSnapshot 承载——不自造第二套
 * 样式模型。纸张/边距/缩放/分页等打印配置不进模板（只在打印弹框）。
 */

/** 模板 schema 版本（v1 → v2：bands 五类区域 → regions 矩形 + 展开属性） */
export const TEMPLATE_SCHEMA_VERSION = 2

/** 区域展开方式：不展开 / 向下展开 / 向右展开 */
export type RegionExpand = 'none' | 'down' | 'right'

/** 展开方式选项（UI select 直接消费；hint 写清行为，侧栏在 select 下方灰字展示） */
export const REGION_EXPAND_OPTIONS: { value: RegionExpand; label: string; hint: string }[] = [
  {
    value: 'none',
    label: '不展开',
    hint: '静态内容：原样打印一份，不随数据增减',
  },
  {
    value: 'down',
    label: '向下展开',
    hint: '按数据条数向下复制这块：有 N 条数据就上下摞 N 份（适合明细行）',
  },
  {
    value: 'right',
    label: '向右展开',
    hint: '按数据条数向右平铺这块：有 N 条数据就左右并 N 份（画布变宽，超出纸张由横向分页容纳）',
  },
]

/**
 * 区域：画布上的矩形 + 展开属性（闭区间，行列均为 0 基）。
 */
export interface FormRegion {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
  expand: RegionExpand
  /** 每页重复：仅打印时生效，且仅对「前导区域」有意义（打印内核只支持重复源表前 N 行） */
  repeat?: boolean
}

/** 区域矩形内命中判定（画布底色、绑定面板判断当前格属于哪个区域） */
export function regionsAt(
  regions: readonly FormRegion[],
  row: number,
  col: number,
): FormRegion | undefined {
  return regions.find(
    (region) =>
      row >= region.startRow &&
      row <= region.endRow &&
      col >= region.startCol &&
      col <= region.endCol,
  )
}

/**
 * 格级字段绑定的 cell-meta sidecar 载荷形状。
 * 存储在 `FORM_BINDING_META_NAMESPACE` 命名空间下，随 SheetSnapshot.meta 序列化。
 */
export interface FormCellBinding {
  /** 目标数据集 id */
  datasetId: string
  /**
   * 数据集重塑表达式：以 `rows` 为唯一入参的 JS 表达式，求值结果即该数据集的
   * 取数形态；缺省 = 原始行数组直接作形态。预览与打印共用唯一重塑管线求值。
   */
  expression?: string
  /**
   * 数据集重塑后形态内的取数路径：点分段字符串，段为数组时可用下标（items[0]）
   * 或空段（items[].price，展开区内逐份取值）；求值在数据态管线。
   */
  path: string
  /** 聚合方式（静态区常用；缺省 = 直取值，展开区格忽略聚合） */
  aggregate?: 'sum' | 'avg' | 'count' | 'max' | 'min'
}

/** 绑定 sidecar 的 cell-meta namespace（区别于 sheet 内建的 cell-image/cell-link） */
export const FORM_BINDING_META_NAMESPACE = 'form-binding'

/** 区域式打印单模板（后端 REST 持久化的 JSON 形态） */
export interface FormTemplate {
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION
  name: string
  /** 区域序列（界面称「区域」；顺序即侧栏顺序，与画布位置无关） */
  regions: FormRegion[]
  /** 画布列数（声明值；实际列数见 templateCols） */
  cols: number
  /** 画布内容快照：值/样式池/合并/行高列宽/行列默认样式/cell-meta（含绑定 sidecar） */
  sheet: SheetSnapshot
}

/** 绑定 → 画布占位符文本（配置态显示；数据只在打印预览/打印时渲染） */
export function formatBindingPlaceholder(binding: FormCellBinding): string {
  const prefix = binding.aggregate ? `${binding.aggregate}:` : ''
  return `{{${prefix}${binding.path}}}`
}

/** 模板总行数 = 最大 endRow + 1（无区域时返回 0） */
export function templateRows(regions: readonly FormRegion[]): number {
  let max = -1
  for (const region of regions) max = Math.max(max, region.endRow)
  return max + 1
}

/** 模板总列数 = max(声明列数, 最大 endCol + 1) */
export function templateCols(regions: readonly FormRegion[], declaredCols: number): number {
  let max = declaredCols
  for (const region of regions) max = Math.max(max, region.endCol + 1)
  return max
}

/** 两矩形是否重叠（闭区间） */
function regionsOverlap(a: FormRegion, b: FormRegion): boolean {
  return (
    a.startRow <= b.endRow &&
    a.endRow >= b.startRow &&
    a.startCol <= b.endCol &&
    a.endCol >= b.startCol
  )
}

/**
 * 规范化/校验区域序列：不越界、不重叠、start ≤ end。
 * 不要求行覆盖连续（空白行即静态内容），也不要求存在区域。
 * @param rows 允许的最大行数（模板总行数）；cols 允许的最大列数
 */
export function normalizeRegions(
  regions: readonly FormRegion[],
  rows: number,
  cols: number,
): FormRegion[] {
  const normalized = regions.map((region) => ({ ...region }))
  for (const [index, region] of normalized.entries()) {
    const label = `区域 ${index + 1}`
    if (region.startRow > region.endRow) {
      throw new Error(`${label}行范围非法：起始 ${region.startRow} > 结束 ${region.endRow}`)
    }
    if (region.startCol > region.endCol) {
      throw new Error(`${label}列范围非法：起始 ${region.startCol} > 结束 ${region.endCol}`)
    }
    if (region.startRow < 0 || region.startCol < 0) {
      throw new Error(`${label}范围越界：不能为负数`)
    }
    if (region.endRow >= rows || region.endCol >= cols) {
      throw new Error(`${label}范围越界：表格只有 ${rows} 行 ${cols} 列`)
    }
    if (region.expand !== 'none' && region.expand !== 'down' && region.expand !== 'right') {
      throw new Error(`${label}展开方式非法：${String(region.expand)}`)
    }
  }
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (regionsOverlap(normalized[i]!, normalized[j]!)) {
        throw new Error(`区域 ${i + 1} 与区域 ${j + 1} 重叠：一个格子不能属于两个区域`)
      }
    }
  }
  return normalized
}

/** v1 模板形状（仅为迁移入口保留的最小结构描述） */
interface TemplateV1 {
  schemaVersion?: number
  name?: string
  bands?: {
    kind?: string
    startRow?: number
    endRow?: number
  }[]
  cols?: number
  sheet?: unknown
}

/**
 * v1 → v2 迁移：五类 band → 无类型矩形区域。
 * - `detail` → `expand: 'down'`，其余 → `expand: 'none'`
 * - 首个 `pageHeader` → 额外 `repeat: true`
 * - 列范围恒为全宽（v1 的 band 是整行语义）
 * - name / cols / sheet 原样透传
 */
export function migrateTemplateV1(v1: TemplateV1): FormTemplate {
  const cols = typeof v1.cols === 'number' && v1.cols > 0 ? v1.cols : 1
  const bands = (v1.bands ?? []).filter(
    (band) => typeof band.startRow === 'number' && typeof band.endRow === 'number',
  )
  let pageHeaderMigrated = false
  const regions: FormRegion[] = bands.map((band) => {
    const region: FormRegion = {
      startRow: band.startRow!,
      endRow: band.endRow!,
      startCol: 0,
      endCol: cols - 1,
      expand: band.kind === 'detail' ? 'down' : 'none',
    }
    if (band.kind === 'pageHeader' && !pageHeaderMigrated) {
      region.repeat = true
      pageHeaderMigrated = true
    }
    return region
  })
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: typeof v1.name === 'string' ? v1.name : '',
    regions,
    cols,
    sheet: v1.sheet as SheetSnapshot,
  }
}
