// 服务端测试用认证与会话辅助（登录提取 Cookie 与自动携参请求封装）。
import type { Hono } from 'hono'
import type { AuthSessionResponse } from '../../../src/shared/api-types'
import type { AuthUser } from '../../../src/shared/schema'

export interface AuthedClient {
  request: (path: string, init?: RequestInit) => Promise<Response>
}

export function extractCookiePair(res: Response, cookieName: string): string {
  const raw = res.headers.get('set-cookie') ?? ''
  const pattern = new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`)
  const match = pattern.exec(raw)
  if (!match) {
    throw new Error(`响应缺少 Cookie: ${cookieName} (set-cookie=${raw})`)
  }
  return `${cookieName}=${match[1]}`
}

export function mergeCookieHeader(headers: HeadersInit | undefined, cookiePair: string): Headers {
  const merged = new Headers(headers)
  const existing = merged.get('Cookie')
  if (existing && existing.trim() !== '') {
    merged.set('Cookie', `${existing}; ${cookiePair}`)
  } else {
    merged.set('Cookie', cookiePair)
  }
  return merged
}

export async function loginAs(
  app: Hono,
  username: string,
  password: string,
): Promise<{ cookie: string; user: AuthUser; res: Response }> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (res.status !== 200) {
    throw new Error(`测试登录失败 (${username}): HTTP ${res.status}`)
  }
  const cookie = extractCookiePair(res, 'st_session')
  const body = (await res.json()) as AuthSessionResponse
  return { cookie, user: body.user, res }
}

export function loginAsAdmin(app: Hono) {
  return loginAs(app, 'admin', 'admin123')
}

export function loginAsManager(app: Hono, username: 'manager' | 'wangwu' = 'manager') {
  return loginAs(app, username, 'manager123')
}

export function loginAsMember(app: Hono) {
  return loginAs(app, 'member', 'member123')
}

export function createAuthedClient(app: Hono, cookie: string): AuthedClient {
  return {
    request: (path, init) =>
      Promise.resolve(
        app.request(path, {
          ...init,
          headers: mergeCookieHeader(init?.headers, cookie),
        }),
      ),
  }
}
