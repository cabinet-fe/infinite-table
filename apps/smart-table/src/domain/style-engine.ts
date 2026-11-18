// 视图样式层级合并与条件格式求值引擎：
// 样式优先级：条件格式（conditionalFormats）> 单元格/选区自定义（cellStyles）> 列级样式（columnStyles）

import {
  ROW_HEIGHT_VALUES,
  type CellStyleConfig,
  type CellTextAlign,
  type ColumnStyleConfig,
  type ConditionalFormatRule,
  type RowHeightPreset,
  type SmartColumn,
  type SmartRecord,
  type SmartView,
} from '../shared/schema'
import { matchFilterCondition } from './query-engine'

/** 解析后的列头样式 */
export interface ResolvedHeaderStyle {
  bgColor?: string
  textColor?: string
  align?: CellTextAlign
}

/** 解析后的单元格样式（三层合并最终结果） */
export interface ResolvedCellStyle {
  bgColor?: string
  textColor?: string
  align?: CellTextAlign
  /** 当前格命中的条件格式规则 ID 列表 */
  matchedRuleIds: string[]
}

/** 视图级样式解析器（按行缓存条件格式匹配结果，避免网格渲染重复求值） */
export interface ViewStyleResolver {
  resolveHeader: (fieldKey: string) => ResolvedHeaderStyle
  resolveCell: (record: SmartRecord, fieldKey: string) => ResolvedCellStyle
}

export type ViewStyleSource = Pick<SmartView, 'columnStyles' | 'cellStyles' | 'conditionalFormats'>

export type ViewPresentationSource = Pick<
  SmartView,
  'columnOrder' | 'hiddenColumns' | 'columnWidths'
>

function nonEmptyColor(color: string | undefined): string | undefined {
  if (typeof color !== 'string') return undefined
  const trimmed = color.trim()
  return trimmed === '' ? undefined : trimmed
}

function buildColumnMap(columns: readonly SmartColumn[]): Map<string, SmartColumn> {
  const map = new Map<string, SmartColumn>()
  for (const col of columns) {
    map.set(col.key, col)
  }
  return map
}

/** 根据视图的行高档位解析像素行高 */
export function resolveRowHeightPx(preset?: RowHeightPreset): number {
  if (!preset) return ROW_HEIGHT_VALUES.standard
  return ROW_HEIGHT_VALUES[preset] ?? ROW_HEIGHT_VALUES.standard
}

/** 根据视图配置解析可见列顺序、显隐与列宽覆盖（未收录的新列按表序追加） */
export function resolveVisibleColumns(
  columns: readonly SmartColumn[],
  view?: ViewPresentationSource,
): SmartColumn[] {
  const hiddenSet = new Set(view?.hiddenColumns ?? [])
  const widthMap = view?.columnWidths
  const byKey = buildColumnMap(columns)
  const ordered: SmartColumn[] = []
  const seen = new Set<string>()

  if (view?.columnOrder) {
    for (const key of view.columnOrder) {
      if (seen.has(key)) continue
      const col = byKey.get(key)
      if (!col) continue
      seen.add(key)
      ordered.push(col)
    }
  }

  for (const col of columns) {
    if (!seen.has(col.key)) {
      seen.add(col.key)
      ordered.push(col)
    }
  }

  const visible: SmartColumn[] = []
  for (const col of ordered) {
    if (hiddenSet.has(col.key)) continue
    const overrideWidth = widthMap?.[col.key]
    if (typeof overrideWidth === 'number' && Number.isFinite(overrideWidth) && overrideWidth > 0) {
      visible.push({ ...col, width: overrideWidth })
    } else {
      visible.push(col)
    }
  }
  return visible
}

/** 解析列头样式 */
export function resolveHeaderStyle(
  fieldKey: string,
  columnStyles?: Record<string, ColumnStyleConfig>,
): ResolvedHeaderStyle {
  const colStyle = columnStyles?.[fieldKey]
  if (!colStyle) return {}
  return {
    bgColor: nonEmptyColor(colStyle.headerBgColor),
    textColor: nonEmptyColor(colStyle.headerTextColor),
    align: colStyle.align,
  }
}

function matchRowConditionalRules(
  record: SmartRecord,
  rules: readonly ConditionalFormatRule[] | undefined,
  colMap: ReadonlyMap<string, SmartColumn>,
): ConditionalFormatRule[] {
  if (!rules || rules.length === 0) return []
  const matched: ConditionalFormatRule[] = []
  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (matchFilterCondition(record, rule, colMap)) {
      matched.push(rule)
    }
  }
  return matched
}

function mergeLayers(
  fieldKey: string,
  colStyle: ColumnStyleConfig | undefined,
  cellStyle: CellStyleConfig | undefined,
  matchedRowRules: readonly ConditionalFormatRule[],
): ResolvedCellStyle {
  let bgColor = nonEmptyColor(colStyle?.bgColor)
  let textColor = nonEmptyColor(colStyle?.textColor)
  let align: CellTextAlign | undefined = colStyle?.align

  if (cellStyle) {
    const customBg = nonEmptyColor(cellStyle.bgColor)
    const customText = nonEmptyColor(cellStyle.textColor)
    if (customBg !== undefined) bgColor = customBg
    if (customText !== undefined) textColor = customText
    if (cellStyle.align !== undefined) align = cellStyle.align
  }

  // 条件格式优先级最高；按规则顺序求值，命中多条时后者覆盖前者（支持 row 整行与 cell 单格作用域）
  const matchedRuleIds: string[] = []
  for (const rule of matchedRowRules) {
    if (rule.scope !== 'row' && rule.field !== fieldKey) continue
    matchedRuleIds.push(rule.id)
    const ruleBg = nonEmptyColor(rule.bgColor)
    const ruleText = nonEmptyColor(rule.textColor)
    if (ruleBg !== undefined) bgColor = ruleBg
    if (ruleText !== undefined) textColor = ruleText
  }

  return {
    bgColor,
    textColor,
    align,
    matchedRuleIds,
  }
}

/**
 * 解析单格最终样式（优先级：条件格式 > 单元格自定义 > 列级样式）。
 * 适合单次求值或测试；高频渲染场景建议使用 `createViewStyleResolver`。
 */
export function resolveCellStyle(
  record: SmartRecord,
  fieldKey: string,
  columns: readonly SmartColumn[],
  view?: ViewStyleSource,
): ResolvedCellStyle {
  const colMap = buildColumnMap(columns)
  const matchedRowRules = matchRowConditionalRules(record, view?.conditionalFormats, colMap)
  const colStyle = view?.columnStyles?.[fieldKey]
  const cellStyle = view?.cellStyles?.[record._id]?.[fieldKey]
  return mergeLayers(fieldKey, colStyle, cellStyle, matchedRowRules)
}

/** 创建带行级条件格式缓存的视图样式解析器 */
export function createViewStyleResolver(
  columns: readonly SmartColumn[],
  view?: ViewStyleSource,
): ViewStyleResolver {
  const colMap = buildColumnMap(columns)
  const rowMatchesCache = new WeakMap<SmartRecord, ConditionalFormatRule[]>()
  const columnStyles = view?.columnStyles
  const cellStyles = view?.cellStyles
  const rules = view?.conditionalFormats

  return {
    resolveHeader(fieldKey: string): ResolvedHeaderStyle {
      return resolveHeaderStyle(fieldKey, columnStyles)
    },
    resolveCell(record: SmartRecord, fieldKey: string): ResolvedCellStyle {
      let matched = rowMatchesCache.get(record)
      if (!matched) {
        matched = matchRowConditionalRules(record, rules, colMap)
        rowMatchesCache.set(record, matched)
      }
      const colStyle = columnStyles?.[fieldKey]
      const cellStyle = cellStyles?.[record._id]?.[fieldKey]
      return mergeLayers(fieldKey, colStyle, cellStyle, matched)
    },
  }
}
