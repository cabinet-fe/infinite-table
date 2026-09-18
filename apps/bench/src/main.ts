// 浏览器运行入口：真实 canvas + rAF 跑量化基准（真实 TTFF/FPS 口径以本入口为准），
// 报告渲染到页面、打到 console，并挂 window.__BENCH_REPORT__ 供脚本化冒烟提取。

import { ListTable, type DataRecord } from '@infinite-table/core'
import { createRenderHost } from '@infinite-table/render'

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
import { formatTextReport, type BenchReport } from './report'
import { runAllScenarios } from './scenarios'

declare global {
  interface Window {
    __BENCH_REPORT__?: BenchReport
  }
}

function createBrowserEnv(container: HTMLElement): BenchEnv {
  let records: DataRecord[] | null = null
  return {
    name: `browser (${navigator.userAgent})`,
    createTable() {
      records ??= createBenchRecords()
      const meter = new InvalidationMeter(VIEWPORT_AREA)
      const host = createRenderHost({
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        container,
      })
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
        beginFrame: () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve())
          }),
        endFrame: () => {},
        hoverAt: (x, y) => {
          const rect = container.getBoundingClientRect()
          container.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: rect.left + x,
              clientY: rect.top + y,
              bubbles: true,
            }),
          )
        },
        destroy: () => {
          table.destroy()
          host.destroy()
        },
      }
    },
    createSheetTable(store) {
      const meter = new InvalidationMeter(VIEWPORT_AREA)
      const host = createRenderHost({
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        container,
      })
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
        beginFrame: () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => resolve())
          }),
        endFrame: () => {},
        hoverAt: (x, y) => {
          const rect = container.getBoundingClientRect()
          container.dispatchEvent(
            new PointerEvent('pointermove', {
              clientX: rect.left + x,
              clientY: rect.top + y,
            }),
          )
        },
        destroy: () => {
          table.destroy()
          host.destroy()
        },
      }
    },
  }
}

async function main(): Promise<void> {
  const reportEl = document.querySelector<HTMLPreElement>('#report')
  const container = document.querySelector<HTMLDivElement>('#table-host')
  if (!reportEl || !container) {
    throw new Error('index.html 缺少 #report / #table-host 挂载点')
  }
  container.style.width = `${VIEWPORT_WIDTH}px`
  container.style.height = `${VIEWPORT_HEIGHT}px`
  const report = await runAllScenarios(createBrowserEnv(container))
  const text = formatTextReport(report)
  reportEl.textContent = text
  console.log(text)
  window.__BENCH_REPORT__ = report
}

main().catch((error: unknown) => {
  console.error(error)
  const reportEl = document.querySelector<HTMLPreElement>('#report')
  if (reportEl) {
    reportEl.textContent = `基准运行失败：${String(error)}`
  }
})
