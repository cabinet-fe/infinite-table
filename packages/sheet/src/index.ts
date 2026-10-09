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
