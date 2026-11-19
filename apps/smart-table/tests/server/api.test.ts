// 服务端 API 与 SQLite 持久化集成测试（使用 ':memory:' 内存数据库通过 vitest 运行）。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'vitest'
import { listTableBundles, openDatabase, resolveDbPath } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { SEED_VERSION, ensureSeeded, seedSmartTableDemo } from '../../src/server/seed'
import type {
  AllAppsResponse,
  AllTablesResponse,
  BatchImportRecordsResponse,
  TableBundle,
} from '../../src/shared/api-types'
import type { SmartApp, SmartRecord, SmartTableMeta } from '../../src/shared/schema'

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

    // 表 1：项目跟进与业绩总表（16 行，3 视图，数据源层不再含派生列与 _lookupOverrides）
    expect(projects!.meta.kind).toBe('normal')
    expect(projects!.meta.views).toHaveLength(3)
    expect(projects!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot', 'table'])
    expect(projects!.records).toHaveLength(16)
    const prj001 = projects!.records.find((r) => r.project_code === 'PRJ-2025-001')
    const prj006 = projects!.records.find((r) => r.project_code === 'PRJ-2025-006')
    expect(prj001?._lookupOverrides).toBeUndefined()
    expect(prj006?._lookupOverrides).toBeUndefined()
    expect(projects!.meta.columns.some((c) => c.type === 'lookup' || c.type === 'formula')).toBe(
      false,
    )
    expect(projects!.meta.summaries.lookup_paid_sum).toBeUndefined()
    expect(projects!.meta.summaries.formula_pay_rate).toBeUndefined()
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

    // 表 4~6：库存台账（16 行）、供应商名录（8 行）、客户工单（18 行）均仅保留原始字段
    expect(inventory!.records).toHaveLength(16)
    expect(inventory!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot'])
    expect(inventory!.meta.columns.some((c) => c.type === 'lookup' || c.type === 'formula')).toBe(
      false,
    )
    expect(inventory!.meta.summaries.formula_stock_gap).toBeUndefined()
    expect(suppliers!.records).toHaveLength(8)
    expect(tickets!.records).toHaveLength(18)
    expect(tickets!.meta.views.map((v) => v.type)).toEqual(['table', 'pivot'])
    expect(tickets!.meta.columns.some((c) => c.type === 'lookup' || c.type === 'formula')).toBe(
      false,
    )

    // SEED_VERSION = 8：真实业务小数样本与列/透视/KPI decimalPlaces 示范配置
    expect(SEED_VERSION).toBe(8)
    const prjRec001 = projects!.records.find((r) => r._id === 'rec_prj_001')!
    const prjRec002 = projects!.records.find((r) => r._id === 'rec_prj_002')!
    const invRec001 = body.tables
      .find((t) => t.meta.id === 'tbl_inventory')!
      .records.find((r) => r._id === 'rec_inv_001')!
    const supRec001 = body.tables
      .find((t) => t.meta.id === 'tbl_suppliers')!
      .records.find((r) => r._id === 'rec_sup_001')!
    const tktRec001 = tickets!.records.find((r) => r._id === 'rec_tkt_001')!
    expect(prjRec001.contract_amount).toBe(1200000.1)
    expect(prjRec002.contract_amount).toBe(850000.2)
    expect(invRec001.capacity_rate).toBe(68.5)
    expect(supRec001.rating).toBe(4.915)
    expect(tktRec001.sla_progress).toBe(65.1)
    expect(projects!.meta.columns.find((c) => c.key === 'contract_amount')?.decimalPlaces).toBe(2)
    const appsRes = await app.request('/api/apps')
    expect(appsRes.status).toBe(200)
    const appsBody = (await appsRes.json()) as AllAppsResponse
    const appProjects = appsBody.apps.find((a) => a.id === 'app_projects')!
    const appInventory = appsBody.apps.find((a) => a.id === 'app_inventory')!
    const appTickets = appsBody.apps.find((a) => a.id === 'app_tickets')!
    expect(appProjects.derivedColumns?.map((c) => c.key)).toEqual([
      'lookup_emp_id',
      'lookup_emp_dept',
      'lookup_emp_level',
      'lookup_paid_sum',
      'lookup_paid_count',
      'formula_pay_rate',
    ])
    expect(appProjects.lookupOverrides).toEqual({ rec_prj_006: { grp_emp: 'EMP-009' } })
    expect(appInventory.derivedColumns?.map((c) => c.key)).toEqual([
      'lookup_supplier_name',
      'lookup_lead_days',
      'formula_stock_gap',
      'formula_restock_alert',
    ])
    expect(appTickets.derivedColumns?.map((c) => c.key)).toEqual([
      'lookup_project_name',
      'formula_sla_flag',
    ])
  })
})

describe('普通表记录增删改、跨表同 _id 与派生/消歧字段剥离', () => {
  test('支持普通表新增、局部 PATCH（自动剔除计算列与 _lookupOverrides）与删除', async () => {
    const { app } = createSeededTestEnv()

    // 新增项目记录（携带 SmartApp 派生列、_lookupOverrides 与显式 _id，验证非原始字段被剔除）
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
          _lookupOverrides: { grp_emp: 'EMP-009' },
        },
      }),
    })
    expect(createRes.status).toBe(201)
    const createdBody = (await createRes.json()) as { record: SmartRecord }
    expect(createdBody.record._id).toBe('shared_rec_id')
    expect(createdBody.record.project_code).toBe('PRJ-2025-099')
    expect(createdBody.record.lookup_emp_id).toBeUndefined()
    expect(createdBody.record.formula_pay_rate).toBeUndefined()
    expect(createdBody.record._lookupOverrides).toBeUndefined()

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

    // PATCH 传入派生列与 _lookupOverrides 不应落入记录，原始字段正常更新
    const patchRes = await app.request(
      `/api/tables/tbl_projects/records/${createdBody.record._id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patch: {
            progress: 85,
            _lookupOverrides: { grp_extra: 'EXT-001' },
            lookup_emp_dept: 'SHOULD_NOT_PERSIST',
          },
        }),
      },
    )
    expect(patchRes.status).toBe(200)
    const patchBody = (await patchRes.json()) as { record: SmartRecord }
    expect(patchBody.record._lookupOverrides).toBeUndefined()
    expect(patchBody.record.lookup_emp_dept).toBeUndefined()
    expect(patchBody.record.progress).toBe(85)
    expect(patchBody.record.project_name).toBe('新增测试项目')

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

    // 修改 EMP-009 主键为 EMP-909 时，联动更新 app_projects.lookupOverrides
    const renamePkRes = await app.request('/api/tables/tbl_employees/records/EMP-009', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { emp_id: 'EMP-909' } }),
    })
    expect(renamePkRes.status).toBe(200)
    const appRes = await app.request('/api/apps/app_projects')
    expect(appRes.status).toBe(200)
    const { app: updatedProjectApp } = (await appRes.json()) as { app: SmartApp }
    expect(updatedProjectApp.lookupOverrides?.rec_prj_006).toEqual({ grp_emp: 'EMP-909' })
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

  test('advanced 提交：落 SQL 物理表、拒绝派生列、行级 CRUD 可用、可整表删除', async () => {
    const { db, app } = createSeededTestEnv()
    // 携带 formula / lookup 列提交导入应被拒绝（HTTP 400）
    const rejectedCommitRes = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'advanced',
        tableName: 'lead_pool_bad',
        columns: [
          { key: 'lead_id', label: '线索ID', type: 'text' },
          { key: 'tier', label: '预算分档', type: 'formula' },
        ],
        rows: [['L-001', '']],
      }),
    })
    expect(rejectedCommitRes.status).toBe(400)

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
        ],
        rows: [
          ['L-001', '杭州云脉科技', '120000'],
          ['L-002', '苏州深蓝智造', '80000'],
          ['L-003', '广州湾区数联', ''],
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
    expect(meta.columns.some((c) => c.type === 'formula' || c.type === 'lookup')).toBe(false)

    // 物理表落库验证：数字列为 number、空数字为 NULL
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

describe('数据源表拒绝派生列、required/align 持久化、单行与批量校验及 GET /api/tables/:id', () => {
  test('数据源表拒绝保存 lookup / formula 列，并支持保存与返回 required 与 align', async () => {
    const { app } = createSeededTestEnv()

    // 1. POST /api/tables 拒绝 lookup / formula
    const createLookupTable = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '非法派生列表',
        columns: [
          { key: 'name', title: '名称', type: 'text', width: 120 },
          { key: 'lookup_dept', title: '部门', type: 'lookup', width: 120 },
        ],
      }),
    })
    expect(createLookupTable.status).toBe(400)

    const createFormulaTable = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '非法公式表',
        columns: [
          { key: 'amount', title: '金额', type: 'number', width: 120 },
          { key: 'double_amount', title: '双倍', type: 'formula', width: 120 },
        ],
      }),
    })
    expect(createFormulaTable.status).toBe(400)

    // 2. POST /api/import/commit (normal) 拒绝 lookup / formula
    const commitWithDerived = await app.request('/api/import/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'normal',
        tableName: '含派生导入表',
        columns: [
          { key: 'code', label: '编码', type: 'text' },
          { key: 'ref', label: '关联', type: 'lookup' },
        ],
        rows: [['A-1', '']],
      }),
    })
    expect(commitWithDerived.status).toBe(400)

    // 3. 合法数据源表可配置 required 与 align 并持久化；PUT /meta 拒绝派生列与非法 align/required
    const createValid = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '合同录入表',
        columns: [
          { key: 'code', title: '合同号', type: 'text', width: 140, required: true, align: 'left' },
          {
            key: 'amount',
            title: '金额',
            type: 'number',
            width: 140,
            required: true,
            align: 'right',
          },
          { key: 'sign_date', title: '签约日', type: 'date', width: 130, align: 'center' },
        ],
      }),
    })
    expect(createValid.status).toBe(201)
    const createdBundle = (await createValid.json()) as TableBundle

    // GET /api/tables/:id 返回单表 Bundle（含 required / align），不存在返回 404
    const getOneRes = await app.request(`/api/tables/${createdBundle.meta.id}`)
    expect(getOneRes.status).toBe(200)
    const fetched = (await getOneRes.json()) as TableBundle
    expect(fetched.meta.columns[0]?.required).toBe(true)
    expect(fetched.meta.columns[1]?.align).toBe('right')
    expect(fetched.meta.columns[2]?.align).toBe('center')

    const missingTableRes = await app.request('/api/tables/tbl_not_exists')
    expect(missingTableRes.status).toBe(404)

    const putDerivedRes = await app.request(`/api/tables/${createdBundle.meta.id}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          ...fetched.meta,
          columns: [
            ...fetched.meta.columns,
            { key: 'calc', title: '公式列', type: 'formula', width: 120, formulaExpr: '1+1' },
          ],
        },
      }),
    })
    expect(putDerivedRes.status).toBe(400)

    const putBadAlignRes = await app.request(`/api/tables/${createdBundle.meta.id}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          ...fetched.meta,
          columns: fetched.meta.columns.map((c, idx) =>
            idx === 0 ? { ...c, align: 'justify' } : c,
          ),
        },
      }),
    })
    expect(putBadAlignRes.status).toBe(400)
  })

  test('单行 POST/PATCH 强制校验 required 与字段类型', async () => {
    const { app } = createSeededTestEnv()

    const tableRes = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '校验测试表',
        columns: [
          { key: 'code', title: '编号', type: 'text', width: 120, required: true },
          { key: 'amount', title: '金额', type: 'number', width: 120, required: true },
          { key: 'due_date', title: '交付日', type: 'date', width: 120 },
          { key: 'progress', title: '进度', type: 'progress', width: 100 },
          { key: 'verified', title: '已核验', type: 'checkbox', width: 90 },
        ],
      }),
    })
    const { meta } = (await tableRes.json()) as TableBundle

    // 缺少 required 字段 -> 400
    const missingReq = await app.request(`/api/tables/${meta.id}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: { code: 'C-1' } }),
    })
    expect(missingReq.status).toBe(400)

    // 非法日期 -> 400
    const badDate = await app.request(`/api/tables/${meta.id}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: { code: 'C-1', amount: 100, due_date: '2025-02-30' },
      }),
    })
    expect(badDate.status).toBe(400)

    // 合法创建（字符串数值/日期/中文布尔自动归一化）
    const validCreate = await app.request(`/api/tables/${meta.id}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        record: {
          code: 'C-1',
          amount: '2500.5',
          due_date: '2026/5/1',
          progress: '120',
          verified: '是',
        },
      }),
    })
    expect(validCreate.status).toBe(201)
    const { record: created } = (await validCreate.json()) as { record: SmartRecord }
    expect(created.amount).toBe(2500.5)
    expect(created.due_date).toBe('2026-05-01')
    expect(created.progress).toBe(100)
    expect(created.verified).toBe(true)

    // PATCH 将 required 列清空 -> 400
    const clearRequiredPatch = await app.request(`/api/tables/${meta.id}/records/${created._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { code: '   ' } }),
    })
    expect(clearRequiredPatch.status).toBe(400)

    // PATCH 仅改非 required 字段 -> 200
    const okPatch = await app.request(`/api/tables/${meta.id}/records/${created._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patch: { progress: '60' } }),
    })
    expect(okPatch.status).toBe(200)
    const { record: patched } = (await okPatch.json()) as { record: SmartRecord }
    expect(patched.progress).toBe(60)
  })

  test('POST /api/tables/:id/records/batch 仅限 normal 表，校验失败整批零写入并返回错误明细', async () => {
    const { app } = createSeededTestEnv()

    const tableRes = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '批量导入目标表',
        columns: [
          { key: 'code', title: '编号', type: 'text', width: 120, required: true },
          { key: 'amount', title: '金额', type: 'number', width: 120, required: true },
          { key: 'due_date', title: '日期', type: 'date', width: 120 },
        ],
      }),
    })
    const { meta } = (await tableRes.json()) as TableBundle

    // 1. 进阶表禁止批量追加 -> 400
    const advBatchRes = await app.request('/api/tables/tbl_employees/records/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ emp_id: 'E-99', name: '测试' }] }),
    })
    expect(advBatchRes.status).toBe(400)

    // 2. 不存在的表 -> 404
    const missingBatchRes = await app.request('/api/tables/tbl_not_found/records/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [{ code: 'A' }] }),
    })
    expect(missingBatchRes.status).toBe(404)

    // 3. 空数组 -> 400
    const emptyBatchRes = await app.request(`/api/tables/${meta.id}/records/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: [] }),
    })
    expect(emptyBatchRes.status).toBe(400)

    // 4. 第 2 行含多处错误：整批拦截返回 400 与 errors，且数据库零写入
    const badBatchRes = await app.request(`/api/tables/${meta.id}/records/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [
          { code: 'B-1', amount: '100', due_date: '2026-01-10' },
          { code: '', amount: 'not_num', due_date: '2026-02-30' },
        ],
      }),
    })
    expect(badBatchRes.status).toBe(400)
    const badBatchBody = (await badBatchRes.json()) as {
      message: string
      errors: Array<{ rowIndex: number; field: string; columnTitle: string; message: string }>
    }
    expect(badBatchBody.errors).toHaveLength(3)
    expect(badBatchBody.errors.every((e) => e.rowIndex === 1)).toBe(true)

    const afterFailBundle = (await (
      await app.request(`/api/tables/${meta.id}`)
    ).json()) as TableBundle
    expect(afterFailBundle.records).toHaveLength(0)

    // 5. 全部合法：整批落库返回 201
    const okBatchRes = await app.request(`/api/tables/${meta.id}/records/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [
          { code: 'B-1', amount: '1000', due_date: '2026/1/10', _lookupOverrides: { g: 'x' } },
          { code: 'B-2', amount: 2500, due_date: '2026-02-20' },
        ],
      }),
    })
    expect(okBatchRes.status).toBe(201)
    const okBatchBody = (await okBatchRes.json()) as BatchImportRecordsResponse
    expect(okBatchBody.insertedCount).toBe(2)
    expect(okBatchBody.records).toHaveLength(2)
    expect(okBatchBody.records[0]?.amount).toBe(1000)
    expect(okBatchBody.records[0]?.due_date).toBe('2026-01-10')
    expect(okBatchBody.records[0]?._lookupOverrides).toBeUndefined()

    const afterOkBundle = (await (
      await app.request(`/api/tables/${meta.id}`)
    ).json()) as TableBundle
    expect(afterOkBundle.records).toHaveLength(2)
  })
})

describe('列 decimalPlaces（0~6 整数）服务端校验与持久化', () => {
  test('POST /api/tables 与 PUT /api/tables/:id/meta 持久化合法 decimalPlaces（0~6），拒绝越界/小数/非数字（400）', async () => {
    const { app } = createSeededTestEnv()

    const badValues: unknown[] = [-1, 7, 1.5, '2']
    for (const bad of badValues) {
      const badRes = await app.request('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '非法小数位表',
          columns: [
            { key: 'code', title: '编号', type: 'text', width: 100 },
            {
              key: 'amount',
              title: '金额',
              type: 'number',
              width: 120,
              numberFormat: 'currency',
              decimalPlaces: bad,
            },
          ],
        }),
      })
      expect(badRes.status).toBe(400)
    }

    const okRes = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '高精度台账',
        columns: [
          { key: 'code', title: '编号', type: 'text', width: 100 },
          {
            key: 'amount',
            title: '金额',
            type: 'number',
            width: 120,
            numberFormat: 'currency',
            decimalPlaces: 0,
          },
          { key: 'progress', title: '进度', type: 'progress', width: 120, decimalPlaces: 6 },
        ],
      }),
    })
    expect(okRes.status).toBe(201)
    const { meta } = (await okRes.json()) as TableBundle
    expect(meta.columns.find((c) => c.key === 'amount')?.decimalPlaces).toBe(0)
    expect(meta.columns.find((c) => c.key === 'progress')?.decimalPlaces).toBe(6)

    // PUT /api/tables/:id/meta 修改为非法值返回 400，合法值持久化成功
    const badPutRes = await app.request(`/api/tables/${meta.id}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          ...meta,
          columns: meta.columns.map((c) => (c.key === 'amount' ? { ...c, decimalPlaces: 7 } : c)),
        },
      }),
    })
    expect(badPutRes.status).toBe(400)

    const okPutRes = await app.request(`/api/tables/${meta.id}/meta`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meta: {
          ...meta,
          columns: meta.columns.map((c) => (c.key === 'amount' ? { ...c, decimalPlaces: 3 } : c)),
        },
      }),
    })
    expect(okPutRes.status).toBe(200)
    const reloaded = (await (await app.request(`/api/tables/${meta.id}`)).json()) as TableBundle
    expect(reloaded.meta.columns.find((c) => c.key === 'amount')?.decimalPlaces).toBe(3)
  })
})
