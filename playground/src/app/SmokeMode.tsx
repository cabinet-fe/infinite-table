// ?smoke=1 冒烟自动化模式（对齐旧 App.vue 行为，dpr 锁 1 由 mount.ts 既有逻辑承担）：
// 挂全量演示区（八区 + sheet + report），写 __DEMO__ / __SHEET_DEMO__ / __REPORT_DEMO__ 句柄，
// runSmoke 写 window.__SMOKE__ 供 scripts/smoke.mjs 轮询（异常也写失败信号，裸 void 会让超时方无从分辨挂错与卡死）。

import { FlaskConical } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { mountChart } from '../sections/chart'
import { mountDataForms } from '../sections/data-forms'
import { mountDisplay } from '../sections/display'
import { mountEditing } from '../sections/editing'
import { mountInteraction } from '../sections/interaction'
import { mountMedia } from '../sections/media'
import { mountPrint } from '../sections/print'
import { createReportHandle, mountReport } from '../sections/report'
import { createSheetHandle, mountSheet } from '../sections/sheet'
import { mountWatermark } from '../sections/watermark'
import { runSmoke } from '../smoke'
import type { DemoHandles } from './types'

export function SmokeMode() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mountPoint = mountRef.current
    if (!mountPoint) return

    const demos: DemoHandles = {
      dataForms: mountDataForms(mountPoint),
      display: mountDisplay(mountPoint),
      interaction: mountInteraction(mountPoint),
      media: mountMedia(mountPoint),
      chart: mountChart(mountPoint),
      watermark: mountWatermark(mountPoint),
      print: mountPrint(mountPoint),
      editing: mountEditing(mountPoint),
    }
    window.__DEMO__ = demos
    // sheet 区：插件之上的完整 sheet 面（句柄供 checkSheet 断言）
    const sheetDemo = mountSheet(mountPoint)
    window.__SHEET_DEMO__ = createSheetHandle(sheetDemo)
    // 报表区：快照灌入 + readonly 渲染（句柄供 checkReport 断言）
    const reportDemo = mountReport(mountPoint)
    window.__REPORT_DEMO__ = createReportHandle(reportDemo)
    void runSmoke(demos).catch((error) => {
      window.__SMOKE__ = {
        done: true,
        pass: false,
        total: 1,
        failures: [`runSmoke 异常：${error instanceof Error ? error.stack : String(error)}`],
      }
      document.title = 'SMOKE FAIL'
    })
  }, [])

  return (
    <div className="smoke-mode-container h-screen overflow-y-auto p-6">
      <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <FlaskConical className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">冒烟自动化测试进行中（?smoke=1）</h2>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          正在后台执行全量像素与交互自检断言，结果将写入 window.__SMOKE__ …
        </p>
      </div>
      <div ref={mountRef} />
    </div>
  )
}
