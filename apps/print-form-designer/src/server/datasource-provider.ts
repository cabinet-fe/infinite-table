// 非 SQLite 数据源概念接口（MySQL/PostgreSQL 等未来接入点）：本阶段只留类型与注册点，不做任何实现。
// 新数据源实现 DataSourceProvider 并经 registerDataSourceProvider 注册后，即可按 kind 被发现。
export type DataSourceKind = string

/** 数据源配置的开放结构：各源自定义字段（sqlite 为文件路径） */
export type DataSourceConfig = Record<string, unknown>

export interface DataSourceProvider {
  readonly kind: DataSourceKind
  /** 用给定配置测试连通性；失败以异常抛出 */
  testConnection(config: DataSourceConfig): Promise<void>
  /** 执行 SQL 返回原始行；不做服务端重塑（重塑在前端转换管线） */
  execute(config: DataSourceConfig, sql: string): Promise<Record<string, unknown>[]>
}

const providers = new Map<DataSourceKind, DataSourceProvider>()

export function registerDataSourceProvider(provider: DataSourceProvider): void {
  providers.set(provider.kind, provider)
}

export function getDataSourceProvider(kind: DataSourceKind): DataSourceProvider | undefined {
  return providers.get(kind)
}
