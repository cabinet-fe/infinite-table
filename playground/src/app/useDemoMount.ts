// 命令式演示区挂载 → React 句柄：sections 的 mountXXX 挂到容器，返回的 demo 句柄交回组件
// 驱动页面控制面板。挂载区 DOM 随容器卸载移除；需要显式销毁的演示（如 sheet）仍走 SectionPage 的 unmount。

import { useEffect, useRef, useState } from 'react'

export function useDemoMount<D>(mount: (root: HTMLElement) => D) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [demo, setDemo] = useState<D | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    // 页面传模块级具名 mount 函数（引用稳定），effect 只跑一次
    setDemo(mount(el))
    return () => setDemo(null)
  }, [mount])

  return { containerRef, demo }
}
