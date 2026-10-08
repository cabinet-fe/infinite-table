// 交互能力：合成事件与交互管线（拖选/整行整列/键盘/resize/右键菜单/批量更新）。

import { mountInteraction } from '../../sections/interaction'
import { SectionPage } from '../SectionPage'

export function InteractionPage() {
  return (
    <SectionPage
      title="交互能力"
      tags={['框选/拖选', '整行/整列/全选', '键盘导航', '行列调整 Resize', '右键菜单', '批量更新']}
      desc="完整合成事件与交互管线：鼠标拖选、点击行号选择整行、点击列头选择整列、左上角全选；Shift+方向键区域扩展；行列拖拽调节尺寸（第 0 行/列由 canResize 规则锁定）；右键快捷菜单响应；以及批量更新（100 格）单帧收敛失效。"
      mount={mountInteraction}
    />
  )
}
