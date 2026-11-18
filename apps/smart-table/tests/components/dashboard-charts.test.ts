// @vitest-environment happy-dom

// Chart.js 仪表盘图表组件测试：覆盖 6 类图型映射、二级分组多系列（上限 8 / 饼图忽略）、
// 图例点击隔离（仅切换系列显隐不触发卡片选中）与卸载销毁生命周期。

import { Chart } from 'chart.js'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardChartBody } from '../../src/components/DashboardCharts'
import { computeDashboardChart, MAX_CHART_SERIES } from '../../src/domain/dashboard-engine'
import type { DashboardChartResult } from '../../src/domain/dashboard-engine'
import type { DashboardChartType, SmartColumn, SmartRecord } from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const COLUMNS: SmartColumn[] = [
  {
    key: 'region',
    title: '大区',
    type: 'select',
    width: 120,
    options: [
      { label: '华东', color: '#dbeafe', textColor: '#1d4ed8' },
      { label: '华北', color: '#dcfce7', textColor: '#15803d' },
      { label: '华南', color: '#fef3c7', textColor: '#b45309' },
    ],
  },
  {
    key: 'quarter',
    title: '季度',
    type: 'select',
    width: 100,
    options: [
      { label: 'Q1', color: '#e0e7ff', textColor: '#4338ca' },
      { label: 'Q2', color: '#fce7f3', textColor: '#be185d' },
    ],
  },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
]

const RECORDS: SmartRecord[] = [
  { _id: '1', region: '华东', quarter: 'Q1', amount: 120000 },
  { _id: '2', region: '华东', quarter: 'Q2', amount: 180000 },
  { _id: '3', region: '华北', quarter: 'Q1', amount: 90000 },
  { _id: '4', region: '华北', quarter: 'Q2', amount: 110000 },
  { _id: '5', region: '华南', quarter: 'Q1', amount: 70000 },
]

const mountedRoots: Array<{ unmount: () => void; container: HTMLElement }> = []

function createFakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => {}
  const ctx = {
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
    measureText: (text: string) => ({ width: Math.max(8, text.length * 7) }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  }
  return ctx as unknown as CanvasRenderingContext2D
}

function mountChart(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  const handle = {
    container,
    rerender: (next: React.ReactElement) => {
      act(() => {
        root.render(next)
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

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
    contextId: string,
  ) {
    if (contextId !== '2d') return null
    return createFakeContext(this)
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
})

afterEach(() => {
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
  vi.restoreAllMocks()
})

describe('DashboardChartBody (Chart.js)', () => {
  it('支持 6 种 chartType（含 pie 与 donut）并传递正确的 Chart.js 配置', () => {
    const renderOne = (chartType: DashboardChartType, donut?: boolean) => {
      const chart = computeDashboardChart(RECORDS, COLUMNS, {
        id: `c_${chartType}_${donut ? 'donut' : 'std'}`,
        title: chartType,
        chartType,
        dimensionField: 'region',
        measureField: 'amount',
        agg: 'sum',
        donut,
      })
      const { container } = mountChart(
        createElement(DashboardChartBody, {
          chart,
          dimensionCol: COLUMNS[0],
          measureCol: COLUMNS[2],
        }),
      )
      const canvas = container.querySelector('canvas')
      expect(canvas).not.toBeNull()
      expect(canvas?.getAttribute('role')).toBe('img')
      expect(container.querySelector('svg')).toBeNull()
      const instance = Chart.getChart(canvas!)
      expect(instance).toBeDefined()
      return { canvas: canvas!, instance: instance! }
    }

    const bar = renderOne('bar')
    expect(bar.canvas.getAttribute('aria-label')).toBe('柱状图')
    expect((bar.instance.config as { type: string }).type).toBe('bar')
    expect(bar.instance.options.indexAxis).toBe('x')

    const hbar = renderOne('horizontalBar')
    expect(hbar.canvas.getAttribute('aria-label')).toBe('横向条形图')
    expect((hbar.instance.config as { type: string }).type).toBe('bar')
    expect(hbar.instance.options.indexAxis).toBe('y')

    const line = renderOne('line')
    expect(line.canvas.getAttribute('aria-label')).toBe('折线图')
    expect((line.instance.config as { type: string }).type).toBe('line')
    expect((line.instance.data.datasets[0] as { fill?: boolean })?.fill).toBe(false)

    const area = renderOne('area')
    expect(area.canvas.getAttribute('aria-label')).toBe('面积图')
    expect((area.instance.config as { type: string }).type).toBe('line')
    expect((area.instance.data.datasets[0] as { fill?: boolean })?.fill).toBe(true)

    const pie = renderOne('pie', false)
    expect(pie.canvas.getAttribute('aria-label')).toBe('饼图')
    expect((pie.instance.config as { type: string }).type).toBe('pie')

    const donut = renderOne('pie', true)
    expect(donut.canvas.getAttribute('aria-label')).toBe('环形图')
    expect((donut.instance.config as { type: string }).type).toBe('doughnut')
    expect((donut.instance.options as { cutout?: string | number }).cutout).toBe('58%')
    expect(donut.instance.config.plugins?.some((p) => p.id === 'donutCenterText')).toBe(true)

    const radar = renderOne('radar')
    expect(radar.canvas.getAttribute('aria-label')).toBe('雷达图')
    expect((radar.instance.config as { type: string }).type).toBe('radar')
    expect((radar.instance.data.datasets[0] as { fill?: boolean })?.fill).toBe(true)
  })

  it('二级分组多系列（最多 8 系列）在 bar/horizontalBar/line/area/radar 下生成多条 dataset 并响应 stacked，在 pie 下按单系列渲染', () => {
    const manyRecords: SmartRecord[] = Array.from({ length: 10 }, (_, idx) => ({
      _id: `rec_${idx}`,
      region: idx % 2 === 0 ? '华东' : '华北',
      quarter: `S${idx + 1}`,
      amount: (idx + 1) * 1000,
    }))

    const mountMulti = (chartType: DashboardChartType, stacked?: boolean) => {
      const chart = computeDashboardChart(manyRecords, COLUMNS, {
        id: `multi_${chartType}_${String(stacked)}`,
        title: chartType,
        chartType,
        dimensionField: 'region',
        seriesField: 'quarter',
        measureField: 'amount',
        agg: 'sum',
        stacked,
      })
      const { container } = mountChart(
        createElement(DashboardChartBody, {
          chart,
          dimensionCol: COLUMNS[0],
          measureCol: COLUMNS[2],
          seriesCol: COLUMNS[1],
        }),
      )
      return Chart.getChart(container.querySelector('canvas')!)!
    }

    for (const stacked of [false, true]) {
      for (const barType of ['bar', 'horizontalBar'] as const) {
        const instance = mountMulti(barType, stacked)
        expect(instance.data.datasets).toHaveLength(MAX_CHART_SERIES)
        const scales = instance.options.scales as Record<string, { stacked?: boolean }>
        expect(scales.x?.stacked).toBe(stacked)
        expect(scales.y?.stacked).toBe(stacked)
      }
    }

    for (const nonBarType of ['line', 'area', 'radar'] as const) {
      const instance = mountMulti(nonBarType)
      expect(instance.data.datasets).toHaveLength(MAX_CHART_SERIES)
    }

    // pie 自动忽略二级分组按单系列输出
    const pieInstance = mountMulti('pie')
    expect(pieInstance.data.datasets).toHaveLength(1)
  })

  it('点击图例区域仅切换系列显隐而不触发卡片选中回调，点击非图例图表区域正常触发选中', async () => {
    const multiBar = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c_legend_bar',
      title: '季度对比',
      chartType: 'bar',
      dimensionField: 'region',
      seriesField: 'quarter',
      measureField: 'amount',
      agg: 'sum',
    })

    const onCardClick = vi.fn<() => void>()
    const onBodyClick = vi.fn<() => void>()

    const { container } = mountChart(
      createElement(
        'div',
        { onClick: onCardClick, 'data-testid': 'card-wrapper' },
        createElement(DashboardChartBody, {
          chart: multiBar,
          dimensionCol: COLUMNS[0],
          measureCol: COLUMNS[2],
          seriesCol: COLUMNS[1],
          onChartBodyClick: onBodyClick,
        }),
      ),
    )

    const canvas = container.querySelector('canvas')!
    const instance = Chart.getChart(canvas)!
    const legend = instance.legend as unknown as {
      legendHitBoxes: Array<{ left: number; top: number; width: number; height: number }>
    }
    expect(legend.legendHitBoxes.length).toBeGreaterThanOrEqual(2)
    expect(instance.isDatasetVisible(0)).toBe(true)

    const firstHitBox = legend.legendHitBoxes[0]!
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: firstHitBox.left + firstHitBox.width / 2,
          clientY: firstHitBox.top + firstHitBox.height / 2,
        }),
      )
    })

    expect(onCardClick).not.toHaveBeenCalled()
    expect(onBodyClick).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(instance.isDatasetVisible(0)).toBe(false)
    })

    // 点击图表主体（远离图例区域）应正常触发选中回调
    const plotX = (instance.chartArea.left + instance.chartArea.right) / 2
    const plotY = (instance.chartArea.top + instance.chartArea.bottom) / 2
    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: plotX,
          clientY: plotY,
        }),
      )
    })

    expect(onBodyClick).toHaveBeenCalledTimes(1)
    expect(onCardClick).toHaveBeenCalledTimes(1)
  })

  it('饼图点击图例切换扇区显隐且不触发外层卡片选中', async () => {
    const pieChart = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c_legend_pie',
      title: '饼图占比',
      chartType: 'pie',
      dimensionField: 'region',
      measureField: 'amount',
      agg: 'sum',
      donut: true,
    })

    const onCardClick = vi.fn<() => void>()
    const { container } = mountChart(
      createElement(
        'div',
        { onClick: onCardClick },
        createElement(DashboardChartBody, {
          chart: pieChart,
          dimensionCol: COLUMNS[0],
          measureCol: COLUMNS[2],
        }),
      ),
    )

    const canvas = container.querySelector('canvas')!
    const instance = Chart.getChart(canvas)!
    const legend = instance.legend as unknown as {
      legendHitBoxes: Array<{ left: number; top: number; width: number; height: number }>
    }
    const hitBox = legend.legendHitBoxes[0]!
    expect(instance.getDataVisibility(0)).toBe(true)

    act(() => {
      canvas.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: hitBox.left + hitBox.width / 2,
          clientY: hitBox.top + hitBox.height / 2,
        }),
      )
    })

    expect(onCardClick).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(instance.getDataVisibility(0)).toBe(false)
    })
  })

  it('无数据时显示空态占位且不创建 canvas；卸载时调用 Chart.destroy() 无报错', () => {
    const emptyChart: DashboardChartResult = {
      id: 'c_empty',
      title: '空图表',
      chartType: 'bar',
      dimensionField: 'region',
      measureField: 'amount',
      agg: 'sum',
      data: [],
      categories: [],
      totalValue: 0,
      totalRecords: 0,
    }

    const emptyHandle = mountChart(
      createElement(DashboardChartBody, {
        chart: emptyChart,
      }),
    )
    expect(emptyHandle.container.textContent).toContain('暂无满足当前筛选条件的数据')
    expect(emptyHandle.container.querySelector('canvas')).toBeNull()

    const barChart = computeDashboardChart(RECORDS, COLUMNS, {
      id: 'c_destroy',
      title: '销毁测试',
      chartType: 'bar',
      dimensionField: 'region',
      measureField: 'amount',
      agg: 'sum',
    })
    const destroySpy = vi.spyOn(Chart.prototype, 'destroy')
    const handle = mountChart(
      createElement(DashboardChartBody, {
        chart: barChart,
        dimensionCol: COLUMNS[0],
        measureCol: COLUMNS[2],
      }),
    )
    const canvas = handle.container.querySelector('canvas')!
    expect(Chart.getChart(canvas)).toBeDefined()

    handle.unmount()
    expect(destroySpy).toHaveBeenCalledTimes(1)
    expect(Chart.getChart(canvas)).toBeUndefined()
  })
})
