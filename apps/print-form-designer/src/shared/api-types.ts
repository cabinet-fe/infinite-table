// REST 行类型契约层：server 库表行/路由视图与前端 api 客户端共用同一份类型。
// 零 React/DOM、零网络、零运行时副作用——server 与前端 data 层都从这里 import。

/** 数据源行（datasource 表 / `/api/datasources` 记录；字段口径与建表列一一对应） */
export interface DatasourceRow {
  id: string
  name: string
  type: string
  /** SQLite 文件绝对路径 */
  path: string
  created_at: string
}

/** 数据集字段命名条目：name = SQL 原始列名，alias 留空即用原名（仅展示用，绑定仍存原名） */
export interface DatasetField {
  name: string
  alias?: string
}

/**
 * 数据集行有两种**有意分叉**的口径（此前在 server/rows.ts 与 data/api.ts 双份手工维护）：
 * - StorageDatasetRow：服务端库表行，fields 列存 `DatasetField[]` 序列化的 JSON 文本；
 * - ApiDatasetRow：REST/前端记录视图，fields 已解析为字段命名数组（server/rows.ts 的
 *   `DatasetRow` 与 data/api.ts 的 `DatasetRow` 分别对应这两者，经 re-export 保名）。
 */
export interface StorageDatasetRow {
  id: string
  datasource_id: string
  name: string
  sql: string
  /** 字段命名 JSON 文本（DatasetField[] 序列化；'[]' = 未命名） */
  fields: string
  created_at: string
}

/** 数据集行的 REST/前端记录视图：fields 由 JSON 文本解析为数组透出 */
export interface ApiDatasetRow {
  id: string
  datasource_id: string
  name: string
  sql: string
  fields: DatasetField[]
  created_at: string
}

/** 数据集创建/保存请求体（fields 可选：PUT 不带 = 保留已存命名；server 路由校验与前端表单共用） */
export interface DatasetInput {
  name: string
  datasource_id: string
  sql: string
  fields?: DatasetField[]
}

/** SQL 执行结果：原始列名 + 原始行（行是按列序的值数组），服务端不做任何重塑 */
export interface QueryResult {
  columns: string[]
  rows: unknown[][]
}
