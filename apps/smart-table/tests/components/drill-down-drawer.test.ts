// @vitest-environment happy-dom

// DrillDownDrawer 定位与交互回归测试：
// 覆盖宿主容器定位上下文（relative）与弹性高度约束（min-h-0）、ListTable Canvas 严格挂载在抽屉容器内、
// Tab 切换销毁/重挂无残留、ResizeObserver 尺寸同步、多轮下钻与面包屑回退更新，以及 Esc/关闭生命周期。

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { PivotCellDrillEvent } from '@infinitable/pivot'
import { SmartGridAdapter } from '../../src/canvas/smart-grid'
import { DrillDownDrawer } from '../../src/components/DrillDownDrawer'
import type {
  LookupConflictInfo,
  SmartColumn,
  SmartPivotConfig,
  SmartRecord,
} from '../../src/shared/schema'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 110, isUniqueKey: true },
  { key: 'dept', title: '部门', type: 'select', width: 110 },
  { key: 'status', title: '状态', type: 'select', width: 110 },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
]

const RECORDS: SmartRecord[] = [
  { _id: 'r1', code: 'PRJ-1', dept: '研发部', status: '进行中', amount: 1000 },
  { _id: 'r2', code: 'PRJ-2', dept: '研发部', status: '已交付', amount: 2000 },
  { _id: 'r3', code: 'PRJ-3', dept: '销售部', status: '进行中', amount: 500 },
]

const PIVOT_CONFIG: SmartPivotConfig = {
  rowDimensions: [],
  columnDimensions: [],
  measures: [{ key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 }],
  showGrandTotal: true,
  collapsible: true,
}

const DRILL_EVENT: PivotCellDrillEvent = {
  col: 0,
  row: 0,
  records: RECORDS,
}

const EMPTY_CONFLICTS = new Map<string, Map<string, LookupConflictInfo>>()

const mountedRoots: Array<{ unmount: () => void; container: HTMLElement }> = []

function mountDrawer(overrides?: Partial<React.ComponentProps<typeof DrillDownDrawer>>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const defaultProps: React.ComponentProps<typeof DrillDownDrawer> = {
    drillEvent: DRILL_EVENT,
    columns: COLUMNS,
    allComputedRecords: RECORDS,
    conflictsByRow: EMPTY_CONFLICTS,
    pivotConfig: PIVOT_CONFIG,
    onClose: vi.fn<() => void>(),
    onUpdateRecord: vi.fn<(recordId: string, patch: Record<string, unknown>) => Promise<void>>(
      async () => {},
    ),
    ...overrides,
  }
  act(() => {
    root.render(createElement(DrillDownDrawer, defaultProps))
  })
  const handle = {
    container,
    rerender: (nextProps?: Partial<React.ComponentProps<typeof DrillDownDrawer>>) => {
      act(() => {
        root.render(createElement(DrillDownDrawer, { ...defaultProps, ...nextProps }))
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

function getCanvasHost(dialog: Element): HTMLElement {
  const canvases = Array.from(dialog.querySelectorAll('canvas'))
  expect(canvases.length).toBeGreaterThanOrEqual(2)
  const host = canvases[0]!.parentElement
  expect(host).not.toBeNull()
  for (const canvas of canvases) {
    expect(canvas.parentElement).toBe(host)
  }
  return host!
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  while (mountedRoots.length > 0) {
    mountedRoots.pop()!.unmount()
  }
})

describe('DrillDownDrawer 定位包含块与下钻交互回归', () => {
  test('明细数据 Tab 宿主容器具备 relative + min-h-0 约束且 Canvas 严格位于抽屉网格容器内', () => {
    let observedWidth = 680
    let observedHeight = 420
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => observedWidth)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => observedHeight)

    const roCallbacks: ResizeObserverCallback[] = []
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        roCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const { container } = mountDrawer()
    const overlay = container.firstElementChild as HTMLElement
    const dialog = container.querySelector('[role="dialog"][aria-label="透视下钻抽屉"]')!
    expect(dialog).not.toBeNull()

    // 校验外层弹性内容区具备 min-h-0 与 flex-1
    const flexBody = dialog.children[2] as HTMLElement
    expect(flexBody.className).toContain('min-h-0')
    expect(flexBody.className).toContain('flex-1')

    // 校验内层细节列容器具备 min-h-0
    const detailWrapper = flexBody.firstElementChild as HTMLElement
    expect(detailWrapper.className).toContain('min-h-0')

    // 校验 Canvas 宿主容器严格位于抽屉内部，且非遮罩直属节点
    const host = getCanvasHost(dialog)
    expect(host.parentElement).toBe(detailWrapper)
    expect(Array.from(overlay.children).some((el) => el.tagName === 'CANVAS')).toBe(false)

    // 校验定位上下文与弹性约束
    expect(host.className).toContain('relative')
    expect(host.className).toContain('min-h-0')
    expect(host.className).toContain('flex-1')
    expect(getComputedStyle(host).position).toBe('relative')

    // 校验 Canvas 绝对定位与初始同步尺寸
    const canvases = Array.from(host.querySelectorAll('canvas'))
    for (const canvas of canvases) {
      expect(canvas.style.position).toBe('absolute')
      expect(canvas.style.left).toBe('0px')
      expect(canvas.style.top).toBe('0px')
      expect(canvas.style.width).toBe('680px')
      expect(canvas.style.height).toBe('420px')
    }

    // 触发 ResizeObserver 尺寸变更，验证画布宽高同步跟随
    observedWidth = 740
    observedHeight = 510
    act(() => {
      roCallbacks[0]?.([], {} as ResizeObserver)
    })
    for (const canvas of canvases) {
      expect(canvas.style.width).toBe('740px')
      expect(canvas.style.height).toBe('510px')
    }
  })

  test('Tab 切换销毁/重挂无残留旧实例，多轮下钻与面包屑回退同步刷新明细网格', () => {
    let observedWidth = 640
    let observedHeight = 400
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => observedWidth)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => observedHeight)

    const { container } = mountDrawer()
    const dialog = container.querySelector('[role="dialog"][aria-label="透视下钻抽屉"]')!

    const initialHost = getCanvasHost(dialog)
    const initialCanvases = Array.from(initialHost.querySelectorAll('canvas'))
    expect(dialog.textContent).toContain('明细数据（3 条）')

    // 切换到「按下一维度下钻」Tab：旧画布与容器销毁，无残留 canvas
    const dimTabBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('按下一维度下钻'),
    )!
    act(() => {
      dimTabBtn.click()
    })
    expect(dialog.querySelectorAll('canvas')).toHaveLength(0)

    // 第一轮下钻：选择「部门」维度 -> 研发部（2 条）
    const deptDimPill = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === '部门',
    )!
    act(() => {
      deptDimPill.click()
    })
    const devGroupBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('研发部'),
    )!
    act(() => {
      devGroupBtn.click()
    })
    expect(dialog.textContent).toContain('部门: 研发部')
    expect(dialog.textContent).toContain('明细数据（2 条）')

    // 第二轮下钻：选择「状态」维度 -> 进行中（1 条）
    const statusDimPill = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === '状态',
    )!
    act(() => {
      statusDimPill.click()
    })
    const inProgressBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('进行中'),
    )!
    act(() => {
      inProgressBtn.click()
    })
    expect(dialog.textContent).toContain('状态: 进行中')
    expect(dialog.textContent).toContain('明细数据（1 条）')

    // 切换回「明细数据」Tab：重新挂载在新的宿主容器内，无残留旧画布
    observedWidth = 700
    observedHeight = 460
    const detailTabBtn = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('明细数据'),
    )!
    act(() => {
      detailTabBtn.click()
    })

    const remountedHost = getCanvasHost(dialog)
    expect(remountedHost).not.toBe(initialHost)
    const remountedCanvases = Array.from(remountedHost.querySelectorAll('canvas'))
    expect(remountedCanvases).toHaveLength(initialCanvases.length)
    for (const canvas of remountedCanvases) {
      expect(initialCanvases).not.toContain(canvas)
      expect(canvas.style.width).toBe('700px')
      expect(canvas.style.height).toBe('460px')
    }

    // 在「明细数据」Tab 点击面包屑逐层回退：先回退到「部门: 研发部」（2 条）
    const setDataSpy = vi.spyOn(SmartGridAdapter.prototype, 'setData')
    const deptBreadcrumb = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('部门: 研发部'),
    )!
    act(() => {
      deptBreadcrumb.click()
    })
    expect(dialog.textContent).toContain('明细数据（2 条）')
    expect(dialog.textContent).not.toContain('状态: 进行中')
    expect(getCanvasHost(dialog)).toBe(remountedHost)
    expect(remountedHost.querySelectorAll('canvas')).toHaveLength(remountedCanvases.length)
    expect(setDataSpy).toHaveBeenCalledTimes(1)
    expect(setDataSpy.mock.calls[0]?.[1]).toHaveLength(2)

    // 再点击根面包屑回退到「汇总格 (3 条)」
    const rootBreadcrumb = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('汇总格 (3 条)'),
    )!
    act(() => {
      rootBreadcrumb.click()
    })
    expect(dialog.textContent).toContain('明细数据（3 条）')
    expect(dialog.textContent).not.toContain('部门: 研发部')
    expect(getCanvasHost(dialog)).toBe(remountedHost)
    expect(remountedHost.querySelectorAll('canvas')).toHaveLength(remountedCanvases.length)
    expect(setDataSpy).toHaveBeenCalledTimes(2)
    expect(setDataSpy.mock.calls[1]?.[1]).toHaveLength(3)
  })

  test('有叠加浮层时 Esc 不关闭抽屉，无叠加浮层时 Esc 与关闭按钮正常触发 onClose', () => {
    const onClose = vi.fn<() => void>()
    const { container, rerender } = mountDrawer({ hasActiveOverlay: true, onClose })

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).not.toHaveBeenCalled()

    rerender({ hasActiveOverlay: false, onClose })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    const closeBtn = container.querySelector(
      'button[aria-label="关闭下钻抽屉"]',
    ) as HTMLButtonElement
    act(() => {
      closeBtn.click()
    })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  test('下钻分组拆解遵循 measure.decimalPlaces 优先、未设回退列配置及统一百分比格式', () => {
    const decimalCols: SmartColumn[] = [
      ...COLUMNS.slice(0, 3),
      {
        key: 'amount',
        title: '合同金额',
        type: 'number',
        width: 120,
        numberFormat: 'currency',
        decimalPlaces: 2,
      },
    ]
    const decimalRecords: SmartRecord[] = [
      { _id: 'r1', code: 'P-1', dept: '研发部', status: '进行中', amount: 100.1 },
      { _id: 'r2', code: 'P-2', dept: '销售部', status: '进行中', amount: 200.2 },
    ]
    const { container } = mountDrawer({
      columns: decimalCols,
      allComputedRecords: decimalRecords,
      drillEvent: {
        col: 0,
        row: 0,
        records: decimalRecords,
      },
      pivotConfig: {
        rowDimensions: ['dept'],
        columnDimensions: ['status'],
        measures: [
          {
            key: 'amount',
            title: '合同金额',
            field: 'amount',
            agg: 'sum',
            width: 120,
            decimalPlaces: 3,
          },
        ],
        showGrandTotal: true,
      },
    })

    const dialog = container.querySelector('[role="dialog"]')!
    const breakdownTab = Array.from(dialog.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('按下一维度下钻'),
    )!
    act(() => {
      breakdownTab.click()
    })
    expect(dialog.textContent).toContain('合同金额: ¥200.200')
    expect(dialog.textContent).toContain('(66.7%)')
    expect(dialog.textContent).toContain('合同金额: ¥100.100')
    expect(dialog.textContent).toContain('(33.3%)')
  })
})
