// @vitest-environment happy-dom

// NavRail 导航轨、LoginPage 登录页与 api.ts 认证/权限/分享契约及 401 统一失效处理测试

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createShare,
  fetchDemoAccounts,
  fetchMe,
  fetchPermissions,
  fetchShareAccess,
  listShares,
  login,
  logout,
  revokeShare,
  setUnauthorizedHandler,
  submitShareEntryRecord,
  updateAppPermissions,
  updateTablePermissions,
  updateViewPermissions,
  verifySharePassword,
} from '../../src/api'
import { LoginPage } from '../../src/components/LoginPage'
import { NavRail } from '../../src/components/NavRail'
import { computeUserCapabilities } from '../../src/domain/permissions'
import type { NavSection } from '../../src/domain/router'
import type { AuthUser, DemoAccountInfo } from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEMO_ACCOUNTS: DemoAccountInfo[] = [
  {
    username: 'admin',
    password: 'admin123',
    displayName: '系统管理员',
    role: 'admin',
    description: '拥有全空间数据源、应用配置、权限分配与全量分享管理权限',
  },
  {
    username: 'manager',
    password: 'manager123',
    displayName: '李四',
    role: 'manager',
    description: '华北销售部负责人，可配置本人负责应用与管理个人分享',
  },
  {
    username: 'member',
    password: 'member123',
    displayName: '钱七',
    role: 'member',
    description: '普通成员，按资源只读/可编辑授权访问',
  },
]

const ADMIN_USER: AuthUser = {
  id: 'usr_admin',
  username: 'admin',
  displayName: '系统管理员',
  role: 'admin',
  avatarColor: '#4f46e5',
}

const MEMBER_USER: AuthUser = {
  id: 'usr_member',
  username: 'member',
  displayName: '钱七',
  role: 'member',
  avatarColor: '#64748b',
}

const mountedRoots: Array<{ unmount: () => void; container: HTMLElement }> = []

function mountComponent(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  const handle = {
    container,
    rerender: (nextEl: React.ReactElement) => {
      act(() => {
        root.render(nextEl)
      })
    },
    unmount: () => {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
  mountedRoots.push(handle)
  return handle
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
})

describe('NavRail 左侧窄导航轨', () => {
  test('按角色过滤一级导航入口，并支持底部用户菜单切换账号与登出', async () => {
    const onNavigate = vi.fn<(section: NavSection) => void>()
    const onLogout = vi.fn<() => Promise<void>>(async () => {})
    const onSwitchAccount = vi.fn<(account: DemoAccountInfo) => Promise<void>>(async () => {})

    const handle = mountComponent(
      createElement(NavRail, {
        user: ADMIN_USER,
        userCapabilities: computeUserCapabilities(ADMIN_USER),
        activeSection: 'apps',
        demoAccounts: DEMO_ACCOUNTS,
        onNavigate,
        onLogout,
        onSwitchAccount,
      }),
    )

    // 管理员可见全部 5 个一级入口
    expect(handle.container.querySelector('button[aria-label="工作台"]')).not.toBeNull()
    expect(handle.container.querySelector('button[aria-label="数据录入"]')).not.toBeNull()
    expect(handle.container.querySelector('button[aria-label="数据源"]')).not.toBeNull()
    expect(handle.container.querySelector('button[aria-label="分享管理"]')).not.toBeNull()
    expect(handle.container.querySelector('button[aria-label="权限管理"]')).not.toBeNull()
    expect(handle.container.textContent).toContain('系统管理员')
    expect(handle.container.textContent).toContain('管理员')

    act(() => {
      ;(
        handle.container.querySelector('button[aria-label="权限管理"]') as HTMLButtonElement
      ).click()
    })
    expect(onNavigate).toHaveBeenCalledWith('permissions')

    // 打开底部账号菜单并切换为普通成员
    const accountBtn = handle.container.querySelector(
      'button[aria-label^="账号菜单："]',
    ) as HTMLButtonElement
    act(() => {
      accountBtn.click()
    })
    expect(handle.container.querySelector('[aria-label="账号与角色切换"]')).not.toBeNull()

    const switchMemberBtn = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('钱七'),
    )!
    await act(async () => {
      switchMemberBtn.click()
    })
    expect(onSwitchAccount).toHaveBeenCalledWith(DEMO_ACCOUNTS[2])

    // 切换为普通成员后，隐藏数据源、分享管理、权限管理
    handle.rerender(
      createElement(NavRail, {
        user: MEMBER_USER,
        userCapabilities: computeUserCapabilities(MEMBER_USER),
        activeSection: 'entries',
        demoAccounts: DEMO_ACCOUNTS,
        onNavigate,
        onLogout,
        onSwitchAccount,
      }),
    )
    expect(handle.container.querySelector('button[aria-label="工作台"]')).not.toBeNull()
    expect(handle.container.querySelector('button[aria-label="数据录入"]')).not.toBeNull()
    expect(handle.container.querySelector('button[aria-label="数据源"]')).toBeNull()
    expect(handle.container.querySelector('button[aria-label="分享管理"]')).toBeNull()
    expect(handle.container.querySelector('button[aria-label="权限管理"]')).toBeNull()

    const logoutBtn = handle.container.querySelector(
      'button[aria-label="退出登录"]',
    ) as HTMLButtonElement
    await act(async () => {
      logoutBtn.click()
    })
    expect(onLogout).toHaveBeenCalledTimes(1)
  })
})

describe('LoginPage 独立登录页', () => {
  test('支持空值校验、演示账号快捷填入、一键登录与回跳路径展示', async () => {
    const onSubmit = vi.fn<(username: string, password: string) => Promise<void>>(async () => {})
    const { container } = mountComponent(
      createElement(LoginPage, {
        demoAccounts: DEMO_ACCOUNTS,
        redirectTo: '/entries/tbl_tickets',
        errorMessage: null,
        onSubmit,
      }),
    )

    expect(container.textContent).toContain('多维数据台 · DataDesk')
    expect(container.textContent).toContain('/entries/tbl_tickets')

    // 空表单提交拦截
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('请输入账号和密码')

    // 点击「填入」填入表单但不自动提交
    const fillMgrBtn = container.querySelector(
      'button[aria-label="填入 李四"]',
    ) as HTMLButtonElement
    act(() => {
      fillMgrBtn.click()
    })
    const userInput = container.querySelector('#st-login-username') as HTMLInputElement
    const passInput = container.querySelector('#st-login-password') as HTMLInputElement
    expect(userInput.value).toBe('manager')
    expect(passInput.value).toBe('manager123')
    expect(onSubmit).not.toHaveBeenCalled()

    // 手动修改并提交
    act(() => {
      setInputValue(userInput, 'admin')
      setInputValue(passInput, 'admin123')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).toHaveBeenCalledWith('admin', 'admin123')

    // 点击「一键登录」直接触发登录
    const quickMemberBtn = container.querySelector(
      'button[aria-label="一键登录 钱七"]',
    ) as HTMLButtonElement
    await act(async () => {
      quickMemberBtn.click()
    })
    expect(onSubmit).toHaveBeenCalledWith('member', 'member123')
  })
})

describe('api.ts 认证/权限/分享接口与 401 统一处理', () => {
  test('认证、权限配置、分享管理与免登录访客接口契约正确，且 401 触发统一会话失效处理器', async () => {
    const calls: Array<{ method: string; url: string; headers?: Record<string, string> }> = []
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = (init?.method ?? 'GET').toUpperCase()
        const headers: Record<string, string> = {}
        new Headers(init?.headers).forEach((v, k) => {
          headers[k.toLowerCase()] = v
        })
        calls.push({ method, url, headers })

        if (url === '/api/auth/demo-accounts') {
          return jsonResponse({ accounts: DEMO_ACCOUNTS })
        }
        if (url === '/api/auth/login') {
          const rawBody = typeof init?.body === 'string' ? init.body : '{}'
          const body = JSON.parse(rawBody) as { password?: string }
          if (body.password === 'wrong') {
            return jsonResponse({ message: '账号或密码错误' }, 401)
          }
          return jsonResponse({
            user: ADMIN_USER,
            expiresAt: '2026-12-01T00:00:00.000Z',
            capabilities: computeUserCapabilities(ADMIN_USER),
          })
        }
        if (url === '/api/auth/logout') {
          return jsonResponse({ ok: true })
        }
        if (url === '/api/auth/me') {
          return jsonResponse({
            user: ADMIN_USER,
            expiresAt: '2026-12-01T00:00:00.000Z',
            capabilities: computeUserCapabilities(ADMIN_USER),
          })
        }
        if (url === '/api/permissions' && method === 'GET') {
          return jsonResponse({ users: [ADMIN_USER], apps: [], views: [], tables: [] })
        }
        if (url === '/api/permissions/apps/app_1' && method === 'PUT') {
          return jsonResponse({
            app: { id: 'app_1', name: '应用', tableId: 'tbl_1', sortOrder: 0 },
          })
        }
        if (url === '/api/permissions/views/v_1' && method === 'PUT') {
          return jsonResponse({
            view: {
              id: 'v_1',
              appId: 'app_1',
              tableId: 'tbl_1',
              name: '视图',
              type: 'table',
              sortOrder: 0,
              filterGroup: { conjunction: 'and', conditions: [] },
              quickFilterFields: [],
              sortRules: [],
            },
          })
        }
        if (url === '/api/permissions/tables/tbl_1' && method === 'PUT') {
          return jsonResponse({
            meta: {
              id: 'tbl_1',
              name: '表',
              kind: 'normal',
              columns: [],
              views: [],
              summaries: {},
            },
          })
        }
        if (url === '/api/shares' && method === 'POST') {
          return jsonResponse(
            {
              share: {
                id: 'shr_1',
                token: 'tok_1',
                targetType: 'app',
                targetId: 'app_1',
                targetName: '应用',
                createdBy: 'usr_admin',
                createdByName: '系统管理员',
                hasPassword: false,
                expiresAt: null,
                revokedAt: null,
                createdAt: '2026-11-19T00:00:00.000Z',
                status: 'active',
              },
            },
            201,
          )
        }
        if (url === '/api/shares?targetType=app&targetId=app_1' && method === 'GET') {
          return jsonResponse({ shares: [] })
        }
        if (url === '/api/shares/shr_1/revoke' && method === 'POST') {
          return jsonResponse({
            share: {
              id: 'shr_1',
              token: 'tok_1',
              targetType: 'app',
              targetId: 'app_1',
              targetName: '应用',
              createdBy: 'usr_admin',
              createdByName: '系统管理员',
              hasPassword: false,
              expiresAt: null,
              revokedAt: '2026-11-19T01:00:00.000Z',
              createdAt: '2026-11-19T00:00:00.000Z',
              status: 'revoked',
            },
          })
        }
        if (url === '/api/s/tok_1' && method === 'GET') {
          return jsonResponse({
            unlocked: false,
            requiresPassword: true,
            share: {
              id: 'shr_1',
              token: 'tok_1',
              targetType: 'app',
              targetId: 'app_1',
              targetName: '应用',
              createdByName: '系统管理员',
              expiresAt: null,
            },
          })
        }
        if (url === '/api/s/tok_1/verify' && method === 'POST') {
          return jsonResponse({
            ok: true,
            accessToken: 'unlock_tok',
            access: {
              unlocked: true,
              requiresPassword: true,
              share: {
                id: 'shr_1',
                token: 'tok_1',
                targetType: 'app',
                targetId: 'app_1',
                targetName: '应用',
                createdByName: '系统管理员',
                expiresAt: null,
              },
              capabilities: {
                canView: true,
                canEditRecords: false,
                canConfigure: false,
                canManagePermissions: false,
                canCreateShare: false,
                canManageDataSource: false,
              },
            },
          })
        }
        if (url === '/api/s/tok_1/records' && method === 'POST') {
          return jsonResponse({ record: { _id: 'rec_guest_1', title: '访客填报' } }, 201)
        }
        if (url === '/api/tables') {
          return jsonResponse({ message: '会话已过期' }, 401)
        }
        return jsonResponse({ message: 'Not Found' }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const onUnauthorized = vi.fn<() => void>()
    const unsubscribe = setUnauthorizedHandler(onUnauthorized)

    // 登录失败（401）不触发全局会话过期处理器
    await expect(login({ username: 'admin', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
    })
    expect(onUnauthorized).not.toHaveBeenCalled()

    expect((await fetchDemoAccounts()).length).toBe(3)
    expect((await login({ username: 'admin', password: 'admin123' })).user.id).toBe('usr_admin')
    expect((await fetchMe()).user.id).toBe('usr_admin')
    await logout()

    expect((await fetchPermissions()).users).toHaveLength(1)
    expect((await updateAppPermissions('app_1', { memberAccess: 'editable' })).id).toBe('app_1')
    expect((await updateViewPermissions('v_1', { visibilityScope: 'all' })).id).toBe('v_1')
    expect((await updateTablePermissions('tbl_1', { rowScope: 'self' })).id).toBe('tbl_1')

    expect((await createShare({ targetType: 'app', targetId: 'app_1' })).token).toBe('tok_1')
    expect(await listShares({ targetType: 'app', targetId: 'app_1' })).toEqual([])
    expect((await revokeShare('shr_1')).status).toBe('revoked')

    expect((await fetchShareAccess('tok_1', { shareToken: 'unlock_tok' })).requiresPassword).toBe(
      true,
    )
    expect((await verifySharePassword('tok_1', '1234')).accessToken).toBe('unlock_tok')
    expect(
      (await submitShareEntryRecord('tok_1', { title: '访客填报' }, { shareToken: 'unlock_tok' }))
        ._id,
    ).toBe('rec_guest_1')
    expect(calls.find((c) => c.url === '/api/s/tok_1/records')?.headers?.['x-share-token']).toBe(
      'unlock_tok',
    )

    // 受保护业务接口返回 401 应触发全局会话失效回调
    const { fetchAllTables } = await import('../../src/api')
    await expect(fetchAllTables()).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
