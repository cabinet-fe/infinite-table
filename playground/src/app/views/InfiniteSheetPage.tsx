// WPS 式无限表格：不指定行列数挂 SheetGrid，滚动触界自动扩容（growOnScroll）。
// 状态行按滚动帧轮询当前网格规模，直观展示「网格长到哪了」。

import { useEffect, useRef, useState } from 'react'

import { mountInfiniteSheet } from '../../sections/infinite-sheet'

export function InfiniteSheetPage() {
  const mountRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ rows: number; cols: number } | null>(null)

  useEffect(() => {
    const el = mountRef.current
    if (!el) return
    const mounted = mountInfiniteSheet(el)
    const timer = window.setInterval(() => setDims(mounted.getDims()), 200)
    return () => {
      window.clearInterval(timer)
      mounted.release()
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">WPS 式无限表格</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          不指定行列数：初始网格按视口给足（可视 + 滚动缓冲 overscan），滚动缓冲末端触界后
          模型与引擎同步扩容，行号与列字母随滚动无限延伸；可编辑、可公式重算。
          滚动条绘制在右/下缘的预留轨道上，不再遮挡表体与行列头。
        </p>
        <p className="mt-1.5 font-mono text-[11px] text-primary">
          {dims ? `当前网格：${dims.rows} 行 × ${dims.cols} 列（随滚动增长）` : '挂载中…'}
        </p>
      </div>
      <div ref={mountRef} className="demo-mount-area" />
    </div>
  )
}
