// 智能表格顶部视图 Tab 栏：展示当前智能表格下的多种视图（表格 / 看板 / 透视 / 仪表盘），
// 支持快速切换；按真实配置权限控制新建视图、双击/按钮重命名、左右调序、删除及数据源快捷跳转。

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Database, Pencil, Plus, Share2, Table2, X } from 'lucide-react'
import { buildDefaultViewPayload } from '../domain/workspace-helpers'
import type { CreateViewRequest, TableBundle } from '../shared/api-types'
import type { SmartApp, SmartViewType, WorkspaceView } from '../shared/schema'
import { ConfirmModal } from './ConfirmModal'
import { ViewTypeIcon } from './Sidebar'

const VIEW_TYPE_CHOICES: { value: SmartViewType; label: string; hint: string }[] = [
  { value: 'table', label: '表格视图', hint: '多维明细与汇总' },
  { value: 'kanban', label: '看板视图', hint: '按状态泳道推进' },
  { value: 'pivot', label: '透视分析', hint: '交叉统计与下钻' },
  { value: 'dashboard', label: '统计仪表盘', hint: 'KPI 与可视化图表' },
]

export interface AppViewTabsProps {
  canConfigureApp: boolean
  canManageDataSource?: boolean
  canShareApp?: boolean
  canConfigureView?: (view: WorkspaceView) => boolean
  app: SmartApp
  bundle: TableBundle
  views: readonly WorkspaceView[]
  activeViewId: string
  busy?: boolean
  onSelectView: (viewId: string) => void
  onCreateView: (payload: CreateViewRequest) => Promise<void>
  onRenameView: (viewId: string, nextName: string) => Promise<void>
  onDeleteView: (viewId: string) => Promise<void>
  onReorderViews: (viewIds: string[]) => Promise<void>
  onJumpToDatasource?: (tableId: string) => void
  onShareApp?: () => void
}

export function AppViewTabs({
  canConfigureApp,
  canManageDataSource = false,
  canShareApp = false,
  canConfigureView,
  app,
  bundle,
  views,
  activeViewId,
  busy = false,
  onSelectView,
  onCreateView,
  onRenameView,
  onDeleteView,
  onReorderViews,
  onJumpToDatasource,
  onShareApp,
}: AppViewTabsProps) {
  const [creatingOpen, setCreatingOpen] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [newViewType, setNewViewType] = useState<SmartViewType>('table')
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteView, setConfirmDeleteView] = useState<WorkspaceView | null>(null)

  const checkViewConfigurable = useMemo(
    () => (view: WorkspaceView) =>
      canConfigureView
        ? canConfigureView(view)
        : (view.capabilities?.canConfigure ?? canConfigureApp),
    [canConfigureView, canConfigureApp],
  )

  const canReorderViews = useMemo(
    () => views.length > 1 && views.every((v) => checkViewConfigurable(v)),
    [views, checkViewConfigurable],
  )

  useEffect(() => {
    setCreatingOpen(false)
    setRenamingViewId(null)
  }, [app.id])

  useEffect(() => {
    if (!canConfigureApp) {
      setCreatingOpen(false)
    }
  }, [canConfigureApp])

  async function handleCreateSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = newViewName.trim()
    if (!trimmed) return
    try {
      const payload = buildDefaultViewPayload(trimmed, newViewType, bundle, app.id)
      await onCreateView(payload)
      setNewViewName('')
      setCreatingOpen(false)
    } catch {
      // 错误由上层 Toast 提示
    }
  }

  async function commitRename(view: WorkspaceView) {
    const trimmed = renameDraft.trim()
    if (!trimmed || trimmed === view.name) {
      setRenamingViewId(null)
      return
    }
    try {
      await onRenameView(view.id, trimmed)
      setRenamingViewId(null)
    } catch {
      // 保留输入便于重试
    }
  }

  async function handleMove(index: number, delta: -1 | 1) {
    const targetIdx = index + delta
    if (targetIdx < 0 || targetIdx >= views.length) return
    const nextIds = views.map((v) => v.id)
    const [moved] = nextIds.splice(index, 1)
    nextIds.splice(targetIdx, 0, moved!)
    await onReorderViews(nextIds)
  }

  return (
    <div
      className="relative z-20 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4"
      aria-label="智能表格视图栏"
    >
      {/* 当前智能表格标题 + 视图 Tab 列表 */}
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-r border-slate-200 pr-3">
          <Table2 className="h-4 w-4 text-blue-600" />
          <h1 className="max-w-44 truncate text-sm font-semibold text-slate-900" title={app.name}>
            {app.name}
          </h1>
          {canManageDataSource && onJumpToDatasource && (
            <button
              type="button"
              onClick={() => onJumpToDatasource(bundle.meta.id)}
              title={`查看并管理底层数据源：${bundle.meta.name}`}
              className="hidden items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 lg:inline-flex"
            >
              <Database className="h-2.5 w-2.5" />
              <span className="max-w-28 truncate">{bundle.meta.name}</span>
            </button>
          )}
        </div>

        <nav
          aria-label="当前智能表格视图"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1"
        >
          {views.map((view, idx) => {
            const active = view.id === activeViewId
            const isRenaming = renamingViewId === view.id
            const canConfigThisView = checkViewConfigurable(view)

            if (isRenaming) {
              return (
                <input
                  key={view.id}
                  type="text"
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitRename(view)
                    } else if (e.key === 'Escape') {
                      setRenamingViewId(null)
                    }
                  }}
                  onBlur={() => void commitRename(view)}
                  className="h-7 w-32 shrink-0 rounded-md border border-blue-500 bg-white px-2 text-xs text-slate-800 focus:outline-none"
                />
              )
            }

            return (
              <div
                key={view.id}
                className={`group relative flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs transition-colors ${
                  active
                    ? 'bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-200/80'
                    : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectView(view.id)}
                  onDoubleClick={() => {
                    if (!canConfigThisView) return
                    setRenamingViewId(view.id)
                    setRenameDraft(view.name)
                  }}
                  className="flex items-center gap-1.5"
                >
                  <ViewTypeIcon type={view.type} className="h-3.5 w-3.5" />
                  <span className="max-w-36 truncate">{view.name}</span>
                </button>

                {canConfigThisView && (
                  <div className="ml-1 hidden items-center gap-0.5 group-hover:flex">
                    {canReorderViews && idx > 0 && (
                      <button
                        type="button"
                        disabled={busy}
                        title="左移视图"
                        aria-label={`左移视图 ${view.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleMove(idx, -1)
                        }}
                        className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                    )}
                    {canReorderViews && idx < views.length - 1 && (
                      <button
                        type="button"
                        disabled={busy}
                        title="右移视图"
                        aria-label={`右移视图 ${view.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleMove(idx, 1)
                        }}
                        className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      title="重命名视图"
                      aria-label={`重命名视图 ${view.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setRenamingViewId(view.id)
                        setRenameDraft(view.name)
                      }}
                      className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                    {views.length > 1 && (
                      <button
                        type="button"
                        disabled={busy}
                        title="删除视图"
                        aria-label={`删除视图 ${view.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDeleteView(view)
                        }}
                        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {canConfigureApp && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setCreatingOpen((v) => !v)}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-dashed border-slate-300 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-400 hover:bg-blue-50/50 hover:text-blue-700 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>新建视图</span>
            </button>
          )}
        </nav>
      </div>

      {canShareApp && onShareApp && (
        <button
          type="button"
          disabled={busy}
          onClick={onShareApp}
          title="创建或管理当前智能表格应用的对外分享链接"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50/70 hover:text-blue-700 disabled:opacity-40"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>分享应用</span>
        </button>
      )}

      {/* 新建视图浮层 */}
      {canConfigureApp && creatingOpen && (
        <form
          onSubmit={(e) => void handleCreateSubmit(e)}
          className="absolute top-12 left-56 z-40 w-80 space-y-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">为「{app.name}」新建视图</span>
            <button
              type="button"
              onClick={() => setCreatingOpen(false)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <input
            type="text"
            autoFocus
            value={newViewName}
            onChange={(e) => setNewViewName(e.target.value)}
            placeholder="输入视图名称，如：状态推进看板"
            className="h-8 w-full rounded-lg border border-slate-200 px-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-1.5">
            {VIEW_TYPE_CHOICES.map((opt) => {
              const selected = newViewType === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewViewType(opt.value)}
                  className={`flex items-start gap-2 rounded-lg border p-2 text-left transition-colors ${
                    selected
                      ? 'border-blue-500 bg-blue-50/60 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <ViewTypeIcon type={opt.value} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold">{opt.label}</span>
                    <span className="block text-[10px] text-slate-400">{opt.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setCreatingOpen(false)}
              className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy || !newViewName.trim()}
              className="h-7 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              创建视图
            </button>
          </div>
        </form>
      )}

      <ConfirmModal
        open={confirmDeleteView !== null}
        title="确认删除视图"
        description={`确定要从「${app.name}」中删除视图「${confirmDeleteView?.name ?? ''}」吗？`}
        confirmText="删除视图"
        busy={busy}
        onCancel={() => setConfirmDeleteView(null)}
        onConfirm={async () => {
          if (!confirmDeleteView) return
          await onDeleteView(confirmDeleteView.id)
          setConfirmDeleteView(null)
        }}
      />
    </div>
  )
}
