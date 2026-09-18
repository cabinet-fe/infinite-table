// headless 运行入口（bun src/headless.ts）：注入假画布 + 手动帧泵 + 假事件源，
// 无浏览器跑同一套场景逻辑；输出可读报告并把 JSON 落档 results/（防回归基线），未达标非零退出。
// headless 数字只含 JS 侧成本（无真实栅格化），真实 TTFF/FPS 以浏览器入口为准，两者共用场景代码。

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ListTable, type DataRecord } from '@infinite-table/core'
import { createRenderHost, type RenderCanvas, type RenderContext } from '@infinite-table/render'

import {
  createBenchColumns,
  createSheetColumns,
  createBenchRecords,
  VIEWPORT_AREA,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from './dataset'
import type { BenchEnv } from './env'
import { InvalidationMeter } from './invalidation-meter'
import { formatTextReport } from './report'
import { runAllScenarios } from './scenarios'

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

function createHeadlessEnv(): BenchEnv {
  let records: DataRecord[] | null = null
  return {
    name: `headless (bun ${process.versions.bun ?? process.version}, ${process.platform}/${process.arch})`,
    createTable() {
      records ??= createBenchRecords()
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
        hoverAt: (x, y) => eventsTarget.dispatch('pointermove', { clientX: x, clientY: y }),
        destroy: () => {
          table.destroy()
          host.destroy()
        },
      }
    },
    createSheetTable(store) {
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
        hoverAt: (x, y) => eventsTarget.dispatch('pointermove', { clientX: x, clientY: y }),
        destroy: () => {
          table.destroy()
          host.destroy()
        },
      }
    },
  }
}

const report = await runAllScenarios(createHeadlessEnv())
console.log(formatTextReport(report))

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'results')
mkdirSync(resultsDir, { recursive: true })
const file = join(resultsDir, `bench-${report.startedAt.replaceAll(/[:.]/g, '-')}.json`)
writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
console.log(`报告已落档：${file}`)

process.exitCode = report.passed ? 0 : 1
