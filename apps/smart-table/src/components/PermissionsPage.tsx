// 权限管理页（/permissions）：集中配置两层权限模型——
// 1. 第一层：智能表格应用与视图的可见范围（仅自己 / 指定负责人 / 全员）、指定负责人名单与普通成员授权（只读 / 可编辑）；
// 2. 第二层：数据源表的行级数据范围（仅本人 / 负责人 / 全部行）、业务负责人人员列（person）绑定与录入端成员授权。
// 管理员看全空间资源，负责人仅看本人创建或负责的资源，普通成员展示明确的权限不足提示与只读引导。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Database,
  Layers,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Table2,
  UserCheck,
  Users,
  X,
} from 'lucide-react'
import {
  ApiError,
  fetchPermissions,
  updateAppPermissions,
  updateTablePermissions,
  updateViewPermissions,
} from '../api'
import { USER_ROLE_LABELS } from '../domain/workspace-helpers'
import type {
  AppPermissionItem,
  PermissionsOverviewResponse,
  TablePermissionItem,
  ViewPermissionItem,
} from '../shared/api-types'
import type {
  AuthUser,
  MemberAccessLevel,
  ResourceVisibilityScope,
  SmartViewType,
  TableRowScope,
  UserCapabilities,
} from '../shared/schema'
import { CustomSelect } from './CustomSelect'
import { ViewTypeIcon } from './Sidebar'
import type { ToastType } from './Toast'

export interface PermissionsPageProps {
  currentUser: AuthUser
  userCapabilities: UserCapabilities
  onPermissionsChanged?: () => Promise<void> | void
  onBackToWorkbench?: () => void
  onNotify?: (type: ToastType, message: string) => void
}

type SectionFilter = 'all' | 'apps' | 'views' | 'tables'
type MemberAccessChoice = MemberAccessLevel | 'inherit'

interface ScopedDraft {
  visibilityScope: ResourceVisibilityScope
  managerUserIds: string[]
}

interface AppDraft extends ScopedDraft {
  memberAccess: MemberAccessLevel
}

interface ViewDraft extends ScopedDraft {
  memberAccess: MemberAccessLevel | null
}

interface TableDraft {
  rowScope: TableRowScope
  ownerColumnKey: string | null
  memberAccess: MemberAccessLevel | null
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
  title?: string
}

const VISIBILITY_SCOPE_OPTIONS: readonly SegmentedOption<ResourceVisibilityScope>[] = [
  { value: 'self', label: '仅自己', title: '仅创建者本人与管理员可见' },
  { value: 'managers', label: '指定负责人', title: '仅创建者、指定负责人与管理员可见' },
  { value: 'all', label: '全员', title: '空间内所有登录成员均可见' },
]

const APP_MEMBER_ACCESS_OPTIONS: readonly SegmentedOption<MemberAccessLevel>[] = [
  { value: 'readonly', label: '只读', title: '普通成员仅可浏览与临时筛选，不可写数据或改配置' },
  { value: 'editable', label: '可编辑', title: '普通成员可按表行级策略新增/编辑/删除数据行' },
]

const ROW_SCOPE_OPTIONS: readonly SegmentedOption<TableRowScope>[] = [
  {
    value: 'self',
    label: '仅本人',
    title: '仅创建人（createdBy）或绑定人员列匹配当前用户行可见可改',
  },
  { value: 'manager', label: '负责人', title: '管理员与负责人看全部行，普通成员仅看本人归属行' },
  { value: 'all', label: '全部行', title: '所有有权访问该表的用户均可见全部数据行' },
]

const TABLE_MEMBER_ACCESS_OPTIONS: readonly SegmentedOption<MemberAccessChoice>[] = [
  { value: 'inherit', label: '默认（跟随应用）', title: '由关联智能表格应用的成员授权决定' },
  { value: 'readonly', label: '只读', title: '独立数据录入端对普通成员只读' },
  { value: 'editable', label: '可编辑', title: '允许普通成员在独立数据录入端直接填报与编辑' },
]

const VIEW_TYPE_LABELS: Record<SmartViewType, string> = {
  table: '明细表',
  kanban: '看板',
  pivot: '透视表',
  dashboard: '仪表盘',
}

const ROW_SCOPE_DESCRIPTIONS: Record<TableRowScope, string> = {
  self: '仅记录创建人（createdBy）或绑定人员列匹配当前用户姓名/账号的记录可见可改（管理员除外）',
  manager: '管理员与负责人可见全部记录；普通成员仅可访问本人创建或业务负责人列匹配的记录',
  all: '所有有权访问该数据源表或其关联应用的用户均可见全部记录',
}

function omitRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

function sameUserIdList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((id) => bSet.has(id))
}

function toMemberChoice(value: MemberAccessLevel | null): MemberAccessChoice {
  return value ?? 'inherit'
}

function fromMemberChoice(choice: MemberAccessChoice): MemberAccessLevel | null {
  return choice === 'inherit' ? null : choice
}

function SegmentedToggle<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string
  ariaLabel: string
  value: T
  options: readonly SegmentedOption<T>[]
  disabled?: boolean
  onChange: (next: T) => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5"
      >
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={opt.title}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'bg-white text-blue-700 shadow-2xs ring-1 ring-blue-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ManagerCheckList({
  resourceLabel,
  candidates,
  selectedIds,
  disabled = false,
  onChange,
}: {
  resourceLabel: string
  candidates: readonly AuthUser[]
  selectedIds: readonly string[]
  disabled?: boolean
  onChange: (nextIds: string[]) => void
}) {
  const selectedSet = new Set(selectedIds)

  function toggleUser(userId: string) {
    if (selectedSet.has(userId)) {
      onChange(selectedIds.filter((id) => id !== userId))
    } else {
      onChange([...selectedIds, userId])
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-sky-200/80 bg-sky-50/50 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700">
          <UserCheck className="h-3.5 w-3.5 text-sky-600" />
          <span>指定可见与可管理的负责人名单</span>
        </div>
        <span className="text-[11px] text-slate-500">已选 {selectedIds.length} 人</span>
      </div>

      {candidates.length === 0 ? (
        <div className="text-xs text-slate-400">暂无可选负责人（需负责人或管理员角色账号）</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {candidates.map((user) => {
            const checked = selectedSet.has(user.id)
            return (
              <label
                key={user.id}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                  checked
                    ? 'border-blue-300 bg-white font-medium text-blue-700 shadow-2xs'
                    : 'border-slate-200 bg-white/80 text-slate-700 hover:border-slate-300'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  aria-label={`${resourceLabel} 指定负责人 ${user.displayName}`}
                  onChange={() => toggleUser(user.id)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{user.displayName}</span>
                <span className="rounded bg-slate-100 px-1 py-0.2 text-[10px] text-slate-500">
                  {USER_ROLE_LABELS[user.role]}
                </span>
              </label>
            )
          })}
        </div>
      )}

      {selectedIds.length === 0 && (
        <p className="mt-1.5 text-[11px] text-amber-700">
          未勾选任何负责人时，仅资源创建者本人与管理员可见。
        </p>
      )}
    </div>
  )
}

function ResourceSaveBar({
  resourceKindLabel,
  resourceName,
  dirty,
  saving,
  onReset,
  onSave,
}: {
  resourceKindLabel: string
  resourceName: string
  dirty: boolean
  saving: boolean
  onReset: () => void
  onSave: () => void
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
      <div className="text-[11px]">
        {dirty ? (
          <span className="inline-flex items-center gap-1 font-medium text-amber-600">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            <span>有未保存修改</span>
          </span>
        ) : (
          <span className="text-slate-400">与服务端当前配置一致</span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {dirty && (
          <button
            type="button"
            disabled={saving}
            onClick={onReset}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            <span>重置</span>
          </button>
        )}
        <button
          type="button"
          disabled={!dirty || saving}
          aria-label={`保存${resourceKindLabel} ${resourceName} 权限`}
          onClick={onSave}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
        >
          <Save className="h-3 w-3" />
          <span>{saving ? '保存中...' : '保存配置'}</span>
        </button>
      </div>
    </div>
  )
}

function ScopedAccessEditor<TMemberChoice extends string>({
  resourceLabel,
  visibilityScope,
  managerUserIds,
  managerCandidates,
  memberAccessValue,
  memberAccessOptions,
  disabled,
  onChangeVisibility,
  onChangeManagers,
  onChangeMemberAccess,
}: {
  resourceLabel: string
  visibilityScope: ResourceVisibilityScope
  managerUserIds: readonly string[]
  managerCandidates: readonly AuthUser[]
  memberAccessValue: TMemberChoice
  memberAccessOptions: readonly SegmentedOption<TMemberChoice>[]
  disabled: boolean
  onChangeVisibility: (scope: ResourceVisibilityScope) => void
  onChangeManagers: (ids: string[]) => void
  onChangeMemberAccess: (choice: TMemberChoice) => void
}) {
  return (
    <>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <SegmentedToggle
          label="可见范围"
          ariaLabel={`${resourceLabel} 可见范围`}
          value={visibilityScope}
          options={VISIBILITY_SCOPE_OPTIONS}
          disabled={disabled}
          onChange={onChangeVisibility}
        />
        <SegmentedToggle
          label="普通成员授权"
          ariaLabel={`${resourceLabel} 普通成员授权`}
          value={memberAccessValue}
          options={memberAccessOptions}
          disabled={disabled}
          onChange={onChangeMemberAccess}
        />
      </div>

      {visibilityScope === 'managers' && (
        <ManagerCheckList
          resourceLabel={resourceLabel}
          candidates={managerCandidates}
          selectedIds={managerUserIds}
          disabled={disabled}
          onChange={onChangeManagers}
        />
      )}
    </>
  )
}

export function PermissionsPage({
  currentUser,
  userCapabilities,
  onPermissionsChanged,
  onBackToWorkbench,
  onNotify,
}: PermissionsPageProps) {
  const isAuthorizedRole = currentUser.role !== 'member' && userCapabilities.canManagePermissions

  const [overview, setOverview] = useState<PermissionsOverviewResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(isAuthorizedRole)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [forbiddenMessage, setForbiddenMessage] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const [sectionFilter, setSectionFilter] = useState<SectionFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const [dirtyApps, setDirtyApps] = useState<Record<string, AppDraft>>({})
  const [dirtyViews, setDirtyViews] = useState<Record<string, ViewDraft>>({})
  const [dirtyTables, setDirtyTables] = useState<Record<string, TableDraft>>({})

  const requestSeqRef = useRef(0)
  const onNotifyRef = useRef(onNotify)
  onNotifyRef.current = onNotify

  const loadOverview = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!isAuthorizedRole) return
      const seq = ++requestSeqRef.current
      if (!options?.silent) {
        setLoading(true)
        setLoadError(null)
      }
      setForbiddenMessage(null)

      try {
        const data = await fetchPermissions()
        if (seq !== requestSeqRef.current) return
        setOverview(data)
        setLoadError(null)
      } catch (error) {
        if (seq !== requestSeqRef.current) return
        if (error instanceof ApiError && error.status === 401) {
          return
        }
        if (error instanceof ApiError && error.status === 403) {
          setForbiddenMessage(error.message)
          return
        }
        const msg = error instanceof Error ? error.message : '加载权限配置失败'
        if (options?.silent) {
          onNotifyRef.current?.('error', msg)
        } else {
          setLoadError(msg)
        }
      } finally {
        if (seq === requestSeqRef.current && !options?.silent) {
          setLoading(false)
        }
      }
    },
    [isAuthorizedRole],
  )

  useEffect(() => {
    setDirtyApps({})
    setDirtyViews({})
    setDirtyTables({})
    setSearchQuery('')
    setSectionFilter('all')
    setOverview(null)
    setLoadError(null)
    setForbiddenMessage(null)

    if (!isAuthorizedRole) {
      setLoading(false)
      return
    }
    void loadOverview()
  }, [currentUser.id, isAuthorizedRole, loadOverview])

  const managerCandidates = useMemo(
    () => (overview?.users ?? []).filter((u) => u.role === 'manager' || u.role === 'admin'),
    [overview?.users],
  )

  const tableNameById = useMemo(
    () => new Map((overview?.tables ?? []).map((t) => [t.id, t.name])),
    [overview?.tables],
  )

  const viewCountByAppId = useMemo(() => {
    const counts = new Map<string, number>()
    for (const v of overview?.views ?? []) {
      counts.set(v.appId, (counts.get(v.appId) ?? 0) + 1)
    }
    return counts
  }, [overview?.views])

  const normalizedQuery = searchQuery.trim().toLowerCase()

  const filteredApps = useMemo(() => {
    const list = overview?.apps ?? []
    if (!normalizedQuery) return list
    return list.filter((app) => {
      const tableName = tableNameById.get(app.tableId) ?? app.tableId
      return (
        app.name.toLowerCase().includes(normalizedQuery) ||
        app.createdByName.toLowerCase().includes(normalizedQuery) ||
        tableName.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [overview?.apps, normalizedQuery, tableNameById])

  const filteredViews = useMemo(() => {
    const list = overview?.views ?? []
    if (!normalizedQuery) return list
    return list.filter(
      (view) =>
        view.name.toLowerCase().includes(normalizedQuery) ||
        view.appName.toLowerCase().includes(normalizedQuery) ||
        view.createdByName.toLowerCase().includes(normalizedQuery),
    )
  }, [overview?.views, normalizedQuery])

  const filteredTables = useMemo(() => {
    const list = overview?.tables ?? []
    if (!normalizedQuery) return list
    return list.filter(
      (table) =>
        table.name.toLowerCase().includes(normalizedQuery) ||
        table.createdByName.toLowerCase().includes(normalizedQuery),
    )
  }, [overview?.tables, normalizedQuery])

  function getAppDraft(app: AppPermissionItem): AppDraft {
    return (
      dirtyApps[app.id] ?? {
        visibilityScope: app.visibilityScope,
        managerUserIds: app.managerUserIds,
        memberAccess: app.memberAccess,
      }
    )
  }

  function isAppDirty(app: AppPermissionItem): boolean {
    const draft = dirtyApps[app.id]
    if (!draft) return false
    return (
      draft.visibilityScope !== app.visibilityScope ||
      draft.memberAccess !== app.memberAccess ||
      !sameUserIdList(draft.managerUserIds, app.managerUserIds)
    )
  }

  function patchAppDraft(app: AppPermissionItem, patch: Partial<AppDraft>) {
    const base = getAppDraft(app)
    const next: AppDraft = { ...base, ...patch }
    setDirtyApps((prev) => ({ ...prev, [app.id]: next }))
  }

  function getViewDraft(view: ViewPermissionItem): ViewDraft {
    return (
      dirtyViews[view.id] ?? {
        visibilityScope: view.visibilityScope,
        managerUserIds: view.managerUserIds,
        memberAccess: view.memberAccess,
      }
    )
  }

  function isViewDirty(view: ViewPermissionItem): boolean {
    const draft = dirtyViews[view.id]
    if (!draft) return false
    return (
      draft.visibilityScope !== view.visibilityScope ||
      draft.memberAccess !== view.memberAccess ||
      !sameUserIdList(draft.managerUserIds, view.managerUserIds)
    )
  }

  function patchViewDraft(view: ViewPermissionItem, patch: Partial<ViewDraft>) {
    const base = getViewDraft(view)
    const next: ViewDraft = { ...base, ...patch }
    setDirtyViews((prev) => ({ ...prev, [view.id]: next }))
  }

  function getTableDraft(table: TablePermissionItem): TableDraft {
    return (
      dirtyTables[table.id] ?? {
        rowScope: table.rowScope,
        ownerColumnKey: table.ownerColumnKey,
        memberAccess: table.memberAccess,
      }
    )
  }

  function isTableDirty(table: TablePermissionItem): boolean {
    const draft = dirtyTables[table.id]
    if (!draft) return false
    return (
      draft.rowScope !== table.rowScope ||
      draft.ownerColumnKey !== table.ownerColumnKey ||
      draft.memberAccess !== table.memberAccess
    )
  }

  function patchTableDraft(table: TablePermissionItem, patch: Partial<TableDraft>) {
    const base = getTableDraft(table)
    const next: TableDraft = { ...base, ...patch }
    setDirtyTables((prev) => ({ ...prev, [table.id]: next }))
  }

  async function saveResource(key: string, action: () => Promise<void>, successMessage: string) {
    setSavingKey(key)
    try {
      await action()
      await loadOverview({ silent: true })
      await onPermissionsChanged?.()
      onNotify?.('success', successMessage)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return
      }
      const msg = error instanceof Error ? error.message : '保存权限配置失败'
      onNotify?.('error', msg)
    } finally {
      setSavingKey(null)
    }
  }

  async function handleSaveApp(app: AppPermissionItem) {
    const draft = getAppDraft(app)
    await saveResource(
      `app:${app.id}`,
      async () => {
        const saved = await updateAppPermissions(app.id, {
          visibilityScope: draft.visibilityScope,
          managerUserIds: draft.managerUserIds,
          memberAccess: draft.memberAccess,
        })
        setDirtyApps((prev) => omitRecordKey(prev, app.id))
        setOverview((prev) =>
          prev
            ? {
                ...prev,
                apps: prev.apps.map((item) =>
                  item.id === app.id
                    ? {
                        ...item,
                        visibilityScope: saved.visibilityScope ?? 'all',
                        managerUserIds: saved.managerUserIds ?? [],
                        memberAccess: saved.memberAccess ?? 'readonly',
                      }
                    : item,
                ),
              }
            : prev,
        )
      },
      `已保存应用「${app.name}」的权限配置`,
    )
  }

  async function handleSaveView(view: ViewPermissionItem) {
    const draft = getViewDraft(view)
    await saveResource(
      `view:${view.id}`,
      async () => {
        const saved = await updateViewPermissions(view.id, {
          visibilityScope: draft.visibilityScope,
          managerUserIds: draft.managerUserIds,
          memberAccess: draft.memberAccess,
        })
        setDirtyViews((prev) => omitRecordKey(prev, view.id))
        setOverview((prev) =>
          prev
            ? {
                ...prev,
                views: prev.views.map((item) =>
                  item.id === view.id
                    ? {
                        ...item,
                        visibilityScope: saved.visibilityScope ?? 'all',
                        managerUserIds: saved.managerUserIds ?? [],
                        memberAccess: saved.memberAccess ?? null,
                      }
                    : item,
                ),
              }
            : prev,
        )
      },
      `已保存视图「${view.name}」的权限配置`,
    )
  }

  async function handleSaveTable(table: TablePermissionItem) {
    const draft = getTableDraft(table)
    await saveResource(
      `table:${table.id}`,
      async () => {
        const saved = await updateTablePermissions(table.id, {
          rowScope: draft.rowScope,
          ownerColumnKey: draft.ownerColumnKey,
          ...(table.kind === 'normal' ? { memberAccess: draft.memberAccess } : {}),
        })
        setDirtyTables((prev) => omitRecordKey(prev, table.id))
        setOverview((prev) =>
          prev
            ? {
                ...prev,
                tables: prev.tables.map((item) =>
                  item.id === table.id
                    ? {
                        ...item,
                        rowScope: saved.rowScope ?? 'all',
                        ownerColumnKey: saved.ownerColumnKey ?? null,
                        memberAccess: saved.memberAccess ?? null,
                      }
                    : item,
                ),
              }
            : prev,
        )
      },
      `已保存数据表「${table.name}」的行级权限配置`,
    )
  }

  if (!isAuthorizedRole || forbiddenMessage) {
    return (
      <div
        data-testid="permissions-forbidden"
        className="flex h-full w-full flex-col items-center justify-center bg-slate-50 p-6"
      >
        <div className="flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <Lock className="h-6 w-6" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900">无权访问权限管理</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            {forbiddenMessage ??
              '仅管理员与负责人可配置智能表格应用/视图可见范围、成员操作权限与数据表行级策略。'}
          </p>
          <p className="mt-2.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            普通成员仅可按授权范围在「工作台」只读查看或协作编辑应用，以及在「数据录入」端填报授权数据表。
          </p>
          {onBackToWorkbench && (
            <button
              type="button"
              onClick={onBackToWorkbench}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>返回工作台</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  const totalCount =
    (overview?.apps.length ?? 0) + (overview?.views.length ?? 0) + (overview?.tables.length ?? 0)

  const showAppsSection = sectionFilter === 'all' || sectionFilter === 'apps'
  const showViewsSection = sectionFilter === 'all' || sectionFilter === 'views'
  const showTablesSection = sectionFilter === 'all' || sectionFilter === 'tables'

  return (
    <div
      data-testid="permissions-page"
      className="flex h-full w-full flex-col overflow-hidden bg-slate-50 text-slate-900"
    >
      {/* 顶部标题与检索栏 */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {onBackToWorkbench && (
            <button
              type="button"
              onClick={onBackToWorkbench}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-600 hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>工作台</span>
            </button>
          )}
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <h1 className="truncate text-sm font-semibold text-slate-900">权限管理</h1>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              currentUser.role === 'admin'
                ? 'bg-indigo-50 text-indigo-700'
                : 'bg-sky-50 text-sky-700'
            }`}
          >
            {currentUser.role === 'admin'
              ? '管理员 · 全空间权限矩阵'
              : '负责人 · 仅本人创建或负责资源'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              aria-label="搜索权限资源"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索应用、视图或数据表..."
              className="h-7 w-56 rounded-md border border-slate-200 bg-slate-50/70 pr-7 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
            {searchQuery !== '' && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setSearchQuery('')}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={loading || savingKey !== null}
            onClick={() => void loadOverview()}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
        </div>
      </header>

      {/* 分组导航条 + 两层权限模型说明 */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white/80 px-5 py-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="权限分类筛选"
        >
          {(
            [
              { id: 'all', label: '全部资源', count: totalCount },
              { id: 'apps', label: '智能表格应用', count: overview?.apps.length ?? 0 },
              { id: 'views', label: '应用视图', count: overview?.views.length ?? 0 },
              { id: 'tables', label: '数据源表行级策略', count: overview?.tables.length ?? 0 },
            ] as const
          ).map((tab) => {
            const active = sectionFilter === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSectionFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    active ? 'bg-white/20 text-white' : 'bg-white text-slate-500'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span>第一层控应用/视图可见范围与成员读写；第二层控表内行级范围与绑定人员列</span>
        </div>
      </div>

      {/* 主体权限矩阵区 */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {loading && !overview ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
            <div
              className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-600"
              aria-hidden="true"
            />
            <div className="text-xs">正在加载权限配置矩阵...</div>
          </div>
        ) : loadError && !overview ? (
          <div
            data-testid="permissions-error"
            className="mx-auto mt-12 flex max-w-md flex-col items-center rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm"
          >
            <ShieldCheck className="mb-2.5 h-7 w-7 text-slate-400" />
            <div className="text-sm font-semibold text-slate-900">权限矩阵加载失败</div>
            <p className="mt-1 text-xs text-slate-500">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadOverview()}
              className="mt-4 inline-flex h-8 items-center gap-1 rounded-md bg-blue-600 px-3.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              重试加载
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-6">
            {/* 第一层：智能表格应用 */}
            {showAppsSection && (
              <section aria-label="智能表格应用权限" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-blue-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      智能表格应用权限（第一层）
                    </h2>
                    <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {filteredApps.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    控制应用可见范围及下属视图默认成员操作权
                  </span>
                </div>

                {filteredApps.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-400">
                    {normalizedQuery
                      ? `没有匹配「${searchQuery}」的智能表格应用`
                      : '当前账号暂无可配置权限的智能表格应用'}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {filteredApps.map((app) => {
                      const draft = getAppDraft(app)
                      const dirty = isAppDirty(app)
                      const isSaving = savingKey === `app:${app.id}`
                      const tableName = tableNameById.get(app.tableId) ?? app.tableId
                      const viewCount = viewCountByAppId.get(app.id) ?? 0

                      return (
                        <article
                          key={app.id}
                          data-testid={`perm-app-${app.id}`}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900">
                                  {app.name}
                                </span>
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                  智能表格 · {viewCount} 视图
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                                <span>创建人：{app.createdByName}</span>
                                <span>绑定数据源：{tableName}</span>
                              </div>
                            </div>
                          </div>

                          <ScopedAccessEditor
                            resourceLabel={`应用 ${app.name}`}
                            visibilityScope={draft.visibilityScope}
                            managerUserIds={draft.managerUserIds}
                            managerCandidates={managerCandidates}
                            memberAccessValue={draft.memberAccess}
                            memberAccessOptions={APP_MEMBER_ACCESS_OPTIONS}
                            disabled={isSaving}
                            onChangeVisibility={(visibilityScope) =>
                              patchAppDraft(app, { visibilityScope })
                            }
                            onChangeManagers={(managerUserIds) =>
                              patchAppDraft(app, { managerUserIds })
                            }
                            onChangeMemberAccess={(memberAccess) =>
                              patchAppDraft(app, { memberAccess })
                            }
                          />

                          <ResourceSaveBar
                            resourceKindLabel="应用"
                            resourceName={app.name}
                            dirty={dirty}
                            saving={isSaving}
                            onReset={() => setDirtyApps((prev) => omitRecordKey(prev, app.id))}
                            onSave={() => void handleSaveApp(app)}
                          />
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {/* 第一层：应用视图 */}
            {showViewsSection && (
              <section aria-label="应用视图权限" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Table2 className="h-4 w-4 text-violet-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      应用视图权限（第一层精细覆盖）
                    </h2>
                    <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {filteredViews.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    受所属应用可见范围约束，支持独立收窄视图可见人与覆盖普通成员授权
                  </span>
                </div>

                {filteredViews.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-400">
                    {normalizedQuery
                      ? `没有匹配「${searchQuery}」的应用视图`
                      : '当前账号暂无可配置权限的应用视图'}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {filteredViews.map((view) => {
                      const draft = getViewDraft(view)
                      const dirty = isViewDirty(view)
                      const isSaving = savingKey === `view:${view.id}`
                      const memberOptions: SegmentedOption<MemberAccessChoice>[] = [
                        {
                          value: 'inherit',
                          label: `继承应用（当前：${view.effectiveMemberAccess === 'editable' ? '可编辑' : '只读'}）`,
                          title: '跟随所属智能表格应用的普通成员授权级别',
                        },
                        { value: 'readonly', label: '只读' },
                        { value: 'editable', label: '可编辑' },
                      ]

                      return (
                        <article
                          key={view.id}
                          data-testid={`perm-view-${view.id}`}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <ViewTypeIcon type={view.type} className="h-4 w-4 shrink-0" />
                                <span className="text-sm font-semibold text-slate-900">
                                  {view.name}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                  {VIEW_TYPE_LABELS[view.type]}
                                </span>
                                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                  所属应用：{view.appName || view.appId}
                                </span>
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                创建人：{view.createdByName}
                              </div>
                            </div>
                          </div>

                          <ScopedAccessEditor
                            resourceLabel={`视图 ${view.name}`}
                            visibilityScope={draft.visibilityScope}
                            managerUserIds={draft.managerUserIds}
                            managerCandidates={managerCandidates}
                            memberAccessValue={toMemberChoice(draft.memberAccess)}
                            memberAccessOptions={memberOptions}
                            disabled={isSaving}
                            onChangeVisibility={(visibilityScope) =>
                              patchViewDraft(view, { visibilityScope })
                            }
                            onChangeManagers={(managerUserIds) =>
                              patchViewDraft(view, { managerUserIds })
                            }
                            onChangeMemberAccess={(choice) =>
                              patchViewDraft(view, { memberAccess: fromMemberChoice(choice) })
                            }
                          />

                          <ResourceSaveBar
                            resourceKindLabel="视图"
                            resourceName={view.name}
                            dirty={dirty}
                            saving={isSaving}
                            onReset={() => setDirtyViews((prev) => omitRecordKey(prev, view.id))}
                            onSave={() => void handleSaveView(view)}
                          />
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {/* 第二层：数据源表行级数据范围与业务负责人人员列绑定 */}
            {showTablesSection && (
              <section aria-label="数据源表行级权限" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-emerald-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      数据源表行级权限与负责人列绑定（第二层）
                    </h2>
                    <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {filteredTables.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    绑定 person 人员列后，按业务负责人姓名或记录创建人过滤表内数据行
                  </span>
                </div>

                {filteredTables.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-400">
                    {normalizedQuery
                      ? `没有匹配「${searchQuery}」的数据源表`
                      : '当前账号暂无可配置行级策略的数据源表'}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {filteredTables.map((table) => {
                      const draft = getTableDraft(table)
                      const dirty = isTableDirty(table)
                      const isSaving = savingKey === `table:${table.id}`
                      const personOptions = [
                        { value: '', label: '不绑定人员列（仅按创建人 createdBy 判定）' },
                        ...table.personColumns.map((col) => ({
                          value: col.key,
                          label: `${col.title} (${col.key})`,
                        })),
                      ]

                      return (
                        <article
                          key={table.id}
                          data-testid={`perm-table-${table.id}`}
                          className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900">
                                  {table.name}
                                </span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    table.kind === 'advanced'
                                      ? 'bg-amber-50 text-amber-700'
                                      : 'bg-emerald-50 text-emerald-700'
                                  }`}
                                >
                                  {table.kind === 'advanced' ? 'SQL 主数据表' : '普通表'}
                                </span>
                              </div>
                              <div className="mt-1 text-[11px] text-slate-500">
                                创建人：{table.createdByName}
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap items-start gap-5">
                            <SegmentedToggle
                              label="行级数据范围"
                              ariaLabel={`数据表 ${table.name} 行级数据范围`}
                              value={draft.rowScope}
                              options={ROW_SCOPE_OPTIONS}
                              disabled={isSaving}
                              onChange={(rowScope) => patchTableDraft(table, { rowScope })}
                            />

                            <div className="min-w-[260px] flex-1 space-y-1">
                              <div className="text-[11px] font-medium text-slate-500">
                                绑定业务负责人列（person 类型）
                              </div>
                              <CustomSelect
                                size="sm"
                                className="w-full max-w-sm"
                                ariaLabel={`绑定 ${table.name} 业务负责人列`}
                                value={draft.ownerColumnKey ?? ''}
                                options={personOptions}
                                disabled={isSaving || table.personColumns.length === 0}
                                onChange={(val) =>
                                  patchTableDraft(table, {
                                    ownerColumnKey: val === '' ? null : val,
                                  })
                                }
                              />
                              {table.personColumns.length === 0 && (
                                <p className="text-[11px] text-slate-400">
                                  该表暂无 person 类型列，行归属将仅按记录创建人 createdBy 判定。
                                </p>
                              )}
                            </div>

                            {table.kind === 'normal' && (
                              <SegmentedToggle
                                label="独立录入端成员授权"
                                ariaLabel={`数据表 ${table.name} 独立录入端成员授权`}
                                value={toMemberChoice(draft.memberAccess)}
                                options={TABLE_MEMBER_ACCESS_OPTIONS}
                                disabled={isSaving}
                                onChange={(choice) =>
                                  patchTableDraft(table, {
                                    memberAccess: fromMemberChoice(choice),
                                  })
                                }
                              />
                            )}
                          </div>

                          <p className="mt-2 text-[11px] text-slate-500">
                            生效说明：{ROW_SCOPE_DESCRIPTIONS[draft.rowScope]}
                          </p>

                          <ResourceSaveBar
                            resourceKindLabel="数据表"
                            resourceName={table.name}
                            dirty={dirty}
                            saving={isSaving}
                            onReset={() => setDirtyTables((prev) => omitRecordKey(prev, table.id))}
                            onSave={() => void handleSaveTable(table)}
                          />
                        </article>
                      )
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
