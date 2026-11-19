// 前后端 REST 接口请求/响应契约

import type {
  AuthUser,
  DemoAccountInfo,
  MemberAccessLevel,
  ResourceCapabilities,
  ResourceVisibilityScope,
  ShareRecord,
  ShareTargetType,
  SmartApp,
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
  SmartView,
  SmartViewType,
  TableKind,
  TableRowScope,
  UserCapabilities,
  WorkspaceView,
} from './schema'

export interface TableBundle {
  meta: SmartTableMeta
  records: SmartRecord[]
}

export interface AllTablesResponse {
  tables: TableBundle[]
  apps?: SmartApp[]
  views?: WorkspaceView[]
}

export interface AllAppsResponse {
  apps: SmartApp[]
}

export interface CreateAppRequest {
  name: string
  tableId: string
  description?: string
  derivedColumns?: SmartColumn[]
  lookupOverrides?: Record<string, Record<string, string>>
  visibilityScope?: ResourceVisibilityScope
  managerUserIds?: string[]
  memberAccess?: MemberAccessLevel
}

export interface CreateAppResponse {
  app: SmartApp
  defaultView: WorkspaceView
}

export type UpdateAppRequest = Partial<
  Pick<SmartApp, 'name' | 'description' | 'sortOrder' | 'derivedColumns' | 'lookupOverrides'>
>

export interface ReorderAppsRequest {
  appIds: string[]
}

export interface AllViewsResponse {
  views: WorkspaceView[]
}

export interface CreateViewRequest {
  name: string
  type: SmartViewType
  /** 所属多维数据台 ID（推荐必传；未传时按 tableId 自动匹配或创建所属多维数据台） */
  appId?: string
  /** 绑定的数据源表 ID（传 appId 时可省略，由服务端自动对齐所属多维数据台的数据源） */
  tableId?: string
  description?: string
  filterGroup?: SmartView['filterGroup']
  quickFilterFields?: string[]
  quickFilterValues?: Record<string, string[]>
  sortRules?: SmartView['sortRules']
  columnOrder?: string[]
  hiddenColumns?: string[]
  columnWidths?: Record<string, number>
  frozenColCount?: number
  rowHeight?: SmartView['rowHeight']
  columnStyles?: SmartView['columnStyles']
  cellStyles?: SmartView['cellStyles']
  conditionalFormats?: SmartView['conditionalFormats']
  summaries?: SmartView['summaries']
  pivotConfig?: SmartView['pivotConfig']
  kanbanConfig?: SmartView['kanbanConfig']
  dashboardConfig?: SmartView['dashboardConfig']
  visibilityScope?: ResourceVisibilityScope
  managerUserIds?: string[]
  memberAccess?: MemberAccessLevel
}

export type UpdateViewRequest = Partial<Omit<WorkspaceView, 'id' | 'updatedAt'>>

export interface ReorderViewsRequest {
  viewIds: string[]
}

export interface KanbanMoveCardRequest {
  /** 指定分组字段 key（可选，未传时取看板视图 kanbanConfig.groupByField） */
  field?: string
  /** 目标泳道状态值 */
  targetValue: unknown
}

export interface CreateTableRequest {
  name: string
  description?: string
  columns?: SmartTableMeta['columns']
  /** 初始行（浏览器端导入建表时随表一次写入，事务落库） */
  records?: Record<string, unknown>[]
}

export interface UpdateTableMetaRequest {
  meta: SmartTableMeta
}

export interface CreateRecordRequest {
  record: Omit<SmartRecord, '_id'> & { _id?: string }
}

export interface UpdateRecordRequest {
  patch: Record<string, unknown>
}

/** 导入列可选类型：前端推断仅产出这三种，导入弹窗下拉切换同集合 */
export type ImportColumnType = 'text' | 'number' | 'date'

/** Excel/CSV 导入预览的列推断结果（label 为原始表头，key 为清洗后的合法标识符） */
export interface ImportPreviewColumn {
  key: string
  label: string
  type: ImportColumnType
}

/** 浏览器端文件解析产出的导入预览（hucre 前端解析，编辑后提交建表） */
export interface ImportPreviewResponse {
  /** 建议表名：xlsx 取第一个 sheet 名，CSV 无文件名时为固定兜底名 */
  suggestedName: string
  columns: ImportPreviewColumn[]
  /** 数据总行数（不含表头，未截断前的精确值） */
  totalRows: number
  /** 截断上限内的全量数据行（≤5000 行 × ≤50 列字符串矩阵），前端预览自行取前若干行 */
  rows: string[][]
  /** 网格超出 5000 行 × 50 列上限被截断时为 true */
  truncated: boolean
}

/** POST /api/import/commit 请求：建表 + 事务批量插行（服务端无状态） */
export interface ImportCommitRequest {
  kind: TableKind
  tableName: string
  columns: ImportPreviewColumn[]
  rows: string[][]
}

/** POST /api/tables/:id/records/batch 请求：向普通数据源表批量追加记录 */
export interface BatchImportRecordsRequest {
  records: Record<string, unknown>[]
}

/** 批量追加导入单行单列校验错误（rowIndex 从 0 开始） */
export interface BatchImportRowError {
  rowIndex: number
  field: string
  columnTitle: string
  message: string
}

/** 批量追加导入响应 */
export interface BatchImportRecordsResponse {
  insertedCount: number
  records: SmartRecord[]
  errors?: BatchImportRowError[]
}

/** 身份认证：登录请求 */
export interface LoginRequest {
  username: string
  password: string
}

/** 身份认证：登录与当前会话响应 */
export interface AuthSessionResponse {
  user: AuthUser
  expiresAt: string
  capabilities: UserCapabilities
}

/** 演示账号清单响应 */
export interface DemoAccountsResponse {
  accounts: DemoAccountInfo[]
}

/** 权限管理概览：多维数据台应用条目 */
export interface AppPermissionItem {
  id: string
  name: string
  tableId: string
  createdBy: string | null
  createdByName: string
  visibilityScope: ResourceVisibilityScope
  managerUserIds: string[]
  memberAccess: MemberAccessLevel
}

/** 权限管理概览：应用视图条目 */
export interface ViewPermissionItem {
  id: string
  appId: string
  appName: string
  tableId: string
  name: string
  type: SmartViewType
  createdBy: string | null
  createdByName: string
  visibilityScope: ResourceVisibilityScope
  managerUserIds: string[]
  memberAccess: MemberAccessLevel | null
  effectiveMemberAccess: MemberAccessLevel
}

/** 权限管理概览：数据源表条目 */
export interface TablePermissionItem {
  id: string
  name: string
  kind: TableKind
  createdBy: string | null
  createdByName: string
  rowScope: TableRowScope
  ownerColumnKey: string | null
  memberAccess: MemberAccessLevel | null
  personColumns: Array<{ key: string; title: string }>
}

/** GET /api/permissions 响应 */
export interface PermissionsOverviewResponse {
  users: AuthUser[]
  apps: AppPermissionItem[]
  views: ViewPermissionItem[]
  tables: TablePermissionItem[]
}

/** PUT /api/permissions/apps/:id 请求 */
export interface UpdateAppPermissionRequest {
  visibilityScope?: ResourceVisibilityScope
  managerUserIds?: string[]
  memberAccess?: MemberAccessLevel
}

/** PUT /api/permissions/views/:id 请求 */
export interface UpdateViewPermissionRequest {
  visibilityScope?: ResourceVisibilityScope
  managerUserIds?: string[]
  memberAccess?: MemberAccessLevel | null
}

/** PUT /api/permissions/tables/:id 请求 */
export interface UpdateTablePermissionRequest {
  rowScope?: TableRowScope
  ownerColumnKey?: string | null
  memberAccess?: MemberAccessLevel | null
}

/** POST /api/shares 请求 */
export interface CreateShareRequest {
  targetType: ShareTargetType
  targetId: string
  expiresInDays?: number | null
  expiresAt?: string | null
  password?: string
}

/** POST /api/shares 响应 */
export interface CreateShareResponse {
  share: ShareRecord
}

/** GET /api/shares 响应 */
export interface ListSharesResponse {
  shares: ShareRecord[]
}

/** POST /api/shares/:id/revoke 响应 */
export interface RevokeShareResponse {
  share: ShareRecord
}

/** POST /api/s/:token/verify 请求 */
export interface VerifySharePasswordRequest {
  password: string
}

/** 免登录分享公共摘要 */
export interface ShareAccessSummary {
  id: string
  token: string
  targetType: ShareTargetType
  targetId: string
  targetName: string
  createdByName: string
  expiresAt: string | null
}

/** 需密码校验且尚未解锁时的响应 */
export interface ShareAccessLockedResponse {
  unlocked: false
  requiresPassword: true
  share: ShareAccessSummary
}

/** 已解锁访客访问响应（数据范围已按创建者权限实时裁剪） */
export interface ShareAccessUnlockedResponse {
  unlocked: true
  requiresPassword: boolean
  share: ShareAccessSummary
  capabilities: ResourceCapabilities
  app?: SmartApp
  view?: WorkspaceView
  views?: WorkspaceView[]
  table?: TableBundle
  tables?: TableBundle[]
}

export type ShareAccessResponse = ShareAccessLockedResponse | ShareAccessUnlockedResponse

/** POST /api/s/:token/verify 响应 */
export interface VerifySharePasswordResponse {
  ok: true
  accessToken: string
  access: ShareAccessUnlockedResponse
}

/** POST /api/s/:token/records 响应 */
export interface CreateShareEntryRecordResponse {
  record: SmartRecord
}
