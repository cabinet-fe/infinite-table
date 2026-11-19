// 工作台权限能力解析、三区域右键菜单权限裁剪、选区样式更新、列顺序/显隐与 CSV/XLSX 导出单测

import { readXlsx } from 'hucre/xlsx'
import { describe, expect, test } from 'vitest'
import { buildGridMenuItems, type GridMenuContext } from '../../src/components/GridPopupMenu'
import { computeUserCapabilities } from '../../src/domain/permissions'
import {
  applyCellStyleToSelection,
  buildDefaultViewPayload,
  buildRecordsXlsxBytes,
  canAccessNavSection,
  canConfigureAppItem,
  canConfigureViewItem,
  canEditEntryTableItem,
  formatRecordsAsCsv,
  getAvailableSummaryTypes,
  getVisibleNavSections,
  normalizeColumnOrder,
  reorderStringList,
  resolveWorkspaceActionCapabilities,
  toggleHiddenColumn,
} from '../../src/domain/workspace-helpers'
import type { TableBundle } from '../../src/shared/api-types'
import type {
  AuthUser,
  SmartApp,
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
  WorkspaceView,
} from '../../src/shared/schema'

const ADMIN: AuthUser = { id: 'usr_admin', username: 'admin', displayName: '管理员', role: 'admin' }
const MANAGER: AuthUser = { id: 'usr_mgr', username: 'lisi', displayName: '李四', role: 'manager' }
const MEMBER: AuthUser = {
  id: 'usr_member',
  username: 'qianqi',
  displayName: '钱七',
  role: 'member',
}

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 100, isUniqueKey: true },
  {
    key: 'status',
    title: '状态',
    type: 'select',
    width: 110,
    options: [
      { label: '进行中', color: '#ebf1ff', textColor: '#1d4ed8' },
      { label: '已交付', color: '#dcfce7', textColor: '#166534' },
    ],
  },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
  {
    key: 'dept',
    title: '部门',
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
]

const RECORDS: SmartRecord[] = [
  { _id: 'r1', code: 'PRJ-01', status: '进行中', amount: 12000, dept: '研发部' },
  { _id: 'r2', code: 'PRJ-02', status: '已交付', amount: 8500.5, dept: '市场,一组' },
]

describe('角色导航入口与资源操作能力解析', () => {
  test('getVisibleNavSections 与 canAccessNavSection 严格区分 admin/manager 与 member', () => {
    expect(getVisibleNavSections(null)).toEqual([])
    expect(getVisibleNavSections(ADMIN)).toEqual([
      'apps',
      'entries',
      'datasources',
      'shares',
      'permissions',
    ])
    expect(getVisibleNavSections(MANAGER)).toEqual([
      'apps',
      'entries',
      'datasources',
      'shares',
      'permissions',
    ])
    expect(getVisibleNavSections(MEMBER)).toEqual(['apps', 'entries'])

    expect(canAccessNavSection('datasources', MEMBER)).toBe(false)
    expect(canAccessNavSection('permissions', MEMBER)).toBe(false)
    expect(canAccessNavSection('shares', MEMBER)).toBe(false)
    expect(canAccessNavSection('entries', MEMBER)).toBe(true)
    expect(canAccessNavSection('datasources', MANAGER)).toBe(true)
  })

  test('resolveWorkspaceActionCapabilities 按角色与资源授权准确区分可配置、仅可写行与只读', () => {
    const table: SmartTableMeta = {
      id: 'tbl_1',
      name: '项目表',
      kind: 'normal',
      columns: COLUMNS,
      views: [],
      summaries: {},
      createdBy: ADMIN.id,
      memberAccess: 'readonly',
    }
    const appRo: SmartApp = {
      id: 'app_ro',
      name: '只读应用',
      tableId: 'tbl_1',
      sortOrder: 0,
      createdBy: MANAGER.id,
      visibilityScope: 'all',
      memberAccess: 'readonly',
    }
    const viewEd: WorkspaceView = {
      id: 'v_ed',
      appId: 'app_ro',
      tableId: 'tbl_1',
      name: '成员可编辑视图',
      type: 'table',
      sortOrder: 0,
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: [],
      sortRules: [],
      visibilityScope: 'all',
      memberAccess: 'editable',
    }
    const viewRo: WorkspaceView = {
      ...viewEd,
      id: 'v_ro',
      memberAccess: undefined,
    }

    // 成员在 readonly 视图：只读、不可配置、不可进数据源、不可建分享
    expect(
      resolveWorkspaceActionCapabilities({
        user: MEMBER,
        userCapabilities: computeUserCapabilities(MEMBER),
        targetKind: 'app',
        app: appRo,
        view: viewRo,
      }),
    ).toEqual({
      canView: true,
      canEditRecords: false,
      canConfigure: false,
      canManagePermissions: false,
      canCreateShare: false,
      canManageDataSource: false,
      canAccessDataSources: false,
    })

    // 成员在 editable 视图：仅可写行，仍不可配置、不可进数据源、不可建分享
    expect(
      resolveWorkspaceActionCapabilities({
        user: MEMBER,
        userCapabilities: computeUserCapabilities(MEMBER),
        targetKind: 'app',
        app: appRo,
        view: viewEd,
      }),
    ).toEqual({
      canView: true,
      canEditRecords: true,
      canConfigure: false,
      canManagePermissions: false,
      canCreateShare: false,
      canManageDataSource: false,
      canAccessDataSources: false,
    })

    // 负责人对本人创建的应用：全部可用
    expect(
      resolveWorkspaceActionCapabilities({
        user: MANAGER,
        userCapabilities: computeUserCapabilities(MANAGER),
        targetKind: 'app',
        app: appRo,
        view: viewRo,
      }),
    ).toEqual({
      canView: true,
      canEditRecords: true,
      canConfigure: true,
      canManagePermissions: true,
      canCreateShare: true,
      canManageDataSource: true,
      canAccessDataSources: true,
    })

    // 成员即使传入 datasource 目标也无任何操作权限
    expect(
      resolveWorkspaceActionCapabilities({
        user: MEMBER,
        targetKind: 'datasource',
        table,
        allApps: [appRo],
        allViews: [viewRo],
      }).canView,
    ).toBe(false)

    expect(canConfigureAppItem(MANAGER, appRo)).toBe(true)
    expect(canConfigureAppItem(MEMBER, appRo)).toBe(false)
    expect(canConfigureViewItem(MANAGER, viewRo, appRo)).toBe(true)
    expect(canEditEntryTableItem(MEMBER, table, [appRo], [viewRo])).toBe(false)
    expect(canEditEntryTableItem(MEMBER, table, [appRo], [viewEd])).toBe(true)
  })
})

describe('三区域右键菜单真实权限裁剪', () => {
  function baseCtx(overrides: Partial<GridMenuContext>): GridMenuContext {
    return {
      canEditRecords: true,
      canConfigure: true,
      region: 'body',
      x: 100,
      y: 100,
      colIndex: 1,
      column: COLUMNS[1]!,
      record: RECORDS[0]!,
      selection: { ranges: [], recordIds: [], columnKeys: [], focus: null },
      sortRules: [{ field: 'status', direction: 'asc' }],
      frozenColCount: 0,
      visibleColumnCount: COLUMNS.length,
      canRenameColumn: true,
      canDeleteColumn: true,
      hasSelectionCellStyles: true,
      isDatasourceMode: false,
      ...overrides,
    }
  }

  test('只读权限（!canEditRecords && !canConfigure）严格移除写操作与配置类菜单项', () => {
    const colItems = buildGridMenuItems(
      baseCtx({ canEditRecords: false, canConfigure: false, region: 'col-header' }),
    )
    expect(colItems.map((i) => i.id)).toEqual(['sort_asc', 'sort_desc', 'sort_clear'])

    const rowItems = buildGridMenuItems(
      baseCtx({ canEditRecords: false, canConfigure: false, region: 'row-header' }),
    )
    expect(rowItems.map((i) => i.id)).toEqual(['copy_row'])

    const bodyItems = buildGridMenuItems(
      baseCtx({ canEditRecords: false, canConfigure: false, region: 'body' }),
    )
    expect(bodyItems.map((i) => i.id)).toEqual(['copy_cell', 'filter_by_cell'])
  })

  test('成员可编辑授权（canEditRecords && !canConfigure）仅允许编辑/增删行，隐藏配置与消歧写操作', () => {
    const bodyItems = buildGridMenuItems(
      baseCtx({ canEditRecords: true, canConfigure: false, region: 'body' }),
    )
    expect(bodyItems.map((i) => i.id)).toEqual([
      'copy_cell',
      'filter_by_cell',
      'edit_cell',
      'add_row',
      'delete_row',
    ])

    // 无配置权时，lookup 列不可在右键菜单触发消歧（lookupOverrides 需配置权）
    const lookupBodyItems = buildGridMenuItems(
      baseCtx({ canEditRecords: true, canConfigure: false, region: 'body', column: COLUMNS[3]! }),
    )
    expect(lookupBodyItems.map((i) => i.id)).not.toContain('edit_cell')

    const colItems = buildGridMenuItems(
      baseCtx({ canEditRecords: true, canConfigure: false, region: 'col-header' }),
    )
    expect(colItems.map((i) => i.id)).toEqual(['sort_asc', 'sort_desc', 'sort_clear'])
  })

  test('具备配置与写行权限时在三区域均露出对应配置与编辑动作', () => {
    const colItems = buildGridMenuItems(
      baseCtx({ canEditRecords: true, canConfigure: true, region: 'col-header' }),
    )
    expect(colItems.map((i) => i.id)).toContain('freeze_to_col')
    expect(colItems.map((i) => i.id)).toContain('open_col_style')
    expect(colItems.map((i) => i.id)).toContain('delete_col')

    const lookupColItems = buildGridMenuItems(
      baseCtx({
        canEditRecords: true,
        canConfigure: true,
        region: 'col-header',
        column: COLUMNS[3]!,
      }),
    )
    expect(lookupColItems.map((i) => i.id)).toContain('edit_lookup_col')

    const bodyItems = buildGridMenuItems(
      baseCtx({ canEditRecords: true, canConfigure: true, region: 'body' }),
    )
    expect(bodyItems.map((i) => i.id)).toContain('edit_cell')
    expect(bodyItems.map((i) => i.id)).toContain('open_selection_style')
    expect(bodyItems.map((i) => i.id)).toContain('clear_selection_style')
    expect(bodyItems.map((i) => i.id)).toContain('delete_row')
  })
})

describe('选区样式、列显隐排序、汇总选项与导入导出', () => {
  test('applyCellStyleToSelection 支持批量设置与清除选区自定义配色', () => {
    const selection = {
      ranges: [
        {
          start: { col: 1, row: 0 },
          end: { col: 2, row: 1 },
          recordIds: ['r1', 'r2'],
          columnKeys: ['status', 'amount'],
        },
      ],
      recordIds: ['r1', 'r2'],
      columnKeys: ['status', 'amount'],
      focus: { col: 1, row: 0 },
    }
    const styled = applyCellStyleToSelection(undefined, selection, {
      bgColor: '#fef9c3',
      textColor: '#854d0e',
    })
    expect(styled?.r1?.status).toEqual({ bgColor: '#fef9c3', textColor: '#854d0e' })
    expect(styled?.r2?.amount).toEqual({ bgColor: '#fef9c3', textColor: '#854d0e' })

    const cleared = applyCellStyleToSelection(styled, selection, null)
    expect(cleared).toBeUndefined()
  })

  test('normalizeColumnOrder / reorderStringList / toggleHiddenColumn 保持至少 1 列可见', () => {
    expect(normalizeColumnOrder(COLUMNS, ['amount', 'code'])).toEqual([
      'amount',
      'code',
      'status',
      'dept',
    ])
    expect(reorderStringList(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(toggleHiddenColumn(COLUMNS, ['status', 'amount', 'dept'], 'code')).toBeNull()
    expect(toggleHiddenColumn(COLUMNS, ['status'], 'status')).toEqual([])
  })

  test('getAvailableSummaryTypes 区分数值列与非数值列', () => {
    expect(getAvailableSummaryTypes(COLUMNS[2]!)).toContain('sum')
    expect(getAvailableSummaryTypes(COLUMNS[2]!)).toContain('avg')
    expect(getAvailableSummaryTypes(COLUMNS[0]!)).toEqual(['none', 'count', 'filled_rate'])
  })

  test('CSV 与 XLSX 导出可生成合法内容与可解析工作簿', async () => {
    const csv = formatRecordsAsCsv(COLUMNS, RECORDS)
    expect(csv.startsWith('\uFEFF编号,状态,合同金额,部门')).toBe(true)
    expect(csv).toContain('"市场,一组"')

    const bytes = await buildRecordsXlsxBytes('测试导出', COLUMNS, RECORDS)
    const wb = await readXlsx(bytes)
    expect(wb.sheets[0]?.name).toBe('测试导出')
    expect(wb.sheets[0]?.rows[0]).toEqual(['编号', '状态', '合同金额', '部门'])
    expect(wb.sheets[0]?.rows[1]).toEqual(['PRJ-01', '进行中', 12000, '研发部'])
  })

  test('buildDefaultViewPayload 为四类视图生成合理初始配置', () => {
    const bundle: TableBundle = {
      meta: {
        id: 'tbl_demo',
        name: '示例表',
        kind: 'normal',
        columns: COLUMNS,
        views: [],
        summaries: {},
      },
      records: RECORDS,
    }
    expect(buildDefaultViewPayload('表格', 'table', bundle).rowHeight).toBe('standard')
    expect(buildDefaultViewPayload('看板', 'kanban', bundle).kanbanConfig?.groupByField).toBe(
      'status',
    )
    expect(buildDefaultViewPayload('透视', 'pivot', bundle).pivotConfig?.rowDimensions).toEqual([
      'status',
    ])
    expect(
      buildDefaultViewPayload('仪表盘', 'dashboard', bundle).dashboardConfig?.kpis.length,
    ).toBeGreaterThan(0)
  })
})
