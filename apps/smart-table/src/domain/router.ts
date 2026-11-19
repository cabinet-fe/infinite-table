// 前端 History API 路由解析与生成单源：
// 覆盖 /login、/s/:token、/apps/:appId/views/:viewId、/entries/:tableId、/datasources/:tableId、
// /shares、/permissions 及兼容旧 /?entry=<tableId> 自动规范化跳转。

export type NavSection = 'apps' | 'entries' | 'datasources' | 'shares' | 'permissions'

export type AppRoute =
  | { kind: 'login'; redirectTo?: string }
  | { kind: 'share'; token: string }
  | { kind: 'apps'; appId?: string; viewId?: string }
  | { kind: 'entries'; tableId?: string }
  | { kind: 'datasources'; tableId?: string }
  | { kind: 'shares' }
  | { kind: 'permissions' }

function normalizePathname(pathname: string): string {
  const collapsed = pathname.replace(/\/+/g, '/')
  const withLeading = collapsed.startsWith('/') ? collapsed : `/${collapsed}`
  if (withLeading.length > 1 && withLeading.endsWith('/')) {
    return withLeading.slice(0, -1)
  }
  return withLeading
}

function safeDecodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function parseSearchParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

/** 校验并清洗登录后回跳路径（仅允许站内相对路由且排除 /login 与 /s/ 防止循环） */
export function sanitizeRedirectTarget(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return undefined
  }
  try {
    const parsed = new URL(trimmed, 'http://localhost')
    if (parsed.origin !== 'http://localhost') {
      return undefined
    }
    const normPath = normalizePathname(parsed.pathname)
    if (normPath === '/login' || normPath === '/s' || normPath.startsWith('/s/')) {
      return undefined
    }
    return `${normPath}${parsed.search}`
  } catch {
    return undefined
  }
}

/** 识别旧 ?entry=<tableId> 入口并返回应替换跳转的规范路径 /entries/:tableId */
export function resolveLegacyEntryRedirect(pathname: string, search: string): string | null {
  const norm = normalizePathname(pathname)
  if (norm !== '/' && norm !== '/apps' && norm !== '/entries') {
    return null
  }
  const params = parseSearchParams(search)
  const entryId = params.get('entry')?.trim()
  if (!entryId) return null
  return buildRoutePath({ kind: 'entries', tableId: entryId })
}

/** 解析 pathname + search 为强类型路由对象 */
export function parseRouteFromLocation(pathname: string, search = ''): AppRoute {
  const legacyTarget = resolveLegacyEntryRedirect(pathname, search)
  if (legacyTarget) {
    const entryId = safeDecodeSegment(legacyTarget.slice('/entries/'.length))
    return { kind: 'entries', tableId: entryId }
  }

  const norm = normalizePathname(pathname)
  if (norm === '/') {
    return { kind: 'apps' }
  }

  const segments = norm.slice(1).split('/').filter(Boolean).map(safeDecodeSegment)
  const head = segments[0]

  if (head === 'login') {
    const params = parseSearchParams(search)
    const redirectTo = sanitizeRedirectTarget(params.get('redirect'))
    return redirectTo ? { kind: 'login', redirectTo } : { kind: 'login' }
  }

  if (head === 's') {
    const token = segments[1]?.trim()
    if (token) {
      return { kind: 'share', token }
    }
    return { kind: 'apps' }
  }

  if (head === 'apps') {
    const appId = segments[1]?.trim() || undefined
    if (appId && segments[2] === 'views' && segments[3]?.trim()) {
      return { kind: 'apps', appId, viewId: segments[3].trim() }
    }
    return appId ? { kind: 'apps', appId } : { kind: 'apps' }
  }

  if (head === 'entries') {
    const tableId = segments[1]?.trim() || undefined
    return tableId ? { kind: 'entries', tableId } : { kind: 'entries' }
  }

  if (head === 'datasources') {
    const tableId = segments[1]?.trim() || undefined
    return tableId ? { kind: 'datasources', tableId } : { kind: 'datasources' }
  }

  if (head === 'shares') {
    return { kind: 'shares' }
  }

  if (head === 'permissions') {
    return { kind: 'permissions' }
  }

  return { kind: 'apps' }
}

/** 根据路由对象生成规范站内 URL 路径（含查询参数） */
export function buildRoutePath(route: AppRoute): string {
  switch (route.kind) {
    case 'login': {
      const safeRedirect = sanitizeRedirectTarget(route.redirectTo)
      return safeRedirect ? `/login?redirect=${encodeURIComponent(safeRedirect)}` : '/login'
    }
    case 'share':
      return `/s/${encodeURIComponent(route.token)}`
    case 'apps':
      if (route.appId && route.viewId) {
        return `/apps/${encodeURIComponent(route.appId)}/views/${encodeURIComponent(route.viewId)}`
      }
      if (route.appId) {
        return `/apps/${encodeURIComponent(route.appId)}`
      }
      return '/'
    case 'entries':
      return route.tableId ? `/entries/${encodeURIComponent(route.tableId)}` : '/entries'
    case 'datasources':
      return route.tableId ? `/datasources/${encodeURIComponent(route.tableId)}` : '/datasources'
    case 'shares':
      return '/shares'
    case 'permissions':
      return '/permissions'
  }
}

/** 结合基准 URL 生成完整分享或直达链接（如用于复制 /entries/:tableId 或 /s/:token 链接） */
export function buildAbsoluteRouteUrl(baseHref: string, route: AppRoute): string {
  const path = buildRoutePath(route)
  const isAbsolute = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(baseHref)
  if (!isAbsolute) {
    return path
  }
  const parsed = new URL(baseHref)
  return `${parsed.origin}${path}`
}

/** 通过 History API 导航至目标路由（当目标路径与当前地址一致时不重复入栈） */
export function navigateToRoute(route: AppRoute, options?: { replace?: boolean }): string {
  const targetPath = buildRoutePath(route)
  if (typeof window !== 'undefined') {
    const current = `${window.location.pathname}${window.location.search}`
    if (current !== targetPath) {
      if (options?.replace) {
        window.history.replaceState(null, '', targetPath)
      } else {
        window.history.pushState(null, '', targetPath)
      }
    }
  }
  return targetPath
}

/** 读取当前浏览器地址对应的路由，并在命中旧 ?entry=<tableId> 时自动 replaceState 规范化 */
export function readCurrentRoute(): { route: AppRoute; redirectedFromLegacy: boolean } {
  if (typeof window === 'undefined') {
    return { route: { kind: 'apps' }, redirectedFromLegacy: false }
  }
  const { pathname, search } = window.location
  const legacyTarget = resolveLegacyEntryRedirect(pathname, search)
  if (legacyTarget) {
    window.history.replaceState(null, '', legacyTarget)
    return {
      route: parseRouteFromLocation(legacyTarget, ''),
      redirectedFromLegacy: true,
    }
  }
  return {
    route: parseRouteFromLocation(pathname, search),
    redirectedFromLegacy: false,
  }
}

/** 订阅浏览器前进/后退（popstate）事件并自动解析最新路由 */
export function subscribeRouteChange(onChange: (route: AppRoute) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const handler = () => {
    const { route } = readCurrentRoute()
    onChange(route)
  }
  window.addEventListener('popstate', handler)
  return () => window.removeEventListener('popstate', handler)
}

/** 将路由映射为左侧一级导航栏选中项（/login 与 /s/:token 返回 null） */
export function getNavSectionForRoute(route: AppRoute): NavSection | null {
  if (route.kind === 'login' || route.kind === 'share') {
    return null
  }
  return route.kind
}

/** 判断两个路由对象是否等价 */
export function isSameRoute(a: AppRoute, b: AppRoute): boolean {
  return buildRoutePath(a) === buildRoutePath(b)
}
