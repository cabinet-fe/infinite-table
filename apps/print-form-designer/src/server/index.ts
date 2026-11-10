// 后端入口：装配 Hono 应用（数据源/数据集/模板三组 REST 齐备）并经 Bun.serve 启动。
// 直接执行时监听 PORT（默认 8787），数据库路径见 db.ts，启动即幂等内置 seed 演练库。
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { openDatabase, resolveDbPath } from './db'
import { mountResourceRoutes } from './routes'
import { registerSqliteDataSource } from './sqlite-datasource'
import { DEFAULT_DEMO_PATH, seedDemoLibrary } from './seed'

export function createApp(db: Database): Hono {
  registerSqliteDataSource()
  const app = new Hono()
  // 未捕获异常兜底：统一回 500 + { message } JSON（与 400/404/422 的错误形状一致；
  // message 取异常文案、缺省「服务器内部错误」，不带堆栈）
  app.onError((error, c) => c.json({ message: error.message || '服务器内部错误' }, 500))
  mountResourceRoutes(app, db)
  return app
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787)
  const dbPath = resolveDbPath()
  const db = openDatabase(dbPath)
  seedDemoLibrary(db, { demoPath: DEFAULT_DEMO_PATH })
  Bun.serve({ port, fetch: createApp(db).fetch })
  console.log(
    `print-form-designer 后端已启动 http://localhost:${port}（数据库：${dbPath}，已内置 seed 演练库）`,
  )
}
