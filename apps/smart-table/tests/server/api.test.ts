// 服务端 API 与 SQLite 持久化集成测试（使用 ':memory:' 内存数据库通过 vitest 运行）。
import { describe, expect, test } from 'vitest'
import { openDatabase, resolveDbPath } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedSmartTableDemo } from '../../src/server/seed'
import type { AllTablesResponse, TableBundle } from '../../src/shared/api-types'
import type { SmartRecord, SmartTableMeta } from '../../src/shared/schema'

function createSeededTestEnv() {
  const db = openDatabase(':memory:')
  seedSmartTableDemo(db)
  const app = createApp(db)
  return { db, app }
}

describe('数据库路径配置', () => {
  test('SMART_TABLE_DB 环境变量可覆盖默认数据库路径', () => {
    const previous = process.env.SMART_TABLE_DB
    process.env.SMART_TABLE_DB = '/tmp/smart-table-test.sqlite'
    try {
      expect(resolveDbPath()).toBe('/tmp/smart-table-test.sqlite')
    } finally {
      if (previous === undefined) {
        delete process.env.SMART_TABLE_DB
      } else {
        process.env.SMART_TABLE_DB = previous
      }
    }
  })
})

describe('三表联动种子初始化', () => {
  test('种子初始化后 3 张表、列配置、视图与记录数完整且幂等', async () => {
    const { db, app } = createSeededTestEnv()
    // 再次调用非 force 种子应幂等跳过
    seedSmartTableDemo(db)

    const res = await app.request('/api/tables')
    expect(res.status).toBe(200)
    const body = (await res.json()) as AllTablesResponse
    expect(body.tables).toHaveLength(3)

    const projects = body.tables.find((t) => t.meta.id === 'tbl_projects')
    const employees = body.tables.find((t) => t.meta.id === 'tbl_employees')
    const payments = body.tables.find((t) => t.meta.id === 'tbl_payments')

    expect(projects).toBeDefined()
    expect(employees).toBeDefined()
    expect(payments).toBeDefined()

    // 表 1：项目跟进与业绩总表
    expect(projects!.meta.kind).toBe('normal')
    expect(projects!.meta.views).toHaveLength(2)
    expect(projects!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot'])
    expect(projects!.records).toHaveLength(10)
    const zhangSanProjects = projects!.records.filter((r) => r.owner_name === '张三')
    expect(zhangSanProjects.length).toBeGreaterThanOrEqual(2)
    for (const r of zhangSanProjects) {
      expect(r._lookupOverrides).toBeUndefined()
    }
    const blueprint = projects!.records[0]?.blueprint_img as string
    expect(blueprint.startsWith('data:image/svg+xml')).toBe(true)

    // 表 2：企业员工花名册（含两个张三，emp_id 标 isUniqueKey）
    expect(employees!.meta.kind).toBe('advanced')
    expect(employees!.meta.primaryKeyField).toBe('emp_id')
    expect(employees!.meta.sourceSqlTable).toBe('biz_employees')
    expect(employees!.meta.columns.find((c) => c.key === 'emp_id')?.isUniqueKey).toBe(true)
    expect(employees!.records).toHaveLength(12)
    const zhangSanEmployees = employees!.records.filter((r) => r.name === '张三')
    expect(zhangSanEmployees.map((r) => r.emp_id)).toEqual(['EMP-001', 'EMP-009'])
    expect(employees!.records.every((r) => r._id === r.emp_id)).toBe(true)

    // 表 3：客户回款流水表（36 条跨年度记录，含透视视图）
    expect(payments!.meta.kind).toBe('advanced')
    expect(payments!.meta.primaryKeyField).toBe('pay_id')
    expect(payments!.meta.sourceSqlTable).toBe('biz_payments')
    expect(payments!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot'])
    expect(payments!.records).toHaveLength(36)
    expect(payments!.records.every((r) => r._id === r.pay_id)).toBe(true)
  })
})

describe('普通表记录增删改与 _lookupOverrides 持久化', () => {
  test('支持普通表新增、局部 PATCH（含 _lookupOverrides 消歧）与删除', async () => {
    const { app } = createSeededTestEnv()

    // 新增项目记录
    const createRes = await app.request('/api/tables/tbl_projects/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          project_code: 'PRJ-2025-011',
          project_name: '新增测试项目',
          owner_name: '张三',
          status: '进行中',
          progress: 20,
          contract_amount: 300000,
          verified: false,
        },
      }),
    })
    expect(createRes.status).toBe(201)
    const createdBody = (await createRes.json()) as { record: SmartRecord }
    expect(createdBody.record._id).toBeTruthy()
    expect(createdBody.record.project_code).toBe('PRJ-2025-011')

    // 局部 PATCH _lookupOverrides（应保留已有业务字段）
    const overrideRes = await app.request(
      `/api/tables/tbl_projects/records/${createdBody.record._id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: { _lookupOverrides: { grp_emp: 'EMP-009' } },
        }),
      },
    )
    expect(overrideRes.status).toBe(200)
    const overrideBody = (await overrideRes.json()) as { record: SmartRecord }
    expect(overrideBody.record._lookupOverrides).toEqual({ grp_emp: 'EMP-009' })
    expect(overrideBody.record.project_name).toBe('新增测试项目')

    // 再次局部 PATCH 业务字段（应保留 _lookupOverrides）
    const fieldRes = await app.request(
      `/api/tables/tbl_projects/records/${createdBody.record._id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: { progress: 90, verified: true },
        }),
      },
    )
    expect(fieldRes.status).toBe(200)
    const fieldBody = (await fieldRes.json()) as { record: SmartRecord }
    expect(fieldBody.record.progress).toBe(90)
    expect(fieldBody.record.verified).toBe(true)
    expect(fieldBody.record._lookupOverrides).toEqual({ grp_emp: 'EMP-009' })

    // 删除记录
    const delRes = await app.request(`/api/tables/tbl_projects/records/${createdBody.record._id}`, {
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)
    expect(await delRes.json()).toEqual({ ok: true })

    // 确认已删除
    const tablesRes = await app.request('/api/tables')
    const tablesBody = (await tablesRes.json()) as AllTablesResponse
    const projects = tablesBody.tables.find((t) => t.meta.id === 'tbl_projects')!
    expect(projects.records).toHaveLength(10)
    expect(projects.records.some((r) => r._id === createdBody.record._id)).toBe(false)
  })
})

describe('进阶 SQL 表直接写回物理表', () => {
  test('biz_employees 新增和编辑直接写回物理 SQLite 表', async () => {
    const { db, app } = createSeededTestEnv()

    const createRes = await app.request('/api/tables/tbl_employees/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          emp_id: 'EMP-013',
          name: '新同事',
          dept: '研发部',
          level: 'P7',
          region: '华南大区',
          email: 'newbie@company.com',
        },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { record: SmartRecord }
    expect(created.record._id).toBe('EMP-013')

    const patchRes = await app.request('/api/tables/tbl_employees/records/EMP-013', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch: { dept: '解决方案部', level: 'P8' },
      }),
    })
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as { record: SmartRecord }
    expect(patched.record.dept).toBe('解决方案部')
    expect(patched.record.level).toBe('P8')

    // 直接查物理表验证已落库
    const sqlRow = db.query('SELECT * FROM biz_employees WHERE emp_id = ?').get('EMP-013') as
      | Record<string, unknown>
      | undefined
    expect(sqlRow).toEqual({
      emp_id: 'EMP-013',
      name: '新同事',
      dept: '解决方案部',
      level: 'P8',
      region: '华南大区',
      email: 'newbie@company.com',
    })
  })

  test('biz_payments 新增、编辑与删除直接写回物理 SQLite 表', async () => {
    const { db, app } = createSeededTestEnv()

    const createRes = await app.request('/api/tables/tbl_payments/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          pay_id: 'PAY-2025-999',
          project_code: 'PRJ-2025-010',
          customer_name: '海蓝跨境电商有限公司',
          pay_date: '2025-08-01',
          year: '2025年',
          month: '08月',
          amount: 120000,
          pay_method: '银行电汇',
        },
      }),
    })
    expect(createRes.status).toBe(201)

    const patchRes = await app.request('/api/tables/tbl_payments/records/PAY-2025-999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch: { amount: 150000, pay_method: '线上对公' },
      }),
    })
    expect(patchRes.status).toBe(200)

    const sqlRow = db.query('SELECT * FROM biz_payments WHERE pay_id = ?').get('PAY-2025-999') as
      | Record<string, unknown>
      | undefined
    expect(sqlRow?.amount).toBe(150000)
    expect(sqlRow?.pay_method).toBe('线上对公')

    const delRes = await app.request('/api/tables/tbl_payments/records/PAY-2025-999', {
      method: 'DELETE',
    })
    expect(delRes.status).toBe(200)
    const afterDel = db.query('SELECT * FROM biz_payments WHERE pay_id = ?').get('PAY-2025-999')
    expect(afterDel).toBeUndefined()
  })
})

describe('表元数据更新、新建普通表与种子重置', () => {
  test('PUT /api/tables/:id/meta 更新列、视图与汇总配置', async () => {
    const { app } = createSeededTestEnv()
    const listRes = await app.request('/api/tables')
    const { tables } = (await listRes.json()) as AllTablesResponse
    const projectsMeta = tables.find((t) => t.meta.id === 'tbl_projects')!.meta

    const nextMeta: SmartTableMeta = {
      ...projectsMeta,
      columns: [
        ...projectsMeta.columns,
        { key: 'remark', title: '项目备注', type: 'text', width: 180 },
      ],
      views: [
        ...projectsMeta.views,
        {
          id: 'view_custom',
          name: '已交付项目',
          type: 'table',
          filterGroup: {
            conjunction: 'and',
            conditions: [{ id: 'c1', field: 'status', operator: 'eq', value: '已交付' }],
          },
          quickFilterFields: ['status'],
          sortRules: [{ field: 'contract_amount', direction: 'desc' }],
        },
      ],
      summaries: {
        ...projectsMeta.summaries,
        contract_amount: 'avg',
      },
    }

    const putRes = await app.request('/api/tables/tbl_projects/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: nextMeta }),
    })
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { meta: SmartTableMeta }
    expect(putBody.meta.columns.some((c) => c.key === 'remark')).toBe(true)
    expect(putBody.meta.views.some((v) => v.id === 'view_custom')).toBe(true)
    expect(putBody.meta.summaries.contract_amount).toBe('avg')
  })

  test('POST /api/tables 新建普通表，POST /api/reset-seed 强制重置种子数据', async () => {
    const { app } = createSeededTestEnv()

    const createTableRes = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '客户拜访记录表',
        description: '测试新建普通表',
        columns: [
          { key: 'customer', title: '客户', type: 'text', width: 160 },
          { key: 'visit_date', title: '拜访日期', type: 'date', width: 120 },
        ],
      }),
    })
    expect(createTableRes.status).toBe(201)
    const newBundle = (await createTableRes.json()) as TableBundle
    expect(newBundle.meta.kind).toBe('normal')
    expect(newBundle.meta.name).toBe('客户拜访记录表')
    expect(newBundle.meta.columns).toHaveLength(2)
    expect(newBundle.records).toEqual([])

    // 删除一条员工记录以制造脏状态
    await app.request('/api/tables/tbl_employees/records/EMP-012', { method: 'DELETE' })

    const beforeResetRes = await app.request('/api/tables')
    const beforeReset = (await beforeResetRes.json()) as AllTablesResponse
    expect(beforeReset.tables).toHaveLength(4)

    // 强制重置种子数据
    const resetRes = await app.request('/api/reset-seed', { method: 'POST' })
    expect(resetRes.status).toBe(200)
    const resetBody = (await resetRes.json()) as AllTablesResponse
    expect(resetBody.tables).toHaveLength(3)
    expect(resetBody.tables.find((t) => t.meta.id === 'tbl_employees')?.records).toHaveLength(12)
    expect(resetBody.tables.find((t) => t.meta.id === 'tbl_projects')?.records).toHaveLength(10)
    expect(resetBody.tables.find((t) => t.meta.id === 'tbl_payments')?.records).toHaveLength(36)
  })

  test('异常参数与不存在资源返回 400 / 404', async () => {
    const { app } = createSeededTestEnv()

    const badTable = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })
    expect(badTable.status).toBe(400)

    const missingMeta = await app.request('/api/tables/not_exists/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          id: 'not_exists',
          name: 'x',
          kind: 'normal',
          columns: [],
          views: [],
          summaries: {},
        },
      }),
    })
    expect(missingMeta.status).toBe(404)

    const missingRecord = await app.request('/api/tables/tbl_projects/records/no_such_id', {
      method: 'DELETE',
    })
    expect(missingRecord.status).toBe(404)
  })
})
