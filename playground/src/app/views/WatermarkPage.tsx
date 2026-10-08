// 文字水印：plugins 挂载，平铺文字绘制在 ground 层（L0 预留位），锚定视口。

import { mountWatermark } from '../../sections/watermark'
import { SectionPage } from '../SectionPage'

export function WatermarkPage() {
  return (
    <SectionPage
      title="文字水印"
      tags={['ground 层 L0 预留位', '锚定视口', '参数即时生效']}
      desc="水印插件经构造 plugins 挂载：平铺文字绘制在四层 canvas 的 ground 层（惰性创建、恒在最底）。滚动表格观察水印锚定视口不随内容移动；开关与滑杆即时生效（updateConfig 一帧内重绘）。"
      mount={mountWatermark}
    />
  )
}
