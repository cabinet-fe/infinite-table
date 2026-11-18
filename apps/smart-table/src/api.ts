// 智能表格前端 REST API 客户端

import type {
  AllAppsResponse,
  AllTablesResponse,
  AllViewsResponse,
  BatchImportRecordsRequest,
  BatchImportRecordsResponse,
  BatchImportRowError,
  CreateAppRequest,
  CreateAppResponse,
  CreateRecordRequest,
  CreateTableRequest,
  CreateViewRequest,
  ImportCommitRequest,
  KanbanMoveCardRequest,
  ReorderAppsRequest,
  ReorderViewsRequest,
  TableBundle,
  UpdateAppRequest,
  UpdateTableMetaRequest,
  UpdateViewRequest,
} from './shared/api-types'
import type { SmartApp, SmartRecord, SmartTableMeta, WorkspaceView } from './shared/schema'

export class ApiError extends Error {
  readonly status: number
  readonly errors?: BatchImportRowError[]

  constructor(status: number, message: string, errors?: BatchImportRowError[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    if (errors !== undefined) {
      this.errors = errors
    }
  }
}

/** 非 2xx 响应统一映射 ApiError（优先取后端 {message, errors}） */
async function toApiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    message?: string
    errors?: BatchImportRowError[]
  } | null
  const errors = Array.isArray(body?.errors) ? body.errors : undefined
  return new ApiError(response.status, body?.message ?? `请求失败 (${response.status})`, errors)
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(url, {
    ...init,
    headers,
  })

  if (!response.ok) {
    throw await toApiError(response)
  }

  return (await response.json()) as T
}

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
): Promise<SmartRecord> {
  const data = await requestJson<{ record: SmartRecord }>(
    `/api/tables/${encodeURIComponent(tableId)}/records`,
    {
      method: 'POST',
      body: JSON.stringify({ record }),
    },
  )
  return data.record
}

export async function batchAppendRecords(
  tableId: string,
  records: Record<string, unknown>[],
): Promise<BatchImportRecordsResponse> {
  const body: BatchImportRecordsRequest = { records }
  return requestJson<BatchImportRecordsResponse>(
    `/api/tables/${encodeURIComponent(tableId)}/records/batch`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  )
}

export async function updateRecord(
  tableId: string,
  recordId: string,
  patch: Record<string, unknown>,
): Promise<SmartRecord> {
  const data = await requestJson<{ record: SmartRecord }>(
    `/api/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ patch }),
    },
  )
  return data.record
}

export async function deleteRecord(tableId: string, recordId: string): Promise<void> {
  await requestJson<{ ok: boolean }>(
    `/api/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: 'DELETE',
    },
  )
}

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
