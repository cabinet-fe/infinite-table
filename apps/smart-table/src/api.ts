// 智能表格前端 REST API 客户端

import type {
  AllTablesResponse,
  CreateRecordRequest,
  CreateTableRequest,
  TableBundle,
  UpdateTableMetaRequest,
} from './shared/api-types'
import type { SmartRecord, SmartTableMeta } from './shared/schema'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
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
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new ApiError(response.status, body?.message ?? `请求失败 (${response.status})`)
  }

  return (await response.json()) as T
}

export async function fetchAllTables(): Promise<TableBundle[]> {
  const data = await requestJson<AllTablesResponse>('/api/tables')
  return data.tables
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

export async function resetDemoSeed(): Promise<TableBundle[]> {
  const data = await requestJson<AllTablesResponse>('/api/reset-seed', {
    method: 'POST',
  })
  return data.tables
}
