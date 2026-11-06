import type { SheetSnapshot } from '@infinitable/sheet'

/**
 * 打印单模板 JSON schema（区域自带数据源）。
 *
 * 模板 = 区域序列 + 画布内容快照。区域只是**画布上的一个矩形 + 一个展开属性**，没有
 * 类型语义；区域自己声明**展开驱动源**（数据集 × 重塑表达式 × 循环列表路径），
 * 份数不靠扫描区域内绑定的路径反推——区域与单元格绑定彻底解耦。
 *
 * 关键口径：
 * - 区域**不需要连续覆盖画布**，也不要求存在区域：不属于任何区域的行/列就是普通静态内容。
 * - 区域之间**不得重叠**（`normalizeRegions` 校验）。
 * - 展开属性：`down` 按份数向下复制、`right` 向右平铺；同一模板内各最多一个。
 * - `expand !== 'none'` 的区域**必须**声明 `source`（且 `source.datasetId` 非空）。
 * - 不展开的区域可以带 `source`：这是编辑期过渡态（先选数据集、再设展开），
 *   模板落盘前由 `stripOrphanSources` 清掉，模板里不留无效配置。
 * - `repeat` 只对「前导区域」有意义（从第 0 行起连续、`expand === 'none'`）：
 *   打印内核只支持重复源表前 N 行，非前导区域的 repeat 渲染时忽略。
 * - 画布**没有声明尺寸**：行列数由内容包围盒推导（见 content-bounds.ts），模板不存 cols。
 *
 * 格内容/样式/合并/行高列宽/绑定 sidecar 全部由 SheetSnapshot 承载——不自造第二套
 * 样式模型。纸张/边距/缩放/分页等打印配置不进模板（只在打印弹框）。
 */

/** 模板 schema 版本（唯一形态：区域自带数据源） */
export const TEMPLATE_SCHEMA_VERSION = 3

/** 区域展开方式：不展开 / 向下展开 / 向右展开 */
export type RegionExpand = 'none' | 'down' | 'right'

/** 展开方式选项（UI select 直接消费；hint 写清行为，面板在 select 下方灰字展示） */
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

/** 展开方式的展示名（不展开返回空串）；侧栏标签、绑定面板、悬停 pill 共用 */
export function regionExpandLabel(expand: RegionExpand): string {
  return expand === 'none'
    ? ''
    : (REGION_EXPAND_OPTIONS.find((option) => option.value === expand)?.label ?? '')
}

/**
 * 区域展示名：`区域 N · 向下展开` / `区域 N`（未展开不加后缀）。
 * 侧栏列表、绑定面板、选区 chip、画布悬停 pill 共用同一份文案，四处口径不会走偏。
 */
export function regionLabel(region: FormRegion, index: number): string {
  const expand = regionExpandLabel(region.expand)
  return expand ? `区域 ${index + 1} · ${expand}` : `区域 ${index + 1}`
}

/**
 * 区域展开驱动：数据集 × 重塑表达式 × 循环列表路径。
 *
 * 与单元格绑定完全独立——区域内可以一个绑定都没有（区域照样按份复制），
 * 反过来区域内绑定的字段名也不会影响份数。
 */
export interface RegionSource {
  /** 目标数据集 id（必填非空） */
  datasetId: string
  /**
   * 数据集重塑表达式：以 `rows` 为唯一入参的 JS 表达式，求值结果即该数据集的
   * 取数形态；缺省 = 原始行数组直接作形态。预览与打印共用唯一重塑管线求值。
   */
  expression?: string
  /** 相对数据集形态的循环数组路径：`items` / `[0].items` / `''`（形态根即数组） */
  path: string
}

/**
 * 区域：画布上的矩形 + 展开属性（闭区间，行列均为 0 基）。
 */
export interface FormRegion {
  startRow: number
  endRow: number
  startCol: number
  endCol: number
  expand: RegionExpand
  /** 区域名（缺省按序号显示「区域 N」；空字符串视为未命名） */
  name?: string
  /** 每页重复：仅打印时生效，且仅对「前导区域」有意义（打印内核只支持重复源表前 N 行） */
  repeat?: boolean
  /** 展开驱动源：`expand !== 'none'` 时必填；`expand === 'none'` 时只可能是编辑期过渡态 */
  source?: RegionSource
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

/** 两矩形是否重叠（闭区间；区域创建/改范围时的重叠判定与规范化共用） */
export function regionsOverlap(a: FormRegion, b: FormRegion): boolean {
  return (
    a.startRow <= b.endRow &&
    a.endRow >= b.startRow &&
    a.startCol <= b.endCol &&
    a.endCol >= b.startCol
  )
}

/**
 * 格级字段绑定的 cell-meta sidecar 载荷形状。
 * 存储在 `FORM_BINDING_META_NAMESPACE` 命名空间下，随 SheetSnapshot.meta 序列化。
 *
 * **同一形状，两档语义**（读取时按所在区域判定，不存冗余 scope 字段）：
 * - 落在 `expand !== 'none'` 区域内：**相对绑定**，`path` 是条目内相对字段
 *   （`item_name`、`customer.name`，`''` 表示条目本身就是该格的值），
 *   `datasetId` / `expression` 不写（继承区域 `source`），`aggregate` 忽略——
 *   展开区已按份复制，聚合无落点。
 * - 其余（含不属于任何区域）：**绝对绑定**，`datasetId` 必填，`path` 是绝对路径
 *   `[0].no` / `items[].price` + 可选聚合。
 */
export interface FormCellBinding {
  /**
   * 目标数据集 id。相对绑定不带该字段（形状就是 `{ path }`），读取时按
   * 「所在区域 expand !== 'none'」判定继承区域 source。
   */
  datasetId?: string
  /**
   * 数据集重塑表达式：以 `rows` 为唯一入参的 JS 表达式，求值结果即该数据集的
   * 取数形态；缺省 = 原始行数组直接作形态。预览与打印共用唯一重塑管线求值。
   */
  expression?: string
  /**
   * 取数路径：点分段字符串，段为数组时可用下标（items[0]）或空段
   * （items[].price，展开区内逐份取值）。展开区内的绑定取条目内相对路径。
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
  /** 区域序列（界面称「区域」；顺序即侧栏顺序，与画布位置无关；可为空数组） */
  regions: FormRegion[]
  /** 画布内容快照：值/样式池/合并/行高列宽/行列默认样式/cell-meta（含绑定 sidecar） */
  sheet: SheetSnapshot
}

/** 绑定 → 画布占位符文本（配置态显示；数据只在打印预览/打印时渲染） */
export function formatBindingPlaceholder(binding: FormCellBinding): string {
  const prefix = binding.aggregate ? `${binding.aggregate}:` : ''
  return `{{${prefix}${binding.path}}}`
}

/**
 * 规范化/校验区域序列：不越界、不重叠、start ≤ end、展开方式合法、数据源完整。
 * 不要求行覆盖连续（空白行即静态内容），也不要求存在区域。
 * 画布无限大，因此不接收行/列上界。
 *
 * **总是保留数据源**（只校验完整性）：`expand !== 'none'` 必须有 source；
 * 带 source 时 `datasetId` 必须非空。不展开区域上的 source 是编辑期过渡态，
 * 清理由序列化/加载边界的 `stripOrphanSources` 单独负责——本函数没有开关，
 * 编辑期与持久化期的数据源口径因此只有一条。
 */
export function normalizeRegions(regions: readonly FormRegion[]): FormRegion[] {
  const normalized = regions.map((region, index) => {
    const label = `区域 ${index + 1}`
    if (region.startRow > region.endRow) {
      throw new Error(`${label}行范围非法：起始 ${region.startRow} > 结束 ${region.endRow}`)
    }
    if (region.startCol > region.endCol) {
      throw new Error(`${label}列范围非法：起始 ${region.startCol} > 结束 ${region.endCol}`)
    }
    if (region.startRow < 0 || region.startCol < 0) {
      throw new Error(`${label}范围非法：不能为负数`)
    }
    if (region.expand !== 'none' && region.expand !== 'down' && region.expand !== 'right') {
      throw new Error(`${label}展开方式非法：${String(region.expand)}`)
    }
    if (region.expand !== 'none' && !region.source) {
      throw new Error(`${label}缺少数据源：展开区域必须声明取数数据集与列表路径`)
    }
    if (region.source && region.source.datasetId.trim() === '') {
      throw new Error(`${label}数据源不完整：数据集不能为空`)
    }
    const name = region.name?.trim()
    const next: FormRegion = {
      startRow: region.startRow,
      endRow: region.endRow,
      startCol: region.startCol,
      endCol: region.endCol,
      expand: region.expand,
      ...(name ? { name } : {}),
      ...(region.repeat ? { repeat: true } : {}),
    }
    if (region.source) {
      const expression = region.source.expression?.trim()
      next.source = {
        datasetId: region.source.datasetId.trim(),
        ...(expression ? { expression } : {}),
        path: region.source.path,
      }
    }
    return next
  })
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      if (regionsOverlap(normalized[i]!, normalized[j]!)) {
        throw new Error(`区域 ${i + 1} 与区域 ${j + 1} 重叠：一个格子不能属于两个区域`)
      }
    }
  }
  return normalized
}

/**
 * 序列化/加载边界：清掉不展开区域上的数据源。
 *
 * 编辑期允许「先选数据集、再设展开」，那一步的 source 挂在 `expand === 'none'` 的区域上；
 * 模板里不留无效配置，因此落盘前与读回后各清一次，其余场合一律保留（见 normalizeRegions）。
 */
export function stripOrphanSources(regions: readonly FormRegion[]): FormRegion[] {
  return regions.map((region) => {
    if (region.expand !== 'none' || !region.source) return region
    const { source: _source, ...rest } = region
    return rest
  })
}
