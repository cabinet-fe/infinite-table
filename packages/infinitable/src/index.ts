// 统一发布入口：单包 re-export 四层公共 API（仓内仍按 workspace 分包开发，仅发布时合并）。
// star 导出的重名会被整体丢弃并报 TS2308，冲突对必须在此显式消歧（当前唯一：CellRef）。
export * from '@infinitable/render'
export * from '@infinitable/core'
export * from '@infinitable/formulas'
export * from '@infinitable/plugins'
// core 的格坐标 CellRef 与 formulas 的 A1 引用 CellRef 同名：A1 引用保留原名（配
// parseCellRef/formatCellRef/createRangeRef），格坐标以 GridCellRef 别名导出。
export type { CellRef } from '@infinitable/formulas'
export type { CellRef as GridCellRef } from '@infinitable/core'
