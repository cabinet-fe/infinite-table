// REST API 路由：身份认证、全局鉴权守卫、两层权限配置、一键分享与免登录访客接口，
// 以及受权限约束的数据源表/记录/智能表格/视图/导入/重置接口。
import type { Database } from 'bun:sqlite'
import type { Context, Hono } from 'hono'
import {
  canAccessRecord,
  canConfigureApp,
  canConfigureTable,
  canConfigureView,
  canEditAppRecords,
  canManageDataSource,
  canViewApp,
  canViewTable,
  canViewView,
  canWriteTableRecords,
  computeAppCapabilities,
  computeTableCapabilities,
  computeUserCapabilities,
  computeViewCapabilities,
  filterLookupOverridesForRecords,
  filterTableRecordsForUser,
} from '../domain/permissions'
import type {
  AllAppsResponse,
  AllTablesResponse,
  AllViewsResponse,
  AuthSessionResponse,
  BatchImportRecordsRequest,
  CreateAppRequest,
  CreateRecordRequest,
  CreateTableRequest,
  CreateViewRequest,
  DemoAccountsResponse,
  ImportCommitRequest,
  KanbanMoveCardRequest,
  LoginRequest,
  ReorderAppsRequest,
  ReorderViewsRequest,
  TableBundle,
  UpdateAppRequest,
  UpdateRecordRequest,
  UpdateTableMetaRequest,
  UpdateViewRequest,
} from '../shared/api-types'
import type { AuthUser, SmartApp, WorkspaceView } from '../shared/schema'
import {
  SESSION_COOKIE_NAME,
  authenticateUser,
  buildClearSessionCookieHeader,
  buildCookieAttributeString,
  buildSessionCookieHeader,
  createSession,
  deleteSessionByToken,
  getDemoAccounts,
  parseCookieHeader,
  resolveSessionByToken,
} from './auth'
import {
  BatchValidationError,
  ForbiddenError,
  NotFoundError,
  ShareGoneError,
  UnauthorizedError,
  ValidationError,
  batchCreateTableRecords,
  createTableRecord,
  deleteTable,
  deleteTableRecord,
  getTableBundle,
  getTableMeta,
  getTableRecordById,
  insertNormalTable,
  isPlainObject,
  listTableBundles,
  updateTableMeta,
  updateTableRecord,
} from './db'
import { commitImport } from './import'
import {
  getPermissionsOverview,
  updateAppPermissions,
  updateTablePermissions,
  updateViewPermissions,
} from './permissions'
import { seedSmartTableDemo } from './seed'
import {
  createShare,
  getShareUnlockCookieName,
  listShares,
  resolveGuestShareAccess,
  revokeShare,
  submitShareEntryRecord,
  verifySharePasswordAccess,
} from './shares'
import {
  createSmartApp,
  createWorkspaceView,
  deleteSmartApp,
  deleteWorkspaceView,
  getSmartApp,
  getWorkspaceView,
  listSmartApps,
  listWorkspaceViews,
  moveKanbanCard,
  reorderSmartApps,
  reorderWorkspaceViews,
  updateSmartApp,
  updateWorkspaceView,
} from './views-store'

interface RequestAuthState {
  user: AuthUser
  expiresAt: string
}

const requestAuthMap = new WeakMap<Request, RequestAuthState>()

function requireRequestAuth(c: Context): RequestAuthState {
  const state = requestAuthMap.get(c.req.raw)
  if (!state) {
    throw new UnauthorizedError('未登录或会话已过期，请先登录')
  }
  return state
}

function isHttpsRequest(c: Context): boolean {
  const proto = c.req.header('X-Forwarded-Proto')?.toLowerCase()
  if (proto === 'https') return true
  return c.req.url.startsWith('https://')
}

function isPublicApiPath(path: string): boolean {
  if (
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path === '/api/auth/demo-accounts'
  ) {
    return true
  }
  return path === '/api/s' || path.startsWith('/api/s/')
}

function isLoginBody(body: unknown): body is LoginRequest {
  if (!isPlainObject(body)) return false
  return (
    typeof body.username === 'string' &&
    body.username.trim() !== '' &&
    typeof body.password === 'string' &&
    body.password !== ''
  )
}

function isCreateTableBody(body: unknown): body is CreateTableRequest {
  if (!isPlainObject(body)) return false
  if (typeof body.name !== 'string' || body.name.trim() === '') return false
  if (body.description !== undefined && typeof body.description !== 'string') return false
  if (body.columns !== undefined && !Array.isArray(body.columns)) return false
  if (
    body.records !== undefined &&
    (!Array.isArray(body.records) || !body.records.every((record) => isPlainObject(record)))
  ) {
    return false
  }
  return true
}

function isUpdateMetaBody(body: unknown): body is UpdateTableMetaRequest {
  if (!isPlainObject(body)) return false
  const meta = body.meta
  if (!isPlainObject(meta)) return false
  return (
    typeof meta.name === 'string' &&
    meta.name.trim() !== '' &&
    Array.isArray(meta.columns) &&
    Array.isArray(meta.views) &&
    isPlainObject(meta.summaries)
  )
}

function isCreateRecordBody(body: unknown): body is CreateRecordRequest {
  if (!isPlainObject(body)) return false
  return isPlainObject(body.record)
}

function isBatchImportBody(body: unknown): body is BatchImportRecordsRequest {
  if (!isPlainObject(body)) return false
  return Array.isArray(body.records) && body.records.every((record) => isPlainObject(record))
}

function isUpdateRecordBody(body: unknown): body is UpdateRecordRequest {
  if (!isPlainObject(body)) return false
  return isPlainObject(body.patch)
}

function isImportCommitBody(body: unknown): body is ImportCommitRequest {
  if (!isPlainObject(body)) return false
  if (body.kind !== 'normal' && body.kind !== 'advanced') return false
  if (typeof body.tableName !== 'string' || body.tableName.trim() === '') return false
  return Array.isArray(body.columns) && Array.isArray(body.rows)
}

function isCreateAppBody(body: unknown): body is CreateAppRequest {
  if (!isPlainObject(body)) return false
  if (typeof body.name !== 'string' || body.name.trim() === '') return false
  if (typeof body.tableId !== 'string' || body.tableId.trim() === '') return false
  if (body.description !== undefined && typeof body.description !== 'string') return false
  return true
}

function isReorderAppsBody(body: unknown): body is ReorderAppsRequest {
  return isPlainObject(body) && Array.isArray(body.appIds)
}

function isCreateViewBody(body: unknown): body is CreateViewRequest {
  if (!isPlainObject(body)) return false
  const hasAppId = typeof body.appId === 'string' && body.appId.trim() !== ''
  const hasTableId = typeof body.tableId === 'string' && body.tableId.trim() !== ''
  return (
    typeof body.name === 'string' &&
    body.name.trim() !== '' &&
    typeof body.type === 'string' &&
    (hasAppId || hasTableId)
  )
}

function isReorderViewsBody(body: unknown): body is ReorderViewsRequest {
  return isPlainObject(body) && Array.isArray(body.viewIds)
}

function isKanbanMoveCardBody(body: unknown): body is KanbanMoveCardRequest {
  if (!isPlainObject(body)) return false
  if (body.field !== undefined && typeof body.field !== 'string') return false
  return 'targetValue' in body
}

function handleRouteError(c: Context, error: unknown, uniquePrefix = '数据冲突'): Response {
  if (error instanceof UnauthorizedError) {
    return c.json({ message: error.message }, 401)
  }
  if (error instanceof ForbiddenError) {
    return c.json({ message: error.message }, 403)
  }
  if (error instanceof NotFoundError) {
    return c.json({ message: error.message }, 404)
  }
  if (error instanceof ShareGoneError) {
    return c.json({ message: error.message, status: error.statusKind }, 410)
  }
  if (error instanceof BatchValidationError) {
    return c.json({ message: error.message, errors: error.errors }, 400)
  }
  if (error instanceof ValidationError) {
    return c.json({ message: error.message }, 400)
  }
  const message = (error as Error)?.message ?? ''
  if (message.includes('UNIQUE constraint')) {
    return c.json({ message: `${uniquePrefix}：${message}` }, 409)
  }
  if (
    message.includes('NOT NULL constraint') ||
    message.includes('CHECK constraint') ||
    message.includes('FOREIGN KEY constraint') ||
    message.includes('datatype mismatch')
  ) {
    return c.json({ message: `数据约束校验失败：${message}` }, 400)
  }
  throw error
}

function resolveRecordWriteContext(c: Context): { appId?: string; viewId?: string } {
  const appId = c.req.query('appId')?.trim() || c.req.header('X-App-Id')?.trim()
  const viewId = c.req.query('viewId')?.trim() || c.req.header('X-View-Id')?.trim()
  return {
    ...(appId ? { appId } : {}),
    ...(viewId ? { viewId } : {}),
  }
}

function decorateTableBundleForUser(
  user: AuthUser,
  bundle: TableBundle,
  allApps: readonly SmartApp[],
  allViews: readonly WorkspaceView[],
): TableBundle {
  return {
    meta: {
      ...bundle.meta,
      capabilities: computeTableCapabilities(user, bundle.meta, allApps, allViews),
    },
    records: filterTableRecordsForUser(user, bundle.meta, bundle.records),
  }
}

function decorateAppForUser(
  user: AuthUser,
  app: SmartApp,
  visibleRecordIdsByTable?: ReadonlyMap<string, ReadonlySet<string>>,
): SmartApp {
  const visibleIds = visibleRecordIdsByTable?.get(app.tableId)
  let lookupOverrides = app.lookupOverrides
  if (visibleIds && lookupOverrides) {
    const stubRecords = Array.from(visibleIds, (id) => ({ _id: id }))
    lookupOverrides = filterLookupOverridesForRecords(lookupOverrides, stubRecords)
  }
  return {
    ...app,
    ...(lookupOverrides !== undefined ? { lookupOverrides } : {}),
    capabilities: computeAppCapabilities(user, app),
  }
}

function decorateViewForUser(
  user: AuthUser,
  view: WorkspaceView,
  parentApp: SmartApp | undefined | null,
): WorkspaceView {
  return {
    ...view,
    capabilities: computeViewCapabilities(user, view, parentApp),
  }
}

/** 校验请求中 VLOOKUP 派生列引用的目标数据源表是否对当前用户可见，防止绕过隔离读取私有表 */
function assertLookupTargetsAccessible(
  db: Database,
  user: AuthUser,
  derivedColumns: unknown,
  allApps: readonly SmartApp[],
): void {
  if (!Array.isArray(derivedColumns)) return
  for (const col of derivedColumns) {
    if (!isPlainObject(col) || col.type !== 'lookup' || !isPlainObject(col.lookupConfig)) {
      continue
    }
    const targetTableId = col.lookupConfig.targetTableId
    if (typeof targetTableId !== 'string' || targetTableId.trim() === '') {
      continue
    }
    const targetMeta = getTableMeta(db, targetTableId) ?? getTableMeta(db, targetTableId.trim())
    if (targetMeta && !canViewTable(user, targetMeta, allApps)) {
      throw new ForbiddenError(`无权引用无访问权限的目标数据源表: "${targetTableId}"`)
    }
  }
}

/** 校验更新视图时跨应用迁移与数据源改绑权限（仅当归属实际变化时校验目标资源权限） */
function assertViewRebindAccessible(
  db: Database,
  user: AuthUser,
  existing: WorkspaceView,
  body: Record<string, unknown>,
): void {
  if (typeof body.appId === 'string' && body.appId.trim() !== '') {
    const nextAppId = body.appId.trim()
    if (nextAppId !== existing.appId) {
      const targetApp = getSmartApp(db, nextAppId)
      if (targetApp && !canConfigureApp(user, targetApp)) {
        throw new ForbiddenError('无权将视图迁移至该智能表格')
      }
    }
  }
  if (typeof body.tableId === 'string' && body.tableId.trim() !== '') {
    const nextTableId = body.tableId.trim()
    if (nextTableId !== existing.tableId) {
      const targetTable = getTableMeta(db, nextTableId)
      if (targetTable && !canViewTable(user, targetTable, listSmartApps(db))) {
        throw new ForbiddenError('无权将视图改绑至该数据源表')
      }
    }
  }
}

function extractShareUnlockToken(db: Database, c: Context, token: string): string | null {
  const headerToken = c.req.header('X-Share-Token')?.trim()
  if (headerToken) return headerToken

  const row = db.query('SELECT id FROM shares WHERE token = ?').get(token) as
    | { id: string }
    | undefined
    | null
  if (!row) return null
  const cookies = parseCookieHeader(c.req.header('Cookie'))
  return cookies.get(getShareUnlockCookieName(row.id)) ?? null
}

function buildVisibleWorkspaceSnapshot(
  db: Database,
  user: AuthUser,
): { tables: TableBundle[]; apps: SmartApp[]; views: WorkspaceView[] } {
  const allApps = listSmartApps(db)
  const allViews = listWorkspaceViews(db)
  const allBundles = listTableBundles(db)
  const appMap = new Map(allApps.map((a) => [a.id, a]))

  const tables = allBundles
    .filter((bundle) => canViewTable(user, bundle.meta, allApps))
    .map((bundle) => decorateTableBundleForUser(user, bundle, allApps, allViews))

  const visibleIdsByTable = new Map<string, Set<string>>(
    tables.map((b) => [b.meta.id, new Set(b.records.map((r) => r._id))]),
  )

  const apps = allApps
    .filter((app) => canViewApp(user, app))
    .map((app) => decorateAppForUser(user, app, visibleIdsByTable))

  const views = allViews
    .filter((view) => canViewView(user, view, appMap.get(view.appId)))
    .map((view) => decorateViewForUser(user, view, appMap.get(view.appId)))

  return { tables, apps, views }
}

export function mountSmartTableRoutes(app: Hono, db: Database): void {
  // 全局 API 鉴权守卫：除公开认证与 /api/s/:token 访客路由外，其余接口一律要求已登录会话
  app.use('/api/*', async (c, next) => {
    if (isPublicApiPath(c.req.path)) {
      return next()
    }
    const cookies = parseCookieHeader(c.req.header('Cookie'))
    const token = cookies.get(SESSION_COOKIE_NAME)
    const active = resolveSessionByToken(db, token)
    if (!active) {
      return c.json({ message: '未登录或会话已过期，请先登录' }, 401)
    }
    requestAuthMap.set(c.req.raw, { user: active.user, expiresAt: active.expiresAt })
    return next()
  })

  // ---------------- 认证接口 ----------------

  app.get('/api/auth/demo-accounts', (c) => {
    const response: DemoAccountsResponse = { accounts: getDemoAccounts() }
    return c.json(response)
  })

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json().catch(() => null)
    if (!isLoginBody(body)) {
      return c.json({ message: '请输入账号和密码' }, 400)
    }
    const user = authenticateUser(db, body.username, body.password)
    if (!user) {
      return c.json({ message: '账号或密码错误' }, 401)
    }
    const session = createSession(db, user.id)
    c.header('Set-Cookie', buildSessionCookieHeader(session.token, isHttpsRequest(c)))
    const response: AuthSessionResponse = {
      user,
      expiresAt: session.expiresAt,
      capabilities: computeUserCapabilities(user),
    }
    return c.json(response)
  })

  app.post('/api/auth/logout', (c) => {
    const cookies = parseCookieHeader(c.req.header('Cookie'))
    deleteSessionByToken(db, cookies.get(SESSION_COOKIE_NAME))
    c.header('Set-Cookie', buildClearSessionCookieHeader(isHttpsRequest(c)))
    return c.json({ ok: true })
  })

  app.get('/api/auth/me', (c) => {
    const { user, expiresAt } = requireRequestAuth(c)
    const response: AuthSessionResponse = {
      user,
      expiresAt,
      capabilities: computeUserCapabilities(user),
    }
    return c.json(response)
  })

  // ---------------- 免登录访客分享接口 ----------------

  app.get('/api/s/:token', (c) => {
    const token = c.req.param('token')
    try {
      const unlockToken = extractShareUnlockToken(db, c, token)
      const access = resolveGuestShareAccess(db, token, unlockToken)
      return c.json(access)
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  app.post('/api/s/:token/verify', async (c) => {
    const token = c.req.param('token')
    const body = await c.req.json().catch(() => null)
    if (!isPlainObject(body) || typeof body.password !== 'string') {
      return c.json({ message: '请求体不合法：需提供 password 字符串' }, 400)
    }
    try {
      const result = verifySharePasswordAccess(db, token, body.password)
      c.header(
        'Set-Cookie',
        buildCookieAttributeString(getShareUnlockCookieName(result.shareId), result.accessToken, {
          maxAge: 24 * 60 * 60,
          path: '/',
          isSecure: isHttpsRequest(c),
        }),
      )
      return c.json({
        ok: true,
        accessToken: result.accessToken,
        access: result.access,
      })
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  app.post('/api/s/:token/records', async (c) => {
    const token = c.req.param('token')
    const body = await c.req.json().catch(() => null)
    if (!isCreateRecordBody(body)) {
      return c.json({ message: '请求体不合法：需提供 record 对象' }, 400)
    }
    try {
      const unlockToken = extractShareUnlockToken(db, c, token)
      const created = submitShareEntryRecord(db, token, body.record, unlockToken)
      return c.json({ record: created }, 201)
    } catch (error) {
      return handleRouteError(c, error, '主键值已存在，请更换唯一标识')
    }
  })

  // ---------------- 权限管理接口 ----------------

  app.get('/api/permissions', (c) => {
    const { user } = requireRequestAuth(c)
    try {
      return c.json(getPermissionsOverview(db, user))
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  app.put('/api/permissions/apps/:id', async (c) => {
    const { user } = requireRequestAuth(c)
    const body = await c.req.json().catch(() => null)
    try {
      const updated = updateAppPermissions(db, user, c.req.param('id'), body)
      return c.json({ app: decorateAppForUser(user, updated) })
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  app.put('/api/permissions/views/:id', async (c) => {
    const { user } = requireRequestAuth(c)
    const body = await c.req.json().catch(() => null)
    try {
      const updated = updateViewPermissions(db, user, c.req.param('id'), body)
      const parentApp = getSmartApp(db, updated.appId)
      return c.json({ view: decorateViewForUser(user, updated, parentApp) })
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  app.put('/api/permissions/tables/:id', async (c) => {
    const { user } = requireRequestAuth(c)
    const body = await c.req.json().catch(() => null)
    try {
      const updated = updateTablePermissions(db, user, c.req.param('id'), body)
      const allApps = listSmartApps(db)
      const allViews = listWorkspaceViews(db)
      return c.json({
        meta: {
          ...updated,
          capabilities: computeTableCapabilities(user, updated, allApps, allViews),
        },
      })
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  // ---------------- 分享管理接口 ----------------

  app.get('/api/shares', (c) => {
    const { user } = requireRequestAuth(c)
    try {
      const targetType = c.req.query('targetType')?.trim() || undefined
      const targetId = c.req.query('targetId')?.trim() || undefined
      return c.json({ shares: listShares(db, user, { targetType, targetId }) })
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  app.post('/api/shares', async (c) => {
    const { user } = requireRequestAuth(c)
    const body = await c.req.json().catch(() => null)
    try {
      const share = createShare(db, user, body)
      return c.json({ share }, 201)
    } catch (error) {
      return handleRouteError(c, error, '分享链接冲突')
    }
  })

  app.post('/api/shares/:id/revoke', (c) => {
    const { user } = requireRequestAuth(c)
    try {
      const share = revokeShare(db, user, c.req.param('id'))
      if (!share) {
        return c.json({ message: '分享链接不存在' }, 404)
      }
      return c.json({ share })
    } catch (error) {
      return handleRouteError(c, error)
    }
  })

  // ---------------- 数据源表与记录接口 ----------------

  app.get('/api/tables', (c) => {
    const { user } = requireRequestAuth(c)
    const allApps = listSmartApps(db)
    const allViews = listWorkspaceViews(db)
    const bundles = listTableBundles(db)
      .filter((bundle) => canViewTable(user, bundle.meta, allApps))
      .map((bundle) => decorateTableBundleForUser(user, bundle, allApps, allViews))
    const response: AllTablesResponse = { tables: bundles }
    return c.json(response)
  })

  app.get('/api/tables/:id', (c) => {
    const { user } = requireRequestAuth(c)
    const bundle = getTableBundle(db, c.req.param('id'))
    if (!bundle) {
      return c.json({ message: '数据表不存在' }, 404)
    }
    const allApps = listSmartApps(db)
    if (!canViewTable(user, bundle.meta, allApps)) {
      return c.json({ message: '无权访问该数据表' }, 403)
    }
    const allViews = listWorkspaceViews(db)
    return c.json(decorateTableBundleForUser(user, bundle, allApps, allViews))
  })

  app.post('/api/tables', async (c) => {
    const { user } = requireRequestAuth(c)
    if (!canManageDataSource(user)) {
      return c.json({ message: '普通成员无权新建数据源表' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isCreateTableBody(body)) {
      return c.json({ message: '请求体不合法：需提供非空表名 name' }, 400)
    }
    try {
      const bundle = insertNormalTable(db, body, {
        records: body.records,
        actorUserId: user.id,
      })
      return c.json(
        decorateTableBundleForUser(user, bundle, listSmartApps(db), listWorkspaceViews(db)),
        201,
      )
    } catch (error) {
      return handleRouteError(c, error, '表配置冲突')
    }
  })

  app.put('/api/tables/:id/meta', async (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权修改数据表结构与配置' }, 403)
    }
    const tableId = c.req.param('id')
    const existing = getTableMeta(db, tableId)
    if (!existing) {
      return c.json({ message: '数据表不存在' }, 404)
    }
    const allApps = listSmartApps(db)
    if (
      !canConfigureTable(
        user,
        existing,
        allApps.filter((a) => a.tableId === tableId),
      )
    ) {
      return c.json({ message: '无权修改该数据表结构与配置' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isUpdateMetaBody(body)) {
      return c.json({ message: '请求体不合法：需提供完整的 meta 对象' }, 400)
    }
    try {
      const updated = updateTableMeta(db, tableId, body.meta)
      if (!updated) {
        return c.json({ message: '数据表不存在' }, 404)
      }
      const allViews = listWorkspaceViews(db)
      return c.json({
        meta: {
          ...updated,
          capabilities: computeTableCapabilities(user, updated, allApps, allViews),
        },
      })
    } catch (error) {
      return handleRouteError(c, error, '表元数据冲突')
    }
  })

  app.delete('/api/tables/:id', (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权删除数据表' }, 403)
    }
    const tableId = c.req.param('id')
    const existing = getTableMeta(db, tableId)
    if (!existing) {
      return c.json({ message: '数据表不存在' }, 404)
    }
    const appsForTable = listSmartApps(db).filter((a) => a.tableId === tableId)
    if (!canConfigureTable(user, existing, appsForTable)) {
      return c.json({ message: '无权删除该数据表' }, 403)
    }
    try {
      const deleted = deleteTable(db, tableId)
      if (!deleted) {
        return c.json({ message: '数据表不存在' }, 404)
      }
      return c.json({ ok: true })
    } catch (error) {
      return handleRouteError(c, error, '删除失败')
    }
  })

  app.post('/api/tables/:id/sync', (c) => {
    const { user } = requireRequestAuth(c)
    if (!canManageDataSource(user)) {
      return c.json({ message: '普通成员无权同步数据源表' }, 403)
    }
    const bundle = getTableBundle(db, c.req.param('id'))
    if (!bundle) {
      return c.json({ message: '数据表不存在' }, 404)
    }
    const allApps = listSmartApps(db)
    if (!canManageDataSource(user) || !canViewTable(user, bundle.meta, allApps)) {
      return c.json({ message: '无权同步该数据源表' }, 403)
    }
    return c.json(decorateTableBundleForUser(user, bundle, allApps, listWorkspaceViews(db)))
  })

  app.post('/api/tables/:id/records', async (c) => {
    const { user } = requireRequestAuth(c)
    const tableId = c.req.param('id')
    const meta = getTableMeta(db, tableId)
    if (!meta) {
      return c.json({ message: '数据表不存在或无法写入' }, 404)
    }
    const allApps = listSmartApps(db)
    const allViews = listWorkspaceViews(db)
    if (!canWriteTableRecords(user, meta, allApps, allViews, resolveRecordWriteContext(c))) {
      return c.json({ message: '当前资源为只读权限，无权新增记录' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isCreateRecordBody(body)) {
      return c.json({ message: '请求体不合法：需提供 record 对象' }, 400)
    }
    try {
      const created = createTableRecord(db, tableId, body.record, { actorUserId: user.id })
      if (!created) {
        return c.json({ message: '数据表不存在或无法写入' }, 404)
      }
      return c.json({ record: created }, 201)
    } catch (error) {
      return handleRouteError(c, error, '主键值已存在，请更换唯一标识')
    }
  })

  app.post('/api/tables/:id/records/batch', async (c) => {
    const { user } = requireRequestAuth(c)
    const tableId = c.req.param('id')
    const meta = getTableMeta(db, tableId)
    if (!meta) {
      return c.json({ message: '数据表不存在' }, 404)
    }
    const allApps = listSmartApps(db)
    const allViews = listWorkspaceViews(db)
    if (!canWriteTableRecords(user, meta, allApps, allViews, resolveRecordWriteContext(c))) {
      return c.json({ message: '当前资源为只读权限，无权批量导入记录' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isBatchImportBody(body)) {
      return c.json({ message: '请求体不合法：需提供 records 对象数组' }, 400)
    }
    try {
      const result = batchCreateTableRecords(db, tableId, body.records, { actorUserId: user.id })
      if (!result) {
        return c.json({ message: '数据表不存在' }, 404)
      }
      return c.json(result, 201)
    } catch (error) {
      return handleRouteError(c, error, '批量导入冲突')
    }
  })

  app.patch('/api/tables/:id/records/:recordId', async (c) => {
    const { user } = requireRequestAuth(c)
    const tableId = c.req.param('id')
    const recordId = c.req.param('recordId')
    const meta = getTableMeta(db, tableId)
    if (!meta) {
      return c.json({ message: '数据表或记录不存在' }, 404)
    }
    const allApps = listSmartApps(db)
    const allViews = listWorkspaceViews(db)
    if (!canWriteTableRecords(user, meta, allApps, allViews, resolveRecordWriteContext(c))) {
      return c.json({ message: '当前资源为只读权限，无权修改记录' }, 403)
    }
    const existingRecord = getTableRecordById(db, tableId, recordId)
    if (!existingRecord) {
      return c.json({ message: '数据表或记录不存在' }, 404)
    }
    if (!canAccessRecord(user, meta, existingRecord)) {
      return c.json({ message: '无权修改他人负责的数据行' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isUpdateRecordBody(body)) {
      return c.json({ message: '请求体不合法：需提供 patch 对象' }, 400)
    }
    try {
      const updated = updateTableRecord(db, tableId, recordId, body.patch)
      if (!updated) {
        return c.json({ message: '数据表或记录不存在' }, 404)
      }
      return c.json({ record: updated })
    } catch (error) {
      return handleRouteError(c, error, '主键值冲突')
    }
  })

  app.delete('/api/tables/:id/records/:recordId', (c) => {
    const { user } = requireRequestAuth(c)
    const tableId = c.req.param('id')
    const recordId = c.req.param('recordId')
    const meta = getTableMeta(db, tableId)
    if (!meta) {
      return c.json({ message: '数据表或记录不存在' }, 404)
    }
    const allApps = listSmartApps(db)
    const allViews = listWorkspaceViews(db)
    if (!canWriteTableRecords(user, meta, allApps, allViews, resolveRecordWriteContext(c))) {
      return c.json({ message: '当前资源为只读权限，无权删除记录' }, 403)
    }
    const existingRecord = getTableRecordById(db, tableId, recordId)
    if (!existingRecord) {
      return c.json({ message: '数据表或记录不存在' }, 404)
    }
    if (!canAccessRecord(user, meta, existingRecord)) {
      return c.json({ message: '无权删除他人负责的数据行' }, 403)
    }
    const deleted = deleteTableRecord(db, tableId, recordId)
    if (!deleted) {
      return c.json({ message: '数据表或记录不存在' }, 404)
    }
    return c.json({ ok: true })
  })

  app.post('/api/import/commit', async (c) => {
    const { user } = requireRequestAuth(c)
    if (!canManageDataSource(user)) {
      return c.json({ message: '普通成员无权导入创建数据源表' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isImportCommitBody(body)) {
      return c.json({ message: '请求体不合法：需提供 kind、非空 tableName、columns 与 rows' }, 400)
    }
    try {
      const bundle = commitImport(db, body, { actorUserId: user.id })
      return c.json(
        decorateTableBundleForUser(user, bundle, listSmartApps(db), listWorkspaceViews(db)),
        201,
      )
    } catch (error) {
      return handleRouteError(c, error, '导入建表失败')
    }
  })

  // ---------------- 智能表格与应用视图接口 ----------------

  app.get('/api/apps', (c) => {
    const { user } = requireRequestAuth(c)
    const snapshot = buildVisibleWorkspaceSnapshot(db, user)
    const response: AllAppsResponse = { apps: snapshot.apps }
    return c.json(response)
  })

  app.post('/api/apps', async (c) => {
    const { user } = requireRequestAuth(c)
    if (!canManageDataSource(user)) {
      return c.json({ message: '普通成员无权创建智能表格' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isCreateAppBody(body)) {
      return c.json({ message: '请求体不合法：需提供非空 name 与 tableId' }, 400)
    }
    const allApps = listSmartApps(db)
    const targetTable = getTableMeta(db, body.tableId.trim())
    if (targetTable && !canViewTable(user, targetTable, allApps)) {
      return c.json({ message: '无权基于该数据源表创建智能表格' }, 403)
    }
    try {
      assertLookupTargetsAccessible(db, user, body.derivedColumns, allApps)
      const created = createSmartApp(db, body, { actorUserId: user.id })
      return c.json(
        {
          app: decorateAppForUser(user, created.app),
          defaultView: decorateViewForUser(user, created.defaultView, created.app),
        },
        201,
      )
    } catch (error) {
      return handleRouteError(c, error, '智能表格冲突')
    }
  })

  app.put('/api/apps/reorder', async (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权调整智能表格顺序' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isReorderAppsBody(body)) {
      return c.json({ message: '请求体不合法：需提供 appIds 数组' }, 400)
    }
    if (user.role === 'manager') {
      for (const id of body.appIds) {
        if (typeof id !== 'string') continue
        const found = getSmartApp(db, id)
        if (found && !canConfigureApp(user, found)) {
          return c.json({ message: '无权调整他人负责的智能表格顺序' }, 403)
        }
      }
    }
    try {
      const apps = reorderSmartApps(db, body.appIds)
        .filter((item) => canViewApp(user, item))
        .map((item) => decorateAppForUser(user, item))
      return c.json({ apps })
    } catch (error) {
      return handleRouteError(c, error, '智能表格重排失败')
    }
  })

  app.get('/api/apps/:id', (c) => {
    const { user } = requireRequestAuth(c)
    const found = getSmartApp(db, c.req.param('id'))
    if (!found) {
      return c.json({ message: '智能表格不存在' }, 404)
    }
    if (!canViewApp(user, found)) {
      return c.json({ message: '无权访问该智能表格' }, 403)
    }
    const tableBundle = getTableBundle(db, found.tableId)
    const visibleIds = tableBundle
      ? new Set(
          filterTableRecordsForUser(user, tableBundle.meta, tableBundle.records).map((r) => r._id),
        )
      : undefined
    const visibleMap = visibleIds ? new Map([[found.tableId, visibleIds]]) : undefined
    return c.json({ app: decorateAppForUser(user, found, visibleMap) })
  })

  const handleUpdateSmartApp = async (c: Context, appId: string) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权修改智能表格配置' }, 403)
    }
    const existing = getSmartApp(db, appId)
    if (!existing) {
      return c.json({ message: '智能表格不存在' }, 404)
    }
    if (!canConfigureApp(user, existing)) {
      return c.json({ message: '无权修改该智能表格配置' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isPlainObject(body)) {
      return c.json({ message: '请求体不合法：需提供智能表格更新对象' }, 400)
    }
    try {
      if ('derivedColumns' in body && body.derivedColumns !== undefined) {
        assertLookupTargetsAccessible(db, user, body.derivedColumns, listSmartApps(db))
      }
      const updated = updateSmartApp(db, appId, body as UpdateAppRequest)
      if (!updated) {
        return c.json({ message: '智能表格不存在' }, 404)
      }
      return c.json({ app: decorateAppForUser(user, updated) })
    } catch (error) {
      return handleRouteError(c, error, '智能表格更新失败')
    }
  }

  app.put('/api/apps/:id', (c) => handleUpdateSmartApp(c, c.req.param('id')))
  app.patch('/api/apps/:id', (c) => handleUpdateSmartApp(c, c.req.param('id')))

  app.delete('/api/apps/:id', (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权删除智能表格' }, 403)
    }
    const appId = c.req.param('id')
    const existing = getSmartApp(db, appId)
    if (!existing) {
      return c.json({ message: '智能表格不存在' }, 404)
    }
    if (!canConfigureApp(user, existing)) {
      return c.json({ message: '无权删除该智能表格' }, 403)
    }
    const deleted = deleteSmartApp(db, appId)
    if (!deleted) {
      return c.json({ message: '智能表格不存在' }, 404)
    }
    return c.json({ ok: true })
  })

  app.get('/api/views', (c) => {
    const { user } = requireRequestAuth(c)
    const snapshot = buildVisibleWorkspaceSnapshot(db, user)
    const response: AllViewsResponse = { views: snapshot.views }
    return c.json(response)
  })

  app.post('/api/views', async (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权新建视图' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isCreateViewBody(body)) {
      return c.json({ message: '请求体不合法：需提供非空 name、type 与 appId/tableId' }, 400)
    }
    const reqAppId = typeof body.appId === 'string' ? body.appId.trim() : ''
    if (reqAppId) {
      const parentApp = getSmartApp(db, reqAppId)
      if (parentApp && !canConfigureApp(user, parentApp)) {
        return c.json({ message: '无权在该智能表格下新建视图' }, 403)
      }
    } else if (typeof body.tableId === 'string' && body.tableId.trim() !== '') {
      const table = getTableMeta(db, body.tableId.trim())
      if (table && !canViewTable(user, table, listSmartApps(db))) {
        return c.json({ message: '无权为该数据源表新建视图' }, 403)
      }
      const firstApp = listSmartApps(db).find((a) => a.tableId === body.tableId!.trim())
      if (firstApp && !canConfigureApp(user, firstApp)) {
        return c.json({ message: '无权在他人负责的智能表格下新建视图' }, 403)
      }
    }
    try {
      const view = createWorkspaceView(db, body, { actorUserId: user.id })
      const parentApp = getSmartApp(db, view.appId)
      return c.json({ view: decorateViewForUser(user, view, parentApp) }, 201)
    } catch (error) {
      return handleRouteError(c, error, '视图冲突')
    }
  })

  app.put('/api/views/reorder', async (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权调整视图顺序' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isReorderViewsBody(body)) {
      return c.json({ message: '请求体不合法：需提供 viewIds 数组' }, 400)
    }
    const allApps = new Map(listSmartApps(db).map((a) => [a.id, a]))
    if (user.role === 'manager') {
      for (const id of body.viewIds) {
        if (typeof id !== 'string') continue
        const view = getWorkspaceView(db, id)
        if (view && !canConfigureView(user, view, allApps.get(view.appId))) {
          return c.json({ message: '无权调整他人负责的视图顺序' }, 403)
        }
      }
    }
    try {
      const views = reorderWorkspaceViews(db, body.viewIds)
        .filter((v) => canViewView(user, v, allApps.get(v.appId)))
        .map((v) => decorateViewForUser(user, v, allApps.get(v.appId)))
      return c.json({ views })
    } catch (error) {
      return handleRouteError(c, error, '视图重排失败')
    }
  })

  app.get('/api/views/:id', (c) => {
    const { user } = requireRequestAuth(c)
    const view = getWorkspaceView(db, c.req.param('id'))
    if (!view) {
      return c.json({ message: '视图不存在' }, 404)
    }
    const parentApp = getSmartApp(db, view.appId)
    if (!canViewView(user, view, parentApp)) {
      return c.json({ message: '无权访问该视图' }, 403)
    }
    return c.json({ view: decorateViewForUser(user, view, parentApp) })
  })

  const handleUpdateWorkspaceView = async (c: Context, viewId: string) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权修改视图配置' }, 403)
    }
    const existing = getWorkspaceView(db, viewId)
    if (!existing) {
      return c.json({ message: '视图不存在' }, 404)
    }
    const parentApp = getSmartApp(db, existing.appId)
    if (!canConfigureView(user, existing, parentApp)) {
      return c.json({ message: '无权修改该视图配置' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isPlainObject(body)) {
      return c.json({ message: '请求体不合法：需提供视图更新对象' }, 400)
    }
    try {
      assertViewRebindAccessible(db, user, existing, body)
      const updated = updateWorkspaceView(db, viewId, body as UpdateViewRequest)
      if (!updated) {
        return c.json({ message: '视图不存在' }, 404)
      }
      const nextApp = getSmartApp(db, updated.appId)
      return c.json({ view: decorateViewForUser(user, updated, nextApp) })
    } catch (error) {
      return handleRouteError(c, error, '视图配置冲突')
    }
  }

  app.put('/api/views/:id', (c) => handleUpdateWorkspaceView(c, c.req.param('id')))
  app.patch('/api/views/:id', (c) => handleUpdateWorkspaceView(c, c.req.param('id')))

  app.delete('/api/views/:id', (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role === 'member') {
      return c.json({ message: '普通成员无权删除视图' }, 403)
    }
    const viewId = c.req.param('id')
    const existing = getWorkspaceView(db, viewId)
    if (!existing) {
      return c.json({ message: '视图不存在' }, 404)
    }
    const parentApp = getSmartApp(db, existing.appId)
    if (!canConfigureView(user, existing, parentApp)) {
      return c.json({ message: '无权删除该视图' }, 403)
    }
    const deleted = deleteWorkspaceView(db, viewId)
    if (!deleted) {
      return c.json({ message: '视图不存在' }, 404)
    }
    return c.json({ ok: true })
  })

  app.patch('/api/views/:id/kanban/cards/:recordId', async (c) => {
    const { user } = requireRequestAuth(c)
    const viewId = c.req.param('id')
    const recordId = c.req.param('recordId')
    const view = getWorkspaceView(db, viewId)
    if (!view) {
      return c.json({ message: '视图或记录不存在' }, 404)
    }
    const parentApp = getSmartApp(db, view.appId)
    if (!parentApp || !canViewView(user, view, parentApp)) {
      return c.json({ message: '无权访问该看板视图' }, 403)
    }
    if (!canEditAppRecords(user, parentApp, view)) {
      return c.json({ message: '当前视图为只读权限，无权拖拽变更状态' }, 403)
    }
    const meta = getTableMeta(db, view.tableId)
    if (!meta) {
      return c.json({ message: '视图或记录不存在' }, 404)
    }
    const existingRecord = getTableRecordById(db, view.tableId, recordId)
    if (!existingRecord) {
      return c.json({ message: '视图或记录不存在' }, 404)
    }
    if (!canAccessRecord(user, meta, existingRecord)) {
      return c.json({ message: '无权修改他人负责的数据行' }, 403)
    }
    const body = await c.req.json().catch(() => null)
    if (!isKanbanMoveCardBody(body)) {
      return c.json({ message: '请求体不合法：需提供 targetValue' }, 400)
    }
    try {
      const updated = moveKanbanCard(db, viewId, recordId, body.targetValue, body.field)
      if (!updated) {
        return c.json({ message: '视图或记录不存在' }, 404)
      }
      return c.json({ record: updated })
    } catch (error) {
      return handleRouteError(c, error, '看板写回冲突')
    }
  })

  app.post('/api/reset-seed', (c) => {
    const { user } = requireRequestAuth(c)
    if (user.role !== 'admin') {
      return c.json({ message: '仅管理员可执行演示数据重置' }, 403)
    }
    seedSmartTableDemo(db, { force: true })
    const snapshot = buildVisibleWorkspaceSnapshot(db, user)
    const response: AllTablesResponse = {
      tables: snapshot.tables,
      apps: snapshot.apps,
      views: snapshot.views,
    }
    return c.json(response)
  })
}
