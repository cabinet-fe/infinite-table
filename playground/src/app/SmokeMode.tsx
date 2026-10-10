// ?smoke=1 冒烟自动化模式（dpr 锁 1 由 mount.ts 既有逻辑承担）：
// 挂全量演示区（八区 + report），写 __DEMO__ / __REPORT_DEMO__ 句柄，
// runSmoke 写 window.__SMOKE__ 供 scripts/smoke.mjs 轮询（异常也写失败信号，裸 void 会让超时方无从分辨挂错与卡死）。
// 演示区走 sections 的命令式引擎装配裸挂（无页面壳与控件面）。

import { FlaskConical } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { mountChart } from '../sections/chart'
import { mountDataForms } from '../sections/data-forms'
import { mountDisplay } from '../sections/display'
import { mountEditing } from '../sections/editing'
import { mountInteraction } from '../sections/interaction'
import { mountMedia } from '../sections/media'
import { mountNativeScroll } from '../sections/native-scroll'
import { mountPrint } from '../sections/print'
import { createReportHandle, mountReport } from '../sections/report'
import { mountWatermark } from '../sections/watermark'
import { installErrorSink, runSmoke } from '../smoke'
import type { DemoHandles } from './types'

export function SmokeMode() {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mountPoint = mountRef.current
    if (!mountPoint) return
    // 控制台错误采集最先装上：挂载期异常也计入（runSmoke 收尾断言「无控制台错误」）
    installErrorSink()
    // 冒烟确定性：强制经典尺寸滚动条（macOS overlay 滚动条零宽会让 gutter 断言失真，
    // 见 global.css 的 .smoke-classic-scrollbars；须在挂载演示前生效——引擎构造期读 clientWidth）
    document.documentElement.classList.add('smoke-classic-scrollbars')

    const demos: DemoHandles = {
      dataForms: mountDataForms(mountPoint),
      display: mountDisplay(mountPoint),
      interaction: mountInteraction(mountPoint),
      media: mountMedia(mountPoint),
      chart: mountChart(mountPoint),
      watermark: mountWatermark(mountPoint),
      print: mountPrint(mountPoint),
      editing: mountEditing(mountPoint),
      nativeScroll: mountNativeScroll(mountPoint),
    }
    window.__DEMO__ = demos
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
    <div className="h-screen overflow-y-auto p-6">
      <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <FlaskConical className="size-5 text-primary" />
          <h2 className="text-lg font-semibold">冒烟自动化测试进行中（?smoke=1）</h2>
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          正在后台执行全量像素与交互自检断言，结果将写入 window.__SMOKE__ …
        </p>
      </div>
      <div ref={mountRef} className="mb-5 flex flex-col gap-5" />
    </div>
  )
}
