// 单元格图表：格内声明图表，Chart.js 离屏出图，位图经 cell 级 MediaCache blit 上屏。
// 出图统计与折线数据轮换按钮为 shadcn 组件，经 ChartDemo.rotateLineData 驱动引擎。

import { ChartColumn, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CHART_SCROLL_VARIANTS, mountChart, type ChartDemo } from '../../sections/chart'
import { SectionPage } from '../SectionPage'

/** 演示控制面板：出图统计 + 折线数据轮换（内容换 key 失效重绘）与提示状态行 */
function ChartControls({ demo }: { demo: ChartDemo }) {
  const [status, setStatus] = useState('滚动下方长列表再滚回，图表格命中缓存无闪直贴。')

  const refreshStats = () => {
    setStatus(
      `静态表：图表格 ${demo.staticMount.table.chartCellNodes.size} 个、位图缓存 ${demo.staticMount.table.mediaCache.size} 条；` +
        `滚动表：图表格 ${demo.scrollMount.table.chartCellNodes.size} 个、位图缓存 ${demo.scrollMount.table.mediaCache.size} 条` +
        `（声明共享 ${CHART_SCROLL_VARIANTS} 组）`,
    )
  }

  return (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="outline" size="sm" onClick={refreshStats}>
          <ChartColumn />
          出图统计
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            demo.rotateLineData()
            refreshStats()
          }}
        >
          <RefreshCw />
          轮换折线数据
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{status}</p>
      </div>
    </div>
  )
}

export function ChartPage() {
  const [demo, setDemo] = useState<ChartDemo | null>(null)
  // 包装为引用稳定回调：SectionPage 的挂载 effect 依赖 mount 引用，只跑一次
  const mount = useCallback((root: HTMLElement): ChartDemo => {
    const mounted = mountChart(root)
    setDemo(mounted)
    return mounted
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <SectionPage
        title="单元格图表"
        tags={['Chart.js 按需加载', '离屏出图', 'L2 位图缓存', '滚动无闪']}
        desc="单元格声明图表（类型 + 数据），chart 插件经既有注册路径启用：Chart.js 离屏同步出图，位图经 cell 级 MediaCache blit 到 media 层；滚动滚回命中缓存直接回贴，数据变更按内容换 key 失效重绘。"
        mount={mount}
      />
      {demo ? <ChartControls demo={demo} /> : null}
    </div>
  )
}
