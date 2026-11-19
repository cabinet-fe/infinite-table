// 独立应用视图（WorkspaceView）持久化、旧库平滑迁移、REST API 与看板写回集成测试
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'vitest'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { SEED_VERSION, seedSmartTableDemo } from '../../src/server/seed'
import type {
  AllAppsResponse,
  AllTablesResponse,
  AllViewsResponse,
  CreateAppResponse,
  TableBundle,
} from '../../src/shared/api-types'
import type { SmartApp, SmartRecord, WorkspaceView } from '../../src/shared/schema'
import { createAuthedClient, loginAsAdmin } from './testing/auth-helper'

async function createSeededTestEnv() {
  const db = openDatabase(':memory:')
  seedSmartTableDemo(db)
  const rawApp = createApp(db)
  const { cookie } = await loginAsAdmin(rawApp)
  const app = createAuthedClient(rawApp, cookie)
  return { db, app, rawApp }
}

describe('旧库 smart_tables.views_json 到 workspace_views 的平滑迁移', () => {
  test('无 workspace_views 表的旧库启动后自动迁移视图，并自动消解跨表重名视图 ID', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-table-views-migrate-'))
    const dbPath = join(dir, 'legacy-views.sqlite')
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
          id TEXT NOT NULL,
          table_id TEXT NOT NULL,
          row_order INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          PRIMARY KEY (table_id, id)
        );
      `)
      const insertStmt = legacyDb.query(
        'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      insertStmt.run(
        'tbl_a',
        '表A',
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
            name: '表A全部',
            type: 'table',
            filterGroup: { conjunction: 'and', conditions: [] },
            quickFilterFields: [],
            sortRules: [],
          },
          {
            id: 'v_pivot_a',
            name: '表A透视',
            type: 'pivot',
            filterGroup: { conjunction: 'and', conditions: [] },
            quickFilterFields: [],
            sortRules: [],
          },
        ]),
        '2025-05-01T00:00:00.000Z',
      )
      insertStmt.run(
        'tbl_b',
        '表B',
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
            name: '表B全部',
            type: 'table',
            filterGroup: { conjunction: 'and', conditions: [] },
            quickFilterFields: [],
            sortRules: [],
          },
        ]),
        '2025-05-01T00:00:00.000Z',
      )
      legacyDb.close()

      const upgraded = openDatabase(dbPath)
      try {
        const rawApp = createApp(upgraded)
        const { cookie } = await loginAsAdmin(rawApp)
        const app = createAuthedClient(rawApp, cookie)
        const res = await app.request('/api/views')
        expect(res.status).toBe(200)
        const body = (await res.json()) as AllViewsResponse
        expect(body.views).toHaveLength(3)
        expect(body.views.map((v) => [v.id, v.tableId, v.name, v.type, v.sortOrder])).toEqual([
          ['v1', 'tbl_a', '表A全部', 'table', 0],
          ['v_pivot_a', 'tbl_a', '表A透视', 'pivot', 1],
          ['v1_tbl_b', 'tbl_b', '表B全部', 'table', 2],
        ])
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('已有无 app_id 列的 workspace_views 旧库（v3/v4）可平滑升级补列建索引并回填 smart_apps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-table-views-v4-migrate-'))
    const dbPath = join(dir, 'v4-views.sqlite')
    try {
      const v4Db = new Database(dbPath)
      v4Db.exec(`
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
        CREATE TABLE workspace_views (
          id TEXT PRIMARY KEY,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE smart_table_records (
          id TEXT NOT NULL,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          row_order INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          PRIMARY KEY (table_id, id)
        );
      `)
      v4Db
        .query(
          'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'tbl_v4',
          'v4客户表',
          'normal',
          null,
          null,
          JSON.stringify({
            columns: [{ key: 'name', title: '客户', type: 'text', width: 120 }],
            summaries: {},
          }),
          '[]',
          '2025-06-01T00:00:00.000Z',
        )
      v4Db
        .query(
          'INSERT INTO workspace_views (id, table_id, name, type, sort_order, config_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'wv_v4_1',
          'tbl_v4',
          'v4客户视图',
          'table',
          0,
          JSON.stringify({
            filterGroup: { conjunction: 'and', conditions: [] },
            quickFilterFields: [],
            sortRules: [],
          }),
          '2025-06-01T00:00:00.000Z',
        )
      v4Db.close()

      const upgraded = openDatabase(dbPath)
      try {
        const rawApp = createApp(upgraded)
        const { cookie } = await loginAsAdmin(rawApp)
        const app = createAuthedClient(rawApp, cookie)
        const appsRes = await app.request('/api/apps')
        expect(appsRes.status).toBe(200)
        const appsBody = (await appsRes.json()) as AllAppsResponse
        expect(appsBody.apps).toHaveLength(1)
        expect(appsBody.apps[0]?.tableId).toBe('tbl_v4')

        const viewsRes = await app.request('/api/views')
        expect(viewsRes.status).toBe(200)
        const viewsBody = (await viewsRes.json()) as AllViewsResponse
        expect(viewsBody.views).toHaveLength(1)
        expect(viewsBody.views[0]?.appId).toBe(appsBody.apps[0]?.id)
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('SEED_VERSION 示范应用视图与独立视图 CRUD / 样式持久化 / 看板写回', () => {
  test('种子初始化预置多张智能表格与四类示范应用视图且含样式/条件格式/冻结列/看板/仪表盘配置', async () => {
    const { db, app } = await createSeededTestEnv()
    const versionRow = db.query('PRAGMA user_version').get() as { user_version: number }
    expect(versionRow.user_version).toBe(SEED_VERSION)
    expect(SEED_VERSION).toBeGreaterThanOrEqual(5)

    const appsRes = await app.request('/api/apps')
    expect(appsRes.status).toBe(200)
    const { apps } = (await appsRes.json()) as AllAppsResponse
    expect(apps.length).toBeGreaterThanOrEqual(7)

    const viewsRes = await app.request('/api/views')
    expect(viewsRes.status).toBe(200)
    const { views } = (await viewsRes.json()) as AllViewsResponse
    expect(views.length).toBeGreaterThanOrEqual(15)
    expect(views.every((v) => Boolean(v.appId))).toBe(true)

    // 验证同一数据源可被多张不同业务智能表格复用
    const paymentApps = apps.filter((a) => a.tableId === 'tbl_payments')
    expect(paymentApps.length).toBeGreaterThanOrEqual(2)

    // 验证多视图归属于同一张智能表格
    const projectViews = views.filter((v) => v.appId === 'app_projects')
    expect(new Set(projectViews.map((v) => v.type))).toEqual(
      new Set(['table', 'kanban', 'pivot', 'dashboard']),
    )

    // 测试新建智能表格 + 追加视图 + 级联删除智能表格不影响底层数据源
    const createAppRes = await app.request('/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '自定义项目子表',
        tableId: 'tbl_projects',
        description: '验证新建智能表格',
      }),
    })
    expect(createAppRes.status).toBe(201)
    const createdAppBody = (await createAppRes.json()) as CreateAppResponse
    expect(createdAppBody.app.tableId).toBe('tbl_projects')
    expect(createdAppBody.defaultView.appId).toBe(createdAppBody.app.id)

    const addViewRes = await app.request('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: createdAppBody.app.id,
        name: '子表看板',
        type: 'kanban',
      }),
    })
    expect(addViewRes.status).toBe(201)
    const addedView = ((await addViewRes.json()) as { view: WorkspaceView }).view
    expect(addedView.appId).toBe(createdAppBody.app.id)
    expect(addedView.tableId).toBe('tbl_projects')

    const delAppRes = await app.request(`/api/apps/${createdAppBody.app.id}`, { method: 'DELETE' })
    expect(delAppRes.status).toBe(200)
    const tablesAfter = (await (await app.request('/api/tables')).json()) as AllTablesResponse
    expect(tablesAfter.tables.some((t) => t.meta.id === 'tbl_projects')).toBe(true)

    const coveredTables = new Set(views.map((v) => v.tableId))
    expect(coveredTables).toEqual(
      new Set([
        'tbl_projects',
        'tbl_employees',
        'tbl_payments',
        'tbl_inventory',
        'tbl_suppliers',
        'tbl_tickets',
      ]),
    )

    const types = new Set(views.map((v) => v.type))
    expect(types).toEqual(new Set(['table', 'kanban', 'pivot', 'dashboard']))

    const prjTable = views.find((v) => v.id === 'wv_projects_table')!
    expect(prjTable.tableId).toBe('tbl_projects')
    expect(prjTable.frozenColCount).toBe(2)
    expect(prjTable.columnStyles?.contract_amount?.align).toBe('right')
    expect(prjTable.cellStyles?.rec_prj_003?.contract_amount?.bgColor).toBe('#fef9c3')
    expect(prjTable.conditionalFormats).toHaveLength(3)
    expect(prjTable.summaries?.contract_amount).toBe('sum')

    const prjKanban = views.find((v) => v.id === 'wv_projects_kanban')!
    expect(prjKanban.kanbanConfig?.groupByField).toBe('status')

    const execDash = views.find((v) => v.id === 'wv_exec_dashboard')!
    expect(execDash.dashboardConfig?.kpis.length).toBeGreaterThanOrEqual(4)
    expect(execDash.dashboardConfig?.charts.length).toBeGreaterThanOrEqual(4)
  })

  test('应用视图 CRUD、样式/条件格式持久化、重排序、删除与重置种子', async () => {
    const { app } = await createSeededTestEnv()

    // 1. 新建独立应用视图（绑定 tbl_suppliers）
    const createRes = await app.request('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '高评分供应商台账',
        type: 'table',
        tableId: 'tbl_suppliers',
        frozenColCount: 1,
        rowHeight: 'comfortable',
        columnOrder: ['supplier_id', 'supplier_name', 'rating'],
        hiddenColumns: ['website'],
        columnWidths: { supplier_name: 260 },
        columnStyles: {
          rating: { align: 'right', headerBgColor: '#ecfdf5', headerTextColor: '#047857' },
        },
        conditionalFormats: [
          {
            id: 'cf_high_rating',
            field: 'rating',
            operator: 'gte',
            value: 4.8,
            scope: 'row',
            bgColor: '#dcfce7',
            textColor: '#166534',
          },
        ],
      }),
    })
    expect(createRes.status).toBe(201)
    const { view: created } = (await createRes.json()) as { view: WorkspaceView }
    expect(created.tableId).toBe('tbl_suppliers')
    expect(created.frozenColCount).toBe(1)
    expect(created.rowHeight).toBe('comfortable')
    expect(created.columnStyles?.rating?.align).toBe('right')

    // 绑定不存在的表返回 400
    const badTableRes = await app.request('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '非法视图', type: 'table', tableId: 'tbl_not_exists' }),
    })
    expect(badTableRes.status).toBe(400)

    // 2. PATCH 更新名称与单元格自定义样式，并验证可持久化与显式 null 清除
    const patchRes = await app.request(`/api/views/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '精选供应商视图',
        cellStyles: {
          rec_sup_001: { supplier_name: { bgColor: '#fef9c3', textColor: '#854d0e' } },
        },
      }),
    })
    expect(patchRes.status).toBe(200)
    const { view: patched } = (await patchRes.json()) as { view: WorkspaceView }
    expect(patched.name).toBe('精选供应商视图')
    expect(patched.cellStyles?.rec_sup_001?.supplier_name?.bgColor).toBe('#fef9c3')

    const clearCellStyleRes = await app.request(`/api/views/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellStyles: null }),
    })
    expect(clearCellStyleRes.status).toBe(200)
    const { view: cleared } = (await clearCellStyleRes.json()) as { view: WorkspaceView }
    expect(cleared.cellStyles).toBeUndefined()

    // 3. 重排序
    const reorderRes = await app.request('/api/views/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ viewIds: [created.id, 'wv_exec_dashboard'] }),
    })
    expect(reorderRes.status).toBe(200)
    const { views: reordered } = (await reorderRes.json()) as AllViewsResponse
    expect(reordered[0]!.id).toBe(created.id)
    expect(reordered[1]!.id).toBe('wv_exec_dashboard')

    // 4. 删除视图
    const delRes = await app.request(`/api/views/${created.id}`, { method: 'DELETE' })
    expect(delRes.status).toBe(200)
    const getDeleted = await app.request(`/api/views/${created.id}`)
    expect(getDeleted.status).toBe(404)

    // 5. reset-seed 同步恢复默认示范视图
    const resetRes = await app.request('/api/reset-seed', { method: 'POST' })
    expect(resetRes.status).toBe(200)
    const resetBody = (await resetRes.json()) as AllTablesResponse
    expect(resetBody.views?.length).toBeGreaterThanOrEqual(8)
  })

  test('看板拖拽改状态写回数据源，并在删除数据源表时级联清理关联视图', async () => {
    const { app } = await createSeededTestEnv()

    // 1. 看板卡片拖拽修改项目状态
    const moveRes = await app.request('/api/views/wv_projects_kanban/kanban/cards/rec_prj_001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetValue: '已交付' }),
    })
    expect(moveRes.status).toBe(200)
    const { record } = (await moveRes.json()) as { record: SmartRecord }
    expect(record.status).toBe('已交付')

    // 2. 非看板视图且未指定 field 时拒绝写回
    const nonKanbanMove = await app.request(
      '/api/views/wv_projects_table/kanban/cards/rec_prj_001',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetValue: '待启动' }),
      },
    )
    expect(nonKanbanMove.status).toBe(400)

    // 3. 新建表 + 绑定看板视图，验证级联删除
    const tblRes = await app.request('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '临时看板表',
        columns: [
          { key: 'title', title: '任务', type: 'text', width: 160 },
          { key: 'stage', title: '阶段', type: 'select', width: 120 },
        ],
      }),
    })
    const { meta } = (await tblRes.json()) as { meta: { id: string } }
    const viewRes = await app.request('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '临时看板',
        type: 'kanban',
        tableId: meta.id,
        kanbanConfig: { groupByField: 'stage', displayFields: ['title'] },
      }),
    })
    const { view: tempView } = (await viewRes.json()) as { view: WorkspaceView }

    await app.request(`/api/tables/${meta.id}`, { method: 'DELETE' })
    const afterTableDel = await app.request(`/api/views/${tempView.id}`)
    expect(afterTableDel.status).toBe(404)
  })

  test('dashboardConfig 校验并持久化新图型、seriesField、stacked、limit 与 KPI icon', async () => {
    const { app } = await createSeededTestEnv()

    const validRes = await app.request('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '扩展仪表盘视图',
        type: 'dashboard',
        tableId: 'tbl_projects',
        dashboardConfig: {
          kpis: [
            {
              id: 'kpi_ext_1',
              title: '合同总额',
              field: 'contract_amount',
              agg: 'sum',
              numberFormat: 'currency',
              icon: 'dollar',
            },
          ],
          charts: [
            {
              id: 'chart_ext_1',
              title: '大区状态堆叠柱状图',
              chartType: 'horizontalBar',
              dimensionField: 'region',
              seriesField: 'status',
              stacked: true,
              measureField: 'contract_amount',
              agg: 'sum',
              limit: 6,
              span: 2,
            },
            {
              id: 'chart_ext_2',
              title: '雷达对比',
              chartType: 'radar',
              dimensionField: 'region',
              seriesField: 'status',
              measureField: '',
              agg: 'count',
            },
          ],
        },
      }),
    })
    expect(validRes.status).toBe(201)
    const { view: created } = (await validRes.json()) as { view: WorkspaceView }
    expect(created.dashboardConfig?.kpis[0]?.icon).toBe('dollar')
    expect(created.dashboardConfig?.charts[0]?.chartType).toBe('horizontalBar')
    expect(created.dashboardConfig?.charts[0]?.seriesField).toBe('status')
    expect(created.dashboardConfig?.charts[0]?.stacked).toBe(true)
    expect(created.dashboardConfig?.charts[0]?.limit).toBe(6)
    expect(created.dashboardConfig?.charts[1]?.chartType).toBe('radar')

    const fetchedRes = await app.request(`/api/views/${created.id}`)
    expect(fetchedRes.status).toBe(200)
    const { view: fetched } = (await fetchedRes.json()) as { view: WorkspaceView }
    expect(fetched.dashboardConfig).toEqual(created.dashboardConfig)

    const badChartTypeRes = await app.request(`/api/views/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dashboardConfig: {
          kpis: [],
          charts: [
            {
              id: 'c_bad',
              title: '非法图型',
              chartType: 'scatter',
              dimensionField: 'region',
              measureField: '',
              agg: 'count',
            },
          ],
        },
      }),
    })
    expect(badChartTypeRes.status).toBe(400)

    const badIconRes = await app.request(`/api/views/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dashboardConfig: {
          kpis: [{ id: 'k_bad', title: '非法图标', field: '', agg: 'count', icon: 'rocket' }],
          charts: [],
        },
      }),
    })
    expect(badIconRes.status).toBe(400)
  })
})

describe('旧库表级派生列与 _lookupOverrides 自动提升及 SmartApp 派生层持久化校验', () => {
  test('旧库已有 SmartApp 时自动提升表级派生列/summaries/_lookupOverrides 至 SmartApp 并从源表剔除', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-table-derived-lift-'))
    const dbPath = join(dir, 'v6-legacy.sqlite')
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
        CREATE TABLE smart_apps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          sort_order INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE workspace_views (
          id TEXT PRIMARY KEY,
          app_id TEXT REFERENCES smart_apps(id) ON DELETE CASCADE,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE smart_table_records (
          id TEXT NOT NULL,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          row_order INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          PRIMARY KEY (table_id, id)
        );
      `)
      legacyDb
        .query(
          'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'tbl_src',
          '主表',
          'normal',
          null,
          null,
          JSON.stringify({
            columns: [
              { key: 'owner', title: '负责人', type: 'text', width: 120 },
              { key: 'amount', title: '金额', type: 'number', width: 120 },
              {
                key: 'lookup_dept',
                title: '部门',
                type: 'lookup',
                width: 120,
                lookupConfig: {
                  groupId: 'grp_1',
                  targetTableId: 'tbl_ref',
                  matchRules: [{ sourceField: 'owner', targetField: 'name' }],
                  targetReturnField: 'dept',
                  mode: 'one',
                },
              },
              {
                key: 'formula_double',
                title: '双倍金额',
                type: 'formula',
                width: 120,
                formulaExpr: '[amount] * 2',
              },
            ],
            summaries: { amount: 'sum', formula_double: 'sum' },
          }),
          '[]',
          '2025-07-01T00:00:00.000Z',
        )
      legacyDb
        .query(
          'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'tbl_ref',
          '员工表',
          'normal',
          null,
          null,
          JSON.stringify({
            columns: [
              { key: 'name', title: '姓名', type: 'text', width: 120 },
              { key: 'dept', title: '部门', type: 'text', width: 120 },
            ],
            summaries: {},
          }),
          '[]',
          '2025-07-01T00:00:00.000Z',
        )
      legacyDb
        .query(
          'INSERT INTO smart_apps (id, name, description, table_id, sort_order, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('app_src', '主表应用', null, 'tbl_src', 0, '2025-07-01T00:00:00.000Z')
      legacyDb
        .query(
          'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
        )
        .run(
          'rec_1',
          'tbl_src',
          0,
          JSON.stringify({
            _id: 'rec_1',
            owner: '张三',
            amount: 100,
            lookup_dept: 'stale_cached',
            _lookupOverrides: { grp_1: 'emp_2' },
          }),
        )
      legacyDb.close()

      const upgraded = openDatabase(dbPath)
      try {
        const rawApp = createApp(upgraded)
        const { cookie } = await loginAsAdmin(rawApp)
        const app = createAuthedClient(rawApp, cookie)
        const appsRes = await app.request('/api/apps')
        expect(appsRes.status).toBe(200)
        const { apps } = (await appsRes.json()) as AllAppsResponse
        const liftedApp = apps.find((a) => a.id === 'app_src')!
        expect(liftedApp.derivedColumns?.map((c) => c.key)).toEqual([
          'lookup_dept',
          'formula_double',
        ])
        expect(liftedApp.lookupOverrides).toEqual({ rec_1: { grp_1: 'emp_2' } })

        const tblRes = await app.request('/api/tables/tbl_src')
        expect(tblRes.status).toBe(200)
        const bundle = (await tblRes.json()) as TableBundle
        expect(bundle.meta.columns.map((c) => c.key)).toEqual(['owner', 'amount'])
        expect(bundle.meta.summaries).toEqual({ amount: 'sum' })
        expect(bundle.records[0]?._lookupOverrides).toBeUndefined()
        expect(bundle.records[0]?.lookup_dept).toBeUndefined()
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('旧库表含派生列但无关联 SmartApp 时按表自动补建 SmartApp 并完成迁移', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-table-auto-app-'))
    const dbPath = join(dir, 'no-app-legacy.sqlite')
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
        CREATE TABLE smart_apps (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          sort_order INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE workspace_views (
          id TEXT PRIMARY KEY,
          app_id TEXT REFERENCES smart_apps(id) ON DELETE CASCADE,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          config_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE smart_table_records (
          id TEXT NOT NULL,
          table_id TEXT NOT NULL REFERENCES smart_tables(id) ON DELETE CASCADE,
          row_order INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          PRIMARY KEY (table_id, id)
        );
      `)
      legacyDb
        .query(
          'INSERT INTO smart_tables (id, name, kind, primary_key_field, source_sql_table, schema_json, views_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'tbl_orphan',
          '孤儿派生表',
          'normal',
          null,
          null,
          JSON.stringify({
            columns: [
              { key: 'qty', title: '数量', type: 'number', width: 100 },
              {
                key: 'formula_total',
                title: '总价',
                type: 'formula',
                width: 120,
                formulaExpr: '[qty] * 10',
              },
            ],
            summaries: { formula_total: 'sum' },
          }),
          '[]',
          '2025-07-01T00:00:00.000Z',
        )
      legacyDb
        .query(
          'INSERT INTO smart_table_records (id, table_id, row_order, data_json) VALUES (?, ?, ?, ?)',
        )
        .run(
          'rec_o1',
          'tbl_orphan',
          0,
          JSON.stringify({ _id: 'rec_o1', qty: 3, _lookupOverrides: { grp_x: 'target_1' } }),
        )
      legacyDb.close()

      const upgraded = openDatabase(dbPath)
      try {
        const rawApp = createApp(upgraded)
        const { cookie } = await loginAsAdmin(rawApp)
        const app = createAuthedClient(rawApp, cookie)
        const appsRes = await app.request('/api/apps')
        const { apps } = (await appsRes.json()) as AllAppsResponse
        const autoApp = apps.find((a) => a.tableId === 'tbl_orphan')
        expect(autoApp).toBeDefined()
        expect(autoApp!.name).toBe('孤儿派生表')
        expect(autoApp!.derivedColumns?.map((c) => c.key)).toEqual(['formula_total'])
        expect(autoApp!.lookupOverrides).toEqual({ rec_o1: { grp_x: 'target_1' } })

        const tblRes = await app.request('/api/tables/tbl_orphan')
        const bundle = (await tblRes.json()) as TableBundle
        expect(bundle.meta.columns.map((c) => c.key)).toEqual(['qty'])
        expect(bundle.meta.summaries).toEqual({})
        expect(bundle.records[0]?._lookupOverrides).toBeUndefined()
      } finally {
        upgraded.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('SmartApp 读写校验 derivedColumns/lookupOverrides，并禁止看板写回派生列', async () => {
    const { app } = await createSeededTestEnv()

    // 1. 新建基于 tbl_projects 的 SmartApp，允许携带合法派生列与 lookupOverrides
    const createOk = await app.request('/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '自定义派生应用',
        tableId: 'tbl_projects',
        derivedColumns: [
          {
            key: 'lookup_owner_email',
            title: '负责人邮箱',
            type: 'lookup',
            width: 180,
            lookupConfig: {
              groupId: 'grp_owner_mail',
              targetTableId: 'tbl_employees',
              matchRules: [{ sourceField: 'owner_name', targetField: 'name' }],
              targetReturnField: 'email',
              mode: 'one',
            },
          },
          {
            key: 'formula_half',
            title: '半数金额',
            type: 'formula',
            width: 120,
            formulaExpr: '[contract_amount] / 2',
          },
        ],
        lookupOverrides: { rec_prj_001: { grp_owner_mail: 'EMP-009' } },
      }),
    })
    expect(createOk.status).toBe(201)
    const { app: createdApp } = (await createOk.json()) as CreateAppResponse
    expect(createdApp.derivedColumns?.map((c) => c.key)).toEqual([
      'lookup_owner_email',
      'formula_half',
    ])
    expect(createdApp.lookupOverrides).toEqual({ rec_prj_001: { grp_owner_mail: 'EMP-009' } })

    // 2. 拒绝非派生类型列（如 text）
    const nonDerivedRes = await app.request(`/api/apps/${createdApp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        derivedColumns: [{ key: 'extra_text', title: '普通列', type: 'text', width: 120 }],
      }),
    })
    expect(nonDerivedRes.status).toBe(400)

    // 3. 拒绝 key 与源表原始列重复或自身重复
    const dupSourceKeyRes = await app.request(`/api/apps/${createdApp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        derivedColumns: [
          { key: 'status', title: '冲突列', type: 'formula', width: 120, formulaExpr: '1' },
        ],
      }),
    })
    expect(dupSourceKeyRes.status).toBe(400)

    const dupSelfKeyRes = await app.request(`/api/apps/${createdApp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        derivedColumns: [
          { key: 'f1', title: 'F1', type: 'formula', width: 120, formulaExpr: '1' },
          { key: 'f1', title: 'F1重复', type: 'formula', width: 120, formulaExpr: '2' },
        ],
      }),
    })
    expect(dupSelfKeyRes.status).toBe(400)

    // 4. VLOOKUP 禁止引用其它 SmartApp 的派生列（targetReturnField / targetField 必须为目标源表原始字段）
    const crossAppDerivedTargetRes = await app.request('/api/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '禁止跨App引用',
        tableId: 'tbl_tickets',
        derivedColumns: [
          {
            key: 'bad_lookup',
            title: '跨App派生列',
            type: 'lookup',
            width: 140,
            lookupConfig: {
              groupId: 'grp_bad',
              targetTableId: 'tbl_projects',
              matchRules: [{ sourceField: 'project_code', targetField: 'project_code' }],
              targetReturnField: 'lookup_emp_dept',
              mode: 'one',
            },
          },
        ],
      }),
    })
    expect(crossAppDerivedTargetRes.status).toBe(400)

    // 5. 更新 lookupOverrides 生效并持久化
    const updateOverridesRes = await app.request(`/api/apps/${createdApp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lookupOverrides: { rec_prj_001: { grp_owner_mail: 'EMP-001' } },
      }),
    })
    expect(updateOverridesRes.status).toBe(200)
    const { app: updatedApp } = (await updateOverridesRes.json()) as { app: SmartApp }
    expect(updatedApp.lookupOverrides).toEqual({ rec_prj_001: { grp_owner_mail: 'EMP-001' } })

    // 6. 看板拖拽写回禁止写回 SmartApp 派生列
    const moveDerivedKanban = await app.request(
      '/api/views/wv_projects_kanban/kanban/cards/rec_prj_001',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'lookup_emp_dept', targetValue: '研发部' }),
      },
    )
    expect(moveDerivedKanban.status).toBe(400)
  })

  test('派生列、透视指标与仪表盘 KPI 的 decimalPlaces（0~6）校验（400）与持久化一致', async () => {
    const { app } = await createSeededTestEnv()

    // 1) SmartApp 派生列拒绝非法 decimalPlaces，持久化合法 0~6
    for (const bad of [-1, 7, 1.5, '2']) {
      const badAppRes = await app.request('/api/apps/app_projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          derivedColumns: [
            {
              key: 'f_test',
              title: '测算公式',
              type: 'formula',
              width: 120,
              formulaExpr: '[contract_amount] / 2',
              decimalPlaces: bad,
            },
          ],
        }),
      })
      expect(badAppRes.status).toBe(400)
    }

    const okAppRes = await app.request('/api/apps/app_projects', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        derivedColumns: [
          {
            key: 'f_test',
            title: '测算公式',
            type: 'formula',
            width: 120,
            formulaExpr: '[contract_amount] / 2',
            numberFormat: 'currency',
            decimalPlaces: 4,
          },
        ],
      }),
    })
    expect(okAppRes.status).toBe(200)
    const { app: savedApp } = (await okAppRes.json()) as { app: SmartApp }
    expect(savedApp.derivedColumns?.[0]?.decimalPlaces).toBe(4)

    // 2) 透视视图 pivotConfig.measures[*].decimalPlaces 校验与持久化
    const badPivotRes = await app.request('/api/views/wv_projects_pivot', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pivotConfig: {
          rowDimensions: ['region'],
          columnDimensions: [],
          measures: [
            {
              key: 'm_contract',
              title: '合同总额',
              field: 'contract_amount',
              agg: 'sum',
              decimalPlaces: 8,
            },
          ],
        },
      }),
    })
    expect(badPivotRes.status).toBe(400)

    const okPivotRes = await app.request('/api/views/wv_projects_pivot', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pivotConfig: {
          rowDimensions: ['region'],
          columnDimensions: [],
          measures: [
            {
              key: 'm_contract',
              title: '合同总额',
              field: 'contract_amount',
              agg: 'sum',
              decimalPlaces: 5,
            },
          ],
        },
      }),
    })
    expect(okPivotRes.status).toBe(200)
    const { view: savedPivot } = (await okPivotRes.json()) as { view: WorkspaceView }
    expect(savedPivot.pivotConfig?.measures[0]?.decimalPlaces).toBe(5)

    // 3) 仪表盘 dashboardConfig.kpis[*].decimalPlaces 校验与持久化
    const badKpiRes = await app.request('/api/views/wv_exec_dashboard', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dashboardConfig: {
          kpis: [
            {
              id: 'kpi_test',
              title: '合同均值',
              field: 'contract_amount',
              agg: 'avg',
              decimalPlaces: 2.5,
            },
          ],
          charts: [],
        },
      }),
    })
    expect(badKpiRes.status).toBe(400)

    const okKpiRes = await app.request('/api/views/wv_exec_dashboard', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dashboardConfig: {
          kpis: [
            {
              id: 'kpi_test',
              title: '合同均值',
              field: 'contract_amount',
              agg: 'avg',
              decimalPlaces: 3,
            },
          ],
          charts: [],
        },
      }),
    })
    expect(okKpiRes.status).toBe(200)
    const { view: savedDash } = (await okKpiRes.json()) as { view: WorkspaceView }
    expect(savedDash.dashboardConfig?.kpis[0]?.decimalPlaces).toBe(3)
  })
})
