// @vitest-environment happy-dom

// 前端路由解析、生成、旧 ?entry=<tableId> 规范化跳转与 History API 同步单元测试

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  buildAbsoluteRouteUrl,
  buildRoutePath,
  getNavSectionForRoute,
  isSameRoute,
  navigateToRoute,
  parseRouteFromLocation,
  readCurrentRoute,
  resolveLegacyEntryRedirect,
  sanitizeRedirectTarget,
  subscribeRouteChange,
  type AppRoute,
} from '../../src/domain/router'

describe('router 路由解析与生成', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('正确解析全部核心路由与参数', () => {
    expect(parseRouteFromLocation('/')).toEqual({ kind: 'apps' })
    expect(parseRouteFromLocation('/apps')).toEqual({ kind: 'apps' })
    expect(parseRouteFromLocation('/apps/app_projects')).toEqual({
      kind: 'apps',
      appId: 'app_projects',
    })
    expect(parseRouteFromLocation('/apps/app_projects/views/wv_projects_table')).toEqual({
      kind: 'apps',
      appId: 'app_projects',
      viewId: 'wv_projects_table',
    })
    expect(parseRouteFromLocation('/entries')).toEqual({ kind: 'entries' })
    expect(parseRouteFromLocation('/entries/tbl_projects/')).toEqual({
      kind: 'entries',
      tableId: 'tbl_projects',
    })
    expect(parseRouteFromLocation('/datasources')).toEqual({ kind: 'datasources' })
    expect(parseRouteFromLocation('/datasources/tbl_employees')).toEqual({
      kind: 'datasources',
      tableId: 'tbl_employees',
    })
    expect(parseRouteFromLocation('/shares')).toEqual({ kind: 'shares' })
    expect(parseRouteFromLocation('/permissions')).toEqual({ kind: 'permissions' })
    expect(parseRouteFromLocation('/s/share_tok_123')).toEqual({
      kind: 'share',
      token: 'share_tok_123',
    })
    expect(parseRouteFromLocation('/login', '?redirect=%2Fentries%2Ftbl_projects')).toEqual({
      kind: 'login',
      redirectTo: '/entries/tbl_projects',
    })
    expect(parseRouteFromLocation('/unknown/path')).toEqual({ kind: 'apps' })
  })

  test('sanitizeRedirectTarget 防御开放重定向与登录/分享回环', () => {
    expect(sanitizeRedirectTarget('/apps/app_1/views/v_1')).toBe('/apps/app_1/views/v_1')
    expect(sanitizeRedirectTarget('/entries/tbl_1?foo=bar')).toBe('/entries/tbl_1?foo=bar')
    expect(sanitizeRedirectTarget('https://evil.example/phish')).toBeUndefined()
    expect(sanitizeRedirectTarget('//evil.example/phish')).toBeUndefined()
    expect(sanitizeRedirectTarget('/login?redirect=/')).toBeUndefined()
    expect(sanitizeRedirectTarget('/s/token_1')).toBeUndefined()
    expect(sanitizeRedirectTarget('   ')).toBeUndefined()
  })

  test('兼容旧 /?entry=<tableId> 自动解析并 replaceState 规范跳转至 /entries/:tableId', () => {
    expect(resolveLegacyEntryRedirect('/', '?entry=tbl_tickets')).toBe('/entries/tbl_tickets')
    expect(resolveLegacyEntryRedirect('/', '?entry=   ')).toBeNull()
    expect(parseRouteFromLocation('/', '?entry=tbl_tickets')).toEqual({
      kind: 'entries',
      tableId: 'tbl_tickets',
    })

    window.history.replaceState(null, '', '/?entry=tbl_projects')
    const result = readCurrentRoute()
    expect(result.redirectedFromLegacy).toBe(true)
    expect(result.route).toEqual({ kind: 'entries', tableId: 'tbl_projects' })
    expect(window.location.pathname).toBe('/entries/tbl_projects')
    expect(window.location.search).toBe('')
  })

  test('buildRoutePath 与 buildAbsoluteRouteUrl 为所有路由生成单源 URL', () => {
    expect(buildRoutePath({ kind: 'apps' })).toBe('/')
    expect(buildRoutePath({ kind: 'apps', appId: 'app_1' })).toBe('/apps/app_1')
    expect(buildRoutePath({ kind: 'apps', appId: 'app_1', viewId: 'v_1' })).toBe(
      '/apps/app_1/views/v_1',
    )
    expect(buildRoutePath({ kind: 'entries' })).toBe('/entries')
    expect(buildRoutePath({ kind: 'entries', tableId: 'tbl_1' })).toBe('/entries/tbl_1')
    expect(buildRoutePath({ kind: 'datasources' })).toBe('/datasources')
    expect(buildRoutePath({ kind: 'datasources', tableId: 'tbl_2' })).toBe('/datasources/tbl_2')
    expect(buildRoutePath({ kind: 'shares' })).toBe('/shares')
    expect(buildRoutePath({ kind: 'permissions' })).toBe('/permissions')
    expect(buildRoutePath({ kind: 'share', token: 'tok_x' })).toBe('/s/tok_x')
    expect(buildRoutePath({ kind: 'login', redirectTo: '/permissions' })).toBe(
      '/login?redirect=%2Fpermissions',
    )

    expect(
      buildAbsoluteRouteUrl('https://datadesk.local/apps/a1', {
        kind: 'entries',
        tableId: 'tbl_1',
      }),
    ).toBe('https://datadesk.local/entries/tbl_1')
    expect(buildAbsoluteRouteUrl('/apps/a1', { kind: 'share', token: 'tok_1' })).toBe('/s/tok_1')
  })

  test('navigateToRoute 与 subscribeRouteChange 正确同步 History API 与 popstate', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')

    navigateToRoute({ kind: 'apps', appId: 'app_1', viewId: 'v_1' })
    expect(pushSpy).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/apps/app_1/views/v_1')

    // 重复导航到相同路径不入栈
    navigateToRoute({ kind: 'apps', appId: 'app_1', viewId: 'v_1' })
    expect(pushSpy).toHaveBeenCalledTimes(1)

    navigateToRoute({ kind: 'permissions' }, { replace: true })
    expect(replaceSpy).toHaveBeenCalledTimes(1)
    expect(window.location.pathname).toBe('/permissions')

    const listener = vi.fn<(route: AppRoute) => void>()
    const unsubscribe = subscribeRouteChange(listener)
    window.history.replaceState(null, '', '/datasources/tbl_projects')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(listener).toHaveBeenCalledWith({ kind: 'datasources', tableId: 'tbl_projects' })
    unsubscribe()

    expect(getNavSectionForRoute({ kind: 'login' })).toBeNull()
    expect(getNavSectionForRoute({ kind: 'share', token: 't' })).toBeNull()
    expect(getNavSectionForRoute({ kind: 'shares' })).toBe('shares')
    expect(
      isSameRoute(
        { kind: 'apps', appId: 'a', viewId: 'v' },
        { kind: 'apps', appId: 'a', viewId: 'v' },
      ),
    ).toBe(true)
  })
})
