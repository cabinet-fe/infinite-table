// 演示区通用薄壳：标题/标签/描述头卡 + useEffect 挂载区。
// 挂载复用 src/sections/** 的 mountXXX（命令式 DOM 落在 .demo-mount-area 内，沿用 style.css 卡片化）；
// sheet 等需要清理的演示经 unmount 回调在卸载时收尾。后续各阶段逐页改造，不动本壳的路由配置。

import { useEffect, useRef } from 'react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SectionPageProps<D> {
  title: string
  tags?: readonly string[]
  desc: string
  /** 挂载函数：页面传模块级具名函数（引用稳定，effect 只跑一次） */
  mount: (root: HTMLElement) => D
  /** 卸载收尾（如 sheet 的 destroy 与调试句柄回收）；缺省仅随容器移除 DOM */
  unmount?: (demo: D) => void
  /** 挂载区附加类名（如 smoke-staging 离屏挂载） */
  mountClassName?: string
}

export function SectionPage<D>({
  title,
  tags,
  desc,
  mount,
  unmount,
  mountClassName,
}: SectionPageProps<D>) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const demo = mount(el)
    return () => unmount?.(demo)
  }, [mount, unmount])

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {tags?.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
      </div>
      <div ref={containerRef} className={cn('demo-mount-area', mountClassName)} />
    </div>
  )
}
