// 侧栏子目录：嵌在统一侧栏（NavRail）激活的一级导航下方，按板块展示三类二级目录。
// 1. 「apps」多维数据台目录：展示用户可见的多维数据台，按能力控制新建/重命名/调序/删除，普通成员不暴露数据源信息。
// 2. 「entries」数据录入表目录：展示普通表填报直达入口，支持切换、新标签打开与复制直达链接。
// 3. 「datasources」数据源中心目录：自建普通表 + SQL 物理表分组（仅管理员/负责人可见），按权限控制建表/导入/重命名/删表与重置种子。

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  ExternalLink,
  FileSpreadsheet,
  Kanban,
  Layers,
  LayoutDashboard,
  Link2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Table2,
  TableProperties,
  Trash2,
} from 'lucide-react'
import {
  canConfigureAppItem,
  canConfigureTableItem,
  canEditEntryTableItem,
} from '../domain/workspace-helpers'
import type { CreateAppRequest, TableBundle } from '../shared/api-types'
import type {
  AuthUser,
  SmartApp,
  SmartViewType,
  UserCapabilities,
  WorkspaceView,
} from '../shared/schema'
import { ConfirmModal } from './ConfirmModal'
import { CustomSelect } from './CustomSelect'

export type SidebarSection = 'apps' | 'entries' | 'datasources'

export interface SidebarProps {
  section: SidebarSection
  currentUser: AuthUser
  userCapabilities: UserCapabilities
  apps: readonly SmartApp[]
  views: readonly WorkspaceView[]
  tables: readonly TableBundle[]
  activeAppId?: string
  activeEntryTableId?: string
  activeDatasourceTableId?: string
  busy?: boolean
  createAppDraftRequest?: { tableId: string; nonce: number } | null
  onSelectApp: (appId: string) => void
  onCreateApp: (payload: CreateAppRequest) => Promise<void>
  onRenameApp: (appId: string, nextName: string) => Promise<void>
  onDeleteApp: (appId: string) => Promise<void>
  onReorderApps: (appIds: string[]) => Promise<void>
  onSelectTable: (tableId: string) => void
  onEnterTableEntry?: (tableId: string) => void
  onOpenTableEntryNewTab?: (tableId: string) => void
  onCopyTableEntryLink?: (tableId: string) => void | Promise<void>
  onCreateNormalTable: (name: string, description?: string) => Promise<void>
  onRenameTable: (tableId: string, nextName: string) => Promise<void>
  onDeleteTable: (tableId: string) => Promise<void>
  onOpenImport: () => void
  onResetSeed: () => Promise<void>
}

export function ViewTypeIcon({
  type,
  className = 'h-3.5 w-3.5',
}: {
  type: SmartViewType
  className?: string
}) {
  switch (type) {
    case 'kanban':
      return <Kanban className={`${className} text-amber-600`} />
    case 'pivot':
      return <TableProperties className={`${className} text-violet-600`} />
    case 'dashboard':
      return <LayoutDashboard className={`${className} text-emerald-600`} />
    default:
      return <Table2 className={`${className} text-blue-600`} />
  }
}

export function Sidebar({
  section,
  currentUser,
  userCapabilities,
  apps,
  views,
  tables,
  activeAppId,
  activeEntryTableId,
  activeDatasourceTableId,
  busy = false,
  createAppDraftRequest,
  onSelectApp,
  onCreateApp,
  onRenameApp,
  onDeleteApp,
  onReorderApps,
  onSelectTable,
  onEnterTableEntry,
  onOpenTableEntryNewTab,
  onCopyTableEntryLink,
  onCreateNormalTable,
  onRenameTable,
  onDeleteTable,
  onOpenImport,
  onResetSeed,
}: SidebarProps) {
  // 多维数据台创建/重命名/删除状态
  const [creatingApp, setCreatingApp] = useState(false)
  const [newAppName, setNewAppName] = useState('')
  const [newAppDesc, setNewAppDesc] = useState('')
  const [newAppTableId, setNewAppTableId] = useState('')
  const [renamingAppId, setRenamingAppId] = useState<string | null>(null)
  const [renameAppDraft, setRenameAppDraft] = useState('')
  const [confirmDeleteApp, setConfirmDeleteApp] = useState<SmartApp | null>(null)
  // 展开中「⋯」管理菜单的多维数据台 id 及菜单落点（固定定位，避免被侧栏滚动容器裁切）
  const [manageMenuId, setManageMenuId] = useState<string | null>(null)
  const [manageMenuPos, setManageMenuPos] = useState({ top: 0, left: 0 })

  // 数据源中心状态
  const [creatingTable, setCreatingTable] = useState(false)
  const [newTableName, setNewTableName] = useState('')
  const [newTableDesc, setNewTableDesc] = useState('')
  const [normalCollapsed, setNormalCollapsed] = useState(false)
  const [advancedCollapsed, setAdvancedCollapsed] = useState(false)
  const [renamingTableId, setRenamingTableId] = useState<string | null>(null)
  const [renameTableDraft, setRenameTableDraft] = useState('')
  const [confirmDeleteTable, setConfirmDeleteTable] = useState<TableBundle | null>(null)
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  const tableNameById = useMemo(
    () => new Map(tables.map((b) => [b.meta.id, b.meta.name])),
    [tables],
  )
  const viewCountByAppId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const v of views) {
      counts.set(v.appId, (counts.get(v.appId) ?? 0) + 1)
    }
    return counts
  }, [views])
  const appsByTableId = useMemo(() => {
    const map = new Map<string, SmartApp[]>()
    for (const app of apps) {
      const list = map.get(app.tableId)
      if (list) list.push(app)
      else map.set(app.tableId, [app])
    }
    return map
  }, [apps])

  const normalTables = useMemo(() => tables.filter((t) => t.meta.kind === 'normal'), [tables])
  const advancedTables = useMemo(() => tables.filter((t) => t.meta.kind === 'advanced'), [tables])

  // 默认选中数据源表
  useEffect(() => {
    if (!newAppTableId || !tables.some((t) => t.meta.id === newAppTableId)) {
      setNewAppTableId(tables[0]?.meta.id ?? '')
    }
  }, [tables, newAppTableId])

  // 从数据源工具栏「基于此数据源新建多维数据台」唤起创建表单
  useEffect(() => {
    if (!createAppDraftRequest || !userCapabilities.canCreateApp) return
    setCreatingApp(true)
    setNewAppTableId(createAppDraftRequest.tableId)
    setNewAppName('')
    setNewAppDesc('')
  }, [createAppDraftRequest, userCapabilities.canCreateApp])

  // 权限变化时收起不再可用的内联编辑态
  useEffect(() => {
    if (!userCapabilities.canCreateApp) setCreatingApp(false)
    if (!userCapabilities.canCreateTable) setCreatingTable(false)
  }, [userCapabilities.canCreateApp, userCapabilities.canCreateTable])

  const canReorderApps = useMemo(
    () => apps.length > 1 && apps.every((app) => canConfigureAppItem(currentUser, app)),
    [apps, currentUser],
  )

  async function handleCreateAppSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = newAppName.trim()
    const targetTableId = newAppTableId || tables[0]?.meta.id
    if (!trimmed || !targetTableId) return
    try {
      await onCreateApp({
        name: trimmed,
        tableId: targetTableId,
        ...(newAppDesc.trim() ? { description: newAppDesc.trim() } : {}),
      })
      setNewAppName('')
      setNewAppDesc('')
      setCreatingApp(false)
    } catch {
      // 错误由上层 Toast 展示
    }
  }

  async function commitRenameApp(app: SmartApp) {
    const trimmed = renameAppDraft.trim()
    if (!trimmed || trimmed === app.name) {
      setRenamingAppId(null)
      return
    }
    try {
      await onRenameApp(app.id, trimmed)
      setRenamingAppId(null)
    } catch {
      // 保留编辑态便于重试
    }
  }

  async function handleMoveApp(index: number, delta: -1 | 1) {
    const targetIdx = index + delta
    if (targetIdx < 0 || targetIdx >= apps.length) return
    const nextIds = apps.map((a) => a.id)
    const [moved] = nextIds.splice(index, 1)
    nextIds.splice(targetIdx, 0, moved!)
    await onReorderApps(nextIds)
  }

  async function handleCreateTableSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = newTableName.trim()
    if (!trimmed) return
    try {
      await onCreateNormalTable(trimmed, newTableDesc.trim() || undefined)
      setNewTableName('')
      setNewTableDesc('')
      setCreatingTable(false)
    } catch {
      // 保留草稿
    }
  }

  async function commitRenameTable(tableId: string, originalName: string) {
    const trimmed = renameTableDraft.trim()
    if (!trimmed || trimmed === originalName) {
      setRenamingTableId(null)
      return
    }
    try {
      await onRenameTable(tableId, trimmed)
      setRenamingTableId(null)
    } catch {
      // 保留编辑态
    }
  }

  // 管理菜单打开期间：ESC 或点击菜单外部关闭
  useEffect(() => {
    if (!manageMenuId) return
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[data-app-manage-menu]')) return
      setManageMenuId(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setManageMenuId(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [manageMenuId])

  // 「⋯」右对齐、菜单限制在侧栏宽度内；固定定位是因为子目录列表自身可滚动
  function toggleManageMenu(anchor: HTMLElement, appId: string) {
    if (manageMenuId === appId) {
      setManageMenuId(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    setManageMenuPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 164) })
    setManageMenuId(appId)
  }

  const openRowFocus =
    'flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40'

  return (
    <div className="px-2 pb-3">
      {section === 'apps' && (
        <section aria-label="多维数据台">
          <div className="mt-3 flex h-7 items-center justify-between pr-1.5 pl-[38px]">
            <span className="st-section-label">
              全部应用
              <span className="ml-1.5 font-normal text-slate-400 tabular-nums">{apps.length}</span>
            </span>
            {userCapabilities.canCreateApp && (
              <button
                type="button"
                disabled={busy || tables.length === 0}
                onClick={() => setCreatingApp((v) => !v)}
                title="基于数据源新建多维数据台"
                aria-label="基于数据源新建多维数据台"
                className="st-icon-btn st-icon-btn-xs"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {userCapabilities.canCreateApp && creatingApp && (
            <form
              onSubmit={(e) => void handleCreateAppSubmit(e)}
              className="st-card mb-2 space-y-2 p-3"
            >
              <input
                type="text"
                className="st-input st-input-sm"
                placeholder="多维数据台名称，如：华东大区业绩台账"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                autoFocus
              />
              <CustomSelect
                size="xs"
                className="w-full"
                value={newAppTableId}
                ariaLabel="选择数据源"
                options={tables.map((t) => ({ value: t.meta.id, label: t.meta.name }))}
                onChange={(val) => setNewAppTableId(val)}
              />
              <input
                type="text"
                className="st-input st-input-sm"
                placeholder="业务用途说明（可选）"
                value={newAppDesc}
                onChange={(e) => setNewAppDesc(e.target.value)}
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setCreatingApp(false)}
                  className="st-btn st-btn-xs st-btn-ghost"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy || !newAppName.trim()}
                  className="st-btn st-btn-xs st-btn-primary"
                >
                  创建多维数据台
                </button>
              </div>
            </form>
          )}

          {apps.length === 0 ? (
            <div className="st-empty py-3">当前账号暂无可见的多维数据台</div>
          ) : (
            <ul className="space-y-0.5">
              {apps.map((app, idx) => {
                const active = activeAppId === app.id
                const isRenaming = renamingAppId === app.id
                const sourceTableName = tableNameById.get(app.tableId) ?? app.tableId
                const viewCount = viewCountByAppId.get(app.id) ?? 0
                const canConfigThisApp = canConfigureAppItem(currentUser, app)

                return (
                  <li key={app.id}>
                    {isRenaming ? (
                      <div className="py-0.5 pr-1 pl-[30px]">
                        <input
                          type="text"
                          className="st-input st-input-sm"
                          value={renameAppDraft}
                          autoFocus
                          onChange={(e) => setRenameAppDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void commitRenameApp(app)
                            } else if (e.key === 'Escape') {
                              setRenamingAppId(null)
                            }
                          }}
                          onBlur={() => void commitRenameApp(app)}
                        />
                      </div>
                    ) : (
                      <div className={`group st-nav-child ${active ? 'st-nav-child-active' : ''}`}>
                        <button
                          type="button"
                          onClick={() => onSelectApp(app.id)}
                          onDoubleClick={() => {
                            if (!canConfigThisApp) return
                            setRenamingAppId(app.id)
                            setRenameAppDraft(app.name)
                          }}
                          className={openRowFocus}
                        >
                          <Layers className="h-4 w-4 shrink-0" />
                          <span className="min-w-0">
                            <span
                              className={`block truncate leading-5 ${active ? 'pr-12' : 'pr-7'}`}
                              title={app.name}
                            >
                              {app.name}
                            </span>
                            {/* 数据源来源只在选中项下显示，避免每行都带两行 */}
                            {active && userCapabilities.canAccessDataSources && (
                              <span className="block truncate text-xs leading-4 font-normal text-slate-500">
                                数据源：{sourceTableName}
                              </span>
                            )}
                          </span>
                        </button>

                        {/* 视图数只在选中行显示；该行带第二行数据源说明，计数对齐首行避让 */}
                        {active && (
                          <span className="pointer-events-none absolute top-1 right-2 text-xs whitespace-nowrap tabular-nums text-slate-500 group-hover:hidden">
                            {viewCount} 视图
                          </span>
                        )}
                        {canConfigThisApp && (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`管理多维数据台 ${app.name}`}
                            title="重命名、调序或删除多维数据台"
                            aria-haspopup="menu"
                            aria-expanded={manageMenuId === app.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleManageMenu(e.currentTarget, app.id)
                            }}
                            className={`st-icon-btn st-icon-btn-xs absolute top-1/2 right-1.5 hidden -translate-y-1/2 group-hover:inline-flex ${
                              manageMenuId === app.id ? 'inline-flex bg-slate-200/80' : ''
                            }`}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    {manageMenuId === app.id && (
                      <div
                        role="menu"
                        data-app-manage-menu
                        aria-label={`管理多维数据台 ${app.name}`}
                        className="st-popover fixed z-50 w-40"
                        style={manageMenuPos}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="st-menu-item"
                          onClick={() => {
                            setManageMenuId(null)
                            setRenamingAppId(app.id)
                            setRenameAppDraft(app.name)
                          }}
                        >
                          <Pencil className="h-4 w-4 text-slate-400" />
                          重命名
                        </button>
                        {canReorderApps && idx > 0 && (
                          <button
                            type="button"
                            role="menuitem"
                            className="st-menu-item"
                            onClick={() => {
                              setManageMenuId(null)
                              void handleMoveApp(idx, -1)
                            }}
                          >
                            <ArrowUp className="h-4 w-4 text-slate-400" />
                            上移
                          </button>
                        )}
                        {canReorderApps && idx < apps.length - 1 && (
                          <button
                            type="button"
                            role="menuitem"
                            className="st-menu-item"
                            onClick={() => {
                              setManageMenuId(null)
                              void handleMoveApp(idx, 1)
                            }}
                          >
                            <ArrowDown className="h-4 w-4 text-slate-400" />
                            下移
                          </button>
                        )}
                        {apps.length > 1 && (
                          <button
                            type="button"
                            role="menuitem"
                            className="st-menu-item st-menu-item-danger"
                            onClick={() => {
                              setManageMenuId(null)
                              setConfirmDeleteApp(app)
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            删除
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {section === 'entries' && (
        <section aria-label="数据录入表">
          <div className="mt-3 flex h-7 items-center pr-1.5 pl-[38px]">
            <span className="st-section-label">
              可填报普通表
              <span className="ml-1.5 font-normal text-slate-400 tabular-nums">
                {normalTables.length}
              </span>
            </span>
          </div>

          {normalTables.length === 0 ? (
            <div className="st-empty py-3">暂无可访问的普通数据录入表</div>
          ) : (
            <ul className="space-y-0.5">
              {normalTables.map((bundle) => {
                const active = activeEntryTableId === bundle.meta.id
                const canEdit = canEditEntryTableItem(currentUser, bundle.meta, apps, views)
                return (
                  <li key={bundle.meta.id}>
                    <div className={`group st-nav-child ${active ? 'st-nav-child-active' : ''}`}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onEnterTableEntry?.(bundle.meta.id)}
                        className={openRowFocus}
                      >
                        <ClipboardList className="h-4 w-4 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate pr-10 leading-5" title={bundle.meta.name}>
                            {bundle.meta.name}
                          </span>
                          {!canEdit && (
                            <span className="flex items-center gap-1 text-xs leading-4 font-normal text-slate-500">
                              <Lock className="h-2.5 w-2.5" />
                              只读查看
                            </span>
                          )}
                        </span>
                      </button>

                      <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
                        <span className="text-xs whitespace-nowrap tabular-nums text-slate-400 group-hover:hidden">
                          {bundle.records.length} 条
                        </span>
                        <div className="hidden items-center gap-0.5 group-hover:flex">
                          {onOpenTableEntryNewTab && (
                            <button
                              type="button"
                              disabled={busy}
                              title="新标签页打开录入页"
                              aria-label={`新标签打开 ${bundle.meta.name} 录入页`}
                              onClick={(e) => {
                                e.stopPropagation()
                                onOpenTableEntryNewTab(bundle.meta.id)
                              }}
                              className="st-icon-btn st-icon-btn-xs"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {onCopyTableEntryLink && (
                            <button
                              type="button"
                              disabled={busy}
                              title="复制独立录入链接"
                              aria-label={`复制 ${bundle.meta.name} 录入链接`}
                              onClick={(e) => {
                                e.stopPropagation()
                                void onCopyTableEntryLink(bundle.meta.id)
                              }}
                              className="st-icon-btn st-icon-btn-xs"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {section === 'datasources' &&
        (userCapabilities.canAccessDataSources ? (
          <section aria-label="数据源中心">
            <div className="mt-3 flex h-7 items-center justify-between pr-1.5 pl-[38px]">
              <span className="st-section-label">
                数据表目录
                <span className="ml-1.5 font-normal text-slate-400 tabular-nums">
                  {tables.length}
                </span>
              </span>
              {userCapabilities.canCreateTable && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={onOpenImport}
                    title="从 Excel / CSV 导入建表"
                    aria-label="导入"
                    className="st-icon-btn st-icon-btn-xs"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setNormalCollapsed(false)
                      setCreatingTable((v) => !v)
                    }}
                    title="新建普通自建表"
                    className="st-icon-btn st-icon-btn-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {userCapabilities.canCreateTable && creatingTable && (
              <form
                onSubmit={(e) => void handleCreateTableSubmit(e)}
                className="st-card mb-2 space-y-2 p-3"
              >
                <input
                  type="text"
                  className="st-input st-input-sm"
                  placeholder="输入表名，如：客户跟进表"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  autoFocus
                />
                <input
                  type="text"
                  className="st-input st-input-sm"
                  placeholder="可选描述"
                  value={newTableDesc}
                  onChange={(e) => setNewTableDesc(e.target.value)}
                />
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingTable(false)
                      setNewTableName('')
                      setNewTableDesc('')
                    }}
                    className="st-btn st-btn-xs st-btn-ghost"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !newTableName.trim()}
                    className="st-btn st-btn-xs st-btn-primary"
                  >
                    创建
                  </button>
                </div>
              </form>
            )}

            {/* 自建普通表分组 */}
            <div className="mb-2">
              <button
                type="button"
                onClick={() => setNormalCollapsed((v) => !v)}
                aria-expanded={!normalCollapsed}
                className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-slate-200/60"
              >
                {normalCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span className="st-section-label flex-1">自建普通表</span>
                <span className="text-xs text-slate-400 tabular-nums">{normalTables.length}</span>
              </button>

              {!normalCollapsed && (
                <ul className="space-y-0.5">
                  {normalTables.map((bundle) => {
                    const active = activeDatasourceTableId === bundle.meta.id
                    const isRenaming = renamingTableId === bundle.meta.id
                    const canConfigTable = canConfigureTableItem(
                      currentUser,
                      bundle.meta,
                      appsByTableId.get(bundle.meta.id) ?? [],
                    )

                    return (
                      <li key={bundle.meta.id}>
                        {isRenaming ? (
                          <div className="py-0.5 pr-1 pl-[30px]">
                            <input
                              type="text"
                              className="st-input st-input-sm"
                              value={renameTableDraft}
                              autoFocus
                              onChange={(e) => setRenameTableDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  void commitRenameTable(bundle.meta.id, bundle.meta.name)
                                } else if (e.key === 'Escape') {
                                  setRenamingTableId(null)
                                }
                              }}
                              onBlur={() =>
                                void commitRenameTable(bundle.meta.id, bundle.meta.name)
                              }
                            />
                          </div>
                        ) : (
                          <div
                            className={`group st-nav-child ${active ? 'st-nav-child-active' : ''}`}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectTable(bundle.meta.id)}
                              onDoubleClick={() => {
                                if (!canConfigTable) return
                                setRenamingTableId(bundle.meta.id)
                                setRenameTableDraft(bundle.meta.name)
                              }}
                              className={openRowFocus}
                            >
                              <Table2 className="h-4 w-4 shrink-0" />
                              <span
                                className="block truncate pr-10 leading-5"
                                title={bundle.meta.name}
                              >
                                {bundle.meta.name}
                              </span>
                            </button>

                            <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
                              <span className="text-xs text-slate-400 tabular-nums group-hover:hidden">
                                {bundle.records.length}
                              </span>
                              {canConfigTable && (
                                <div className="hidden items-center gap-0.5 group-hover:flex">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    title="重命名数据表"
                                    aria-label={`重命名 ${bundle.meta.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setRenamingTableId(bundle.meta.id)
                                      setRenameTableDraft(bundle.meta.name)
                                    }}
                                    className="st-icon-btn st-icon-btn-xs"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  {tables.length > 1 && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      title="删除数据表"
                                      aria-label={`删除 ${bundle.meta.name}`}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setConfirmDeleteTable(bundle)
                                      }}
                                      className="st-icon-btn st-icon-btn-xs st-icon-btn-danger"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* SQL 物理表分组 */}
            <div>
              <button
                type="button"
                onClick={() => setAdvancedCollapsed((v) => !v)}
                aria-expanded={!advancedCollapsed}
                className="mt-1 flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left hover:bg-slate-200/60"
              >
                {advancedCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span className="st-section-label flex-1">SQL 物理表</span>
                <span className="st-badge st-badge-violet">SQL</span>
                <span className="text-xs text-slate-400 tabular-nums">{advancedTables.length}</span>
              </button>

              {!advancedCollapsed && (
                <ul className="space-y-0.5">
                  {advancedTables.map((bundle) => {
                    const active = activeDatasourceTableId === bundle.meta.id
                    const canConfigTable = canConfigureTableItem(
                      currentUser,
                      bundle.meta,
                      appsByTableId.get(bundle.meta.id) ?? [],
                    )
                    return (
                      <li key={bundle.meta.id}>
                        <div
                          className={`group st-nav-child ${active ? 'st-nav-child-active' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectTable(bundle.meta.id)}
                            className={openRowFocus}
                          >
                            <Database className="h-4 w-4 shrink-0 text-indigo-500" />
                            <span
                              className="block truncate pr-10 leading-5"
                              title={bundle.meta.name}
                            >
                              {bundle.meta.name}
                            </span>
                          </button>

                          <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5">
                            <span className="text-xs text-slate-400 tabular-nums group-hover:hidden">
                              {bundle.records.length}
                            </span>
                            {!bundle.meta.system && canConfigTable && (
                              <button
                                type="button"
                                disabled={busy}
                                title="删除数据表"
                                aria-label={`删除 ${bundle.meta.name}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDeleteTable(bundle)
                                }}
                                className="st-icon-btn st-icon-btn-xs st-icon-btn-danger hidden group-hover:inline-flex"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* 底部管理员操作：仅管理员可见重置演示数据 */}
            {userCapabilities.canResetSeed && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmResetOpen(true)}
                className="st-nav-item mt-3"
              >
                <RotateCcw className="h-[18px] w-[18px]" />
                <span>重置演示数据</span>
              </button>
            )}
          </section>
        ) : (
          <div className="st-alert st-alert-amber mt-3">普通成员无权访问数据源中心。</div>
        ))}

      <ConfirmModal
        open={confirmDeleteApp !== null}
        title="确认删除多维数据台"
        description={`确定要删除多维数据台「${confirmDeleteApp?.name ?? ''}」吗？其下全部视图与配置将一并移除，底层数据源表不会受影响。`}
        confirmText="删除多维数据台"
        busy={busy}
        onCancel={() => setConfirmDeleteApp(null)}
        onConfirm={async () => {
          if (!confirmDeleteApp) return
          await onDeleteApp(confirmDeleteApp.id)
          setConfirmDeleteApp(null)
        }}
      />

      <ConfirmModal
        open={confirmDeleteTable !== null}
        title="确认删除数据表"
        description={
          confirmDeleteTable?.meta.kind === 'advanced'
            ? `确定要删除进阶表「${confirmDeleteTable?.meta.name ?? ''}」及其物理表与全部 ${confirmDeleteTable?.records.length ?? 0} 条记录吗？基于此表构建的多维数据台及视图也将同步清理，此操作不可撤销。`
            : `确定要删除普通表「${confirmDeleteTable?.meta.name ?? ''}」及其全部 ${confirmDeleteTable?.records.length ?? 0} 条记录吗？基于此表构建的多维数据台及视图也将同步清理，此操作不可撤销。`
        }
        confirmText="删除数据表"
        busy={busy}
        onCancel={() => setConfirmDeleteTable(null)}
        onConfirm={async () => {
          if (!confirmDeleteTable) return
          const targetId = confirmDeleteTable.meta.id
          await onDeleteTable(targetId)
          setConfirmDeleteTable(null)
        }}
      />

      <ConfirmModal
        open={confirmResetOpen}
        title="重置演示数据"
        description="将清空当前所有自定义数据源、多维数据台、视图与修改记录，并恢复到初始预置演示数据。确认继续吗？"
        confirmText="确认重置"
        busy={busy}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={async () => {
          await onResetSeed()
          setConfirmResetOpen(false)
        }}
      />
    </div>
  )
}
