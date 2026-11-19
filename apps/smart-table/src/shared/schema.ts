// 前后端共享的核心领域 Schema 与类型单源（表、列、视图、VLOOKUP、筛选、排序、汇总）

export type TableKind =
  | 'normal' // 普通自建表（类 Excel，用户自由增删改行列）
  | 'advanced' // 进阶数据源表（对接 SQL 物理表/主数据，带业务主键与唯一索引）

export type SummaryType = 'none' | 'sum' | 'avg' | 'max' | 'min' | 'count' | 'filled_rate'

export type SmartColumnType =
  | 'text' // 文本
  | 'number' // 数值 / 金额（支持千分位、货币符号、小数位配置）
  | 'select' // 彩色单选标签（Canvas 圆角胶囊自绘）
  | 'date' // 日期（YYYY-MM-DD）
  | 'checkbox' // 勾选框（复用 ListTable 内置 checkbox）
  | 'person' // 人员列（Canvas 绘彩色圆形头像缩写 + 姓名）
  | 'progress' // 进度条列（0~100%，Canvas 绘轨道 + 进度色条 + 百分比文字）
  | 'image' // 图片列（复用 ListTable resolveCellImage L2 media 层无闪渲染）
  | 'link' // 超链接列（复用 ListTable resolveCellLink 蓝字下划线 + 点击打开）
  | 'lookup' // 傻瓜式 VLOOKUP 跨表查找引用列
  | 'formula' // 整列计算公式列（如 [累计回款] / [合同金额]）

export type CellTextAlign = 'left' | 'center' | 'right'

/** 原始字段类型（可落库存储于数据源表） */
export type RawSmartColumnType = Exclude<SmartColumnType, 'lookup' | 'formula'>

/** 派生字段类型（仅归属于智能表格 SmartApp 层） */
export type DerivedSmartColumnType = Extract<SmartColumnType, 'lookup' | 'formula'>

export const RAW_COLUMN_TYPES = [
  'text',
  'number',
  'select',
  'date',
  'checkbox',
  'person',
  'progress',
  'image',
  'link',
] as const satisfies readonly RawSmartColumnType[]

export const DERIVED_COLUMN_TYPES = [
  'lookup',
  'formula',
] as const satisfies readonly DerivedSmartColumnType[]

/** 判断列类型是否为派生列（lookup / formula） */
export function isDerivedColumnType(type: SmartColumnType): type is DerivedSmartColumnType {
  return type === 'lookup' || type === 'formula'
}

/** 判断列类型是否为原始字段 */
export function isRawColumnType(type: SmartColumnType): type is RawSmartColumnType {
  return !isDerivedColumnType(type)
}

/** 判断列定义是否为派生列 */
export function isDerivedColumn(col: Pick<SmartColumn, 'type'>): boolean {
  return isDerivedColumnType(col.type)
}

/** 提取数据源表中的原始字段列（过滤任何 lookup / formula 派生列） */
export function filterRawColumns(columns: readonly SmartColumn[]): SmartColumn[] {
  return columns.filter((col) => isRawColumnType(col.type))
}

/** 将列列表拆分为原始字段列与派生列 */
export function splitColumnsByLayer(columns: readonly SmartColumn[]): {
  rawColumns: SmartColumn[]
  derivedColumns: SmartColumn[]
} {
  const rawColumns: SmartColumn[] = []
  const derivedColumns: SmartColumn[] = []
  for (const col of columns) {
    if (isDerivedColumnType(col.type)) {
      derivedColumns.push(col)
    } else {
      rawColumns.push(col)
    }
  }
  return { rawColumns, derivedColumns }
}

/** 合并数据源原始列与 SmartApp 派生列（过滤非法非派生列与重复 key，保证原始列优先） */
export function mergeSmartColumns(
  rawColumns: readonly SmartColumn[],
  derivedColumns?: readonly SmartColumn[],
): SmartColumn[] {
  const baseRaw = filterRawColumns(rawColumns)
  if (!derivedColumns || derivedColumns.length === 0) {
    return baseRaw
  }
  const seen = new Set(baseRaw.map((col) => col.key))
  const merged = [...baseRaw]
  for (const col of derivedColumns) {
    if (!isDerivedColumnType(col.type) || seen.has(col.key)) {
      continue
    }
    seen.add(col.key)
    merged.push(col)
  }
  return merged
}

export interface SelectOption {
  label: string
  color: string // 胶囊背景色
  textColor: string // 胶囊文字色
}

export interface LookupMatchRule {
  sourceField: string // 本表匹配列（如 'owner_name' 负责人姓名）
  targetField: string // 目标表匹配列（如 'name' 员工姓名）
}

export type LookupMode =
  | 'one' // 一对一查找带出字段（如：根据姓名查工号/部门/职级）
  | 'rollup' // 一对多汇总（如：根据客户名/项目编号去回款流水表汇总累计回款）

export type LookupRollupAgg = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'join'

export interface LookupConfig {
  /** 同一次向导批量生成的列共享同一个 groupId，消歧义一次即可联动同组所有带出列 */
  groupId: string
  targetTableId: string
  /** 支持 1~N 个匹配条件（AND 关系，例如：姓名=姓名 且 部门=部门） */
  matchRules: LookupMatchRule[]
  /** 要从目标表带出的字段 key */
  targetReturnField: string
  mode: LookupMode
  /** mode === 'rollup' 时的聚合方式 */
  rollupAgg?: LookupRollupAgg
}

export interface SmartColumn {
  key: string
  title: string
  type: SmartColumnType
  width: number
  /** 是否必填（仅用于数据源表原始字段录入、编辑与导入校验） */
  required?: boolean
  /** 表级基础水平对齐（优先级低于视图 columnStyles.align） */
  align?: CellTextAlign
  /** 是否为唯一键/索引列（进阶表会在列头展示 🔑 标识） */
  isUniqueKey?: boolean
  /** select 类型的枚举项 */
  options?: SelectOption[]
  /** number 类型的格式：'integer' | 'decimal' | 'currency' | 'percent' */
  numberFormat?: 'integer' | 'decimal' | 'currency' | 'percent'
  /** 小数位数配置（0~6 整数；未设时按格式默认规则渲染） */
  decimalPlaces?: number
  /** lookup 类型的向导配置 */
  lookupConfig?: LookupConfig
  /** formula 类型的列级公式表达式，如 "[lookup_paid_sum] / [contract_amount]" */
  formulaExpr?: string
}

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'is_empty'
  | 'is_not_empty'

export interface FilterCondition {
  id: string
  field: string
  operator: FilterOperator
  value: unknown
}

export interface FilterGroup {
  conjunction: 'and' | 'or'
  conditions: FilterCondition[]
}

export interface SortRule {
  field: string
  direction: 'asc' | 'desc'
}

export const MIN_DECIMAL_PLACES = 0
export const MAX_DECIMAL_PLACES = 6

/** 校验小数位数配置是否为 0..6 整数 */
export function isValidDecimalPlaces(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_DECIMAL_PLACES &&
    value <= MAX_DECIMAL_PLACES
  )
}

export type SmartPivotAgg = 'sum' | 'count' | 'avg' | 'min' | 'max'

export interface SmartPivotMeasureConfig {
  key: string
  title: string
  field: string
  agg: SmartPivotAgg
  width?: number
  /** 透视度量独立小数位数（0~6 整数；未设时回退对应列 decimalPlaces） */
  decimalPlaces?: number
}

export interface SmartPivotConfig {
  rowDimensions: string[]
  columnDimensions: string[]
  measures: SmartPivotMeasureConfig[]
  showGrandTotal?: boolean
  collapsible?: boolean
}

export type SmartViewType = 'table' | 'kanban' | 'pivot' | 'dashboard'

export type RowHeightPreset = 'compact' | 'standard' | 'comfortable'

export const ROW_HEIGHT_VALUES: Record<RowHeightPreset, number> = {
  compact: 32,
  standard: 38,
  comfortable: 52,
}

/** 列级样式配置（水平对齐、列头与整列背景/文字色） */
export interface ColumnStyleConfig {
  align?: CellTextAlign
  headerBgColor?: string
  headerTextColor?: string
  bgColor?: string
  textColor?: string
}

/** 单元格/选区级自定义样式配置 */
export interface CellStyleConfig {
  bgColor?: string
  textColor?: string
  align?: CellTextAlign
}

export type ConditionalFormatScope = 'cell' | 'row'

/** 条件格式规则（复用筛选操作符，支持整行或单格作用域） */
export interface ConditionalFormatRule {
  id: string
  name?: string
  enabled?: boolean
  field: string
  operator: FilterOperator
  value: unknown
  scope: ConditionalFormatScope
  bgColor?: string
  textColor?: string
}

/** 看板视图配置 */
export interface KanbanConfig {
  /** 用于泳道分组的字段 key（通常为 select 类型，也支持文本/lookup） */
  groupByField: string
  /** 卡片主标题字段 key（未指定时回退首个文本列） */
  titleField?: string
  /** 卡片展示的摘要字段 key 列表 */
  displayFields: string[]
  /** 是否隐藏无记录的空泳道 */
  hideEmptyLanes?: boolean
  /** 自定义泳道顺序（未列出的选项按列定义/数据顺序追加） */
  laneOrder?: string[]
}

export type DashboardKpiAgg = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'filled_rate'

export type DashboardKpiIcon =
  | 'auto'
  | 'hash'
  | 'dollar'
  | 'percent'
  | 'trending'
  | 'award'
  | 'layers'
  | 'clock'

export interface DashboardKpiConfig {
  id: string
  title: string
  field: string
  agg: DashboardKpiAgg
  numberFormat?: SmartColumn['numberFormat']
  /** KPI 指标卡独立小数位数（0~6 整数；未设时回退列 decimalPlaces） */
  decimalPlaces?: number
  prefix?: string
  suffix?: string
  accentColor?: string
  icon?: DashboardKpiIcon
}

export type DashboardChartType = 'bar' | 'horizontalBar' | 'line' | 'area' | 'pie' | 'radar'

export interface DashboardChartConfig {
  id: string
  title: string
  chartType: DashboardChartType
  dimensionField: string
  measureField: string
  agg: SmartPivotAgg
  seriesField?: string
  stacked?: boolean
  sortBy?: 'value_desc' | 'value_asc' | 'label_asc'
  limit?: number
  donut?: boolean
  span?: 1 | 2
}

/** 统计仪表盘视图配置 */
export interface DashboardConfig {
  kpis: DashboardKpiConfig[]
  charts: DashboardChartConfig[]
}

export interface SmartView {
  id: string
  name: string
  type: SmartViewType
  /** 绑定的数据源表 ID（独立应用视图模型必带；兼容表内嵌视图可选） */
  tableId?: string
  /** 应用视图空间中的排序序号 */
  sortOrder?: number
  description?: string
  filterGroup: FilterGroup
  /** 快捷筛选胶囊字段 key 列表（如 ['status', 'lookup_dept']） */
  quickFilterFields: string[]
  /** 快捷筛选当前激活值（field -> 选中值数组） */
  quickFilterValues?: Record<string, string[]>
  sortRules: SortRule[]
  /** 字段顺序（columnKey 列表）；未列出的表列按表定义顺序追加 */
  columnOrder?: string[]
  /** 隐藏列 key 列表 */
  hiddenColumns?: string[]
  /** 视图级列宽覆盖：columnKey -> width */
  columnWidths?: Record<string, number>
  /** 左侧冻结列数 */
  frozenColCount?: number
  /** 行高档位 */
  rowHeight?: RowHeightPreset
  /** 列级样式映射：columnKey -> ColumnStyleConfig */
  columnStyles?: Record<string, ColumnStyleConfig>
  /** 单元格/选区样式映射：recordId -> fieldKey -> CellStyleConfig */
  cellStyles?: Record<string, Record<string, CellStyleConfig>>
  /** 条件格式规则列表 */
  conditionalFormats?: ConditionalFormatRule[]
  /** 视图级汇总配置：columnKey -> SummaryType */
  summaries?: Record<string, SummaryType>
  /** type === 'pivot' 时的透视表配置 */
  pivotConfig?: SmartPivotConfig
  /** type === 'kanban' 时的看板配置 */
  kanbanConfig?: KanbanConfig
  /** type === 'dashboard' 时的仪表盘配置 */
  dashboardConfig?: DashboardConfig
}

/** 独立智能表格应用（基于底层数据源表创建，承载派生列、消歧锁定与多维视图） */
export interface SmartApp {
  id: string
  name: string
  description?: string
  /** 绑定的数据源表 ID */
  tableId: string
  /** 智能表格列表中的排序序号 */
  sortOrder: number
  /** 应用层派生列（仅允许 lookup / formula，由同 App 多视图共享） */
  derivedColumns?: SmartColumn[]
  /** VLOOKUP 重名消歧锁定表：recordId -> (groupId -> targetRecordId) */
  lookupOverrides?: Record<string, Record<string, string>>
  updatedAt?: string
}

/** 独立应用视图模型（归属于某张智能表格 appId，绑定数据源表 tableId） */
export interface WorkspaceView extends SmartView {
  appId: string
  tableId: string
  sortOrder: number
  updatedAt?: string
}

export interface SmartTableMeta {
  id: string
  name: string
  kind: TableKind
  description?: string
  /** 进阶表的业务主键字段 key（如 'emp_id'），用于索引加速与重名消歧展示 */
  primaryKeyField?: string
  /** 进阶表绑定的后端 SQL 查询或物理表名 */
  sourceSqlTable?: string
  /** 系统内置表（种子进阶物理表）：禁止删除；用户自建的 advanced 表可删（连动物理表） */
  system?: boolean
  columns: SmartColumn[]
  views: SmartView[]
  /** 底部汇总栏配置：columnKey -> SummaryType */
  summaries: Record<string, SummaryType>
}

export interface SmartRecord {
  /** 系统内部唯一行 ID（UUID 或主键映射），重名消歧义时靠它锁定目标行 */
  _id: string
  /** 各列的原始值 */
  [fieldKey: string]: unknown
  /**
   * 傻瓜式 VLOOKUP 手动消歧义锁定表：
   * Record<lookupGroupKey, targetRecordId>
   * 例如存在两个“张三”时，用户在单元格点选了「研发部-张三(EMP-001)」，记录在此
   */
  _lookupOverrides?: Record<string, string>
}

/** 单行单 VLOOKUP 组的冲突与消歧状态（供画布角标与消歧卡片使用） */
export interface LookupConflictInfo {
  groupId: string
  targetTableId: string
  /** 命中的所有目标表候选行（length > 1 即存在重名冲突） */
  candidates: readonly SmartRecord[]
  /** 是否已通过 _lookupOverrides[groupId] 明确锁定唯一目标行 */
  isResolved: boolean
  /** 当前生效的目标行 ID（已锁定取锁定值，未锁定默认取首条） */
  selectedRecordId?: string
}
