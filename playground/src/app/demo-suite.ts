// 全量演示区装配：SmokeMode（?smoke=1 自动化冒烟）与 SmokePage（应用内冒烟自检页）
// 共用的单一事实源——挂全量演示区并写 window 调试句柄。挂载清单收敛为一处，
// 避免 runSmoke 的检查面与调用方挂载面漂移（历史子集挂载漏区使顶层解构直接崩溃）。
// 调用方职责：挂载前开启冒烟确定性（错误采集 + setSmokeDprLocked(true) +
// html.smoke-classic-scrollbars），跑完关闭/移除。

import { mountChart } from '../sections/chart'
import { mountDataForms } from '../sections/data-forms'
import { mountDisplay } from '../sections/display'
import { mountEditing } from '../sections/editing'
import { mountHyperlinkImage } from '../sections/hyperlink-image'
import { mountInteraction } from '../sections/interaction'
import { mountMedia } from '../sections/media'
import { mountNativeScroll } from '../sections/native-scroll'
import { mountPivot } from '../sections/pivot'
import { mountPrint } from '../sections/print'
import { createReportHandle, mountReport } from '../sections/report'
import { mountWatermark } from '../sections/watermark'
import type { DemoHandles } from './types'

export function mountDemoSuite(root: HTMLElement): DemoHandles {
  const demos: DemoHandles = {
    dataForms: mountDataForms(root),
    display: mountDisplay(root),
    interaction: mountInteraction(root),
    hyperlinkImage: mountHyperlinkImage(root),
    media: mountMedia(root),
    chart: mountChart(root),
    watermark: mountWatermark(root),
    print: mountPrint(root),
    editing: mountEditing(root),
    nativeScroll: mountNativeScroll(root),
    pivot: mountPivot(root),
  }
  window.__DEMO__ = demos
  // 报表区：快照灌入 + readonly 渲染（句柄供 checkReport 断言）
  window.__REPORT_DEMO__ = createReportHandle(mountReport(root))
  return demos
}
