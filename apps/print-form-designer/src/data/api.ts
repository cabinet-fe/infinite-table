// 数据管理侧 API 客户端：统一 fetch 包装；行/执行结果类型字段口径与后端库表一致（snake_case 原样透出）。
// 行类型与 server 共用，单源定义在 shared/api-types.ts（经 re-export 保持既有 import 路径不变）。
import type { FormTemplate } from '../shared/template-schema'
import type { SourceRow } from '../transform/reshape'
import {
  type ApiDatasetRow,
  type DatasetField,
  type DatasetInput,
  type DatasourceRow,
  type QueryResult,
} from '../shared/api-types'

export type {
  DatasetField,
  DatasetInput,
  DatasourceRow,
  QueryResult,
  ApiDatasetRow as DatasetRow,
} from '../shared/api-types'

/** 取字段结果：SQL 原始列名 + 前几行样例（列名 → 值） */
export interface DatasetFieldSample {
  fields: string[]
  sample: Record<string, unknown>[]
}

/** 字段显示名：别名优先，无别名/纯空白别名用原名（展示位共用；存储与绑定一律用原名） */
export function datasetFieldLabel(fields: DatasetField[] | undefined, name: string): string {
  const alias = fields?.find((field) => field.name === name)?.alias
  return alias !== undefined && alias.trim() !== '' ? alias : name
}

/** SQL 执行结果 → 数据集原始行（列名 → 值），重塑管线的入参形态（绑定编辑/打印共用） */
export function toSourceRows(result: QueryResult): SourceRow[] {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, index) => [col, row[index]])),
  )
}

/** 模板清单项（列表路由摘要，不含模板文档） */
export interface TemplateSummary {
  id: string
  name: string
  created_at: string
}

/** 模板完整记录（读取/创建/更新视图：template 为回填 name 后的完整模板 JSON） */
export interface TemplateRecord extends TemplateSummary {
  template: FormTemplate
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

  listDatasets: () => request<ApiDatasetRow[]>('/api/datasets'),
  createDataset: (body: DatasetInput) =>
    request<ApiDatasetRow>('/api/datasets', jsonInit('POST', body)),
  updateDataset: (id: string, body: DatasetInput) =>
    request<ApiDatasetRow>(`/api/datasets/${id}`, jsonInit('PUT', body)),
  deleteDataset: (id: string) => request<void>(`/api/datasets/${id}`, { method: 'DELETE' }),
  executeDataset: (id: string) =>
    request<QueryResult>(`/api/datasets/${id}/execute`, { method: 'POST' }),
  fetchDatasetFields: (id: string) =>
    request<DatasetFieldSample>(`/api/datasets/${id}/fields`, { method: 'POST' }),

  listTemplates: () => request<TemplateSummary[]>('/api/templates'),
  createTemplate: (template: FormTemplate) =>
    request<TemplateRecord>('/api/templates', jsonInit('POST', template)),
  getTemplate: (id: string) => request<TemplateRecord>(`/api/templates/${id}`),
  updateTemplate: (id: string, template: FormTemplate) =>
    request<TemplateRecord>(`/api/templates/${id}`, jsonInit('PUT', template)),
  deleteTemplate: (id: string) => request<void>(`/api/templates/${id}`, { method: 'DELETE' }),
}
