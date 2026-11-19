// @vitest-environment happy-dom

// 一键分享弹窗、/s/:token 访客访问页与 /shares 分享管理页组件及全栈端到端集成测试。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import { setUnauthorizedHandler } from '../../src/api'
import type { SmartGridOptions, SmartGridSetDataExtra } from '../../src/canvas/smart-grid'
import type { SmartPivotOptions } from '../../src/canvas/smart-pivot'
import { computeUserCapabilities } from '../../src/domain/permissions'
import type { WorkspaceActionCapabilities } from '../../src/domain/workspace-helpers'
import { createSession } from '../../src/server/auth'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedSmartTableDemo } from '../../src/server/seed'
import type { TableBundle } from '../../src/shared/api-types'
import type {
  AuthUser,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
  WorkspaceView,
} from '../../src/shared/schema'

const canvasBridge = vi.hoisted(() => ({
  gridInstances: [] as Array<{
    options: SmartGridOptions
    lastData: {
      columns: readonly SmartColumn[]
      records: readonly SmartRecord[]
      extra?: SmartGridSetDataExtra
    }
  }>,
  pivotInstances: [] as Array<{
    options: SmartPivotOptions
    lastUpdate?: {
      columns: readonly SmartColumn[]
      records: readonly SmartRecord[]
      config: SmartPivotConfig
    }
    expandAllCount: number
    collapseAllCount: number
  }>,
}))

vi.mock('../../src/canvas/smart-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/canvas/smart-grid')>()
  class MockSmartGridAdapter {
    private readonly entry: (typeof canvasBridge.gridInstances)[number]
    constructor(options: SmartGridOptions) {
      this.entry = {
        options,
        lastData: {
          columns: options.columns,
          records: options.records,
          extra: {
            view: options.view,
            summaries: options.summaries,
            summaryResults: options.summaryResults,
            totalCount: options.totalCount,
          },
        },
      }
      canvasBridge.gridInstances.push(this.entry)
    }
    setData(
      columns: readonly SmartColumn[],
      records: readonly SmartRecord[],
      _conflictsByRow?: unknown,
      _sortRules?: unknown,
      extra?: SmartGridSetDataExtra,
    ) {
      this.entry.lastData = { columns, records, extra }
    }
    setWatermark() {}
    scrollToRecord() {}
    getCellViewportRect() {
      return { x: 100, y: 120, width: 120, height: 36 }
    }
    getSelectionInfo() {
      return { ranges: [], recordIds: [], columnKeys: [], focus: null }
    }
    getTable() {
      return {
        rowHeaderWidth: 64,
        headerHeight: 38,
        getCellAtRelativePosition: () => null,
        scrollTo: () => {},
      }
    }
    startEditCell() {}
    destroy() {}
  }
  return {
    ...actual,
    SmartGridAdapter: MockSmartGridAdapter,
  }
})

vi.mock('../../src/canvas/smart-pivot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/canvas/smart-pivot')>()
  class MockSmartPivotAdapter {
    private readonly entry: (typeof canvasBridge.pivotInstances)[number]
    constructor(options: SmartPivotOptions) {
      this.entry = {
        options,
        expandAllCount: 0,
        collapseAllCount: 0,
      }
      canvasBridge.pivotInstances.push(this.entry)
    }
    update(params: {
      columns: readonly SmartColumn[]
      records: readonly SmartRecord[]
      config: SmartPivotConfig
    }) {
      this.entry.lastUpdate = params
    }
    expandAll() {
      this.entry.expandAllCount += 1
    }
    collapseAll() {
      this.entry.collapseAllCount += 1
    }
    setWatermark() {}
    destroy() {}
  }
  return {
    ...actual,
    SmartPivotAdapter: MockSmartPivotAdapter,
  }
})

import { App } from '../../src/App'
import { AppViewTabs } from '../../src/components/AppViewTabs'
import { EntryWorkspace } from '../../src/components/EntryWorkspace'
import { ShareAccessPage } from '../../src/components/ShareAccessPage'
import { ShareModal } from '../../src/components/ShareModal'
import { SharesPage } from '../../src/components/SharesPage'
import { Toolbar } from '../../src/components/Toolbar'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
const noopAsync = async () => {}

const ADMIN_USER: AuthUser = {
  id: 'usr_admin',
  username: 'admin',
  displayName: '系统管理员',
  role: 'admin',
}

const MGR_LISI: AuthUser = {
  id: 'usr_mgr_lisi',
  username: 'manager',
  displayName: '李四',
  role: 'manager',
}

const MGR_WANGWU: AuthUser = {
  id: 'usr_mgr_wangwu',
  username: 'wangwu',
  displayName: '王五',
  role: 'manager',
}

const MEMBER_QIANQI: AuthUser = {
  id: 'usr_member_qianqi',
  username: 'member',
  displayName: '钱七',
  role: 'member',
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

async function flushAsync() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  })
}

function setupFullstackFetch() {
  const db = openDatabase(':memory:')
  seedSmartTableDemo(db)
  const serverApp = createApp(db)
  const calls: Array<{ method: string; path: string }> = []
  let activeSessionToken: string | null = null

  const withCookieProxy = (req: Request, cookieHeader: string) =>
    cookieHeader
      ? new Proxy(req, {
          get(target, prop, receiver) {
            if (prop === 'headers') {
              return new Proxy(target.headers, {
                get(hTarget, hProp) {
                  if (hProp === 'get') {
                    return (name: string) =>
                      name.toLowerCase() === 'cookie' ? cookieHeader : hTarget.get(name)
                  }
                  const val = Reflect.get(hTarget, hProp, hTarget)
                  return typeof val === 'function' ? val.bind(hTarget) : val
                },
              })
            }
            const val = Reflect.get(target, prop, receiver)
            return typeof val === 'function' ? val.bind(target) : val
          },
        })
      : req

  const setUserSession = (userId: string | null) => {
    activeSessionToken = userId ? createSession(db, userId).token : null
  }

  const requestAsUser = (userId: string, path: string, init?: RequestInit) => {
    const token = createSession(db, userId).token
    const req = new Request(`http://localhost${path}`, init)
    return serverApp.fetch(withCookieProxy(req, `st_session=${token}`))
  }

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const parsed = new URL(rawUrl, 'http://localhost')
    const pathAndSearch = `${parsed.pathname}${parsed.search}`
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, path: pathAndSearch })

    const req = new Request(`http://localhost${pathAndSearch}`, init)
    const cookieHeader = activeSessionToken ? `st_session=${activeSessionToken}` : ''
    const res = await serverApp.fetch(withCookieProxy(req, cookieHeader))
    if (parsed.pathname === '/api/auth/login' && res.ok) {
      const body = (await res.clone().json()) as { user?: { id: string } }
      if (body.user?.id) {
        activeSessionToken = createSession(db, body.user.id).token
      }
    } else if (parsed.pathname === '/api/auth/logout' && res.ok) {
      activeSessionToken = null
    }
    return res
  })

  return { db, serverApp, calls, setUserSession, requestAsUser }
}

beforeEach(() => {
  canvasBridge.gridInstances = []
  canvasBridge.pivotInstances = []
  setUnauthorizedHandler(null)
  window.history.replaceState(null, '', '/')
  try {
    window.sessionStorage?.clear()
  } catch {
    // 忽略
  }
})

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
  setUnauthorizedHandler(null)
  vi.restoreAllMocks()
})

describe('一键分享入口权限裁剪（AppViewTabs / Toolbar / EntryWorkspace）', () => {
  const cols: SmartColumn[] = [
    { key: 'title', title: '标题', type: 'text', width: 120, required: true },
  ]
  const normalBundle: TableBundle = {
    meta: {
      id: 'tbl_1',
      name: '项目台账',
      kind: 'normal',
      columns: cols,
      views: [],
      summaries: {},
    },
    records: [{ _id: 'r1', title: '项目 A' }],
  }
  const advancedBundle: TableBundle = {
    meta: {
      id: 'tbl_adv',
      name: 'SQL 员工主数据',
      kind: 'advanced',
      primaryKeyField: 'emp_id',
      columns: cols,
      views: [],
      summaries: {},
    },
    records: [],
  }
  const view: WorkspaceView = {
    id: 'v1',
    appId: 'app_1',
    tableId: 'tbl_1',
    name: '明细表',
    type: 'table',
    sortOrder: 0,
    filterGroup: { conjunction: 'and', conditions: [] },
    quickFilterFields: [],
    sortRules: [],
  }

  test('仅当具有分享权限时展示分享入口，普通成员与 SQL 进阶表隐藏对外分享按钮', () => {
    const onShareApp = vi.fn<() => void>()
    const tabMount = mountComponent(
      createElement(AppViewTabs, {
        canConfigureApp: true,
        canShareApp: true,
        app: { id: 'app_1', name: '应用一', tableId: 'tbl_1', sortOrder: 0 },
        bundle: normalBundle,
        views: [view],
        activeViewId: 'v1',
        onSelectView: noop,
        onCreateView: noopAsync,
        onRenameView: noopAsync,
        onDeleteView: noopAsync,
        onReorderViews: noopAsync,
        onShareApp,
      }),
    )
    const shareAppBtn = Array.from(tabMount.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('分享应用'),
    )!
    expect(shareAppBtn).toBeDefined()
    act(() => shareAppBtn.click())
    expect(onShareApp).toHaveBeenCalledTimes(1)

    tabMount.rerender(
      createElement(AppViewTabs, {
        canConfigureApp: false,
        canShareApp: false,
        app: { id: 'app_1', name: '应用一', tableId: 'tbl_1', sortOrder: 0 },
        bundle: normalBundle,
        views: [view],
        activeViewId: 'v1',
        onSelectView: noop,
        onCreateView: noopAsync,
        onRenameView: noopAsync,
        onDeleteView: noopAsync,
        onReorderViews: noopAsync,
        onShareApp,
      }),
    )
    expect(tabMount.container.textContent).not.toContain('分享应用')

    // Toolbar: app 模式与 datasource normal 模式可见，member 不可见，advanced 数据源不可见
    const fullCaps: WorkspaceActionCapabilities = {
      canView: true,
      canEditRecords: true,
      canConfigure: true,
      canManagePermissions: true,
      canCreateShare: true,
      canManageDataSource: true,
      canAccessDataSources: true,
    }
    const memberCaps: WorkspaceActionCapabilities = {
      canView: true,
      canEditRecords: true,
      canConfigure: false,
      canManagePermissions: false,
      canCreateShare: false,
      canManageDataSource: false,
      canAccessDataSources: false,
    }
    const onOpenShare = vi.fn<() => void>()
    const tbMount = mountComponent(
      createElement(Toolbar, {
        capabilities: fullCaps,
        targetKind: 'app',
        tableMeta: normalBundle.meta,
        activeView: view,
        visibleColumns: cols,
        allComputedRecords: normalBundle.records,
        displayRecords: normalBundle.records,
        unresolvedConflictCount: 0,
        selectedRecordIds: [],
        watermarkEnabled: false,
        configDrawerOpen: false,
        onUpdateFilters: noop,
        onToggleConfigDrawer: noop,
        onAddRow: noopAsync,
        onDeleteSelectedRows: noopAsync,
        onOpenAddColumn: noop,
        onOpenColumnManager: noop,
        onOpenLookupWizard: noop,
        onCreateAppFromTable: noop,
        onJumpToFirstConflict: noop,
        onToggleWatermark: noop,
        onOpenShare,
        onNotify: noop,
      }),
    )
    const shareViewBtn = Array.from(tbMount.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('分享视图'),
    )!
    expect(shareViewBtn).toBeDefined()
    act(() => shareViewBtn.click())
    expect(onOpenShare).toHaveBeenCalledTimes(1)

    tbMount.rerender(
      createElement(Toolbar, {
        capabilities: memberCaps,
        targetKind: 'app',
        tableMeta: normalBundle.meta,
        activeView: view,
        visibleColumns: cols,
        allComputedRecords: normalBundle.records,
        displayRecords: normalBundle.records,
        unresolvedConflictCount: 0,
        selectedRecordIds: [],
        watermarkEnabled: false,
        configDrawerOpen: false,
        onUpdateFilters: noop,
        onToggleConfigDrawer: noop,
        onAddRow: noopAsync,
        onDeleteSelectedRows: noopAsync,
        onOpenAddColumn: noop,
        onOpenColumnManager: noop,
        onOpenLookupWizard: noop,
        onCreateAppFromTable: noop,
        onJumpToFirstConflict: noop,
        onToggleWatermark: noop,
        onOpenShare,
        onNotify: noop,
      }),
    )
    expect(tbMount.container.textContent).not.toContain('分享视图')

    tbMount.rerender(
      createElement(Toolbar, {
        capabilities: fullCaps,
        targetKind: 'datasource',
        tableMeta: advancedBundle.meta,
        visibleColumns: cols,
        allComputedRecords: [],
        displayRecords: [],
        unresolvedConflictCount: 0,
        selectedRecordIds: [],
        watermarkEnabled: false,
        configDrawerOpen: false,
        onUpdateFilters: noop,
        onToggleConfigDrawer: noop,
        onAddRow: noopAsync,
        onDeleteSelectedRows: noopAsync,
        onOpenAddColumn: noop,
        onOpenColumnManager: noop,
        onOpenLookupWizard: noop,
        onCreateAppFromTable: noop,
        onJumpToFirstConflict: noop,
        onToggleWatermark: noop,
        onOpenShare,
        onNotify: noop,
      }),
    )
    expect(tbMount.container.textContent).not.toContain('对外分享')

    // EntryWorkspace: canShare=true 渲染「对外分享」，member（即使可编辑 readonly=false）canShare=false 隐藏
    const onOpenEntryShare = vi.fn<() => void>()
    const entryMount = mountComponent(
      createElement(EntryWorkspace, {
        bundle: normalBundle,
        readonly: false,
        canShare: true,
        onOpenShare: onOpenEntryShare,
        onCreateRecord: noopAsync,
        onUpdateRecord: noopAsync,
        onDeleteRecords: noopAsync,
        onBatchAppendRecords: noopAsync,
      }),
    )
    const entryShareBtn = Array.from(entryMount.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('对外分享'),
    )!
    expect(entryShareBtn).toBeDefined()
    act(() => entryShareBtn.click())
    expect(onOpenEntryShare).toHaveBeenCalledTimes(1)

    entryMount.rerender(
      createElement(EntryWorkspace, {
        bundle: normalBundle,
        readonly: false,
        canShare: false,
        onOpenShare: onOpenEntryShare,
        onCreateRecord: noopAsync,
        onUpdateRecord: noopAsync,
        onDeleteRecords: noopAsync,
        onBatchAppendRecords: noopAsync,
      }),
    )
    expect(entryMount.container.textContent).not.toContain('对外分享')
  })
})

describe('ShareModal 与 SharesPage 全生命周期及角色边界（SQLite + Hono）', () => {
  test('ShareModal 支持切换应用/视图目标、设置有效期与密码、复制 /s/:token 链接及立即失效', async () => {
    const { db, setUserSession } = setupFullstackFetch()
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    try {
      setUserSession(MGR_LISI.id)
      const onNotify = vi.fn<(type: 'success' | 'error' | 'info', msg: string) => void>()

      const { container } = mountComponent(
        createElement(ShareModal, {
          open: true,
          targets: [
            { targetType: 'app', targetId: 'app_projects', targetName: '项目运营管理台' },
            {
              targetType: 'view',
              targetId: 'wv_projects_table',
              targetName: '项目运营管理台 · 项目跟进总台账',
            },
          ],
          initialTarget: { targetType: 'view', targetId: 'wv_projects_table' },
          onClose: noop,
          onNotify,
        }),
      )
      await flushAsync()

      expect(container.querySelector('[data-testid="share-modal"]')).not.toBeNull()
      expect(container.textContent).toContain('项目运营管理台 · 项目跟进总台账')

      // 切换分享目标为整个应用，并选择「30 天」有效期与填写密码
      const appOption = Array.from(
        container.querySelectorAll('[role="radiogroup"][aria-label="选择分享对象"] [role="radio"]'),
      ).find((el) => el.textContent?.includes('智能表格应用')) as HTMLButtonElement
      act(() => appOption.click())
      await flushAsync()

      const expiry30 = Array.from(
        container.querySelectorAll('[role="radiogroup"][aria-label="分享有效期"] [role="radio"]'),
      ).find((el) => el.textContent?.includes('30 天')) as HTMLButtonElement
      act(() => expiry30.click())

      const pwdInput = container.querySelector('#st-share-password') as HTMLInputElement
      act(() => setInputValue(pwdInput, 'demo-pass'))

      const form = container.querySelector('form')!
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await flushAsync()

      const banner = container.querySelector('[data-testid="share-created-banner"]')!
      expect(banner).not.toBeNull()
      expect(banner.textContent).toContain('已设密码')
      expect(banner.textContent).toContain('/s/')
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/s\/.+$/))

      // 在列表内可见该条记录且支持立即手动失效
      const revokeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('立即失效'),
      ) as HTMLButtonElement
      await act(async () => revokeBtn.click())
      await flushAsync()

      expect(container.textContent).toContain('已失效')
      expect(container.querySelector('[data-testid="share-created-banner"]')).toBeNull()
    } finally {
      db.close()
    }
  })

  test('SharesPage 按角色隔离（管理员全空间 vs 负责人仅本人 vs 普通成员禁止访问）并支持筛选、复制与一键失效', async () => {
    const { db, setUserSession, requestAsUser } = setupFullstackFetch()
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    try {
      // 由李四、王五分别创建一条分享链接
      const lisiShareRes = await requestAsUser(MGR_LISI.id, '/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'app',
          targetId: 'app_projects',
          expiresInDays: 7,
          password: '123',
        }),
      })
      const lisiShare = ((await lisiShareRes.json()) as { share: { id: string; token: string } })
        .share

      const wangwuShareRes = await requestAsUser(MGR_WANGWU.id, '/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'entry', targetId: 'tbl_tickets' }),
      })
      const wangwuShare = (
        (await wangwuShareRes.json()) as { share: { id: string; token: string } }
      ).share

      // 1) 普通成员钱七：展示 shares-forbidden，不触发请求
      const memberMount = mountComponent(
        createElement(SharesPage, {
          currentUser: MEMBER_QIANQI,
          userCapabilities: computeUserCapabilities(MEMBER_QIANQI),
          onBackToWorkbench: noop,
        }),
      )
      await flushAsync()
      expect(memberMount.container.querySelector('[data-testid="shares-forbidden"]')).not.toBeNull()
      memberMount.unmount()

      // 2) 负责人李四：只看到自己创建的 app_projects 分享，看不到王五创建的 tbl_suppliers 分享
      setUserSession(MGR_LISI.id)
      const lisiMount = mountComponent(
        createElement(SharesPage, {
          currentUser: MGR_LISI,
          userCapabilities: computeUserCapabilities(MGR_LISI),
        }),
      )
      await flushAsync()
      expect(lisiMount.container.textContent).toContain('负责人 · 仅本人创建的分享链接')
      expect(
        lisiMount.container.querySelector(`[data-testid="share-row-${lisiShare.id}"]`),
      ).not.toBeNull()
      expect(
        lisiMount.container.querySelector(`[data-testid="share-row-${wangwuShare.id}"]`),
      ).toBeNull()
      lisiMount.unmount()

      // 3) 管理员：看到全部 2 条链接，可按状态过滤、复制链接与一键失效王五的链接
      setUserSession(ADMIN_USER.id)
      const adminMount = mountComponent(
        createElement(SharesPage, {
          currentUser: ADMIN_USER,
          userCapabilities: computeUserCapabilities(ADMIN_USER),
        }),
      )
      await flushAsync()
      expect(adminMount.container.textContent).toContain('管理员 · 全空间分享链接')
      expect(
        adminMount.container.querySelector(`[data-testid="share-row-${lisiShare.id}"]`),
      ).not.toBeNull()
      expect(
        adminMount.container.querySelector(`[data-testid="share-row-${wangwuShare.id}"]`),
      ).not.toBeNull()
      expect(adminMount.container.textContent).toContain('已设密码')
      expect(adminMount.container.textContent).toContain('免密访问')
      expect(adminMount.container.textContent).toContain('永久有效')

      const copyBtn = adminMount.container.querySelector(
        'button[aria-label^="复制分享链接 客户工单与 SLA 追踪"]',
      ) as HTMLButtonElement
      await act(async () => copyBtn.click())
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/s/${wangwuShare.token}`))

      const revokeBtn = adminMount.container.querySelector(
        `button[aria-label="失效分享链接 ${wangwuShare.id}"]`,
      ) as HTMLButtonElement
      await act(async () => revokeBtn.click())
      await flushAsync()

      const revokedRow = adminMount.container.querySelector(
        `[data-testid="share-row-${wangwuShare.id}"]`,
      )!
      expect(revokedRow.textContent).toContain('已失效')

      // 切到「已失效」Tab 只显示 wangwuShare
      const revokedTab = Array.from(adminMount.container.querySelectorAll('[role="tab"]')).find(
        (el) => el.textContent?.includes('已失效'),
      ) as HTMLButtonElement
      act(() => revokedTab.click())
      expect(
        adminMount.container.querySelector(`[data-testid="share-row-${lisiShare.id}"]`),
      ).toBeNull()
      expect(
        adminMount.container.querySelector(`[data-testid="share-row-${wangwuShare.id}"]`),
      ).not.toBeNull()
    } finally {
      db.close()
    }
  })
})

describe('/s/:token 免登录访客访问页全场景（密码门禁 / 失效过期 / 应用与单视图只读交互 / 录入表匿名填报）', () => {
  test('失效、过期与不存在链接展示明确错误状态页', async () => {
    const { db, requestAsUser } = setupFullstackFetch()
    try {
      const revokedCreated = (
        (await (
          await requestAsUser(ADMIN_USER.id, '/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'app', targetId: 'app_projects' }),
          })
        ).json()) as { share: { id: string; token: string } }
      ).share
      await requestAsUser(ADMIN_USER.id, `/api/shares/${revokedCreated.id}/revoke`, {
        method: 'POST',
      })

      const expiredCreated = (
        (await (
          await requestAsUser(ADMIN_USER.id, '/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetType: 'app',
              targetId: 'app_projects',
              expiresAt: '2020-01-01T00:00:00.000Z',
            }),
          })
        ).json()) as { share: { id: string; token: string } }
      ).share

      const revokedMount = mountComponent(
        createElement(ShareAccessPage, { token: revokedCreated.token }),
      )
      await flushAsync()
      expect(
        revokedMount.container.querySelector('[data-testid="share-access-error"]')?.textContent,
      ).toContain('分享链接已失效')
      revokedMount.unmount()

      const expiredMount = mountComponent(
        createElement(ShareAccessPage, { token: expiredCreated.token }),
      )
      await flushAsync()
      expect(
        expiredMount.container.querySelector('[data-testid="share-access-error"]')?.textContent,
      ).toContain('分享链接已过期')
      expiredMount.unmount()

      const missingMount = mountComponent(
        createElement(ShareAccessPage, { token: 'not_found_tok' }),
      )
      await flushAsync()
      expect(
        missingMount.container.querySelector('[data-testid="share-access-error"]')?.textContent,
      ).toContain('分享链接不存在')
    } finally {
      db.close()
    }
  })

  test('密码保护的应用分享解锁后支持多视图切换、临时筛选排序、透视展开折叠与只读下钻抽屉', async () => {
    const { db, calls, requestAsUser } = setupFullstackFetch()
    try {
      // 王五为 app_tickets 创建带密码分享（tbl_tickets 为 self + assignee，故访客仅见王五负责的行 rec_tkt_003）
      // 先为其补建一个明细表首选排序 + 一个透视分析视图以便完整覆盖多视图切换与透视下钻
      await requestAsUser(MGR_WANGWU.id, '/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_tickets',
          name: '工单处理透视分析',
          type: 'pivot',
          pivotConfig: {
            rowDimensions: ['issue_category'],
            columnDimensions: ['ticket_status'],
            measures: [{ key: '__count__', title: '工单数', field: '__count__', agg: 'count' }],
            showGrandTotal: true,
            collapsible: true,
          },
        }),
      })
      const createdRes = await requestAsUser(MGR_WANGWU.id, '/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'app',
          targetId: 'app_tickets',
          password: 'vip-pin',
        }),
      })
      const share = ((await createdRes.json()) as { share: { token: string } }).share

      // 管理员同时再创建一条仅限管理员自己可见的视图，验证不会被王五的分享泄露
      await requestAsUser(ADMIN_USER.id, '/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_tickets',
          name: '高管密级工单视图',
          type: 'table',
          visibilityScope: 'self',
        }),
      })

      // 在 /s/:token 上免登录渲染 App（验证无 NavRail/Sidebar 且不查 /api/auth/me）
      window.history.replaceState(null, '', `/s/${share.token}`)
      const { container } = mountComponent(createElement(App))
      await flushAsync()

      expect(container.querySelector('[aria-label="主导航栏"]')).toBeNull()
      expect(container.querySelector('[data-testid="share-password-gate"]')).not.toBeNull()
      expect(calls.some((c) => c.path === '/api/auth/me')).toBe(false)

      // 输错密码给出提示
      const pwdInput = container.querySelector('#st-share-password') as HTMLInputElement
      act(() => setInputValue(pwdInput, 'wrong-pin'))
      await act(async () => {
        container
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await flushAsync()
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('访问密码错误')

      // 输入正确密码解锁
      act(() => setInputValue(pwdInput, 'vip-pin'))
      await act(async () => {
        container
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await flushAsync()

      expect(container.querySelector('[data-testid="share-guest-workspace"]')).not.toBeNull()
      expect(container.textContent).toContain('售后工单与 SLA 中心')
      expect(container.textContent).not.toContain('高管密级工单视图')
      expect(container.textContent).not.toContain('数据源')
      expect(container.textContent).not.toContain('新增行')
      expect(container.textContent).not.toContain('视图配置')

      // 首屏为看板视图（严格只读）
      expect(container.querySelector('[data-testid="kanban-view"]')?.textContent).toContain(
        '只读浏览',
      )

      // 切到明细台账视图，验证网格严格只读且行级数据不超过创建者王五的权限范围（仅 1 条 rec_tkt_003）
      const tableTab = Array.from(
        container.querySelectorAll('[aria-label="当前智能表格视图"] button'),
      ).find((b) => b.textContent?.includes('工单 SLA 明细台账')) as HTMLButtonElement
      act(() => tableTab.click())
      await flushAsync()

      const gridInst = canvasBridge.gridInstances[canvasBridge.gridInstances.length - 1]!
      expect(gridInst.options.readonly).toBe(true)
      expect(gridInst.lastData.records.map((r) => r._id)).toEqual(['rec_tkt_003'])

      // 临时筛选与列头排序仅前端生效，不发任何 PATCH /api/views
      act(() => {
        gridInst.options.onHeaderSortClick?.({
          column: gridInst.lastData.columns[0]!,
          field: gridInst.lastData.columns[0]!.key,
          colIndex: 0,
          additive: false,
          rect: { x: 0, y: 0, width: 100, height: 32 },
        })
      })
      const filterBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('临时筛选'),
      )!
      act(() => filterBtn.click())
      const addCondBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('添加条件'),
      )!
      act(() => addCondBtn.click())
      await flushAsync()
      expect(calls.some((c) => c.method === 'PATCH' && c.path.startsWith('/api/views'))).toBe(false)

      // 清空条件以便后续透视下钻仍有样本
      const clearBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('清空全部筛选'),
      )
      if (clearBtn) {
        act(() => clearBtn.click())
      }

      // 切换到透视分析视图并验证展开/折叠与下钻抽屉只读浏览
      const pivotTab = Array.from(
        container.querySelectorAll('[aria-label="当前智能表格视图"] button'),
      ).find((b) => b.textContent?.includes('工单处理透视分析')) as HTMLButtonElement
      expect(pivotTab).toBeDefined()
      act(() => pivotTab.click())
      await flushAsync()

      const expandBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('展开全部'),
      )!
      const collapseBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('收起全部'),
      )!
      act(() => {
        expandBtn.click()
        collapseBtn.click()
      })

      const pivotInst = canvasBridge.pivotInstances[canvasBridge.pivotInstances.length - 1]!
      expect(pivotInst.expandAllCount).toBe(1)
      expect(pivotInst.collapseAllCount).toBe(1)

      const drillPayload: PivotCellDrillEvent = {
        col: 0,
        row: 0,
        records: gridInst.lastData.records,
      }
      act(() => {
        pivotInst.options.onCellDrill?.(drillPayload)
      })
      await flushAsync()

      const drillDialog = container.querySelector('[role="dialog"][aria-label="透视下钻抽屉"]')!
      expect(drillDialog).not.toBeNull()
      expect(drillDialog.textContent).toContain('当前为只读查看态')
      const drillGrid = canvasBridge.gridInstances[canvasBridge.gridInstances.length - 1]!
      expect(drillGrid.options.readonly).toBe(true)

      const dimTab = Array.from(drillDialog.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('按下一维度下钻'),
      )!
      act(() => dimTab.click())
      expect(drillDialog.textContent).toContain('选择拆解维度')
    } finally {
      db.close()
    }
  })

  test('单视图分享仅暴露单个视图且不渲染多视图 Tab 栏；录入表分享支持免登录校验填报并保持匿名隔离', async () => {
    const { db, requestAsUser } = setupFullstackFetch()
    try {
      // 1) 单视图分享
      const viewShareRes = await requestAsUser(ADMIN_USER.id, '/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'view', targetId: 'wv_projects_table' }),
      })
      const viewShare = ((await viewShareRes.json()) as { share: { token: string } }).share

      const viewMount = mountComponent(createElement(ShareAccessPage, { token: viewShare.token }))
      await flushAsync()

      expect(
        viewMount.container.querySelector('[data-testid="share-guest-workspace"]'),
      ).not.toBeNull()
      expect(viewMount.container.querySelector('[aria-label="智能表格视图栏"]')).toBeNull()
      expect(viewMount.container.textContent).toContain('项目跟进总台账')
      expect(
        canvasBridge.gridInstances[canvasBridge.gridInstances.length - 1]!.options.readonly,
      ).toBe(true)
      viewMount.unmount()

      // 2) 普通录入表分享（tbl_suppliers 有 8 条内部种子记录，对匿名访客必须不可见）
      const entryShareRes = await requestAsUser(ADMIN_USER.id, '/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'entry', targetId: 'tbl_suppliers' }),
      })
      const entryShare = ((await entryShareRes.json()) as { share: { token: string } }).share

      const entryMount = mountComponent(createElement(ShareAccessPage, { token: entryShare.token }))
      await flushAsync()

      const c = entryMount.container
      expect(c.querySelector('[data-testid="share-guest-entry"]')).not.toBeNull()
      expect(c.textContent).toContain('供应商名录')
      expect(c.textContent).toContain('已填报 0 条')
      expect(c.textContent).not.toContain('华信云数科')

      // 填入非法评分值触发数值类型校验拦截
      const form = c.querySelector('form')!
      act(() => {
        setInputValue(c.querySelector('#st-entry-field-rating') as HTMLInputElement, 'not-a-number')
      })
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      expect(c.querySelector('[data-field-key="rating"]')?.getAttribute('data-field-error')).toBe(
        'true',
      )

      // 填写合法供应商记录并提交
      act(() => {
        setInputValue(c.querySelector('#st-entry-field-supplier_id') as HTMLInputElement, 'SUP-999')
        setInputValue(
          c.querySelector('#st-entry-field-supplier_name') as HTMLInputElement,
          '免登录测试供应商',
        )
        setInputValue(c.querySelector('#st-entry-field-rating') as HTMLInputElement, '4.85')
      })
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await flushAsync()

      expect(c.querySelector('[data-testid="entry-submit-success"]')).not.toBeNull()
      expect(c.textContent).toContain('已填报 1 条')
      // 本次会话已填报记录网格仅展示刚提交的 1 条，不混入内部 8 条历史数据
      const submittedGrid = canvasBridge.gridInstances[canvasBridge.gridInstances.length - 1]!
      expect(submittedGrid.options.readonly).toBe(true)
      expect(submittedGrid.lastData.records).toHaveLength(1)
      expect(submittedGrid.lastData.records[0]?.supplier_id).toBe('SUP-999')
      expect(submittedGrid.lastData.records[0]?.createdBy).toBe('guest')

      // 验证表单已清空便于连续填报，且记录已持久化在 SQLite
      expect((c.querySelector('#st-entry-field-supplier_id') as HTMLInputElement).value).toBe('')
      const checkRes = await requestAsUser(ADMIN_USER.id, '/api/tables/tbl_suppliers')
      const checkBundle = (await checkRes.json()) as TableBundle
      expect(checkBundle.records.some((r) => r.supplier_id === 'SUP-999')).toBe(true)
    } finally {
      db.close()
    }
  })

  test('App 主壳串联：工作台分享应用/视图、录入端对外分享与 /shares 管理页面端到端闭环', async () => {
    const { db, setUserSession } = setupFullstackFetch()
    try {
      setUserSession(ADMIN_USER.id)
      const { container } = mountComponent(createElement(App))
      await flushAsync()

      // 1) 在工作台点击「分享应用」，通过 ShareModal 创建一条应用分享链接
      const shareAppBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('分享应用'),
      )!
      act(() => shareAppBtn.click())
      await flushAsync()

      const modal = container.querySelector('[data-testid="share-modal"]')!
      expect(modal).not.toBeNull()
      await act(async () => {
        modal
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      })
      await flushAsync()
      expect(modal.querySelector('[data-testid="share-created-banner"]')).not.toBeNull()

      const closeModalBtn = modal.querySelector(
        'button[aria-label="关闭分享弹窗"]',
      ) as HTMLButtonElement
      act(() => closeModalBtn.click())
      expect(container.querySelector('[data-testid="share-modal"]')).toBeNull()

      // 2) 切换到数据录入端点击「对外分享」，打开录入表分享弹窗
      const entryRailBtn = container.querySelector(
        'button[aria-label="数据录入"]',
      ) as HTMLButtonElement
      act(() => entryRailBtn.click())
      await flushAsync()

      const entryShareBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('对外分享'),
      )!
      act(() => entryShareBtn.click())
      await flushAsync()
      const entryModal = container.querySelector('[data-testid="share-modal"]')!
      expect(entryModal.textContent).toContain('数据录入表')
      act(() =>
        (
          entryModal.querySelector('button[aria-label="关闭分享弹窗"]') as HTMLButtonElement
        ).click(),
      )

      // 3) 前往 /shares 分享管理页查看并失效刚创建的分享链接
      const sharesRailBtn = container.querySelector(
        'button[aria-label="分享管理"]',
      ) as HTMLButtonElement
      act(() => sharesRailBtn.click())
      await flushAsync()

      const sharesPage = container.querySelector('[data-testid="shares-page"]')!
      expect(sharesPage).not.toBeNull()
      expect(sharesPage.textContent).toContain('项目运营管理台')

      const revokeBtn = Array.from(sharesPage.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('立即失效'),
      )!
      await act(async () => revokeBtn.click())
      await flushAsync()
      expect(sharesPage.textContent).toContain('已失效')
    } finally {
      db.close()
    }
  })
})
