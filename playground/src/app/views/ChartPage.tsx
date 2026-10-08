// 单元格图表：格内声明图表，Chart.js 离屏出图，位图经 cell 级 MediaCache blit 上屏。

import { mountChart } from '../../sections/chart'
import { SectionPage } from '../SectionPage'

export function ChartPage() {
  return (
    <SectionPage
      title="单元格图表"
      tags={['Chart.js 按需加载', '离屏出图', 'L2 位图缓存', '滚动无闪']}
      desc="单元格声明图表（类型 + 数据），chart 插件经既有注册路径启用：Chart.js 离屏同步出图，位图经 cell 级 MediaCache blit 到 media 层；滚动滚回命中缓存直接回贴，数据变更按内容换 key 失效重绘。"
      mount={mountChart}
    />
  )
}
