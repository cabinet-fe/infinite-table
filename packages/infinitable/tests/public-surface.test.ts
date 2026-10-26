// 导出面冻结测试：主入口与 ./sheet、./pivot 子路径的导出符号集合以显式快照冻结，
// 增删导出必须显式改快照才通过——防止内部实现再经星号转售泄漏成事实 API。
// 值导出走运行时命名空间断言；类型导出经运行时不可见，用源码解析断言
// （与值导出同一 export 块语法，另以「解析值导出 == 运行时 keys」交叉校验，
// 保证解析器与真实导出面一致）。判据与逐项清单见 agent-docs/apis/exports.md。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as mainEntry from '../src/index'
import * as pivotEntry from '../src/pivot'
import * as sheetEntry from '../src/sheet'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

interface NamedExports {
  values: string[]
  types: string[]
}

/** 解析显式具名导出面：export { ... } / export type { ... } 块内逐项（`as` 取对外名） */
function parseNamedExports(source: string): NamedExports {
  // 去整行注释（判据注释不参与解析）
  const cleaned = source.replace(/^[ \t]*\/\/[^\n]*/gm, '')
  const values: string[] = []
  const types: string[] = []
  const block = /export\s+(type\s+)?\{([^}]*)\}(?:\s*from\s+['"][^'"]+['"])?/gs
  for (const match of cleaned.matchAll(block)) {
    const isTypeBlock = Boolean(match[1])
    const body = match[2]
    if (body === undefined) continue
    for (let item of body.split(',')) {
      item = item.replace(/\/\/[^\n]*/g, '').trim()
      if (!item) continue
      const isTypeItem = isTypeBlock || item.startsWith('type ')
      const spec = item.replace(/^type\s+/, '').trim()
      const asMatch = /(\S+)\s+as\s+(\S+)$/.exec(spec)
      const name = asMatch?.[2] ?? spec
      ;(isTypeItem ? types : values).push(name)
    }
  }
  return { values: values.sort(), types: types.sort() }
}

// ---- 显式快照：主入口（render + grid + table + formulas + plugins 五层显式转售 + CellRef 消歧）----

const MAIN_ENTRY_VALUES = [
  'DependencyGraph',
  'EditorRegistry',
  'FORMULA_FUNCTION_CATEGORIES',
  'FormulaParseError',
  'ListTable',
  'SceneNode',
  'SheetModel',
  'astHasVolatileCall',
  'collectAstReferences',
  'colLetters',
  'createChartPlugin',
  'createEnginePrintSource',
  'createPrintPlugin',
  'createRangeRef',
  'createRenderHost',
  'createWatermarkPlugin',
  'evaluate',
  'extendsTheme',
  'formulaError',
  'formatCellRef',
  'formatRangeRef',
  'getFormulaFunction',
  'getFormulaFunctionInfo',
  'isFormulaError',
  'isFormulaErrorCode',
  'listFormulaFunctions',
  'MergeCellMap',
  'MergeOverlapError',
  'normalizeCellRange',
  'normalizeRange',
  'parseCellRef',
  'parseFormula',
  'projectCellStyle',
  'registerFormulaFunction',
  'sanitizeMerges',
  'scanFormulaReferences',
  'shiftFormulaRefs',
  'shiftFormulaText',
  'tokenText',
  'warnMergeConflicts',
]

const MAIN_ENTRY_TYPES = [
  // render 层
  'FrameTask',
  'Invalidation',
  'LayerHandle',
  'LayerKind',
  'LayerOpts',
  'Region',
  'RenderCanvas',
  'RenderContext',
  'RenderHost',
  'RenderHostOptions',
  'RenderImageSource',
  'SceneEvent',
  'SceneEventListener',
  'SceneNodeInit',
  'SceneEventType',
  'Size',
  // grid + table 层（原 core 公共面拆分：网格内核与表格主体词汇按定义包直引；清单字母序混排）
  'CanvasDocSource',
  'CellBorder',
  'CellBorderEdge',
  'CellChangeEvent',
  'CellChartMedia',
  'CellLink',
  'CellLinkClickEvent',
  'CellLinkHoverEvent',
  'CellLinkLeaveEvent',
  'CellRange',
  'CellRenderer',
  'CellStyle',
  'ColumnDefine',
  'DataRecord',
  // 引擎装配协议（P7）：中立本体 / 可选导出读取面 / 表格引擎协议面
  'EngineAssembly',
  'EngineReadView',
  'FillDragEndEvent',
  'FloatContextMenuEvent',
  'FloatObject',
  'FloatTransformEndEvent',
  'FloatTransformHandle',
  'GridCellRef',
  'HighlightRange',
  'ImageLinkClickEvent',
  'ImageLinkClickListener',
  'ListTableOptions',
  'LoadedImage',
  'MergeConflict',
  'OverlayPainter',
  'RangeBounds',
  'RangeRef',
  'ResolveCellImageLink',
  'ResolveCellLink',
  'ResolveDisplayValue',
  'SanitizedMerges',
  'ScannedReference',
  'ScrollbarMode',
  'ScrollbarOptions',
  'SelectionSnapshot',
  'TableContextMenuEvent',
  'TableEngine',
  'TableModel',
  'TablePlugin',
  'TableTheme',
  'ThemeOverride',
  'UnderlayPainter',
  // formulas 层
  'AstNode',
  'CellRef',
  'EvalValue',
  'FormulaError',
  'FormulaEvalContext',
  'FormulaFunction',
  'FormulaFunctionCategory',
  'FormulaFunctionInfo',
  'FormulaFunctionOverrides',
  'FormulaRefCoord',
  'FormulaResolver',
  'FormulaShiftResult',
  'ScalarValue',
  'SheetCellCoord',
  // plugins 层
  'ChartCellDeclaration',
  'ChartDatasetDeclaration',
  'ChartDatasetSpec',
  'ChartPluginHandle',
  'ChartPluginOptions',
  'ChartSpec',
  'ChartSpecType',
  'ChartType',
  'PrintConfig',
  'PrintHeaderFooterConfig',
  'PrintHeaderFooterSection',
  'PrintMargin',
  'PrintOrientation',
  'PrintPagingMode',
  'PrintPaperPreset',
  'PrintPaperSpec',
  'PrintPluginHandle',
  'PrintPluginOptions',
  'PrintScaleMode',
  'PrintSource',
  'WatermarkHandle',
  'WatermarkTextConfig',
]

// ---- 显式快照：./sheet 子路径（@infinitable/sheet 白名单全量）----

const SHEET_ENTRY_VALUES = [
  'ALIGN_STYLE_KEYS',
  'BORDER_EDGE_DEFAULTS',
  'BORDER_SIDES',
  'BORDER_STYLE_WIDTH',
  'CELL_IMAGE_META_NAMESPACE',
  'CELL_LINK_META_NAMESPACE',
  'CELL_READONLY_META_NAMESPACE',
  'CellMetaStore',
  'CellStore',
  'ClearCellMetaCommand',
  'ClearCellLinkCommand',
  'CommandRegistry',
  'FONT_STYLE_KEYS',
  'FormulaEngine',
  'HistoryManager',
  'IMAGE_MIME',
  'InsertCellImageCommand',
  'InsertCellsCommand',
  'InsertImageCommand',
  'MergeCellsBatchCommand',
  'MergeCellsCommand',
  'MergeManager',
  'NUMERIC_TEXT_RE',
  'RemoveCellImageCommand',
  'RemoveImageCommand',
  'SelectionModel',
  'SetAxisStyleCommand',
  'SetCellFormulaCommand',
  'SetCellLinkCommand',
  'SetCellMetaCommand',
  'SetCellStyleCommand',
  'SetCellValueCommand',
  'Sheet',
  'SheetGrid',
  'StylePool',
  'TypedEventEmitter',
  'UnmergeCellsCommand',
  'UpdateImageCommand',
  'Workbook',
  'boundingBox',
  'buildBorderPresetItems',
  'cellDataEqual',
  'cellKey',
  'cellMetaKey',
  'cellMetaKeyFrom',
  'cellMetaPayloadEqual',
  'cloneCellMetaPayload',
  'cloneImageAnchor',
  'cloneSheetImage',
  'colIndexToName',
  'colNameToIndex',
  'composeCellStyles',
  'computeFillTargetRange',
  'createImageId',
  'createRange',
  'defaultCommandRegistry',
  'exportSheetCsv',
  'exportSheetXlsx',
  'exportWorkbookXlsx',
  'findAll',
  'findNext',
  'findNextFrom',
  'findPrev',
  'findPrevFrom',
  'formatAddress',
  'formatRange',
  'generateFill',
  'importCsv',
  'importXlsx',
  'inferCellType',
  'isEmptyCellData',
  'iterateRange',
  'normalizeInputValue',
  'parseAddress',
  'parseRange',
  'rangeContainsAddress',
  'rangesEqual',
  'rangesIntersect',
  'replaceWorkbookWithSnapshots',
]

const SHEET_ENTRY_TYPES = [
  'AddSheetCellInput',
  'AddSheetOptions',
  'AxisStylePatch',
  'BorderEdge',
  'BorderLineStyle',
  'BorderPreset',
  'BorderPresetItem',
  'BorderSide',
  'CellAddress',
  'CellAlign',
  'CellData',
  'CellFont',
  'CellImagePayload',
  'CellInfo',
  'CellLinkPayload',
  'CellMetaPatch',
  'CellMetaSnapshotItem',
  'CellPatch',
  'CellRange',
  'CellRenderTarget',
  'CellRenderer',
  'CellSnapshotItem',
  'CellStyle',
  'CellStylePatch',
  'CellType',
  'CellValue',
  'ClearCellLinkParams',
  'ClearCellMetaParams',
  'Command',
  'CommandContext',
  'CommandResult',
  'FillDirection',
  'FindMatch',
  'FindOptions',
  'FormulaEngineOptions',
  'FrozenState',
  'GenerateFillOptions',
  'GridCellEditor',
  'GridEditorRect',
  'GridEditorSession',
  'HistoryState',
  'HorizontalAlign',
  'ImageInput',
  'ImageFitMode',
  'ImagePatch',
  'ImageUpdateFields',
  'InsertCellImageParams',
  'InsertCellsParams',
  'InsertImageParams',
  'MergeCellsBatchParams',
  'MergeCellsParams',
  'MergePatch',
  'MergeResult',
  'MergedCellKind',
  'Mutation',
  'NumFmt',
  'Patch',
  'PatchDirection',
  'RemoveCellImageParams',
  'RemoveImageParams',
  'ResolveCellRenderer',
  'ResolveCellStyleHook',
  'ResolveDisplayValue',
  'ScrollbarOptions',
  'SelectionInterceptMeta',
  'SelectionState',
  'SetAxisStyleItem',
  'SetAxisStyleParams',
  'SetCellFormulaParams',
  'SetCellLinkParams',
  'SetCellMetaParams',
  'SetCellStyleItem',
  'SetCellStyleParams',
  'SetCellValueItem',
  'SetCellValueParams',
  'SheetEvents',
  'SheetGridContextMenuInfo',
  'SheetGridContextMenuKind',
  'SheetGridEditorsOptions',
  'SheetGridHeaderOptions',
  'SheetGridHighlight',
  'SheetGridOptions',
  'SheetImage',
  'SheetImageAnchor',
  'SheetImageType',
  'SheetReplaceItem',
  'SheetSnapshot',
  'SnapshotPatch',
  'StructureChange',
  'StructurePatch',
  'StyleId',
  'UnmergeCellsParams',
  'UpdateImageParams',
  'VerticalAlign',
  'WorkbookEvents',
  'WorkbookOptions',
]

describe('infinitable 主入口导出面冻结', () => {
  it('源码不含 export *（星号转售禁令）', () => {
    expect(readFileSync(join(srcDir, 'index.ts'), 'utf8')).not.toContain('export *')
  })

  it('值导出集合与显式快照一致', () => {
    expect(Object.keys(mainEntry).sort()).toEqual([...MAIN_ENTRY_VALUES].sort())
  })

  it('类型导出集合与显式快照一致', () => {
    const { values, types } = parseNamedExports(readFileSync(join(srcDir, 'index.ts'), 'utf8'))
    expect(types).toEqual([...MAIN_ENTRY_TYPES].sort())
    // 交叉校验：源码解析出的值导出 == 运行时命名空间实际导出（解析器不脱靶）
    expect(values).toEqual(Object.keys(mainEntry).sort())
  })
})

describe('infinitable ./sheet 子路径导出面冻结', () => {
  it('源码不含 export *（星号转售禁令）', () => {
    expect(readFileSync(join(srcDir, 'sheet.ts'), 'utf8')).not.toContain('export *')
  })

  it('值导出集合与显式快照一致', () => {
    expect(Object.keys(sheetEntry).sort()).toEqual([...SHEET_ENTRY_VALUES].sort())
  })

  it('类型导出集合与显式快照一致', () => {
    const { values, types } = parseNamedExports(readFileSync(join(srcDir, 'sheet.ts'), 'utf8'))
    expect(types).toEqual([...SHEET_ENTRY_TYPES].sort())
    expect(values).toEqual(Object.keys(sheetEntry).sort())
  })
})

// ---- 显式快照：./pivot 子路径（@infinitable/pivot 白名单全量）----

const PIVOT_ENTRY_VALUES = [
  'PIVOT_GRAND_BACKGROUND',
  'PIVOT_HEADER_BACKGROUND',
  'PIVOT_ROW_HEIGHT',
  'PIVOT_SUBTOTAL_BACKGROUND',
  'PivotGrid',
  'PivotModel',
]

const PIVOT_ENTRY_TYPES = [
  'PivotAggregator',
  'PivotCellDrillEvent',
  'PivotColumn',
  'PivotDimension',
  'PivotGridOptions',
  'PivotMeasure',
  'PivotRecord',
  'PivotRow',
]

describe('infinitable ./pivot 子路径导出面冻结', () => {
  it('源码不含 export *（星号转售禁令）', () => {
    expect(readFileSync(join(srcDir, 'pivot.ts'), 'utf8')).not.toContain('export *')
  })

  it('值导出集合与显式快照一致', () => {
    expect(Object.keys(pivotEntry).sort()).toEqual([...PIVOT_ENTRY_VALUES].sort())
  })

  it('类型导出集合与显式快照一致', () => {
    const { values, types } = parseNamedExports(readFileSync(join(srcDir, 'pivot.ts'), 'utf8'))
    expect(types).toEqual([...PIVOT_ENTRY_TYPES].sort())
    expect(values).toEqual(Object.keys(pivotEntry).sort())
  })
})
