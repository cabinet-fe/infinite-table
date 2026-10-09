// 报表式只读快照渲染（meta 迁移参考形态）：SheetSnapshot 灌入 Sheet 模型，readonly 渲染。
// 控制条（重灌按钮 + 快照状态行）为 shadcn 控件，经 demo.reloadSnapshot 驱动。

import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { mountReport, type ReportDemo } from '../../sections/report'

export function ReportPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [demo, setDemo] = useState<ReportDemo | null>(null)
  const [statusText, setStatusText] = useState('快照已灌入（全量负载灌回）')

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    setDemo(mountReport(el))
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">报表式只读快照渲染</h2>
          <Badge variant="secondary">SheetSnapshot restore</Badge>
          <Badge variant="secondary">readonly 渲染</Badge>
          <Badge variant="secondary">行列头关闭</Badge>
          <Badge variant="secondary">浮动图随快照接线</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          报表快照（cells/styles/merges/frozen/rowHeights/colWidths/colStyles/images/meta/selection）
          全量灌入 Sheet 模型，readonly 渲染：禁编辑、禁尺寸拖改、不接填充/撤销写路径； meta
          迁移时照搬「快照 → restore → 只读渲染」三段。
        </p>
      </div>

      <div ref={mountRef} className="demo-mount-area" />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          disabled={!demo}
          onClick={() => {
            demo?.reloadSnapshot()
            setStatusText('快照已重灌（替换语义，浮动图对账后重建）')
          }}
        >
          <RefreshCw />
          重灌快照（替换语义）
        </Button>
        <span className="rounded-md border border-primary/20 bg-primary/5 px-3 py-1.5 font-mono text-[11px] text-primary">
          {statusText}
        </span>
      </div>
    </div>
  )
}
