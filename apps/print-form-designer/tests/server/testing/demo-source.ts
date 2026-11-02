// 测试夹具：临时目录里建一个带 item 表与样例行的 SQLite 文件，充当数据源指向的库。
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Database } from 'bun:sqlite'

export function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pfd-test-'))
}

export function createDemoSqliteFile(dir: string): string {
  const path = join(dir, 'source.sqlite')
  const db = new Database(path)
  db.exec(
    'CREATE TABLE item (name TEXT, qty INTEGER, unit_price REAL);' +
      "INSERT INTO item VALUES ('棉布', 12, 8.5), ('涤纶', 30, 3.2)",
  )
  db.close()
  return path
}
