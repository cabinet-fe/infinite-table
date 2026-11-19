// 一键分享持久化、生命周期管理、密码门禁及基于创建者权限上限的免登录访客访问解析。

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import {
  canCreateShareForTarget,
  canManageShare,
  canViewApp,
  canViewTable,
  canViewView,
  computeGuestShareCapabilities,
  filterLookupOverridesForRecords,
  filterTableRecordsForUser,
  resolveShareStatus,
} from '../domain/permissions'
import type {
  CreateShareRequest,
  ShareAccessResponse,
  ShareAccessSummary,
  ShareAccessUnlockedResponse,
  TableBundle,
} from '../shared/api-types'
import {
  isValidShareTargetType,
  type AuthUser,
  type ShareRecord,
  type ShareTargetType,
  type SmartApp,
  type SmartRecord,
  type SmartTableMeta,
  type WorkspaceView,
} from '../shared/schema'
import { getUserById, hashPassword, listUsers, verifyPassword } from './auth'
import {
  ForbiddenError,
  NotFoundError,
  ShareGoneError,
  UnauthorizedError,
  ValidationError,
  createTableRecord,
  getTableBundle,
  getTableMeta,
  isPlainObject,
  listTableMetas,
} from './db'
import { getSmartApp, getWorkspaceView, listSmartApps, listWorkspaceViews } from './views-store'

const SHARE_SECRET_SETTING_KEY = 'share_hmac_secret'
export const SHARE_UNLOCK_COOKIE_PREFIX = 'st_share_'

interface ShareRow {
  id: string
  token: string
  target_type: ShareTargetType
  target_id: string
  created_by: string
  password_hash: string | null
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

function getOrCreateShareHmacSecret(db: Database): string {
  const existing = db
    .query('SELECT value FROM server_settings WHERE key = ?')
    .get(SHARE_SECRET_SETTING_KEY) as { value: string } | undefined | null
  if (existing?.value) {
    return existing.value
  }
  const secret = randomBytes(32).toString('hex')
  db.query('INSERT OR IGNORE INTO server_settings (key, value) VALUES (?, ?)').run(
    SHARE_SECRET_SETTING_KEY,
    secret,
  )
  const stored = db
    .query('SELECT value FROM server_settings WHERE key = ?')
    .get(SHARE_SECRET_SETTING_KEY) as { value: string }
  return stored.value
}

export function createShareUnlockToken(db: Database, share: ShareRow): string {
  const secret = getOrCreateShareHmacSecret(db)
  const payload = `${share.id}:${share.token}:${share.password_hash ?? ''}:${share.revoked_at ?? ''}`
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function verifyShareUnlockToken(
  db: Database,
  share: ShareRow,
  candidate: string | null | undefined,
): boolean {
  if (!candidate || candidate.trim() === '') return false
  const expected = createShareUnlockToken(db, share)
  const expectedBuf = Buffer.from(expected, 'utf8')
  const actualBuf = Buffer.from(candidate.trim(), 'utf8')
  if (expectedBuf.byteLength !== actualBuf.byteLength) {
    return false
  }
  return timingSafeEqual(expectedBuf, actualBuf)
}

export function getShareUnlockCookieName(shareId: string): string {
  return `${SHARE_UNLOCK_COOKIE_PREFIX}${shareId}`
}

function resolveTargetDisplayName(
  targetType: ShareTargetType,
  targetId: string,
  maps: {
    apps: ReadonlyMap<string, SmartApp>
    views: ReadonlyMap<string, WorkspaceView>
    tables: ReadonlyMap<string, SmartTableMeta>
  },
): string {
  if (targetType === 'app') {
    return maps.apps.get(targetId)?.name ?? '(已删除应用)'
  }
  if (targetType === 'view') {
    const view = maps.views.get(targetId)
    if (!view) return '(已删除视图)'
    const appName = maps.apps.get(view.appId)?.name
    return appName ? `${appName} · ${view.name}` : view.name
  }
  return maps.tables.get(targetId)?.name ?? '(已删除数据表)'
}

function toShareRecord(
  row: ShareRow,
  userMap: ReadonlyMap<string, AuthUser>,
  targetMaps: {
    apps: ReadonlyMap<string, SmartApp>
    views: ReadonlyMap<string, WorkspaceView>
    tables: ReadonlyMap<string, SmartTableMeta>
  },
  now: Date = new Date(),
): ShareRecord {
  return {
    id: row.id,
    token: row.token,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: resolveTargetDisplayName(row.target_type, row.target_id, targetMaps),
    createdBy: row.created_by,
    createdByName: userMap.get(row.created_by)?.displayName ?? row.created_by,
    hasPassword: row.password_hash !== null,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    status: resolveShareStatus({ expiresAt: row.expires_at, revokedAt: row.revoked_at }, now),
  }
}

function buildLookupMaps(db: Database) {
  const users = listUsers(db)
  const apps = listSmartApps(db)
  const views = listWorkspaceViews(db)
  const tables = listTableMetas(db)
  return {
    userMap: new Map(users.map((u) => [u.id, u])),
    targetMaps: {
      apps: new Map(apps.map((a) => [a.id, a])),
      views: new Map(views.map((v) => [v.id, v])),
      tables: new Map(tables.map((t) => [t.id, t])),
    },
  }
}

function readShareRowByToken(db: Database, token: string): ShareRow | null {
  const row = db
    .query(
      'SELECT id, token, target_type, target_id, created_by, password_hash, expires_at, revoked_at, created_at FROM shares WHERE token = ?',
    )
    .get(token) as ShareRow | undefined | null
  return row ?? null
}

function readShareRowById(db: Database, id: string): ShareRow | null {
  const row = db
    .query(
      'SELECT id, token, target_type, target_id, created_by, password_hash, expires_at, revoked_at, created_at FROM shares WHERE id = ?',
    )
    .get(id) as ShareRow | undefined | null
  return row ?? null
}

function assertShareActive(share: ShareRow, now: Date = new Date()): void {
  const status = resolveShareStatus(
    { expiresAt: share.expires_at, revokedAt: share.revoked_at },
    now,
  )
  if (status === 'revoked') {
    throw new ShareGoneError('该分享链接已手动失效', 'revoked')
  }
  if (status === 'expired') {
    throw new ShareGoneError('该分享链接已过期', 'expired')
  }
}

/** 创建分享链接 */
export function createShare(db: Database, currentUser: AuthUser, payload: unknown): ShareRecord {
  if (currentUser.role === 'member') {
    throw new ForbiddenError('普通成员无权创建分享链接')
  }
  if (!isPlainObject(payload)) {
    throw new ValidationError('请求体必须为对象')
  }
  const req = payload as unknown as CreateShareRequest
  if (!isValidShareTargetType(req.targetType)) {
    throw new ValidationError('targetType 必须为 app / view / entry')
  }
  if (typeof req.targetId !== 'string' || req.targetId.trim() === '') {
    throw new ValidationError('targetId 不能为空')
  }
  const targetId = req.targetId.trim()

  const allApps = listSmartApps(db)
  let app: SmartApp | null = null
  let view: WorkspaceView | null = null
  let table: SmartTableMeta | null = null

  if (req.targetType === 'app') {
    app = getSmartApp(db, targetId)
    if (!app) throw new NotFoundError('多维数据台不存在')
  } else if (req.targetType === 'view') {
    view = getWorkspaceView(db, targetId)
    if (!view) throw new NotFoundError('视图不存在')
    app = getSmartApp(db, view.appId)
  } else {
    table = getTableMeta(db, targetId)
    if (!table) throw new NotFoundError('数据表不存在')
    if (table.kind !== 'normal') {
      throw new ValidationError('仅普通数据录入表支持创建填报分享')
    }
  }

  const appsForTable = table ? allApps.filter((a) => a.tableId === table.id) : []
  if (!canCreateShareForTarget(currentUser, req.targetType, { app, view, table, appsForTable })) {
    throw new ForbiddenError('无权为该资源创建分享链接')
  }

  const now = new Date()
  let expiresAt: string | null = null
  if (req.expiresAt !== undefined && req.expiresAt !== null) {
    if (typeof req.expiresAt !== 'string') {
      throw new ValidationError('expiresAt 必须为 ISO 日期时间字符串')
    }
    const parsedMs = Date.parse(req.expiresAt)
    if (!Number.isFinite(parsedMs)) {
      throw new ValidationError('expiresAt 日期格式无效')
    }
    expiresAt = new Date(parsedMs).toISOString()
  } else if (req.expiresInDays !== undefined && req.expiresInDays !== null) {
    if (
      typeof req.expiresInDays !== 'number' ||
      !Number.isFinite(req.expiresInDays) ||
      req.expiresInDays <= 0
    ) {
      throw new ValidationError('expiresInDays 必须为大于 0 的数字')
    }
    expiresAt = new Date(now.getTime() + req.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  }

  let passwordHash: string | null = null
  if (req.password !== undefined && req.password !== null) {
    if (typeof req.password !== 'string') {
      throw new ValidationError('password 必须为字符串')
    }
    if (req.password !== '') {
      passwordHash = hashPassword(req.password)
    }
  }

  const id = `shr_${randomBytes(8).toString('hex')}`
  const token = randomBytes(24).toString('base64url')
  const createdAt = now.toISOString()

  db.query(
    'INSERT INTO shares (id, token, target_type, target_id, created_by, password_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    token,
    req.targetType,
    targetId,
    currentUser.id,
    passwordHash,
    expiresAt,
    null,
    createdAt,
  )

  const row = readShareRowById(db, id)!
  const { userMap, targetMaps } = buildLookupMaps(db)
  return toShareRecord(row, userMap, targetMaps, now)
}

/** 列出当前用户可管理的分享链接（管理员全空间，负责人仅本人创建） */
export function listShares(
  db: Database,
  currentUser: AuthUser,
  filter?: { targetType?: string; targetId?: string },
): ShareRecord[] {
  if (currentUser.role === 'member') {
    throw new ForbiddenError('普通成员无权管理分享链接')
  }

  let rows = db
    .query(
      'SELECT id, token, target_type, target_id, created_by, password_hash, expires_at, revoked_at, created_at FROM shares ORDER BY rowid DESC',
    )
    .all() as ShareRow[]

  if (filter?.targetType) {
    rows = rows.filter((row) => row.target_type === filter.targetType)
  }
  if (filter?.targetId) {
    rows = rows.filter((row) => row.target_id === filter.targetId)
  }

  const { userMap, targetMaps } = buildLookupMaps(db)
  const now = new Date()
  return rows
    .filter((row) => canManageShare(currentUser, { createdBy: row.created_by }))
    .map((row) => toShareRecord(row, userMap, targetMaps, now))
}

/** 立即失效指定分享链接 */
export function revokeShare(
  db: Database,
  currentUser: AuthUser,
  shareId: string,
): ShareRecord | null {
  if (currentUser.role === 'member') {
    throw new ForbiddenError('普通成员无权操作分享链接')
  }
  const existing = readShareRowById(db, shareId)
  if (!existing) return null

  if (!canManageShare(currentUser, { createdBy: existing.created_by })) {
    throw new ForbiddenError('无权失效他人创建的分享链接')
  }

  const revokedAt = existing.revoked_at ?? new Date().toISOString()
  if (!existing.revoked_at) {
    db.query('UPDATE shares SET revoked_at = ? WHERE id = ?').run(revokedAt, shareId)
  }
  const updated = readShareRowById(db, shareId)!
  const { userMap, targetMaps } = buildLookupMaps(db)
  return toShareRecord(updated, userMap, targetMaps)
}

function resolveLookupTargetBundlesForApp(
  db: Database,
  creator: AuthUser,
  app: SmartApp,
  allApps: readonly SmartApp[],
  seenTableIds: Set<string>,
): TableBundle[] {
  const extras: TableBundle[] = []
  for (const col of app.derivedColumns ?? []) {
    if (col.type !== 'lookup') continue
    const targetTableId = col.lookupConfig?.targetTableId
    if (!targetTableId || seenTableIds.has(targetTableId)) continue
    const bundle = getTableBundle(db, targetTableId)
    if (!bundle) continue
    if (!canViewTable(creator, bundle.meta, allApps)) continue
    seenTableIds.add(targetTableId)
    extras.push({
      meta: { ...bundle.meta, capabilities: computeGuestShareCapabilities('app') },
      records: filterTableRecordsForUser(creator, bundle.meta, bundle.records),
    })
  }
  return extras
}

function buildUnlockedSharePayload(
  db: Database,
  share: ShareRow,
  creator: AuthUser,
  summary: ShareAccessSummary,
): ShareAccessUnlockedResponse {
  const allApps = listSmartApps(db)
  const capabilities = computeGuestShareCapabilities(share.target_type)

  if (share.target_type === 'entry') {
    const meta = getTableMeta(db, share.target_id)
    if (!meta) throw new NotFoundError('分享关联的录入表不存在')
    if (meta.kind !== 'normal') throw new ForbiddenError('该数据表不支持录入分享')
    if (!canViewTable(creator, meta, allApps)) {
      throw new ForbiddenError('分享创建者当前无权访问该数据表')
    }
    const guestBundle: TableBundle = {
      meta: { ...meta, capabilities },
      // 匿名录入端严格隔离已有内部记录
      records: [],
    }
    return {
      unlocked: true,
      requiresPassword: share.password_hash !== null,
      share: summary,
      capabilities,
      table: guestBundle,
      tables: [guestBundle],
    }
  }

  if (share.target_type === 'app') {
    const app = getSmartApp(db, share.target_id)
    if (!app) throw new NotFoundError('分享关联的多维数据台不存在')
    if (!canViewApp(creator, app)) {
      throw new ForbiddenError('分享创建者当前无权访问该多维数据台')
    }
    const primaryBundle = getTableBundle(db, app.tableId)
    if (!primaryBundle) throw new NotFoundError('多维数据台关联数据源不存在')

    const filteredRecords = filterTableRecordsForUser(
      creator,
      primaryBundle.meta,
      primaryBundle.records,
    )
    const primaryGuestBundle: TableBundle = {
      meta: { ...primaryBundle.meta, capabilities },
      records: filteredRecords,
    }
    const seenTableIds = new Set<string>([primaryBundle.meta.id])
    const lookupBundles = resolveLookupTargetBundlesForApp(db, creator, app, allApps, seenTableIds)

    const guestViews = listWorkspaceViews(db)
      .filter((v) => v.appId === app.id && canViewView(creator, v, app))
      .map((v) => ({ ...v, capabilities }))

    const guestApp: SmartApp = {
      ...app,
      lookupOverrides: filterLookupOverridesForRecords(app.lookupOverrides, filteredRecords),
      capabilities,
    }

    return {
      unlocked: true,
      requiresPassword: share.password_hash !== null,
      share: summary,
      capabilities,
      app: guestApp,
      views: guestViews,
      table: primaryGuestBundle,
      tables: [primaryGuestBundle, ...lookupBundles],
    }
  }

  const view = getWorkspaceView(db, share.target_id)
  if (!view) throw new NotFoundError('分享关联的视图不存在')
  const app = getSmartApp(db, view.appId)
  if (!app) throw new NotFoundError('视图所属多维数据台不存在')
  if (!canViewView(creator, view, app)) {
    throw new ForbiddenError('分享创建者当前无权访问该视图')
  }
  const primaryBundle = getTableBundle(db, view.tableId)
  if (!primaryBundle) throw new NotFoundError('视图关联数据源不存在')

  const filteredRecords = filterTableRecordsForUser(
    creator,
    primaryBundle.meta,
    primaryBundle.records,
  )
  const primaryGuestBundle: TableBundle = {
    meta: { ...primaryBundle.meta, capabilities },
    records: filteredRecords,
  }
  const seenTableIds = new Set<string>([primaryBundle.meta.id])
  const lookupBundles = resolveLookupTargetBundlesForApp(db, creator, app, allApps, seenTableIds)

  const guestView: WorkspaceView = { ...view, capabilities }
  const guestApp: SmartApp = {
    ...app,
    lookupOverrides: filterLookupOverridesForRecords(app.lookupOverrides, filteredRecords),
    capabilities,
  }

  return {
    unlocked: true,
    requiresPassword: share.password_hash !== null,
    share: summary,
    capabilities,
    app: guestApp,
    view: guestView,
    views: [guestView],
    table: primaryGuestBundle,
    tables: [primaryGuestBundle, ...lookupBundles],
  }
}

function buildShareAccessSummary(
  db: Database,
  share: ShareRow,
  creator: AuthUser,
): ShareAccessSummary {
  const { targetMaps } = buildLookupMaps(db)
  return {
    id: share.id,
    token: share.token,
    targetType: share.target_type,
    targetId: share.target_id,
    targetName: resolveTargetDisplayName(share.target_type, share.target_id, targetMaps),
    createdByName: creator.displayName,
    expiresAt: share.expires_at,
  }
}

function resolveActiveShareAndCreator(
  db: Database,
  token: string,
): { share: ShareRow; creator: AuthUser; summary: ShareAccessSummary } {
  const share = readShareRowByToken(db, token)
  if (!share) {
    throw new NotFoundError('分享链接不存在')
  }
  assertShareActive(share)
  const creator = getUserById(db, share.created_by)
  if (!creator || creator.role === 'member') {
    throw new ForbiddenError('分享创建者账号或权限已失效')
  }
  const summary = buildShareAccessSummary(db, share, creator)
  return { share, creator, summary }
}

/** 免登录读取分享访问数据（密码保护且未解锁时仅返回锁定摘要，不泄露任何业务数据） */
export function resolveGuestShareAccess(
  db: Database,
  token: string,
  unlockToken?: string | null,
): ShareAccessResponse {
  const { share, creator, summary } = resolveActiveShareAndCreator(db, token)
  // 校验创建者是否仍对目标具备分享/访问权
  const unlockedData = buildUnlockedSharePayload(db, share, creator, summary)
  if (share.password_hash !== null && !verifyShareUnlockToken(db, share, unlockToken)) {
    return {
      unlocked: false,
      requiresPassword: true,
      share: summary,
    }
  }
  return unlockedData
}

/** 校验分享访问密码并返回解锁 Token 与分享数据 */
export function verifySharePasswordAccess(
  db: Database,
  token: string,
  password: string,
): { shareId: string; accessToken: string; access: ShareAccessUnlockedResponse } {
  const { share, creator, summary } = resolveActiveShareAndCreator(db, token)
  if (share.password_hash !== null && !verifyPassword(password, share.password_hash)) {
    throw new UnauthorizedError('访问密码错误')
  }
  const access = buildUnlockedSharePayload(db, share, creator, summary)
  const accessToken = createShareUnlockToken(db, share)
  return { shareId: share.id, accessToken, access }
}

/** 免登录访客向 entry 分享提交新增录入记录 */
export function submitShareEntryRecord(
  db: Database,
  token: string,
  record: Omit<SmartRecord, '_id'> & { _id?: string },
  unlockToken?: string | null,
): SmartRecord {
  const { share, creator } = resolveActiveShareAndCreator(db, token)
  if (share.target_type !== 'entry') {
    throw new ForbiddenError('仅录入表分享支持访客提交新记录')
  }
  if (share.password_hash !== null && !verifyShareUnlockToken(db, share, unlockToken)) {
    throw new ForbiddenError('请先通过分享访问密码校验')
  }
  const meta = getTableMeta(db, share.target_id)
  if (!meta) {
    throw new NotFoundError('分享关联的录入表不存在')
  }
  if (meta.kind !== 'normal') {
    throw new ForbiddenError('该数据表不支持访客填报')
  }
  if (!canViewTable(creator, meta, listSmartApps(db))) {
    throw new ForbiddenError('分享创建者当前无权访问该录入表')
  }

  const created = createTableRecord(db, share.target_id, record, { actorUserId: 'guest' })
  if (!created) {
    throw new NotFoundError('数据表不存在或无法写入')
  }
  return created
}
