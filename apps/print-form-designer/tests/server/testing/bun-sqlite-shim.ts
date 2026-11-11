// bun:sqlite → node:sqlite 适配 shim：仅在 vitest 运行时经根 vite.config.ts 的
// test.alias 生效（print-form-designer 的服务端测试在 node 环境跑）；生产 dev:server
// 仍在 Bun 下走真 bun:sqlite，两条路径不该碰面。类型层不动——src/tests 里的
// `import { Database } from 'bun:sqlite'` 依旧由 @types/bun 提供类型，本文件只对齐运行时形状。
//
// 适配面（src/server 7 文件 + tests/server 3 文件的全部用法）：
// - new Database(path) / new Database(path, { readonly: true })：node:sqlite 的选项键是
//   readOnly（大写 O），':memory:' 两边都原生支持
// - db.query(sql)：bun 侧带语句缓存，这里退化为 prepare 的别名（每次现做，语义等价）
// - db.prepare(sql) / db.exec(sql) / db.close()：node:sqlite 同名同形
// - stmt.get/all/run(...params)：node:sqlite 位置参数同形，直接透传
// - stmt.values() / stmt.columnNames：node:sqlite 没有，按 columns() 的结果集列序从
//   对象行还原值数组（重名列时对象键会塌缩——应用侧查询无重名列，不做防御）
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'

/** 语句适配器：覆盖 bun:sqlite Statement 在本仓的使用面（get/all/run/values/columnNames） */
class Statement {
  private readonly stmt: StatementSync

  constructor(stmt: StatementSync) {
    this.stmt = stmt
  }

  get(...params: SQLInputValue[]): unknown {
    return this.stmt.get(...params)
  }

  all(...params: SQLInputValue[]): unknown[] {
    return this.stmt.all(...params)
  }

  run(...params: SQLInputValue[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.stmt.run(...params)
  }

  /** bun 的行值数组直出：node:sqlite 只回对象行，按列序从对象行还原 */
  values(...params: SQLInputValue[]): unknown[][] {
    const names = this.stmt.columns().map((column) => column.name)
    const rows = this.stmt.all(...params) as Record<string, unknown>[]
    return rows.map((row) => names.map((name) => row[name]))
  }

  /** bun 的结果集列名（node:sqlite 的 columns() 元数据 name 字段，即别名后的列名） */
  get columnNames(): string[] {
    return this.stmt.columns().map((column) => column.name)
  }
}

/** 数据库适配器：覆盖 bun:sqlite Database 在本仓的使用面（query/prepare/exec/close） */
export class Database {
  private readonly db: DatabaseSync

  constructor(path: string, options?: { readonly?: boolean }) {
    // node:sqlite 对显式 undefined 的 options 参数会抛「must be an object」，需按实参个数调用
    this.db = options?.readonly
      ? new DatabaseSync(path, { readOnly: true })
      : new DatabaseSync(path)
  }

  query(sql: string): Statement {
    return new Statement(this.db.prepare(sql))
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql))
  }

  exec(sql: string): void {
    this.db.exec(sql)
  }

  close(): void {
    this.db.close()
  }
}
