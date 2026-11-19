// @vitest-environment happy-dom

// 验证 DrawerDashboardPanel 与 ViewConfigDrawer 的轻量目录态、单卡配置态切换、
// 卡片增删调序、KPI 图标/数字格式/前后缀，以及 6 类图型、二级分组、堆叠、Top N 与饼图互斥提示。

import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  type DashboardSelectedItem,
  DrawerDashboardPanel,
} from '../../src/components/DrawerDashboardPanel'
import { ViewConfigDrawer } from '../../src/components/ViewConfigDrawer'
import type { DashboardConfig, SmartColumn, WorkspaceView } from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = () => {}

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 110, isUniqueKey: true },
  { key: 'status', title: '项目状态', type: 'select', width: 110 },
  { key: 'region', title: '所属大区', type: 'select', width: 110 },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
  { key: 'progress', title: '进度', type: 'progress', width: 120 },
]

function buildSampleConfig(): DashboardConfig {
  return {
    kpis: [
      {
        id: 'kpi_1',
        title: '项目总数',
        field: '__count__',
        agg: 'count',
        accentColor: '#2563eb',
      },
      {
        id: 'kpi_2',
        title: '合同总额',
        field: 'amount',
        agg: 'sum',
        numberFormat: 'currency',
        accentColor: '#0f766e',
      },
    ],
    charts: [
      {
        id: 'chart_1',
        title: '状态金额分布',
        chartType: 'bar',
        dimensionField: 'status',
        measureField: 'amount',
        agg: 'sum',
      },
      {
        id: 'chart_2',
        title: '大区占比',
        chartType: 'pie',
        dimensionField: 'region',
        measureField: '',
        agg: 'count',
        donut: true,
      },
    ],
  }
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

function selectCustomOption(container: HTMLElement, ariaLabel: string, optionText: string) {
  const trigger = container.querySelector(
    `button[role="combobox"][aria-label="${ariaLabel}"]`,
  ) as HTMLButtonElement | null
  expect(trigger).not.toBeNull()
  act(() => {
    trigger!.click()
  })
  const option = Array.from(document.body.querySelectorAll('[role="option"]')).find((el) =>
    el.textContent?.includes(optionText),
  ) as HTMLButtonElement | undefined
  expect(option).toBeDefined()
  act(() => {
    option!.click()
  })
}

function setInputValueAndBlur(input: HTMLInputElement, value: string) {
  act(() => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => {
    input.blur()
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
})

describe('DrawerDashboardPanel 轻量目录与单卡配置切换', () => {
  test('未选中时展示目录态，支持增删、上下移调序、点击进入单卡表单与返回目录', () => {
    let latestConfig = buildSampleConfig()
    function Harness() {
      const [config, setConfig] = useState<DashboardConfig>(buildSampleConfig)
      return createElement(DrawerDashboardPanel, {
        columns: COLUMNS,
        config,
        onChangeConfig: (next) => {
          latestConfig = next
          setConfig(next)
        },
      })
    }

    const { container } = mountComponent(createElement(Harness))

    // 目录态可见，不存在单卡表单
    expect(container.querySelector('[data-dashboard-catalog="true"]')).not.toBeNull()
    expect(container.querySelector('[data-dashboard-editor]')).toBeNull()
    expect(container.querySelectorAll('[data-catalog-kpi-id]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-catalog-chart-id]')).toHaveLength(2)

    // 下移第一个 KPI 调序
    const moveDownKpiBtn = container.querySelector(
      'button[aria-label="下移指标卡 项目总数"]',
    ) as HTMLButtonElement
    act(() => {
      moveDownKpiBtn.click()
    })
    expect(latestConfig.kpis.map((k) => k.id)).toEqual(['kpi_2', 'kpi_1'])

    // 上移第二个图表调序
    const moveUpChartBtn = container.querySelector(
      'button[aria-label="上移图表 大区占比"]',
    ) as HTMLButtonElement
    act(() => {
      moveUpChartBtn.click()
    })
    expect(latestConfig.charts.map((c) => c.id)).toEqual(['chart_2', 'chart_1'])

    // 新增 KPI 与图表
    const addKpiBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加指标卡'),
    )!
    act(() => {
      addKpiBtn.click()
    })
    expect(latestConfig.kpis).toHaveLength(3)

    const addChartBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('添加图表'),
    )!
    act(() => {
      addChartBtn.click()
    })
    expect(latestConfig.charts).toHaveLength(3)

    // 点击目录项切入单卡表单
    const enterKpiBtn = container.querySelector(
      'button[aria-label="配置指标卡 合同总额"]',
    ) as HTMLButtonElement
    act(() => {
      enterKpiBtn.click()
    })
    expect(container.querySelector('[data-dashboard-catalog="true"]')).toBeNull()
    expect(
      container.querySelector('[data-dashboard-editor="kpi"][data-kpi-id="kpi_2"]'),
    ).not.toBeNull()

    // 点击返回目录回到目录态
    const backBtn = container.querySelector('button[aria-label="返回目录"]') as HTMLButtonElement
    act(() => {
      backBtn.click()
    })
    expect(container.querySelector('[data-dashboard-catalog="true"]')).not.toBeNull()
    expect(container.querySelector('[data-dashboard-editor]')).toBeNull()

    // 快捷删除图表
    const delChartBtn = container.querySelector(
      'button[aria-label="删除图表 大区占比"]',
    ) as HTMLButtonElement
    act(() => {
      delChartBtn.click()
    })
    expect(latestConfig.charts.some((c) => c.id === 'chart_2')).toBe(false)
  })

  test('选中不存在的卡片 ID 时安全回退目录态，且单卡态仅渲染当前选中卡', () => {
    const config = buildSampleConfig()
    const handle = mountComponent(
      createElement(DrawerDashboardPanel, {
        columns: COLUMNS,
        config,
        selectedItem: { kind: 'chart', id: 'not_exists' },
        onChangeConfig: noop,
      }),
    )

    expect(handle.container.querySelector('[data-dashboard-catalog="true"]')).not.toBeNull()
    expect(handle.container.querySelector('[data-dashboard-editor]')).toBeNull()

    handle.rerender(
      createElement(DrawerDashboardPanel, {
        columns: COLUMNS,
        config,
        selectedItem: { kind: 'kpi', id: 'kpi_1' },
        onChangeConfig: noop,
      }),
    )
    expect(handle.container.querySelectorAll('[data-dashboard-editor]')).toHaveLength(1)
    expect(
      handle.container.querySelector('[data-dashboard-editor="kpi"][data-kpi-id="kpi_1"]'),
    ).not.toBeNull()
    expect(handle.container.textContent).not.toContain('状态金额分布')
  })
})

describe('DrawerDashboardPanel KPI 与图表单卡进阶配置', () => {
  test('KPI 单卡支持修改 icon、numberFormat、prefix 与 suffix 并触发 onChangeConfig', () => {
    let latestConfig = buildSampleConfig()
    function Harness() {
      const [config, setConfig] = useState<DashboardConfig>(buildSampleConfig)
      return createElement(DrawerDashboardPanel, {
        columns: COLUMNS,
        config,
        selectedItem: { kind: 'kpi', id: 'kpi_2' },
        onChangeConfig: (next) => {
          latestConfig = next
          setConfig(next)
        },
      })
    }

    const { container } = mountComponent(createElement(Harness))

    // 修改图标为 trending
    const trendingIconBtn = container.querySelector(
      'button[data-kpi-icon="trending"]',
    ) as HTMLButtonElement
    act(() => {
      trendingIconBtn.click()
    })
    expect(latestConfig.kpis[1]?.icon).toBe('trending')

    // 修改数字格式为百分比，再改回跟随列设置
    selectCustomOption(container, '数字格式', '百分比')
    expect(latestConfig.kpis[1]?.numberFormat).toBe('percent')

    selectCustomOption(container, '数字格式', '跟随列设置')
    expect(latestConfig.kpis[1]?.numberFormat).toBeUndefined()

    // 修改小数位数为 3 位，再改回默认（自动）清除该字段
    selectCustomOption(container, '小数位数', '3 位')
    expect(latestConfig.kpis[1]?.decimalPlaces).toBe(3)

    selectCustomOption(container, '小数位数', '默认（自动）')
    expect(latestConfig.kpis[1]?.decimalPlaces).toBeUndefined()

    // 修改前缀与后缀
    const prefixInput = container.querySelector('input[aria-label="数值前缀"]') as HTMLInputElement
    setInputValueAndBlur(prefixInput, '约 ')
    expect(latestConfig.kpis[1]?.prefix).toBe('约 ')

    const suffixInput = container.querySelector('input[aria-label="数值后缀"]') as HTMLInputElement
    setInputValueAndBlur(suffixInput, '元')
    expect(latestConfig.kpis[1]?.suffix).toBe('元')
  })

  test('图表单卡支持 6 类图型切换、seriesField / stacked / limit（Top N），切到 pie 禁用二级分组并显示说明', () => {
    let latestConfig = buildSampleConfig()
    function Harness() {
      const [config, setConfig] = useState<DashboardConfig>(buildSampleConfig)
      return createElement(DrawerDashboardPanel, {
        columns: COLUMNS,
        config,
        selectedItem: { kind: 'chart', id: 'chart_1' },
        onChangeConfig: (next) => {
          latestConfig = next
          setConfig(next)
        },
      })
    }

    const { container } = mountComponent(createElement(Harness))

    // 打开图表类型下拉验证 6 种图型均可选，并逐一验证切换
    const chartTypeTrigger = container.querySelector(
      'button[role="combobox"][aria-label="图表类型"]',
    ) as HTMLButtonElement
    act(() => {
      chartTypeTrigger.click()
    })
    const chartTypeLabels = Array.from(document.body.querySelectorAll('[role="option"]')).map(
      (el) => el.textContent,
    )
    expect(chartTypeLabels).toEqual([
      '柱状图',
      '横向条形图',
      '折线图',
      '面积图',
      '饼图 / 环形图',
      '雷达图',
    ])
    // 关闭当前菜单
    act(() => {
      chartTypeTrigger.click()
    })

    // 未选二级分组时，堆叠按钮应禁用
    const stackBtnBefore = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '堆叠',
    ) as HTMLButtonElement
    expect(stackBtnBefore.disabled).toBe(true)

    // 选择二级分组维度：所属大区
    selectCustomOption(container, '二级分组维度', '所属大区')
    expect(latestConfig.charts[0]?.seriesField).toBe('region')

    // 选择二级分组后，切换为堆叠
    const stackBtnAfter = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '堆叠',
    ) as HTMLButtonElement
    expect(stackBtnAfter.disabled).toBe(false)
    act(() => {
      stackBtnAfter.click()
    })
    expect(latestConfig.charts[0]?.stacked).toBe(true)

    // 切换为横向条形图依然支持堆叠并保留配置
    selectCustomOption(container, '图表类型', '横向条形图')
    expect(latestConfig.charts[0]?.chartType).toBe('horizontalBar')
    expect(latestConfig.charts[0]?.stacked).toBe(true)

    // 切换折线图、面积图、雷达图
    selectCustomOption(container, '图表类型', '折线图')
    expect(latestConfig.charts[0]?.chartType).toBe('line')

    selectCustomOption(container, '图表类型', '面积图')
    expect(latestConfig.charts[0]?.chartType).toBe('area')

    selectCustomOption(container, '图表类型', '雷达图')
    expect(latestConfig.charts[0]?.chartType).toBe('radar')

    // 设置展示上限 Top N = 5，再清空取消截断
    const limitInput = container.querySelector('input[aria-label="展示上限"]') as HTMLInputElement
    setInputValueAndBlur(limitInput, '5')
    expect(latestConfig.charts[0]?.limit).toBe(5)

    setInputValueAndBlur(limitInput, '')
    expect(latestConfig.charts[0]?.limit).toBeUndefined()

    // 切换为饼图 / 环形图：禁用二级分组并显示不支持提示，同时露出环形开关
    selectCustomOption(container, '图表类型', '饼图 / 环形图')
    expect(latestConfig.charts[0]?.chartType).toBe('pie')
    const seriesTriggerOnPie = container.querySelector(
      'button[role="combobox"][aria-label="二级分组维度"]',
    ) as HTMLButtonElement
    expect(seriesTriggerOnPie.disabled).toBe(true)
    expect(container.querySelector('[role="note"]')?.textContent).toContain('不支持二级分组')
    expect(container.querySelector('input[aria-label="环形图"]')).not.toBeNull()
  })

  test('ViewConfigDrawer 支持透传 selectedDashboardItem 与 onSelectDashboardItem', () => {
    const onSelectDashboardItem = vi.fn<(item: DashboardSelectedItem | null) => void>()
    const view: WorkspaceView = {
      id: 'v_dash',
      appId: 'app_1',
      tableId: 'tbl_1',
      name: '经营仪表盘',
      type: 'dashboard',
      sortOrder: 0,
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: [],
      sortRules: [],
      dashboardConfig: buildSampleConfig(),
    }

    const { container } = mountComponent(
      createElement(ViewConfigDrawer, {
        open: true,
        activeTab: 'dashboard',
        view,
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
        selectedDashboardItem: { kind: 'chart', id: 'chart_1' },
        onSelectDashboardItem,
        onTabChange: noop,
        onClose: noop,
        onUpdateView: noop,
        onOpenAddColumn: noop,
        onOpenColumnManager: noop,
        onOpenLookupWizard: noop,
        onExpandAllPivot: noop,
        onCollapseAllPivot: noop,
      }),
    )

    expect(
      container.querySelector('[data-dashboard-editor="chart"][data-chart-id="chart_1"]'),
    ).not.toBeNull()
    const backBtn = container.querySelector('button[aria-label="返回目录"]') as HTMLButtonElement
    act(() => {
      backBtn.click()
    })
    expect(onSelectDashboardItem).toHaveBeenCalledWith(null)
  })
})
