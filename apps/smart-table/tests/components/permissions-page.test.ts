// @vitest-environment happy-dom

// PermissionsPage 权限管理页组件与 App 工作台实时同步闭环集成测试

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { setUnauthorizedHandler } from '../../src/api'
import type { SmartGridOptions, SmartGridSetDataExtra } from '../../src/canvas/smart-grid'
import { PermissionsPage } from '../../src/components/PermissionsPage'
import {
  canConfigureApp,
  canConfigureTable,
  canConfigureView,
  canViewApp,
  canViewTable,
  canViewView,
  computeAppCapabilities,
  computeTableCapabilities,
  computeUserCapabilities,
  computeViewCapabilities,
  filterTableRecordsForUser,
  getEffectiveMemberAccess,
} from '../../src/domain/permissions'
import type {
  PermissionsOverviewResponse,
  TableBundle,
  UpdateAppPermissionRequest,
  UpdateTablePermissionRequest,
  UpdateViewPermissionRequest,
} from '../../src/shared/api-types'
import type {
  AuthUser,
  DemoAccountInfo,
  SmartApp,
  SmartColumn,
  SmartRecord,
  WorkspaceView,
} from '../../src/shared/schema'

const gridBridge = vi.hoisted(() => ({
  lastOptions: null as SmartGridOptions | null,
  lastSetData: null as {
    columns: readonly SmartColumn[]
    records: readonly SmartRecord[]
    extra?: SmartGridSetDataExtra
  } | null,
}))

vi.mock('../../src/canvas/smart-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/canvas/smart-grid')>()
  class MockSmartGridAdapter {
    constructor(options: SmartGridOptions) {
      gridBridge.lastOptions = options
      gridBridge.lastSetData = {
        columns: options.columns,
        records: options.records,
        extra: {
          view: options.view,
          summaries: options.summaries,
          summaryResults: options.summaryResults,
          totalCount: options.totalCount,
        },
      }
    }
    setData(
      columns: readonly SmartColumn[],
      records: readonly SmartRecord[],
      _conflictsByRow?: unknown,
      _sortRules?: unknown,
      extra?: SmartGridSetDataExtra,
    ) {
      gridBridge.lastSetData = { columns, records, extra }
    }
    setWatermark() {}
    scrollToRecord() {}
    getCellViewportRect() {
      return { x: 100, y: 120, width: 120, height: 36 }
    }
    getSelectionInfo() {
      return { ranges: [], recordIds: [], columnKeys: [], focus: null }
    }
    startEditCell() {}
    destroy() {}
  }
  return {
    ...actual,
    SmartGridAdapter: MockSmartGridAdapter,
  }
})

import { App } from '../../src/App'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ADMIN_USER: AuthUser = {
  id: 'usr_admin',
  username: 'admin',
  displayName: '系统管理员',
  role: 'admin',
  avatarColor: '#4f46e5',
}

const MGR_LISI: AuthUser = {
  id: 'usr_mgr_lisi',
  username: 'manager',
  displayName: '李四',
  role: 'manager',
  avatarColor: '#0284c7',
}

const MGR_WANGWU: AuthUser = {
  id: 'usr_mgr_wangwu',
  username: 'wangwu',
  displayName: '王五',
  role: 'manager',
  avatarColor: '#0d9488',
}

const MEMBER_QIANQI: AuthUser = {
  id: 'usr_member_qianqi',
  username: 'member',
  displayName: '钱七',
  role: 'member',
  avatarColor: '#64748b',
}

const ALL_USERS: AuthUser[] = [ADMIN_USER, MGR_LISI, MGR_WANGWU, MEMBER_QIANQI]

const DEMO_ACCOUNTS: DemoAccountInfo[] = [
  {
    username: 'admin',
    password: 'admin123',
    displayName: '系统管理员',
    role: 'admin',
    description: '管理员',
  },
  {
    username: 'manager',
    password: 'manager123',
    displayName: '李四',
    role: 'manager',
    description: '负责人李四',
  },
  {
    username: 'member',
    password: 'member123',
    displayName: '钱七',
    role: 'member',
    description: '普通成员钱七',
  },
]

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  })
}

const mountedRoots: Array<{ unmount: () => void; container: HTMLElement }> = []

function mountElement(element: React.ReactElement) {
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

interface WorkspaceState {
  tables: TableBundle[]
  apps: SmartApp[]
  views: WorkspaceView[]
}

function createFixtures(): WorkspaceState {
  return {
    tables: [
      {
        meta: {
          id: 'tbl_projects',
          name: '项目跟进表',
          kind: 'normal',
          createdBy: MGR_LISI.id,
          rowScope: 'all',
          ownerColumnKey: undefined,
          memberAccess: undefined,
          columns: [
            { key: 'title', title: '项目名称', type: 'text', width: 150, required: true },
            { key: 'owner_name', title: '负责人', type: 'person', width: 110 },
            { key: 'status', title: '状态', type: 'text', width: 100 },
          ],
          views: [],
          summaries: {},
        },
        records: [
          {
            _id: 'r_lisi',
            createdBy: ADMIN_USER.id,
            title: '华北一期项目',
            owner_name: '李四',
            status: '进行中',
          },
          {
            _id: 'r_qianqi',
            createdBy: ADMIN_USER.id,
            title: '钱七负责子项目',
            owner_name: '钱七',
            status: '待启动',
          },
        ],
      },
      {
        meta: {
          id: 'tbl_tickets',
          name: '售后工单表',
          kind: 'normal',
          createdBy: MGR_WANGWU.id,
          rowScope: 'self',
          ownerColumnKey: 'assignee',
          memberAccess: 'editable',
          columns: [
            { key: 'title', title: '工单标题', type: 'text', width: 150 },
            { key: 'assignee', title: '处理人', type: 'person', width: 110 },
          ],
          views: [],
          summaries: {},
        },
        records: [
          {
            _id: 'r_tk_1',
            createdBy: MGR_WANGWU.id,
            title: '工单 A',
            assignee: '王五',
          },
        ],
      },
      {
        meta: {
          id: 'tbl_logs',
          name: '操作日志',
          kind: 'advanced',
          primaryKeyField: 'log_id',
          sourceSqlTable: 'biz_logs',
          system: true,
          createdBy: ADMIN_USER.id,
          rowScope: 'all',
          columns: [
            { key: 'log_id', title: '日志编号', type: 'text', width: 100, isUniqueKey: true },
            { key: 'action', title: '操作内容', type: 'text', width: 160 },
          ],
          views: [],
          summaries: {},
        },
        records: [{ _id: 'L1', log_id: 'L1', action: '初始化' }],
      },
    ],
    apps: [
      {
        id: 'app_projects',
        name: '项目运营管理台',
        tableId: 'tbl_projects',
        sortOrder: 0,
        createdBy: MGR_LISI.id,
        visibilityScope: 'all',
        managerUserIds: [],
        memberAccess: 'readonly',
      },
      {
        id: 'app_tickets',
        name: '售后工单中心',
        tableId: 'tbl_tickets',
        sortOrder: 1,
        createdBy: MGR_WANGWU.id,
        visibilityScope: 'all',
        managerUserIds: [],
        memberAccess: 'editable',
      },
    ],
    views: [
      {
        id: 'wv_projects_table',
        appId: 'app_projects',
        tableId: 'tbl_projects',
        name: '明细台账',
        type: 'table',
        sortOrder: 0,
        createdBy: MGR_LISI.id,
        visibilityScope: 'all',
        managerUserIds: [],
        filterGroup: { conjunction: 'and', conditions: [] },
        quickFilterFields: [],
        sortRules: [],
      },
      {
        id: 'wv_projects_kanban',
        appId: 'app_projects',
        tableId: 'tbl_projects',
        name: '看板视图',
        type: 'kanban',
        sortOrder: 1,
        createdBy: MGR_LISI.id,
        visibilityScope: 'all',
        managerUserIds: [],
        filterGroup: { conjunction: 'and', conditions: [] },
        quickFilterFields: [],
        sortRules: [],
        kanbanConfig: { groupByField: 'status', displayFields: ['owner_name'] },
      },
    ],
  }
}

function buildOverview(user: AuthUser, state: WorkspaceState): PermissionsOverviewResponse {
  const userMap = new Map(ALL_USERS.map((u) => [u.id, u]))
  const appMap = new Map(state.apps.map((a) => [a.id, a]))
  const nameOf = (id?: string) => (id ? (userMap.get(id)?.displayName ?? id) : '系统预置')

  return {
    users: ALL_USERS,
    apps: state.apps
      .filter((app) => canConfigureApp(user, app))
      .map((app) => ({
        id: app.id,
        name: app.name,
        tableId: app.tableId,
        createdBy: app.createdBy ?? null,
        createdByName: nameOf(app.createdBy),
        visibilityScope: app.visibilityScope ?? 'all',
        managerUserIds: app.managerUserIds ?? [],
        memberAccess: app.memberAccess ?? 'readonly',
      })),
    views: state.views
      .filter((view) => canConfigureView(user, view, appMap.get(view.appId)))
      .map((view) => {
        const parentApp = appMap.get(view.appId)
        return {
          id: view.id,
          appId: view.appId,
          appName: parentApp?.name ?? '',
          tableId: view.tableId,
          name: view.name,
          type: view.type,
          createdBy: view.createdBy ?? null,
          createdByName: nameOf(view.createdBy),
          visibilityScope: view.visibilityScope ?? 'all',
          managerUserIds: view.managerUserIds ?? [],
          memberAccess: view.memberAccess ?? null,
          effectiveMemberAccess: getEffectiveMemberAccess(parentApp, view),
        }
      }),
    tables: state.tables
      .filter((b) =>
        canConfigureTable(
          user,
          b.meta,
          state.apps.filter((a) => a.tableId === b.meta.id),
        ),
      )
      .map((b) => ({
        id: b.meta.id,
        name: b.meta.name,
        kind: b.meta.kind,
        createdBy: b.meta.createdBy ?? null,
        createdByName: nameOf(b.meta.createdBy),
        rowScope: b.meta.rowScope ?? 'all',
        ownerColumnKey: b.meta.ownerColumnKey ?? null,
        memberAccess: b.meta.memberAccess ?? null,
        personColumns: b.meta.columns
          .filter((c) => c.type === 'person')
          .map((c) => ({ key: c.key, title: c.title })),
      })),
  }
}

function setupStatefulBackend(initialUser: AuthUser) {
  const state = createFixtures()
  let currentUser: AuthUser = initialUser
  const calls: Array<{ method: string; url: string; body?: unknown }> = []

  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ method, url, body })

      if (url === '/api/auth/demo-accounts' && method === 'GET') {
        return jsonResponse({ accounts: DEMO_ACCOUNTS })
      }
      if (url === '/api/auth/login' && method === 'POST') {
        const req = body as { username?: string }
        const matched = ALL_USERS.find((u) => u.username === req.username)
        if (!matched) {
          return jsonResponse({ message: '账号或密码错误' }, 401)
        }
        currentUser = matched
        return jsonResponse({
          user: matched,
          expiresAt: '2026-12-01T00:00:00.000Z',
          capabilities: computeUserCapabilities(matched),
        })
      }
      if (url === '/api/auth/me' && method === 'GET') {
        return jsonResponse({
          user: currentUser,
          expiresAt: '2026-12-01T00:00:00.000Z',
          capabilities: computeUserCapabilities(currentUser),
        })
      }

      if (url === '/api/tables' && method === 'GET') {
        const tables = state.tables
          .filter((b) => canViewTable(currentUser, b.meta, state.apps))
          .map((b) => ({
            meta: {
              ...b.meta,
              capabilities: computeTableCapabilities(currentUser, b.meta, state.apps, state.views),
            },
            records: filterTableRecordsForUser(currentUser, b.meta, b.records),
          }))
        return jsonResponse({ tables })
      }
      if (url === '/api/apps' && method === 'GET') {
        const apps = state.apps
          .filter((a) => canViewApp(currentUser, a))
          .map((a) => ({ ...a, capabilities: computeAppCapabilities(currentUser, a) }))
        return jsonResponse({ apps })
      }
      if (url === '/api/views' && method === 'GET') {
        const appMap = new Map(state.apps.map((a) => [a.id, a]))
        const views = state.views
          .filter((v) => canViewView(currentUser, v, appMap.get(v.appId)))
          .map((v) => ({
            ...v,
            capabilities: computeViewCapabilities(currentUser, v, appMap.get(v.appId)),
          }))
        return jsonResponse({ views })
      }

      if (url === '/api/permissions' && method === 'GET') {
        if (currentUser.role === 'member') {
          return jsonResponse({ message: '普通成员无权访问权限管理' }, 403)
        }
        return jsonResponse(buildOverview(currentUser, state))
      }

      if (url.startsWith('/api/permissions/apps/') && method === 'PUT') {
        const appId = decodeURIComponent(url.slice('/api/permissions/apps/'.length))
        const target = state.apps.find((a) => a.id === appId)
        if (!target) return jsonResponse({ message: '智能表格不存在' }, 404)
        if (!canConfigureApp(currentUser, target)) {
          return jsonResponse({ message: '无权修改该智能表格的权限配置' }, 403)
        }
        const patch = body as UpdateAppPermissionRequest
        const updated: SmartApp = {
          ...target,
          ...(patch.visibilityScope !== undefined
            ? { visibilityScope: patch.visibilityScope }
            : {}),
          ...(patch.managerUserIds !== undefined ? { managerUserIds: patch.managerUserIds } : {}),
          ...(patch.memberAccess !== undefined ? { memberAccess: patch.memberAccess } : {}),
        }
        state.apps = state.apps.map((a) => (a.id === appId ? updated : a))
        return jsonResponse({
          app: { ...updated, capabilities: computeAppCapabilities(currentUser, updated) },
        })
      }

      if (url.startsWith('/api/permissions/views/') && method === 'PUT') {
        const viewId = decodeURIComponent(url.slice('/api/permissions/views/'.length))
        const target = state.views.find((v) => v.id === viewId)
        if (!target) return jsonResponse({ message: '视图不存在' }, 404)
        const parentApp = state.apps.find((a) => a.id === target.appId)
        if (!canConfigureView(currentUser, target, parentApp)) {
          return jsonResponse({ message: '无权修改该视图的权限配置' }, 403)
        }
        const patch = body as UpdateViewPermissionRequest
        const updated: WorkspaceView = {
          ...target,
          ...(patch.visibilityScope !== undefined
            ? { visibilityScope: patch.visibilityScope }
            : {}),
          ...(patch.managerUserIds !== undefined ? { managerUserIds: patch.managerUserIds } : {}),
        }
        if ('memberAccess' in patch) {
          if (patch.memberAccess === null) {
            delete updated.memberAccess
          } else if (patch.memberAccess !== undefined) {
            updated.memberAccess = patch.memberAccess
          }
        }
        state.views = state.views.map((v) => (v.id === viewId ? updated : v))
        return jsonResponse({
          view: {
            ...updated,
            capabilities: computeViewCapabilities(currentUser, updated, parentApp),
          },
        })
      }

      if (url.startsWith('/api/permissions/tables/') && method === 'PUT') {
        const tableId = decodeURIComponent(url.slice('/api/permissions/tables/'.length))
        const bundle = state.tables.find((b) => b.meta.id === tableId)
        if (!bundle) return jsonResponse({ message: '数据表不存在' }, 404)
        if (
          !canConfigureTable(
            currentUser,
            bundle.meta,
            state.apps.filter((a) => a.tableId === tableId),
          )
        ) {
          return jsonResponse({ message: '无权修改该数据表的行级权限配置' }, 403)
        }
        const patch = body as UpdateTablePermissionRequest
        const nextMeta = {
          ...bundle.meta,
          ...(patch.rowScope !== undefined ? { rowScope: patch.rowScope } : {}),
        }
        if ('ownerColumnKey' in patch) {
          if (patch.ownerColumnKey === null || patch.ownerColumnKey === '') {
            delete nextMeta.ownerColumnKey
          } else if (patch.ownerColumnKey !== undefined) {
            nextMeta.ownerColumnKey = patch.ownerColumnKey
          }
        }
        if ('memberAccess' in patch) {
          if (patch.memberAccess === null) {
            delete nextMeta.memberAccess
          } else if (patch.memberAccess !== undefined) {
            nextMeta.memberAccess = patch.memberAccess
          }
        }
        state.tables = state.tables.map((b) =>
          b.meta.id === tableId ? { ...b, meta: nextMeta } : b,
        )
        return jsonResponse({
          meta: {
            ...nextMeta,
            capabilities: computeTableCapabilities(currentUser, nextMeta, state.apps, state.views),
          },
        })
      }

      return jsonResponse({ message: 'Not Found' }, 404)
    },
  )

  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  return { state, calls }
}

function clickRadio(root: ParentNode, groupLabel: string, optionLabel: string) {
  const group = root.querySelector(`[role="radiogroup"][aria-label="${groupLabel}"]`)
  if (!group) throw new Error(`找不到单选组: ${groupLabel}`)
  const btn = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find((el) =>
    el.textContent?.includes(optionLabel),
  )
  if (!btn) throw new Error(`找不到选项「${optionLabel}」于 ${groupLabel}`)
  act(() => {
    btn.click()
  })
}

beforeEach(() => {
  gridBridge.lastOptions = null
  gridBridge.lastSetData = null
  setUnauthorizedHandler(null)
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
})

describe('PermissionsPage 权限管理页组件测试', () => {
  test('无管理权限的普通成员直接展示无权限提示与只读引导且不请求 /api/permissions；服务端 403 亦兜底拦截', async () => {
    const fetchSpy = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchSpy)
    const onBack = vi.fn<() => void>()

    const memberMount = mountElement(
      createElement(PermissionsPage, {
        currentUser: MEMBER_QIANQI,
        userCapabilities: computeUserCapabilities(MEMBER_QIANQI),
        onBackToWorkbench: onBack,
      }),
    )
    await flushAsync()

    expect(
      memberMount.container.querySelector('[data-testid="permissions-forbidden"]'),
    ).not.toBeNull()
    expect(memberMount.container.textContent).toContain('无权访问权限管理')
    expect(memberMount.container.textContent).toContain('普通成员仅可按授权范围')
    expect(fetchSpy).not.toHaveBeenCalled()

    const backBtn = Array.from(memberMount.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('返回工作台'),
    )!
    act(() => {
      backBtn.click()
    })
    expect(onBack).toHaveBeenCalledTimes(1)
    memberMount.unmount()

    // 若服务端返回 403，同样展示权限不足提示
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: '后端拒绝：无权限访问权限配置' }, 403)),
    )
    const server403Mount = mountElement(
      createElement(PermissionsPage, {
        currentUser: MGR_LISI,
        userCapabilities: computeUserCapabilities(MGR_LISI),
        onBackToWorkbench: onBack,
      }),
    )
    await flushAsync()

    expect(
      server403Mount.container.querySelector('[data-testid="permissions-forbidden"]'),
    ).not.toBeNull()
    expect(server403Mount.container.textContent).toContain('后端拒绝：无权限访问权限配置')
  })

  test('负责人仅看本人负责资源，可切换应用/视图可见范围、指定负责人与普通成员授权并持久化', async () => {
    const { calls } = setupStatefulBackend(MGR_LISI)
    const onChanged = vi.fn<() => Promise<void>>(async () => {})
    const onNotify = vi.fn<(type: 'error' | 'success' | 'info', msg: string) => void>()

    const firstMount = mountElement(
      createElement(PermissionsPage, {
        currentUser: MGR_LISI,
        userCapabilities: computeUserCapabilities(MGR_LISI),
        onPermissionsChanged: onChanged,
        onNotify,
      }),
    )
    await flushAsync()

    const c = firstMount.container
    expect(c.querySelector('[data-testid="permissions-page"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="perm-app-app_projects"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="perm-table-tbl_projects"]')).not.toBeNull()
    // 李四不可见王五创建的资源
    expect(c.querySelector('[data-testid="perm-app-app_tickets"]')).toBeNull()
    expect(c.querySelector('[data-testid="perm-table-tbl_tickets"]')).toBeNull()

    // 1) 修改应用可见范围为「指定负责人」，勾选王五（且列表不出现普通成员钱七），并授权普通成员「可编辑」
    const appCard = c.querySelector('[data-testid="perm-app-app_projects"]')!
    clickRadio(appCard, '应用 项目运营管理台 可见范围', '指定负责人')
    expect(appCard.querySelector('input[aria-label*="钱七"]')).toBeNull()

    const wangwuCheckbox = appCard.querySelector(
      'input[aria-label="应用 项目运营管理台 指定负责人 王五"]',
    ) as HTMLInputElement
    act(() => {
      wangwuCheckbox.click()
    })
    clickRadio(appCard, '应用 项目运营管理台 普通成员授权', '可编辑')

    const saveAppBtn = appCard.querySelector(
      'button[aria-label="保存应用 项目运营管理台 权限"]',
    ) as HTMLButtonElement
    await act(async () => {
      saveAppBtn.click()
    })
    await flushAsync()

    const appPutCall = calls.find(
      (call) => call.method === 'PUT' && call.url === '/api/permissions/apps/app_projects',
    )
    expect(appPutCall?.body).toEqual({
      visibilityScope: 'managers',
      managerUserIds: ['usr_mgr_wangwu'],
      memberAccess: 'editable',
    })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onNotify).toHaveBeenCalledWith('success', expect.stringContaining('项目运营管理台'))

    // 所属应用切换为可编辑后，未显式覆盖的子视图自动显示继承「可编辑」
    const tableViewCard = c.querySelector('[data-testid="perm-view-wv_projects_table"]')!
    expect(tableViewCard.textContent).toContain('继承应用（当前：可编辑）')

    // 2) 修改视图 wv_projects_kanban 为「仅自己」+「只读」并保存
    const kanbanCard = c.querySelector('[data-testid="perm-view-wv_projects_kanban"]')!
    clickRadio(kanbanCard, '视图 看板视图 可见范围', '仅自己')
    clickRadio(kanbanCard, '视图 看板视图 普通成员授权', '只读')

    const saveViewBtn = kanbanCard.querySelector(
      'button[aria-label="保存视图 看板视图 权限"]',
    ) as HTMLButtonElement
    await act(async () => {
      saveViewBtn.click()
    })
    await flushAsync()

    const viewPutCall = calls.find(
      (call) => call.method === 'PUT' && call.url === '/api/permissions/views/wv_projects_kanban',
    )
    expect(viewPutCall?.body).toEqual({
      visibilityScope: 'self',
      managerUserIds: [],
      memberAccess: 'readonly',
    })

    firstMount.unmount()

    // 3) 模拟刷新页面后重新挂载，验证持久化配置保留
    const remount = mountElement(
      createElement(PermissionsPage, {
        currentUser: MGR_LISI,
        userCapabilities: computeUserCapabilities(MGR_LISI),
      }),
    )
    await flushAsync()

    const nextAppCard = remount.container.querySelector('[data-testid="perm-app-app_projects"]')!
    const managersRadio = Array.from(
      nextAppCard.querySelectorAll<HTMLButtonElement>(
        '[role="radiogroup"][aria-label="应用 项目运营管理台 可见范围"] [role="radio"]',
      ),
    ).find((b) => b.textContent?.includes('指定负责人'))!
    expect(managersRadio.getAttribute('aria-checked')).toBe('true')
    const nextWangwuCheckbox = nextAppCard.querySelector(
      'input[aria-label="应用 项目运营管理台 指定负责人 王五"]',
    ) as HTMLInputElement
    expect(nextWangwuCheckbox.checked).toBe(true)

    const editableRadio = Array.from(
      nextAppCard.querySelectorAll<HTMLButtonElement>(
        '[role="radiogroup"][aria-label="应用 项目运营管理台 普通成员授权"] [role="radio"]',
      ),
    ).find((b) => b.textContent?.includes('可编辑'))!
    expect(editableRadio.getAttribute('aria-checked')).toBe('true')
  })

  test('管理员可配置数据表行级数据范围、绑定 person 列并持久化，无 person 列给出明确禁用提示', async () => {
    const { calls } = setupStatefulBackend(ADMIN_USER)

    const firstMount = mountElement(
      createElement(PermissionsPage, {
        currentUser: ADMIN_USER,
        userCapabilities: computeUserCapabilities(ADMIN_USER),
      }),
    )
    await flushAsync()

    const c = firstMount.container
    // 管理员可见全空间所有应用与表
    expect(c.querySelector('[data-testid="perm-app-app_tickets"]')).not.toBeNull()
    expect(c.querySelector('[data-testid="perm-table-tbl_logs"]')).not.toBeNull()

    // 无 person 列的表禁用下拉并给出说明
    const logsCard = c.querySelector('[data-testid="perm-table-tbl_logs"]')!
    expect(logsCard.textContent).toContain('暂无 person 类型列')
    const logsSelect = logsCard.querySelector(
      'button[aria-label="绑定 操作日志 业务负责人列"]',
    ) as HTMLButtonElement
    expect(logsSelect.disabled).toBe(true)

    // 修改 tbl_projects 后先点重置，确认恢复原值
    const projectsTableCard = c.querySelector('[data-testid="perm-table-tbl_projects"]')!
    const saveTblBtn = projectsTableCard.querySelector(
      'button[aria-label="保存数据表 项目跟进表 权限"]',
    ) as HTMLButtonElement
    expect(saveTblBtn.disabled).toBe(true)

    clickRadio(projectsTableCard, '数据表 项目跟进表 行级数据范围', '仅本人')
    expect(saveTblBtn.disabled).toBe(false)
    const resetBtn = Array.from(projectsTableCard.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('重置'),
    )!
    act(() => {
      resetBtn.click()
    })
    expect(saveTblBtn.disabled).toBe(true)

    // 正式配置：行级范围「仅本人」+ 绑定 person 列 owner_name + 录入端成员授权「可编辑」
    clickRadio(projectsTableCard, '数据表 项目跟进表 行级数据范围', '仅本人')
    clickRadio(projectsTableCard, '数据表 项目跟进表 独立录入端成员授权', '可编辑')

    const personSelectBtn = projectsTableCard.querySelector(
      'button[aria-label="绑定 项目跟进表 业务负责人列"]',
    ) as HTMLButtonElement
    act(() => {
      personSelectBtn.click()
    })
    const ownerOption = Array.from(document.body.querySelectorAll('[role="option"]')).find((el) =>
      el.textContent?.includes('负责人 (owner_name)'),
    ) as HTMLButtonElement
    act(() => {
      ownerOption.click()
    })

    await act(async () => {
      saveTblBtn.click()
    })
    await flushAsync()

    const tblPutCall = calls.find(
      (call) => call.method === 'PUT' && call.url === '/api/permissions/tables/tbl_projects',
    )
    expect(tblPutCall?.body).toEqual({
      rowScope: 'self',
      ownerColumnKey: 'owner_name',
      memberAccess: 'editable',
    })

    firstMount.unmount()

    // 刷新页面后保留已绑定的 person 列与行级范围
    const remount = mountElement(
      createElement(PermissionsPage, {
        currentUser: ADMIN_USER,
        userCapabilities: computeUserCapabilities(ADMIN_USER),
      }),
    )
    await flushAsync()

    const reloadedCard = remount.container.querySelector('[data-testid="perm-table-tbl_projects"]')!
    const selfRadio = Array.from(
      reloadedCard.querySelectorAll<HTMLButtonElement>(
        '[role="radiogroup"][aria-label="数据表 项目跟进表 行级数据范围"] [role="radio"]',
      ),
    ).find((b) => b.textContent?.includes('仅本人'))!
    expect(selfRadio.getAttribute('aria-checked')).toBe('true')
    expect(
      reloadedCard.querySelector('button[aria-label="绑定 项目跟进表 业务负责人列"]')?.textContent,
    ).toContain('负责人 (owner_name)')

    // 分类 Tab 与关键字搜索过滤生效
    const tablesTab = Array.from(remount.container.querySelectorAll('[role="tab"]')).find((el) =>
      el.textContent?.includes('数据源表行级策略'),
    ) as HTMLButtonElement
    act(() => {
      tablesTab.click()
    })
    expect(remount.container.querySelector('[data-testid="perm-app-app_projects"]')).toBeNull()
    expect(
      remount.container.querySelector('[data-testid="perm-table-tbl_projects"]'),
    ).not.toBeNull()

    const searchInput = remount.container.querySelector(
      'input[aria-label="搜索权限资源"]',
    ) as HTMLInputElement
    act(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      desc?.set?.call(searchInput, '操作日志')
      searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      searchInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(remount.container.querySelector('[data-testid="perm-table-tbl_projects"]')).toBeNull()
    expect(remount.container.querySelector('[data-testid="perm-table-tbl_logs"]')).not.toBeNull()
  })
})

describe('App.tsx 集成：/permissions 保存后工作台实时同步生效', () => {
  test('在 /permissions 保存应用成员授权、视图可见范围与表行级策略后，工作台数据行、视图 Tab 与编辑权限同步生效', async () => {
    setupStatefulBackend(MGR_LISI)
    const { container } = mountElement(createElement(App))
    await flushAsync()

    // 1) 初始在工作台：tbl_projects 为 all，李四可见全部 2 条记录
    expect(window.location.pathname).toBe('/apps/app_projects/views/wv_projects_table')
    expect(gridBridge.lastSetData?.records.map((r) => r._id)).toEqual(['r_lisi', 'r_qianqi'])

    // 2) 进入 /permissions 页面修改两层权限配置
    act(() => {
      ;(container.querySelector('button[aria-label="权限管理"]') as HTMLButtonElement).click()
    })
    await flushAsync()
    expect(window.location.pathname).toBe('/permissions')
    expect(container.querySelector('[data-testid="permissions-page"]')).not.toBeNull()

    // 2a) 应用授权普通成员可编辑
    const appCard = container.querySelector('[data-testid="perm-app-app_projects"]')!
    clickRadio(appCard, '应用 项目运营管理台 普通成员授权', '可编辑')
    await act(async () => {
      ;(
        appCard.querySelector(
          'button[aria-label="保存应用 项目运营管理台 权限"]',
        ) as HTMLButtonElement
      ).click()
    })
    await flushAsync()

    // 2b) 看板视图收窄为仅自己可见
    const kanbanCard = container.querySelector('[data-testid="perm-view-wv_projects_kanban"]')!
    clickRadio(kanbanCard, '视图 看板视图 可见范围', '仅自己')
    await act(async () => {
      ;(
        kanbanCard.querySelector('button[aria-label="保存视图 看板视图 权限"]') as HTMLButtonElement
      ).click()
    })
    await flushAsync()

    // 2c) 数据表设置行级范围为「仅本人」并绑定 owner_name 人员列
    const tableCard = container.querySelector('[data-testid="perm-table-tbl_projects"]')!
    clickRadio(tableCard, '数据表 项目跟进表 行级数据范围', '仅本人')
    act(() => {
      ;(
        tableCard.querySelector(
          'button[aria-label="绑定 项目跟进表 业务负责人列"]',
        ) as HTMLButtonElement
      ).click()
    })
    const ownerOpt = Array.from(document.body.querySelectorAll('[role="option"]')).find((el) =>
      el.textContent?.includes('负责人 (owner_name)'),
    ) as HTMLButtonElement
    act(() => {
      ownerOpt.click()
    })
    await act(async () => {
      ;(
        tableCard.querySelector(
          'button[aria-label="保存数据表 项目跟进表 权限"]',
        ) as HTMLButtonElement
      ).click()
    })
    await flushAsync()

    // 3) 返回工作台，李四的画布数据立即同步裁剪为仅自己归属的 1 行（r_lisi）
    act(() => {
      ;(container.querySelector('button[aria-label="工作台"]') as HTMLButtonElement).click()
    })
    await flushAsync()
    expect(window.location.pathname).toBe('/apps/app_projects/views/wv_projects_table')
    expect(gridBridge.lastSetData?.records.map((r) => r._id)).toEqual(['r_lisi'])

    // 4) 切换账号为普通成员钱七，验证：
    //    - 仅可见明细台账视图（看板视图已被设为「仅自己」而隐藏）
    //    - 具备应用可编辑权限（readonly = false，显示新增行按钮）
    //    - 仅可见绑定 person 列匹配钱七的 1 行（r_qianqi）
    act(() => {
      ;(container.querySelector('button[aria-label^="账号菜单："]') as HTMLButtonElement).click()
    })
    const switchQianqi = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('钱七'),
    )!
    await act(async () => {
      switchQianqi.click()
    })
    await flushAsync()

    expect(window.location.pathname).toBe('/apps/app_projects/views/wv_projects_table')
    const viewTabsNav = container.querySelector('nav[aria-label="当前智能表格视图"]')!
    expect(viewTabsNav.textContent).toContain('明细台账')
    expect(viewTabsNav.textContent).not.toContain('看板视图')
    expect(gridBridge.lastOptions?.readonly).toBe(false)
    expect(container.textContent).toContain('新增行')
    expect(gridBridge.lastSetData?.records.map((r) => r._id)).toEqual(['r_qianqi'])

    // 普通成员直达 /permissions 仍被拦截
    act(() => {
      window.history.replaceState(null, '', '/permissions')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await flushAsync()
    expect(container.querySelector('[data-testid="permissions-forbidden"]')).not.toBeNull()
  })
})
