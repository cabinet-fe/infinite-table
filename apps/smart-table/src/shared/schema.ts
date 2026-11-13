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
  /** 是否为唯一键/索引列（进阶表会在列头展示 🔑 标识） */
  isUniqueKey?: boolean
  /** select 类型的枚举项 */
  options?: SelectOption[]
  /** number 类型的格式：'integer' | 'decimal' | 'currency' | 'percent' */
  numberFormat?: 'integer' | 'decimal' | 'currency' | 'percent'
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

export type SmartPivotAgg = 'sum' | 'count' | 'avg' | 'min' | 'max'

export interface SmartPivotMeasureConfig {
  key: string
  title: string
  field: string
  agg: SmartPivotAgg
  width?: number
}

export interface SmartPivotConfig {
  rowDimensions: string[]
  columnDimensions: string[]
  measures: SmartPivotMeasureConfig[]
  showGrandTotal?: boolean
  collapsible?: boolean
}

export interface SmartView {
  id: string
  name: string
  type: 'table' | 'pivot'
  filterGroup: FilterGroup
  /** 快捷筛选胶囊字段 key 列表（如 ['status', 'lookup_dept']） */
  quickFilterFields: string[]
  /** 快捷筛选当前激活值（field -> 选中值数组） */
  quickFilterValues?: Record<string, string[]>
  sortRules: SortRule[]
  /** type === 'pivot' 时的透视表配置 */
  pivotConfig?: SmartPivotConfig
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
