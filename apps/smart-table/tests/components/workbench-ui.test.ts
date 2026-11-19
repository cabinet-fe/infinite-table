// @vitest-environment happy-dom

// 关键前端工作台组件交互与真实权限隔离测试：
// 验证 Sidebar 分板块目录（apps / entries / datasources）按角色过滤、AppViewTabs 权限控制、
// Toolbar 能力裁剪、ViewConfigDrawer 分栏调序/样式/条件格式、SummaryMenuPopover 与 GridPopupMenu。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AddColumnModal } from '../../src/components/AddColumnModal'
import { AppViewTabs } from '../../src/components/AppViewTabs'
import { ColumnManagerModal } from '../../src/components/ColumnManagerModal'
import { DrawerPivotPanel } from '../../src/components/DrawerPivotPanel'
import { GridPopupMenu, type GridMenuActionId } from '../../src/components/GridPopupMenu'
import { Sidebar } from '../../src/components/Sidebar'
import { SummaryMenuPopover } from '../../src/components/SummaryMenuPopover'
import { Toolbar } from '../../src/components/Toolbar'
import { ViewConfigDrawer } from '../../src/components/ViewConfigDrawer'
import { computeUserCapabilities } from '../../src/domain/permissions'
import type { WorkspaceActionCapabilities } from '../../src/domain/workspace-helpers'
import type { TableBundle } from '../../src/shared/api-types'
import type {
  AuthUser,
  CellStyleConfig,
  SmartApp,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
  SummaryType,
  WorkspaceView,
} from '../../src/shared/schema'

// 告知 React 19 当前为 act 测试环境
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
const noopAsync = async () => {}

const ADMIN: AuthUser = { id: 'usr_admin', username: 'admin', displayName: '管理员', role: 'admin' }
const MANAGER: AuthUser = { id: 'usr_mgr', username: 'lisi', displayName: '李四', role: 'manager' }
const MEMBER: AuthUser = {
  id: 'usr_member',
  username: 'qianqi',
  displayName: '钱七',
  role: 'member',
}

const FULL_CAPS: WorkspaceActionCapabilities = {
  canView: true,
  canEditRecords: true,
  canConfigure: true,
  canManagePermissions: true,
  canCreateShare: true,
  canManageDataSource: true,
  canAccessDataSources: true,
}

const MEMBER_RO_CAPS: WorkspaceActionCapabilities = {
  canView: true,
  canEditRecords: false,
  canConfigure: false,
  canManagePermissions: false,
  canCreateShare: false,
  canManageDataSource: false,
  canAccessDataSources: false,
}

const MEMBER_ED_CAPS: WorkspaceActionCapabilities = {
  ...MEMBER_RO_CAPS,
  canEditRecords: true,
}

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '项目编号', type: 'text', width: 110, isUniqueKey: true },
  {
    key: 'status',
    title: '状态',
    type: 'select',
    width: 110,
    options: [{ label: '进行中', color: '#ebf1ff', textColor: '#1d4ed8' }],
  },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
]

const RECORDS: SmartRecord[] = [{ _id: 'r1', code: 'PRJ-01', status: '进行中', amount: 10000 }]

const TABLES: TableBundle[] = [
  {
    meta: {
      id: 'tbl_1',
      name: '项目管理表',
      kind: 'normal',
      columns: COLUMNS,
      views: [],
      summaries: { amount: 'sum' },
    },
    records: RECORDS,
  },
  {
    meta: {
      id: 'tbl_sql',
      name: '员工主数据',
      kind: 'advanced',
      primaryKeyField: 'emp_id',
      sourceSqlTable: 'biz_employees',
      system: true,
      columns: [{ key: 'emp_id', title: '工号', type: 'text', width: 100, isUniqueKey: true }],
      views: [],
      summaries: {},
    },
    records: [],
  },
]

const APPS: SmartApp[] = [
  {
    id: 'app_1',
    name: '项目运营台账表',
    tableId: 'tbl_1',
    sortOrder: 0,
  },
  {
    id: 'app_2',
    name: '员工档案应用',
    tableId: 'tbl_sql',
    sortOrder: 1,
  },
]

const VIEWS: WorkspaceView[] = [
  {
    id: 'v_table',
    appId: 'app_1',
    tableId: 'tbl_1',
    name: '项目台账',
    type: 'table',
    sortOrder: 0,
    filterGroup: { conjunction: 'and', conditions: [] },
    quickFilterFields: ['status'],
    sortRules: [],
    frozenColCount: 1,
    rowHeight: 'standard',
    summaries: { amount: 'sum' },
  },
  {
    id: 'v_pivot',
    appId: 'app_1',
    tableId: 'tbl_1',
    name: '项目透视',
    type: 'pivot',
    sortOrder: 1,
    filterGroup: { conjunction: 'and', conditions: [] },
    quickFilterFields: [],
    sortRules: [],
    pivotConfig: {
      rowDimensions: ['status'],
      columnDimensions: [],
      measures: [{ key: 'amount', title: '合同金额', field: 'amount', agg: 'sum' }],
      showGrandTotal: true,
      collapsible: true,
    },
  },
]

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

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
})

describe('Sidebar 二级目录与 AppViewTabs 权限隔离', () => {
  test('Sidebar 按 section 分栏展示智能表格、数据录入表与数据源中心，并按用户角色过滤操作与重置入口', () => {
    const onEnterTableEntry = vi.fn<(tableId: string) => void>()
    const onOpenTableEntryNewTab = vi.fn<(tableId: string) => void>()
    const onCopyTableEntryLink = vi.fn<(tableId: string) => void>()

    // 1) apps 板块：管理员可见新建按钮与数据源来源提示
    const handle = mountComponent(
      createElement(Sidebar, {
        section: 'apps',
        currentUser: ADMIN,
        userCapabilities: computeUserCapabilities(ADMIN),
        apps: APPS,
        views: VIEWS,
        tables: TABLES,
        activeAppId: 'app_1',
        onSelectApp: noop,
        onCreateApp: noopAsync,
        onRenameApp: noopAsync,
        onDeleteApp: noopAsync,
        onReorderApps: noopAsync,
        onSelectTable: noop,
        onEnterTableEntry,
        onOpenTableEntryNewTab,
        onCopyTableEntryLink,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )

    expect(handle.container.querySelector('[aria-label="智能表格"]')).not.toBeNull()
    expect(handle.container.textContent).toContain('项目运营台账表')
    expect(handle.container.textContent).toContain('2 视图')
    expect(handle.container.textContent).toContain('数据源：项目管理表')
    expect(handle.container.querySelector('[title="基于数据源新建智能表格"]')).not.toBeNull()

    // 2) entries 板块：普通表支持直达录入/新标签/复制链接，不包含 SQL 物理表
    handle.rerender(
      createElement(Sidebar, {
        section: 'entries',
        currentUser: ADMIN,
        userCapabilities: computeUserCapabilities(ADMIN),
        apps: APPS,
        views: VIEWS,
        tables: TABLES,
        activeEntryTableId: 'tbl_1',
        onSelectApp: noop,
        onCreateApp: noopAsync,
        onRenameApp: noopAsync,
        onDeleteApp: noopAsync,
        onReorderApps: noopAsync,
        onSelectTable: noop,
        onEnterTableEntry,
        onOpenTableEntryNewTab,
        onCopyTableEntryLink,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )

    const entrySection = handle.container.querySelector('[aria-label="数据录入表"]')!
    expect(entrySection).not.toBeNull()
    expect(entrySection.textContent).toContain('项目管理表')
    expect(entrySection.textContent).not.toContain('员工主数据')

    const entryBtn = Array.from(entrySection.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('项目管理表'),
    )!
    act(() => {
      entryBtn.click()
    })
    expect(onEnterTableEntry).toHaveBeenCalledWith('tbl_1')

    const newTabBtn = entrySection.querySelector(
      'button[aria-label="新标签打开 项目管理表 录入页"]',
    ) as HTMLButtonElement
    act(() => {
      newTabBtn.click()
    })
    expect(onOpenTableEntryNewTab).toHaveBeenCalledWith('tbl_1')

    const copyBtn = entrySection.querySelector(
      'button[aria-label="复制 项目管理表 录入链接"]',
    ) as HTMLButtonElement
    act(() => {
      copyBtn.click()
    })
    expect(onCopyTableEntryLink).toHaveBeenCalledWith('tbl_1')

    // 3) datasources 板块：管理员可见重置演示数据，负责人不可见重置按钮
    handle.rerender(
      createElement(Sidebar, {
        section: 'datasources',
        currentUser: ADMIN,
        userCapabilities: computeUserCapabilities(ADMIN),
        apps: APPS,
        views: VIEWS,
        tables: TABLES,
        activeDatasourceTableId: 'tbl_1',
        onSelectApp: noop,
        onCreateApp: noopAsync,
        onRenameApp: noopAsync,
        onDeleteApp: noopAsync,
        onReorderApps: noopAsync,
        onSelectTable: noop,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )
    expect(handle.container.querySelector('[aria-label="数据源中心"]')).not.toBeNull()
    expect(handle.container.textContent).toContain('员工主数据')
    expect(handle.container.textContent).toContain('重置演示数据')

    handle.rerender(
      createElement(Sidebar, {
        section: 'datasources',
        currentUser: MANAGER,
        userCapabilities: computeUserCapabilities(MANAGER),
        apps: APPS,
        views: VIEWS,
        tables: TABLES,
        activeDatasourceTableId: 'tbl_1',
        onSelectApp: noop,
        onCreateApp: noopAsync,
        onRenameApp: noopAsync,
        onDeleteApp: noopAsync,
        onReorderApps: noopAsync,
        onSelectTable: noop,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )
    expect(handle.container.textContent).not.toContain('重置演示数据')
  })

  test('普通成员在 apps / datasources 板块隐藏数据源关联提示、管理动作与数据源列表', () => {
    const onSelectApp = vi.fn<(appId: string) => void>()
    const handle = mountComponent(
      createElement(Sidebar, {
        section: 'apps',
        currentUser: MEMBER,
        userCapabilities: computeUserCapabilities(MEMBER),
        apps: APPS,
        views: VIEWS,
        tables: TABLES,
        activeAppId: 'app_1',
        onSelectApp,
        onCreateApp: noopAsync,
        onRenameApp: noopAsync,
        onDeleteApp: noopAsync,
        onReorderApps: noopAsync,
        onSelectTable: noop,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )

    expect(handle.container.querySelector('[aria-label="智能表格"]')).not.toBeNull()
    expect(handle.container.textContent).not.toContain('数据源：')
    expect(handle.container.querySelector('[title="基于数据源新建智能表格"]')).toBeNull()
    expect(handle.container.querySelector('button[aria-label^="重命名"]')).toBeNull()

    const secondAppBtn = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('员工档案应用'),
    )!
    act(() => {
      secondAppBtn.click()
    })
    expect(onSelectApp).toHaveBeenCalledWith('app_2')

    handle.rerender(
      createElement(Sidebar, {
        section: 'datasources',
        currentUser: MEMBER,
        userCapabilities: computeUserCapabilities(MEMBER),
        apps: APPS,
        views: VIEWS,
        tables: TABLES,
        onSelectApp,
        onCreateApp: noopAsync,
        onRenameApp: noopAsync,
        onDeleteApp: noopAsync,
        onReorderApps: noopAsync,
        onSelectTable: noop,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )
    expect(handle.container.querySelector('[aria-label="数据源中心"]')).toBeNull()
    expect(handle.container.textContent).toContain('普通成员无权访问数据源中心')
  })

  test('AppViewTabs 按权限裁剪新建/重命名/调序/数据源跳转入口', () => {
    const onSelectView = vi.fn<(viewId: string) => void>()
    const handle = mountComponent(
      createElement(AppViewTabs, {
        canConfigureApp: true,
        canManageDataSource: true,
        app: APPS[0]!,
        bundle: TABLES[0]!,
        views: VIEWS,
        activeViewId: 'v_table',
        onSelectView,
        onCreateView: noopAsync,
        onRenameView: noopAsync,
        onDeleteView: noopAsync,
        onReorderViews: noopAsync,
        onJumpToDatasource: noop,
      }),
    )

    expect(handle.container.textContent).toContain('项目运营台账表')
    expect(handle.container.textContent).toContain('项目台账')
    expect(handle.container.textContent).toContain('项目透视')
    expect(handle.container.textContent).toContain('新建视图')
    expect(handle.container.textContent).toContain('项目管理表')

    handle.rerender(
      createElement(AppViewTabs, {
        canConfigureApp: false,
        canManageDataSource: false,
        app: APPS[0]!,
        bundle: TABLES[0]!,
        views: VIEWS,
        activeViewId: 'v_table',
        onSelectView,
        onCreateView: noopAsync,
        onRenameView: noopAsync,
        onDeleteView: noopAsync,
        onReorderViews: noopAsync,
        onJumpToDatasource: noop,
      }),
    )

    expect(handle.container.textContent).not.toContain('新建视图')
    expect(handle.container.textContent).not.toContain('项目管理表')
    const pivotTab = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('项目透视'),
    )!
    act(() => {
      pivotTab.click()
    })
    expect(onSelectView).toHaveBeenCalledWith('v_pivot')
  })
})

describe('Toolbar 真实权限能力裁剪', () => {
  test('只读成员隐藏新增行/VLOOKUP/水印/视图配置入口，可编辑成员仅开放写行而隐藏配置入口', () => {
    const handle = mountComponent(
      createElement(Toolbar, {
        capabilities: MEMBER_RO_CAPS,
        targetKind: 'app',
        tableMeta: TABLES[0]!.meta,
        activeView: VIEWS[0],
        visibleColumns: COLUMNS,
        allComputedRecords: RECORDS,
        displayRecords: RECORDS,
        unresolvedConflictCount: 2,
        selectedRecordIds: ['r1'],
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
        onNotify: noop,
      }),
    )

    expect(handle.container.textContent).toContain('只读权限')
    expect(handle.container.textContent).not.toContain('新增行')
    expect(handle.container.textContent).not.toContain('删除选中')
    expect(handle.container.textContent).not.toContain('VLOOKUP')
    expect(handle.container.textContent).not.toContain('视图配置')
    expect(handle.container.textContent).not.toContain('待消歧')
    expect(handle.container.textContent).toContain('临时筛选')
    expect(handle.container.textContent).toContain('导出')

    // 可编辑普通成员：开放新增行/删除选中，仍隐藏配置类按钮与数据源跳转
    handle.rerender(
      createElement(Toolbar, {
        capabilities: MEMBER_ED_CAPS,
        targetKind: 'app',
        tableMeta: TABLES[0]!.meta,
        activeView: VIEWS[0],
        visibleColumns: COLUMNS,
        allComputedRecords: RECORDS,
        displayRecords: RECORDS,
        unresolvedConflictCount: 2,
        selectedRecordIds: ['r1'],
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
        onJumpToDatasource: noop,
        onNotify: noop,
      }),
    )

    expect(handle.container.textContent).not.toContain('只读权限')
    expect(handle.container.textContent).toContain('新增行')
    expect(handle.container.textContent).toContain('删除选中 (1)')
    expect(handle.container.textContent).toContain('临时筛选')
    expect(handle.container.textContent).not.toContain('VLOOKUP')
    expect(handle.container.textContent).not.toContain('视图配置')
    expect(handle.container.textContent).not.toContain('数据源')
  })
})

describe('SummaryMenuPopover 与 GridPopupMenu 交互', () => {
  test('SummaryMenuPopover 展示可选聚合项并回调选中类型', () => {
    const onSelect = vi.fn<(columnKey: string, summaryType: SummaryType) => void>()
    const onClose = vi.fn<() => void>()
    const { container } = mountComponent(
      createElement(SummaryMenuPopover, {
        info: {
          column: COLUMNS[2]!,
          columnKey: 'amount',
          colIndex: 2,
          summaryType: 'sum',
          rect: { x: 200, y: 400, width: 120, height: 36 },
        },
        onSelect,
        onClose,
      }),
    )

    const avgBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '平均值',
    )!
    act(() => {
      avgBtn.click()
    })
    expect(onSelect).toHaveBeenCalledWith('amount', 'avg')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('GridPopupMenu 在具备配置权时支持快速标色与列配置动作', () => {
    const onAction = vi.fn<(action: GridMenuActionId, stylePatch?: CellStyleConfig) => void>()
    const { container } = mountComponent(
      createElement(GridPopupMenu, {
        context: {
          canEditRecords: true,
          canConfigure: true,
          region: 'body',
          x: 100,
          y: 100,
          colIndex: 1,
          column: COLUMNS[1]!,
          record: RECORDS[0]!,
          selection: {
            ranges: [
              {
                start: { col: 1, row: 0 },
                end: { col: 1, row: 0 },
                recordIds: ['r1'],
                columnKeys: ['status'],
              },
            ],
            recordIds: ['r1'],
            columnKeys: ['status'],
            focus: { col: 1, row: 0 },
          },
          sortRules: [],
          frozenColCount: 0,
          visibleColumnCount: 3,
          canRenameColumn: true,
          canDeleteColumn: true,
          hasSelectionCellStyles: false,
          isDatasourceMode: false,
        },
        onAction,
        onClose: noop,
      }),
    )

    const swatchBtn = container.querySelector('[aria-label="浅蓝高亮"]') as HTMLButtonElement
    act(() => {
      swatchBtn.click()
    })
    expect(onAction).toHaveBeenCalledWith('apply_selection_style', {
      bgColor: '#eff6ff',
      textColor: '#1e40af',
    })
  })
})

describe('ViewConfigDrawer 统一视图配置交互', () => {
  test('表格视图支持切换字段显隐、调整冻结列与行高、设置选区样式', () => {
    const onUpdateView = vi.fn<(patch: Partial<WorkspaceView>) => void>()
    const selection = {
      ranges: [
        {
          start: { col: 2, row: 0 },
          end: { col: 2, row: 0 },
          recordIds: ['r1'],
          columnKeys: ['amount'],
        },
      ],
      recordIds: ['r1'],
      columnKeys: ['amount'],
      focus: { col: 2, row: 0 },
    }

    const handle = mountComponent(
      createElement(ViewConfigDrawer, {
        open: true,
        activeTab: 'fields',
        view: VIEWS[0]!,
        tableMeta: TABLES[0]!.meta,
        selectionInfo: selection,
        pivotConfig: VIEWS[1]!.pivotConfig!,
        onTabChange: noop,
        onClose: noop,
        onUpdateView,
        onOpenAddColumn: noop,
        onOpenColumnManager: noop,
        onOpenLookupWizard: noop,
        onExpandAllPivot: noop,
        onCollapseAllPivot: noop,
      }),
    )

    const hideStatusBtn = handle.container.querySelector(
      '[aria-label="隐藏 状态"]',
    ) as HTMLButtonElement
    act(() => {
      hideStatusBtn.click()
    })
    expect(onUpdateView).toHaveBeenCalledWith({ hiddenColumns: ['status'] })

    handle.rerender(
      createElement(ViewConfigDrawer, {
        open: true,
        activeTab: 'styles',
        view: VIEWS[0]!,
        tableMeta: TABLES[0]!.meta,
        selectionInfo: selection,
        pivotConfig: VIEWS[1]!.pivotConfig!,
        onTabChange: noop,
        onClose: noop,
        onUpdateView,
        onOpenAddColumn: noop,
        onOpenColumnManager: noop,
        onOpenLookupWizard: noop,
        onExpandAllPivot: noop,
        onCollapseAllPivot: noop,
      }),
    )

    const incFreezeBtn = handle.container.querySelector(
      '[aria-label="增加冻结列"]',
    ) as HTMLButtonElement
    act(() => {
      incFreezeBtn.click()
    })
    expect(onUpdateView).toHaveBeenCalledWith({ frozenColCount: 2 })

    const selSwatchBtn = handle.container.querySelector(
      '[title="应用到选区：警示红"]',
    ) as HTMLButtonElement
    act(() => {
      selSwatchBtn.click()
    })
    expect(onUpdateView).toHaveBeenCalledWith({
      cellStyles: { r1: { amount: { bgColor: '#fef2f2', textColor: '#991b1b' } } },
    })
  })
})

describe('数据源中心 vs 智能表格分层 UI 重构', () => {
  test('Toolbar 在 datasource 模式移除 VLOOKUP，normal 表露出打开录入页/复制录入链接，app 运维态露出公式/派生列/数据源入口', () => {
    const onOpenEntryPage = vi.fn<() => void>()
    const onCopyEntryLink = vi.fn<() => void>()
    const onJumpToDatasource = vi.fn<(tableId: string) => void>()

    const handle = mountComponent(
      createElement(Toolbar, {
        capabilities: FULL_CAPS,
        canCreateApp: true,
        targetKind: 'datasource',
        tableMeta: TABLES[0]!.meta,
        visibleColumns: COLUMNS,
        allComputedRecords: RECORDS,
        displayRecords: RECORDS,
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
        onOpenEntryPage,
        onCopyEntryLink,
        onNotify: noop,
      }),
    )

    expect(handle.container.textContent).not.toContain('VLOOKUP')
    expect(handle.container.textContent).toContain('新增列')
    expect(handle.container.textContent).toContain('字段管理')
    expect(handle.container.textContent).toContain('打开录入页')
    expect(handle.container.textContent).toContain('复制录入链接')
    expect(handle.container.textContent).toContain('新建智能表格')

    const openEntryBtn = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('打开录入页'),
    )!
    const copyEntryBtn = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('复制录入链接'),
    )!
    act(() => {
      openEntryBtn.click()
      copyEntryBtn.click()
    })
    expect(onOpenEntryPage).toHaveBeenCalledTimes(1)
    expect(onCopyEntryLink).toHaveBeenCalledTimes(1)

    // advanced 数据源表不露出打开/复制录入页及新增列
    handle.rerender(
      createElement(Toolbar, {
        capabilities: FULL_CAPS,
        canCreateApp: true,
        targetKind: 'datasource',
        tableMeta: TABLES[1]!.meta,
        visibleColumns: TABLES[1]!.meta.columns,
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
        onNotify: noop,
      }),
    )
    expect(handle.container.textContent).not.toContain('打开录入页')
    expect(handle.container.textContent).not.toContain('复制录入链接')
    expect(handle.container.textContent).not.toContain('新增列')

    // app 可配置态露出新增公式列、派生列管理、VLOOKUP 与数据源跳转入口
    handle.rerender(
      createElement(Toolbar, {
        capabilities: FULL_CAPS,
        canCreateApp: true,
        targetKind: 'app',
        tableMeta: TABLES[0]!.meta,
        activeView: VIEWS[0],
        visibleColumns: COLUMNS,
        allComputedRecords: RECORDS,
        displayRecords: RECORDS,
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
        onJumpToDatasource,
        onNotify: noop,
      }),
    )
    expect(handle.container.textContent).toContain('新增公式列')
    expect(handle.container.textContent).toContain('派生列管理')
    expect(handle.container.textContent).toContain('VLOOKUP')
    const dsBtn = Array.from(handle.container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '数据源',
    )!
    act(() => {
      dsBtn.click()
    })
    expect(onJumpToDatasource).toHaveBeenCalledWith('tbl_1')
  })

  test('AddColumnModal 在 datasource 模式移除 formula 并支持 required/align，在 app 模式聚焦 formula 派生列', async () => {
    const onSubmit = vi.fn<(col: SmartColumn) => Promise<void>>(noopAsync)
    const handle = mountComponent(
      createElement(AddColumnModal, {
        mode: 'datasource',
        columns: COLUMNS,
        onClose: noop,
        onSubmit,
      }),
    )

    // datasource 模式不包含计算公式列选项
    const typeTrigger = handle.container.querySelector(
      'button[role="combobox"][aria-label="字段类型"]',
    ) as HTMLButtonElement
    act(() => {
      typeTrigger.click()
    })
    const typeOptions = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (el) => el.textContent,
    )
    expect(typeOptions.some((t) => t?.includes('公式'))).toBe(false)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    const titleInput = handle.container.querySelector('#st-add-col-title') as HTMLInputElement
    const reqCheckbox = handle.container.querySelector('input[type="checkbox"]') as HTMLInputElement
    const rightAlignBtn = handle.container.querySelector(
      'button[aria-label="右对齐"]',
    ) as HTMLButtonElement

    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      descriptor?.set?.call(titleInput, '签约主体')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
      titleInput.dispatchEvent(new Event('change', { bubbles: true }))
      reqCheckbox.click()
      rightAlignBtn.click()
    })

    const form = handle.container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: '签约主体',
      type: 'text',
      required: true,
      align: 'right',
    })

    // app 模式基于 rawColumns + derivedColumns 校验并提交公式列
    const onAppSubmit = vi.fn<(col: SmartColumn) => Promise<void>>(noopAsync)
    const derivedCols: SmartColumn[] = [
      {
        key: 'lookup_rate',
        title: '税率',
        type: 'lookup',
        width: 100,
        lookupConfig: {
          groupId: 'g1',
          targetTableId: 'tbl_tax',
          matchRules: [{ sourceField: 'status', targetField: 'status' }],
          targetReturnField: 'rate',
          mode: 'one',
        },
      },
    ]
    handle.rerender(
      createElement(AddColumnModal, {
        mode: 'app',
        columns: COLUMNS,
        derivedColumns: derivedCols,
        onClose: noop,
        onSubmit: onAppSubmit,
      }),
    )

    const appTitleInput = handle.container.querySelector('#st-add-col-title') as HTMLInputElement
    const formulaInput = handle.container.querySelector('#st-formula-expr') as HTMLInputElement
    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      descriptor?.set?.call(appTitleInput, '预计税额')
      appTitleInput.dispatchEvent(new Event('input', { bubbles: true }))
      appTitleInput.dispatchEvent(new Event('change', { bubbles: true }))
      descriptor?.set?.call(formulaInput, '[合同金额] * [税率]')
      formulaInput.dispatchEvent(new Event('input', { bubbles: true }))
      formulaInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(handle.container.textContent).toContain('公式语法校验通过')

    const appForm = handle.container.querySelector('form')!
    await act(async () => {
      appForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onAppSubmit).toHaveBeenCalledTimes(1)
    expect(onAppSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: '预计税额',
      type: 'formula',
      formulaExpr: '[合同金额] * [税率]',
    })
  })

  test('ColumnManagerModal 在 datasource 与 app 模式下分别管理原始字段配置与派生列', async () => {
    const onUpdateColumn = vi.fn<(k: string, p: Partial<SmartColumn>) => Promise<void>>(noopAsync)
    const onUpdateDerivedColumn =
      vi.fn<(k: string, p: Partial<SmartColumn>) => Promise<void>>(noopAsync)
    const onJumpToDatasource = vi.fn<() => void>()

    const handle = mountComponent(
      createElement(ColumnManagerModal, {
        mode: 'datasource',
        tableKind: 'normal',
        columns: COLUMNS,
        onClose: noop,
        onRenameColumn: noopAsync,
        onUpdateColumn,
        onDeleteColumn: noopAsync,
      }),
    )

    const statusReq = handle.container.querySelector(
      'input[aria-label="状态 必填"]',
    ) as HTMLInputElement
    const amountCenterBtn = handle.container.querySelector(
      'button[aria-label="合同金额 居中对齐"]',
    ) as HTMLButtonElement

    await act(async () => {
      statusReq.click()
      amountCenterBtn.click()
    })
    expect(onUpdateColumn).toHaveBeenCalledWith('status', { required: true })
    expect(onUpdateColumn).toHaveBeenCalledWith('amount', { align: 'center' })

    // 展开单选列配色编辑器
    const paletteBtn = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('选项配色'),
    )!
    act(() => {
      paletteBtn.click()
    })
    expect(handle.container.textContent).toContain('添加选项')

    // 切换至 app 派生列管理模式
    const derivedCols: SmartColumn[] = [
      {
        key: 'f_double',
        title: '双倍金额',
        type: 'formula',
        width: 120,
        formulaExpr: '[合同金额] * 2',
      },
    ]
    handle.rerender(
      createElement(ColumnManagerModal, {
        mode: 'app',
        tableKind: 'normal',
        columns: COLUMNS,
        derivedColumns: derivedCols,
        onClose: noop,
        onRenameColumn: noopAsync,
        onDeleteColumn: noopAsync,
        onUpdateDerivedColumn,
        onJumpToDatasource,
      }),
    )

    expect(handle.container.textContent).toContain('智能表格派生列管理')
    const derivedTitleInput = handle.container.querySelector(
      'input[aria-label="派生列 双倍金额 名称"]',
    ) as HTMLInputElement
    expect(derivedTitleInput.value).toBe('双倍金额')
    const formulaInput = handle.container.querySelector(
      'input[aria-label="公式列 双倍金额 表达式"]',
    ) as HTMLInputElement
    expect(formulaInput.value).toBe('[合同金额] * 2')
    expect(handle.container.textContent).toContain('底层数据源原始列（只读')

    const jumpBtn = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('前往数据源中心管理'),
    )!
    act(() => {
      jumpBtn.click()
    })
    expect(onJumpToDatasource).toHaveBeenCalledTimes(1)
  })

  test('AddColumnModal / ColumnManagerModal / DrawerPivotPanel 支持 0~6 位小数配置及默认自动回退', async () => {
    function pickSelectOption(container: HTMLElement, ariaLabel: string, optionText: string) {
      const trigger = container.querySelector(
        `button[role="combobox"][aria-label="${ariaLabel}"]`,
      ) as HTMLButtonElement | null
      expect(trigger).not.toBeNull()
      act(() => {
        trigger!.click()
      })
      const opt = Array.from(document.body.querySelectorAll('[role="option"]')).find(
        (el) => el.textContent?.trim() === optionText,
      ) as HTMLElement | undefined
      expect(opt).toBeDefined()
      act(() => {
        opt!.click()
      })
    }

    // 1) AddColumnModal datasource 模式选择数值列并配置 3 位小数
    const onAddSubmit = vi.fn<(col: SmartColumn) => Promise<void>>(noopAsync)
    const addHandle = mountComponent(
      createElement(AddColumnModal, {
        mode: 'datasource',
        columns: COLUMNS,
        onClose: noop,
        onSubmit: onAddSubmit,
      }),
    )
    pickSelectOption(addHandle.container, '字段类型', '数值 / 金额')
    pickSelectOption(addHandle.container, '小数位数', '3 位')
    const titleInput = addHandle.container.querySelector('#st-add-col-title') as HTMLInputElement
    act(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      descriptor?.set?.call(titleInput, '毛利率')
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
      titleInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      addHandle.container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onAddSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: '毛利率',
      type: 'number',
      decimalPlaces: 3,
    })

    // 2) ColumnManagerModal 数据源数值列与 SmartApp 公式列切换小数位数
    const onUpdateRaw =
      vi.fn<(key: string, patch: Partial<SmartColumn>) => Promise<void>>(noopAsync)
    const mgrHandle = mountComponent(
      createElement(ColumnManagerModal, {
        mode: 'datasource',
        tableKind: 'normal',
        columns: COLUMNS,
        onClose: noop,
        onRenameColumn: noopAsync,
        onDeleteColumn: noopAsync,
        onUpdateColumn: onUpdateRaw,
      }),
    )
    pickSelectOption(mgrHandle.container, '合同金额 小数位数', '4 位')
    expect(onUpdateRaw).toHaveBeenCalledWith('amount', { decimalPlaces: 4 })

    const onUpdateDerived =
      vi.fn<(key: string, patch: Partial<SmartColumn>) => Promise<void>>(noopAsync)
    mgrHandle.rerender(
      createElement(ColumnManagerModal, {
        mode: 'app',
        tableKind: 'normal',
        columns: COLUMNS,
        derivedColumns: [
          {
            key: 'f_double',
            title: '双倍金额',
            type: 'formula',
            width: 120,
            formulaExpr: '[合同金额] * 2',
            decimalPlaces: 2,
          },
        ],
        onClose: noop,
        onRenameColumn: noopAsync,
        onDeleteColumn: noopAsync,
        onUpdateDerivedColumn: onUpdateDerived,
      }),
    )
    pickSelectOption(mgrHandle.container, '公式列 双倍金额 小数位数', '默认（自动）')
    expect(onUpdateDerived).toHaveBeenCalledWith('f_double', { decimalPlaces: undefined })

    // 3) DrawerPivotPanel 透视指标切换小数位数与默认回退
    let nextPivotConfig: SmartPivotConfig = {
      rowDimensions: ['status'],
      columnDimensions: [],
      measures: [{ key: 'm_amt', title: '合同金额(求和)', field: 'amount', agg: 'sum' }],
    }
    const pivotHandle = mountComponent(
      createElement(DrawerPivotPanel, {
        columns: COLUMNS,
        config: nextPivotConfig,
        onChangeConfig: (cfg) => {
          nextPivotConfig = cfg
        },
        onExpandAll: noop,
        onCollapseAll: noop,
      }),
    )
    pickSelectOption(pivotHandle.container, '合同金额 小数位数', '5 位')
    expect(nextPivotConfig.measures[0]?.decimalPlaces).toBe(5)

    pivotHandle.rerender(
      createElement(DrawerPivotPanel, {
        columns: COLUMNS,
        config: nextPivotConfig,
        onChangeConfig: (cfg) => {
          nextPivotConfig = cfg
        },
        onExpandAll: noop,
        onCollapseAll: noop,
      }),
    )
    pickSelectOption(pivotHandle.container, '合同金额 小数位数', '默认（自动）')
    expect('decimalPlaces' in nextPivotConfig.measures[0]!).toBe(false)
  })
})
