// 纯领域权限与分享边界判定模块（无数据库/HTTP 依赖，供服务端鉴权与前端状态计算共享）。

import type {
  AuthUser,
  MemberAccessLevel,
  ResourceCapabilities,
  ResourceVisibilityScope,
  ShareRecord,
  ShareStatus,
  ShareTargetType,
  SmartApp,
  SmartRecord,
  SmartTableMeta,
  UserCapabilities,
  WorkspaceView,
} from '../shared/schema'

interface ScopedResourceLike {
  createdBy?: string
  visibilityScope?: ResourceVisibilityScope
  managerUserIds?: readonly string[]
}

/** 计算当前登录用户的全局功能能力 */
export function computeUserCapabilities(user: AuthUser): UserCapabilities {
  const isAdmin = user.role === 'admin'
  const isManagerOrAdmin = isAdmin || user.role === 'manager'
  return {
    canAccessDataSources: isManagerOrAdmin,
    canCreateTable: isManagerOrAdmin,
    canCreateApp: isManagerOrAdmin,
    canManagePermissions: isManagerOrAdmin,
    canManageShares: isManagerOrAdmin,
    canResetSeed: isAdmin,
  }
}

/** 判断用户是否有数据源中心管理权限 */
export function canManageDataSource(user: AuthUser): boolean {
  return user.role === 'admin' || user.role === 'manager'
}

/** 共享的可见范围判定（self / managers / all） */
function canViewScopedResource(user: AuthUser, resource: ScopedResourceLike): boolean {
  if (user.role === 'admin') return true
  if (resource.createdBy !== undefined && resource.createdBy === user.id) return true
  const scope = resource.visibilityScope ?? 'all'
  if (scope === 'all') return true
  if (scope === 'self') return false
  return user.role === 'manager' && (resource.managerUserIds ?? []).includes(user.id)
}

/** 共享的配置管理权判定（管理员、创建者或指定负责人） */
function canManageScopedResource(user: AuthUser, resource: ScopedResourceLike): boolean {
  if (user.role === 'admin') return true
  if (user.role !== 'manager') return false
  if (resource.createdBy !== undefined && resource.createdBy === user.id) return true
  return (
    resource.visibilityScope === 'managers' && (resource.managerUserIds ?? []).includes(user.id)
  )
}

/** 判断用户是否可见指定多维数据台应用 */
export function canViewApp(user: AuthUser, app: SmartApp): boolean {
  return canViewScopedResource(user, app)
}

/** 判断用户是否可配置/删除/分享指定多维数据台应用 */
export function canConfigureApp(user: AuthUser, app: SmartApp): boolean {
  return canManageScopedResource(user, app)
}

/** 判断用户是否可见指定应用视图（受所属应用与视图自身双层可见范围约束） */
export function canViewView(
  user: AuthUser,
  view: WorkspaceView,
  parentApp: SmartApp | undefined | null,
): boolean {
  if (!parentApp || !canViewApp(user, parentApp)) return false
  return canViewScopedResource(user, view)
}

/** 判断用户是否可配置/删除/分享指定应用视图 */
export function canConfigureView(
  user: AuthUser,
  view: WorkspaceView,
  parentApp: SmartApp | undefined | null,
): boolean {
  if (user.role === 'admin') return true
  if (user.role !== 'manager' || !parentApp || !canViewView(user, view, parentApp)) return false
  return canManageScopedResource(user, view) || canConfigureApp(user, parentApp)
}

/** 解析视图生效的普通成员授权级别（未在视图显式覆盖时继承所属多维数据台） */
export function getEffectiveMemberAccess(
  parentApp: SmartApp | undefined | null,
  view?: WorkspaceView | null,
): MemberAccessLevel {
  if (view?.memberAccess !== undefined) {
    return view.memberAccess
  }
  return parentApp?.memberAccess ?? 'readonly'
}

/** 判断用户在指定应用或视图下是否允许增删改数据行 */
export function canEditAppRecords(
  user: AuthUser,
  app: SmartApp,
  view?: WorkspaceView | null,
): boolean {
  if (view) {
    if (!canViewView(user, view, app)) return false
  } else if (!canViewApp(user, app)) {
    return false
  }
  if (user.role === 'admin' || user.role === 'manager') return true
  return getEffectiveMemberAccess(app, view) === 'editable'
}

/** 判断用户是否可读取指定数据源表（含作为可见应用的绑定源表或 VLOOKUP 目标表） */
export function canViewTable(
  user: AuthUser,
  table: SmartTableMeta,
  allApps: readonly SmartApp[],
): boolean {
  if (user.role === 'admin') return true
  if (table.createdBy !== undefined && table.createdBy === user.id) return true
  if (user.role === 'member' && table.memberAccess === 'editable') return true

  const visibleApps = allApps.filter((app) => canViewApp(user, app))
  if (visibleApps.some((app) => app.tableId === table.id)) return true
  return visibleApps.some((app) =>
    (app.derivedColumns ?? []).some(
      (col) => col.type === 'lookup' && col.lookupConfig?.targetTableId === table.id,
    ),
  )
}

/** 判断用户是否可配置/删除数据源表或配置其行级权限 */
export function canConfigureTable(
  user: AuthUser,
  table: SmartTableMeta,
  appsForTable: readonly SmartApp[],
): boolean {
  if (user.role === 'admin') return true
  if (user.role !== 'manager') return false
  if (table.createdBy !== undefined && table.createdBy === user.id) return true
  return appsForTable.some((app) => canConfigureApp(user, app))
}

/** 判断普通成员在单个可见应用下是否具有写行权限 */
function canMemberWriteViaVisibleApp(
  user: AuthUser,
  app: SmartApp,
  allViews: readonly WorkspaceView[],
): boolean {
  if (!canViewApp(user, app)) return false
  const visibleViews = allViews.filter((v) => v.appId === app.id && canViewView(user, v, app))
  if (visibleViews.length === 0) {
    return app.memberAccess === 'editable'
  }
  return visibleViews.some((v) => getEffectiveMemberAccess(app, v) === 'editable')
}

/** 判断用户是否允许对指定数据源表执行记录增删改操作（表/应用层级校验，行归属另行校验） */
export function canWriteTableRecords(
  user: AuthUser,
  table: SmartTableMeta,
  allApps: readonly SmartApp[],
  allViews: readonly WorkspaceView[],
  context?: { appId?: string; viewId?: string },
): boolean {
  if (!canViewTable(user, table, allApps)) return false
  if (user.role === 'admin' || user.role === 'manager') return true

  if (context?.viewId) {
    const view = allViews.find((v) => v.id === context.viewId)
    if (!view || view.tableId !== table.id) return false
    const parentApp = allApps.find((a) => a.id === view.appId)
    return parentApp != null && canEditAppRecords(user, parentApp, view)
  }

  if (context?.appId) {
    const app = allApps.find((a) => a.id === context.appId)
    if (!app || app.tableId !== table.id) return false
    return canMemberWriteViaVisibleApp(user, app, allViews)
  }

  if (table.memberAccess === 'editable') return true
  return allApps
    .filter((app) => app.tableId === table.id)
    .some((app) => canMemberWriteViaVisibleApp(user, app, allViews))
}

/** 判断记录是否归属于当前用户（createdBy 或绑定 person 列匹配用户名/显示名） */
export function isRecordOwnedByUser(
  user: AuthUser,
  table: SmartTableMeta,
  record: SmartRecord,
): boolean {
  if (record.createdBy !== undefined && record.createdBy === user.id) {
    return true
  }
  if (!table.ownerColumnKey) return false
  const ownerCol = table.columns.find(
    (col) => col.key === table.ownerColumnKey && col.type === 'person',
  )
  if (!ownerCol) return false

  const rawValue = record[ownerCol.key]
  if (typeof rawValue !== 'string') return false
  const trimmed = rawValue.trim()
  if (trimmed === '') return false
  return trimmed === user.displayName || trimmed === user.username
}

/** 判断用户是否可访问（读写）指定数据表中的单行记录 */
export function canAccessRecord(
  user: AuthUser,
  table: SmartTableMeta,
  record: SmartRecord,
): boolean {
  if (user.role === 'admin') return true
  const rowScope = table.rowScope ?? 'all'
  if (rowScope === 'all') return true
  if (rowScope === 'manager') {
    return user.role === 'manager' ? true : isRecordOwnedByUser(user, table, record)
  }
  return isRecordOwnedByUser(user, table, record)
}

/** 按用户表内行级权限过滤记录列表 */
export function filterTableRecordsForUser(
  user: AuthUser,
  table: SmartTableMeta,
  records: readonly SmartRecord[],
): SmartRecord[] {
  const rowScope = table.rowScope ?? 'all'
  if (user.role === 'admin' || rowScope === 'all') {
    return [...records]
  }
  if (rowScope === 'manager' && user.role === 'manager') {
    return [...records]
  }
  return records.filter((record) => canAccessRecord(user, table, record))
}

/** 判断用户是否有权对目标资源创建分享链接（仅管理员与资源创建者/负责人） */
export function canCreateShareForTarget(
  user: AuthUser,
  targetType: ShareTargetType,
  target: {
    app?: SmartApp | null
    view?: WorkspaceView | null
    table?: SmartTableMeta | null
    appsForTable?: readonly SmartApp[]
  },
): boolean {
  if (user.role === 'member') return false
  if (targetType === 'app') {
    return target.app != null && canConfigureApp(user, target.app)
  }
  if (targetType === 'view') {
    return target.view != null && canConfigureView(user, target.view, target.app)
  }
  return (
    target.table != null &&
    target.table.kind === 'normal' &&
    canConfigureTable(user, target.table, target.appsForTable ?? [])
  )
}

/** 判断用户是否可查看/失效指定分享记录（管理员全空间，负责人仅本人创建） */
export function canManageShare(user: AuthUser, share: Pick<ShareRecord, 'createdBy'>): boolean {
  if (user.role === 'admin') return true
  if (user.role === 'manager') return share.createdBy === user.id
  return false
}

/** 计算分享链接当前生命周期状态 */
export function resolveShareStatus(
  share: Pick<ShareRecord, 'expiresAt' | 'revokedAt'>,
  now: Date = new Date(),
): ShareStatus {
  if (share.revokedAt) return 'revoked'
  if (share.expiresAt) {
    const expMs = Date.parse(share.expiresAt)
    if (Number.isFinite(expMs) && expMs <= now.getTime()) {
      return 'expired'
    }
  }
  return 'active'
}

/** 计算登录用户在多维数据台应用上的操作能力快照 */
export function computeAppCapabilities(user: AuthUser, app: SmartApp): ResourceCapabilities {
  const canView = canViewApp(user, app)
  const canConfigure = canConfigureApp(user, app)
  return {
    canView,
    canEditRecords: canEditAppRecords(user, app),
    canConfigure,
    canManagePermissions: canConfigure,
    canCreateShare: canConfigure,
    canManageDataSource: canManageDataSource(user),
  }
}

/** 计算登录用户在应用视图上的操作能力快照 */
export function computeViewCapabilities(
  user: AuthUser,
  view: WorkspaceView,
  parentApp: SmartApp | undefined | null,
): ResourceCapabilities {
  const canView = canViewView(user, view, parentApp)
  const canConfigure = canConfigureView(user, view, parentApp)
  return {
    canView,
    canEditRecords: parentApp != null && canEditAppRecords(user, parentApp, view),
    canConfigure,
    canManagePermissions: canConfigure,
    canCreateShare: canConfigure,
    canManageDataSource: canManageDataSource(user),
  }
}

/** 计算登录用户在数据源表上的操作能力快照 */
export function computeTableCapabilities(
  user: AuthUser,
  table: SmartTableMeta,
  allApps: readonly SmartApp[],
  allViews: readonly WorkspaceView[],
): ResourceCapabilities {
  const canView = canViewTable(user, table, allApps)
  const appsForTable = allApps.filter((a) => a.tableId === table.id)
  const canConfigure = canConfigureTable(user, table, appsForTable)
  return {
    canView,
    canEditRecords: canWriteTableRecords(user, table, allApps, allViews),
    canConfigure,
    canManagePermissions: canConfigure,
    canCreateShare: canConfigure && table.kind === 'normal',
    canManageDataSource: canManageDataSource(user) && canView,
  }
}

/** 计算免登录访客在分享视图上的能力快照（应用/视图严格只读，录入表可填报） */
export function computeGuestShareCapabilities(targetType: ShareTargetType): ResourceCapabilities {
  return {
    canView: true,
    canEditRecords: targetType === 'entry',
    canConfigure: false,
    canManagePermissions: false,
    canCreateShare: false,
    canManageDataSource: false,
  }
}

/** 按可见记录集裁剪 VLOOKUP 消歧锁定映射，避免泄露不可见记录 ID */
export function filterLookupOverridesForRecords(
  overrides: Record<string, Record<string, string>> | undefined,
  visibleRecords: readonly SmartRecord[],
): Record<string, Record<string, string>> {
  if (!overrides) return {}
  const visibleIds = new Set(visibleRecords.map((r) => r._id))
  const filtered: Record<string, Record<string, string>> = {}
  for (const [recId, groupMap] of Object.entries(overrides)) {
    if (visibleIds.has(recId)) {
      filtered[recId] = { ...groupMap }
    }
  }
  return filtered
}
