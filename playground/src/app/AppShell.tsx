// 应用壳：深色侧栏（能力域分组导航 + 活跃指示 + 外链区分 + 底部引擎实测指标）+ 顶栏（面包屑 + 当前页能力描述）+ 内容区。
// 设计基线为中性深灰 + 单一蓝色强调（shadcn tokens），矢量图标 lucide-react。

import { ArrowUpRight } from 'lucide-react'
import type { ComponentType } from 'react'

import { cn } from '@/lib/utils'
import { ChartPage } from './views/ChartPage'
import { ComparePage } from './views/ComparePage'
import { DataFormsPage } from './views/DataFormsPage'
import { DisplayPage } from './views/DisplayPage'
import { EditingPage } from './views/EditingPage'
import { HomePage } from './views/HomePage'
import { InfiniteSheetPage } from './views/InfiniteSheetPage'
import { InteractionPage } from './views/InteractionPage'
import { MediaPage } from './views/MediaPage'
import { NativeScrollPage } from './views/NativeScrollPage'
import { PrintPage } from './views/PrintPage'
import { ReportPage } from './views/ReportPage'
import { SmokePage } from './views/SmokePage'
import { WatermarkPage } from './views/WatermarkPage'
import { BRAND_ICON, NAV_GROUPS, findNavItem, type PageKey } from './nav'
import { useHashRoute } from './useHashRoute'

/** 页面 key → 页面组件（bench 为独立页外链，不占路由位） */
const PAGES: Record<PageKey, ComponentType> = {
  home: HomePage,
  display: DisplayPage,
  'native-scroll': NativeScrollPage,
  'data-forms': DataFormsPage,
  interaction: InteractionPage,
  media: MediaPage,
  chart: ChartPage,
  watermark: WatermarkPage,
  print: PrintPage,
  editing: EditingPage,
  report: ReportPage,
  'infinite-sheet': InfiniteSheetPage,
  compare: ComparePage,
  smoke: SmokePage,
}

function Sidebar({ active, onNavigate }: { active: PageKey; onNavigate: (key: PageKey) => void }) {
  const BrandIcon = BRAND_ICON
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950">
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BrandIcon className="size-5" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold leading-tight text-zinc-50">infinitable</span>
          <span className="text-[11px] leading-tight tracking-wide text-zinc-500">playground</span>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-1">
            <div className="px-2 pb-1 pt-3 text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
              {group.title}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon
              if ('href' in item) {
                return (
                  <a
                    key={item.key}
                    href={item.href}
                    target="_blank"
                    rel="noopener"
                    className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
                  >
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-zinc-400 group-hover:text-zinc-200">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-zinc-300">{item.label}</span>
                        <ArrowUpRight className="size-3 shrink-0 text-zinc-600" />
                      </span>
                      {item.desc && (
                        <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-zinc-500">
                          {item.desc}
                        </span>
                      )}
                    </span>
                  </a>
                )
              }
              const isActive = active === item.key
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.key)}
                  className={cn(
                    'group relative flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5',
                    isActive && 'bg-white/[0.07] hover:bg-white/[0.07]',
                  )}
                >
                  {isActive && (
                    <span className="absolute top-1/2 left-0 h-4.5 w-0.5 -translate-y-1/2 rounded-full bg-blue-400" />
                  )}
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-zinc-400 group-hover:text-zinc-200',
                      isActive && 'bg-blue-500/20 text-blue-300',
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'text-[13px] font-medium text-zinc-300',
                          isActive && 'text-white',
                        )}
                      >
                        {item.label}
                      </span>
                      {item.badge && (
                        <span className="rounded-full bg-blue-500/15 px-2 py-px text-[10px] font-medium text-blue-300">
                          {item.badge}
                        </span>
                      )}
                    </span>
                    {item.desc && (
                      <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-zinc-500">
                        {item.desc}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* 底部引擎指标位：README / playground/results 实测口径 */}
      <div className="space-y-1.5 border-t border-zinc-900 px-4 py-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">最小渲染面 gzip</span>
          <span className="font-semibold text-zinc-200 tabular-nums">27.3KB</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">100 万行 TTFF P50</span>
          <span className="text-zinc-400 tabular-nums">16.7ms</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">稳态滚动 full 重绘</span>
          <span className="text-zinc-400 tabular-nums">0 次</span>
        </div>
      </div>
    </aside>
  )
}

export function AppShell() {
  const [active, navigate] = useHashRoute()
  const activeItem = findNavItem(active)
  const Page = PAGES[active]

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar active={active} onNavigate={navigate} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center justify-between gap-6 border-b bg-background/80 px-7 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">playground</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="truncate font-semibold">{activeItem.label}</span>
          </div>
          {activeItem.desc && (
            <p className="hidden max-w-[46%] truncate text-xs text-muted-foreground lg:block">
              {activeItem.desc}
            </p>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1160px] px-7 pt-6 pb-12">
            <Page />
          </div>
        </main>
      </div>
    </div>
  )
}
