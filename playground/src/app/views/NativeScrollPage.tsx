// 原生滚动条：ListTable 与 SheetGrid 双实例浏览器原生滚动条模式。

import { mountNativeScroll, type NativeScrollDemo } from '../../sections/native-scroll'
import { SectionPage } from '../SectionPage'

// 真实浏览器实测/控制台驱动句柄（ego-browser 真指针键盘实测断言 getSelection 等）：
// 形态对齐 ComparePage 的 window.__VS_REPORT__（页面级调试出口，不进引擎公共面）
declare global {
  interface Window {
    __NATIVE_SCROLL_DEMO__?: NativeScrollDemo
  }
}

/** 挂载后把双实例句柄挂到 window（模块级函数保持引用稳定，SectionPage effect 不因重渲重挂） */
function mountWithHandle(root: HTMLElement): NativeScrollDemo {
  const demo = mountNativeScroll(root)
  window.__NATIVE_SCROLL_DEMO__ = demo
  return demo
}

/** 卸载回收句柄（demo.release 摘 DOM 与引擎实例） */
function unmountWithHandle(demo: NativeScrollDemo): void {
  delete window.__NATIVE_SCROLL_DEMO__
  demo.release()
}

export function NativeScrollPage() {
  return (
    <SectionPage
      title="原生滚动条（浏览器渲染）"
      tags={['mode: native', 'scrollbar-gutter: stable', '双向同步', 'growOnScroll']}
      desc="ListTable 与 SheetGrid 双实例启用 scrollbar: { mode: 'native' }：滚动条由浏览器原生渲染（保留 OS 外观、触控板惯性与系统辅助功能），横向/纵向（含右下角 corner）gutter 从布局独立预留、永不遮挡单元格；DOM 滚动（滚轮/触控板/拖拽原生 thumb/惯性）与引擎滚动状态双向同步，宿主滚轮接线自动让位不双滚；SheetGrid 侧 growOnScroll 扩容后滚动范围与引擎边界同步。"
      mount={mountWithHandle}
      unmount={unmountWithHandle}
    />
  )
}
