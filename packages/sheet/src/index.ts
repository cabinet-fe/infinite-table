// 聚合导出为公开 API 白名单（迁移自 sheet-core 主入口，P9 定稿）：
// 仅测试引用的内部符号（如 rangeContainsRange、formatByNumFmt、mergeCellStyle、
// TypedEventEmitter）不在此导出，测试一律深导入 src 子路径。
// 公式引擎 API 不从本包转售——sheet 模型消费 @infinitable/formulas（FormulaEngine
// 为组合门面），下游直接 import '@infinitable/formulas'。
// grid 适配层（SheetGrid）随本包主入口一并具名导出（spec 口径：完整 sheet API 单入口）。

export {
  cellKey,
  colIndexToName,
  colNameToIndex,
  parseAddress,
  formatAddress,
  createRange,
  parseRange,
  formatRange,
  rangesEqual,
  rangesIntersect,
  rangeContainsAddress,
  boundingBox,
  iterateRange,
  type CellAddress,
  type CellRange,
} from './core/address'

export {
  NUMERIC_TEXT_RE,
  normalizeInputValue,
  inferCellType,
  isEmptyCellData,
  cellDataEqual,
  CellStore,
  type CellType,
  type CellValue,
  type CellData,
  type CellSnapshotItem,
} from './core/cell-store'

export {
  cellMetaKey,
  cellMetaKeyFrom,
  cloneCellMetaPayload,
  cellMetaPayloadEqual,
  type CellMetaSnapshotItem,
} from './core/cell-meta'

export { CellMetaStore } from './core/cell-meta-store'

export { CELL_READONLY_META_NAMESPACE } from './core/cell-readonly'

export {
  BORDER_SIDES,
  BORDER_STYLE_WIDTH,
  BORDER_EDGE_DEFAULTS,
  FONT_STYLE_KEYS,
  ALIGN_STYLE_KEYS,
  type BorderLineStyle,
  type BorderSide,
  type BorderEdge,
  type HorizontalAlign,
  type VerticalAlign,
  type CellFont,
  type CellAlign,
  type CellStyle,
  type StyleId,
  type CellStylePatch,
} from './core/style/types'

export { StylePool } from './core/style/style-pool'

export { composeCellStyles } from './core/style/compose'

export {
  buildBorderPresetItems,
  type BorderPreset,
  type BorderPresetItem,
} from './core/style/border-presets'

export {
  MergeManager,
  type MergedCellKind,
  type CellInfo,
  type MergeResult,
} from './core/merge-manager'

export { SelectionModel, type SelectionState } from './core/selection'

export {
  computeFillTargetRange,
  generateFill,
  type FillDirection,
  type GenerateFillOptions,
} from './core/fill'

export {
  findAll,
  findNext,
  findNextFrom,
  findPrev,
  findPrevFrom,
  type FindOptions,
  type FindMatch,
} from './core/find'

export { Sheet, type FrozenState, type SheetSnapshot, type SheetEvents } from './core/sheet'

export {
  Workbook,
  type WorkbookEvents,
  type AddSheetOptions,
  type AddSheetCellInput,
} from './core/workbook'

/** 公式引擎门面（组合 @infinitable/formulas；图簿联动/重算编排） */
export { FormulaEngine } from './core/formula-engine'

export {
  HistoryManager,
  type HistoryState,
  type PatchDirection,
  type CellPatch,
  type MergePatch,
  type StructureChange,
  type StructurePatch,
  type SnapshotPatch,
  type ImagePatch,
  type CellMetaPatch,
  type AxisStylePatch,
  type Patch,
  type Mutation,
  type CommandResult,
  type CommandContext,
  type Command,
  type SetCellValueItem,
  type SetCellValueParams,
  SetCellValueCommand,
  type SetCellFormulaParams,
  SetCellFormulaCommand,
  type SetCellStyleItem,
  type SetCellStyleParams,
  SetCellStyleCommand,
  type SetAxisStyleItem,
  type SetAxisStyleParams,
  SetAxisStyleCommand,
  type InsertCellsParams,
  InsertCellsCommand,
  type MergeCellsParams,
  MergeCellsCommand,
  type UnmergeCellsParams,
  UnmergeCellsCommand,
  type MergeCellsBatchParams,
  MergeCellsBatchCommand,
  type InsertImageParams,
  InsertImageCommand,
  type RemoveImageParams,
  RemoveImageCommand,
  type ImageUpdateFields,
  type UpdateImageParams,
  UpdateImageCommand,
  type SetCellMetaParams,
  SetCellMetaCommand,
  type ClearCellMetaParams,
  ClearCellMetaCommand,
  defaultCommandRegistry,
  CommandRegistry,
} from './core/command'

export {
  createImageId,
  cloneImageAnchor,
  cloneSheetImage,
  type SheetImageType,
  type SheetImageAnchor,
  type SheetImage,
  type ImageInput,
} from './core/image'

export { exportWorkbookXlsx, exportSheetXlsx, exportSheetCsv } from './core/io/export'

export { importXlsx, importCsv } from './core/io/import'

// ---- grid 适配层（SheetGrid 装配：与 src/grid/index.ts 同一公共面） ----

export type { CellRenderer, CellRenderTarget } from './grid/index'
export { SheetGrid, type ResolveCellRenderer, type SheetGridOptions } from './grid/sheet-grid'
export type { ResolveCellStyleHook, ResolveDisplayValue } from './grid/grid-model'
export type { SheetGridContextMenuInfo, SheetGridContextMenuKind } from './grid/grid-coords'
export type { SheetGridHeaderOptions } from './grid/grid-header'
export type {
  GridCellEditor,
  GridEditorRect,
  GridEditorSession,
  SheetGridEditorsOptions,
} from './grid/grid-editors'
