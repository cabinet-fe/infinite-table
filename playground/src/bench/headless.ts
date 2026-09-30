// headless 运行环境桥：注入假画布 + 手动帧泵 + 假事件源，无浏览器跑同一套场景逻辑；
// dev 条件对齐 vite（仓内应用走 workspace 源码，不吃 dist 旧产物）。
// 由 headless.test.ts 驱动（vp test run）：阈值不达标即测试失败，报告 JSON 落档 results/。
// headless 数字只含 JS 侧成本（无真实栅格化），真实 TTFF/FPS 以浏览器入口为准，两者共用场景代码。

import type { DataRecord } from '@infinitable/core'
import { ListTable } from '@infinitable/core'
import { createChartPlugin } from '@infinitable/plugins'
import {
  createRenderHost,
  type RenderCanvas,
  type RenderContext,
  type RenderHost,
} from '@infinitable/render'

import {
  createBenchColumns,
  createSheetColumns,
  createBenchRecords,
  VIEWPORT_AREA,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from './dataset'
import { chartTableOptions, resolveChartCellDeclaration } from './chart-scenarios'
import type { BenchEnv, BenchTable } from './env'
import { ChartFakeCanvas } from './fake-chart-canvas'
import { InvalidationMeter } from './invalidation-meter'

type FakeDomListener = (event: { clientX?: number; clientY?: number }) => void

/** 假事件源：满足 RenderHostOptions.eventsTarget 结构，headless 下手工派发 pointermove */
class FakeEventTarget {
  private readonly listeners = new Map<string, FakeDomListener[]>()

  addEventListener(type: string, listener: FakeDomListener): void {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, listener: FakeDomListener): void {
    const list = this.listeners.get(type)
    if (list) {
      this.listeners.set(
        type,
        list.filter((item) => item !== listener),
      )
    }
  }

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 }
  }

  dispatch(type: string, event: { clientX?: number; clientY?: number }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

/** 空 2d 上下文：保留 RenderContext 调用面，绘制为 no-op（headless 不测栅格化成本） */
class NoopContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''

  save(): void {}
  restore(): void {}
  setTransform(): void {}
  translate(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {}
  clearRect(): void {}
  fillRect(): void {}
  fillText(): void {}
  drawImage(): void {}
  measureText(text: string): {
    width: number
    actualBoundingBoxAscent: number
    actualBoundingBoxDescent: number
  } {
    return { width: text.length * 7, actualBoundingBoxAscent: 9, actualBoundingBoxDescent: 3 }
  }
}

class NoopCanvas implements RenderCanvas {
  width = 0
  height = 0
  private readonly context = new NoopContext()

  getContext(): RenderContext | null {
    return this.context
  }
}

/** headless 帧泵桥：BenchTable 交互面（手动帧泵 + 假事件源派发），各建表工厂共用 */
function benchTableBridge(
  table: ListTable,
  meter: InvalidationMeter,
  constructorMs: number,
  scheduled: Array<() => void>,
  eventsTarget: FakeEventTarget,
  host: RenderHost,
): BenchTable {
  return {
    table,
    meter,
    constructorMs,
    beginFrame: () => Promise.resolve(),
    endFrame: () => {
      while (scheduled.length > 0) {
        scheduled.shift()!()
      }
    },
    pointerMoveAt: (x, y) => eventsTarget.dispatch('pointermove', { clientX: x, clientY: y }),
    destroy: () => {
      table.destroy()
      host.destroy()
    },
  }
}

/** headless 渲染宿主：假画布 + 排期数组帧泵（beginFrame 立即返回，endFrame 同步跑掉帧任务） */
function createHeadlessHost(): {
  host: RenderHost
  scheduled: Array<() => void>
  eventsTarget: FakeEventTarget
} {
  const scheduled: Array<() => void> = []
  const eventsTarget = new FakeEventTarget()
  const host = createRenderHost({
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    createCanvas: () => new NoopCanvas(),
    scheduleFrame: (callback) => {
      scheduled.push(callback)
      return scheduled.length
    },
    cancelFrame: () => {},
    eventsTarget,
  })
  return { host, scheduled, eventsTarget }
}

/** headless 环境工厂：node/bun 直跑（无真实 DOM 与栅格化），供 headless.test.ts 驱动全部场景 */
export function createHeadlessEnv(): BenchEnv {
  let records: DataRecord[] | null = null
  return {
    name: `headless (bun ${process.versions.bun ?? process.version}, ${process.platform}/${process.arch})`,
    createTable() {
      records ??= createBenchRecords()
      const { host, scheduled, eventsTarget } = createHeadlessHost()
      const meter = new InvalidationMeter(VIEWPORT_AREA)
      const t0 = performance.now()
      const table = new ListTable({
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        columns: createBenchColumns(),
        records,
        host: meter.wrap(host),
      })
      const constructorMs = performance.now() - t0
      return benchTableBridge(table, meter, constructorMs, scheduled, eventsTarget, host)
    },
    createSheetTable(store) {
      const { host, scheduled, eventsTarget } = createHeadlessHost()
      const meter = new InvalidationMeter(VIEWPORT_AREA)
      const t0 = performance.now()
      const table = new ListTable({
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        columns: createSheetColumns(),
        model: store.asModel(),
        host: meter.wrap(host),
      })
      const constructorMs = performance.now() - t0
      return benchTableBridge(table, meter, constructorMs, scheduled, eventsTarget, host)
    },
    createChartTable() {
      const { host, scheduled, eventsTarget } = createHeadlessHost()
      const meter = new InvalidationMeter(VIEWPORT_AREA)
      // Chart.js 离屏出图打在按最小绘制需求扩展的假画布上（无栅格化，只走 JS 侧出图通路）
      const chartPlugin = createChartPlugin({
        resolveCellChart: resolveChartCellDeclaration,
        createCanvas: () => new ChartFakeCanvas().asCanvas(),
      })
      const t0 = performance.now()
      const table = new ListTable(chartTableOptions(meter.wrap(host), [chartPlugin]))
      const constructorMs = performance.now() - t0
      return benchTableBridge(table, meter, constructorMs, scheduled, eventsTarget, host)
    },
  }
}
