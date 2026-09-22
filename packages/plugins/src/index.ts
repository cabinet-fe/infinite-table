// 插件包公共入口：官方插件（首批为 sheet 插件，见 docs/plugin-interface-map.md）。
// 只做具名导出：插件契约类型自 core 转出，后续插件能力经此入口对外提供（禁止 export *）。
export type { TablePlugin } from '@infinite-table/core'

// ---- sheet 插件（参考实现；ultra-ui 替换时由其无头模型层顶替） ----
export { SheetStore } from './sheet/sheet-store'
export type {
  SheetCellMetaEntry,
  SheetDisplayResolver,
  SheetFrozen,
  SheetStoreChangeEvent,
  SheetStoreChangeType,
  SheetStoreChangeListener,
  SheetStoreMetaChangeEvent,
  SheetStoreMetaChangeListener,
  SheetStoreOptions,
} from './sheet/sheet-store'
export { createFormulaDisplay } from './sheet/formula-display'
export type { FormulaDisplayFn, FormulaEvaluator } from './sheet/formula-display'
export { excelKeymapPreset } from './sheet/keymap'
export { bindFillGeneration, generateFill, resolveAutoFillTarget } from './sheet/fill'
export type { FillCell, FillGenerationOptions, FillRead } from './sheet/fill'
export { bindSelectionSync } from './sheet/selection-sync'
export type { SelectionSyncController, SelectionSyncOptions } from './sheet/selection-sync'
export { SheetBook } from './sheet/sheet-book'
export type {
  HostFactory,
  SheetBookChangeEvent,
  SheetBookOptions,
  SheetDef,
} from './sheet/sheet-book'
export { UndoStack, bindCellChangeUndo } from './sheet/undo'
export type { CellChangeUndoBinding, CellChangeUndoOptions, UndoCommand } from './sheet/undo'
export { borderPresetLine, buildBorderPresetCells } from './sheet/border-presets'
export type { BorderLineStyle, BorderPreset, BorderPresetCell } from './sheet/border-presets'
