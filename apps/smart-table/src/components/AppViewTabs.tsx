// 多维数据台页头：左侧为应用标题（含底层数据源跳转）与视图页签（表格 / 看板 / 透视 / 仪表盘），
// 右侧为分享入口（应用与单视图共用）；按真实配置权限控制新建视图、双击或「⋯」菜单重命名、左右调序与删除。

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { buildDefaultViewPayload } from '../domain/workspace-helpers'
import type { CreateViewRequest, TableBundle } from '../shared/api-types'
import type { SmartApp, SmartViewType, WorkspaceView } from '../shared/schema'
import { ConfirmModal } from './ConfirmModal'
import { PageHeading } from './PageHeading'
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
  // 当前展开「⋯」操作菜单的视图 id 及菜单落点
  const [tabMenuId, setTabMenuId] = useState<string | null>(null)
  const [tabMenuPos, setTabMenuPos] = useState({ top: 0, left: 0 })

  // 「新建视图」按钮 + 浮层、Tab「⋯」菜单的锚点容器，用于点击外部关闭
  const createAreaRef = useRef<HTMLDivElement | null>(null)
  const tabMenuRef = useRef<HTMLDivElement | null>(null)

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
    setTabMenuId(null)
  }, [app.id])

  useEffect(() => {
    if (!canConfigureApp) {
      setCreatingOpen(false)
    }
  }, [canConfigureApp])

  // 浮层 / 菜单打开期间：ESC 或点击其锚点外部关闭
  useEffect(() => {
    if (!creatingOpen && !tabMenuId) return
    const anchor = creatingOpen ? createAreaRef : tabMenuRef
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (target && anchor.current?.contains(target)) return
      setCreatingOpen(false)
      setTabMenuId(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCreatingOpen(false)
        setTabMenuId(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [creatingOpen, tabMenuId])

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
    <>
      <header
        className="relative z-20 flex h-12 shrink-0 items-center gap-3 px-4"
        aria-label="多维数据台视图栏"
      >
        {/* 当前多维数据台标题 + 底层数据源跳转 */}
        <PageHeading icon={<Layers className="h-4 w-4" />} title={app.name}>
          {canManageDataSource && onJumpToDatasource && (
            <button
              type="button"
              onClick={() => onJumpToDatasource(bundle.meta.id)}
              title={`查看并管理底层数据源：${bundle.meta.name}`}
              className="st-tool st-tool-icon"
            >
              <Database className="h-4 w-4" />
              <span className="sr-only">{bundle.meta.name}</span>
            </button>
          )}
        </PageHeading>

        <span className="st-divider-v" />

        {/* 视图页签 + 新建视图（页签容器可横向滚动，浮层锚点放在其外避免被裁切） */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <nav
            aria-label="当前多维数据台视图"
            className="flex min-w-0 items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                    className="st-input st-input-sm w-36 shrink-0"
                  />
                )
              }

              return (
                <div
                  key={view.id}
                  className={`group relative st-tab px-2.5 ${active ? 'st-tab-active' : ''}`}
                >
                  <button
                    type="button"
                    title={view.name}
                    onClick={() => onSelectView(view.id)}
                    onDoubleClick={() => {
                      if (!canConfigThisView) return
                      setRenamingViewId(view.id)
                      setRenameDraft(view.name)
                    }}
                    className="flex items-center gap-1.5"
                  >
                    {/* 未激活页签的视图类型图标统一中性灰，避免一排多色图标抢视线 */}
                    <span className={`[svg]:text-inherit ${active ? '' : 'text-slate-400'}`}>
                      <ViewTypeIcon type={view.type} className="h-4 w-4" />
                    </span>
                    <span className="max-w-36 truncate">{view.name}</span>
                  </button>

                  {canConfigThisView && (
                    <div
                      ref={tabMenuId === view.id ? tabMenuRef : undefined}
                      className="absolute top-1 right-0.5"
                    >
                      {/* 「⋯」叠在 Tab 右端，悬停才出现，不改变 Tab 宽度 */}
                      <button
                        type="button"
                        disabled={busy}
                        title="视图操作"
                        aria-label={`视图操作 ${view.name}`}
                        aria-haspopup="menu"
                        aria-expanded={tabMenuId === view.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (tabMenuId === view.id) {
                            setTabMenuId(null)
                            return
                          }
                          // 菜单右对齐「⋯」并固定定位：Tab 列表容器带横向 overflow，绝对定位的子元素会被裁切
                          const rect = e.currentTarget.getBoundingClientRect()
                          setTabMenuPos({
                            top: rect.bottom + 6,
                            left: Math.max(8, rect.right - 160),
                          })
                          setTabMenuId(view.id)
                        }}
                        className={`st-icon-btn st-icon-btn-xs pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 ${
                          active ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'
                        } ${tabMenuId === view.id ? 'pointer-events-auto opacity-100' : ''}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>

                      {tabMenuId === view.id && (
                        <div
                          role="menu"
                          aria-label={`视图操作 ${view.name}`}
                          className="st-popover fixed z-50 w-40"
                          style={tabMenuPos}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="st-menu-item"
                            onClick={() => {
                              setTabMenuId(null)
                              setRenamingViewId(view.id)
                              setRenameDraft(view.name)
                            }}
                          >
                            <Pencil className="h-4 w-4 text-slate-400" />
                            重命名
                          </button>
                          {canReorderViews && idx > 0 && (
                            <button
                              type="button"
                              role="menuitem"
                              className="st-menu-item"
                              onClick={() => {
                                setTabMenuId(null)
                                void handleMove(idx, -1)
                              }}
                            >
                              <ChevronLeft className="h-4 w-4 text-slate-400" />
                              左移
                            </button>
                          )}
                          {canReorderViews && idx < views.length - 1 && (
                            <button
                              type="button"
                              role="menuitem"
                              className="st-menu-item"
                              onClick={() => {
                                setTabMenuId(null)
                                void handleMove(idx, 1)
                              }}
                            >
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                              右移
                            </button>
                          )}
                          {views.length > 1 && (
                            <button
                              type="button"
                              role="menuitem"
                              className="st-menu-item st-menu-item-danger"
                              onClick={() => {
                                setTabMenuId(null)
                                setConfirmDeleteView(view)
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              删除
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </nav>
          {/* 新建视图（按钮 + 浮层同锚点） */}
          {canConfigureApp && (
            <div ref={createAreaRef} className="relative shrink-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => setCreatingOpen((v) => !v)}
                aria-label="新建视图"
                title="新建视图"
                className="st-icon-btn"
              >
                <Plus className="h-4 w-4" />
                <span className="sr-only">新建视图</span>
              </button>

              {creatingOpen && (
                <form
                  onSubmit={(e) => void handleCreateSubmit(e)}
                  className="st-popover absolute top-full right-0 z-40 mt-2 w-[360px] space-y-3 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">
                      为「{app.name}」新建视图
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreatingOpen(false)}
                      aria-label="关闭新建视图"
                      className="st-icon-btn st-icon-btn-xs"
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
                    className="st-input"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    {VIEW_TYPE_CHOICES.map((opt) => {
                      const selected = newViewType === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setNewViewType(opt.value)}
                          className={`st-choice flex items-start gap-2 ${selected ? 'st-choice-active' : ''}`}
                        >
                          <ViewTypeIcon type={opt.value} className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{opt.label}</span>
                            <span className="block text-xs text-slate-500">{opt.hint}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setCreatingOpen(false)}
                      className="st-btn st-btn-sm st-btn-secondary"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={busy || !newViewName.trim()}
                      className="st-btn st-btn-sm st-btn-primary"
                    >
                      创建视图
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* 分享入口：应用与单视图的分享都从这里进入（弹窗内选择分享对象） */}
        {canShareApp && onShareApp && (
          <button
            type="button"
            disabled={busy}
            onClick={onShareApp}
            aria-label="分享应用"
            title="创建或管理当前多维数据台应用及视图的对外分享链接"
            className="st-btn st-btn-secondary st-btn-sm"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>分享</span>
            <span className="sr-only">应用</span>
          </button>
        )}
      </header>

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
    </>
  )
}
