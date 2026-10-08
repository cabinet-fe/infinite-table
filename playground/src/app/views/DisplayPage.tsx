// 显示能力：多层 canvas 分层渲染 + 四向滚动窗口（10 万行极限渲染）。

import { mountDisplay } from '../../sections/display'
import { SectionPage } from '../SectionPage'

export function DisplayPage() {
  return (
    <SectionPage
      title="显示能力（10 万行极限渲染）"
      tags={['100,000 行', '虚拟滚动', '冻结行列', '单元格合并', '逐边边框', '自定义渲染']}
      desc="多层 canvas 分层渲染 + 四向滚动窗口：首行首列冻结、(2,2)~(3,3) 区域合并展示、(2,4) 逐边差异化边框、Rating 列独立自定义 Canvas 绘制、Checkbox 状态切换及自定义主题配色。"
      mount={mountDisplay}
    />
  )
}
