// 前后端 REST 接口请求/响应契约

import type {
  SmartRecord,
  SmartTableMeta,
  SmartView,
  SmartViewType,
  TableKind,
  WorkspaceView,
} from './schema'

export interface TableBundle {
  meta: SmartTableMeta
  records: SmartRecord[]
}

export interface AllTablesResponse {
  tables: TableBundle[]
  views?: WorkspaceView[]
}

export interface AllViewsResponse {
  views: WorkspaceView[]
}

export interface CreateViewRequest {
  name: string
  type: SmartViewType
  tableId: string
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
