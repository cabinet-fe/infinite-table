// 命令系统聚合出口（显式具名导出，供包公共入口转出）。

export {
  ClearCellMetaCommand,
  SetCellMetaCommand,
  type ClearCellMetaParams,
  type SetCellMetaParams,
} from './cell-meta'
export { defaultCommandRegistry } from './default-registry'
export { HistoryManager, type HistoryState } from './history'
export {
  InsertImageCommand,
  RemoveImageCommand,
  UpdateImageCommand,
  type ImageUpdateFields,
  type InsertImageParams,
  type RemoveImageParams,
  type UpdateImageParams,
} from './image'
export { InsertCellsCommand, type InsertCellsParams } from './insert-delete-cells'
export {
  MergeCellsBatchCommand,
  MergeCellsCommand,
  UnmergeCellsCommand,
  type MergeCellsBatchParams,
  type MergeCellsParams,
  type UnmergeCellsParams,
} from './merge-cells'
export { CommandRegistry } from './registry'
export { RestoreSheetCommand } from './restore-sheet'
export {
  SetAxisStyleCommand,
  type SetAxisStyleItem,
  type SetAxisStyleParams,
} from './set-axis-style'
export { SetCellFormulaCommand, type SetCellFormulaParams } from './set-cell-formula'
export {
  SetCellStyleCommand,
  type SetCellStyleItem,
  type SetCellStyleParams,
} from './set-cell-style'
export {
  SetCellValueCommand,
  type SetCellValueItem,
  type SetCellValueParams,
} from './set-cell-value'
export type {
  AxisStylePatch,
  CellMetaPatch,
  CellPatch,
  Command,
  CommandContext,
  CommandResult,
  ImagePatch,
  MergePatch,
  Mutation,
  Patch,
  PatchDirection,
  SnapshotPatch,
  StructureChange,
  StructurePatch,
} from './types'
