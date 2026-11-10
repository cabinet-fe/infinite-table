// 库表行类型：字段口径与 db.ts 建表列一一对应（JSON 接口原样透出行）。
// 数据源/数据集行类型与前端共用，单源定义在 shared/api-types.ts（经 re-export 保持
// 既有 import 路径不变；服务端 DatasetRow 即存储口径的 StorageDatasetRow——fields 为
// JSON 文本，REST 视图的解析口径见 ApiDatasetRow）。

export type { DatasourceRow, DatasetField } from '../shared/api-types'
export type { StorageDatasetRow as DatasetRow } from '../shared/api-types'

export interface TemplateRow {
  id: string
  name: string
  /** 模板文档 JSON 文本（FormTemplate 去掉 name 后原样序列化） */
  template: string
  created_at: string
}
