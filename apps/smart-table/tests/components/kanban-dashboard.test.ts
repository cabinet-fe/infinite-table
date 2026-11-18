// @vitest-environment happy-dom

// 看板交互拖拽写回、仪表盘图表/KPI 渲染与配置、以及四类视图全栈端到端回归测试。

import { Chart } from 'chart.js'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { App, stripDeletedColumnFromView } from '../../src/App'
import { DashboardView } from '../../src/components/DashboardView'
import { KanbanView } from '../../src/components/KanbanView'
import { ViewConfigDrawer } from '../../src/components/ViewConfigDrawer'
import { openDatabase } from '../../src/server/db'
import { createApp } from '../../src/server/index'
import { seedSmartTableDemo } from '../../src/server/seed'
import type {
  DashboardConfig,
  SmartColumn,
  SmartRecord,
  WorkspaceView,
} from '../../src/shared/schema'

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
  appId: 'app_1',
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
  appId: 'app_1',
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

function setupCanvasMock() {
  const createFakeCtx = (canvas: HTMLCanvasElement): CanvasRenderingContext2D =>
    ({
      canvas,
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
      resetTransform: noop,
      translate: noop,
      scale: noop,
      rotate: noop,
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
      getLineDash: () => [],
      measureText: (t: string) => ({ width: Math.max(8, t.length * 7) }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
    }) as unknown as CanvasRenderingContext2D

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    if (contextId !== '2d') return null
    return createFakeCtx(this)
  } as unknown as typeof HTMLCanvasElement.prototype.getContext)

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: 480,
    bottom: 224,
    width: 480,
    height: 224,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(480)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(224)

  if (typeof globalThis.ResizeObserver === 'undefined') {
    ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
}

describe('DashboardView KPI 视觉重构、Chart.js 渲染与双态画布交互', () => {
  test('渲染极简 KPI 图标徽章（无顶部彩条）与 Chart.js 图表，支持筛选实时重算', () => {
    setupCanvasMock()
    const handle = mountComponent(
      createElement(DashboardView, {
        view: DASHBOARD_VIEW,
        columns: COLUMNS,
        records: RECORDS,
        readonly: false,
      }),
    )

    const cntCard = handle.container.querySelector('[data-kpi-id="kpi_cnt"]') as HTMLElement
    const sumCard = handle.container.querySelector('[data-kpi-id="kpi_sum"]') as HTMLElement
    expect(cntCard.textContent).toContain('2个')
    expect(sumCard.textContent).toContain('¥200,000')

    // 无顶部 h-1 彩条，渲染图标徽章（含柔和背景与图标色）
    expect(cntCard.querySelector('.h-1')).toBeNull()
    expect(sumCard.querySelector('.h-1')).toBeNull()
    const cntIconBadge = cntCard.querySelector('[data-kpi-icon="hash"]') as HTMLElement
    const sumIconBadge = sumCard.querySelector('[data-kpi-icon="dollar"]') as HTMLElement
    expect(cntIconBadge).not.toBeNull()
    expect(sumIconBadge).not.toBeNull()
    expect(cntIconBadge.querySelector('svg')).not.toBeNull()
    expect(cntIconBadge.style.backgroundColor).toContain('rgba(')

    // Chart.js canvas 挂载成功
    const barCanvas = handle.container.querySelector(
      '[data-chart-id="c_bar"] canvas[aria-label="柱状图"]',
    ) as HTMLCanvasElement
    const lineCanvas = handle.container.querySelector(
      '[data-chart-id="c_line"] canvas[aria-label="折线图"]',
    ) as HTMLCanvasElement
    const pieCanvas = handle.container.querySelector(
      '[data-chart-id="c_pie"] canvas[aria-label="环形图"]',
    ) as HTMLCanvasElement
    expect(barCanvas).not.toBeNull()
    expect(lineCanvas).not.toBeNull()
    expect(pieCanvas).not.toBeNull()
    expect(Chart.getChart(barCanvas)).toBeDefined()
    expect(Chart.getChart(lineCanvas)).toBeDefined()
    expect(Chart.getChart(pieCanvas)).toBeDefined()

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

  test('operator 态支持画布新增/删除/调序与点击卡片选中，且图例点击不误触选中', async () => {
    setupCanvasMock()
    const onSelectItem = vi.fn<(item: { kind: 'kpi' | 'chart'; id: string } | null) => void>()
    const onChangeConfig = vi.fn<(next: DashboardConfig) => void>()

    const multiView: WorkspaceView = {
      ...DASHBOARD_VIEW,
      dashboardConfig: {
        ...DASHBOARD_VIEW.dashboardConfig!,
        charts: [
          {
            id: 'c_multi',
            title: '状态 × 负责人金额对比',
            chartType: 'bar',
            dimensionField: 'status',
            seriesField: 'owner',
            measureField: 'amount',
            agg: 'sum',
          },
          DASHBOARD_VIEW.dashboardConfig!.charts[2]!,
        ],
      },
    }

    const { container } = mountComponent(
      createElement(DashboardView, {
        view: multiView,
        columns: COLUMNS,
        records: RECORDS,
        readonly: false,
        selectedItem: { kind: 'kpi', id: 'kpi_cnt' },
        onSelectItem,
        onChangeConfig,
      }),
    )

    // 选中态标示
    expect(container.querySelector('[data-kpi-id="kpi_cnt"]')?.getAttribute('data-selected')).toBe(
      'true',
    )

    // 边界禁用校验：首个指标卡上移禁用、最后一个下移禁用
    const firstUpBtn = container.querySelector(
      'button[aria-label="上移指标卡 项目数"]',
    ) as HTMLButtonElement
    const lastDownBtn = container.querySelector(
      'button[aria-label="下移指标卡 合同总额"]',
    ) as HTMLButtonElement
    expect(firstUpBtn.disabled).toBe(true)
    expect(lastDownBtn.disabled).toBe(true)

    // 点击卡片操作按钮（下移/删除）触发 onChangeConfig 且不触发卡片选中
    const firstDownBtn = container.querySelector(
      'button[aria-label="下移指标卡 项目数"]',
    ) as HTMLButtonElement
    act(() => {
      firstDownBtn.click()
    })
    expect(onChangeConfig).toHaveBeenCalledTimes(1)
    expect(onChangeConfig.mock.calls[0]![0].kpis.map((k) => k.id)).toEqual(['kpi_sum', 'kpi_cnt'])
    expect(onSelectItem).not.toHaveBeenCalled()

    onChangeConfig.mockClear()
    const delSelectedKpiBtn = container.querySelector(
      'button[aria-label="删除指标卡 项目数"]',
    ) as HTMLButtonElement
    act(() => {
      delSelectedKpiBtn.click()
    })
    expect(onChangeConfig.mock.calls[0]![0].kpis.map((k) => k.id)).toEqual(['kpi_sum'])
    expect(onSelectItem).toHaveBeenCalledWith(null)

    // 画布顶部直接新增指标卡与图表
    onSelectItem.mockClear()
    onChangeConfig.mockClear()
    const addKpiBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加指标卡'),
    )!
    const addChartBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加图表'),
    )!
    act(() => {
      addKpiBtn.click()
      addChartBtn.click()
    })
    expect(onChangeConfig).toHaveBeenCalledTimes(2)
    expect(onChangeConfig.mock.calls[0]![0].kpis).toHaveLength(3)
    expect(onChangeConfig.mock.calls[1]![0].charts).toHaveLength(3)

    // 点击 KPI 卡片触发选中
    const sumCard = container.querySelector('[data-kpi-id="kpi_sum"]') as HTMLElement
    act(() => {
      sumCard.click()
    })
    expect(onSelectItem).toHaveBeenCalledWith({ kind: 'kpi', id: 'kpi_sum' })

    // 点击多系列柱状图 Chart.js 图例仅切换显隐，不触发卡片选中
    onSelectItem.mockClear()
    const multiCanvas = container.querySelector(
      '[data-chart-id="c_multi"] canvas',
    ) as HTMLCanvasElement
    const instance = Chart.getChart(multiCanvas)!
    const legend = instance.legend as unknown as {
      legendHitBoxes: Array<{ left: number; top: number; width: number; height: number }>
    }
    const hitBox = legend.legendHitBoxes[0]!
    expect(instance.isDatasetVisible(0)).toBe(true)

    act(() => {
      multiCanvas.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: hitBox.left + hitBox.width / 2,
          clientY: hitBox.top + hitBox.height / 2,
        }),
      )
    })
    expect(onSelectItem).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(instance.isDatasetVisible(0)).toBe(false)
    })

    // 点击非图例绘图区正常触发图表卡片选中
    const plotX = (instance.chartArea.left + instance.chartArea.right) / 2
    const plotY = (instance.chartArea.top + instance.chartArea.bottom) / 2
    act(() => {
      multiCanvas.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: plotX,
          clientY: plotY,
        }),
      )
    })
    expect(onSelectItem).toHaveBeenCalledWith({ kind: 'chart', id: 'c_multi' })
  })

  test('viewer 态不渲染增删改序入口且点击卡片不触发选中与配置抽屉', () => {
    setupCanvasMock()
    const onSelectItem = vi.fn<(item: { kind: 'kpi' | 'chart'; id: string } | null) => void>()
    const onChangeConfig = vi.fn<(next: DashboardConfig) => void>()
    const onOpenConfig = vi.fn<() => void>()

    const { container } = mountComponent(
      createElement(DashboardView, {
        view: DASHBOARD_VIEW,
        columns: COLUMNS,
        records: RECORDS,
        readonly: true,
        selectedItem: { kind: 'kpi', id: 'kpi_cnt' },
        onSelectItem,
        onChangeConfig,
        onOpenConfig,
      }),
    )

    expect(container.textContent).not.toContain('添加指标卡')
    expect(container.textContent).not.toContain('添加图表')
    expect(container.textContent).not.toContain('配置仪表盘')
    expect(container.querySelector('button[aria-label*="上移"]')).toBeNull()
    expect(container.querySelector('button[aria-label*="下移"]')).toBeNull()
    expect(container.querySelector('button[aria-label*="删除"]')).toBeNull()
    expect(container.querySelector('[data-selected="true"]')).toBeNull()

    const kpiCard = container.querySelector('[data-kpi-id="kpi_cnt"]') as HTMLElement
    const chartCard = container.querySelector('[data-chart-id="c_bar"]') as HTMLElement
    act(() => {
      kpiCard.click()
      chartCard.click()
    })
    expect(onSelectItem).not.toHaveBeenCalled()
    expect(onChangeConfig).not.toHaveBeenCalled()
    expect(onOpenConfig).not.toHaveBeenCalled()
  })

  test('stripDeletedColumnFromView 删列时同步清理图表 seriesField 与 stacked', () => {
    const viewWithSeries: WorkspaceView = {
      ...DASHBOARD_VIEW,
      dashboardConfig: {
        kpis: [...DASHBOARD_VIEW.dashboardConfig!.kpis],
        charts: [
          {
            id: 'c_series',
            title: '大区对比',
            chartType: 'bar',
            dimensionField: 'status',
            seriesField: 'owner',
            stacked: true,
            measureField: 'amount',
            agg: 'sum',
          },
        ],
      },
    }

    const patch = stripDeletedColumnFromView(viewWithSeries, 'owner')
    expect(patch?.dashboardConfig?.charts).toHaveLength(1)
    expect(patch?.dashboardConfig?.charts[0]?.seriesField).toBeUndefined()
    expect(patch?.dashboardConfig?.charts[0]?.stacked).toBeUndefined()
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
  test('从种子库加载后可切换表格/看板/透视/仪表盘，并在看板拖拽写回、画布联动抽屉与双态切换中保持一致', async () => {
    const db = openDatabase(':memory:')
    seedSmartTableDemo(db)
    const serverApp = createApp(db)

    setupCanvasMock()

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

    // 等待初始加载完成（左侧智能表格列表 + 顶部当前智能表格多视图 Tab 栏）
    await vi.waitFor(() => {
      expect(container.textContent).toContain('项目运营管理台')
      expect(container.textContent).toContain('项目跟进总台账')
      expect(container.querySelector('[aria-label="当前智能表格视图"]')).not.toBeNull()
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

    // 切换至仪表盘视图：验证新版种子图型、KPI 图标徽章及点击卡片联动右侧单卡抽屉
    const dashNav = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('项目经营总览仪表盘'),
    )!
    act(() => {
      dashNav.click()
    })
    expect(container.querySelector('[data-testid="dashboard-view"]')).not.toBeNull()
    const prjCountCard = container.querySelector('[data-kpi-id="kpi_prj_count"]') as HTMLElement
    expect(prjCountCard.textContent).toContain('16个')
    expect(prjCountCard.querySelector('.h-1')).toBeNull()
    expect(prjCountCard.querySelector('[data-kpi-icon="hash"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="横向条形图"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="面积图"]')).not.toBeNull()

    // operator 态点击画布图表卡片联动打开右侧单卡配置抽屉
    const regionChartCard = container.querySelector(
      '[data-chart-id="chart_region_contract"]',
    ) as HTMLElement
    act(() => {
      regionChartCard.click()
    })
    expect(container.querySelector('[aria-label="视图配置抽屉"]')).not.toBeNull()
    expect(
      container.querySelector(
        '[data-dashboard-editor="chart"][data-chart-id="chart_region_contract"]',
      ),
    ).not.toBeNull()

    // 切换至查看态：数据源中心、配置按钮与画布增删入口隐藏，抽屉关闭，点击卡片不再触发抽屉
    const viewerBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '查看态',
    )!
    act(() => {
      viewerBtn.click()
    })
    expect(container.querySelector('[aria-label="数据源中心"]')).toBeNull()
    expect(container.querySelector('[aria-label="视图配置抽屉"]')).toBeNull()
    expect(container.textContent).not.toContain('配置仪表盘')
    expect(container.textContent).not.toContain('添加指标卡')
    expect(container.textContent).not.toContain('数据源：')

    act(() => {
      ;(container.querySelector('[data-kpi-id="kpi_prj_count"]') as HTMLElement).click()
    })
    expect(container.querySelector('[aria-label="视图配置抽屉"]')).toBeNull()

    const revAppBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('管理层营收洞察'),
    )!
    act(() => {
      revAppBtn.click()
    })
    expect(container.textContent).toContain('大区营收对比看板')
    expect(container.textContent).toContain('重点客户回款清单')
    expect(container.querySelector('[aria-label="折线图"]')).not.toBeNull()

    db.close()
  })
})
