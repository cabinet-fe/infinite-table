// @vitest-environment happy-dom

// 看板交互拖拽写回、仪表盘图表/KPI 渲染与配置、以及四类视图全栈端到端回归测试。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { App } from '../../src/App'
import { DashboardView } from '../../src/components/DashboardView'
import { KanbanView } from '../../src/components/KanbanView'
import { ViewConfigDrawer } from '../../src/components/ViewConfigDrawer'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedSmartTableDemo } from '../../src/server/seed'
import type { SmartColumn, SmartRecord, WorkspaceView } from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}
const noopAsync = async () => {}

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 110, isUniqueKey: true },
  { key: 'title', title: '项目名', type: 'text', width: 200 },
  {
    key: 'status',
    title: '项目状态',
    type: 'select',
    width: 110,
    options: [
      { label: '待启动', color: '#f1f5f9', textColor: '#475569' },
      { label: '进行中', color: '#dbeafe', textColor: '#1d4ed8' },
      { label: '已交付', color: '#dcfce7', textColor: '#15803d' },
    ],
  },
  { key: 'owner', title: '负责人', type: 'person', width: 120 },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
  { key: 'progress', title: '进度', type: 'progress', width: 120 },
]

const RECORDS: SmartRecord[] = [
  {
    _id: 'r1',
    code: 'PRJ-01',
    title: 'MES 平台',
    status: '进行中',
    owner: '张三',
    amount: 120000,
    progress: 65,
  },
  {
    _id: 'r2',
    code: 'PRJ-02',
    title: '数据湖升级',
    status: '待启动',
    owner: '李四',
    amount: 80000,
    progress: 15,
  },
]

const KANBAN_VIEW: WorkspaceView = {
  id: 'v_kanban',
  tableId: 'tbl_1',
  name: '项目看板',
  type: 'kanban',
  sortOrder: 0,
  filterGroup: { conjunction: 'and', conditions: [] },
  quickFilterFields: ['status'],
  sortRules: [],
  kanbanConfig: {
    groupByField: 'status',
    titleField: 'title',
    displayFields: ['code', 'owner', 'amount', 'progress'],
    laneOrder: ['待启动', '进行中', '已交付'],
  },
}

const DASHBOARD_VIEW: WorkspaceView = {
  id: 'v_dash',
  tableId: 'tbl_1',
  name: '经营仪表盘',
  type: 'dashboard',
  sortOrder: 1,
  filterGroup: { conjunction: 'and', conditions: [] },
  quickFilterFields: ['status'],
  sortRules: [],
  dashboardConfig: {
    kpis: [
      {
        id: 'kpi_cnt',
        title: '项目数',
        field: '__count__',
        agg: 'count',
        suffix: '个',
        accentColor: '#2563eb',
      },
      {
        id: 'kpi_sum',
        title: '合同总额',
        field: 'amount',
        agg: 'sum',
        numberFormat: 'currency',
        accentColor: '#0f766e',
      },
    ],
    charts: [
      {
        id: 'c_bar',
        title: '状态金额对比',
        chartType: 'bar',
        dimensionField: 'status',
        measureField: 'amount',
        agg: 'sum',
      },
      {
        id: 'c_line',
        title: '状态计数趋势',
        chartType: 'line',
        dimensionField: 'status',
        measureField: '',
        agg: 'count',
      },
      {
        id: 'c_pie',
        title: '状态占比',
        chartType: 'pie',
        dimensionField: 'status',
        measureField: '',
        agg: 'count',
        donut: true,
      },
    ],
  },
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

afterEach(() => {
  vi.restoreAllMocks()
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
})

describe('KanbanView 泳道展示、拖拽写回与双态详情编辑', () => {
  test('运维态支持拖拽卡片跨泳道触发写回，点击卡片可编辑保存', async () => {
    const onMoveCard = vi.fn<(id: string, target: string) => Promise<void>>(async () => {})
    const onUpdateRecord = vi.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>(
      async () => {},
    )

    const { container } = mountComponent(
      createElement(KanbanView, {
        view: KANBAN_VIEW,
        columns: COLUMNS,
        records: RECORDS,
        readonly: false,
        onMoveCard,
        onUpdateRecord,
      }),
    )

    const card = container.querySelector('[data-kanban-card-id="r1"]') as HTMLElement
    const targetLane = container.querySelector('[data-kanban-lane-key="已交付"]') as HTMLElement
    expect(card).not.toBeNull()
    expect(card.getAttribute('draggable')).toBe('true')

    act(() => {
      card.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))
    })
    act(() => {
      targetLane.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
      targetLane.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    })
    expect(onMoveCard).toHaveBeenCalledWith('r1', '已交付')

    // 点击卡片打开详情抽屉编辑标题并提交
    act(() => {
      card.click()
    })
    const titleInput = document.body.querySelector('input[aria-label="项目名"]') as HTMLInputElement
    expect(titleInput).not.toBeNull()

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        titleInput,
        'MES 平台 v2',
      )
      titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const saveBtn = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('保存修改'),
    )!
    await act(async () => {
      saveBtn.click()
    })
    expect(onUpdateRecord).toHaveBeenCalledWith('r1', { title: 'MES 平台 v2' })
  })

  test('用户查看态禁用拖拽改状态，卡片详情抽屉严格只读', () => {
    const onMoveCard = vi.fn<(id: string, target: string) => Promise<void>>(async () => {})
    const { container } = mountComponent(
      createElement(KanbanView, {
        view: KANBAN_VIEW,
        columns: COLUMNS,
        records: RECORDS,
        readonly: true,
        onMoveCard,
        onUpdateRecord: noopAsync,
      }),
    )

    const card = container.querySelector('[data-kanban-card-id="r1"]') as HTMLElement
    const targetLane = container.querySelector('[data-kanban-lane-key="已交付"]') as HTMLElement
    expect(card.getAttribute('draggable')).toBe('false')

    act(() => {
      card.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))
      targetLane.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    })
    expect(onMoveCard).not.toHaveBeenCalled()

    act(() => {
      card.click()
    })
    expect(document.body.textContent).toContain('只读详情')
    expect(document.body.querySelector('input[aria-label="项目名"]')).toBeNull()
    expect(
      Array.from(document.body.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('保存修改'),
      ),
    ).toBeUndefined()
  })
})

describe('DashboardView KPI/图表渲染、悬停提示与筛选实时重算', () => {
  test('渲染 KPI 与柱状/折线/环形图，支持悬停提示与记录变化实时重算', () => {
    const handle = mountComponent(
      createElement(DashboardView, {
        view: DASHBOARD_VIEW,
        columns: COLUMNS,
        records: RECORDS,
        readonly: false,
      }),
    )

    expect(handle.container.querySelector('[data-kpi-id="kpi_cnt"]')?.textContent).toContain('2个')
    expect(handle.container.querySelector('[data-kpi-id="kpi_sum"]')?.textContent).toContain(
      '¥200,000',
    )
    expect(handle.container.querySelector('[aria-label="柱状图"]')).not.toBeNull()
    expect(handle.container.querySelector('[aria-label="折线图"]')).not.toBeNull()
    expect(handle.container.querySelector('[aria-label="环形图"]')).not.toBeNull()

    // 悬停柱状图系列显示 tooltip
    const barChart = handle.container.querySelector('[data-chart-id="c_bar"]')!
    const hoverTarget = barChart.querySelector('svg g.cursor-pointer')!
    act(() => {
      hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(barChart.querySelector('[data-chart-tooltip="true"]')?.textContent).toContain('¥120,000')

    // 模拟筛选为仅 1 条记录，指标实时重算
    handle.rerender(
      createElement(DashboardView, {
        view: DASHBOARD_VIEW,
        columns: COLUMNS,
        records: [RECORDS[0]!],
        readonly: true,
      }),
    )
    expect(handle.container.querySelector('[data-kpi-id="kpi_cnt"]')?.textContent).toContain('1个')
    expect(handle.container.querySelector('[data-kpi-id="kpi_sum"]')?.textContent).toContain(
      '¥120,000',
    )
  })
})

describe('ViewConfigDrawer 看板与仪表盘配置分栏', () => {
  test('看板配置支持切换展示字段与空泳道显隐；仪表盘配置支持增删 KPI 与图表', () => {
    const onUpdateView = vi.fn<(patch: Partial<WorkspaceView>) => void>()
    const handle = mountComponent(
      createElement(ViewConfigDrawer, {
        open: true,
        activeTab: 'kanban',
        view: KANBAN_VIEW,
        tableMeta: {
          id: 'tbl_1',
          name: '项目表',
          kind: 'normal',
          columns: COLUMNS,
          views: [],
          summaries: {},
        },
        selectionInfo: { ranges: [], recordIds: [], columnKeys: [], focus: null },
        pivotConfig: {
          rowDimensions: ['status'],
          columnDimensions: [],
          measures: [{ key: 'm1', title: '记录数', field: '', agg: 'count' }],
        },
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

    const removeFieldBtn = handle.container.querySelector(
      '[aria-label="取消展示 合同金额"]',
    ) as HTMLButtonElement
    act(() => {
      removeFieldBtn.click()
    })
    expect(onUpdateView).toHaveBeenCalledWith({
      kanbanConfig: expect.objectContaining({
        displayFields: ['code', 'owner', 'progress'],
      }),
    })

    // 切换至仪表盘配置
    onUpdateView.mockClear()
    handle.rerender(
      createElement(ViewConfigDrawer, {
        open: true,
        activeTab: 'dashboard',
        view: DASHBOARD_VIEW,
        tableMeta: {
          id: 'tbl_1',
          name: '项目表',
          kind: 'normal',
          columns: COLUMNS,
          views: [],
          summaries: {},
        },
        selectionInfo: { ranges: [], recordIds: [], columnKeys: [], focus: null },
        pivotConfig: {
          rowDimensions: ['status'],
          columnDimensions: [],
          measures: [{ key: 'm1', title: '记录数', field: '', agg: 'count' }],
        },
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

    const addKpiBtn = Array.from(handle.container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加指标卡'),
    )!
    act(() => {
      addKpiBtn.click()
    })
    expect(onUpdateView).toHaveBeenCalledWith({
      dashboardConfig: expect.objectContaining({
        kpis: expect.arrayContaining([
          expect.objectContaining({ id: 'kpi_cnt' }),
          expect.objectContaining({ id: 'kpi_sum' }),
          expect.objectContaining({ field: 'amount' }),
        ]),
      }),
    })

    onUpdateView.mockClear()
    const delChartBtn = handle.container.querySelector(
      '[aria-label="删除图表 状态占比"]',
    ) as HTMLButtonElement
    act(() => {
      delChartBtn.click()
    })
    expect(onUpdateView).toHaveBeenCalledWith({
      dashboardConfig: expect.objectContaining({
        charts: expect.arrayContaining([
          expect.objectContaining({ id: 'c_bar' }),
          expect.objectContaining({ id: 'c_line' }),
        ]),
      }),
    })
  })
})

describe('四类视图端到端全栈联动回归（App + Hono + SQLite）', () => {
  test('从种子库加载后可切换表格/看板/透视/仪表盘，并在看板拖拽改状态同步写回 SQLite 与双态切换', async () => {
    const db = openDatabase(':memory:')
    seedSmartTableDemo(db)
    const serverApp = createApp(db)

    // 轻量 Canvas 2D Mock（供 happy-dom 下 ListTable / PivotGrid 挂载）
    const fakeCtx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '12px sans-serif',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      save: noop,
      restore: noop,
      setTransform: noop,
      translate: noop,
      scale: noop,
      beginPath: noop,
      rect: noop,
      moveTo: noop,
      lineTo: noop,
      bezierCurveTo: noop,
      quadraticCurveTo: noop,
      arc: noop,
      closePath: noop,
      stroke: noop,
      fill: noop,
      clip: noop,
      clearRect: noop,
      fillRect: noop,
      strokeRect: noop,
      fillText: noop,
      strokeText: noop,
      drawImage: noop,
      setLineDash: noop,
      measureText: (t: string) => ({ width: t.length * 7 }),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fakeCtx as unknown as CanvasRenderingContext2D,
    )
    if (typeof globalThis.ResizeObserver === 'undefined') {
      ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    }

    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const req = new Request(
        `http://localhost${url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url}`,
        init,
      )
      return Promise.resolve(serverApp.fetch(req))
    })

    const { container } = mountComponent(createElement(App))

    // 等待初始加载完成（默认首个视图为表格视图）
    await vi.waitFor(() => {
      expect(container.textContent).toContain('项目跟进总台账')
      expect(container.textContent).toContain('应用视图空间')
    })

    // 切换至看板视图并拖拽 rec_prj_001 至「已交付」
    const kanbanNav = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('项目交付状态看板'),
    )!
    act(() => {
      kanbanNav.click()
    })
    expect(container.querySelector('[data-testid="kanban-view"]')).not.toBeNull()

    const card = container.querySelector('[data-kanban-card-id="rec_prj_001"]') as HTMLElement
    const deliveredLane = container.querySelector('[data-kanban-lane-key="已交付"]') as HTMLElement
    act(() => {
      card.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      deliveredLane.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
      deliveredLane.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    await vi.waitFor(async () => {
      const checkRes = await serverApp.request('/api/tables')
      const body = (await checkRes.json()) as {
        tables: Array<{ meta: { id: string }; records: SmartRecord[] }>
      }
      const prj = body.tables.find((t) => t.meta.id === 'tbl_projects')!
      expect(prj.records.find((r) => r._id === 'rec_prj_001')?.status).toBe('已交付')
    })

    // 切换至透视视图
    const pivotNav = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('部门 × 状态业绩透视'),
    )!
    act(() => {
      pivotNav.click()
    })
    expect(container.querySelector('canvas')).not.toBeNull()

    // 切换至仪表盘视图
    const dashNav = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('项目经营总览仪表盘'),
    )!
    act(() => {
      dashNav.click()
    })
    expect(container.querySelector('[data-testid="dashboard-view"]')).not.toBeNull()
    expect(container.querySelector('[data-kpi-id="kpi_prj_count"]')?.textContent).toContain('16个')

    // 切换至查看态：数据源中心隐藏，视图配置按钮隐藏
    const viewerBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '查看态',
    )!
    act(() => {
      viewerBtn.click()
    })
    expect(container.querySelector('[aria-label="数据源中心"]')).toBeNull()
    expect(container.textContent).not.toContain('配置仪表盘')

    db.close()
  })
})
