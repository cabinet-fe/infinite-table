// @vitest-environment happy-dom

// 关键前端工作台组件交互与双态权限隔离测试：
// 验证 Sidebar 双板块隔离、Toolbar 双态按钮裁剪、ViewConfigDrawer 分栏调序/样式/条件格式、
// SummaryMenuPopover 统计选择与 GridPopupMenu 菜单动作触发。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GridPopupMenu, type GridMenuActionId } from '../../src/components/GridPopupMenu'
import { Sidebar } from '../../src/components/Sidebar'
import { SummaryMenuPopover } from '../../src/components/SummaryMenuPopover'
import { Toolbar } from '../../src/components/Toolbar'
import { ViewConfigDrawer } from '../../src/components/ViewConfigDrawer'
import type { AppMode } from '../../src/domain/workspace-helpers'
import type { TableBundle } from '../../src/shared/api-types'
import type {
  CellStyleConfig,
  SmartColumn,
  SmartRecord,
  SummaryType,
  WorkspaceView,
} from '../../src/shared/schema'

// 告知 React 19 当前为 act 测试环境
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
const noopAsync = async () => {}

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

const VIEWS: WorkspaceView[] = [
  {
    id: 'v_table',
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

describe('Sidebar 双板块与双态隔离', () => {
  test('运维态同时展示应用视图空间与数据源中心（自建普通表 + SQL 物理表）及新建/导入/重置入口', () => {
    const { container } = mountComponent(
      createElement(Sidebar, {
        mode: 'operator',
        views: VIEWS,
        tables: TABLES,
        activeTarget: { kind: 'view', viewId: 'v_table' },
        onSelectView: noop,
        onCreateView: noopAsync,
        onRenameView: noopAsync,
        onDeleteView: noopAsync,
        onReorderViews: noopAsync,
        onSelectTable: noop,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )

    expect(container.querySelector('[aria-label="应用视图空间"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="数据源中心"]')).not.toBeNull()
    expect(container.textContent).toContain('项目台账')
    expect(container.textContent).toContain('项目管理表')
    expect(container.textContent).toContain('员工主数据')
    expect(container.textContent).toContain('重置演示数据')
  })

  test('用户查看态严格隐藏数据源中心、新建/重命名/删除视图及重置演示数据', () => {
    const onSelectView = vi.fn<(viewId: string) => void>()
    const { container } = mountComponent(
      createElement(Sidebar, {
        mode: 'viewer',
        views: VIEWS,
        tables: TABLES,
        activeTarget: { kind: 'view', viewId: 'v_table' },
        onSelectView,
        onCreateView: noopAsync,
        onRenameView: noopAsync,
        onDeleteView: noopAsync,
        onReorderViews: noopAsync,
        onSelectTable: noop,
        onCreateNormalTable: noopAsync,
        onRenameTable: noopAsync,
        onDeleteTable: noopAsync,
        onOpenImport: noop,
        onResetSeed: noopAsync,
      }),
    )

    expect(container.querySelector('[aria-label="应用视图空间"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="数据源中心"]')).toBeNull()
    expect(container.textContent).not.toContain('重置演示数据')
    expect(container.querySelector('[title="新建应用视图"]')).toBeNull()

    const pivotBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('项目透视'),
    )!
    act(() => {
      pivotBtn.click()
    })
    expect(onSelectView).toHaveBeenCalledWith('v_pivot')
  })
})

describe('Toolbar 双态交互隔离', () => {
  test('用户查看态隐藏新增行/VLOOKUP/水印/视图配置入口，保留临时筛选、导出与模式切换', () => {
    const onToggleMode = vi.fn<(nextMode: AppMode) => void>()
    const { container } = mountComponent(
      createElement(Toolbar, {
        mode: 'viewer',
        targetKind: 'view',
        tableMeta: TABLES[0]!.meta,
        activeView: VIEWS[0],
        visibleColumns: COLUMNS,
        allComputedRecords: RECORDS,
        displayRecords: RECORDS,
        unresolvedConflictCount: 2,
        selectedRecordIds: ['r1'],
        watermarkEnabled: false,
        configDrawerOpen: false,
        onToggleMode,
        onUpdateFilters: noop,
        onToggleConfigDrawer: noop,
        onAddRow: noopAsync,
        onDeleteSelectedRows: noopAsync,
        onOpenAddColumn: noop,
        onOpenColumnManager: noop,
        onOpenLookupWizard: noop,
        onCreateViewFromTable: noop,
        onJumpToFirstConflict: noop,
        onToggleWatermark: noop,
        onNotify: noop,
      }),
    )

    expect(container.textContent).not.toContain('新增行')
    expect(container.textContent).not.toContain('删除选中')
    expect(container.textContent).not.toContain('VLOOKUP')
    expect(container.textContent).not.toContain('视图配置')
    expect(container.textContent).not.toContain('待消歧')
    expect(container.textContent).toContain('临时筛选')
    expect(container.textContent).toContain('导出')

    const opBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('运维态'),
    )!
    act(() => {
      opBtn.click()
    })
    expect(onToggleMode).toHaveBeenCalledWith('operator')
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

  test('GridPopupMenu 在运维态支持快速标色与列配置动作', () => {
    const onAction = vi.fn<(action: GridMenuActionId, stylePatch?: CellStyleConfig) => void>()
    const { container } = mountComponent(
      createElement(GridPopupMenu, {
        context: {
          mode: 'operator',
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
