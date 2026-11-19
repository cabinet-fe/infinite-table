// 多维数据台（DataDesk）前端 REST API 客户端：统一封装业务 CRUD、身份认证、权限配置、分享与访客接口及 401 会话失效处理

import type {
  AllAppsResponse,
  AllTablesResponse,
  AllViewsResponse,
  AuthSessionResponse,
  BatchImportRecordsRequest,
  BatchImportRecordsResponse,
  BatchImportRowError,
  CreateAppRequest,
  CreateAppResponse,
  CreateRecordRequest,
  CreateShareEntryRecordResponse,
  CreateShareRequest,
  CreateShareResponse,
  CreateTableRequest,
  CreateViewRequest,
  DemoAccountsResponse,
  ImportCommitRequest,
  KanbanMoveCardRequest,
  ListSharesResponse,
  LoginRequest,
  PermissionsOverviewResponse,
  ReorderAppsRequest,
  ReorderViewsRequest,
  RevokeShareResponse,
  ShareAccessResponse,
  TableBundle,
  UpdateAppPermissionRequest,
  UpdateAppRequest,
  UpdateTableMetaRequest,
  UpdateTablePermissionRequest,
  UpdateViewPermissionRequest,
  UpdateViewRequest,
  VerifySharePasswordRequest,
  VerifySharePasswordResponse,
} from './shared/api-types'
import type {
  DemoAccountInfo,
  ShareRecord,
  ShareTargetType,
  SmartApp,
  SmartRecord,
  SmartTableMeta,
  WorkspaceView,
} from './shared/schema'

export class ApiError extends Error {
  readonly status: number
  readonly errors?: BatchImportRowError[]
  readonly errorStatus?: string

  constructor(
    status: number,
    message: string,
    errors?: BatchImportRowError[],
    errorStatus?: string,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    if (errors !== undefined) {
      this.errors = errors
    }
    if (errorStatus !== undefined) {
      this.errorStatus = errorStatus
    }
  }
}

export interface RecordWriteContext {
  appId?: string
  viewId?: string
}

export type UnauthorizedHandler = (error: ApiError) => void

let activeUnauthorizedHandler: UnauthorizedHandler | null = null

/** 注册全局 401 会话失效处理器，返回注销函数 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): () => void {
  activeUnauthorizedHandler = handler
  return () => {
    if (activeUnauthorizedHandler === handler) {
      activeUnauthorizedHandler = null
    }
  }
}

interface RequestOptions {
  /** 跳过全局 401 会话失效通知（用于登录校验、启动会话探测与访客密码校验） */
  skipUnauthorizedNotify?: boolean
}

function buildWriteContextHeaders(
  context?: RecordWriteContext,
): Record<string, string> | undefined {
  if (!context?.appId && !context?.viewId) {
    return undefined
  }
  const extra: Record<string, string> = {}
  if (context.appId) extra['X-App-Id'] = context.appId
  if (context.viewId) extra['X-View-Id'] = context.viewId
  return extra
}

/** 非 2xx 响应统一映射 ApiError（优先取后端 {message, errors, status}） */
async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    message?: string
    errors?: BatchImportRowError[]
    status?: string
  } | null
  const errors = Array.isArray(body?.errors) ? body.errors : undefined
  const errorStatus = typeof body?.status === 'string' ? body.status : undefined
  return new ApiError(
    response.status,
    body?.message ?? `请求失败 (${response.status})`,
    errors,
    errorStatus,
  )
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  options?: RequestOptions,
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(url, {
    ...init,
    headers,
  })

  if (!response.ok) {
    const apiError = await toApiError(response)
    if (response.status === 401 && !options?.skipUnauthorizedNotify) {
      activeUnauthorizedHandler?.(apiError)
    }
    throw apiError
  }

  return (await response.json()) as T
}

// ---------------- 身份认证 ----------------

export async function login(payload: LoginRequest): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>(
    '/api/auth/login',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    { skipUnauthorizedNotify: true },
  )
}

export async function logout(): Promise<void> {
  await requestJson<{ ok: boolean }>(
    '/api/auth/logout',
    { method: 'POST' },
    { skipUnauthorizedNotify: true },
  )
}

export async function fetchMe(options?: RequestOptions): Promise<AuthSessionResponse> {
  return requestJson<AuthSessionResponse>('/api/auth/me', undefined, options)
}

export async function fetchDemoAccounts(): Promise<DemoAccountInfo[]> {
  const data = await requestJson<DemoAccountsResponse>('/api/auth/demo-accounts', undefined, {
    skipUnauthorizedNotify: true,
  })
  return data.accounts
}

// ---------------- 权限管理 ----------------

export async function fetchPermissions(): Promise<PermissionsOverviewResponse> {
  return requestJson<PermissionsOverviewResponse>('/api/permissions')
}

export async function updateAppPermissions(
  appId: string,
  payload: UpdateAppPermissionRequest,
): Promise<SmartApp> {
  const data = await requestJson<{ app: SmartApp }>(
    `/api/permissions/apps/${encodeURIComponent(appId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
  return data.app
}

export async function updateViewPermissions(
  viewId: string,
  payload: UpdateViewPermissionRequest,
): Promise<WorkspaceView> {
  const data = await requestJson<{ view: WorkspaceView }>(
    `/api/permissions/views/${encodeURIComponent(viewId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
  return data.view
}

export async function updateTablePermissions(
  tableId: string,
  payload: UpdateTablePermissionRequest,
): Promise<SmartTableMeta> {
  const data = await requestJson<{ meta: SmartTableMeta }>(
    `/api/permissions/tables/${encodeURIComponent(tableId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  )
  return data.meta
}

// ---------------- 分享管理与免登录访客访问 ----------------

export async function createShare(payload: CreateShareRequest): Promise<ShareRecord> {
  const data = await requestJson<CreateShareResponse>('/api/shares', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.share
}

export async function listShares(filter?: {
  targetType?: ShareTargetType
  targetId?: string
}): Promise<ShareRecord[]> {
  const params = new URLSearchParams()
  if (filter?.targetType) params.set('targetType', filter.targetType)
  if (filter?.targetId) params.set('targetId', filter.targetId)
  const qs = params.toString()
  const data = await requestJson<ListSharesResponse>(`/api/shares${qs ? `?${qs}` : ''}`)
  return data.shares
}

export async function revokeShare(shareId: string): Promise<ShareRecord> {
  const data = await requestJson<RevokeShareResponse>(
    `/api/shares/${encodeURIComponent(shareId)}/revoke`,
    {
      method: 'POST',
    },
  )
  return data.share
}

export async function fetchShareAccess(
  token: string,
  options?: { shareToken?: string },
): Promise<ShareAccessResponse> {
  const headers = options?.shareToken ? { 'X-Share-Token': options.shareToken } : undefined
  return requestJson<ShareAccessResponse>(
    `/api/s/${encodeURIComponent(token)}`,
    headers ? { headers } : undefined,
    { skipUnauthorizedNotify: true },
  )
}

export async function verifySharePassword(
  token: string,
  password: string,
): Promise<VerifySharePasswordResponse> {
  const body: VerifySharePasswordRequest = { password }
  return requestJson<VerifySharePasswordResponse>(
    `/api/s/${encodeURIComponent(token)}/verify`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    { skipUnauthorizedNotify: true },
  )
}

export async function submitShareEntryRecord(
  token: string,
  record: CreateRecordRequest['record'],
  options?: { shareToken?: string },
): Promise<SmartRecord> {
  const headers = options?.shareToken ? { 'X-Share-Token': options.shareToken } : undefined
  const data = await requestJson<CreateShareEntryRecordResponse>(
    `/api/s/${encodeURIComponent(token)}/records`,
    {
      method: 'POST',
      ...(headers ? { headers } : {}),
      body: JSON.stringify({ record }),
    },
    { skipUnauthorizedNotify: true },
  )
  return data.record
}

// ---------------- 数据源表与记录 ----------------

export async function fetchAllTables(): Promise<TableBundle[]> {
  const data = await requestJson<AllTablesResponse>('/api/tables')
  return data.tables
}

export async function fetchTableBundle(tableId: string): Promise<TableBundle> {
  return requestJson<TableBundle>(`/api/tables/${encodeURIComponent(tableId)}`)
}

export async function createTable(payload: CreateTableRequest): Promise<TableBundle> {
  return requestJson<TableBundle>('/api/tables', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateTableMeta(
  tableId: string,
  meta: SmartTableMeta,
): Promise<SmartTableMeta> {
  const body: UpdateTableMetaRequest = { meta }
  const data = await requestJson<{ meta: SmartTableMeta }>(
    `/api/tables/${encodeURIComponent(tableId)}/meta`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    },
  )
  return data.meta
}

export async function deleteTable(tableId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/tables/${encodeURIComponent(tableId)}`, {
    method: 'DELETE',
  })
}

export async function syncTable(tableId: string): Promise<TableBundle> {
  return requestJson<TableBundle>(`/api/tables/${encodeURIComponent(tableId)}/sync`, {
    method: 'POST',
  })
}

export async function createRecord(
  tableId: string,
  record: CreateRecordRequest['record'],
  context?: RecordWriteContext,
): Promise<SmartRecord> {
  const headers = buildWriteContextHeaders(context)
  const data = await requestJson<{ record: SmartRecord }>(
    `/api/tables/${encodeURIComponent(tableId)}/records`,
    {
      method: 'POST',
      ...(headers ? { headers } : {}),
      body: JSON.stringify({ record }),
    },
  )
  return data.record
}

export async function batchAppendRecords(
  tableId: string,
  records: Record<string, unknown>[],
  context?: RecordWriteContext,
): Promise<BatchImportRecordsResponse> {
  const headers = buildWriteContextHeaders(context)
  const body: BatchImportRecordsRequest = { records }
  return requestJson<BatchImportRecordsResponse>(
    `/api/tables/${encodeURIComponent(tableId)}/records/batch`,
    {
      method: 'POST',
      ...(headers ? { headers } : {}),
      body: JSON.stringify(body),
    },
  )
}

export async function updateRecord(
  tableId: string,
  recordId: string,
  patch: Record<string, unknown>,
  context?: RecordWriteContext,
): Promise<SmartRecord> {
  const headers = buildWriteContextHeaders(context)
  const data = await requestJson<{ record: SmartRecord }>(
    `/api/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: 'PATCH',
      ...(headers ? { headers } : {}),
      body: JSON.stringify({ patch }),
    },
  )
  return data.record
}

export async function deleteRecord(
  tableId: string,
  recordId: string,
  context?: RecordWriteContext,
): Promise<void> {
  const headers = buildWriteContextHeaders(context)
  await requestJson<{ ok: boolean }>(
    `/api/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: 'DELETE',
      ...(headers ? { headers } : {}),
    },
  )
}

// ---------------- 多维数据台与应用视图 ----------------

export async function fetchAllApps(): Promise<SmartApp[]> {
  const data = await requestJson<AllAppsResponse>('/api/apps')
  return data.apps
}

export async function createSmartApp(payload: CreateAppRequest): Promise<CreateAppResponse> {
  return requestJson<CreateAppResponse>('/api/apps', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateSmartApp(appId: string, patch: UpdateAppRequest): Promise<SmartApp> {
  const data = await requestJson<{ app: SmartApp }>(`/api/apps/${encodeURIComponent(appId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.app
}

export async function reorderSmartApps(appIds: string[]): Promise<SmartApp[]> {
  const body: ReorderAppsRequest = { appIds }
  const data = await requestJson<AllAppsResponse>('/api/apps/reorder', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return data.apps
}

export async function deleteSmartApp(appId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/apps/${encodeURIComponent(appId)}`, {
    method: 'DELETE',
  })
}

export async function fetchAllViews(): Promise<WorkspaceView[]> {
  const data = await requestJson<AllViewsResponse>('/api/views')
  return data.views
}

export async function fetchWorkspaceView(viewId: string): Promise<WorkspaceView> {
  const data = await requestJson<{ view: WorkspaceView }>(
    `/api/views/${encodeURIComponent(viewId)}`,
  )
  return data.view
}

export async function createWorkspaceView(payload: CreateViewRequest): Promise<WorkspaceView> {
  const data = await requestJson<{ view: WorkspaceView }>('/api/views', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return data.view
}

export async function updateWorkspaceView(
  viewId: string,
  patch: UpdateViewRequest,
): Promise<WorkspaceView> {
  const data = await requestJson<{ view: WorkspaceView }>(
    `/api/views/${encodeURIComponent(viewId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  )
  return data.view
}

export async function reorderWorkspaceViews(viewIds: string[]): Promise<WorkspaceView[]> {
  const body: ReorderViewsRequest = { viewIds }
  const data = await requestJson<AllViewsResponse>('/api/views/reorder', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return data.views
}

export async function deleteWorkspaceView(viewId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(`/api/views/${encodeURIComponent(viewId)}`, {
    method: 'DELETE',
  })
}

export async function moveKanbanCard(
  viewId: string,
  recordId: string,
  payload: KanbanMoveCardRequest,
): Promise<SmartRecord> {
  const data = await requestJson<{ record: SmartRecord }>(
    `/api/views/${encodeURIComponent(viewId)}/kanban/cards/${encodeURIComponent(recordId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    },
  )
  return data.record
}

export async function resetDemoSeed(): Promise<TableBundle[]> {
  const data = await requestJson<AllTablesResponse>('/api/reset-seed', {
    method: 'POST',
  })
  return data.tables
}

export async function resetDemoSeedWorkspace(): Promise<{
  tables: TableBundle[]
  apps: SmartApp[]
  views: WorkspaceView[]
}> {
  const data = await requestJson<AllTablesResponse>('/api/reset-seed', {
    method: 'POST',
  })
  return { tables: data.tables, apps: data.apps ?? [], views: data.views ?? [] }
}

/** 进阶导入提交（SQL 物理表）：文件解析在前端完成，这里只提交列配置与行数据 */
export async function importCommit(payload: ImportCommitRequest): Promise<TableBundle> {
  return requestJson<TableBundle>('/api/import/commit', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
