// 看板与统计仪表盘视图占位分发组件：P5 阶段预留清晰路由分发点，待 P6 接入完整交互渲染。

import { Kanban, LayoutDashboard } from 'lucide-react'
import type { SmartTableMeta, WorkspaceView } from '../shared/schema'

export interface ViewTypePlaceholderProps {
  view: WorkspaceView
  tableMeta: SmartTableMeta
  recordCount: number
}

export function ViewTypePlaceholder({ view, tableMeta, recordCount }: ViewTypePlaceholderProps) {
  const isKanban = view.type === 'kanban'
  const Icon = isKanban ? Kanban : LayoutDashboard

  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div
          className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl ${
            isKanban ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
          }`}
        >
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="text-base font-semibold text-slate-900">{view.name}</h2>
        <p className="mt-1 text-xs text-slate-500">
          绑定数据源：{tableMeta.name} · 当前筛选结果 {recordCount} 条记录
        </p>
        {view.description && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {view.description}
          </p>
        )}
        <div className="mt-4 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600">
          {isKanban
            ? '看板泳道与拖拽写回视图路由已就绪（待 P6 接入）'
            : '统计仪表盘 KPI 与图表视图路由已就绪（待 P6 接入）'}
        </div>
      </div>
    </div>
  )
}
