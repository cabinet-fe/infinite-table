// 库表行类型：字段口径与 db.ts 建表列一一对应（JSON 接口原样透出行）。

export interface DatasourceRow {
  id: string
  name: string
  type: string
  /** SQLite 文件绝对路径 */
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

export interface TemplateRow {
  id: string
  name: string
  /** 模板文档 JSON 文本（FormTemplate 去掉 name 后原样序列化） */
  bands: string
  created_at: string
}
