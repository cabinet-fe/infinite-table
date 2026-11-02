import type { SheetSnapshot } from '@infinitable/sheet'

/**
 * 打印单模板 JSON schema（P3 定型，供 P5 持久化 round-trip 与 P6 绑定编辑消费）。
 *
 * 模板 = 波段序列 + 画布内容快照：波段以连续行区划分画布（首波段 startRow = 0，
 * 相邻波段首尾相接，行区合计即画布行数），格内容/样式/合并/行高列宽/绑定 sidecar
 * 全部由 SheetSnapshot 承载——不自造第二套样式模型。
 * 纸张/边距/缩放/分页等打印配置不进模板（只在打印弹框，P8 落地，P5 以键集断言守住）。
 */

/** 模板 schema 版本（结构不兼容演进时递增，加载侧按版本迁移） */
export const TEMPLATE_SCHEMA_VERSION = 1

/** 波段类型：页眉/信息/明细/合计/签字（明细波段绑数组路径循环展开，P6 接线） */
export type BandKind = 'pageHeader' | 'info' | 'detail' | 'summary' | 'signature'

export const BAND_KINDS: readonly BandKind[] = [
  'pageHeader',
  'info',
  'detail',
  'summary',
  'signature',
]

/** 波段类型中文标签（面板与测试断言共用） */
export const BAND_KIND_LABELS: Record<BandKind, string> = {
  pageHeader: '页眉',
  info: '信息',
  detail: '明细',
  summary: '合计',
  signature: '签字',
}

/** 各类型波段的默认行数（新增波段时的缺省高度） */
export const DEFAULT_BAND_ROWS: Record<BandKind, number> = {
  pageHeader: 2,
  info: 2,
  detail: 3,
  summary: 1,
  signature: 2,
}

/** 波段：画布上的连续行区（闭区间；行数 = endRow - startRow + 1） */
export interface FormBand {
  kind: BandKind
  startRow: number
  endRow: number
}

/**
 * 格级字段绑定的 cell-meta sidecar 载荷形状（P3 定型；绑定值由 P6 写入）。
 * 存储在 `FORM_BINDING_META_NAMESPACE` 命名空间下，随 SheetSnapshot.meta 序列化。
 */
export interface FormCellBinding {
  /** 目标数据集 id（P2 数据集域） */
  datasetId: string
  /**
   * 数据集重塑后形态内的取数路径：点分段字符串，段为数组时可用下标（items[0]）
   * 或空段（items[].price，明细波段内逐行取值）；求值在 P6 数据态管线。
   */
  path: string
  /** 聚合方式（合计格常用；缺省 = 直取值，明细波段格忽略聚合） */
  aggregate?: 'sum' | 'avg' | 'count' | 'max' | 'min'
}

/** 绑定 sidecar 的 cell-meta namespace（区别于 sheet 内建的 cell-image/cell-link） */
export const FORM_BINDING_META_NAMESPACE = 'form-binding'

/** 波段式打印单模板（后端 REST 持久化的 JSON 形态） */
export interface FormTemplate {
  schemaVersion: typeof TEMPLATE_SCHEMA_VERSION
  name: string
  /** 波段序列（自上而下） */
  bands: FormBand[]
  /** 画布列数（行数由波段行区合计得出） */
  cols: number
  /** 画布内容快照：值/样式池/合并/行高列宽/行列默认样式/cell-meta（含绑定 sidecar） */
  sheet: SheetSnapshot
}

/** 绑定 → 画布占位符文本（配置态显示；数据只在打印预览/打印时渲染） */
export function formatBindingPlaceholder(binding: FormCellBinding): string {
  const prefix = binding.aggregate ? `${binding.aggregate}:` : ''
  return `{{${prefix}${binding.path}}}`
}

/** 波段序列覆盖的总行数（行区合计） */
export function templateRows(bands: readonly FormBand[]): number {
  return bands.length === 0 ? 0 : bands[bands.length - 1]!.endRow + 1
}

/** 行号所在波段（行区闭区间判定；越界返回 undefined） */
export function bandAtRow(bands: readonly FormBand[], row: number): FormBand | undefined {
  return bands.find((band) => row >= band.startRow && row <= band.endRow)
}
