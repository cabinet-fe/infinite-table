// 插件包公共入口：官方插件（首批为 sheet 插件，见 docs/plugin-interface-map.md）。
// 只做具名导出：插件契约类型自 core 转出，后续插件能力经此入口对外提供（禁止 export *）。
export type { TablePlugin } from '@infinitable/core'

// ---- sheet 插件（参考实现；ultra-ui 替换时由其无头模型层顶替） ----
export { SheetStore } from './sheet/sheet-store'
export type {
  SheetCellMetaEntry,
  SheetCellStyleEntry,
  SheetColumnStyleEntry,
  SheetDisplayResolver,
  SheetFrozen,
  SheetStoreChangeEvent,
  SheetStoreChangeType,
  SheetStoreChangeListener,
  SheetStoreMetaChangeEvent,
  SheetStoreMetaChangeListener,
  SheetStoreOptions,
} from './sheet/sheet-store'
export { restore, snapshot } from './sheet/snapshot'
export type {
  SheetRestoreWiring,
  SheetSnapshot,
  SheetSnapshotCell,
  SheetSnapshotCellStyle,
  SheetSnapshotColWidth,
  SheetSnapshotColumnStyle,
  SheetSnapshotExtras,
  SheetSnapshotMeta,
  SheetSnapshotRowHeight,
  SheetSnapshotStyles,
} from './sheet/snapshot'
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
export { decodeDataUrlImage, numFmtToXlsxCode, sheetToWriteSheet } from './sheet/xlsx-export'
export type { SheetExportSource, SheetImagePayload, SheetNumFmt } from './sheet/xlsx-export'

// ---- chart 插件（单元格图表：声明解析 + Chart.js 按需加载 + 离屏出图，落 L2 media 位图管线） ----
export { createChartPlugin, CHART_PLUGIN_NAME } from './chart/chart-plugin'
export type { ChartPluginHandle, ChartPluginOptions } from './chart/chart-plugin'
export { loadChartJs } from './chart/chart-loader'
export type { ChartJsModule } from './chart/chart-loader'
export { parseChartDeclaration } from './chart/parse'
export { chartContentKey, renderChartBitmap } from './chart/render'
export type { ChartRenderOptions } from './chart/render'
export type {
  ChartCellDeclaration,
  ChartDatasetDeclaration,
  ChartDatasetSpec,
  ChartParseResult,
  ChartSpec,
  ChartSpecType,
  ChartType,
} from './chart/types'

// ---- watermark 插件（文字平铺水印：core 顶层 overlay 预留位绘制，锚定视口不随滚动） ----
export { createWatermarkPlugin, WATERMARK_PLUGIN_NAME } from './watermark/watermark-plugin'
export type { WatermarkHandle } from './watermark/watermark-plugin'
// 打印水印与水印插件共享的配置模型（P1 落地，经本入口一并转出）
export type { WatermarkTextConfig } from './print/types'

// ---- print 插件（headless 打印内核：分页 → 页面 HTML → 占位符求值 → iframe 输出；P3 叠加 DOM 预览薄壳） ----
export { paginate } from './print/paginate'
export type { PrintPage, PrintRowRange } from './print/paginate'
export { buildPrintDocumentHtml, buildPrintPageHtml } from './print/page-html'
export { evaluatePlaceholders, renderHeaderFooter } from './print/header-footer'
export type { PlaceholderContext } from './print/header-footer'
export { printPages } from './print/print-output'
export type { PrintHooks } from './print/print-output'
export { openPrintPreview } from './print/preview'
export type { PrintPreviewHandle } from './print/preview'
export type {
  PrintConfig,
  PrintHeaderFooterConfig,
  PrintHeaderFooterSection,
  PrintImagePayload,
  PrintMargin,
  PrintOrientation,
  PrintPagingMode,
  PrintPaperPreset,
  PrintPaperSpec,
  PrintScaleMode,
  PrintSource,
} from './print/types'
export { WATERMARK_TEXT_DEFAULTS } from './print/types'
