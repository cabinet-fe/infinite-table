// vs VTable 对比页（临时简版，P4 重写为成品）：对齐 scripts/vs.mjs 口径的页内对比跑批
// 入口在 React 化迁移期间暂缺，由 cooking refactor-playground P4 恢复
// （?vsrun=1 自动开跑、window.__VS_REPORT__、#vs-report 契约随 P4 回归）。

import { Badge } from '@/components/ui/badge'

export function ComparePage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border bg-card px-6 py-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-xl font-semibold tracking-tight">
            性能对比：infinitable vs @visactor/vtable
          </h2>
          <Badge variant="secondary">同数据同口径</Badge>
          <Badge variant="secondary">10 万 / 100 万行 × 20 列</Badge>
          <Badge variant="secondary">对称跑序取均值</Badge>
          <Badge variant="secondary">页内真实渲染</Badge>
        </div>
        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
          同一份 10 万 / 100 万行 × 20 列数据、同视口 1280×720，在两库各跑一遍：TTFF / 构造 /
          稳态滚动 FPS 与 JS 耗时 / 大幅跳转 / 逐格写吞吐 / 批量写 / 整表重建。每规模按
          [infinitable, VTable, VTable, infinitable] 对称跑序取均值，抗 JIT 与顺序偏差。
        </p>
      </div>

      <div className="rounded-xl border border-dashed bg-card px-6 py-10 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          页内对比跑批正在迁移到 React，恢复后此处可直接运行同口径对比并查看报告。
        </p>
      </div>
    </div>
  )
}
