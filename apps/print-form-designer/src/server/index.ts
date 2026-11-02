// 后端入口：装配 Hono 应用（三组资源路由骨架挂 /api）并经 Bun.serve 启动。
// 直接执行时监听 PORT（默认 8787），数据库路径见 db.ts。
import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { openDatabase, resolveDbPath } from './db'
import { mountResourceRoutes } from './routes'

export function createApp(db: Database): Hono {
  const app = new Hono()
  mountResourceRoutes(app, db)
  return app
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787)
  const dbPath = resolveDbPath()
  Bun.serve({ port, fetch: createApp(openDatabase(dbPath)).fetch })
  console.log(`print-form-designer 后端已启动 http://localhost:${port}（数据库：${dbPath}）`)
}
