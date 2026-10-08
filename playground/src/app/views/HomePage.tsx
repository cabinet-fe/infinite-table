// 总览页（临时简版，P3 重设计为成品）：入口可导航——按演示区分组给出跳转入口。
// 完整版（hero/KPI/体积对比/示例导航）见 cooking refactor-playground P3。

import { ArrowRight } from 'lucide-react'

import { NAV_GROUPS, type NavRouteItem } from '../nav'
import { navigateTo } from '../useHashRoute'

export function HomePage() {
  const demoItems = NAV_GROUPS.find((group) => group.title === '功能示例')?.items.filter(
    (item): item is NavRouteItem => !('href' in item),
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight">infinitable playground</h2>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          自研 Canvas
          分层渲染的表格引擎演示：虚拟滚动与冻结合并、三种数据供给形态、完整交互管线、图片与浮动对象、单元格图表、文字水印、打印预览、单元格编辑、sheet
          电子表格与报表只读快照；性能口径见 vs VTable 对比页与量化基准页。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {demoItems?.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => navigateTo(item.key)}
            className="group flex items-start gap-3 rounded-xl border bg-card px-5 py-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
          >
            <item.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground group-hover:text-primary" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {item.label}
                {item.badge && (
                  <span className="rounded-full bg-primary/10 px-2 py-px text-[10px] font-medium text-primary">
                    {item.badge}
                  </span>
                )}
              </span>
              {item.desc && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {item.desc}
                </span>
              )}
            </span>
            <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
          </button>
        ))}
      </div>
    </div>
  )
}
