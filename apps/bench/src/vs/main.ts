// vs 页面入口：串行跑 infinite-table 与 @visactor/vtable 的同口径场景，
// 渲染逐指标倍数对比到页面，并挂 window.__VS_REPORT__（JSON）供驱动脚本提取。

import { oursLibrary, vtableLibrary } from './adapters'
import { buildComparisonReport, renderReportHtml } from './report'
import { runComparison } from './scenarios'
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '../dataset'

declare global {
  interface Window {
    __VS_REPORT__?: unknown
  }
}

async function main(): Promise<void> {
  const reportHost = document.querySelector<HTMLDivElement>('#report')
  const container = document.querySelector<HTMLDivElement>('#table-host')
  if (!reportHost || !container) {
    throw new Error('vs.html 缺少 #report / #table-host 挂载点')
  }
  container.style.width = `${VIEWPORT_WIDTH}px`
  container.style.height = `${VIEWPORT_HEIGHT}px`
  const run = await runComparison(container, [oursLibrary, vtableLibrary])
  const report = buildComparisonReport(run)
  reportHost.innerHTML = renderReportHtml(report)
  window.__VS_REPORT__ = report
  container.innerHTML = ''
}

main().catch((error: unknown) => {
  console.error(error)
  const reportHost = document.querySelector<HTMLDivElement>('#report')
  if (reportHost) {
    reportHost.textContent = `对比运行失败：${String(error)}`
  }
})
