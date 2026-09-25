// 单元格图表声明解析：类型 + 数据 → 规范化 ChartSpec。
// 显式容错：任何非法声明返回 { ok:false, reason }，不抛裸异常（图表格降级为普通格）。

import type {
  ChartCellDeclaration,
  ChartDatasetDeclaration,
  ChartDatasetSpec,
  ChartParseResult,
  ChartSpecType,
  ChartType,
} from './types'

/** 基线四类（面积图经归一进入 spec，不在 chart.js 类型面出现） */
const CHART_TYPES: readonly ChartType[] = ['bar', 'line', 'area', 'pie']

/** 解析单元格图表声明；declaration 来自宿主数据，值面未知 */
export function parseChartDeclaration(declaration: unknown): ChartParseResult {
  const decl = asDeclaration(declaration)
  if (!decl) {
    return { ok: false, reason: `图表声明必须是对象，收到 ${typeName(declaration)}` }
  }
  const type = parseType(decl.type)
  if (!type) {
    return { ok: false, reason: `图表类型非法：${typeName(decl.type)}（支持 bar/line/area/pie）` }
  }
  const datasets = parseDatasets(decl.datasets, type)
  if (typeof datasets === 'string') {
    return { ok: false, reason: datasets }
  }
  const labels = parseLabels(decl.labels)
  if (typeof labels === 'string') {
    return { ok: false, reason: labels }
  }
  return { ok: true, spec: { type: specType(type), labels, datasets } }
}

/** 声明收窄：对象（非数组/null）才可能是图表声明 */
function asDeclaration(declaration: unknown): ChartCellDeclaration | null {
  if (typeof declaration !== 'object' || declaration === null || Array.isArray(declaration)) {
    return null
  }
  return declaration as ChartCellDeclaration
}

function parseType(type: unknown): ChartType | null {
  if (typeof type !== 'string') {
    return null
  }
  return CHART_TYPES.includes(type as ChartType) ? (type as ChartType) : null
}

/** area → line（chart.js 无独立面积类型，靠 dataset.fill 表达） */
function specType(type: ChartType): ChartSpecType {
  return type === 'area' ? 'line' : type
}

/**
 * 解析数据集集合：
 * - 必须是非空数组，每项为 { label?, data } 对象；
 * - data 必须是数组，元素为有限数值或 null（缺口），字符串数字不隐式转换；
 * - 饼图只保留第一个数据集（chart.js 饼图仅渲染首个），面积图数据集置 fill。
 */
function parseDatasets(datasets: unknown, type: ChartType): ChartDatasetSpec[] | string {
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return `datasets 必须是非空数组，收到 ${typeName(datasets)}`
  }
  const specs: ChartDatasetSpec[] = []
  for (const entry of datasets) {
    const decl = asDataset(entry)
    if (!decl) {
      return `数据集必须是对象，收到 ${typeName(entry)}`
    }
    if (!Array.isArray(decl.data)) {
      return `数据集 data 必须是数组，收到 ${typeName(decl.data)}`
    }
    const data: (number | null)[] = []
    for (const point of decl.data) {
      if (point === null) {
        data.push(null)
      } else if (typeof point === 'number' && Number.isFinite(point)) {
        data.push(point)
      } else {
        return `数据点必须是有限数值或 null，收到 ${typeName(point)}`
      }
    }
    specs.push({ label: parseLabel(decl.label), data, fill: type === 'area' })
  }
  return type === 'pie' ? specs.slice(0, 1) : specs
}

function asDataset(entry: unknown): ChartDatasetDeclaration | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null
  }
  return entry as ChartDatasetDeclaration
}

/** 数据集名称：字符串/数值转文本，其余（缺省/null）落空串 */
function parseLabel(label: unknown): string {
  if (typeof label === 'string') {
    return label
  }
  if (typeof label === 'number' && Number.isFinite(label)) {
    return String(label)
  }
  return ''
}

/**
 * 解析类目轴标签：缺省/null/空数组 → null（按数据序号）；
 * 数组内字符串/数值转文本，null 落空串占位；非数组判非法。
 */
function parseLabels(labels: unknown): string[] | null | string {
  if (labels == null) {
    return null
  }
  if (!Array.isArray(labels)) {
    return `labels 必须是数组，收到 ${typeName(labels)}`
  }
  const names = labels.map((label) => (label == null ? '' : String(label)))
  return names.length === 0 ? null : names
}

function typeName(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return '数组'
  }
  return typeof value
}
