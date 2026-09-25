// 单元格图表声明类型面：格内声明（类型 + 数据）与规范化产物 ChartSpec。
// ChartSpec 为纯数据形态、与 chart.js 解耦；出图时由渲染通路映射为 ChartConfiguration
// （P1 骨架只负责解析与按需加载，出图在 P2 接入 L2 media）。

/** 基线图表类型：柱状 bar / 折线 line / 面积 area / 饼图 pie */
export type ChartType = 'bar' | 'line' | 'area' | 'pie'

/** 规范化后的 chart.js 图表类型（area 无独立类型，归一为 line + fill） */
export type ChartSpecType = 'bar' | 'line' | 'pie'

/**
 * 单元格图表声明：单元格内给出的原始形态（类型 + 数据）。
 * 声明通常来自宿主数据（JSON 等），字段值面未知，由解析器校验。
 */
export interface ChartCellDeclaration {
  /** 图表类型：bar / line / area / pie */
  type?: unknown
  /** 类目轴标签（可省略；省略时按数据序号） */
  labels?: unknown
  /** 数据集集合；饼图规范化时取第一个数据集 */
  datasets?: unknown
}

/** 单个数据集声明（声明体内层结构，值面同样未知） */
export interface ChartDatasetDeclaration {
  /** 数据集名称（图例用，可省略） */
  label?: unknown
  /** 数据点：有限数值或 null（折线/面积断点缺口）；其余判非法 */
  data?: unknown
}

/** 规范化数据集：直接可映射 chart.js dataset 的纯数据 */
export interface ChartDatasetSpec {
  label: string
  data: (number | null)[]
  /** 面积图填充标记（area 归一为 line 时置 true，其余 false） */
  fill: boolean
}

/** 规范化图表 spec：解析成功产物，出图通路直接消费 */
export interface ChartSpec {
  type: ChartSpecType
  /** 类目轴标签；声明缺省或空数组时为 null（chart.js 按数据序号） */
  labels: string[] | null
  datasets: ChartDatasetSpec[]
}

/** 解析结果：显式容错——非法声明返回 ok:false 与原因，不抛异常 */
export type ChartParseResult = { ok: true; spec: ChartSpec } | { ok: false; reason: string }
