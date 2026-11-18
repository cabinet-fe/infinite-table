// 左侧双板块导航栏：
// 1. 「智能表格」：展示多张独立智能表格（每张绑定一个数据源并自带多个视图）；运维态支持新建/重命名/调序/删除，用户查看态仅切换只读浏览且不暴露数据源。
// 2. 「数据源中心」：普通自建表 + SQL 物理表分组，管理表结构与原始数据，支持新建/Excel导入/重置演示数据（仅运维态可见）。

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Kanban,
  Layers,
  LayoutDashboard,
  Pencil,
  Plus,
  RotateCcw,
  Table2,
  TableProperties,
  Trash2,
} from 'lucide-react'
import type { AppMode } from '../domain/workspace-helpers'
import type { CreateAppRequest, TableBundle } from '../shared/api-types'
import type { SmartApp, SmartViewType, WorkspaceView } from '../shared/schema'
import { ConfirmModal } from './ConfirmModal'
import { CustomSelect } from './CustomSelect'

export type WorkspaceTarget =
  | { kind: 'app'; appId: string; viewId: string }
  | { kind: 'datasource'; tableId: string }

export interface SidebarProps {
  mode: AppMode
  apps: readonly SmartApp[]
  views: readonly WorkspaceView[]
  tables: readonly TableBundle[]
  activeTarget: WorkspaceTarget
  busy?: boolean
  createAppDraftRequest?: { tableId: string; nonce: number } | null
  onSelectApp: (appId: string) => void
  onCreateApp: (payload: CreateAppRequest) => Promise<void>
  onRenameApp: (appId: string, nextName: string) => Promise<void>
  onDeleteApp: (appId: string) => Promise<void>
  onReorderApps: (appIds: string[]) => Promise<void>
  onSelectTable: (tableId: string) => void
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
  mode,
  apps,
  views,
  tables,
  activeTarget,
  busy = false,
  createAppDraftRequest,
  onSelectApp,
  onCreateApp,
  onRenameApp,
  onDeleteApp,
  onReorderApps,
  onSelectTable,
  onCreateNormalTable,
  onRenameTable,
  onDeleteTable,
  onOpenImport,
  onResetSeed,
}: SidebarProps) {
  const isOperator = mode === 'operator'

  // 智能表格创建/重命名/删除状态
  const [creatingApp, setCreatingApp] = useState(false)
  const [newAppName, setNewAppName] = useState('')
  const [newAppDesc, setNewAppDesc] = useState('')
  const [newAppTableId, setNewAppTableId] = useState('')
  const [renamingAppId, setRenamingAppId] = useState<string | null>(null)
  const [renameAppDraft, setRenameAppDraft] = useState('')
  const [confirmDeleteApp, setConfirmDeleteApp] = useState<SmartApp | null>(null)

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
  const normalTables = useMemo(() => tables.filter((t) => t.meta.kind === 'normal'), [tables])
  const advancedTables = useMemo(() => tables.filter((t) => t.meta.kind === 'advanced'), [tables])

  // 默认选中数据源表
  useEffect(() => {
    if (!newAppTableId || !tables.some((t) => t.meta.id === newAppTableId)) {
      setNewAppTableId(tables[0]?.meta.id ?? '')
    }
  }, [tables, newAppTableId])

  // 从数据源工具栏「基于此数据源新建智能表格」唤起创建表单
  useEffect(() => {
    if (!createAppDraftRequest || !isOperator) return
    setCreatingApp(true)
    setNewAppTableId(createAppDraftRequest.tableId)
    setNewAppName('')
    setNewAppDesc('')
  }, [createAppDraftRequest, isOperator])

  // 切入只读查看态时自动退出内联编辑态
  useEffect(() => {
    if (!isOperator) {
      setCreatingApp(false)
      setCreatingTable(false)
      setRenamingAppId(null)
      setRenamingTableId(null)
    }
  }, [isOperator])

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

  return (
    <aside
      className="flex h-full w-64 shrink-0 flex-col border-r border-slate-200 bg-white select-none"
      aria-label="智能表格导航"
    >
      {/* 品牌区 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-3.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600 shadow-xs" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight text-slate-900">智能表格</span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            isOperator ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {isOperator ? '运维配置' : '用户查看'}
        </span>
      </div>

      {/* 导航滚动区 */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-5">
        {/* 板块一：智能表格列表（每张表内置多视图） */}
        <section aria-label="智能表格">
          <div className="mb-1.5 flex items-center justify-between px-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                智能表格
              </span>
              <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-500">
                {apps.length}
              </span>
            </div>
            {isOperator && (
              <button
                type="button"
                disabled={busy || tables.length === 0}
                onClick={() => setCreatingApp((v) => !v)}
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                title="基于数据源新建智能表格"
              >
                <Plus className="h-3 w-3" />
                <span>新建</span>
              </button>
            )}
          </div>

          {isOperator && creatingApp && (
            <form
              onSubmit={(e) => void handleCreateAppSubmit(e)}
              className="mb-2 space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-2.5"
            >
              <input
                type="text"
                className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                placeholder="智能表格名称，如：华东大区业绩台账"
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
                className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                placeholder="业务用途说明（可选）"
                value={newAppDesc}
                onChange={(e) => setNewAppDesc(e.target.value)}
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setCreatingApp(false)}
                  className="h-6 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy || !newAppName.trim()}
                  className="h-6 rounded bg-blue-600 px-2.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  创建智能表格
                </button>
              </div>
            </form>
          )}

          <ul className="space-y-0.5">
            {apps.map((app, idx) => {
              const active = activeTarget.kind === 'app' && activeTarget.appId === app.id
              const isRenaming = renamingAppId === app.id
              const sourceTableName = tableNameById.get(app.tableId) ?? app.tableId
              const viewCount = viewCountByAppId.get(app.id) ?? 0

              return (
                <li key={app.id}>
                  {isRenaming ? (
                    <div className="px-1 py-0.5">
                      <input
                        type="text"
                        className="h-7 w-full rounded-md border border-blue-500 bg-white px-2 text-xs text-slate-800 focus:outline-none"
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
                    <div
                      className={`group flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors ${
                        active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100/80'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectApp(app.id)}
                        onDoubleClick={() => {
                          if (!isOperator) return
                          setRenamingAppId(app.id)
                          setRenameAppDraft(app.name)
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <Layers
                          className={`h-3.5 w-3.5 shrink-0 ${
                            active ? 'text-blue-600' : 'text-slate-400'
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-xs ${active ? 'font-semibold' : 'font-medium'}`}
                            title={app.name}
                          >
                            {app.name}
                          </span>
                          {isOperator && (
                            <span className="block truncate text-[10px] text-slate-400">
                              数据源：{sourceTableName}
                            </span>
                          )}
                        </span>
                      </button>

                      <div className="ml-1 flex shrink-0 items-center gap-1">
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] ${
                            active ? 'bg-blue-100/80 text-blue-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {viewCount} 视图
                        </span>
                        {isOperator && (
                          <div className="hidden items-center gap-0.5 group-hover:flex">
                            {idx > 0 && (
                              <button
                                type="button"
                                disabled={busy}
                                title="上移智能表格"
                                aria-label={`上移 ${app.name}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handleMoveApp(idx, -1)
                                }}
                                className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </button>
                            )}
                            {idx < apps.length - 1 && (
                              <button
                                type="button"
                                disabled={busy}
                                title="下移智能表格"
                                aria-label={`下移 ${app.name}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handleMoveApp(idx, 1)
                                }}
                                className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              title="重命名智能表格"
                              aria-label={`重命名 ${app.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setRenamingAppId(app.id)
                                setRenameAppDraft(app.name)
                              }}
                              className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            {apps.length > 1 && (
                              <button
                                type="button"
                                disabled={busy}
                                title="删除智能表格"
                                aria-label={`删除 ${app.name}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDeleteApp(app)
                                }}
                                className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              >
                                <Trash2 className="h-3 w-3" />
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
        </section>

        {/* 板块二：数据源中心（仅运维配置态可见） */}
        {isOperator && (
          <section aria-label="数据源中心" className="border-t border-slate-200/80 pt-4">
            <div className="mb-2 flex items-center justify-between px-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                数据源中心
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setNormalCollapsed(false)
                    setCreatingTable((v) => !v)
                  }}
                  title="新建普通自建表"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  <Plus className="h-3 w-3" />
                  <span>新建</span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onOpenImport}
                  title="从 Excel / CSV 导入建表"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  <FileSpreadsheet className="h-3 w-3" />
                  <span>导入</span>
                </button>
              </div>
            </div>

            {creatingTable && (
              <form
                onSubmit={(e) => void handleCreateTableSubmit(e)}
                className="mb-2.5 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2"
              >
                <input
                  type="text"
                  className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
                  placeholder="输入表名，如：客户跟进表"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  autoFocus
                />
                <input
                  type="text"
                  className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
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
                    className="h-6 rounded border border-slate-200 bg-white px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !newTableName.trim()}
                    className="h-6 rounded bg-blue-600 px-2.5 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-40"
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
                className="mb-1 flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium text-slate-500 hover:bg-slate-100"
              >
                {normalCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span className="flex-1">自建普通表</span>
                <span className="text-[10px] text-slate-400">{normalTables.length}</span>
              </button>

              {!normalCollapsed && (
                <ul className="space-y-0.5 pl-1">
                  {normalTables.map((bundle) => {
                    const active =
                      activeTarget.kind === 'datasource' && activeTarget.tableId === bundle.meta.id
                    const isRenaming = renamingTableId === bundle.meta.id

                    return (
                      <li key={bundle.meta.id}>
                        {isRenaming ? (
                          <div className="px-1 py-0.5">
                            <input
                              type="text"
                              className="h-7 w-full rounded-md border border-blue-500 bg-white px-2 text-xs text-slate-800 focus:outline-none"
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
                            className={`group flex items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
                              active
                                ? 'bg-slate-900 text-white'
                                : 'text-slate-700 hover:bg-slate-100/80'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectTable(bundle.meta.id)}
                              onDoubleClick={() => {
                                setRenamingTableId(bundle.meta.id)
                                setRenameTableDraft(bundle.meta.name)
                              }}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
                            >
                              <Table2
                                className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-blue-300' : 'text-slate-400'}`}
                              />
                              <span className="truncate font-medium" title={bundle.meta.name}>
                                {bundle.meta.name}
                              </span>
                            </button>
                            <div className="ml-1 flex shrink-0 items-center gap-1">
                              <span
                                className={`text-[10px] ${active ? 'text-slate-300' : 'text-slate-400'}`}
                              >
                                {bundle.records.length}
                              </span>
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
                                  className={`rounded p-0.5 ${
                                    active
                                      ? 'text-slate-300 hover:bg-white/10 hover:text-white'
                                      : 'text-slate-400 hover:bg-white hover:text-slate-700'
                                  }`}
                                >
                                  <Pencil className="h-3 w-3" />
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
                                    className={`rounded p-0.5 ${
                                      active
                                        ? 'text-slate-300 hover:bg-red-500/20 hover:text-red-300'
                                        : 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                                    }`}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
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
                className="mb-1 flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] font-medium text-slate-500 hover:bg-slate-100"
              >
                {advancedCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                <span className="flex-1">SQL 物理表</span>
                <span className="rounded bg-indigo-50 px-1 py-0.2 text-[9px] font-semibold text-indigo-600">
                  SQL
                </span>
                <span className="text-[10px] text-slate-400">{advancedTables.length}</span>
              </button>

              {!advancedCollapsed && (
                <ul className="space-y-0.5 pl-1">
                  {advancedTables.map((bundle) => {
                    const active =
                      activeTarget.kind === 'datasource' && activeTarget.tableId === bundle.meta.id
                    return (
                      <li key={bundle.meta.id}>
                        <div
                          className={`group flex items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
                            active
                              ? 'bg-slate-900 text-white'
                              : 'text-slate-700 hover:bg-slate-100/80'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectTable(bundle.meta.id)}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs"
                          >
                            <Database
                              className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-indigo-300' : 'text-indigo-500'}`}
                            />
                            <span className="truncate font-medium" title={bundle.meta.name}>
                              {bundle.meta.name}
                            </span>
                          </button>
                          <div className="ml-1 flex shrink-0 items-center gap-1">
                            <span
                              className={`text-[10px] ${active ? 'text-slate-300' : 'text-slate-400'}`}
                            >
                              {bundle.records.length}
                            </span>
                            {!bundle.meta.system && (
                              <button
                                type="button"
                                disabled={busy}
                                title="删除数据表"
                                aria-label={`删除 ${bundle.meta.name}`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmDeleteTable(bundle)
                                }}
                                className="hidden rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600 group-hover:inline-flex"
                              >
                                <Trash2 className="h-3 w-3" />
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
          </section>
        )}
      </div>

      {/* 底部操作区（仅运维态） */}
      {isOperator && (
        <div className="shrink-0 border-t border-slate-200 p-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmResetOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>重置演示数据</span>
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmDeleteApp !== null}
        title="确认删除智能表格"
        description={`确定要删除智能表格「${confirmDeleteApp?.name ?? ''}」吗？其下全部视图与配置将一并移除，底层数据源表不会受影响。`}
        confirmText="删除智能表格"
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
            ? `确定要删除进阶表「${confirmDeleteTable?.meta.name ?? ''}」及其物理表与全部 ${confirmDeleteTable?.records.length ?? 0} 条记录吗？基于此表构建的智能表格及视图也将同步清理，此操作不可撤销。`
            : `确定要删除普通表「${confirmDeleteTable?.meta.name ?? ''}」及其全部 ${confirmDeleteTable?.records.length ?? 0} 条记录吗？基于此表构建的智能表格及视图也将同步清理，此操作不可撤销。`
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
        description="将清空当前所有自定义数据源、智能表格、视图与修改记录，并恢复到初始预置演示数据。确认继续吗？"
        confirmText="确认重置"
        busy={busy}
        onCancel={() => setConfirmResetOpen(false)}
        onConfirm={async () => {
          await onResetSeed()
          setConfirmResetOpen(false)
        }}
      />
    </aside>
  )
}
