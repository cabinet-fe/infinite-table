// 原生滚动条：ListTable 与 SheetGrid 双实例浏览器原生滚动条模式。

import { mountNativeScroll } from '../../sections/native-scroll'
import { SectionPage } from '../SectionPage'

export function NativeScrollPage() {
  return (
    <SectionPage
      title="原生滚动条（浏览器渲染）"
      tags={['mode: native', 'scrollbar-gutter: stable', '双向同步', 'growOnScroll']}
      desc="ListTable 与 SheetGrid 双实例启用 scrollbar: { mode: 'native' }：滚动条由浏览器原生渲染（保留 OS 外观、触控板惯性与系统辅助功能），横向/纵向（含右下角 corner）gutter 从布局独立预留、永不遮挡单元格；DOM 滚动（滚轮/触控板/拖拽原生 thumb/惯性）与引擎滚动状态双向同步，宿主滚轮接线自动让位不双滚；SheetGrid 侧 growOnScroll 扩容后滚动范围与引擎边界同步。"
      mount={mountNativeScroll}
      unmount={(demo) => demo.release()}
    />
  )
}
