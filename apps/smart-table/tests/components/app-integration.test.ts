// @vitest-environment happy-dom

// App 主装配、History 路由门禁、NavRail 双栏架构、认证回跳与真实两层权限集成测试

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ApiError,
  batchAppendRecords,
  createSmartApp,
  fetchTableBundle,
  setUnauthorizedHandler,
  updateSmartApp,
} from '../../src/api'
import type { SmartGridOptions, SmartGridSetDataExtra } from '../../src/canvas/smart-grid'
import {
  computeAppCapabilities,
  computeTableCapabilities,
  computeUserCapabilities,
  computeViewCapabilities,
} from '../../src/domain/permissions'
import type { TableBundle } from '../../src/shared/api-types'
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
      return { x: 120, y: 140, width: 120, height: 36 }
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

interface FetchCallRecord {
  method: string
  url: string
  body?: unknown
}

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

const DEMO_ACCOUNTS: DemoAccountInfo[] = [
  {
    username: 'admin',
    password: 'admin123',
    displayName: '系统管理员',
    role: 'admin',
    description: '拥有全空间数据源、应用配置与权限管理权限',
  },
  {
    username: 'member',
    password: 'member123',
    displayName: '钱七',
    role: 'member',
    description: '普通成员，按资源只读或可编辑授权访问',
  },
]

function makeFixtures() {
  const tables: TableBundle[] = [
    {
      meta: {
        id: 'tbl_1',
        name: '项目台账',
        kind: 'normal',
        createdBy: ADMIN_USER.id,
        rowScope: 'all',
        memberAccess: 'readonly',
        columns: [
          { key: 'title', title: '项目名称', type: 'text', width: 140, required: true },
          { key: 'owner', title: '负责人', type: 'person', width: 110 },
          {
            key: 'amount',
            title: '合同金额',
            type: 'number',
            width: 120,
            numberFormat: 'currency',
          },
        ],
        views: [],
        summaries: { amount: 'sum' },
      },
      records: [
        { _id: 'r1', title: '一期工程', owner: '张三', amount: 10000 },
        { _id: 'r2', title: '二期工程', owner: '李四', amount: 20000 },
      ],
    },
    {
      meta: {
        id: 'tbl_emp',
        name: '员工花名册',
        kind: 'advanced',
        primaryKeyField: 'emp_id',
        sourceSqlTable: 'biz_employees',
        system: true,
        createdBy: ADMIN_USER.id,
        rowScope: 'all',
        columns: [
          { key: 'emp_id', title: '工号', type: 'text', width: 100, isUniqueKey: true },
          { key: 'name', title: '姓名', type: 'person', width: 100 },
          { key: 'dept', title: '部门', type: 'text', width: 110 },
        ],
        views: [],
        summaries: {},
      },
      records: [
        { _id: 'EMP-1', emp_id: 'EMP-1', name: '张三', dept: '研发部' },
        { _id: 'EMP-2', emp_id: 'EMP-2', name: '张三', dept: '交付部' },
        { _id: 'EMP-3', emp_id: 'EMP-3', name: '李四', dept: '市场部' },
      ],
    },
  ]

  const apps: SmartApp[] = [
    {
      id: 'app_1',
      name: '项目驾驶舱',
      tableId: 'tbl_1',
      sortOrder: 0,
      createdBy: ADMIN_USER.id,
      visibilityScope: 'all',
      memberAccess: 'readonly',
      derivedColumns: [
        {
          key: 'lookup_dept',
          title: '所属部门',
          type: 'lookup',
          width: 120,
          lookupConfig: {
            groupId: 'grp_emp',
            targetTableId: 'tbl_emp',
            matchRules: [{ sourceField: 'owner', targetField: 'name' }],
            targetReturnField: 'dept',
            mode: 'one',
          },
        },
        {
          key: 'formula_tax',
          title: '含税金额',
          type: 'formula',
          width: 120,
          formulaExpr: '[合同金额] * 1.06',
        },
      ],
      lookupOverrides: {},
    },
  ]

  const views: WorkspaceView[] = [
    {
      id: 'v_table',
      appId: 'app_1',
      tableId: 'tbl_1',
      name: '明细表',
      type: 'table',
      sortOrder: 0,
      createdBy: ADMIN_USER.id,
      visibilityScope: 'all',
      filterGroup: {
        conjunction: 'and',
        conditions: [{ id: 'f1', field: 'formula_tax', operator: 'gt', value: 0 }],
      },
      quickFilterFields: ['lookup_dept'],
      sortRules: [],
      columnOrder: ['title', 'owner', 'amount', 'lookup_dept', 'formula_tax'],
      summaries: { amount: 'sum', formula_tax: 'sum' },
    },
  ]

  return { tables, apps, views }
}

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

function mountApp() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(App))
  })
  const handle = {
    container,
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

describe('api.ts 客户端契约', () => {
  test('fetchTableBundle、batchAppendRecords（保留行级 errors）与 create/updateSmartApp 透传派生字段', async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        const method = (init?.method ?? 'GET').toUpperCase()
        const rawBody = typeof init?.body === 'string' ? init.body : ''
        if (url === '/api/tables/tbl_1' && method === 'GET') {
          return jsonResponse(makeFixtures().tables[0])
        }
        if (url === '/api/tables/tbl_1/records/batch' && method === 'POST') {
          return jsonResponse(
            {
              message: '批量校验失败：第 1 行存在错误',
              errors: [
                {
                  rowIndex: 0,
                  field: 'title',
                  columnTitle: '项目名称',
                  message: '项目名称为必填项',
                },
              ],
            },
            400,
          )
        }
        if (url === '/api/apps' && method === 'POST') {
          const body = JSON.parse(rawBody) as Record<string, unknown>
          return jsonResponse(
            {
              app: { id: 'app_new', sortOrder: 1, ...body },
              defaultView: {
                id: 'v_new',
                appId: 'app_new',
                tableId: body.tableId,
                name: '数据明细视图',
                type: 'table',
                sortOrder: 0,
                filterGroup: { conjunction: 'and', conditions: [] },
                quickFilterFields: [],
                sortRules: [],
              },
            },
            201,
          )
        }
        if (url === '/api/apps/app_1' && method === 'PATCH') {
          const body = JSON.parse(rawBody) as Record<string, unknown>
          return jsonResponse({ app: { ...makeFixtures().apps[0], ...body } })
        }
        return jsonResponse({ message: 'Not Found' }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const bundle = await fetchTableBundle('tbl_1')
    expect(bundle.meta.id).toBe('tbl_1')

    await expect(batchAppendRecords('tbl_1', [{ title: '' }])).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      errors: [
        { rowIndex: 0, field: 'title', columnTitle: '项目名称', message: '项目名称为必填项' },
      ],
    })
    let caught: unknown
    try {
      await batchAppendRecords('tbl_1', [{ title: '' }])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).errors).toHaveLength(1)

    const derivedColumns = makeFixtures().apps[0]!.derivedColumns!
    const lookupOverrides = { r1: { grp_emp: 'EMP-2' } }
    const created = await createSmartApp({
      name: '新建应用',
      tableId: 'tbl_1',
      derivedColumns,
      lookupOverrides,
    })
    expect(created.app.derivedColumns).toHaveLength(2)
    expect(created.app.lookupOverrides).toEqual(lookupOverrides)

    const updated = await updateSmartApp('app_1', {
      derivedColumns: derivedColumns.slice(0, 1),
      lookupOverrides,
    })
    expect(updated.derivedColumns).toHaveLength(1)
    expect(updated.lookupOverrides).toEqual(lookupOverrides)
  })
})

describe('App.tsx 认证路由门禁、NavRail 双栏架构与真实权限集成', () => {
  function setupWorkspaceFetch(options?: { initialUser?: AuthUser | null }) {
    const state = makeFixtures()
    let currentUser: AuthUser | null =
      options?.initialUser === undefined ? ADMIN_USER : options.initialUser
    const calls: FetchCallRecord[] = []

    const decorateAll = (user: AuthUser) => ({
      tables: state.tables.map((b) => ({
        ...b,
        meta: {
          ...b.meta,
          capabilities: computeTableCapabilities(user, b.meta, state.apps, state.views),
        },
      })),
      apps: state.apps.map((a) => ({
        ...a,
        capabilities: computeAppCapabilities(user, a),
      })),
      views: state.views.map((v) => ({
        ...v,
        capabilities: computeViewCapabilities(
          user,
          v,
          state.apps.find((a) => a.id === v.appId),
        ),
      })),
    })

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
          const req = body as { username?: string; password?: string }
          const nextUser =
            req.username === 'admin' && req.password === 'admin123'
              ? ADMIN_USER
              : req.username === 'member' && req.password === 'member123'
                ? MEMBER_USER
                : null
          if (!nextUser) {
            return jsonResponse({ message: '账号或密码错误' }, 401)
          }
          currentUser = nextUser
          return jsonResponse({
            user: nextUser,
            expiresAt: '2026-12-01T00:00:00.000Z',
            capabilities: computeUserCapabilities(nextUser),
          })
        }
        if (url === '/api/auth/logout' && method === 'POST') {
          currentUser = null
          return jsonResponse({ ok: true })
        }

        if (!currentUser) {
          return jsonResponse({ message: '未登录或会话已过期，请先登录' }, 401)
        }

        if (url === '/api/auth/me' && method === 'GET') {
          return jsonResponse({
            user: currentUser,
            expiresAt: '2026-12-01T00:00:00.000Z',
            capabilities: computeUserCapabilities(currentUser),
          })
        }

        const decorated = decorateAll(currentUser)
        if (url === '/api/tables' && method === 'GET') {
          return jsonResponse({ tables: decorated.tables })
        }
        if (url === '/api/tables/tbl_1' && method === 'GET') {
          return jsonResponse(decorated.tables[0])
        }
        if (url === '/api/tables/tbl_emp' && method === 'GET') {
          return jsonResponse(decorated.tables[1])
        }
        if (url === '/api/apps' && method === 'GET') {
          return jsonResponse({ apps: decorated.apps })
        }
        if (url === '/api/views' && method === 'GET') {
          return jsonResponse({ views: decorated.views })
        }
        if (url === '/api/permissions' && method === 'GET') {
          if (currentUser.role === 'member') {
            return jsonResponse({ message: '普通成员无权访问权限管理' }, 403)
          }
          return jsonResponse({
            users: [ADMIN_USER, MEMBER_USER],
            apps: state.apps.map((a) => ({
              id: a.id,
              name: a.name,
              tableId: a.tableId,
              createdBy: a.createdBy ?? null,
              createdByName: ADMIN_USER.displayName,
              visibilityScope: a.visibilityScope ?? 'all',
              managerUserIds: a.managerUserIds ?? [],
              memberAccess: a.memberAccess ?? 'readonly',
            })),
            views: state.views.map((v) => ({
              id: v.id,
              appId: v.appId,
              appName: state.apps.find((a) => a.id === v.appId)?.name ?? '',
              tableId: v.tableId,
              name: v.name,
              type: v.type,
              createdBy: v.createdBy ?? null,
              createdByName: ADMIN_USER.displayName,
              visibilityScope: v.visibilityScope ?? 'all',
              managerUserIds: v.managerUserIds ?? [],
              memberAccess: v.memberAccess ?? null,
              effectiveMemberAccess:
                v.memberAccess ??
                state.apps.find((a) => a.id === v.appId)?.memberAccess ??
                'readonly',
            })),
            tables: state.tables.map((b) => ({
              id: b.meta.id,
              name: b.meta.name,
              kind: b.meta.kind,
              createdBy: b.meta.createdBy ?? null,
              createdByName: ADMIN_USER.displayName,
              rowScope: b.meta.rowScope ?? 'all',
              ownerColumnKey: b.meta.ownerColumnKey ?? null,
              memberAccess: b.meta.memberAccess ?? null,
              personColumns: b.meta.columns
                .filter((c) => c.type === 'person')
                .map((c) => ({ key: c.key, title: c.title })),
            })),
          })
        }
        if (url === '/api/tables/tbl_1/meta' && method === 'PUT') {
          if (currentUser.role === 'member') {
            return jsonResponse({ message: '普通成员无权修改表结构' }, 403)
          }
          const nextMeta = (body as { meta: TableBundle['meta'] }).meta
          state.tables[0] = { ...state.tables[0]!, meta: nextMeta }
          return jsonResponse({ meta: decorateAll(currentUser).tables[0]!.meta })
        }
        if (url === '/api/apps/app_1' && method === 'PATCH') {
          if (currentUser.role === 'member') {
            return jsonResponse({ message: '普通成员无权修改应用配置' }, 403)
          }
          state.apps[0] = { ...state.apps[0]!, ...(body as Partial<SmartApp>) }
          return jsonResponse({ app: decorateAll(currentUser).apps[0] })
        }
        if (url === '/api/views/v_table' && method === 'PATCH') {
          if (currentUser.role === 'member') {
            return jsonResponse({ message: '普通成员无权修改视图配置' }, 403)
          }
          state.views[0] = { ...state.views[0]!, ...(body as Partial<WorkspaceView>) }
          return jsonResponse({ view: decorateAll(currentUser).views[0] })
        }
        return jsonResponse({ message: '表不存在' }, 404)
      },
    )
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    return { state, calls, getUser: () => currentUser }
  }

  test('未登录访问旧 /?entry=<tableId> 自动规范为 /entries/:tableId 并跳转 /login，登录后回跳且返回工作台走 /apps 路由', async () => {
    window.history.replaceState(null, '', '/?entry=tbl_1')
    const { calls } = setupWorkspaceFetch({ initialUser: null })

    const { container } = mountApp()
    await flushAsync()

    // 应跳转至 /login?redirect=%2Fentries%2Ftbl_1 且无侧栏/导航轨
    expect(window.location.pathname).toBe('/login')
    expect(window.location.search).toBe('?redirect=%2Fentries%2Ftbl_1')
    expect(container.querySelector('[data-testid="login-page"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="主导航栏"]')).toBeNull()

    // 一键登录管理员后自动回跳 /entries/tbl_1 并进入 EntryWorkspace
    const quickAdminBtn = container.querySelector(
      'button[aria-label="一键登录 系统管理员"]',
    ) as HTMLButtonElement
    await act(async () => {
      quickAdminBtn.click()
    })
    await flushAsync()

    expect(window.location.pathname).toBe('/entries/tbl_1')
    expect(window.location.search).toBe('')
    expect(container.textContent).toContain('项目台账')
    expect(container.textContent).toContain('数据录入端')
    expect(container.querySelector('[aria-label="主导航栏"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="智能表格"]')).toBeNull()

    // 点击「工作台」按钮跳转至 /apps/app_1/views/v_table
    const backBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('工作台'),
    )!
    act(() => {
      backBtn.click()
    })
    await flushAsync()

    expect(window.location.pathname).toBe('/apps/app_1/views/v_table')
    expect(calls.some((c) => c.url === '/api/apps')).toBe(true)
    expect(calls.some((c) => c.url === '/api/views')).toBe(true)
    expect(container.textContent).toContain('项目驾驶舱')
  })

  test('已登录访问 /login 跳回工作台，未登录访问 /s/:token 走独立无侧栏分支且不触发登录检查', async () => {
    // 1) 未登录直接访问 /s/share_demo_tok
    window.history.replaceState(null, '', '/s/share_demo_tok')
    const unauthed = setupWorkspaceFetch({ initialUser: null })
    const shareMount = mountApp()
    await flushAsync()

    expect(window.location.pathname).toBe('/s/share_demo_tok')
    expect(
      shareMount.container.querySelector('[data-testid="share-route-placeholder"]'),
    ).not.toBeNull()
    expect(shareMount.container.textContent).toContain('share_demo_tok')
    expect(shareMount.container.querySelector('[aria-label="主导航栏"]')).toBeNull()
    expect(unauthed.calls.some((c) => c.url === '/api/auth/me')).toBe(false)
    shareMount.unmount()

    // 2) 已登录直接访问 /login 自动回跳至工作台
    window.history.replaceState(null, '', '/login')
    setupWorkspaceFetch({ initialUser: ADMIN_USER })
    const authedMount = mountApp()
    await flushAsync()

    expect(window.location.pathname).toBe('/apps/app_1/views/v_table')
    expect(authedMount.container.querySelector('[data-testid="login-page"]')).toBeNull()
    expect(authedMount.container.textContent).toContain('项目驾驶舱')
  })

  test('/entries/:advancedTableId 与不存在表展示不可用提示与返回工作台入口', async () => {
    window.history.replaceState(null, '', '/entries/tbl_emp')
    setupWorkspaceFetch({ initialUser: ADMIN_USER })

    const firstMount = mountApp()
    await flushAsync()

    expect(firstMount.container.textContent).toContain('数据录入端不可用')
    expect(firstMount.container.textContent).toContain('SQL 主数据表')
    expect(firstMount.container.textContent).toContain('返回工作台')
    firstMount.unmount()

    window.history.replaceState(null, '', '/entries/tbl_missing')
    const secondMount = mountApp()
    await flushAsync()
    expect(secondMount.container.textContent).toContain('数据录入端不可用')
    expect(secondMount.container.textContent).toContain('返回工作台')
  })

  test('SmartApp 管线运行派生列与消歧锁定并持久化，跳转数据源中心与录入端路由同步正确', async () => {
    const { state, calls } = setupWorkspaceFetch({ initialUser: ADMIN_USER })
    const { container } = mountApp()
    await flushAsync()

    expect(window.location.pathname).toBe('/apps/app_1/views/v_table')

    // 1) SmartApp 管线产出包含原始列 + 派生列，且按 lookupOverrides/VLOOKUP 求值
    const gridCols = gridBridge.lastSetData?.columns ?? []
    expect(gridCols.map((c) => c.key)).toEqual([
      'title',
      'owner',
      'amount',
      'lookup_dept',
      'formula_tax',
    ])
    const r1 = gridBridge.lastSetData?.records.find((r) => r._id === 'r1')
    expect(r1?.formula_tax).toBeCloseTo(10600)

    // 2) 重名消歧覆盖持久化到 SmartApp.lookupOverrides（不写表记录）
    const lookupCol = gridCols.find((c) => c.key === 'lookup_dept')!
    const conflict = gridBridge.lastOptions?.conflictsByRow?.get('r1')?.get('grp_emp')
    expect(conflict).toBeDefined()
    act(() => {
      gridBridge.lastOptions?.onConflictClick?.({
        record: r1!,
        column: lookupCol,
        conflict: conflict!,
        rect: { x: 100, y: 120, width: 120, height: 32 },
      })
    })

    const candidateBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('交付部'),
    )!
    await act(async () => {
      candidateBtn.click()
    })
    await flushAsync()

    const appPatchCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/apps/app_1')
    expect(appPatchCall?.body).toEqual({
      lookupOverrides: { r1: { grp_emp: 'EMP-2' } },
    })
    expect(calls.some((c) => c.url.includes('/records/'))).toBe(false)
    expect(gridBridge.lastSetData?.records.find((r) => r._id === 'r1')?.lookup_dept).toBe('交付部')

    // 3) SmartApp 内增删派生列写回 SmartApp.derivedColumns，删除同步清理视图引用，且不写表结构
    const manageBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('派生列管理'),
    )!
    act(() => {
      manageBtn.click()
    })
    expect(container.textContent).toContain('底层数据源原始列（只读')

    const deleteFormulaBtn = container.querySelector(
      'button[aria-label="删除派生列 含税金额"]',
    ) as HTMLButtonElement
    act(() => {
      deleteFormulaBtn.click()
    })
    const confirmDeleteBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '删除字段',
    )!
    await act(async () => {
      confirmDeleteBtn.click()
    })
    await flushAsync()

    expect(state.apps[0]!.derivedColumns?.map((c) => c.key)).toEqual(['lookup_dept'])
    expect(calls.some((c) => c.url === '/api/tables/tbl_1/meta')).toBe(false)
    expect(state.views[0]!.filterGroup.conditions).toHaveLength(0)
    expect(state.views[0]!.columnOrder).not.toContain('formula_tax')
    expect(state.views[0]!.summaries).not.toHaveProperty('formula_tax')

    // 3b) SmartApp 内新增公式列持久化到 SmartApp.derivedColumns
    const addFormulaBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('新增公式列'),
    )!
    act(() => {
      addFormulaBtn.click()
    })
    const formulaTitleInput = container.querySelector('#st-add-col-title') as HTMLInputElement
    const formulaExprInput = container.querySelector('#st-formula-expr') as HTMLInputElement
    act(() => {
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      desc?.set?.call(formulaTitleInput, '净额')
      formulaTitleInput.dispatchEvent(new Event('input', { bubbles: true }))
      formulaTitleInput.dispatchEvent(new Event('change', { bubbles: true }))
      desc?.set?.call(formulaExprInput, '[合同金额] * 0.9')
      formulaExprInput.dispatchEvent(new Event('input', { bubbles: true }))
      formulaExprInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const addColForm = container
      .querySelector('#st-add-col-title')
      ?.closest('form') as HTMLFormElement
    await act(async () => {
      addColForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    await flushAsync()

    expect(
      state.apps[0]!.derivedColumns?.some((c) => c.title === '净额' && c.type === 'formula'),
    ).toBe(true)

    // 4) 从 SmartApp 跳转数据源中心：路径同步为 /datasources/tbl_1、仅运行原始字段、写回 SmartTableMeta
    const jumpDsBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '数据源',
    )!
    act(() => {
      jumpDsBtn.click()
    })
    await flushAsync()

    expect(window.location.pathname).toBe('/datasources/tbl_1')
    expect(gridBridge.lastSetData?.columns.map((c) => c.key)).toEqual(['title', 'owner', 'amount'])
    expect(container.textContent).toContain('打开录入页')
    expect(container.textContent).toContain('复制录入链接')

    const amountCol = state.tables[0]!.meta.columns.find((c) => c.key === 'amount')!
    await act(async () => {
      gridBridge.lastOptions?.onColWidthChange?.({
        column: amountCol,
        columnKey: 'amount',
        colIndex: 2,
        width: 215,
      })
    })
    await flushAsync()

    expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/tables/tbl_1/meta')).toBe(true)
    expect(state.tables[0]!.meta.columns.find((c) => c.key === 'amount')?.width).toBe(215)

    // 数据源中心字段管理修改 required
    const dsColMgrBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('字段管理'),
    )!
    act(() => {
      dsColMgrBtn.click()
    })
    const ownerReqCheckbox = container.querySelector(
      'input[aria-label="负责人 必填"]',
    ) as HTMLInputElement
    await act(async () => {
      ownerReqCheckbox.click()
    })
    await flushAsync()
    expect(state.tables[0]!.meta.columns.find((c) => c.key === 'owner')?.required).toBe(true)

    // 5) 通过 NavRail 切至数据录入板块，URL 同步为 /entries/tbl_1
    const entryRailBtn = container.querySelector(
      'button[aria-label="数据录入"]',
    ) as HTMLButtonElement
    act(() => {
      entryRailBtn.click()
    })
    await flushAsync()

    expect(window.location.pathname).toBe('/entries/tbl_1')
    expect(container.textContent).toContain('数据录入端')
    expect(container.querySelector('[aria-label="数据录入表"]')).not.toBeNull()
  })

  test('NavRail 切换普通成员后隐藏数据源/分享/权限入口，只读资源禁止写操作且直达受限路由被拦截', async () => {
    const { calls } = setupWorkspaceFetch({ initialUser: ADMIN_USER })
    const { container } = mountApp()
    await flushAsync()

    // 管理员可见权限管理与分享管理分支
    act(() => {
      ;(container.querySelector('button[aria-label="分享管理"]') as HTMLButtonElement).click()
    })
    expect(window.location.pathname).toBe('/shares')
    expect(container.querySelector('[data-testid="shares-route-placeholder"]')).not.toBeNull()

    act(() => {
      ;(container.querySelector('button[aria-label="权限管理"]') as HTMLButtonElement).click()
    })
    await flushAsync()
    expect(window.location.pathname).toBe('/permissions')
    expect(container.querySelector('[data-testid="permissions-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="perm-app-app_1"]')).not.toBeNull()

    // 通过 NavRail 底部菜单切换为普通成员（钱七）
    const accountBtn = container.querySelector(
      'button[aria-label^="账号菜单："]',
    ) as HTMLButtonElement
    act(() => {
      accountBtn.click()
    })
    const switchMemberBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('钱七'),
    )!
    await act(async () => {
      switchMemberBtn.click()
    })
    await flushAsync()

    expect(window.location.pathname).toBe('/apps/app_1/views/v_table')
    expect(container.querySelector('button[aria-label="数据源"]')).toBeNull()
    expect(container.querySelector('button[aria-label="分享管理"]')).toBeNull()
    expect(container.querySelector('button[aria-label="权限管理"]')).toBeNull()
    expect(container.textContent).toContain('只读权限')
    expect(container.textContent).not.toContain('新增行')
    expect(container.textContent).not.toContain('VLOOKUP')
    expect(container.textContent).not.toContain('视图配置')
    expect(gridBridge.lastOptions?.readonly).toBe(true)

    // 普通成员点击快捷筛选仅做本地临时过滤，不回写 PATCH /api/views/v_table
    const patchCallsBefore = calls.filter(
      (c) => c.method === 'PATCH' && c.url === '/api/views/v_table',
    ).length
    const filterBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('临时筛选'),
    )!
    act(() => {
      filterBtn.click()
    })
    const addCondBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加条件'),
    )!
    act(() => {
      addCondBtn.click()
    })
    await flushAsync()
    const patchCallsAfter = calls.filter(
      (c) => c.method === 'PATCH' && c.url === '/api/views/v_table',
    ).length
    expect(patchCallsAfter).toBe(patchCallsBefore)

    // 普通成员直接通过 URL 访问 /datasources/tbl_1、/shares、/permissions 均被明确拦截
    for (const [path, testId] of [
      ['/datasources/tbl_1', 'datasources-forbidden'],
      ['/shares', 'shares-forbidden'],
      ['/permissions', 'permissions-forbidden'],
    ] as const) {
      act(() => {
        window.history.replaceState(null, '', path)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      await flushAsync()
      expect(container.querySelector(`[data-testid="${testId}"]`)).not.toBeNull()
    }
  })
})
