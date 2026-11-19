// 工作台纯领域助手：基于登录角色与资源能力快照的菜单/操作权限解析、列显隐/调序、
// 选区样式更新、默认视图生成与 CSV/XLSX 导出。

import { writeXlsx } from 'hucre/xlsx'
import type { SmartGridSelectionInfo } from '../canvas/smart-grid'
import type { CreateViewRequest, TableBundle } from '../shared/api-types'
import type {
  AuthUser,
  CellStyleConfig,
  DashboardConfig,
  KanbanConfig,
  ResourceCapabilities,
  ShareStatus,
  ShareTargetType,
  SmartApp,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
  SmartTableMeta,
  SmartViewType,
  SortRule,
  SummaryType,
  UserCapabilities,
  UserRole,
  WorkspaceView,
} from '../shared/schema'
import {
  canConfigureApp,
  canConfigureTable,
  canConfigureView,
  canWriteTableRecords,
  computeAppCapabilities,
  computeTableCapabilities,
  computeUserCapabilities,
  computeViewCapabilities,
} from './permissions'
import { buildAbsoluteRouteUrl, type NavSection } from './router'
import { scalarToText } from './utils'

/** 角色中文名称映射 */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: '管理员',
  manager: '负责人',
  member: '普通成员',
}

export interface NavMenuDefinition {
  id: NavSection
  label: string
  description: string
}

export const NAV_MENU_DEFINITIONS: readonly NavMenuDefinition[] = [
  { id: 'apps', label: '工作台', description: '多维数据台多维视图与分析' },
  { id: 'entries', label: '数据录入', description: '普通表数据采集与快速填报' },
  { id: 'datasources', label: '数据源', description: '数据源表结构与底层主数据维护' },
  { id: 'shares', label: '分享管理', description: '管理对外分享链接与访问状态' },
  { id: 'permissions', label: '权限管理', description: '配置应用可见范围与表行级策略' },
]

/** 根据当前登录用户及能力快照解析左侧导航轨可见一级入口 */
export function getVisibleNavSections(
  user: AuthUser | null | undefined,
  userCapabilities?: UserCapabilities | null,
): NavSection[] {
  if (!user) return []
  const caps = userCapabilities ?? computeUserCapabilities(user)
  const sections: NavSection[] = ['apps', 'entries']
  if (caps.canAccessDataSources) sections.push('datasources')
  if (caps.canManageShares) sections.push('shares')
  if (caps.canManagePermissions) sections.push('permissions')
  return sections
}

/** 判断用户是否有权进入指定一级导航板块 */
export function canAccessNavSection(
  section: NavSection,
  user: AuthUser | null | undefined,
  userCapabilities?: UserCapabilities | null,
): boolean {
  return getVisibleNavSections(user, userCapabilities).includes(section)
}

/** 当前工作区激活目标的操作能力快照 */
export interface WorkspaceActionCapabilities extends ResourceCapabilities {
  canAccessDataSources: boolean
}

export const EMPTY_WORKSPACE_CAPABILITIES: WorkspaceActionCapabilities = {
  canView: false,
  canEditRecords: false,
  canConfigure: false,
  canManagePermissions: false,
  canCreateShare: false,
  canManageDataSource: false,
  canAccessDataSources: false,
}

/** 计算当前激活应用视图或数据源表的操作能力（优先读取服务端能力快照，缺失时回退领域纯函数） */
export function resolveWorkspaceActionCapabilities(params: {
  user: AuthUser | null | undefined
  userCapabilities?: UserCapabilities | null
  targetKind: 'app' | 'datasource'
  app?: SmartApp | null
  view?: WorkspaceView | null
  table?: SmartTableMeta | null
  allApps?: readonly SmartApp[]
  allViews?: readonly WorkspaceView[]
}): WorkspaceActionCapabilities {
  const { user, userCapabilities, targetKind, app, view, table, allApps, allViews } = params
  if (!user) {
    return EMPTY_WORKSPACE_CAPABILITIES
  }
  const userCaps = userCapabilities ?? computeUserCapabilities(user)

  if (targetKind === 'datasource') {
    if (!table || !userCaps.canAccessDataSources) {
      return {
        ...EMPTY_WORKSPACE_CAPABILITIES,
        canAccessDataSources: userCaps.canAccessDataSources,
      }
    }
    const tableCaps =
      table.capabilities ?? computeTableCapabilities(user, table, allApps ?? [], allViews ?? [])
    return {
      ...tableCaps,
      canAccessDataSources: userCaps.canAccessDataSources,
    }
  }

  if (!app) {
    return {
      ...EMPTY_WORKSPACE_CAPABILITIES,
      canAccessDataSources: userCaps.canAccessDataSources,
    }
  }

  const resCaps = view
    ? (view.capabilities ?? computeViewCapabilities(user, view, app))
    : (app.capabilities ?? computeAppCapabilities(user, app))

  return {
    ...resCaps,
    canManageDataSource: resCaps.canManageDataSource && userCaps.canAccessDataSources,
    canAccessDataSources: userCaps.canAccessDataSources,
  }
}

/** 判断用户是否可配置指定多维数据台应用 */
export function canConfigureAppItem(user: AuthUser | null | undefined, app: SmartApp): boolean {
  if (!user) return false
  return app.capabilities?.canConfigure ?? canConfigureApp(user, app)
}

/** 判断用户是否可配置指定应用视图 */
export function canConfigureViewItem(
  user: AuthUser | null | undefined,
  view: WorkspaceView,
  parentApp?: SmartApp | null,
): boolean {
  if (!user) return false
  return view.capabilities?.canConfigure ?? canConfigureView(user, view, parentApp)
}

/** 判断用户是否可配置/重命名/删除指定数据源表 */
export function canConfigureTableItem(
  user: AuthUser | null | undefined,
  table: SmartTableMeta,
  appsForTable?: readonly SmartApp[],
): boolean {
  if (!user) return false
  return table.capabilities?.canConfigure ?? canConfigureTable(user, table, appsForTable ?? [])
}

/** 判断用户是否可在独立数据录入端编辑指定普通数据表记录 */
export function canEditEntryTableItem(
  user: AuthUser | null | undefined,
  table: SmartTableMeta,
  allApps?: readonly SmartApp[],
  allViews?: readonly WorkspaceView[],
): boolean {
  if (!user) return false
  return (
    table.capabilities?.canEditRecords ??
    canWriteTableRecords(user, table, allApps ?? [], allViews ?? [])
  )
}

/** 判断用户是否可为指定多维数据台应用创建对外分享链接 */
export function canCreateAppShareItem(
  user: AuthUser | null | undefined,
  app: SmartApp | null | undefined,
): boolean {
  if (!user || !app || user.role === 'member') return false
  return app.capabilities?.canCreateShare ?? canConfigureApp(user, app)
}

/** 判断用户是否可为指定应用视图创建对外分享链接 */
export function canCreateViewShareItem(
  user: AuthUser | null | undefined,
  view: WorkspaceView | null | undefined,
  parentApp?: SmartApp | null,
): boolean {
  if (!user || !view || user.role === 'member') return false
  return view.capabilities?.canCreateShare ?? canConfigureView(user, view, parentApp)
}

/** 判断用户是否可为指定普通数据录入表创建对外分享链接 */
export function canCreateEntryShareItem(
  user: AuthUser | null | undefined,
  table: SmartTableMeta | null | undefined,
  allApps?: readonly SmartApp[],
): boolean {
  if (!user || !table || user.role === 'member' || table.kind !== 'normal') return false
  const appsForTable = (allApps ?? []).filter((app) => app.tableId === table.id)
  return table.capabilities?.canCreateShare ?? canConfigureTable(user, table, appsForTable)
}

/** 分享目标类型中文标签 */
export const SHARE_TARGET_LABELS: Record<ShareTargetType, string> = {
  app: '多维数据台应用',
  view: '应用视图',
  entry: '数据录入表',
}

/** 分享链接生命周期状态中文标签 */
export const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
  active: '生效中',
  expired: '已过期',
  revoked: '已失效',
}

/** 格式化分享时间字段为本地 YYYY-MM-DD HH:mm */
export function formatShareTimestamp(
  iso: string | null | undefined,
  emptyLabel = '永久有效',
): string {
  if (!iso) return emptyLabel
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return emptyLabel
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

/** 列头点击排序循环：该列规则 无→asc→desc→移除；additive 在既有规则上原地循环、不塌缩其它规则 */
export function cycleSortRules(
  rules: readonly SortRule[],
  field: string,
  additive: boolean,
): SortRule[] {
  const index = rules.findIndex((rule) => rule.field === field)
  if (index < 0) {
    return additive ? [...rules, { field, direction: 'asc' }] : [{ field, direction: 'asc' }]
  }
  const current = rules[index]!
  if (additive) {
    return current.direction === 'asc'
      ? rules.map((rule, i) => (i === index ? { field, direction: 'desc' } : rule))
      : rules.filter((_, i) => i !== index)
  }
  return current.direction === 'asc' ? [{ field, direction: 'desc' }] : []
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

/** 根据所属多维数据台（或数据源表）与视图类型构造新建应用视图请求体 */
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

/** 生成当前站点下 /s/:token 完整分享 URL */
export function buildShareFullUrl(token: string): string {
  const baseHref = typeof window !== 'undefined' ? window.location.href : ''
  return buildAbsoluteRouteUrl(baseHref, { kind: 'share', token })
}

/** 安全复制文本至剪贴板 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
