// 数据管理侧 API 客户端：统一 fetch 包装；行/执行结果类型字段口径与后端库表一致（snake_case 原样透出）。
export interface DatasourceRow {
  id: string
  name: string
  type: string
  path: string
  created_at: string
}

export interface DatasetRow {
  id: string
  datasource_id: string
  name: string
  sql: string
  created_at: string
}

/** 数据集创建/保存请求体 */
export interface DatasetInput {
  name: string
  datasource_id: string
  sql: string
}

/** SQL 执行结果：原始列名 + 原始行（服务端不做任何重塑） */
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `请求失败（${res.status}）`)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listDatasources: () => request<DatasourceRow[]>('/api/datasources'),
  createDatasource: (body: { name: string; type: string; path: string }) =>
    request<DatasourceRow>('/api/datasources', jsonInit('POST', body)),
  deleteDatasource: (id: string) => request<void>(`/api/datasources/${id}`, { method: 'DELETE' }),

  listDatasets: () => request<DatasetRow[]>('/api/datasets'),
  createDataset: (body: DatasetInput) =>
    request<DatasetRow>('/api/datasets', jsonInit('POST', body)),
  updateDataset: (id: string, body: DatasetInput) =>
    request<DatasetRow>(`/api/datasets/${id}`, jsonInit('PUT', body)),
  deleteDataset: (id: string) => request<void>(`/api/datasets/${id}`, { method: 'DELETE' }),
  executeDataset: (id: string) =>
    request<QueryResult>(`/api/datasets/${id}/execute`, { method: 'POST' }),
}
