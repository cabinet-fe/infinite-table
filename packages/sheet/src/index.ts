// 聚合导出为公开 API 白名单（迁移自 sheet-core 主入口，随阶段迁入增补）：
// 仅测试引用的内部符号（如 rangeContainsRange、formatByNumFmt、TypedEventEmitter）
// 不在此导出，测试一律深导入 src 子路径。

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
  createImageId,
  cloneImageAnchor,
  cloneSheetImage,
  type SheetImageType,
  type SheetImageAnchor,
  type SheetImage,
  type ImageInput,
} from './core/image'
