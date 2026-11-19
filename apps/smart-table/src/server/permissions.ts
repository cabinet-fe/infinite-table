// 服务端两层权限配置读写与校验封装（/api/permissions*）。

import type { Database } from 'bun:sqlite'
import {
  canConfigureApp,
  canConfigureTable,
  canConfigureView,
  getEffectiveMemberAccess,
} from '../domain/permissions'
import type {
  AppPermissionItem,
  PermissionsOverviewResponse,
  TablePermissionItem,
  UpdateAppPermissionRequest,
  UpdateTablePermissionRequest,
  UpdateViewPermissionRequest,
  ViewPermissionItem,
} from '../shared/api-types'
import {
  isValidMemberAccessLevel,
  isValidTableRowScope,
  isValidVisibilityScope,
  type AuthUser,
  type MemberAccessLevel,
  type ResourceVisibilityScope,
  type SmartApp,
  type SmartTableMeta,
  type TableRowScope,
  type WorkspaceView,
} from '../shared/schema'
import { listUsers } from './auth'
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  getTableMeta,
  isPlainObject,
  listTableMetas,
} from './db'
import { getSmartApp, getWorkspaceView, listSmartApps, listWorkspaceViews } from './views-store'

function resolveCreatorName(userMap: ReadonlyMap<string, AuthUser>, createdBy?: string): string {
  if (!createdBy) return '系统预置'
  return userMap.get(createdBy)?.displayName ?? createdBy
}

function validateManagerUserIds(db: Database, rawIds: unknown): string[] {
  if (!Array.isArray(rawIds) || !rawIds.every((id) => typeof id === 'string')) {
    throw new ValidationError('managerUserIds 必须为字符串数组')
  }
  const userMap = new Map(listUsers(db).map((u) => [u.id, u]))
  const unique: string[] = []
  const seen = new Set<string>()
  for (const raw of rawIds) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    const found = userMap.get(id)
    if (!found) {
      throw new ValidationError(`指定的负责人用户不存在: "${id}"`)
    }
    if (found.role !== 'manager' && found.role !== 'admin') {
      throw new ValidationError(`用户 "${found.displayName}" 不是负责人或管理员角色`)
    }
    seen.add(id)
    unique.push(id)
  }
  return unique
}

function validateScopeAndManagersPatch(
  db: Database,
  currentScope: ResourceVisibilityScope,
  currentManagers: readonly string[],
  payload: { visibilityScope?: unknown; managerUserIds?: unknown },
): { visibilityScope: ResourceVisibilityScope; managerUserIds: string[] } {
  let visibilityScope = currentScope
  if (payload.visibilityScope !== undefined) {
    if (!isValidVisibilityScope(payload.visibilityScope)) {
      throw new ValidationError('visibilityScope 必须为 self / managers / all')
    }
    visibilityScope = payload.visibilityScope
  }

  let managerUserIds = [...currentManagers]
  if (payload.managerUserIds !== undefined) {
    managerUserIds = validateManagerUserIds(db, payload.managerUserIds)
  }

  return { visibilityScope, managerUserIds }
}

/** 读取当前用户有权管理的权限配置概览 */
export function getPermissionsOverview(
  db: Database,
  currentUser: AuthUser,
): PermissionsOverviewResponse {
  if (currentUser.role === 'member') {
    throw new ForbiddenError('普通成员无权访问权限管理')
  }

  const users = listUsers(db)
  const userMap = new Map(users.map((u) => [u.id, u]))
  const allApps = listSmartApps(db)
  const appMap = new Map(allApps.map((a) => [a.id, a]))
  const allViews = listWorkspaceViews(db)
  const allTables = listTableMetas(db)

  const apps: AppPermissionItem[] = allApps
    .filter((app) => canConfigureApp(currentUser, app))
    .map((app) => ({
      id: app.id,
      name: app.name,
      tableId: app.tableId,
      createdBy: app.createdBy ?? null,
      createdByName: resolveCreatorName(userMap, app.createdBy),
      visibilityScope: app.visibilityScope ?? 'all',
      managerUserIds: app.managerUserIds ?? [],
      memberAccess: app.memberAccess ?? 'readonly',
    }))

  const views: ViewPermissionItem[] = allViews
    .filter((view) => canConfigureView(currentUser, view, appMap.get(view.appId)))
    .map((view) => {
      const parentApp = appMap.get(view.appId)
      return {
        id: view.id,
        appId: view.appId,
        appName: parentApp?.name ?? '',
        tableId: view.tableId,
        name: view.name,
        type: view.type,
        createdBy: view.createdBy ?? null,
        createdByName: resolveCreatorName(userMap, view.createdBy),
        visibilityScope: view.visibilityScope ?? 'all',
        managerUserIds: view.managerUserIds ?? [],
        memberAccess: view.memberAccess ?? null,
        effectiveMemberAccess: getEffectiveMemberAccess(parentApp, view),
      }
    })

  const tables: TablePermissionItem[] = allTables
    .filter((table) => {
      const appsForTable = allApps.filter((a) => a.tableId === table.id)
      return canConfigureTable(currentUser, table, appsForTable)
    })
    .map((table) => ({
      id: table.id,
      name: table.name,
      kind: table.kind,
      createdBy: table.createdBy ?? null,
      createdByName: resolveCreatorName(userMap, table.createdBy),
      rowScope: table.rowScope ?? 'all',
      ownerColumnKey: table.ownerColumnKey ?? null,
      memberAccess: table.memberAccess ?? null,
      personColumns: table.columns
        .filter((c) => c.type === 'person')
        .map((c) => ({ key: c.key, title: c.title })),
    }))

  return { users, apps, views, tables }
}

/** 更新多维数据台应用权限配置 */
export function updateAppPermissions(
  db: Database,
  currentUser: AuthUser,
  appId: string,
  payload: unknown,
): SmartApp {
  if (currentUser.role === 'member') {
    throw new ForbiddenError('普通成员无权修改应用权限配置')
  }
  if (!isPlainObject(payload)) {
    throw new ValidationError('请求体必须为权限配置对象')
  }
  const existing = getSmartApp(db, appId)
  if (!existing) {
    throw new NotFoundError('多维数据台不存在')
  }
  if (!canConfigureApp(currentUser, existing)) {
    throw new ForbiddenError('无权修改该多维数据台的权限配置')
  }

  const req = payload as UpdateAppPermissionRequest
  const { visibilityScope, managerUserIds } = validateScopeAndManagersPatch(
    db,
    existing.visibilityScope ?? 'all',
    existing.managerUserIds ?? [],
    req,
  )

  let memberAccess: MemberAccessLevel = existing.memberAccess ?? 'readonly'
  if (req.memberAccess !== undefined) {
    if (!isValidMemberAccessLevel(req.memberAccess)) {
      throw new ValidationError('memberAccess 必须为 readonly / editable')
    }
    memberAccess = req.memberAccess
  }

  const now = new Date().toISOString()
  db.query(
    'UPDATE smart_apps SET visibility_scope = ?, manager_user_ids_json = ?, member_access = ?, updated_at = ? WHERE id = ?',
  ).run(visibilityScope, JSON.stringify(managerUserIds), memberAccess, now, appId)

  return getSmartApp(db, appId)!
}

/** 更新应用视图权限配置 */
export function updateViewPermissions(
  db: Database,
  currentUser: AuthUser,
  viewId: string,
  payload: unknown,
): WorkspaceView {
  if (currentUser.role === 'member') {
    throw new ForbiddenError('普通成员无权修改视图权限配置')
  }
  if (!isPlainObject(payload)) {
    throw new ValidationError('请求体必须为权限配置对象')
  }
  const existing = getWorkspaceView(db, viewId)
  if (!existing) {
    throw new NotFoundError('视图不存在')
  }
  const parentApp = getSmartApp(db, existing.appId)
  if (!canConfigureView(currentUser, existing, parentApp)) {
    throw new ForbiddenError('无权修改该视图的权限配置')
  }

  const req = payload as UpdateViewPermissionRequest
  const { visibilityScope, managerUserIds } = validateScopeAndManagersPatch(
    db,
    existing.visibilityScope ?? 'all',
    existing.managerUserIds ?? [],
    req,
  )

  let memberAccess: MemberAccessLevel | null = existing.memberAccess ?? null
  if ('memberAccess' in req && req.memberAccess !== undefined) {
    if (req.memberAccess === null) {
      memberAccess = null
    } else if (!isValidMemberAccessLevel(req.memberAccess)) {
      throw new ValidationError('memberAccess 必须为 readonly / editable 或 null')
    } else {
      memberAccess = req.memberAccess
    }
  }

  const now = new Date().toISOString()
  db.query(
    'UPDATE workspace_views SET visibility_scope = ?, manager_user_ids_json = ?, member_access = ?, updated_at = ? WHERE id = ?',
  ).run(visibilityScope, JSON.stringify(managerUserIds), memberAccess, now, viewId)

  return getWorkspaceView(db, viewId)!
}

/** 更新数据表行级数据范围与绑定人员列配置 */
export function updateTablePermissions(
  db: Database,
  currentUser: AuthUser,
  tableId: string,
  payload: unknown,
): SmartTableMeta {
  if (currentUser.role === 'member') {
    throw new ForbiddenError('普通成员无权修改数据表权限配置')
  }
  if (!isPlainObject(payload)) {
    throw new ValidationError('请求体必须为表权限配置对象')
  }
  const existing = getTableMeta(db, tableId)
  if (!existing) {
    throw new NotFoundError('数据表不存在')
  }
  const appsForTable = listSmartApps(db).filter((a) => a.tableId === tableId)
  if (!canConfigureTable(currentUser, existing, appsForTable)) {
    throw new ForbiddenError('无权修改该数据表的行级权限配置')
  }

  const req = payload as UpdateTablePermissionRequest
  let rowScope: TableRowScope = existing.rowScope ?? 'all'
  if (req.rowScope !== undefined) {
    if (!isValidTableRowScope(req.rowScope)) {
      throw new ValidationError('rowScope 必须为 self / manager / all')
    }
    rowScope = req.rowScope
  }

  let ownerColumnKey: string | null = existing.ownerColumnKey ?? null
  if ('ownerColumnKey' in req && req.ownerColumnKey !== undefined) {
    if (req.ownerColumnKey === null || req.ownerColumnKey === '') {
      ownerColumnKey = null
    } else if (typeof req.ownerColumnKey !== 'string') {
      throw new ValidationError('ownerColumnKey 必须为字符串或 null')
    } else {
      const trimmedKey = req.ownerColumnKey.trim()
      if (trimmedKey === '') {
        ownerColumnKey = null
      } else {
        const targetCol = existing.columns.find((col) => col.key === trimmedKey)
        if (!targetCol) {
          throw new ValidationError(`数据源表中不存在字段 "${trimmedKey}"`)
        }
        if (targetCol.type !== 'person') {
          throw new ValidationError(
            `字段 "${targetCol.title}" 不是人员列（person），无法绑定为业务负责人列`,
          )
        }
        ownerColumnKey = trimmedKey
      }
    }
  }

  let memberAccess: MemberAccessLevel | null = existing.memberAccess ?? null
  if ('memberAccess' in req && req.memberAccess !== undefined) {
    if (req.memberAccess === null) {
      memberAccess = null
    } else if (!isValidMemberAccessLevel(req.memberAccess)) {
      throw new ValidationError('memberAccess 必须为 readonly / editable 或 null')
    } else {
      memberAccess = req.memberAccess
    }
  }

  const now = new Date().toISOString()
  db.query(
    'UPDATE smart_tables SET row_scope = ?, owner_column_key = ?, member_access = ?, updated_at = ? WHERE id = ?',
  ).run(rowScope, ownerColumnKey, memberAccess, now, tableId)

  return getTableMeta(db, tableId)!
}
