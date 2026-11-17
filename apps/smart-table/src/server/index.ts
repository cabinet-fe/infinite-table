// 后端入口：装配 Hono 应用并在直接执行时通过 Bun.serve 监听端口（默认 8788）。
import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { openDatabase, resolveDbPath } from './db'
import { mountSmartTableRoutes } from './routes'
import { ensureSeeded } from './seed'

export function createApp(db: Database): Hono {
  const app = new Hono()
  app.onError((error, c) => c.json({ message: error.message || '服务器内部错误' }, 500))
  mountSmartTableRoutes(app, db)
  return app
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8788)
  const dbPath = resolveDbPath()
  const db = openDatabase(dbPath)
  // 空库播种 / 旧种子自愈重种（有用户自建表时不动，见 ensureSeeded）
  ensureSeeded(db)
  Bun.serve({ port, fetch: createApp(db).fetch })
  console.log(
    `smart-table 后端已启动 http://localhost:${port}（数据库：${dbPath}，已内置六表联动演示数据）`,
  )
}
