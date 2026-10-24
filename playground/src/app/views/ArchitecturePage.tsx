// 架构页：子包功能与 API 边界可视化——分层带（自上而下 = 依赖方向）+ 引擎装配协议缝
// + 包详情（职责 / 公共 API 名册 / 依赖边 / 边界规则）。数据单一事实源在
// architecture-data.ts（值导出由 architecture-data.test.ts 守卫），本组件只做展示。

import { ArrowDown } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  ARCH_LAYERS,
  ARCH_PROTOCOLS,
  findArchPackage,
  type ArchPackage,
  type ArchPackageKey,
} from '../architecture-data'

/** 分层带 → 包排列（formulas 独立侧包挂在领域层旁，虚线卡示意不在装配链上） */
const LAYER_PACKAGES: Record<(typeof ARCH_LAYERS)[number]['key'], ArchPackageKey[]> = {
  publish: ['infinitable'],
  domain: ['pivot', 'sheet', 'plugins', 'formulas'],
  engine: ['table'],
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

function PackageDetail({ pkg }: { pkg: ArchPackage }) {
  return (
    <Card className="py-5">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-base">{pkg.name}</span>
          <span className="font-mono text-xs font-normal text-muted-foreground">{pkg.dir}</span>
        </CardTitle>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{pkg.tagline}</p>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">具体功能</h3>
            <ul className="flex flex-col gap-1.5">
              {pkg.responsibilities.map((item) => (
                <li key={item} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">依赖边</h3>
            <div className="flex flex-wrap gap-1.5">
              {pkg.dependsOn.length === 0 ? (
                <span className="text-xs text-muted-foreground">无（依赖链底座）</span>
              ) : (
                pkg.dependsOn.map((dep) => (
                  <Badge key={dep} variant="secondary" className="font-mono text-[10px]">
                    → {findArchPackage(dep).name}
                  </Badge>
                ))
              )}
            </div>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">边界规则</h3>
            <ul className="flex flex-col gap-1.5">
              {pkg.boundaries.map((item) => (
                <li key={item} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500/70" />
                  {item}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-foreground">
            公共 API 边界（关键面）
          </h3>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <tbody>
                {pkg.apis.map((api) => (
                  <tr key={api.name} className="border-b last:border-b-0">
                    <td className="w-4 whitespace-nowrap px-2.5 py-1.5 align-top">
                      <Badge
                        variant={api.kind === 'value' ? 'default' : 'secondary'}
                        className="px-1 text-[9px]"
                      >
                        {api.kind === 'value' ? '值' : '型'}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-1 py-1.5 align-top font-mono text-[11.5px] font-medium">
                      {api.name}
                    </td>
                    <td className="px-2.5 py-1.5 leading-relaxed text-muted-foreground">
                      {api.desc}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

export function ArchitecturePage() {
  const [selected, setSelected] = useState<ArchPackageKey>('table')
  const selectedPkg = findArchPackage(selected)

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">架构与 API 边界</h2>
          <Badge variant="secondary">多包单体</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          七个子包自底向上逐层收窄：渲染层不含表格语义，内核层沉淀跨引擎网格机器，引擎层实现
          ListTable 与装配协议，领域与插件层经协议接入，发布层统一出口。点击包卡片查看具体功能、
          公共 API 名册与边界规则；API 名册由守卫测试对照真实导出验证。
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
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-dashed bg-muted/30 px-3.5 py-2.5">
                  <span className="text-[11px] font-semibold tracking-wide text-foreground">
                    ⌇ 引擎装配协议缝（packages/table/src/engine.ts）
                  </span>
                  {ARCH_PROTOCOLS.map((protocol) => (
                    <span
                      key={protocol.name}
                      className="text-[10.5px] leading-relaxed text-muted-foreground"
                    >
                      <code className="font-mono font-medium text-foreground">{protocol.name}</code>
                      ：{protocol.desc}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          箭头 = 依赖方向（上层依赖下层）；formulas 与 grid/table 互不依赖，由 sheet 的
          FormulaEngine 适配层接线；react 技术栈只进 playground，不进任何 packages。
        </p>
      </div>

      <PackageDetail pkg={selectedPkg} />
    </div>
  )
}
