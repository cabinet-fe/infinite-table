// 服务端身份认证、两层权限模型、createdBy 自动写入、一键分享与访客数据边界集成测试。
import { describe, expect, test } from 'vitest'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedSmartTableDemo } from '../../src/server/seed'
import type {
  AllAppsResponse,
  AllTablesResponse,
  AllViewsResponse,
  AuthSessionResponse,
  BatchImportRecordsResponse,
  CreateAppResponse,
  CreateShareResponse,
  DemoAccountsResponse,
  ListSharesResponse,
  PermissionsOverviewResponse,
  ShareAccessResponse,
  ShareAccessUnlockedResponse,
  TableBundle,
  VerifySharePasswordResponse,
} from '../../src/shared/api-types'
import type { ShareRecord, SmartApp, SmartRecord, WorkspaceView } from '../../src/shared/schema'
import {
  createAuthedClient,
  extractCookiePair,
  loginAsAdmin,
  loginAsManager,
  loginAsMember,
  mergeCookieHeader,
} from './testing/auth-helper'

function setupApp() {
  const db = openDatabase(':memory:')
  seedSmartTableDemo(db)
  const rawApp = createApp(db)
  return { db, rawApp }
}

describe('身份认证、会话 Cookie 与全局 401 鉴权守卫', () => {
  test('未登录访问受保护 /api/* 一律返回 401，/api/auth/demo-accounts 公开可读且无密码哈希', async () => {
    const { db, rawApp } = setupApp()
    try {
      const protectedCalls: Array<[string, RequestInit?]> = [
        ['/api/auth/me'],
        ['/api/tables'],
        ['/api/tables/tbl_projects'],
        ['/api/apps'],
        ['/api/views'],
        ['/api/permissions'],
        ['/api/shares'],
        ['/api/tables', { method: 'POST', body: JSON.stringify({ name: 'x' }) }],
        ['/api/import/commit', { method: 'POST', body: '{}' }],
        ['/api/reset-seed', { method: 'POST' }],
      ]
      for (const [path, init] of protectedCalls) {
        const res = await rawApp.request(path, init)
        expect(res.status, `${path} 应返回 401`).toBe(401)
      }

      const demoRes = await rawApp.request('/api/auth/demo-accounts')
      expect(demoRes.status).toBe(200)
      const demoBody = (await demoRes.json()) as DemoAccountsResponse
      expect(demoBody.accounts.map((a) => a.username)).toEqual([
        'admin',
        'manager',
        'wangwu',
        'member',
      ])
      expect(JSON.stringify(demoBody)).not.toContain('passwordHash')
      expect(JSON.stringify(demoBody)).not.toContain('scrypt$')
    } finally {
      db.close()
    }
  })

  test('登录/登出全流程与过期会话自动失效清理', async () => {
    const { db, rawApp } = setupApp()
    try {
      const badLogin = await rawApp.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
      })
      expect(badLogin.status).toBe(401)

      const loginRes = await rawApp.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'manager', password: 'manager123' }),
      })
      expect(loginRes.status).toBe(200)
      const setCookie = loginRes.headers.get('set-cookie') ?? ''
      expect(setCookie).toContain('HttpOnly')
      expect(setCookie).toContain('st_session=')
      const sessionCookie = extractCookiePair(loginRes, 'st_session')
      const loginBody = (await loginRes.json()) as AuthSessionResponse
      expect(loginBody.user.displayName).toBe('李四')
      expect(loginBody.user.role).toBe('manager')
      expect(loginBody.capabilities.canAccessDataSources).toBe(true)
      expect(loginBody.capabilities.canResetSeed).toBe(false)

      const authed = createAuthedClient(rawApp, sessionCookie)
      const meRes = await authed.request('/api/auth/me')
      expect(meRes.status).toBe(200)
      const meBody = (await meRes.json()) as AuthSessionResponse
      expect(meBody.user.id).toBe('usr_mgr_lisi')

      // 登出后原会话 Cookie 立即失效
      const logoutRes = await authed.request('/api/auth/logout', { method: 'POST' })
      expect(logoutRes.status).toBe(200)
      const afterLogoutMe = await authed.request('/api/auth/me')
      expect(afterLogoutMe.status).toBe(401)

      // 模拟数据库会话过期：访问时自动返回 401 并清理过期记录
      const { cookie: adminCookie } = await loginAsAdmin(rawApp)
      db.query("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z'").run()
      const expiredMe = await createAuthedClient(rawApp, adminCookie).request('/api/auth/me')
      expect(expiredMe.status).toBe(401)
      const remaining = db.query('SELECT COUNT(*) AS cnt FROM sessions').get() as { cnt: number }
      expect(remaining.cnt).toBe(0)
    } finally {
      db.close()
    }
  })
})

describe('两层权限模型、createdBy 自动写入与 403 越权拦截', () => {
  test('种子示范策略下不同角色登录所见应用、视图与数据行严格按两层策略裁剪', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const mgrLisi = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'manager')).cookie)
      const member = createAuthedClient(rawApp, (await loginAsMember(rawApp)).cookie)

      // 管理员看全空间：7 应用、17 视图、16 项目、18 工单
      const adminApps = ((await (await admin.request('/api/apps')).json()) as AllAppsResponse).apps
      const adminViews = ((await (await admin.request('/api/views')).json()) as AllViewsResponse)
        .views
      const adminTables = ((await (await admin.request('/api/tables')).json()) as AllTablesResponse)
        .tables
      expect(adminApps).toHaveLength(7)
      expect(adminViews).toHaveLength(17)
      expect(adminTables.find((t) => t.meta.id === 'tbl_projects')!.records).toHaveLength(16)
      expect(adminTables.find((t) => t.meta.id === 'tbl_tickets')!.records).toHaveLength(18)

      // 负责人 李四：看不见管理员 self 的 app_exec_revenue；可见 wv_exec_dashboard；
      // tbl_projects 为 manager 范围看全 16 行；tbl_tickets 为 self + assignee 仅看李四行
      const lisiApps = ((await (await mgrLisi.request('/api/apps')).json()) as AllAppsResponse).apps
      const lisiViews = ((await (await mgrLisi.request('/api/views')).json()) as AllViewsResponse)
        .views
      const lisiTables = (
        (await (await mgrLisi.request('/api/tables')).json()) as AllTablesResponse
      ).tables
      expect(lisiApps.some((a) => a.id === 'app_exec_revenue')).toBe(false)
      expect(lisiApps).toHaveLength(6)
      expect(lisiViews.some((v) => v.id === 'wv_exec_dashboard')).toBe(true)
      expect(lisiTables.find((t) => t.meta.id === 'tbl_projects')!.records).toHaveLength(16)
      const lisiTickets = lisiTables.find((t) => t.meta.id === 'tbl_tickets')!.records
      expect(lisiTickets.map((r) => r._id)).toEqual(['rec_tkt_002'])

      // 普通成员 钱七：仅见 4 个 all 应用；看不见 managers 视图 wv_exec_dashboard；
      // tbl_projects（manager+owner_name）与 tbl_tickets（self+assignee）均仅见 钱七 相关行
      const memApps = ((await (await member.request('/api/apps')).json()) as AllAppsResponse).apps
      const memViews = ((await (await member.request('/api/views')).json()) as AllViewsResponse)
        .views
      const memTables = ((await (await member.request('/api/tables')).json()) as AllTablesResponse)
        .tables
      expect(memApps.map((a) => a.id)).toEqual([
        'app_projects',
        'app_tickets',
        'app_inventory',
        'app_suppliers',
      ])
      expect(memViews.some((v) => v.id === 'wv_exec_dashboard')).toBe(false)
      expect(
        memTables.find((t) => t.meta.id === 'tbl_projects')!.records.map((r) => r._id),
      ).toEqual(['rec_prj_005'])
      expect(memTables.find((t) => t.meta.id === 'tbl_tickets')!.records.map((r) => r._id)).toEqual(
        ['rec_tkt_005'],
      )
    } finally {
      db.close()
    }
  })

  test('普通成员调用建表/删表/改配置/数据源/权限/分享/只读写入一律返回 403，且隔离私有表', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const member = createAuthedClient(rawApp, (await loginAsMember(rawApp)).cookie)

      // 管理员创建一张私有表（无对成员开放的应用）
      const secretRes = await admin.request('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '薪酬机密表' }),
      })
      expect(secretRes.status).toBe(201)
      const secretBundle = (await secretRes.json()) as TableBundle

      const memTables = ((await (await member.request('/api/tables')).json()) as AllTablesResponse)
        .tables
      expect(memTables.some((t) => t.meta.id === secretBundle.meta.id)).toBe(false)
      expect((await member.request(`/api/tables/${secretBundle.meta.id}`)).status).toBe(403)
      expect((await member.request('/api/apps/app_exec_revenue')).status).toBe(403)
      expect((await member.request('/api/views/wv_exec_dashboard')).status).toBe(403)

      const forbiddenCalls: Array<[string, RequestInit]> = [
        ['/api/tables', { method: 'POST', body: JSON.stringify({ name: '越权表' }) }],
        ['/api/tables/tbl_projects/meta', { method: 'PUT', body: JSON.stringify({ meta: {} }) }],
        ['/api/tables/tbl_projects', { method: 'DELETE' }],
        ['/api/tables/tbl_projects/sync', { method: 'POST' }],
        ['/api/import/commit', { method: 'POST', body: '{}' }],
        ['/api/reset-seed', { method: 'POST' }],
        [
          '/api/apps',
          { method: 'POST', body: JSON.stringify({ name: 'x', tableId: 'tbl_projects' }) },
        ],
        ['/api/apps/app_projects', { method: 'PATCH', body: JSON.stringify({ name: '改名' }) }],
        ['/api/apps/app_projects', { method: 'DELETE' }],
        [
          '/api/apps/reorder',
          { method: 'PUT', body: JSON.stringify({ appIds: ['app_projects'] }) },
        ],
        [
          '/api/views',
          {
            method: 'POST',
            body: JSON.stringify({ name: 'v', type: 'table', appId: 'app_projects' }),
          },
        ],
        [
          '/api/views/wv_projects_table',
          { method: 'PATCH', body: JSON.stringify({ name: '改名' }) },
        ],
        ['/api/views/wv_projects_table', { method: 'DELETE' }],
        [
          '/api/views/reorder',
          { method: 'PUT', body: JSON.stringify({ viewIds: ['wv_projects_table'] }) },
        ],
        ['/api/permissions', { method: 'GET' }],
        [
          '/api/permissions/apps/app_projects',
          { method: 'PUT', body: JSON.stringify({ memberAccess: 'editable' }) },
        ],
        [
          '/api/permissions/views/wv_projects_table',
          { method: 'PUT', body: JSON.stringify({ memberAccess: 'editable' }) },
        ],
        [
          '/api/permissions/tables/tbl_projects',
          { method: 'PUT', body: JSON.stringify({ rowScope: 'all' }) },
        ],
        ['/api/shares', { method: 'GET' }],
        [
          '/api/shares',
          { method: 'POST', body: JSON.stringify({ targetType: 'app', targetId: 'app_projects' }) },
        ],
        ['/api/shares/shr_none/revoke', { method: 'POST' }],
        // app_projects 对普通成员为 readonly，写记录与看板拖拽返回 403
        [
          '/api/tables/tbl_projects/records',
          { method: 'POST', body: JSON.stringify({ record: { project_name: '越权新增' } }) },
        ],
        [
          '/api/tables/tbl_projects/records/rec_prj_005',
          { method: 'PATCH', body: JSON.stringify({ patch: { progress: 99 } }) },
        ],
        ['/api/tables/tbl_projects/records/rec_prj_005', { method: 'DELETE' }],
        [
          '/api/views/wv_projects_kanban/kanban/cards/rec_prj_005',
          { method: 'PATCH', body: JSON.stringify({ targetValue: '已交付' }) },
        ],
      ]

      for (const [path, init] of forbiddenCalls) {
        const res = await member.request(path, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string>),
          },
        })
        expect(res.status, `普通成员调用 ${init.method ?? 'GET'} ${path} 应返回 403`).toBe(403)
      }
    } finally {
      db.close()
    }
  })

  test('可编辑资源下新增/批量导入自动写入 createdBy（防客户端伪造），且行级越权修改/删除返回 403', async () => {
    const { db, rawApp } = setupApp()
    try {
      const member = createAuthedClient(rawApp, (await loginAsMember(rawApp)).cookie)

      // app_tickets 授权 member 为 editable，tbl_tickets 为 self + assignee
      const createRes = await member.request('/api/tables/tbl_tickets/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          record: {
            ticket_id: 'TKT-MEM-001',
            customer_name: '钱七自建工单客户',
            assignee: '张三',
            ticket_status: '待受理',
            // 试图伪造 createdBy 为管理员，服务端必须覆盖为当前登录用户 ID
            createdBy: 'usr_admin',
          },
        }),
      })
      expect(createRes.status).toBe(201)
      const { record: created } = (await createRes.json()) as { record: SmartRecord }
      expect(created.createdBy).toBe('usr_member_qianqi')

      // 批量导入自动写 createdBy
      const batchRes = await member.request('/api/tables/tbl_tickets/records/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: [
            { ticket_id: 'TKT-MEM-002', customer_name: '批量客户A', createdBy: 'usr_admin' },
          ],
        }),
      })
      expect(batchRes.status).toBe(201)
      const batchBody = (await batchRes.json()) as BatchImportRecordsResponse
      expect(batchBody.records[0]?.createdBy).toBe('usr_member_qianqi')

      // 钱七可见自己创建的记录 + 自己名下 rec_tkt_005，可修改自己的记录，不能修改他人记录 rec_tkt_002
      const patchOwnRes = await member.request(`/api/tables/tbl_tickets/records/${created._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { ticket_status: '处理中', createdBy: 'usr_admin' } }),
      })
      expect(patchOwnRes.status).toBe(200)
      const patchedOwn = (await patchOwnRes.json()) as { record: SmartRecord }
      expect(patchedOwn.record.createdBy).toBe('usr_member_qianqi')
      expect(patchedOwn.record.ticket_status).toBe('处理中')

      const patchOthersRes = await member.request('/api/tables/tbl_tickets/records/rec_tkt_002', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { ticket_status: '已关闭' } }),
      })
      expect(patchOthersRes.status).toBe(403)

      const delOthersRes = await member.request('/api/tables/tbl_tickets/records/rec_tkt_002', {
        method: 'DELETE',
      })
      expect(delOthersRes.status).toBe(403)

      const delOwnRes = await member.request(`/api/tables/tbl_tickets/records/${created._id}`, {
        method: 'DELETE',
      })
      expect(delOwnRes.status).toBe(200)
    } finally {
      db.close()
    }
  })

  test('权限配置接口校验 person 列、负责人越权隔离与实时生效', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const mgrLisi = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'manager')).cookie)
      const member = createAuthedClient(rawApp, (await loginAsMember(rawApp)).cookie)

      // 管理员在 /api/permissions 看全空间；负责人李四只看本人创建/负责的资源（不含王五创建的 app_tickets / tbl_tickets）
      const adminPerm = (await (
        await admin.request('/api/permissions')
      ).json()) as PermissionsOverviewResponse
      expect(adminPerm.apps).toHaveLength(7)
      expect(adminPerm.tables).toHaveLength(6)

      const lisiPerm = (await (
        await mgrLisi.request('/api/permissions')
      ).json()) as PermissionsOverviewResponse
      expect(lisiPerm.apps.some((a) => a.id === 'app_projects')).toBe(true)
      expect(lisiPerm.apps.some((a) => a.id === 'app_tickets')).toBe(false)
      expect(lisiPerm.tables.some((t) => t.id === 'tbl_projects')).toBe(true)
      expect(lisiPerm.tables.some((t) => t.id === 'tbl_tickets')).toBe(false)

      // 李四修改王五负责的 app_tickets -> 403
      const lisiEditWangwu = await mgrLisi.request('/api/permissions/apps/app_tickets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberAccess: 'readonly' }),
      })
      expect(lisiEditWangwu.status).toBe(403)

      // 绑定非 person 列或不存在的列 -> 400
      const badOwnerCol = await admin.request('/api/permissions/tables/tbl_projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerColumnKey: 'status' }),
      })
      expect(badOwnerCol.status).toBe(400)

      // 李四配置自己负责的 app_projects 对成员 editable + tbl_projects 行级 self
      const okAppPerm = await mgrLisi.request('/api/permissions/apps/app_projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberAccess: 'editable' }),
      })
      expect(okAppPerm.status).toBe(200)
      const okTblPerm = await mgrLisi.request('/api/permissions/tables/tbl_projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowScope: 'self', ownerColumnKey: 'owner_name' }),
      })
      expect(okTblPerm.status).toBe(200)

      // 现在成员钱七可以改 rec_prj_005，但不可改 rec_prj_002
      expect(
        (
          await member.request('/api/tables/tbl_projects/records/rec_prj_005', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch: { progress: 88 } }),
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await member.request('/api/tables/tbl_projects/records/rec_prj_002', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patch: { progress: 88 } }),
          })
        ).status,
      ).toBe(403)

      // 李四切视图 wv_projects_kanban 为 readonly，看板拖拽立刻返回 403
      const viewRoRes = await mgrLisi.request('/api/permissions/views/wv_projects_kanban', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberAccess: 'readonly' }),
      })
      expect(viewRoRes.status).toBe(200)
      const { view: updatedKanban } = (await viewRoRes.json()) as { view: WorkspaceView }
      expect(updatedKanban.memberAccess).toBe('readonly')

      const memKanbanRes = await member.request(
        '/api/views/wv_projects_kanban/kanban/cards/rec_prj_005',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetValue: '进行中' }),
        },
      )
      expect(memKanbanRes.status).toBe(403)
    } finally {
      db.close()
    }
  })

  test('B1: 禁止通过应用 VLOOKUP 派生列引用无权访问的私有数据源表（含防列名探测）', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const mgrLisi = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'manager')).cookie)

      const secretTableRes = await admin.request('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '高管薪酬机密表',
          columns: [
            { key: 'emp_name', title: '姓名', type: 'text', width: 120 },
            { key: 'secret_bonus', title: '保密奖金', type: 'number', width: 120 },
          ],
          records: [{ emp_name: '张三', secret_bonus: 500000 }],
        }),
      })
      expect(secretTableRes.status).toBe(201)
      const secretTable = (await secretTableRes.json()) as TableBundle

      const lookupToSecret = {
        key: 'leak_bonus',
        title: '泄露奖金',
        type: 'lookup',
        width: 120,
        lookupConfig: {
          groupId: 'grp_leak',
          targetTableId: secretTable.meta.id,
          matchRules: [{ sourceField: 'owner_name', targetField: 'emp_name' }],
          targetReturnField: 'secret_bonus',
          mode: 'one',
        },
      }

      // 1) POST /api/apps 携带指向私有表的 lookup 派生列 -> 403
      const createAppWithSecret = await mgrLisi.request('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '越权引用表应用',
          tableId: 'tbl_projects',
          derivedColumns: [lookupToSecret],
        }),
      })
      expect(createAppWithSecret.status).toBe(403)

      // 2) PUT/PATCH /api/apps/:id 携带指向私有表的 lookup（含不完整字段/猜测列名探测）-> 403
      for (const method of ['PATCH', 'PUT'] as const) {
        const updateWithSecret = await mgrLisi.request('/api/apps/app_projects', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ derivedColumns: [lookupToSecret] }),
        })
        expect(updateWithSecret.status).toBe(403)
      }

      const probeSchemaRes = await mgrLisi.request('/api/apps/app_projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          derivedColumns: [
            {
              key: 'probe',
              title: '探测',
              type: 'lookup',
              lookupConfig: {
                groupId: 'g_probe',
                targetTableId: secretTable.meta.id,
                matchRules: [{ sourceField: 'owner_name', targetField: 'nonexistent_col' }],
                targetReturnField: 'nonexistent_col',
                mode: 'one',
              },
            },
          ],
        }),
      })
      expect(probeSchemaRes.status).toBe(403)

      // 私有表仍对李四完全不可见
      expect((await mgrLisi.request(`/api/tables/${secretTable.meta.id}`)).status).toBe(403)

      // 3) 合法场景：李四对 tbl_employees 具备访问权（via app_employees），允许在其名下应用引用
      const validAppRes = await mgrLisi.request('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '合法员工关联应用',
          tableId: 'tbl_projects',
          derivedColumns: [
            {
              key: 'lookup_emp_mail',
              title: '员工邮箱',
              type: 'lookup',
              width: 160,
              lookupConfig: {
                groupId: 'grp_emp_mail',
                targetTableId: 'tbl_employees',
                matchRules: [{ sourceField: 'owner_name', targetField: 'name' }],
                targetReturnField: 'email',
                mode: 'one',
              },
            },
          ],
        }),
      })
      expect(validAppRes.status).toBe(201)
      const createdValid = (await validAppRes.json()) as CreateAppResponse
      expect(createdValid.app.derivedColumns?.map((c) => c.key)).toEqual(['lookup_emp_mail'])
    } finally {
      db.close()
    }
  })

  test('B2: PUT/PATCH /api/views/:id 禁止越权跨应用迁移或改绑私有数据源表，并校验 tableId 与目标应用一致', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const mgrLisi = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'manager')).cookie)

      const secretTableRes = await admin.request('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '绝密数据源' }),
      })
      expect(secretTableRes.status).toBe(201)
      const secretTable = (await secretTableRes.json()) as TableBundle

      // 李四在自己名下 app_projects 下创建一个视图
      const createViewRes = await mgrLisi.request('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_projects',
          name: '李四项目视图',
          type: 'table',
        }),
      })
      expect(createViewRes.status).toBe(201)
      const { view: lisiView } = (await createViewRes.json()) as { view: WorkspaceView }

      // 1) 越权迁入管理员私有应用 app_exec_revenue 或他人应用 app_tickets -> 403
      for (const method of ['PATCH', 'PUT'] as const) {
        const moveAdminApp = await mgrLisi.request(`/api/views/${lisiView.id}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appId: 'app_exec_revenue' }),
        })
        expect(moveAdminApp.status).toBe(403)
      }
      const moveWangwuApp = await mgrLisi.request(`/api/views/${lisiView.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'app_tickets', tableId: 'tbl_tickets' }),
      })
      expect(moveWangwuApp.status).toBe(403)

      // 2) 越权改绑到无权访问的数据源表 -> 403
      const rebindSecretTable = await mgrLisi.request(`/api/views/${lisiView.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: secretTable.meta.id }),
      })
      expect(rebindSecretTable.status).toBe(403)

      // 3) 即使对目标表具备访问权，tableId 与所属应用 table_id 不一致 -> 400
      const mismatchTableRes = await mgrLisi.request(`/api/views/${lisiView.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: 'tbl_employees' }),
      })
      expect(mismatchTableRes.status).toBe(400)

      // 4) 李四自建两个同源/异源应用：只传不一致 appId 返回 400；一致迁移返回 200
      const lisiProjApp2 = (
        (await (
          await mgrLisi.request('/api/apps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '李四项目二号', tableId: 'tbl_projects' }),
          })
        ).json()) as CreateAppResponse
      ).app
      const lisiEmpApp = (
        (await (
          await mgrLisi.request('/api/apps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '李四员工应用', tableId: 'tbl_employees' }),
          })
        ).json()) as CreateAppResponse
      ).app

      const mismatchAppOnly = await mgrLisi.request(`/api/views/${lisiView.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: lisiEmpApp.id }),
      })
      expect(mismatchAppOnly.status).toBe(400)

      const sameTableMove = await mgrLisi.request(`/api/views/${lisiView.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: lisiProjApp2.id }),
      })
      expect(sameTableMove.status).toBe(200)
      const movedSame = (await sameTableMove.json()) as { view: WorkspaceView }
      expect(movedSame.view.appId).toBe(lisiProjApp2.id)
      expect(movedSame.view.tableId).toBe('tbl_projects')

      const consistentCrossMove = await mgrLisi.request(`/api/views/${lisiView.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: lisiEmpApp.id,
          tableId: 'tbl_employees',
          name: '跨应用迁移视图',
        }),
      })
      expect(consistentCrossMove.status).toBe(200)
      const movedCross = (await consistentCrossMove.json()) as { view: WorkspaceView }
      expect(movedCross.view.appId).toBe(lisiEmpApp.id)
      expect(movedCross.view.tableId).toBe('tbl_employees')

      // 5) 在无权配置父应用但有权配置视图（自建视图）的场景下，传入未变化的 appId/tableId 仍可正常更新
      const adminAllApp = (
        (await (
          await admin.request('/api/apps', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: '管理员公开应用',
              tableId: 'tbl_projects',
              visibilityScope: 'all',
            }),
          })
        ).json()) as CreateAppResponse
      ).app
      // 手动插入一个李四创建的视图，模拟其有权管理该视图但无权管理管理员父应用
      const childViewRes = await admin.request('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: adminAllApp.id,
          name: '李四可配子视图',
          type: 'table',
          visibilityScope: 'managers',
          managerUserIds: ['usr_mgr_lisi'],
        }),
      })
      expect(childViewRes.status).toBe(201)
      const { view: lisiChildView } = (await childViewRes.json()) as { view: WorkspaceView }

      const unchangedPut = await mgrLisi.request(`/api/views/${lisiChildView.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: adminAllApp.id,
          tableId: adminAllApp.tableId,
          name: '李四改名子视图',
        }),
      })
      expect(unchangedPut.status).toBe(200)
      expect(((await unchangedPut.json()) as { view: WorkspaceView }).view.name).toBe(
        '李四改名子视图',
      )

      // 视图配置未篡改原父应用
      const appCheck = (await (await admin.request(`/api/apps/${adminAllApp.id}`)).json()) as {
        app: SmartApp
      }
      expect(appCheck.app.tableId).toBe('tbl_projects')
    } finally {
      db.close()
    }
  })

  test('B3: 父应用负责人未被列入子视图 managers 可见名单时，/api/permissions 与配置/分享/删除均严格拦截', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const mgrLisi = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'manager')).cookie)
      const mgrWangwu = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'wangwu')).cookie)

      // 管理员在李四拥有的 app_projects 下创建仅对王五可见的 managers 视图
      const createRes = await admin.request('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_projects',
          name: '王五专属受限视图',
          type: 'table',
          visibilityScope: 'managers',
          managerUserIds: ['usr_mgr_wangwu'],
        }),
      })
      expect(createRes.status).toBe(201)
      const { view: wangwuView } = (await createRes.json()) as { view: WorkspaceView }

      // 李四在 /api/views 与 /api/permissions 中均不可见该视图
      const lisiViews = ((await (await mgrLisi.request('/api/views')).json()) as AllViewsResponse)
        .views
      expect(lisiViews.some((v) => v.id === wangwuView.id)).toBe(false)

      const lisiPerms = (await (
        await mgrLisi.request('/api/permissions')
      ).json()) as PermissionsOverviewResponse
      expect(lisiPerms.views.some((v) => v.id === wangwuView.id)).toBe(false)

      // 李四尝试修改权限、修改配置、分享、重排或删除该受限视图 -> 一律 403
      expect(
        (
          await mgrLisi.request(`/api/permissions/views/${wangwuView.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visibilityScope: 'all' }),
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await mgrLisi.request(`/api/views/${wangwuView.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '越权改名' }),
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await mgrLisi.request('/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'view', targetId: wangwuView.id }),
          })
        ).status,
      ).toBe(403)
      expect(
        (
          await mgrLisi.request('/api/views/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ viewIds: [wangwuView.id] }),
          })
        ).status,
      ).toBe(403)
      expect(
        (await mgrLisi.request(`/api/views/${wangwuView.id}`, { method: 'DELETE' })).status,
      ).toBe(403)

      // 被授权的王五可在 /api/permissions 看见并正常配置/分享
      const wangwuPerms = (await (
        await mgrWangwu.request('/api/permissions')
      ).json()) as PermissionsOverviewResponse
      expect(wangwuPerms.views.some((v) => v.id === wangwuView.id)).toBe(true)
      expect(
        (
          await mgrWangwu.request(`/api/views/${wangwuView.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '王五已重命名视图' }),
          })
        ).status,
      ).toBe(200)
      expect(
        (
          await mgrWangwu.request('/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'view', targetId: wangwuView.id }),
          })
        ).status,
      ).toBe(201)
    } finally {
      db.close()
    }
  })
})

describe('一键分享全生命周期与免登录访客权限边界', () => {
  test('分享创建权限、/api/shares 管理员全空间 vs 负责人仅本人、跨人失效拦截', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const mgrLisi = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'manager')).cookie)
      const mgrWangwu = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'wangwu')).cookie)

      // 进阶表不允许创建 entry 分享
      const advEntryRes = await admin.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'entry', targetId: 'tbl_employees' }),
      })
      expect(advEntryRes.status).toBe(400)

      // 李四不能分享王五的 app_tickets（403），可以分享自己的 app_projects
      expect(
        (
          await mgrLisi.request('/api/shares', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetType: 'app', targetId: 'app_tickets' }),
          })
        ).status,
      ).toBe(403)

      const lisiShareRes = await mgrLisi.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'app', targetId: 'app_projects', expiresInDays: 7 }),
      })
      expect(lisiShareRes.status).toBe(201)
      const { share: lisiShare } = (await lisiShareRes.json()) as CreateShareResponse

      const wangwuShareRes = await mgrWangwu.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'app', targetId: 'app_tickets' }),
      })
      expect(wangwuShareRes.status).toBe(201)
      const { share: wangwuShare } = (await wangwuShareRes.json()) as CreateShareResponse

      // 管理员见全部 2 条，李四仅见 1 条，王五仅见 1 条
      const adminList = ((await (await admin.request('/api/shares')).json()) as ListSharesResponse)
        .shares
      const lisiList = ((await (await mgrLisi.request('/api/shares')).json()) as ListSharesResponse)
        .shares
      expect(adminList).toHaveLength(2)
      expect(lisiList.map((s) => s.id)).toEqual([lisiShare.id])

      // 王五不能失效李四的链接（403）
      expect(
        (await mgrWangwu.request(`/api/shares/${lisiShare.id}/revoke`, { method: 'POST' })).status,
      ).toBe(403)

      // 管理员可以失效任意链接
      const adminRevoke = await admin.request(`/api/shares/${wangwuShare.id}/revoke`, {
        method: 'POST',
      })
      expect(adminRevoke.status).toBe(200)
      const { share: revoked } = (await adminRevoke.json()) as { share: ShareRecord }
      expect(revoked.status).toBe('revoked')

      // 失效后免登录访客立刻返回 410
      expect((await rawApp.request(`/api/s/${wangwuShare.token}`)).status).toBe(410)
    } finally {
      db.close()
    }
  })

  test('密码门禁、过期失效、entry 匿名隔离填报，以及访客数据不超过分享创建者权限边界', async () => {
    const { db, rawApp } = setupApp()
    try {
      const admin = createAuthedClient(rawApp, (await loginAsAdmin(rawApp)).cookie)
      const mgrLisi = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'manager')).cookie)
      const mgrWangwu = createAuthedClient(rawApp, (await loginAsManager(rawApp, 'wangwu')).cookie)

      // 1) 为 app_projects 添加一个管理员 self-only 视图，验证李四创建的 app 分享不会越权泄露该视图
      const selfViewRes = await admin.request('/api/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: 'app_projects',
          name: '管理员绝密视图',
          type: 'table',
          visibilityScope: 'self',
        }),
      })
      expect(selfViewRes.status).toBe(201)

      const lisiAppShareRes = await mgrLisi.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'app',
          targetId: 'app_projects',
          password: 'secret-pass',
        }),
      })
      const { share: lisiAppShare } = (await lisiAppShareRes.json()) as CreateShareResponse
      expect(lisiAppShare.hasPassword).toBe(true)

      // 未校验密码前，GET /api/s/:token 不返回任何业务数据；且应用分享不可填报
      const lockedRes = await rawApp.request(`/api/s/${lisiAppShare.token}`)
      expect(lockedRes.status).toBe(200)
      const lockedBody = (await lockedRes.json()) as ShareAccessResponse
      expect(lockedBody.unlocked).toBe(false)
      expect(lockedBody.requiresPassword).toBe(true)
      expect('app' in lockedBody).toBe(false)
      expect('tables' in lockedBody).toBe(false)

      // 密码错误返回 401
      const wrongPassRes = await rawApp.request(`/api/s/${lisiAppShare.token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'bad' }),
      })
      expect(wrongPassRes.status).toBe(401)

      // 密码正确返回解锁 Cookie 与裁剪后的数据（不含管理员 self 视图，且严格只读）
      const okPassRes = await rawApp.request(`/api/s/${lisiAppShare.token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'secret-pass' }),
      })
      expect(okPassRes.status).toBe(200)
      const shareCookie = extractCookiePair(okPassRes, `st_share_${lisiAppShare.id}`)
      const verifyBody = (await okPassRes.json()) as VerifySharePasswordResponse
      expect(verifyBody.access.unlocked).toBe(true)
      expect(verifyBody.access.capabilities.canEditRecords).toBe(false)
      expect(verifyBody.access.views?.some((v) => v.name === '管理员绝密视图')).toBe(false)

      // 携带 Cookie 再次访问 GET /api/s/:token 自动保持解锁态
      const unlockedGet = await rawApp.request(`/api/s/${lisiAppShare.token}`, {
        headers: mergeCookieHeader(undefined, shareCookie),
      })
      expect(unlockedGet.status).toBe(200)
      const unlockedBody = (await unlockedGet.json()) as ShareAccessResponse
      expect(unlockedBody.unlocked).toBe(true)

      // app 分享禁止访客提交新记录（403）
      const appPostRecord = await rawApp.request(`/api/s/${lisiAppShare.token}/records`, {
        method: 'POST',
        headers: mergeCookieHeader({ 'Content-Type': 'application/json' }, shareCookie),
        body: JSON.stringify({ record: { project_name: '不允许' } }),
      })
      expect(appPostRecord.status).toBe(403)

      // 2) 行级权限边界：王五对 app_tickets（tbl_tickets 为 self + assignee）创建分享，访客仅见王五负责的行
      const wangwuTicketShareRes = await mgrWangwu.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'app', targetId: 'app_tickets' }),
      })
      const { share: wangwuTicketShare } =
        (await wangwuTicketShareRes.json()) as CreateShareResponse
      const wangwuGuestRes = await rawApp.request(`/api/s/${wangwuTicketShare.token}`)
      expect(wangwuGuestRes.status).toBe(200)
      const wangwuGuestBody = (await wangwuGuestRes.json()) as ShareAccessResponse
      expect(wangwuGuestBody.unlocked).toBe(true)
      const unlockedWangwu = wangwuGuestBody as ShareAccessUnlockedResponse
      expect(unlockedWangwu.table?.records.map((r) => r._id)).toEqual(['rec_tkt_003'])

      // 单视图分享（view）：仅返回该视图，不暴露所属应用下的其它视图
      const viewShareRes = await mgrWangwu.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'view', targetId: 'wv_tickets_kanban' }),
      })
      const { share: viewShare } = (await viewShareRes.json()) as CreateShareResponse
      const viewGuestBody = (await (
        await rawApp.request(`/api/s/${viewShare.token}`)
      ).json()) as ShareAccessResponse
      expect(viewGuestBody.unlocked).toBe(true)
      const unlockedViewGuest = viewGuestBody as ShareAccessUnlockedResponse
      expect(unlockedViewGuest.views).toHaveLength(1)
      expect(unlockedViewGuest.view?.id).toBe('wv_tickets_kanban')

      // 若管理员收回李四对 app_projects 的访问权（改为管理员 self），李四的分享立即被实时拦截（403）
      await admin.request('/api/permissions/apps/app_projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibilityScope: 'self', managerUserIds: [] }),
      })
      // 模拟创建者已变为 admin 以外且不在 self 内：将 created_by 改由 admin 持有
      db.query("UPDATE smart_apps SET created_by = 'usr_admin' WHERE id = 'app_projects'").run()
      const revokedByBoundary = await rawApp.request(`/api/s/${lisiAppShare.token}`, {
        headers: mergeCookieHeader(undefined, shareCookie),
      })
      expect(revokedByBoundary.status).toBe(403)

      // 3) 录入表（entry）分享：需密码解锁、不泄露内部已有记录、允许免登录填报并自动记为 guest
      const entryShareRes = await admin.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'entry',
          targetId: 'tbl_suppliers',
          password: 'entry-pin',
        }),
      })
      expect(entryShareRes.status).toBe(201)
      const { share: entryShare } = (await entryShareRes.json()) as CreateShareResponse

      // 未解锁时不允许提交录入
      expect(
        (
          await rawApp.request(`/api/s/${entryShare.token}/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              record: { supplier_id: 'SUP-901', supplier_name: '未解锁供应商' },
            }),
          })
        ).status,
      ).toBe(403)

      const entryVerify = await rawApp.request(`/api/s/${entryShare.token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'entry-pin' }),
      })
      expect(entryVerify.status).toBe(200)
      const entryVerifyBody = (await entryVerify.json()) as VerifySharePasswordResponse
      // 匿名隔离：已有 8 条供应商记录不返回给匿名访客
      expect(entryVerifyBody.access.table?.records).toEqual([])
      expect(entryVerifyBody.access.capabilities.canEditRecords).toBe(true)

      const submitRes = await rawApp.request(`/api/s/${entryShare.token}/records`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Share-Token': entryVerifyBody.accessToken,
        },
        body: JSON.stringify({
          record: {
            supplier_id: 'SUP-GUEST-1',
            supplier_name: '访客填报供应商',
            rating: 4.9,
          },
        }),
      })
      expect(submitRes.status).toBe(201)
      const { record: guestRecord } = (await submitRes.json()) as { record: SmartRecord }
      expect(guestRecord.createdBy).toBe('guest')

      // 管理员可在库中看到该访客提交的记录
      const supBundle = (await (
        await admin.request('/api/tables/tbl_suppliers')
      ).json()) as TableBundle
      expect(supBundle.records.some((r) => r._id === guestRecord._id)).toBe(true)

      // 4) 过期链接校验：返回 410
      const expiredShareRes = await admin.request('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetType: 'entry',
          targetId: 'tbl_suppliers',
          expiresAt: '2020-01-01T00:00:00.000Z',
        }),
      })
      const { share: expiredShare } = (await expiredShareRes.json()) as CreateShareResponse
      expect((await rawApp.request(`/api/s/${expiredShare.token}`)).status).toBe(410)
      expect(
        (
          await rawApp.request(`/api/s/${expiredShare.token}/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ record: { supplier_id: 'SUP-EXP' } }),
          })
        ).status,
      ).toBe(410)
    } finally {
      db.close()
    }
  })
})
