// 页头标题簇：图标徽标 + 标题 + 说明文字，是各页头左侧统一的视觉锚点。
// title 可传入交互元素（如表名切换按钮）；children 用于挂载相对标题定位的浮层。

import type { ReactNode } from 'react'

export interface PageHeadingProps {
  icon: ReactNode
  title: ReactNode
  meta?: ReactNode
  children?: ReactNode
}

export function PageHeading({ icon, title, meta, children }: PageHeadingProps) {
  return (
    <div className="relative flex min-w-0 items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        {icon}
      </span>
      <h1 className="min-w-0 truncate text-base leading-6 font-semibold text-slate-900">{title}</h1>
      {children}
      {meta && <span className="shrink-0 truncate text-xs text-slate-500">{meta}</span>}
    </div>
  )
}
