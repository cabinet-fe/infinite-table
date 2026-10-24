// 透视表引擎包：PivotGrid——平级领域引擎经引擎装配协议接入的参考实现。
// 行方向为多列树形布局（每个行维度一列，同组跨行合并，折叠组收敛为自带聚合的
// 单行载体）× 列方向为多级表头（列维度逐层 + 度量行，以引擎冻结行 + 合并区落地）
// × 度量聚合为包内领域状态机（PivotModel 展平），table 引擎只承担渲染与交互原语；
// 行/列维度与度量可运行时勾选与改聚合，结构原地落地不重建实例。
// 对外实现 EngineAssembly 转发面，水印/打印等协议插件跨引擎挂载生效。
// 公共 API 显式导出（禁止 export *），导出判据：下游装配消费（playground 演示 /
// 未来 infinitable 聚合）与冒烟像素/几何断言锚点常量。

export {
  PIVOT_GRAND_BACKGROUND,
  PIVOT_HEADER_BACKGROUND,
  PIVOT_ROW_HEIGHT,
  PIVOT_SUBTOTAL_BACKGROUND,
  PivotGrid,
  type PivotCellDrillEvent,
} from './pivot-grid'
export { PivotModel } from './pivot-model'
export type { PivotColumn, PivotRow } from './pivot-model'
export type {
  PivotAggregator,
  PivotDimension,
  PivotGridOptions,
  PivotMeasure,
  PivotRecord,
} from './types'
