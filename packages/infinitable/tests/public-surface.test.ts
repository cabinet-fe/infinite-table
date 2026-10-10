// 导出面冻结测试：主入口与 ./sheet 子路径的导出符号集合以显式快照冻结，
// 增删导出必须显式改快照才通过——防止内部实现再经星号转售泄漏成事实 API。
// 值导出走运行时命名空间断言；类型导出经运行时不可见，用源码解析断言
// （与值导出同一 export 块语法，另以「解析值导出 == 运行时 keys」交叉校验，
// 保证解析器与真实导出面一致）。判据与逐项清单见 agent-docs/apis/exports.md。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as mainEntry from '../src/index'
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
    for (let item of match[2].split(',')) {
      item = item.replace(/\/\/[^\n]*/g, '').trim()
      if (!item) continue
      const isTypeItem = isTypeBlock || item.startsWith('type ')
      const spec = item.replace(/^type\s+/, '').trim()
      const asMatch = /(\S+)\s+as\s+(\S+)$/.exec(spec)
      const name = asMatch ? asMatch[2] : spec
      ;(isTypeItem ? types : values).push(name)
    }
  }
  return { values: values.sort(), types: types.sort() }
}

// ---- 显式快照：主入口（render + core + formulas + plugins 四层显式转售 + CellRef 消歧）----

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
  'normalizeCellRange',
  'normalizeRange',
  'parseCellRef',
  'parseFormula',
  'projectCellStyle',
  'registerFormulaFunction',
  'scanFormulaReferences',
  'shiftFormulaRefs',
  'shiftFormulaText',
  'tokenText',
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
  // core 层
  'CellBorder',
  'CellBorderEdge',
  'CellChangeEvent',
  'CellChartMedia',
  'CellRange',
  'CellRenderer',
  'CellStyle',
  'ColumnDefine',
  'DataRecord',
  'FillDragEndEvent',
  'FloatObject',
  'FloatTransformEndEvent',
  'FloatTransformHandle',
  'GridCellRef',
  'HighlightRange',
  'ListTableOptions',
  'LoadedImage',
  'OverlayPainter',
  'RangeBounds',
  'ResolveDisplayValue',
  'ScrollbarMode',
  'ScrollbarOptions',
  'SelectionSnapshot',
  'TableContextMenuEvent',
  'TableModel',
  'TablePlugin',
  'TableTheme',
  'ThemeOverride',
  'UnderlayPainter',
  // formulas 层
  'AstNode',
  'CellRef',
  'FormulaError',
  'FormulaEvalContext',
  'FormulaFunction',
  'FormulaFunctionCategory',
  'FormulaFunctionInfo',
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
  'PrintImagePayload',
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
  'CELL_READONLY_META_NAMESPACE',
  'CellMetaStore',
  'CellStore',
  'ClearCellMetaCommand',
  'CommandRegistry',
  'FONT_STYLE_KEYS',
  'FormulaEngine',
  'HistoryManager',
  'InsertCellsCommand',
  'InsertImageCommand',
  'MergeCellsBatchCommand',
  'MergeCellsCommand',
  'MergeManager',
  'NUMERIC_TEXT_RE',
  'RemoveImageCommand',
  'SelectionModel',
  'SetAxisStyleCommand',
  'SetCellFormulaCommand',
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
  'CellInfo',
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
  'ClearCellMetaParams',
  'Command',
  'CommandContext',
  'CommandResult',
  'FillDirection',
  'FindMatch',
  'FindOptions',
  'FrozenState',
  'GenerateFillOptions',
  'GridCellEditor',
  'GridEditorRect',
  'GridEditorSession',
  'HistoryState',
  'HorizontalAlign',
  'ImageInput',
  'ImagePatch',
  'ImageUpdateFields',
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
  'RemoveImageParams',
  'ResolveCellRenderer',
  'ResolveCellStyleHook',
  'ResolveDisplayValue',
  'ScrollbarOptions',
  'SelectionState',
  'SetAxisStyleItem',
  'SetAxisStyleParams',
  'SetCellFormulaParams',
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
