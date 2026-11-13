// 前后端 REST 接口请求/响应契约

import type { SmartRecord, SmartTableMeta } from './schema'

export interface TableBundle {
  meta: SmartTableMeta
  records: SmartRecord[]
}

export interface AllTablesResponse {
  tables: TableBundle[]
}

export interface CreateTableRequest {
  name: string
  description?: string
  columns?: SmartTableMeta['columns']
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
