// 总览页（P3 质感终稿）：hero + 实测 KPI + 最小构建体积对比条 + 按能力域分组的示例导航。
// 数字一律取 README 与 playground/results/ 的实测采样（2026-09，对比基线 VTable 1.26.8），不写营销口径。

import { ArrowRight, ArrowUpRight, Swords, Timer } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { BRAND_ICON, NAV_GROUPS, type NavItem } from '../nav'
import { navigateTo } from '../useHashRoute'

/** hero 能力徽条：引擎事实，非营销话术 */
const HERO_BADGES = ['零 vrender 依赖', '四层 canvas 分层', '无全量重绘路径', 'MIT'] as const

/** KPI 实测口径见 README「性能对比」与 playground/results/ */
const KPI_STATS = [
  {
    label: '首帧时间',
    value: '16.7',
    unit: 'ms',
    note: '100 万行 × 20 列 TTFF P50；10 万行 17.2ms，数据量 ×10 基本不变',
  },
  {
    label: '稳态滚动',
    value: '60',
    unit: 'FPS',
    note: '滚动收敛为单条 band 失效，全程 0 次 full 全量重绘',
  },
  {
    label: '逐格写吞吐',
    value: '360',
    unit: 'ops/ms',
    note: '模型直挂逐格写，只触发 cell 级失效（100 万行）',
  },
  {
    label: '最小构建',
    value: '27.3',
    unit: 'KB gzip',
    note: 'ListTable + createRenderHost 渲染面，bun build minify 实测',
  },
] as const

/** 最小构建体积对比（vs.mjs 同口径实测值，单位 KB），宽度按 ours / theirs 占比 */
const SIZE_ROWS = [
  { label: 'minified', ours: 93.8, theirs: 2076.3, advantage: '22.1×' },
  { label: 'gzip', ours: 27.3, theirs: 514.8, advantage: '18.9×' },
] as const

/** hero 背景的细点阵（canvas 网格意象，中性灰，随暗色翻转） */
const DOT_GRID_STYLE = {
  backgroundImage:
    'radial-gradient(circle, oklch(0.9 0 0) 1px, transparent 1px), radial-gradient(circle, oklch(0.9 0 0 / 40%) 1px, transparent 1px)',
  backgroundSize: '16px 16px, 16px 16px',
  backgroundPosition: '0 0, 8px 8px',
  maskImage: 'linear-gradient(to left, black 55%, transparent)',
  WebkitMaskImage: 'linear-gradient(to left, black 55%, transparent)',
} as const

function Hero() {
  const BrandIcon = BRAND_ICON
  return (
    <section className="relative overflow-hidden rounded-xl border bg-card shadow-sm">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-1/2 dark:opacity-40"
        style={DOT_GRID_STYLE}
      />
      <div className="relative px-8 py-8">
        <div className="flex items-center gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <BrandIcon className="size-6" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
              infinitable <span className="font-normal text-muted-foreground">playground</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              多层 canvas 失效驱动渲染 · 全量虚拟滚动 · 为替代 VTable 而生
            </p>
          </div>
        </div>

        <p className="mt-5 max-w-[64ch] text-[13.5px] leading-relaxed text-muted-foreground">
          构造与首帧只处理可视窗口，10 万到 100 万行数据量变化下，首次渲染、滚动与写入指标基本不变。
          以下 13 个入口均可交互验证：渲染显示、三种数据供给、交互与编辑、图表/水印/打印插件、sheet
          电子表格与只读报表。
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {HERO_BADGES.map((badge) => (
            <Badge key={badge} variant="secondary">
              {badge}
            </Badge>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <Button onClick={() => navigateTo('compare')}>
            <Swords className="size-4" />
            运行 vs VTable 对比
          </Button>
          <a
            href="bench.html"
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: 'outline' })}
          >
            <Timer className="size-4" />
            量化基准（独立页）
            <ArrowUpRight className="size-3.5 text-muted-foreground" />
          </a>
        </div>
      </div>
    </section>
  )
}

function KpiSection() {
  return (
    <section>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
        {KPI_STATS.map((stat) => (
          <div key={stat.label} className="bg-card px-5 py-4">
            <div className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              {stat.label}
            </div>
            <div className="mt-1.5 text-[26px] leading-none font-semibold tracking-tight tabular-nums">
              {stat.value}
              <span className="ml-1 text-xs font-normal text-muted-foreground">{stat.unit}</span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/90">{stat.note}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        实测采样：macOS arm64 headless · 2026-09 · 对比基线 VTable 1.26.8；逐项数据与可分发报告见
        playground/results/ 与仓库 README。
      </p>
    </section>
  )
}

/** 单条体积横条：轨道定宽，宽度按对比值占比 */
function SizeBar({
  name,
  value,
  ratio,
  ours,
}: {
  name: string
  value: string
  ratio: number
  ours: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[11px] text-muted-foreground">{name}</span>
      <div className="h-4 flex-1 rounded bg-muted/70">
        <div
          className={cn('h-full rounded', ours ? 'bg-primary' : 'bg-zinc-400 dark:bg-zinc-600')}
          style={{ width: `${ratio}%` }}
        />
      </div>
      <span className="w-[72px] shrink-0 text-right text-xs font-medium tabular-nums">{value}</span>
    </div>
  )
}

function SizeCompareSection() {
  return (
    <Card className="py-5">
      <CardHeader>
        <CardTitle className="text-base">最小构建体积</CardTitle>
        <CardDescription>
          最小渲染面入口（ListTable + createRenderHost），bun build --minify --target=browser
          产物实测；gzip 按产物文件分别压缩求和。
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => navigateTo('compare')}>
            页内运行完整对比
            <ArrowRight className="size-3.5" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        {SIZE_ROWS.map((row) => (
          <div key={row.label}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-semibold">{row.label} 体积</span>
              <span className="text-xs font-medium text-primary tabular-nums">
                快 {row.advantage}
              </span>
            </div>
            <div className="space-y-1.5">
              <SizeBar
                name="infinitable"
                value={`${row.ours}KB`}
                ratio={(row.ours / row.theirs) * 100}
                ours
              />
              <SizeBar name="@visactor/vtable" value={`${row.theirs}KB`} ratio={100} ours={false} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DemoTile({ item }: { item: NavItem }) {
  const Icon = item.icon
  const tileClass =
    'group flex items-start gap-3 rounded-lg border bg-card px-4 py-3.5 text-left shadow-xs transition-colors hover:border-primary/40'
  const body = (
    <>
      <span className="mt-px flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-medium">{item.label}</span>
          {item.badge && (
            <Badge variant="secondary" className="px-1.5 text-[10px]">
              {item.badge}
            </Badge>
          )}
        </span>
        {item.desc && (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {item.desc}
          </span>
        )}
      </span>
      {'href' in item ? (
        <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
      ) : (
        <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
      )}
    </>
  )
  if ('href' in item) {
    return (
      <a href={item.href} target="_blank" rel="noopener" className={tileClass}>
        {body}
      </a>
    )
  }
  return (
    <button type="button" onClick={() => navigateTo(item.key)} className={tileClass}>
      {body}
    </button>
  )
}

export function HomePage() {
  const demoGroups = NAV_GROUPS.filter((group) => group.title !== '总览')
  return (
    <div className="flex flex-col gap-8">
      <Hero />
      <KpiSection />
      <SizeCompareSection />
      {demoGroups.map((group) => (
        <section key={group.title}>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-2.5">
            <h2 className="text-[13px] font-semibold tracking-wide">{group.title}</h2>
            {group.desc && <p className="text-[11px] text-muted-foreground">{group.desc}</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {group.items.map((item) => (
              <DemoTile key={item.key} item={item} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
