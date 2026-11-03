import type { SheetSnapshot } from '@infinitable/sheet'

/**
 * 打印单模板 JSON schema（P3 定型，供 P5 持久化 round-trip 与 P6 绑定编辑消费）。
 *
 * 模板 = 区域序列 + 画布内容快照：区域以连续行区划分画布（首区域 startRow = 0，
 * 相邻区域首尾相接，行区合计即画布行数），格内容/样式/合并/行高列宽/绑定 sidecar
 * 全部由 SheetSnapshot 承载——不自造第二套样式模型。
 * 纸张/边距/缩放/分页等打印配置不进模板（只在打印弹框，P8 落地，P5 以键集断言守住）。
 */

/** 模板 schema 版本（结构不兼容演进时递增，加载侧按版本迁移） */
export const TEMPLATE_SCHEMA_VERSION = 1

/** 区域类型：页眉/信息/明细/合计/签字（明细区绑数组路径循环展开，P6 接线） */
export type BandKind = 'pageHeader' | 'info' | 'detail' | 'summary' | 'signature'

export const BAND_KINDS: readonly BandKind[] = [
  'pageHeader',
  'info',
  'detail',
  'summary',
  'signature',
]

/** 区域类型中文标签（面板与测试断言共用；band 是历史命名，界面上称「区域」） */
export const BAND_KIND_LABELS: Record<BandKind, string> = {
  pageHeader: '页眉区',
  info: '信息区',
  detail: '明细区',
  summary: '合计区',
  signature: '签字区',
}

/**
 * 每种区域的一句话说明（侧栏行内直接展示：用户靠这句话理解「这块区域在打印时会怎样」）。
 * 不塞进 title——看不见的说明等于没有说明。
 */
export const BAND_KIND_HINTS: Record<BandKind, string> = {
  pageHeader: '每页重复（标题、列头）',
  info: '只出现一次（单号、客户）',
  detail: '按数据条数循环展开',
  summary: '只出现一次（合计金额）',
  signature: '只出现一次（签字栏）',
}

/** 各类型区域的默认行数（新增区域时的缺省高度） */
export const DEFAULT_BAND_ROWS: Record<BandKind, number> = {
  pageHeader: 2,
  info: 2,
  detail: 3,
  summary: 1,
  signature: 2,
}

/** 区域：画布上的连续行区（闭区间；行数 = endRow - startRow + 1） */
export interface FormBand {
  kind: BandKind
  startRow: number
  endRow: number
}

/**
 * 格级字段绑定的 cell-meta sidecar 载荷形状（P3 定型；P6 起由绑定编辑写入）。
 * 存储在 `FORM_BINDING_META_NAMESPACE` 命名空间下，随 SheetSnapshot.meta 序列化。
 */
export interface FormCellBinding {
  /** 目标数据集 id（P2 数据集域） */
  datasetId: string
  /**
   * 数据集重塑表达式（P7 转换器定义）：以 `rows` 为唯一入参的 JS 表达式，
   * 求值结果即该数据集的取数形态；缺省 = 原始行数组直接作形态。预览与打印
   * 共用 reshapeRows 唯一管线求值。
   */
  expression?: string
  /**
   * 数据集重塑后形态内的取数路径：点分段字符串，段为数组时可用下标（items[0]）
   * 或空段（items[].price，明细区内逐行取值）；求值在数据态管线。
   */
  path: string
  /** 聚合方式（合计格常用；缺省 = 直取值，明细区格忽略聚合） */
  aggregate?: 'sum' | 'avg' | 'count' | 'max' | 'min'
}

/** 绑定 sidecar 的 cell-meta namespace（区别于 sheet 内建的 cell-image/cell-link） */
export const FORM_BINDING_META_NAMESPACE = 'form-binding'

/** 区域式打印单模板（后端 REST 持久化的 JSON 形态） */
export interface FormTemplate {
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION
  name: string
  // bands：界面上称「区域」（band 是历史命名，模板 JSON 字段不改）
  bands: FormBand[]
  /** 画布列数（行数由区域行区合计得出） */
  cols: number
  /** 画布内容快照：值/样式池/合并/行高列宽/行列默认样式/cell-meta（含绑定 sidecar） */
  sheet: SheetSnapshot
}

/** 绑定 → 画布占位符文本（配置态显示；数据只在打印预览/打印时渲染） */
export function formatBindingPlaceholder(binding: FormCellBinding): string {
  const prefix = binding.aggregate ? `${binding.aggregate}:` : ''
  return `{{${prefix}${binding.path}}}`
}

/** 区域序列覆盖的总行数（行区合计） */
export function templateRows(bands: readonly FormBand[]): number {
  return bands.length === 0 ? 0 : bands[bands.length - 1]!.endRow + 1
}

/** 行号所在区域（行区闭区间判定；越界返回 undefined） */
export function bandAtRow(bands: readonly FormBand[], row: number): FormBand | undefined {
  return bands.find((band) => row >= band.startRow && row <= band.endRow)
}
