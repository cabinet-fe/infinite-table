// 架构页：分层图（自上而下 = 依赖方向）+ 装配协议缝 + 场景走读 + 包详情弹框
// （这层是什么 / 详细作用 / 典型场景 / 扩展举例 / 不做什么 / 依赖边，依赖徽章可
// 点击跳转对应包）。数据单一事实源在 architecture-data.ts（依赖边与叙事完整性
// 由 architecture-data.test.ts 守卫），本组件只做展示。

import { ArrowDown } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  ARCH_LAYERS,
  ARCH_PROTOCOLS,
  ARCH_WALKTHROUGHS,
  findArchPackage,
  type ArchPackage,
  type ArchPackageKey,
} from '../architecture-data'

/** 分层带 → 包排列（protocol 契约包与 table 同带；formulas 独立侧包挂在领域层旁，虚线卡示意不在装配链上） */
const LAYER_PACKAGES: Record<(typeof ARCH_LAYERS)[number]['key'], ArchPackageKey[]> = {
  publish: ['infinitable'],
  domain: ['pivot', 'sheet', 'plugins', 'formulas'],
  engine: ['protocol', 'table'],
  kernel: ['grid'],
  render: ['render'],
}

const INDEPENDENT_KEYS: readonly ArchPackageKey[] = ['formulas']

function PackageCard({
  pkg,
  selected,
  onSelect,
}: {
  pkg: ArchPackage
  selected: boolean
  onSelect: () => void
}) {
  const independent = INDEPENDENT_KEYS.includes(pkg.key)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group flex w-full min-w-40 flex-1 flex-col items-start gap-1 rounded-lg border bg-card px-3.5 py-2.5 text-left shadow-xs transition-colors',
        independent && 'border-dashed',
        selected ? 'border-primary/60 ring-1 ring-primary/40' : 'hover:border-primary/40',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="font-mono text-[12.5px] font-semibold">{pkg.name}</span>
        {independent && (
          <Badge variant="outline" className="px-1.5 text-[10px]">
            独立侧包
          </Badge>
        )}
      </span>
      <span className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
        {pkg.tagline}
      </span>
      {pkg.dependsOn.length > 0 && (
        <span className="mt-0.5 font-mono text-[10px] text-muted-foreground/80">
          → {pkg.dependsOn.join(' · ')}
        </span>
      )}
    </button>
  )
}

function BulletList({ items, dotClass }: { items: readonly string[]; dotClass: string }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <span className={cn('mt-1.5 size-1 shrink-0 rounded-full', dotClass)} />
          {item}
        </li>
      ))}
    </ul>
  )
}

function PackageDetailBody({
  pkg,
  onJump,
}: {
  pkg: ArchPackage
  onJump: (key: ArchPackageKey) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-foreground">这层是什么</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{pkg.role}</p>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">详细作用</h3>
            <BulletList items={pkg.responsibilities} dotClass="bg-primary/60" />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">
              依赖边（点击跳转）
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {pkg.dependsOn.length === 0 ? (
                <span className="text-xs text-muted-foreground">无（依赖链底座）</span>
              ) : (
                pkg.dependsOn.map((dep) => (
                  <button
                    key={dep}
                    type="button"
                    onClick={() => onJump(dep)}
                    className="rounded-md bg-secondary font-mono text-[10px] text-secondary-foreground transition-colors hover:bg-secondary/70"
                  >
                    → {findArchPackage(dep).name}
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
        <div className="flex flex-col gap-5">
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">典型场景</h3>
            <BulletList items={pkg.scenarios} dotClass="bg-sky-500/70" />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">
              扩展举例（想加能力时动这层）
            </h3>
            <BulletList items={pkg.extensions} dotClass="bg-emerald-500/70" />
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">
              不做什么（边界心智）
            </h3>
            <BulletList items={pkg.boundaries} dotClass="bg-amber-500/70" />
          </section>
        </div>
      </div>
    </div>
  )
}

function PackageDetailDialog({
  pkgKey,
  onOpenChange,
  onJump,
}: {
  pkgKey: ArchPackageKey | null
  onOpenChange: (open: boolean) => void
  onJump: (key: ArchPackageKey) => void
}) {
  const pkg = pkgKey === null ? null : findArchPackage(pkgKey)
  return (
    <Dialog open={pkg !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-4xl">
        {pkg && (
          <>
            <DialogHeader className="border-b px-6 py-4 pr-12">
              <DialogTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-base">{pkg.name}</span>
                <span className="font-mono text-xs font-normal text-muted-foreground">
                  {pkg.dir}
                </span>
              </DialogTitle>
              <DialogDescription className="text-[13px] leading-relaxed">
                {pkg.tagline}
              </DialogDescription>
            </DialogHeader>
            {/* key 随包切换重建，滚动位置归零 */}
            <div key={pkg.key} className="max-h-[70vh] overflow-y-auto px-6 py-5">
              <PackageDetailBody pkg={pkg} onJump={onJump} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function WalkthroughSection() {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight">场景走读：各层怎么协作</h3>
        <span className="text-[11px] text-muted-foreground">
          心智模型的主入口——比记住每个包更重要的是记住一次交互的传播路径
        </span>
      </div>
      <div className="mt-4 grid gap-3.5 xl:grid-cols-2">
        {ARCH_WALKTHROUGHS.map((walkthrough) => (
          <div
            key={walkthrough.key}
            className="flex flex-col gap-2.5 rounded-lg border bg-background/40 px-4 py-3.5"
          >
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <h4 className="text-[13px] font-semibold">{walkthrough.title}</h4>
              <span className="text-[11px] text-muted-foreground">{walkthrough.question}</span>
            </div>
            <ol className="flex flex-col gap-1.5">
              {walkthrough.steps.map((step, index) => (
                <li key={step} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[9px] font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="rounded-md bg-primary/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-foreground/90">
              <span className="font-semibold">锚点：</span>
              {walkthrough.takeaway}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ArchitecturePage() {
  const [selected, setSelected] = useState<ArchPackageKey | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">架构</h2>
          <Badge variant="secondary">多包单体</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          八个功能子包 + 一个发布包自底向上逐层收窄，依赖只能向下。读这页的三个抓手：
          <b>分层图</b>——每层存在的原因（下层的存在让上层不用重复造）；
          <b>场景走读</b>——一次渲染 / 滚动 / 编辑 / 扩展中数据怎么流过各层；
          <b>包详情弹框</b>
          ——点卡片打开每包的详细作用、典型场景与扩展举例（想加某类能力时该动哪层），弹框内依赖徽章可直接跳转对应包。
        </p>
      </div>

      {/* 分层图：自上而下 = 依赖方向 */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col">
          {ARCH_LAYERS.map((layer, index) => (
            <div key={layer.key}>
              {index > 0 ? (
                <div className="flex justify-center py-1.5" aria-hidden>
                  <ArrowDown className="size-3.5 text-muted-foreground/50" />
                </div>
              ) : null}
              <div className="flex items-stretch gap-4">
                <div className="w-24 shrink-0 pt-1">
                  <div className="text-[11px] font-semibold tracking-wide text-foreground">
                    {layer.title}
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    {layer.desc}
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-2.5">
                  {LAYER_PACKAGES[layer.key].map((key) => {
                    const pkg = findArchPackage(key)
                    return (
                      <PackageCard
                        key={key}
                        pkg={pkg}
                        selected={selected === key}
                        onSelect={() => setSelected(key)}
                      />
                    )
                  })}
                </div>
              </div>
              {/* 引擎装配协议缝：领域层与引擎层之间 */}
              {layer.key === 'domain' ? (
                <div className="mt-3 flex flex-col gap-1.5 rounded-lg border border-dashed bg-muted/30 px-3.5 py-2.5">
                  <span className="text-[11px] font-semibold tracking-wide text-foreground">
                    ⌇ 引擎装配协议：引擎被拆成的部件约定（@infinitable/protocol
                    契约包，纯类型零运行时）
                  </span>
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    {ARCH_PROTOCOLS.map((protocol) => (
                      <span
                        key={protocol.name}
                        className="text-[10.5px] leading-relaxed text-muted-foreground"
                      >
                        <span className="font-medium text-foreground">{protocol.name}</span>：
                        {protocol.desc}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          箭头 = 依赖方向（上层依赖下层）；formulas 与网格/表格引擎互不依赖，由 sheet
          的公式接线层接线；react 技术栈只进 playground，不进任何 packages。
        </p>
      </div>

      <WalkthroughSection />

      <PackageDetailDialog
        pkgKey={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        onJump={setSelected}
      />
    </div>
  )
}
