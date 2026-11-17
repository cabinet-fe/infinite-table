// 服务端 API 与 SQLite 持久化集成测试（使用 ':memory:' 内存数据库通过 vitest 运行）。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'vitest'
import { listTableBundles, openDatabase, resolveDbPath } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { SEED_VERSION, ensureSeeded, seedSmartTableDemo } from '../../src/server/seed'
import type { AllTablesResponse, TableBundle } from '../../src/shared/api-types'
import type { SmartRecord, SmartTableMeta } from '../../src/shared/schema'

function createSeededTestEnv() {
  const db = openDatabase(':memory:')
  seedSmartTableDemo(db)
  const app = createApp(db)
  return { db, app }
}

describe('数据库路径配置与旧库迁移', () => {
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

  test('旧单列主键 smart_table_records 与缺 region 的 biz_payments 可平滑迁移升级', () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-table-migrate-'))
    const dbPath = join(dir, 'legacy.sqlite')
    try {
      const legacyDb = new Database(dbPath)
      legacyDb.exec(`
        CREATE TABLE smart_tables (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          primary_key_field TEXT,
          source_sql_table TEXT,
          schema_json TEXT NOT NULL,
          views_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE smart_table_records (
          id TEXT PRIMARY KEY,
          table_id TEXT NOT NULL,
          row_order INTEGER NOT NULL,
          data_json TEXT NOT NULL
        );
        CREATE TABLE biz_employees (
          emp_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          dept TEXT NOT NULL,
          level TEXT NOT NULL,
          region TEXT NOT NULL,
          email TEXT NOT NULL
        );
        CREATE TABLE biz_payments (
          pay_id TEXT PRIMARY KEY,
          project_code TEXT NOT NULL,
          customer_name TEXT NOT NULL,
          pay_date TEXT NOT NULL,
          year TEXT NOT NULL,
          month TEXT NOT NULL,
          amount REAL NOT NULL,
          pay_method TEXT NOT NULL
        );
      `)
      legacyDb
        .query(
          'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'tbl_legacy',
          '旧表',
          'normal',
          null,
          null,
          JSON.stringify({
            columns: [{ key: 'title', title: '标题', type: 'text', width: 120 }],
            summaries: {},
          }),
          JSON.stringify([
            {
              id: 'v1',
              name: '全部',
              type: 'table',
              filterGroup: { conjunction: 'and', conditions: [] },
              quickFilterFields: [],
              sortRules: [],
            },
          ]),
          '2025-01-01T00:00:00.000Z',
        )
      legacyDb
        .query(
          'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
        )
        .run('same_id', 'tbl_legacy', 0, JSON.stringify({ _id: 'same_id', title: '保留旧数据' }))
      legacyDb.close()

      const upgraded = openDatabase(dbPath)
      try {
        const app = createApp(upgraded)
        // 新建另一张普通表也插入同 _id = 'same_id' 不再主键冲突
        upgraded
          .query(
            'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            'tbl_legacy_2',
            '新表',
            'normal',
            null,
            null,
            JSON.stringify({
              columns: [{ key: 'title', title: '标题', type: 'text', width: 120 }],
              summaries: {},
            }),
            JSON.stringify([
              {
                id: 'v1',
                name: '全部',
                type: 'table',
                filterGroup: { conjunction: 'and', conditions: [] },
                quickFilterFields: [],
                sortRules: [],
              },
            ]),
            '2025-01-01T00:00:00.000Z',
          )
        upgraded
          .query(
            'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
          )
          .run(
            'same_id',
            'tbl_legacy_2',
            0,
            JSON.stringify({ _id: 'same_id', title: '第二张表同ID' }),
          )

        const row1 = upgraded
          .query('SELECT data_json FROM smart_table_records WHERE table_id = ? AND id = ?')
          .get('tbl_legacy', 'same_id') as { data_json: string } | undefined
        expect(JSON.parse(row1!.data_json).title).toBe('保留旧数据')

        // biz_payments 已补充 region 列，可正常 force seed
        seedSmartTableDemo(upgraded, { force: true })
        expect(app).toBeDefined()
        const payRow = upgraded.query('SELECT region FROM biz_payments LIMIT 1').get() as {
          region: string
        }
        expect(payRow.region).toBeTruthy()
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('六表联动种子初始化', () => {
  test('种子初始化后 6 张表（共 121 行）、列配置、视图与记录数完整且幂等', async () => {
    const { db, app } = createSeededTestEnv()
    // 再次调用非 force 种子应幂等跳过
    seedSmartTableDemo(db)

    const res = await app.request('/api/tables')
    expect(res.status).toBe(200)
    const body = (await res.json()) as AllTablesResponse
    expect(body.tables).toHaveLength(6)

    const projects = body.tables.find((t) => t.meta.id === 'tbl_projects')
    const employees = body.tables.find((t) => t.meta.id === 'tbl_employees')
    const payments = body.tables.find((t) => t.meta.id === 'tbl_payments')
    const inventory = body.tables.find((t) => t.meta.id === 'tbl_inventory')
    const suppliers = body.tables.find((t) => t.meta.id === 'tbl_suppliers')
    const tickets = body.tables.find((t) => t.meta.id === 'tbl_tickets')

    expect(projects).toBeDefined()
    expect(employees).toBeDefined()
    expect(payments).toBeDefined()
    expect(inventory).toBeDefined()
    expect(suppliers).toBeDefined()
    expect(tickets).toBeDefined()

    const totalRows = body.tables.reduce((acc, t) => acc + t.records.length, 0)
    expect(totalRows).toBe(121)

    // 表 1：项目跟进与业绩总表（16 行，3 视图，同时展示未消歧与已锁定张三）
    expect(projects!.meta.kind).toBe('normal')
    expect(projects!.meta.views).toHaveLength(3)
    expect(projects!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot', 'table'])
    expect(projects!.records).toHaveLength(16)
    const prj001 = projects!.records.find((r) => r.project_code === 'PRJ-2025-001')
    const prj006 = projects!.records.find((r) => r.project_code === 'PRJ-2025-006')
    expect(prj001?._lookupOverrides).toBeUndefined()
    expect(prj006?._lookupOverrides).toEqual({ grp_emp: 'EMP-009' })
    const blueprint = projects!.records[0]?.blueprint_img as string
    expect(blueprint.startsWith('data:image/svg+xml')).toBe(true)

    // 表 2：企业员工花名册（15 行，含两个张三，emp_id 标 isUniqueKey，system 禁删）
    expect(employees!.meta.kind).toBe('advanced')
    expect(employees!.meta.primaryKeyField).toBe('emp_id')
    expect(employees!.meta.sourceSqlTable).toBe('biz_employees')
    expect(employees!.meta.system).toBe(true)
    expect(employees!.meta.columns.find((c) => c.key === 'emp_id')?.isUniqueKey).toBe(true)
    expect(employees!.records).toHaveLength(15)
    const zhangSanEmployees = employees!.records.filter((r) => r.name === '张三')
    expect(zhangSanEmployees.map((r) => r.emp_id)).toEqual(['EMP-001', 'EMP-009'])
    expect(employees!.records.every((r) => r._id === r.emp_id)).toBe(true)

    // 表 3：客户回款流水表（48 行，含 region 与 3 个视图，system 禁删）
    expect(payments!.meta.kind).toBe('advanced')
    expect(payments!.meta.primaryKeyField).toBe('pay_id')
    expect(payments!.meta.sourceSqlTable).toBe('biz_payments')
    expect(payments!.meta.system).toBe(true)
    expect(payments!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot', 'pivot'])
    expect(payments!.records).toHaveLength(48)
    expect(payments!.records.every((r) => r._id === r.pay_id && Boolean(r.region))).toBe(true)

    // 项目表默认视图列序：lookup_emp_id/dept/level 紧邻 owner_name，rollup 汇总列紧随其后（首屏可见）
    const projectKeys = projects!.meta.columns.map((c) => c.key)
    const ownerIdx = projectKeys.indexOf('owner_name')
    expect(projectKeys.slice(ownerIdx + 1, ownerIdx + 4)).toEqual([
      'lookup_emp_id',
      'lookup_emp_dept',
      'lookup_emp_level',
    ])
    expect(projectKeys.indexOf('lookup_paid_sum')).toBe(ownerIdx + 4)
    expect(projectKeys.indexOf('formula_pay_rate')).toBe(ownerIdx + 6)

    // 表 4~6：库存台账（16 行）、供应商名录（8 行）、客户工单（18 行）
    expect(inventory!.records).toHaveLength(16)
    expect(inventory!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot'])
    expect(suppliers!.records).toHaveLength(8)
    expect(tickets!.records).toHaveLength(18)
    expect(tickets!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot'])
  })
})

describe('普通表记录增删改、跨表同 _id 与 _lookupOverrides 合并持久化', () => {
  test('支持普通表新增、局部 PATCH（按 groupId 合并 _lookupOverrides、剔除计算列）与删除', async () => {
    const { app } = createSeededTestEnv()

    // 新增项目记录（携带计算列与显式 _id，验证计算列被剔除）
    const createRes = await app.request('/api/tables/tbl_projects/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          _id: 'shared_rec_id',
          project_code: 'PRJ-2025-099',
          project_name: '新增测试项目',
          owner_name: '张三',
          status: '进行中',
          progress: 20,
          contract_amount: 300000,
          verified: false,
          lookup_emp_id: 'SHOULD_STRIP',
          formula_pay_rate: 999,
        },
      }),
    })
    expect(createRes.status).toBe(201)
    const createdBody = (await createRes.json()) as { record: SmartRecord }
    expect(createdBody.record._id).toBe('shared_rec_id')
    expect(createdBody.record.project_code).toBe('PRJ-2025-099')
    expect(createdBody.record.lookup_emp_id).toBeUndefined()
    expect(createdBody.record.formula_pay_rate).toBeUndefined()

    // 另一张普通表也插入相同 _id = 'shared_rec_id' 应成功（复合主键隔离）
    const createOtherRes = await app.request('/api/tables/tbl_suppliers/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          _id: 'shared_rec_id',
          supplier_id: 'SUP-099',
          supplier_name: '同ID测试供应商',
        },
      }),
    })
    expect(createOtherRes.status).toBe(201)

    // 首次 PATCH _lookupOverrides.grp_emp
    const overrideRes1 = await app.request(
      `/api/tables/tbl_projects/records/${createdBody.record._id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: { _lookupOverrides: { grp_emp: 'EMP-009' } },
        }),
      },
    )
    expect(overrideRes1.status).toBe(200)

    // 二次 PATCH 另一 groupId，应按 groupId 合并而非覆盖掉 grp_emp
    const overrideRes2 = await app.request(
      `/api/tables/tbl_projects/records/${createdBody.record._id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: {
            _lookupOverrides: { grp_extra: 'EXT-001' },
            lookup_emp_dept: 'SHOULD_NOT_PERSIST',
          },
        }),
      },
    )
    expect(overrideRes2.status).toBe(200)
    const overrideBody2 = (await overrideRes2.json()) as { record: SmartRecord }
    expect(overrideBody2.record._lookupOverrides).toEqual({
      grp_emp: 'EMP-009',
      grp_extra: 'EXT-001',
    })
    expect(overrideBody2.record.lookup_emp_dept).toBeUndefined()
    expect(overrideBody2.record.project_name).toBe('新增测试项目')

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
    expect(projects.records).toHaveLength(16)
    expect(projects.records.some((r) => r._id === createdBody.record._id)).toBe(false)
  })
})

describe('进阶 SQL 表直接写回物理表与约束校验', () => {
  test('biz_employees 支持数字主键转字符串、编辑主键联动更新 _lookupOverrides，并拒绝空主键', async () => {
    const { db, app } = createSeededTestEnv()

    const createRes = await app.request('/api/tables/tbl_employees/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          emp_id: 10086,
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
    expect(created.record._id).toBe('10086')

    // 主键改为空串返回 400
    const emptyPkRes = await app.request('/api/tables/tbl_employees/records/10086', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { emp_id: '   ' } }),
    })
    expect(emptyPkRes.status).toBe(400)

    const patchRes = await app.request('/api/tables/tbl_employees/records/10086', {
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
    const sqlRow = db.query('SELECT * FROM biz_employees WHERE emp_id = ?').get('10086') as
      | Record<string, unknown>
      | undefined
    expect(sqlRow).toEqual({
      emp_id: '10086',
      name: '新同事',
      dept: '解决方案部',
      level: 'P8',
      region: '华南大区',
      email: 'newbie@company.com',
    })

    // 修改 EMP-009 主键为 EMP-909 时，联动更新 tbl_projects 中 PRJ-2025-006 的 _lookupOverrides
    const renamePkRes = await app.request('/api/tables/tbl_employees/records/EMP-009', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { emp_id: 'EMP-909' } }),
    })
    expect(renamePkRes.status).toBe(200)
    const tablesRes = await app.request('/api/tables')
    const tablesBody = (await tablesRes.json()) as AllTablesResponse
    const prj006 = tablesBody.tables
      .find((t) => t.meta.id === 'tbl_projects')!
      .records.find((r) => r.project_code === 'PRJ-2025-006')
    expect(prj006?._lookupOverrides).toEqual({ grp_emp: 'EMP-909' })
  })

  test('biz_payments 新增、编辑与删除直接写回物理 SQLite 表，数值列拒绝非数字字符串', async () => {
    const { db, app } = createSeededTestEnv()

    // 非数字字符串拒绝写入（400）
    const badNumCreate = await app.request('/api/tables/tbl_payments/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          pay_id: 'PAY-BAD',
          project_code: 'PRJ-2025-010',
          customer_name: '测试',
          pay_date: '2025-08-01',
          year: '2025年',
          month: '08月',
          region: '华南大区',
          amount: 'abc',
          pay_method: '银行电汇',
        },
      }),
    })
    expect(badNumCreate.status).toBe(400)

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
          region: '华南大区',
          amount: 120000,
          pay_method: '银行电汇',
        },
      }),
    })
    expect(createRes.status).toBe(201)

    // 编辑数值列为非数字字符串返回 400
    const badNumPatch = await app.request('/api/tables/tbl_payments/records/PAY-2025-999', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { amount: 'not-a-number' } }),
    })
    expect(badNumPatch.status).toBe(400)

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

describe('表元数据更新、新建/删除/同步普通表与种子重置', () => {
  test('PUT /api/tables/:id/meta 更新列、视图与汇总配置并校验进阶表物理列不可删改', async () => {
    const { app } = createSeededTestEnv()
    const listRes = await app.request('/api/tables')
    const { tables } = (await listRes.json()) as AllTablesResponse
    const projectsMeta = tables.find((t) => t.meta.id === 'tbl_projects')!.meta
    const employeesMeta = tables.find((t) => t.meta.id === 'tbl_employees')!.meta

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

    // 空 views 或重复列 key 返回 400
    const emptyViewsRes = await app.request('/api/tables/tbl_projects/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { ...projectsMeta, views: [] } }),
    })
    expect(emptyViewsRes.status).toBe(400)

    const dupColRes = await app.request('/api/tables/tbl_projects/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          ...projectsMeta,
          columns: [
            ...projectsMeta.columns,
            { key: 'project_code', title: '重复key', type: 'text', width: 100 },
          ],
        },
      }),
    })
    expect(dupColRes.status).toBe(400)

    // 进阶表禁止删除物理列
    const dropAdvColRes = await app.request('/api/tables/tbl_employees/meta', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          ...employeesMeta,
          columns: employeesMeta.columns.filter((c) => c.key !== 'email'),
        },
      }),
    })
    expect(dropAdvColRes.status).toBe(400)
  })

  test('POST /api/tables、DELETE /api/tables/:id、POST /api/tables/:id/sync 与 POST /api/reset-seed', async () => {
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

    // 同步接口返回最新表捆绑数据
    const syncRes = await app.request(`/api/tables/${newBundle.meta.id}/sync`, { method: 'POST' })
    expect(syncRes.status).toBe(200)
    const synced = (await syncRes.json()) as TableBundle
    expect(synced.meta.id).toBe(newBundle.meta.id)

    // 禁止删除进阶表（400）
    const delAdvRes = await app.request('/api/tables/tbl_employees', { method: 'DELETE' })
    expect(delAdvRes.status).toBe(400)

    // 可删除普通表（200）
    const delNormalRes = await app.request(`/api/tables/${newBundle.meta.id}`, {
      method: 'DELETE',
    })
    expect(delNormalRes.status).toBe(200)
    expect(await delNormalRes.json()).toEqual({ ok: true })

    // 再建一张普通表并删除一条员工记录以制造脏状态
    await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '临时表' }),
    })
    await app.request('/api/tables/tbl_employees/records/EMP-012', { method: 'DELETE' })

    const beforeResetRes = await app.request('/api/tables')
    const beforeReset = (await beforeResetRes.json()) as AllTablesResponse
    expect(beforeReset.tables).toHaveLength(7)

    // 强制重置种子数据
    const resetRes = await app.request('/api/reset-seed', { method: 'POST' })
    expect(resetRes.status).toBe(200)
    const resetBody = (await resetRes.json()) as AllTablesResponse
    expect(resetBody.tables).toHaveLength(6)
    expect(resetBody.tables.find((t) => t.meta.id === 'tbl_employees')?.records).toHaveLength(15)
    expect(resetBody.tables.find((t) => t.meta.id === 'tbl_projects')?.records).toHaveLength(16)
    expect(resetBody.tables.find((t) => t.meta.id === 'tbl_payments')?.records).toHaveLength(48)
  })

  test('异常参数与不存在资源返回 400 / 404', async () => {
    const { app } = createSeededTestEnv()

    const badTable = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    })
    expect(badTable.status).toBe(400)

    const dupColsTable = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '重复列表',
        columns: [
          { key: 'a', title: 'A', type: 'text', width: 100 },
          { key: 'a', title: 'B', type: 'text', width: 100 },
        ],
      }),
    })
    expect(dupColsTable.status).toBe(400)

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

    const missingTableDel = await app.request('/api/tables/no_such_table', { method: 'DELETE' })
    expect(missingTableDel.status).toBe(404)

    const missingTableSync = await app.request('/api/tables/no_such_table/sync', { method: 'POST' })
    expect(missingTableSync.status).toBe(404)
  })
})

describe('Excel/CSV 浏览器端导入：POST /api/tables 携带初始 records 建表', () => {
  test('一次请求建普通表并批量落行，数字值保持 number 类型', async () => {
    const { app } = createSeededTestEnv()
    const res = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '渠道线索表',
        columns: [
          { key: 'lead_id', title: '线索ID', type: 'text', width: 140 },
          { key: 'company', title: '公司名称', type: 'text', width: 140 },
          { key: 'budget', title: '预算', type: 'number', width: 140 },
        ],
        records: [
          { lead_id: 'L-001', company: '杭州云脉科技', budget: 120000 },
          { lead_id: 'L-002', company: '苏州深蓝智造', budget: 80000 },
        ],
      }),
    })
    expect(res.status).toBe(201)
    const bundle = (await res.json()) as TableBundle
    expect(bundle.meta.kind).toBe('normal')
    expect(bundle.records).toHaveLength(2)
    expect(bundle.records[0]!.budget).toBe(120000)

    // 读回：GET /api/tables 可见且行保持
    const listRes = await app.request('/api/tables')
    const { tables } = (await listRes.json()) as AllTablesResponse
    const created = tables.find((t) => t.meta.id === bundle.meta.id)!
    expect(created.records).toHaveLength(2)
    expect(created.records[1]!.budget).toBe(80000)

    // records 形状不合法（非对象数组）返回 400
    const badRes = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '坏数据', records: ['不是对象'] }),
    })
    expect(badRes.status).toBe(400)
  })
})

describe('Excel/CSV 导入：commit 建表与行写入', () => {
  test('normal 提交：建普通表 + 事务批量插行，数字列落库为 number', async () => {
    const { app } = createSeededTestEnv()
    const commitRes = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'normal',
        tableName: '渠道线索表',
        columns: [
          { key: 'lead_id', label: '线索ID', type: 'text' },
          { key: 'company', label: '公司名称', type: 'text' },
          { key: 'budget', label: '预算', type: 'number' },
          { key: 'created', label: '创建日期', type: 'date' },
        ],
        rows: [
          ['L-001', '杭州云脉科技', '120000', '2025-03-01'],
          ['L-002', '苏州深蓝智造', '80000', '2025-03-05'],
        ],
      }),
    })
    expect(commitRes.status).toBe(201)
    const bundle = (await commitRes.json()) as TableBundle
    expect(bundle.meta.kind).toBe('normal')
    expect(bundle.meta.name).toBe('渠道线索表')
    expect(bundle.meta.columns.map((c) => c.title)).toEqual([
      '线索ID',
      '公司名称',
      '预算',
      '创建日期',
    ])
    expect(bundle.records).toHaveLength(2)
    expect(bundle.records[0]!.budget).toBe(120000)
    expect(bundle.records[0]!.created).toBe('2025-03-01')

    // 读回：GET /api/tables 可见、行数与类型保持
    const listRes = await app.request('/api/tables')
    const { tables } = (await listRes.json()) as AllTablesResponse
    const created = tables.find((t) => t.meta.id === bundle.meta.id)!
    expect(created.records).toHaveLength(2)
    expect(created.records[1]!.budget).toBe(80000)

    // 请求体不合法返回 400
    const badRes = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'normal', tableName: '  ', columns: [], rows: [] }),
    })
    expect(badRes.status).toBe(400)
  })

  test('advanced 提交：落 SQL 物理表（formula 列仅存 meta）、行级 CRUD 可用、可整表删除', async () => {
    const { db, app } = createSeededTestEnv()
    const commitRes = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'advanced',
        tableName: 'lead_pool',
        columns: [
          { key: 'lead_id', label: '线索ID', type: 'text' },
          { key: 'company', label: '公司名称', type: 'text' },
          { key: 'budget', label: '预算', type: 'number' },
          { key: 'tier', label: '预算分档', type: 'formula' },
        ],
        rows: [
          ['L-001', '杭州云脉科技', '120000', ''],
          ['L-002', '苏州深蓝智造', '80000', ''],
          ['L-003', '广州湾区数联', '', ''],
        ],
      }),
    })
    expect(commitRes.status).toBe(201)
    const bundle = (await commitRes.json()) as TableBundle
    const meta = bundle.meta
    expect(meta.kind).toBe('advanced')
    expect(meta.sourceSqlTable).toBe('lead_pool')
    expect(meta.primaryKeyField).toBe('lead_id')
    expect(meta.system).toBeUndefined()
    // formula 列在 meta 中保留但不落物理列
    expect(meta.columns.some((c) => c.key === 'tier' && c.type === 'formula')).toBe(true)

    // 物理表落库验证：数字列为 number、空数字为 NULL、无 tier 列
    const physicalRows = db
      .query('SELECT lead_id, company, budget FROM lead_pool ORDER BY rowid ASC')
      .all() as { lead_id: string; company: string; budget: number | null }[]
    expect(physicalRows).toEqual([
      { lead_id: 'L-001', company: '杭州云脉科技', budget: 120000 },
      { lead_id: 'L-002', company: '苏州深蓝智造', budget: 80000 },
      { lead_id: 'L-003', company: '广州湾区数联', budget: null },
    ])
    const pragmaCols = db.query('PRAGMA table_info("lead_pool")').all() as { name: string }[]
    expect(pragmaCols.map((c) => c.name)).toEqual(['lead_id', 'company', 'budget'])

    // 动态白名单生效：既有行级 CRUD 路由直接读写
    const listRes = await app.request('/api/tables')
    const { tables } = (await listRes.json()) as AllTablesResponse
    const imported = tables.find((t) => t.meta.id === meta.id)!
    expect(imported.records).toHaveLength(3)
    expect(imported.records.every((r) => r._id === r.lead_id)).toBe(true)

    const patchRes = await app.request(`/api/tables/${meta.id}/records/L-002`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { budget: 95000 } }),
    })
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as { record: SmartRecord }
    expect(patched.record.budget).toBe(95000)

    const delRecordRes = await app.request(`/api/tables/${meta.id}/records/L-003`, {
      method: 'DELETE',
    })
    expect(delRecordRes.status).toBe(200)

    // 用户自建 advanced 表可整表删除：物理表被 DROP、meta 级联移除
    const delTableRes = await app.request(`/api/tables/${meta.id}`, { method: 'DELETE' })
    expect(delTableRes.status).toBe(200)
    expect(await delTableRes.json()).toEqual({ ok: true })
    const dropped = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lead_pool'")
      .get()
    expect(dropped).toBeUndefined()
    const metaAfter = db.query('SELECT id FROM smart_tables WHERE id = ?').get(meta.id)
    expect(metaAfter).toBeUndefined()

    // 系统内置进阶表（system:true）拒绝删除
    const delEmpRes = await app.request('/api/tables/tbl_employees', { method: 'DELETE' })
    expect(delEmpRes.status).toBe(400)
    const delPayRes = await app.request('/api/tables/tbl_payments', { method: 'DELETE' })
    expect(delPayRes.status).toBe(400)
  })

  test('advanced 提交的主键列校验：空主键行 400、重复主键 409', async () => {
    const { app } = createSeededTestEnv()
    const emptyPkRes = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'advanced',
        tableName: 'dup_lead',
        columns: [
          { key: 'lead_id', label: 'ID', type: 'text' },
          { key: 'company', label: '公司', type: 'text' },
        ],
        rows: [
          ['L-001', '甲'],
          ['', '空主键行'],
        ],
      }),
    })
    expect(emptyPkRes.status).toBe(400)

    const dupPkRes = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'advanced',
        tableName: 'dup_lead',
        columns: [
          { key: 'lead_id', label: 'ID', type: 'text' },
          { key: 'company', label: '公司', type: 'text' },
        ],
        rows: [
          ['L-001', '甲'],
          ['L-001', '乙'],
        ],
      }),
    })
    expect(dupPkRes.status).toBe(409)
  })
})

describe('种子版本自愈（PRAGMA user_version）', () => {
  test('旧版本库且无用户表：ensureSeeded 自动 force 重种并推进版本', () => {
    const db = openDatabase(':memory:')
    seedSmartTableDemo(db)
    // 模拟旧种子：版本落后 + 种子数据损坏（丢行、无 system 标记）
    db.exec(`PRAGMA user_version = ${SEED_VERSION - 1};`)
    db.exec(
      "UPDATE smart_tables SET schema_json = json_remove(schema_json, '$.system') WHERE id = 'tbl_employees';",
    )
    db.exec("DELETE FROM smart_table_records WHERE table_id = 'tbl_projects' AND row_order >= 8;")

    ensureSeeded(db)

    const versionRow = db.query('PRAGMA user_version').get() as { user_version: number }
    expect(versionRow.user_version).toBe(SEED_VERSION)
    const tables = listTableBundles(db)
    expect(tables).toHaveLength(6)
    expect(tables.find((t) => t.meta.id === 'tbl_projects')!.records).toHaveLength(16)
    expect(tables.find((t) => t.meta.id === 'tbl_employees')!.meta.system).toBe(true)
    db.close()
  })

  test('存在用户自建表：不自动重种（避免毁数据），版本记录保持不动', () => {
    const db = openDatabase(':memory:')
    seedSmartTableDemo(db)
    db.exec(`PRAGMA user_version = ${SEED_VERSION - 1};`)
    db.exec("DELETE FROM smart_table_records WHERE table_id = 'tbl_projects' AND row_order >= 8;")
    db.exec(`
      INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at)
      VALUES ('tbl_user_custom', '我的表', 'normal', NULL, NULL,
        '{"columns":[{"key":"title","title":"标题","type":"text","width":120}],"summaries":{}}',
        '[{"id":"v1","name":"全部","type":"table","filterGroup":{"conjunction":"and","conditions":[]},"quickFilterFields":[],"sortRules":[]}]',
        '2025-06-01T00:00:00.000Z');
    `)

    ensureSeeded(db)

    const versionRow = db.query('PRAGMA user_version').get() as { user_version: number }
    expect(versionRow.user_version).toBe(SEED_VERSION - 1)
    const tables = listTableBundles(db)
    expect(tables).toHaveLength(7)
    // 种子损坏未被自动修复（用户数据优先），用户表仍在
    expect(tables.find((t) => t.meta.id === 'tbl_projects')!.records).toHaveLength(8)
    expect(tables.some((t) => t.meta.id === 'tbl_user_custom')).toBe(true)
    db.close()
  })
})
