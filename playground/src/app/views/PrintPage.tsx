// 打印预览与输出：headless 打印内核 + DOM 薄壳预览（fitpage/fixrows 分页、页眉页脚占位符）。

import { mountPrint } from '../../sections/print'
import { SectionPage } from '../SectionPage'

export function PrintPage() {
  return (
    <SectionPage
      title="打印预览与输出"
      tags={['fitpage/fixrows 分页', '每页重复表头', '页眉页脚占位符', 'window.print 桩计数']}
      desc="headless 打印内核 + DOM 薄壳预览：超过一页的示例表（两行表头带合并单元格）经 PrintSource 供数，配置纸张/方向/缩放/分页模式后打开预览弹层（缩略列表 + 当前页放大 + 打印按钮）；window.print 已替换为计数桩，点打印按钮可在状态行与 window.__DEMO__.print 读取调用计数。"
      mount={mountPrint}
    />
  )
}
