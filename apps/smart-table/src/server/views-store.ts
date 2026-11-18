// 独立应用视图（WorkspaceView）SQLite 持久化、参数校验与看板写回封装
import type { Database } from 'bun:sqlite'
import { getBlockedLookupSourceKeys } from '../domain/lookup-engine'
import type {
  CreateAppRequest,
  CreateAppResponse,
  CreateViewRequest,
  TableBundle,
  UpdateAppRequest,
  UpdateViewRequest,
} from '../shared/api-types'
import {
  filterRawColumns,
  mergeSmartColumns,
  type CellStyleConfig,
  type CellTextAlign,
  type ColumnStyleConfig,
  type ConditionalFormatRule,
  type DashboardChartType,
  type DashboardConfig,
  type DashboardKpiAgg,
  type DashboardKpiIcon,
  type FilterGroup,
  type KanbanConfig,
  type LookupRollupAgg,
  type RowHeightPreset,
  type SmartApp,
  type SmartColumn,
  type SmartPivotAgg,
  type SmartPivotConfig,
  type SmartRecord,
  type SmartViewType,
  type SortRule,
  type SummaryType,
  type WorkspaceView,
} from '../shared/schema'
import {
  VALID_VIEW_TYPES,
  ValidationError,
  getTableBundle,
  getTableMeta,
  isPlainObject,
  runInTransaction,
  updateTableRecord,
} from './db'

interface SmartAppRow {
  id: string
  name: string
  description: string | null
  table_id: string
  sort_order: number
  derived_columns_json: string
  lookup_overrides_json: string
  updated_at: string
}

interface WorkspaceViewRow {
  id: string
  app_id: string | null
  table_id: string
  name: string
  type: SmartViewType
  sort_order: number
  config_json: string
  updated_at: string
}

interface WorkspaceViewConfig {
  description?: string
  filterGroup: FilterGroup
  quickFilterFields: string[]
  quickFilterValues?: Record<string, string[]>
  sortRules: SortRule[]
  columnOrder?: string[]
  hiddenColumns?: string[]
  columnWidths?: Record<string, number>
  frozenColCount?: number
  rowHeight?: RowHeightPreset
  columnStyles?: Record<string, ColumnStyleConfig>
  cellStyles?: Record<string, Record<string, CellStyleConfig>>
  conditionalFormats?: ConditionalFormatRule[]
  summaries?: Record<string, SummaryType>
  pivotConfig?: SmartPivotConfig
  kanbanConfig?: KanbanConfig
  dashboardConfig?: DashboardConfig
}

const VALID_ROW_HEIGHTS: ReadonlySet<RowHeightPreset> = new Set([
  'compact',
  'standard',
  'comfortable',
])

const VALID_FILTER_OPERATORS = new Set([
  'eq',
  'neq',
  'contains',
  'not_contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'is_empty',
  'is_not_empty',
])

const VALID_DASHBOARD_KPI_AGGS: ReadonlySet<DashboardKpiAgg> = new Set([
  'sum',
  'avg',
  'min',
  'max',
  'count',
  'filled_rate',
])

const VALID_DASHBOARD_KPI_ICONS: ReadonlySet<DashboardKpiIcon> = new Set([
  'auto',
  'hash',
  'dollar',
  'percent',
  'trending',
  'award',
  'layers',
  'clock',
])

const VALID_NUMBER_FORMATS: ReadonlySet<NonNullable<SmartColumn['numberFormat']>> = new Set([
  'integer',
  'decimal',
  'currency',
  'percent',
])

const VALID_DASHBOARD_CHART_TYPES: ReadonlySet<DashboardChartType> = new Set([
  'bar',
  'horizontalBar',
  'line',
  'area',
  'pie',
  'radar',
])

const VALID_PIVOT_AGGS: ReadonlySet<SmartPivotAgg> = new Set(['sum', 'count', 'avg', 'min', 'max'])

const VALID_CHART_SORT_BY = new Set(['value_desc', 'value_asc', 'label_asc'])

const VALID_CELL_ALIGNS: ReadonlySet<CellTextAlign> = new Set(['left', 'center', 'right'])

const VALID_LOOKUP_ROLLUP_AGGS: ReadonlySet<LookupRollupAgg> = new Set([
  'sum',
  'count',
  'avg',
  'min',
  'max',
  'join',
])

function ensureTableExists(db: Database, tableId: string): void {
  const row = db.query('SELECT id FROM smart_tables WHERE id = ?').get(tableId) as
    | { id: string }
    | undefined
    | null
  if (!row) {
    throw new ValidationError(`绑定的数据源表不存在: "${tableId}"`)
  }
}

function validateViewType(type: unknown): SmartViewType {
  if (typeof type !== 'string' || !VALID_VIEW_TYPES.has(type as SmartViewType)) {
    throw new ValidationError('视图类型必须为 table / kanban / pivot / dashboard')
  }
  return type as SmartViewType
}

function validateFilterGroup(value: unknown): FilterGroup {
  if (
    !isPlainObject(value) ||
    (value.conjunction !== 'and' && value.conjunction !== 'or') ||
    !Array.isArray(value.conditions)
  ) {
    throw new ValidationError('filterGroup 格式不合法')
  }
  return value as unknown as FilterGroup
}

function validateRowHeight(value: unknown): RowHeightPreset {
  if (typeof value !== 'string' || !VALID_ROW_HEIGHTS.has(value as RowHeightPreset)) {
    throw new ValidationError('rowHeight 必须为 compact / standard / comfortable')
  }
  return value as RowHeightPreset
}

function validateFrozenColCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ValidationError('frozenColCount 必须为非负整数')
  }
  return value
}

function validateConditionalFormats(value: unknown): ConditionalFormatRule[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('conditionalFormats 必须为数组')
  }
  for (let i = 0; i < value.length; i++) {
    const item = value[i]
    if (!isPlainObject(item)) {
      throw new ValidationError(`第 ${i + 1} 条条件格式规则必须为对象`)
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      throw new ValidationError(`第 ${i + 1} 条条件格式规则缺少非空 id`)
    }
    if (typeof item.field !== 'string' || item.field.trim() === '') {
      throw new ValidationError(`条件格式规则 "${item.id}" 缺少非空 field`)
    }
    if (typeof item.operator !== 'string' || !VALID_FILTER_OPERATORS.has(item.operator)) {
      throw new ValidationError(`条件格式规则 "${item.id}" 的 operator 不合法`)
    }
    if (item.scope !== 'cell' && item.scope !== 'row') {
      throw new ValidationError(`条件格式规则 "${item.id}" 的 scope 必须为 cell 或 row`)
    }
  }
  return value as unknown as ConditionalFormatRule[]
}

function validateKanbanConfig(value: unknown): KanbanConfig {
  if (!isPlainObject(value)) {
    throw new ValidationError('kanbanConfig 必须为对象')
  }
  if (typeof value.groupByField !== 'string' || value.groupByField.trim() === '') {
    throw new ValidationError('kanbanConfig.groupByField 不能为空')
  }
  if (!Array.isArray(value.displayFields)) {
    throw new ValidationError('kanbanConfig.displayFields 必须为字符串数组')
  }
  return value as unknown as KanbanConfig
}

function validateDashboardKpi(item: unknown, index: number): void {
  if (!isPlainObject(item)) {
    throw new ValidationError(`第 ${index + 1} 个 KPI 指标卡配置必须为对象`)
  }
  if (typeof item.id !== 'string' || item.id.trim() === '') {
    throw new ValidationError(`第 ${index + 1} 个 KPI 指标卡缺少非空 id`)
  }
  if (typeof item.title !== 'string') {
    throw new ValidationError(`KPI "${item.id}" 的 title 必须为字符串`)
  }
  if (typeof item.field !== 'string') {
    throw new ValidationError(`KPI "${item.id}" 的 field 必须为字符串`)
  }
  if (typeof item.agg !== 'string' || !VALID_DASHBOARD_KPI_AGGS.has(item.agg as DashboardKpiAgg)) {
    throw new ValidationError(`KPI "${item.id}" 的 agg 不合法`)
  }
  if (
    item.numberFormat !== undefined &&
    (typeof item.numberFormat !== 'string' ||
      !VALID_NUMBER_FORMATS.has(item.numberFormat as NonNullable<SmartColumn['numberFormat']>))
  ) {
    throw new ValidationError(`KPI "${item.id}" 的 numberFormat 不合法`)
  }
  if (item.prefix !== undefined && typeof item.prefix !== 'string') {
    throw new ValidationError(`KPI "${item.id}" 的 prefix 必须为字符串`)
  }
  if (item.suffix !== undefined && typeof item.suffix !== 'string') {
    throw new ValidationError(`KPI "${item.id}" 的 suffix 必须为字符串`)
  }
  if (item.accentColor !== undefined && typeof item.accentColor !== 'string') {
    throw new ValidationError(`KPI "${item.id}" 的 accentColor 必须为字符串`)
  }
  if (
    item.icon !== undefined &&
    (typeof item.icon !== 'string' || !VALID_DASHBOARD_KPI_ICONS.has(item.icon as DashboardKpiIcon))
  ) {
    throw new ValidationError(`KPI "${item.id}" 的 icon 不合法`)
  }
}

function validateDashboardChart(item: unknown, index: number): void {
  if (!isPlainObject(item)) {
    throw new ValidationError(`第 ${index + 1} 个图表配置必须为对象`)
  }
  if (typeof item.id !== 'string' || item.id.trim() === '') {
    throw new ValidationError(`第 ${index + 1} 个图表缺少非空 id`)
  }
  if (typeof item.title !== 'string') {
    throw new ValidationError(`图表 "${item.id}" 的 title 必须为字符串`)
  }
  if (
    typeof item.chartType !== 'string' ||
    !VALID_DASHBOARD_CHART_TYPES.has(item.chartType as DashboardChartType)
  ) {
    throw new ValidationError(`图表 "${item.id}" 的 chartType 不合法`)
  }
  if (typeof item.dimensionField !== 'string') {
    throw new ValidationError(`图表 "${item.id}" 的 dimensionField 必须为字符串`)
  }
  if (typeof item.measureField !== 'string') {
    throw new ValidationError(`图表 "${item.id}" 的 measureField 必须为字符串`)
  }
  if (typeof item.agg !== 'string' || !VALID_PIVOT_AGGS.has(item.agg as SmartPivotAgg)) {
    throw new ValidationError(`图表 "${item.id}" 的 agg 不合法`)
  }
  if (item.seriesField !== undefined && typeof item.seriesField !== 'string') {
    throw new ValidationError(`图表 "${item.id}" 的 seriesField 必须为字符串`)
  }
  if (item.stacked !== undefined && typeof item.stacked !== 'boolean') {
    throw new ValidationError(`图表 "${item.id}" 的 stacked 必须为布尔值`)
  }
  if (
    item.sortBy !== undefined &&
    (typeof item.sortBy !== 'string' || !VALID_CHART_SORT_BY.has(item.sortBy))
  ) {
    throw new ValidationError(`图表 "${item.id}" 的 sortBy 不合法`)
  }
  if (
    item.limit !== undefined &&
    (typeof item.limit !== 'number' || !Number.isFinite(item.limit) || item.limit <= 0)
  ) {
    throw new ValidationError(`图表 "${item.id}" 的 limit 必须为正数`)
  }
  if (item.donut !== undefined && typeof item.donut !== 'boolean') {
    throw new ValidationError(`图表 "${item.id}" 的 donut 必须为布尔值`)
  }
  if (item.span !== undefined && item.span !== 1 && item.span !== 2) {
    throw new ValidationError(`图表 "${item.id}" 的 span 必须为 1 或 2`)
  }
}

function validateDashboardConfig(value: unknown): DashboardConfig {
  if (!isPlainObject(value) || !Array.isArray(value.kpis) || !Array.isArray(value.charts)) {
    throw new ValidationError('dashboardConfig 必须包含 kpis 与 charts 数组')
  }
  value.kpis.forEach(validateDashboardKpi)
  value.charts.forEach(validateDashboardChart)
  return value as unknown as DashboardConfig
}

function validateStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ValidationError(`${label} 必须为字符串数组`)
  }
  return value as string[]
}

function validatePlainMap<T>(value: unknown, label: string): T {
  if (!isPlainObject(value)) {
    throw new ValidationError(`${label} 必须为对象`)
  }
  return value as T
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function validateDerivedColumns(
  db: Database,
  sourceTableId: string,
  value: unknown,
): SmartColumn[] {
  if (!Array.isArray(value)) {
    throw new ValidationError('derivedColumns 必须为数组')
  }
  const sourceMeta = getTableMeta(db, sourceTableId)
  if (!sourceMeta) {
    throw new ValidationError(`绑定的数据源表不存在: "${sourceTableId}"`)
  }

  const rawSourceColumns = filterRawColumns(sourceMeta.columns)
  const rawSourceKeys = new Set(rawSourceColumns.map((col) => col.key))
  const seenKeys = new Set<string>()
  const validated: SmartColumn[] = []

  for (let i = 0; i < value.length; i++) {
    const col = value[i]
    if (!isPlainObject(col)) {
      throw new ValidationError(`第 ${i + 1} 个派生列配置必须为对象`)
    }
    if (typeof col.key !== 'string' || col.key.trim() === '') {
      throw new ValidationError(`第 ${i + 1} 个派生列缺少非空字段 key`)
    }
    if (typeof col.title !== 'string' || col.title.trim() === '') {
      throw new ValidationError(`派生列 "${col.key}" 缺少非空标题 title`)
    }
    if (col.type !== 'lookup' && col.type !== 'formula') {
      throw new ValidationError(`派生列 "${col.key}" 的类型仅允许 lookup 或 formula`)
    }
    if (rawSourceKeys.has(col.key)) {
      throw new ValidationError(`派生列 key "${col.key}" 与数据源表原始列重复`)
    }
    if (seenKeys.has(col.key)) {
      throw new ValidationError(`存在重复派生列 key: "${col.key}"`)
    }
    if (
      col.align !== undefined &&
      (typeof col.align !== 'string' || !VALID_CELL_ALIGNS.has(col.align as CellTextAlign))
    ) {
      throw new ValidationError(`派生列 "${col.key}" 的 align 必须为 left / center / right`)
    }
    if (
      col.width !== undefined &&
      (typeof col.width !== 'number' || !Number.isFinite(col.width) || col.width <= 0)
    ) {
      throw new ValidationError(`派生列 "${col.key}" 的 width 必须为正数`)
    }
    if (
      col.numberFormat !== undefined &&
      (typeof col.numberFormat !== 'string' ||
        !VALID_NUMBER_FORMATS.has(col.numberFormat as NonNullable<SmartColumn['numberFormat']>))
    ) {
      throw new ValidationError(`派生列 "${col.key}" 的 numberFormat 不合法`)
    }
    if (col.type === 'formula') {
      if (typeof col.formulaExpr !== 'string' || col.formulaExpr.trim() === '') {
        throw new ValidationError(`公式列 "${col.key}" 缺少非空表达式 formulaExpr`)
      }
    } else if (!isPlainObject(col.lookupConfig)) {
      throw new ValidationError(`VLOOKUP 列 "${col.key}" 缺少 lookupConfig 配置`)
    }

    seenKeys.add(col.key)
    validated.push(col as unknown as SmartColumn)
  }

  const mergedColumns = mergeSmartColumns(rawSourceColumns, validated)
  const allowedSourceKeys = new Set(
    mergedColumns.filter((col) => col.type !== 'formula').map((col) => col.key),
  )
  const targetMetaCache = new Map<string, ReturnType<typeof getTableMeta>>()

  for (const col of validated) {
    if (col.type !== 'lookup') continue
    const cfg = col.lookupConfig!
    if (typeof cfg.groupId !== 'string' || cfg.groupId.trim() === '') {
      throw new ValidationError(`VLOOKUP 列 "${col.key}" 缺少非空 groupId`)
    }
    if (typeof cfg.targetTableId !== 'string' || cfg.targetTableId.trim() === '') {
      throw new ValidationError(`VLOOKUP 列 "${col.key}" 缺少目标数据源表 targetTableId`)
    }
    if (cfg.mode !== 'one' && cfg.mode !== 'rollup') {
      throw new ValidationError(`VLOOKUP 列 "${col.key}" 的 mode 必须为 one 或 rollup`)
    }
    if (
      cfg.mode === 'rollup' &&
      cfg.rollupAgg !== undefined &&
      (typeof cfg.rollupAgg !== 'string' || !VALID_LOOKUP_ROLLUP_AGGS.has(cfg.rollupAgg))
    ) {
      throw new ValidationError(`VLOOKUP 列 "${col.key}" 的 rollupAgg 不合法`)
    }

    let targetMeta = targetMetaCache.get(cfg.targetTableId)
    if (targetMeta === undefined) {
      targetMeta = getTableMeta(db, cfg.targetTableId)
      targetMetaCache.set(cfg.targetTableId, targetMeta)
    }
    if (!targetMeta) {
      throw new ValidationError(
        `VLOOKUP 列 "${col.key}" 关联的目标数据源表不存在: "${cfg.targetTableId}"`,
      )
    }

    const targetRawKeys = new Set(filterRawColumns(targetMeta.columns).map((c) => c.key))
    if (typeof cfg.targetReturnField !== 'string' || !targetRawKeys.has(cfg.targetReturnField)) {
      throw new ValidationError(
        `VLOOKUP 列 "${col.key}" 的返回字段 "${String(cfg.targetReturnField)}" 必须为目标数据源表原始字段`,
      )
    }

    if (!Array.isArray(cfg.matchRules) || cfg.matchRules.length === 0) {
      throw new ValidationError(`VLOOKUP 列 "${col.key}" 至少需要一条匹配条件`)
    }
    const blockedSourceKeys = getBlockedLookupSourceKeys(mergedColumns, cfg.groupId)
    for (const rule of cfg.matchRules) {
      if (!isPlainObject(rule)) {
        throw new ValidationError(`VLOOKUP 列 "${col.key}" 的 matchRules 项必须为对象`)
      }
      if (typeof rule.sourceField !== 'string' || rule.sourceField.trim() === '') {
        throw new ValidationError(`VLOOKUP 列 "${col.key}" 的匹配规则缺少 sourceField`)
      }
      if (!allowedSourceKeys.has(rule.sourceField) || blockedSourceKeys.has(rule.sourceField)) {
        throw new ValidationError(
          `VLOOKUP 列 "${col.key}" 的本表匹配字段 "${rule.sourceField}" 无效或形成循环依赖`,
        )
      }
      if (typeof rule.targetField !== 'string' || !targetRawKeys.has(rule.targetField)) {
        throw new ValidationError(
          `VLOOKUP 列 "${col.key}" 的目标匹配字段 "${String(rule.targetField)}" 必须为目标数据源表原始字段`,
        )
      }
    }
  }

  return validated
}

function validateLookupOverrides(value: unknown): Record<string, Record<string, string>> {
  if (value === null) {
    return {}
  }
  if (!isPlainObject(value)) {
    throw new ValidationError('lookupOverrides 必须为对象')
  }
  const normalized: Record<string, Record<string, string>> = {}
  for (const [recordId, groupMap] of Object.entries(value)) {
    if (recordId.trim() === '') {
      throw new ValidationError('lookupOverrides 的记录 ID 不能为空')
    }
    if (!isPlainObject(groupMap)) {
      throw new ValidationError(`lookupOverrides["${recordId}"] 必须为对象`)
    }
    const nextGroupMap: Record<string, string> = {}
    for (const [groupId, targetRecordId] of Object.entries(groupMap)) {
      if (groupId.trim() === '') {
        throw new ValidationError('lookupOverrides 的 groupId 不能为空')
      }
      if (targetRecordId === null || targetRecordId === undefined) {
        continue
      }
      if (typeof targetRecordId !== 'string') {
        throw new ValidationError(`lookupOverrides["${recordId}"]["${groupId}"] 必须为字符串`)
      }
      const trimmed = targetRecordId.trim()
      if (trimmed !== '') {
        nextGroupMap[groupId] = trimmed
      }
    }
    if (Object.keys(nextGroupMap).length > 0) {
      normalized[recordId] = nextGroupMap
    }
  }
  return normalized
}

function parseSmartAppRow(row: SmartAppRow): SmartApp {
  const parsedDerived = parseJsonSafe<SmartColumn[]>(row.derived_columns_json, [])
  const parsedOverrides = parseJsonSafe<Record<string, Record<string, string>>>(
    row.lookup_overrides_json,
    {},
  )
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    tableId: row.table_id,
    sortOrder: row.sort_order,
    derivedColumns: Array.isArray(parsedDerived) ? parsedDerived : [],
    lookupOverrides: isPlainObject(parsedOverrides) ? parsedOverrides : {},
    updatedAt: row.updated_at,
  }
}

function readSmartAppRow(db: Database, appId: string): SmartAppRow | null {
  const row = db
    .query(
      'SELECT id, name, description, table_id, sort_order, derived_columns_json, lookup_overrides_json, updated_at FROM smart_apps WHERE id = ?',
    )
    .get(appId) as SmartAppRow | undefined | null
  return row ?? null
}

/** 列出所有独立智能表格应用（按 sort_order 升序） */
export function listSmartApps(db: Database): SmartApp[] {
  const rows = db
    .query(
      'SELECT id, name, description, table_id, sort_order, derived_columns_json, lookup_overrides_json, updated_at FROM smart_apps ORDER BY sort_order ASC, rowid ASC',
    )
    .all() as SmartAppRow[]
  return rows.map(parseSmartAppRow)
}

/** 按 ID 获取单个智能表格应用 */
export function getSmartApp(db: Database, appId: string): SmartApp | null {
  const row = readSmartAppRow(db, appId)
  return row ? parseSmartAppRow(row) : null
}

/** 新建智能表格应用（自动附带一个默认表格视图，开箱即用） */
export function createSmartApp(db: Database, req: CreateAppRequest): CreateAppResponse {
  if (typeof req.name !== 'string' || req.name.trim() === '') {
    throw new ValidationError('智能表格名称 name 不能为空')
  }
  if (typeof req.tableId !== 'string' || req.tableId.trim() === '') {
    throw new ValidationError('必须指定绑定的数据源 tableId')
  }
  const name = req.name.trim()
  const tableId = req.tableId.trim()
  const description = req.description?.trim() || undefined

  return runInTransaction(db, () => {
    ensureTableExists(db, tableId)

    const derivedColumns =
      req.derivedColumns !== undefined
        ? validateDerivedColumns(db, tableId, req.derivedColumns)
        : []
    const lookupOverrides =
      req.lookupOverrides !== undefined ? validateLookupOverrides(req.lookupOverrides) : {}

    const orderRow = db
      .query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM smart_apps')
      .get() as { next_order: number } | undefined | null
    const sortOrder = orderRow?.next_order ?? 0
    const appId = `app_${crypto.randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()

    db.query(
      'INSERT INTO smart_apps (id, name, description, table_id, sort_order, derived_columns_json, lookup_overrides_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      appId,
      name,
      description ?? null,
      tableId,
      sortOrder,
      JSON.stringify(derivedColumns),
      JSON.stringify(lookupOverrides),
      now,
    )

    const app: SmartApp = {
      id: appId,
      name,
      ...(description ? { description } : {}),
      tableId,
      sortOrder,
      derivedColumns,
      lookupOverrides,
      updatedAt: now,
    }

    const defaultView = createWorkspaceView(db, {
      appId,
      tableId,
      name: '数据明细视图',
      type: 'table',
      frozenColCount: 1,
      rowHeight: 'standard',
    })

    return { app, defaultView }
  })
}

/** 更新智能表格名称、描述、派生列或重名消歧覆盖 */
export function updateSmartApp(
  db: Database,
  appId: string,
  patch: UpdateAppRequest,
): SmartApp | null {
  return runInTransaction(db, () => {
    const existing = readSmartAppRow(db, appId)
    if (!existing) return null

    let nextName = existing.name
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') {
        throw new ValidationError('智能表格名称 name 不能为空')
      }
      nextName = patch.name.trim()
    }

    let nextDesc = existing.description
    if ('description' in patch) {
      if (patch.description === undefined || patch.description === null) {
        nextDesc = null
      } else if (typeof patch.description === 'string') {
        nextDesc = patch.description.trim() || null
      } else {
        throw new ValidationError('description 必须为字符串')
      }
    }

    let nextSortOrder = existing.sort_order
    if (patch.sortOrder !== undefined) {
      if (typeof patch.sortOrder !== 'number' || !Number.isInteger(patch.sortOrder)) {
        throw new ValidationError('sortOrder 必须为整数')
      }
      nextSortOrder = patch.sortOrder
    }

    const parsedExistingDerived = parseJsonSafe<SmartColumn[]>(existing.derived_columns_json, [])
    let nextDerivedColumns = Array.isArray(parsedExistingDerived) ? parsedExistingDerived : []
    if ('derivedColumns' in patch && patch.derivedColumns !== undefined) {
      nextDerivedColumns = validateDerivedColumns(db, existing.table_id, patch.derivedColumns)
    }

    const parsedExistingOverrides = parseJsonSafe<Record<string, Record<string, string>>>(
      existing.lookup_overrides_json,
      {},
    )
    let nextLookupOverrides = isPlainObject(parsedExistingOverrides) ? parsedExistingOverrides : {}
    if ('lookupOverrides' in patch && patch.lookupOverrides !== undefined) {
      nextLookupOverrides = validateLookupOverrides(patch.lookupOverrides)
    }

    const now = new Date().toISOString()
    db.query(
      'UPDATE smart_apps SET name = ?, description = ?, sort_order = ?, derived_columns_json = ?, lookup_overrides_json = ?, updated_at = ? WHERE id = ?',
    ).run(
      nextName,
      nextDesc,
      nextSortOrder,
      JSON.stringify(nextDerivedColumns),
      JSON.stringify(nextLookupOverrides),
      now,
      appId,
    )

    return {
      id: appId,
      name: nextName,
      ...(nextDesc ? { description: nextDesc } : {}),
      tableId: existing.table_id,
      sortOrder: nextSortOrder,
      derivedColumns: nextDerivedColumns,
      lookupOverrides: nextLookupOverrides,
      updatedAt: now,
    }
  })
}

/** 批量重排智能表格顺序 */
export function reorderSmartApps(db: Database, appIds: readonly string[]): SmartApp[] {
  if (!Array.isArray(appIds) || appIds.length === 0) {
    throw new ValidationError('appIds 必须为非空数组')
  }
  const seen = new Set<string>()
  for (const id of appIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ValidationError('appIds 中存在无效 ID')
    }
    if (seen.has(id)) {
      throw new ValidationError(`appIds 中存在重复 ID: "${id}"`)
    }
    seen.add(id)
  }

  return runInTransaction(db, () => {
    const allApps = listSmartApps(db)
    const byId = new Map(allApps.map((a) => [a.id, a]))
    for (const id of appIds) {
      if (!byId.has(id)) {
        throw new ValidationError(`智能表格不存在: "${id}"`)
      }
    }
    const orderedIds = [...appIds]
    for (const app of allApps) {
      if (!seen.has(app.id)) orderedIds.push(app.id)
    }

    const now = new Date().toISOString()
    const stmt = db.query('UPDATE smart_apps SET sort_order = ?, updated_at = ? WHERE id = ?')
    orderedIds.forEach((id, idx) => {
      stmt.run(idx, now, id)
    })

    return listSmartApps(db)
  })
}

/** 删除智能表格（级联删除其下全部视图） */
export function deleteSmartApp(db: Database, appId: string): boolean {
  const result = db.query('DELETE FROM smart_apps WHERE id = ?').run(appId)
  return result.changes > 0
}

function parseWorkspaceViewRow(row: WorkspaceViewRow): WorkspaceView {
  const config = JSON.parse(row.config_json) as WorkspaceViewConfig
  return {
    ...config,
    id: row.id,
    appId: row.app_id ?? `app_${row.table_id}`,
    tableId: row.table_id,
    name: row.name,
    type: row.type,
    sortOrder: row.sort_order,
    filterGroup: config.filterGroup ?? { conjunction: 'and', conditions: [] },
    quickFilterFields: config.quickFilterFields ?? [],
    sortRules: config.sortRules ?? [],
    updatedAt: row.updated_at,
  }
}

function readWorkspaceViewRow(db: Database, viewId: string): WorkspaceViewRow | null {
  const row = db
    .query(
      'SELECT id, app_id, table_id, name, type, sort_order, config_json, updated_at FROM workspace_views WHERE id = ?',
    )
    .get(viewId) as WorkspaceViewRow | undefined | null
  return row ?? null
}

/** 列出所有应用视图（按 sort_order 升序） */
export function listWorkspaceViews(db: Database): WorkspaceView[] {
  const rows = db
    .query(
      'SELECT id, app_id, table_id, name, type, sort_order, config_json, updated_at FROM workspace_views ORDER BY sort_order ASC, rowid ASC',
    )
    .all() as WorkspaceViewRow[]
  return rows.map(parseWorkspaceViewRow)
}

/** 按 ID 获取单个应用视图 */
export function getWorkspaceView(db: Database, viewId: string): WorkspaceView | null {
  const row = readWorkspaceViewRow(db, viewId)
  return row ? parseWorkspaceViewRow(row) : null
}

function applyConfigPatch(
  base: WorkspaceViewConfig,
  patch: Record<string, unknown>,
): WorkspaceViewConfig {
  const next: WorkspaceViewConfig = { ...base }

  const assignOptional = <K extends keyof WorkspaceViewConfig>(
    key: K,
    validate: (val: unknown) => WorkspaceViewConfig[K],
  ): void => {
    if (!(key in patch)) return
    const raw = patch[key]
    if (raw === undefined) return
    if (raw === null) {
      delete next[key]
      return
    }
    next[key] = validate(raw)
  }

  if ('filterGroup' in patch && patch.filterGroup !== undefined) {
    next.filterGroup = validateFilterGroup(patch.filterGroup)
  }
  if ('quickFilterFields' in patch && patch.quickFilterFields !== undefined) {
    next.quickFilterFields = validateStringArray(patch.quickFilterFields, 'quickFilterFields')
  }
  if ('sortRules' in patch && patch.sortRules !== undefined) {
    if (!Array.isArray(patch.sortRules)) {
      throw new ValidationError('sortRules 必须为数组')
    }
    next.sortRules = patch.sortRules as SortRule[]
  }

  assignOptional('description', (v) => {
    if (typeof v !== 'string') throw new ValidationError('description 必须为字符串')
    return v
  })
  assignOptional('quickFilterValues', (v) =>
    validatePlainMap<Record<string, string[]>>(v, 'quickFilterValues'),
  )
  assignOptional('columnOrder', (v) => validateStringArray(v, 'columnOrder'))
  assignOptional('hiddenColumns', (v) => validateStringArray(v, 'hiddenColumns'))
  assignOptional('columnWidths', (v) => validatePlainMap<Record<string, number>>(v, 'columnWidths'))
  assignOptional('frozenColCount', validateFrozenColCount)
  assignOptional('rowHeight', validateRowHeight)
  assignOptional('columnStyles', (v) =>
    validatePlainMap<Record<string, ColumnStyleConfig>>(v, 'columnStyles'),
  )
  assignOptional('cellStyles', (v) =>
    validatePlainMap<Record<string, Record<string, CellStyleConfig>>>(v, 'cellStyles'),
  )
  assignOptional('conditionalFormats', validateConditionalFormats)
  assignOptional('summaries', (v) => validatePlainMap<Record<string, SummaryType>>(v, 'summaries'))
  assignOptional('pivotConfig', (v) => validatePlainMap<SmartPivotConfig>(v, 'pivotConfig'))
  assignOptional('kanbanConfig', validateKanbanConfig)
  assignOptional('dashboardConfig', validateDashboardConfig)

  return next
}

/** 新建应用视图 */
export function createWorkspaceView(db: Database, req: CreateViewRequest): WorkspaceView {
  if (typeof req.name !== 'string' || req.name.trim() === '') {
    throw new ValidationError('视图名称 name 不能为空')
  }
  const type = validateViewType(req.type)

  return runInTransaction(db, () => {
    let appId = req.appId?.trim() || ''
    let tableId = req.tableId?.trim() || ''

    if (appId) {
      const app = readSmartAppRow(db, appId)
      if (!app) {
        throw new ValidationError(`所属智能表格不存在: "${appId}"`)
      }
      if (tableId && tableId !== app.table_id) {
        throw new ValidationError(
          `视图绑定的数据源 "${tableId}" 与所属智能表格 "${app.table_id}" 不一致`,
        )
      }
      tableId = app.table_id
    } else {
      if (!tableId) {
        throw new ValidationError('必须指定所属智能表格 appId 或数据源 tableId')
      }
      ensureTableExists(db, tableId)
      const existingApp = db
        .query(
          'SELECT id FROM smart_apps WHERE table_id = ? ORDER BY sort_order ASC, rowid ASC LIMIT 1',
        )
        .get(tableId) as { id: string } | undefined | null
      if (existingApp) {
        appId = existingApp.id
      } else {
        const tableRow = db.query('SELECT name FROM smart_tables WHERE id = ?').get(tableId) as {
          name: string
        }
        const orderRow = db
          .query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM smart_apps')
          .get() as { next_order: number } | undefined | null
        appId = `app_${crypto.randomUUID().slice(0, 8)}`
        db.query(
          'INSERT INTO smart_apps (id, name, description, table_id, sort_order, derived_columns_json, lookup_overrides_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          appId,
          tableRow.name,
          null,
          tableId,
          orderRow?.next_order ?? 0,
          '[]',
          '{}',
          new Date().toISOString(),
        )
      }
    }

    ensureTableExists(db, tableId)

    const orderRow = db
      .query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM workspace_views')
      .get() as { next_order: number } | undefined | null
    const sortOrder = orderRow?.next_order ?? 0

    const baseConfig: WorkspaceViewConfig = {
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: [],
      sortRules: [],
    }
    const config = applyConfigPatch(baseConfig, req as unknown as Record<string, unknown>)

    const id = `view_${crypto.randomUUID().slice(0, 8)}`
    const now = new Date().toISOString()

    db.query(
      'INSERT INTO workspace_views (id, app_id, table_id, name, type, sort_order, config_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, appId, tableId, req.name.trim(), type, sortOrder, JSON.stringify(config), now)

    return {
      ...config,
      id,
      appId,
      tableId,
      name: req.name.trim(),
      type,
      sortOrder,
      updatedAt: now,
    }
  })
}

/** 更新应用视图配置、样式、名称或绑定数据源 */
export function updateWorkspaceView(
  db: Database,
  viewId: string,
  patch: UpdateViewRequest,
): WorkspaceView | null {
  return runInTransaction(db, () => {
    const existingRow = readWorkspaceViewRow(db, viewId)
    if (!existingRow) return null

    const existingConfig = JSON.parse(existingRow.config_json) as WorkspaceViewConfig
    const nextConfig = applyConfigPatch(existingConfig, patch as Record<string, unknown>)

    let nextName = existingRow.name
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || patch.name.trim() === '') {
        throw new ValidationError('视图名称 name 不能为空')
      }
      nextName = patch.name.trim()
    }

    let nextType = existingRow.type
    if (patch.type !== undefined) {
      nextType = validateViewType(patch.type)
    }

    let nextAppId = existingRow.app_id ?? `app_${existingRow.table_id}`
    if (patch.appId !== undefined) {
      if (typeof patch.appId !== 'string' || patch.appId.trim() === '') {
        throw new ValidationError('appId 不能为空')
      }
      const targetApp = readSmartAppRow(db, patch.appId.trim())
      if (!targetApp) {
        throw new ValidationError(`所属智能表格不存在: "${patch.appId}"`)
      }
      nextAppId = targetApp.id
    }

    let nextTableId = existingRow.table_id
    if (patch.tableId !== undefined) {
      if (typeof patch.tableId !== 'string' || patch.tableId.trim() === '') {
        throw new ValidationError('tableId 不能为空')
      }
      nextTableId = patch.tableId.trim()
      ensureTableExists(db, nextTableId)
    }

    let nextSortOrder = existingRow.sort_order
    if (patch.sortOrder !== undefined) {
      if (typeof patch.sortOrder !== 'number' || !Number.isInteger(patch.sortOrder)) {
        throw new ValidationError('sortOrder 必须为整数')
      }
      nextSortOrder = patch.sortOrder
    }

    const now = new Date().toISOString()
    db.query(
      'UPDATE workspace_views SET app_id = ?, table_id = ?, name = ?, type = ?, sort_order = ?, config_json = ?, updated_at = ? WHERE id = ?',
    ).run(
      nextAppId,
      nextTableId,
      nextName,
      nextType,
      nextSortOrder,
      JSON.stringify(nextConfig),
      now,
      viewId,
    )

    return {
      ...nextConfig,
      id: viewId,
      appId: nextAppId,
      tableId: nextTableId,
      name: nextName,
      type: nextType,
      sortOrder: nextSortOrder,
      updatedAt: now,
    }
  })
}

/** 批量重排应用视图顺序 */
export function reorderWorkspaceViews(db: Database, viewIds: readonly string[]): WorkspaceView[] {
  if (!Array.isArray(viewIds) || viewIds.length === 0) {
    throw new ValidationError('viewIds 必须为非空数组')
  }
  const seen = new Set<string>()
  for (const id of viewIds) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new ValidationError('viewIds 中存在无效视图 ID')
    }
    if (seen.has(id)) {
      throw new ValidationError(`viewIds 中存在重复视图 ID: "${id}"`)
    }
    seen.add(id)
  }

  return runInTransaction(db, () => {
    const allViews = listWorkspaceViews(db)
    const byId = new Map(allViews.map((v) => [v.id, v]))
    for (const id of viewIds) {
      if (!byId.has(id)) {
        throw new ValidationError(`视图不存在: "${id}"`)
      }
    }

    const orderedIds = [...viewIds]
    for (const view of allViews) {
      if (!seen.has(view.id)) {
        orderedIds.push(view.id)
      }
    }

    const now = new Date().toISOString()
    const stmt = db.query('UPDATE workspace_views SET sort_order = ?, updated_at = ? WHERE id = ?')
    orderedIds.forEach((id, idx) => {
      stmt.run(idx, now, id)
    })

    return listWorkspaceViews(db)
  })
}

/** 删除应用视图 */
export function deleteWorkspaceView(db: Database, viewId: string): boolean {
  const result = db.query('DELETE FROM workspace_views WHERE id = ?').run(viewId)
  return result.changes > 0
}

/** 看板拖拽改状态写回数据源记录 */
export function moveKanbanCard(
  db: Database,
  viewId: string,
  recordId: string,
  targetValue: unknown,
  fieldOverride?: string,
): SmartRecord | null {
  const view = getWorkspaceView(db, viewId)
  if (!view) return null

  const field = fieldOverride?.trim() || view.kanbanConfig?.groupByField
  if (!field) {
    throw new ValidationError('看板视图未配置分组字段 groupByField')
  }
  if (view.type !== 'kanban' && !fieldOverride) {
    throw new ValidationError(`视图 "${viewId}" 不是看板视图`)
  }

  const bundle: TableBundle | null = getTableBundle(db, view.tableId)
  if (!bundle) {
    throw new ValidationError(`看板绑定的数据源表不存在: "${view.tableId}"`)
  }

  const app = getSmartApp(db, view.appId)
  const derivedCol = app?.derivedColumns?.find((c) => c.key === field)
  if (derivedCol) {
    throw new ValidationError(`派生列 "${derivedCol.title}" 不支持看板写回`)
  }

  const col = bundle.meta.columns.find((c) => c.key === field)
  if (!col) {
    throw new ValidationError(`数据源表中不存在字段 "${field}"`)
  }
  if (col.type === 'lookup' || col.type === 'formula') {
    throw new ValidationError(`计算列 "${col.title}" 不支持看板写回`)
  }

  return updateTableRecord(db, view.tableId, recordId, { [field]: targetValue })
}
