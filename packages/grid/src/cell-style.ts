// 逐格样式词汇表：样式形态类型（边框/对齐/边距/最终形态），单源于 @infinitable/protocol。
// 纯类型零行为：主题投影（theme.ts）与共享边裁决（shared-edges.ts）以此词汇为公共语言；
// 样式投影管线（projectCellStyle 等）在消费侧（table/sheet）。

export type {
  CellBorder,
  CellBorderEdge,
  CellBorderStyle,
  CellPadding,
  CellStyle,
  CellTextAlign,
  CellTextOverflow,
  CellVerticalAlign,
} from '@infinitable/protocol'
