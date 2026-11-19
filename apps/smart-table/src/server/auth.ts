// 服务端认证与会话存储：scryptSync + timingSafeEqual 密码校验、安全随机 Token、HttpOnly Cookie 会话与内置演示账号。

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import type { AuthUser, DemoAccountInfo, UserRole } from '../shared/schema'

export const SESSION_COOKIE_NAME = 'st_session'
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
const SCRYPT_KEY_LENGTH = 64

export interface BuiltinDemoUserSpec extends DemoAccountInfo {
  id: string
  avatarColor: string
}

export const BUILTIN_DEMO_USERS: readonly BuiltinDemoUserSpec[] = [
  {
    id: 'usr_admin',
    username: 'admin',
    password: 'admin123',
    displayName: '系统管理员',
    role: 'admin',
    avatarColor: '#4f46e5',
    description: '拥有全空间数据源、应用配置、权限分配与全量分享链接管理权限',
  },
  {
    id: 'usr_mgr_lisi',
    username: 'manager',
    password: 'manager123',
    displayName: '李四',
    role: 'manager',
    avatarColor: '#0284c7',
    description: '华北销售部负责人，匹配业务姓名「李四」，可配置本人负责应用与管理个人分享',
  },
  {
    id: 'usr_mgr_wangwu',
    username: 'wangwu',
    password: 'manager123',
    displayName: '王五',
    role: 'manager',
    avatarColor: '#0d9488',
    description: '华南销售部负责人，匹配业务姓名「王五」，用于演示多负责人可见与行级隔离',
  },
  {
    id: 'usr_member_qianqi',
    username: 'member',
    password: 'member123',
    displayName: '钱七',
    role: 'member',
    avatarColor: '#64748b',
    description: '普通成员，匹配业务姓名「钱七」，按资源只读/可编辑授权与行级范围访问数据',
  },
]

interface UserRow {
  id: string
  username: string
  password_hash: string
  display_name: string
  role: UserRole
  avatar_color: string
  created_at: string
}

interface SessionJoinRow extends UserRow {
  session_id: string
  expires_at: string
}

export interface ActiveSession {
  sessionId: string
  user: AuthUser
  expiresAt: string
}

const demoPasswordHashCache = new Map<string, string>()

function getCachedDemoPasswordHash(password: string): string {
  const existing = demoPasswordHashCache.get(password)
  if (existing) return existing
  const computed = hashPassword(password)
  demoPasswordHashCache.set(password, computed)
  return computed
}

/** 使用 scryptSync + 随机盐生成安全密码哈希（格式：scrypt$<saltHex>$<hashHex>） */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH)
  return `scrypt$${salt}$${derived.toString('hex')}`
}

/** 使用 timingSafeEqual 校验明文密码与存储哈希 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false
  }
  const salt = parts[1]
  const hashHex = parts[2]
  if (!salt || !hashHex || !/^[0-9a-f]+$/i.test(hashHex)) {
    return false
  }
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.byteLength !== SCRYPT_KEY_LENGTH) {
    return false
  }
  const actual = scryptSync(password, salt, SCRYPT_KEY_LENGTH)
  if (actual.byteLength !== expected.byteLength) {
    return false
  }
  return timingSafeEqual(actual, expected)
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function toSafeAuthUser(
  row: Pick<UserRow, 'id' | 'username' | 'display_name' | 'role' | 'avatar_color' | 'created_at'>,
): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  }
}

/** 幂等初始化内置演示账号（仅在缺失时插入，不覆盖既有用户记录） */
export function ensureBuiltinDemoUsers(db: Database): void {
  const now = new Date().toISOString()
  const stmt = db.query(
    'INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  for (const spec of BUILTIN_DEMO_USERS) {
    stmt.run(
      spec.id,
      spec.username,
      getCachedDemoPasswordHash(spec.password),
      spec.displayName,
      spec.role,
      spec.avatarColor,
      now,
    )
  }
}

/** 重置演示数据时恢复内置演示账号信息，同时保留既有 userId 以免级联中断当前管理员会话 */
export function restoreBuiltinDemoUsers(db: Database): void {
  const now = new Date().toISOString()
  const upsert = db.query(`
    INSERT INTO users (id, username, password_hash, display_name, role, avatar_color, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      password_hash = excluded.password_hash,
      display_name = excluded.display_name,
      role = excluded.role,
      avatar_color = excluded.avatar_color
  `)
  for (const spec of BUILTIN_DEMO_USERS) {
    upsert.run(
      spec.id,
      spec.username,
      getCachedDemoPasswordHash(spec.password),
      spec.displayName,
      spec.role,
      spec.avatarColor,
      now,
    )
  }
}

/** 返回登录页演示账号列表 */
export function getDemoAccounts(): DemoAccountInfo[] {
  return BUILTIN_DEMO_USERS.map((item) => ({
    username: item.username,
    password: item.password,
    displayName: item.displayName,
    role: item.role,
    description: item.description,
  }))
}

/** 列出全部用户（安全公开信息，不含 passwordHash） */
export function listUsers(db: Database): AuthUser[] {
  const rows = db
    .query(
      'SELECT id, username, display_name, role, avatar_color, created_at FROM users ORDER BY rowid ASC',
    )
    .all() as Omit<UserRow, 'password_hash'>[]
  return rows.map(toSafeAuthUser)
}

/** 按 userId 获取用户公开信息 */
export function getUserById(db: Database, userId: string): AuthUser | null {
  const row = db
    .query(
      'SELECT id, username, display_name, role, avatar_color, created_at FROM users WHERE id = ?',
    )
    .get(userId) as Omit<UserRow, 'password_hash'> | undefined | null
  return row ? toSafeAuthUser(row) : null
}

/** 校验用户名密码并返回安全用户信息 */
export function authenticateUser(
  db: Database,
  username: string,
  password: string,
): AuthUser | null {
  const trimmed = username.trim()
  if (trimmed === '' || password === '') {
    return null
  }
  const row = db
    .query(
      'SELECT id, username, password_hash, display_name, role, avatar_color, created_at FROM users WHERE username = ?',
    )
    .get(trimmed) as UserRow | undefined | null
  if (!row) return null
  if (!verifyPassword(password, row.password_hash)) {
    return null
  }
  return toSafeAuthUser(row)
}

/** 清理已过期会话 */
export function purgeExpiredSessions(db: Database, now: Date = new Date()): void {
  db.query('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString())
}

/** 创建持久化会话并返回原始安全随机 Token 与到期时间 */
export function createSession(
  db: Database,
  userId: string,
  options?: { ttlSeconds?: number; now?: Date },
): { token: string; expiresAt: string } {
  const now = options?.now ?? new Date()
  purgeExpiredSessions(db, now)

  const ttlSeconds = options?.ttlSeconds ?? SESSION_TTL_SECONDS
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString()
  const token = randomBytes(32).toString('base64url')
  const sessionId = `sess_${randomBytes(12).toString('hex')}`

  db.query(
    'INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, hashSessionToken(token), userId, expiresAt, now.toISOString())

  return { token, expiresAt }
}

/** 按会话 Token 解析当前活跃会话；若已过期则自动清理并返回 null */
export function resolveSessionByToken(
  db: Database,
  token: string | null | undefined,
  now: Date = new Date(),
): ActiveSession | null {
  if (!token || token.trim() === '') return null
  const tokenHash = hashSessionToken(token)
  const row = db
    .query(`
      SELECT
        s.id AS session_id,
        s.expires_at AS expires_at,
        u.id AS id,
        u.username AS username,
        u.display_name AS display_name,
        u.role AS role,
        u.avatar_color AS avatar_color,
        u.created_at AS created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `)
    .get(tokenHash) as SessionJoinRow | undefined | null

  if (!row) return null

  const nowIso = now.toISOString()
  if (row.expires_at <= nowIso) {
    purgeExpiredSessions(db, now)
    return null
  }

  return {
    sessionId: row.session_id,
    user: toSafeAuthUser(row),
    expiresAt: row.expires_at,
  }
}

/** 销毁指定会话 Token */
export function deleteSessionByToken(db: Database, token: string | null | undefined): void {
  if (!token || token.trim() === '') return
  db.query('DELETE FROM sessions WHERE token_hash = ?').run(hashSessionToken(token))
}

/** 解析 HTTP Cookie 请求头 */
export function parseCookieHeader(cookieHeader: string | null | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!cookieHeader) return map
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=')
    if (eqIndex <= 0) continue
    const name = part.slice(0, eqIndex).trim()
    const rawValue = part.slice(eqIndex + 1).trim()
    if (!name) continue
    try {
      map.set(name, decodeURIComponent(rawValue))
    } catch {
      map.set(name, rawValue)
    }
  }
  return map
}

export function buildCookieAttributeString(
  name: string,
  value: string,
  options: { maxAge: number; path?: string; isSecure?: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAge}`,
  ]
  if (options.isSecure) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

export function buildSessionCookieHeader(token: string, isSecure = false): string {
  return buildCookieAttributeString(SESSION_COOKIE_NAME, token, {
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
    isSecure,
  })
}

export function buildClearSessionCookieHeader(isSecure = false): string {
  return buildCookieAttributeString(SESSION_COOKIE_NAME, '', {
    maxAge: 0,
    path: '/',
    isSecure,
  })
}
