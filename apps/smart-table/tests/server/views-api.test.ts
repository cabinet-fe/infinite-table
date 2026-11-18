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
} from '../../src/shared/api-types'
import type { SmartRecord, WorkspaceView } from '../../src/shared/schema'

function createSeededTestEnv() {
  const db = openDatabase(':memory:')
  seedSmartTableDemo(db)
  const app = createApp(db)
  return { db, app }
}

describe('旧库 smart_tables.views_json 到 workspace_views 的平滑迁移', () => {
  test('无 workspace_views 表的旧库启动后自动迁移视图，并自动消解跨表重名视图 ID', () => {
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
        const app = createApp(upgraded)
        return (async () => {
          const res = await app.request('/api/views')
          expect(res.status).toBe(200)
          const body = (await res.json()) as AllViewsResponse
          expect(body.views).toHaveLength(3)
          expect(body.views.map((v) => [v.id, v.tableId, v.name, v.type, v.sortOrder])).toEqual([
            ['v1', 'tbl_a', '表A全部', 'table', 0],
            ['v_pivot_a', 'tbl_a', '表A透视', 'pivot', 1],
            ['v1_tbl_b', 'tbl_b', '表B全部', 'table', 2],
          ])
        })()
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
        const app = createApp(upgraded)
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
    const { db, app } = createSeededTestEnv()
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
    const { app } = createSeededTestEnv()

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
    const { app } = createSeededTestEnv()

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
    const { app } = createSeededTestEnv()

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
