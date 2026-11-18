// 工作台纯领域助手：双态权限判定、URL 参数同步、列显隐/调序、选区样式更新、默认视图生成与 CSV/XLSX 导出。

import { writeXlsx } from 'hucre/xlsx'
import type { SmartGridSelectionInfo } from '../canvas/smart-grid'
import type { CreateViewRequest, TableBundle } from '../shared/api-types'
import type {
  CellStyleConfig,
  DashboardConfig,
  KanbanConfig,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
  SmartViewType,
  SummaryType,
} from '../shared/schema'
import { scalarToText } from './utils'

/** 工作台双态：运维配置态（全能力） vs 用户查看态（只读浏览、临时筛选、导出） */
export type AppMode = 'operator' | 'viewer'

/** 从 URL query string 解析初始工作模式（?mode=viewer 直达只读查看态） */
export function resolveAppModeFromSearch(search: string): AppMode {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  return params.get('mode')?.toLowerCase() === 'viewer' ? 'viewer' : 'operator'
}

/** 构造切换双态后的 URL 路径（仅维护 mode query 参数，保留其它参数与 hash） */
export function buildModeSearchUrl(
  pathname: string,
  search: string,
  hash: string,
  mode: AppMode,
): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  if (mode === 'viewer') {
    params.set('mode', 'viewer')
  } else {
    params.delete('mode')
  }
  const qs = params.toString()
  return `${pathname}${qs ? `?${qs}` : ''}${hash}`
}

/** 汇总方式中文标签 */
export const SUMMARY_LABELS: Record<SummaryType, string> = {
  none: '无汇总',
  sum: '求和',
  avg: '平均值',
  max: '最大值',
  min: '最小值',
  count: '已填数',
  filled_rate: '填充率',
}

/** 按列类型计算可选底部汇总指标列表 */
export function getAvailableSummaryTypes(col: SmartColumn): SummaryType[] {
  const isNumeric =
    col.type === 'number' ||
    col.type === 'progress' ||
    col.type === 'formula' ||
    (col.type === 'lookup' &&
      (col.lookupConfig?.mode === 'rollup' || col.numberFormat !== undefined))

  return isNumeric
    ? ['none', 'sum', 'avg', 'max', 'min', 'count', 'filled_rate']
    : ['none', 'count', 'filled_rate']
}

/** 补全视图列顺序（保留合法既有顺序，未收录新列按表结构顺序追加） */
export function normalizeColumnOrder(
  columns: readonly SmartColumn[],
  columnOrder?: readonly string[],
): string[] {
  const validKeys = new Set(columns.map((c) => c.key))
  const result: string[] = []
  const seen = new Set<string>()

  if (columnOrder) {
    for (const key of columnOrder) {
      if (validKeys.has(key) && !seen.has(key)) {
        seen.add(key)
        result.push(key)
      }
    }
  }
  for (const col of columns) {
    if (!seen.has(col.key)) {
      seen.add(col.key)
      result.push(col.key)
    }
  }
  return result
}

/** 数组元素不可变调序 */
export function reorderStringList(
  list: readonly string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return [...list]
  }
  const next = [...list]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved!)
  return next
}

/** 切换单列显隐（至少保留 1 个可见列） */
export function toggleHiddenColumn(
  columns: readonly SmartColumn[],
  hiddenColumns: readonly string[] | undefined,
  targetKey: string,
): string[] | null {
  const hiddenSet = new Set(hiddenColumns ?? [])
  if (hiddenSet.has(targetKey)) {
    hiddenSet.delete(targetKey)
    return Array.from(hiddenSet)
  }
  const visibleCount = columns.filter((c) => !hiddenSet.has(c.key)).length
  if (visibleCount <= 1) {
    return null
  }
  hiddenSet.add(targetKey)
  return Array.from(hiddenSet)
}

/** 批量设置或清除当前画布选区的单元格样式（patch 为 null 时清除） */
export function applyCellStyleToSelection(
  prevCellStyles: Record<string, Record<string, CellStyleConfig>> | undefined,
  selection: SmartGridSelectionInfo,
  patch: CellStyleConfig | null,
): Record<string, Record<string, CellStyleConfig>> | undefined {
  if (selection.ranges.length === 0) {
    return prevCellStyles
  }

  const next: Record<string, Record<string, CellStyleConfig>> = {}
  if (prevCellStyles) {
    for (const [recId, rowMap] of Object.entries(prevCellStyles)) {
      next[recId] = { ...rowMap }
    }
  }

  for (const range of selection.ranges) {
    for (const recordId of range.recordIds) {
      for (const colKey of range.columnKeys) {
        if (patch === null) {
          if (next[recordId]) {
            delete next[recordId][colKey]
            if (Object.keys(next[recordId]).length === 0) {
              delete next[recordId]
            }
          }
        } else {
          const rowMap = next[recordId] ?? {}
          const merged: CellStyleConfig = {
            ...rowMap[colKey],
            ...patch,
          }
          if (merged.bgColor === undefined) delete merged.bgColor
          if (merged.textColor === undefined) delete merged.textColor
          if (merged.align === undefined) delete merged.align
          if (Object.keys(merged).length === 0) {
            delete rowMap[colKey]
            if (Object.keys(rowMap).length === 0) {
              delete next[recordId]
            } else {
              next[recordId] = rowMap
            }
          } else {
            rowMap[colKey] = merged
            next[recordId] = rowMap
          }
        }
      }
    }
  }

  return Object.keys(next).length > 0 ? next : undefined
}

/** 生成默认透视表配置 */
export function buildDefaultPivotConfig(columns: readonly SmartColumn[]): SmartPivotConfig {
  const rowDim =
    columns.find((c) => c.type === 'select') ??
    columns.find((c) => c.type === 'text' || c.type === 'lookup')
  const colDim = columns.find(
    (c) =>
      c.key !== rowDim?.key && (c.type === 'person' || c.type === 'select' || c.type === 'lookup'),
  )
  const numCol = columns.find(
    (c) => c.type === 'number' || c.type === 'formula' || c.type === 'progress',
  )
  return {
    rowDimensions: rowDim ? [rowDim.key] : [],
    columnDimensions: colDim ? [colDim.key] : [],
    measures: numCol
      ? [{ key: numCol.key, title: numCol.title, field: numCol.key, agg: 'sum', width: 120 }]
      : [{ key: '__count__', title: '记录数', field: '__count__', agg: 'count', width: 100 }],
    showGrandTotal: true,
    collapsible: true,
  }
}

/** 生成默认看板配置 */
export function buildDefaultKanbanConfig(columns: readonly SmartColumn[]): KanbanConfig {
  const groupCol =
    columns.find((c) => c.type === 'select') ??
    columns.find((c) => c.type === 'text' || c.type === 'lookup') ??
    columns[0]
  const titleCol =
    columns.find((c) => c.type === 'text' && !c.isUniqueKey && c.key !== groupCol?.key) ??
    columns.find((c) => c.key !== groupCol?.key) ??
    columns[0]
  const displayFields = columns
    .filter((c) => c.key !== groupCol?.key && c.key !== titleCol?.key)
    .slice(0, 4)
    .map((c) => c.key)
  return {
    groupByField: groupCol?.key ?? 'status',
    ...(titleCol ? { titleField: titleCol.key } : {}),
    displayFields,
    laneOrder: groupCol?.options?.map((o) => o.label),
  }
}

/** 生成默认仪表盘配置 */
export function buildDefaultDashboardConfig(columns: readonly SmartColumn[]): DashboardConfig {
  const numCols = columns.filter(
    (c) => c.type === 'number' || c.type === 'formula' || c.type === 'progress',
  )
  const dimCol =
    columns.find((c) => c.type === 'select') ??
    columns.find((c) => c.type === 'text' || c.type === 'lookup') ??
    columns[0]
  const firstCol = columns[0]
  const primaryNum = numCols[0]

  const kpis: DashboardConfig['kpis'] = []
  if (firstCol) {
    kpis.push({
      id: `kpi_${Date.now().toString(36)}_1`,
      title: '记录总数',
      field: firstCol.key,
      agg: 'count',
      accentColor: '#2563eb',
    })
  }
  if (primaryNum) {
    kpis.push({
      id: `kpi_${Date.now().toString(36)}_2`,
      title: `${primaryNum.title}合计`,
      field: primaryNum.key,
      agg: 'sum',
      numberFormat: primaryNum.numberFormat,
      accentColor: '#0f766e',
    })
  }

  const charts: DashboardConfig['charts'] = []
  if (dimCol) {
    charts.push({
      id: `chart_${Date.now().toString(36)}_1`,
      title: primaryNum ? `按${dimCol.title}统计${primaryNum.title}` : `按${dimCol.title}分布`,
      chartType: 'bar',
      dimensionField: dimCol.key,
      measureField: primaryNum?.key ?? '',
      agg: primaryNum ? 'sum' : 'count',
      sortBy: 'value_desc',
    })
  }

  return { kpis, charts }
}

/** 根据所属智能表格（或数据源表）与视图类型构造新建应用视图请求体 */
export function buildDefaultViewPayload(
  name: string,
  type: SmartViewType,
  bundle: TableBundle,
  appId?: string,
): CreateViewRequest {
  const columns = bundle.meta.columns
  const quickField = columns.find((c) => c.type === 'select')?.key
  const base: CreateViewRequest = {
    name: name.trim(),
    type,
    ...(appId ? { appId } : {}),
    tableId: bundle.meta.id,
    filterGroup: { conjunction: 'and', conditions: [] },
    quickFilterFields: quickField ? [quickField] : [],
    sortRules: [],
  }

  if (type === 'table') {
    return {
      ...base,
      rowHeight: 'standard',
      summaries: { ...bundle.meta.summaries },
    }
  }
  if (type === 'pivot') {
    return {
      ...base,
      pivotConfig: buildDefaultPivotConfig(columns),
    }
  }
  if (type === 'kanban') {
    return {
      ...base,
      kanbanConfig: buildDefaultKanbanConfig(columns),
    }
  }
  return {
    ...base,
    dashboardConfig: buildDefaultDashboardConfig(columns),
  }
}

function escapeCsvCell(text: string): string {
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** 导出当前可见列与记录为带 UTF-8 BOM 的 CSV 字符串 */
export function formatRecordsAsCsv(
  columns: readonly SmartColumn[],
  records: readonly SmartRecord[],
  formatCell?: (col: SmartColumn, value: unknown) => string,
): string {
  const header = columns.map((c) => escapeCsvCell(c.title)).join(',')
  const lines = records.map((record) =>
    columns
      .map((col) => {
        const raw = record[col.key]
        const text = formatCell ? formatCell(col, raw) : scalarToText(raw)
        return escapeCsvCell(text)
      })
      .join(','),
  )
  return `\uFEFF${[header, ...lines].join('\r\n')}`
}

/** 导出当前可见列与记录为 XLSX 字节（复用 hucre/xlsx） */
export async function buildRecordsXlsxBytes(
  sheetName: string,
  columns: readonly SmartColumn[],
  records: readonly SmartRecord[],
  formatCell?: (col: SmartColumn, value: unknown) => string,
): Promise<Uint8Array> {
  const safeName = sheetName.replace(/[\\/*?:[\]]/g, '_').slice(0, 31) || 'Sheet1'
  const header = columns.map((c) => c.title)
  const rows = records.map((record) =>
    columns.map((col) => {
      const raw = record[col.key]
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw
      }
      if (typeof raw === 'boolean') {
        return raw
      }
      return formatCell ? formatCell(col, raw) : scalarToText(raw)
    }),
  )
  return writeXlsx({
    sheets: [{ name: safeName, rows: [header, ...rows] }],
    activeSheet: 0,
  })
}

/** 浏览器端触发文件下载 */
export function triggerBrowserDownload(filename: string, data: BlobPart, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
