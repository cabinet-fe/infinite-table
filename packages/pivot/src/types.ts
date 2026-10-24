// 透视表领域类型：维度（行/列挂载的分组字段）、度量（交叉格聚合字段）、记录与装配选项。
// 维度池与度量池是勾选候选全集；运行时勾选（行维度序列 / 列维度序列 / 度量序列）决定
// 聚合矩阵形态——勾选变化 → 结构重算 → 引擎几何原地落地（不重建实例）。

import type { DataRecord, ThemeOverride } from '@infinitable/table'

/** 聚合器：count 记录数（忽略 field）；sum/avg/min/max 按 field 数值聚合 */
export type PivotAggregator = 'sum' | 'count' | 'avg' | 'min' | 'max'

/** 维度（行/列方向挂载的分组字段；行维度序列的顺序即树层级序，列维度序列同构多级表头） */
export interface PivotDimension {
  key: string
  title: string
  /** 行头列宽（多列树形布局下每行维度一列） */
  width: number
}

/** 度量（交叉格聚合字段；同记录字段可挂多个不同聚合的度量） */
export interface PivotMeasure {
  /** 度量唯一 key（勾选引用；与记录字段名无关） */
  key: string
  title: string
  /** 记录字段（agg 为 count 时忽略） */
  field: string
  agg: PivotAggregator
  /** 度量列宽 */
  width: number
}

/** 记录：字段 key → 值（与引擎 DataRecord 同形） */
export type PivotRecord = DataRecord

export interface PivotGridOptions {
  /** 挂载容器（四层画布与编辑浮层落点） */
  container: HTMLElement
  /** 视口宽（缺省取容器当前宽度） */
  width?: number
  /** 视口高（缺省取容器当前高度） */
  height?: number
  /** 渲染设备像素比（像素断言等确定性场景锁 1） */
  dpr?: number
  /** 维度池（行/列维度勾选候选全集） */
  dimensions: readonly PivotDimension[]
  /** 度量池（度量勾选候选全集） */
  measures: readonly PivotMeasure[]
  records: readonly PivotRecord[]
  /** 初始行维度 key 序列（层级序；缺省全部维度） */
  rowDimensions?: readonly string[]
  /** 初始列维度 key 序列（层级序即多级表头层级；空数组度量直排；缺省空） */
  columnDimensions?: readonly string[]
  /** 初始度量 key 序列（调用方顺序；缺省全部度量） */
  activeMeasures?: readonly string[]
  /** 总计行（缺省 true） */
  showGrandTotal?: boolean
  /**
   * 行维度树可折叠（缺省 true）：false 时不绘展开钮、点击不折叠、始终平铺展开
   * （结构勾选变化仍生效），折叠态整体禁用。
   */
  collapsible?: boolean
  theme?: ThemeOverride
}
