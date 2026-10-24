// ./pivot 子路径入口：具名转出 @infinitable/pivot 全部公共 API（与
// packages/pivot/src/index.ts 白名单同步维护，禁止星号导出转售）。
// 导出判据与主入口一致（判据、逐项清单见 agent-docs/apis/exports.md）；
// 符号集合由 tests/public-surface.test.ts 快照冻结，增删导出必须显式改快照。
export {
  // 冒烟像素/几何断言锚点常量（多级表头/折叠载体/总计行底色与行高）
  PIVOT_GRAND_BACKGROUND,
  PIVOT_HEADER_BACKGROUND,
  PIVOT_ROW_HEIGHT,
  PIVOT_SUBTOTAL_BACKGROUND,
  PivotGrid,
  type PivotCellDrillEvent,
  PivotModel,
  type PivotColumn,
  type PivotRow,
  type PivotAggregator,
  type PivotDimension,
  type PivotGridOptions,
  type PivotMeasure,
  type PivotRecord,
} from '@infinitable/pivot'
