// 图片与浮动对象：L2 Media 分层、位图 LRU 缓存、无闪回滚、浮动对象帧级跟随。

import { mountMedia } from '../../sections/media'
import { SectionPage } from '../SectionPage'

export function MediaPage() {
  return (
    <SectionPage
      title="图片与浮动对象"
      tags={[
        'L2 Media 分层',
        '位图 LRU 缓存',
        '无闪回退',
        '视口窗口化加载',
        'FloatObjectLayer 浮层跟随',
      ]}
      desc="第 1 列偶数行为格内图片，经 L2 Media 独立画布层调度：视口内动态加载、位图 LRU 池化缓存、快速滚动位图无闪回滚；浮动对象层（FloatObjectLayer）锚定在格 (2,1)~(4,3)，滚动时帧级无抖动跟随。"
      mount={mountMedia}
    />
  )
}
