// 纯领域权限模型与访客边界判定单元测试。
import { describe, expect, test } from 'vitest'
import {
  canAccessRecord,
  canConfigureApp,
  canConfigureTable,
  canConfigureView,
  canCreateShareForTarget,
  canEditAppRecords,
  canManageShare,
  canViewApp,
  canViewTable,
  canViewView,
  canWriteTableRecords,
  computeGuestShareCapabilities,
  computeUserCapabilities,
  filterLookupOverridesForRecords,
  filterTableRecordsForUser,
  getEffectiveMemberAccess,
  resolveShareStatus,
} from '../../src/domain/permissions'
import type {
  AuthUser,
  SmartApp,
  SmartRecord,
  SmartTableMeta,
  WorkspaceView,
} from '../../src/shared/schema'

const ADMIN: AuthUser = { id: 'usr_admin', username: 'admin', displayName: '管理员', role: 'admin' }
const MGR_A: AuthUser = { id: 'usr_mgr_a', username: 'lisi', displayName: '李四', role: 'manager' }
const MGR_B: AuthUser = {
  id: 'usr_mgr_b',
  username: 'wangwu',
  displayName: '王五',
  role: 'manager',
}
const MEMBER: AuthUser = {
  id: 'usr_mem_1',
  username: 'qianqi',
  displayName: '钱七',
  role: 'member',
}

function makeTable(partial: Partial<SmartTableMeta> = {}): SmartTableMeta {
  return {
    id: 'tbl_1',
    name: '测试表',
    kind: 'normal',
    columns: [
      { key: 'title', title: '标题', type: 'text', width: 160 },
      { key: 'owner', title: '负责人', type: 'person', width: 120 },
    ],
    views: [],
    summaries: {},
    rowScope: 'all',
    ...partial,
  }
}

function makeApp(partial: Partial<SmartApp> = {}): SmartApp {
  return {
    id: 'app_1',
    name: '测试应用',
    tableId: 'tbl_1',
    sortOrder: 0,
    createdBy: ADMIN.id,
    visibilityScope: 'all',
    managerUserIds: [],
    memberAccess: 'readonly',
    ...partial,
  }
}

function makeView(partial: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'view_1',
    appId: 'app_1',
    tableId: 'tbl_1',
    name: '默认视图',
    type: 'table',
    sortOrder: 0,
    filterGroup: { conjunction: 'and', conditions: [] },
    quickFilterFields: [],
    sortRules: [],
    createdBy: ADMIN.id,
    visibilityScope: 'all',
    managerUserIds: [],
    ...partial,
  }
}

describe('角色能力与两层可见性判定', () => {
  test('computeUserCapabilities 严格区分 admin / manager / member', () => {
    expect(computeUserCapabilities(ADMIN)).toEqual({
      canAccessDataSources: true,
      canCreateTable: true,
      canCreateApp: true,
      canManagePermissions: true,
      canManageShares: true,
      canResetSeed: true,
    })
    expect(computeUserCapabilities(MGR_A)).toEqual({
      canAccessDataSources: true,
      canCreateTable: true,
      canCreateApp: true,
      canManagePermissions: true,
      canManageShares: true,
      canResetSeed: false,
    })
    expect(computeUserCapabilities(MEMBER)).toEqual({
      canAccessDataSources: false,
      canCreateTable: false,
      canCreateApp: false,
      canManagePermissions: false,
      canManageShares: false,
      canResetSeed: false,
    })
  })

  test('应用可见范围 self / managers / all 严格隔离且成员不可混入 managers', () => {
    const selfApp = makeApp({ createdBy: MGR_A.id, visibilityScope: 'self' })
    expect(canViewApp(ADMIN, selfApp)).toBe(true)
    expect(canViewApp(MGR_A, selfApp)).toBe(true)
    expect(canViewApp(MGR_B, selfApp)).toBe(false)
    expect(canViewApp(MEMBER, selfApp)).toBe(false)

    const mgrApp = makeApp({
      createdBy: ADMIN.id,
      visibilityScope: 'managers',
      managerUserIds: [MGR_A.id, MEMBER.id],
    })
    expect(canViewApp(ADMIN, mgrApp)).toBe(true)
    expect(canViewApp(MGR_A, mgrApp)).toBe(true)
    expect(canViewApp(MGR_B, mgrApp)).toBe(false)
    expect(canViewApp(MEMBER, mgrApp)).toBe(false)
    expect(canConfigureApp(MGR_A, mgrApp)).toBe(true)
    expect(canConfigureApp(MGR_B, mgrApp)).toBe(false)
    expect(canConfigureApp(MEMBER, mgrApp)).toBe(false)
  })

  test('视图可见性与配置权受所属应用双层约束', () => {
    const hiddenParent = makeApp({ createdBy: ADMIN.id, visibilityScope: 'self' })
    const allView = makeView({ visibilityScope: 'all' })
    expect(canViewView(MGR_A, allView, hiddenParent)).toBe(false)
    expect(canViewView(MEMBER, allView, hiddenParent)).toBe(false)
    expect(canViewView(ADMIN, allView, hiddenParent)).toBe(true)

    const mgrParent = makeApp({ createdBy: MGR_A.id, visibilityScope: 'all' })
    const adminSelfView = makeView({ createdBy: ADMIN.id, visibilityScope: 'self' })
    const normalChildView = makeView({ createdBy: ADMIN.id, visibilityScope: 'all' })
    const mgrBOnlyView = makeView({
      createdBy: ADMIN.id,
      visibilityScope: 'managers',
      managerUserIds: [MGR_B.id],
    })
    expect(canViewView(MGR_A, adminSelfView, mgrParent)).toBe(false)
    expect(canConfigureView(MGR_A, adminSelfView, mgrParent)).toBe(false)
    expect(canConfigureView(MGR_A, normalChildView, mgrParent)).toBe(true)
    expect(canConfigureView(MGR_B, normalChildView, mgrParent)).toBe(false)

    // 父应用负责人未被列入子视图 managers 名单时，既不可见也不可配置/分享（B3）
    expect(canViewView(MGR_A, mgrBOnlyView, mgrParent)).toBe(false)
    expect(canConfigureView(MGR_A, mgrBOnlyView, mgrParent)).toBe(false)
    expect(canCreateShareForTarget(MGR_A, 'view', { view: mgrBOnlyView, app: mgrParent })).toBe(
      false,
    )
    expect(canViewView(MGR_B, mgrBOnlyView, mgrParent)).toBe(true)
    expect(canConfigureView(MGR_B, mgrBOnlyView, mgrParent)).toBe(true)

    // 若父应用对 MGR_B 不可见，即使子视图指定 MGR_B 也受父层拦截
    const selfParentForA = makeApp({ createdBy: MGR_A.id, visibilityScope: 'self' })
    expect(canViewView(MGR_B, mgrBOnlyView, selfParentForA)).toBe(false)
    expect(canConfigureView(MGR_B, mgrBOnlyView, selfParentForA)).toBe(false)
  })

  test('普通成员资源授权（readonly / editable）继承与视图级覆盖正确生效', () => {
    const roApp = makeApp({ visibilityScope: 'all', memberAccess: 'readonly' })
    const edApp = makeApp({ visibilityScope: 'all', memberAccess: 'editable' })
    const inheritedView = makeView()
    const explicitRoView = makeView({ memberAccess: 'readonly' })
    const explicitEdView = makeView({ memberAccess: 'editable' })

    expect(getEffectiveMemberAccess(roApp, inheritedView)).toBe('readonly')
    expect(getEffectiveMemberAccess(edApp, inheritedView)).toBe('editable')
    expect(getEffectiveMemberAccess(edApp, explicitRoView)).toBe('readonly')
    expect(getEffectiveMemberAccess(roApp, explicitEdView)).toBe('editable')

    expect(canEditAppRecords(MEMBER, roApp, inheritedView)).toBe(false)
    expect(canEditAppRecords(MEMBER, edApp, inheritedView)).toBe(true)
    expect(canEditAppRecords(MEMBER, edApp, explicitRoView)).toBe(false)
    expect(canEditAppRecords(MGR_B, roApp, inheritedView)).toBe(true)
  })
})

describe('表级权限、行级过滤与 person 列匹配', () => {
  test('canViewTable 与 canWriteTableRecords 正确解析绑定应用、VLOOKUP 引用与上下文', () => {
    const tblMain = makeTable({ id: 'tbl_main' })
    const tblLookup = makeTable({ id: 'tbl_ref' })
    const tblSecret = makeTable({ id: 'tbl_secret', createdBy: ADMIN.id })

    const appVisible = makeApp({
      id: 'app_v',
      tableId: 'tbl_main',
      visibilityScope: 'all',
      memberAccess: 'readonly',
      derivedColumns: [
        {
          key: 'lookup_title',
          title: '引用',
          type: 'lookup',
          width: 120,
          lookupConfig: {
            groupId: 'g1',
            targetTableId: 'tbl_ref',
            matchRules: [{ sourceField: 'title', targetField: 'title' }],
            targetReturnField: 'owner',
            mode: 'one',
          },
        },
      ],
    })
    const appSecret = makeApp({ id: 'app_s', tableId: 'tbl_secret', visibilityScope: 'self' })
    const apps = [appVisible, appSecret]
    const views = [makeView({ id: 'v_ro', appId: 'app_v', tableId: 'tbl_main' })]

    expect(canViewTable(MEMBER, tblMain, apps)).toBe(true)
    expect(canViewTable(MEMBER, tblLookup, apps)).toBe(true)
    expect(canViewTable(MEMBER, tblSecret, apps)).toBe(false)
    expect(canViewTable(MGR_A, tblSecret, apps)).toBe(false)
    expect(canViewTable(ADMIN, tblSecret, apps)).toBe(true)

    expect(canWriteTableRecords(MEMBER, tblMain, apps, views)).toBe(false)
    expect(canWriteTableRecords(MGR_A, tblMain, apps, views)).toBe(true)

    const edApps = [{ ...appVisible, memberAccess: 'editable' as const }]
    expect(canWriteTableRecords(MEMBER, tblMain, edApps, views)).toBe(true)
    const roOverrideViews = [
      makeView({ id: 'v_ro', appId: 'app_v', tableId: 'tbl_main', memberAccess: 'readonly' }),
    ]
    expect(canWriteTableRecords(MEMBER, tblMain, edApps, roOverrideViews)).toBe(false)
  })

  test('rowScope（self / manager / all）基于 createdBy 与绑定 person 列精确过滤', () => {
    const records: SmartRecord[] = [
      { _id: 'r1', title: '管理员建-李四负责', createdBy: ADMIN.id, owner: '李四' },
      { _id: 'r2', title: '管理员建-王五负责', createdBy: ADMIN.id, owner: '王五' },
      { _id: 'r3', title: '钱七自建-未填负责人', createdBy: MEMBER.id, owner: '' },
      { _id: 'r4', title: '管理员建-钱七负责', createdBy: ADMIN.id, owner: '钱七' },
    ]

    const selfTbl = makeTable({ rowScope: 'self', ownerColumnKey: 'owner' })
    expect(filterTableRecordsForUser(ADMIN, selfTbl, records).map((r) => r._id)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
    ])
    expect(filterTableRecordsForUser(MGR_A, selfTbl, records).map((r) => r._id)).toEqual(['r1'])
    expect(filterTableRecordsForUser(MGR_B, selfTbl, records).map((r) => r._id)).toEqual(['r2'])
    expect(filterTableRecordsForUser(MEMBER, selfTbl, records).map((r) => r._id)).toEqual([
      'r3',
      'r4',
    ])

    // rowScope === 'manager'：负责人可看全表，普通成员仅看本人创建或负责的行
    const mgrTbl = makeTable({ rowScope: 'manager', ownerColumnKey: 'owner' })
    expect(filterTableRecordsForUser(MGR_A, mgrTbl, records).map((r) => r._id)).toEqual([
      'r1',
      'r2',
      'r3',
      'r4',
    ])
    expect(filterTableRecordsForUser(MEMBER, mgrTbl, records).map((r) => r._id)).toEqual([
      'r3',
      'r4',
    ])

    // 未绑定或绑定非 person 列时，仅按 createdBy 匹配
    const nonPersonTbl = makeTable({ rowScope: 'self', ownerColumnKey: 'title' })
    expect(filterTableRecordsForUser(MEMBER, nonPersonTbl, records).map((r) => r._id)).toEqual([
      'r3',
    ])
    expect(canAccessRecord(MEMBER, nonPersonTbl, records[3]!)).toBe(false)
  })
})

describe('分享创建权、管理权、状态与访客能力边界', () => {
  test('分享创建权与管理权：成员禁止，负责人仅限自己负责资源及本人链接', () => {
    const normalTbl = makeTable({ createdBy: MGR_A.id })
    const advTbl = makeTable({ id: 'tbl_adv', kind: 'advanced', createdBy: MGR_A.id })
    const appA = makeApp({ createdBy: MGR_A.id })
    const viewA = makeView({ createdBy: MGR_A.id })

    expect(canCreateShareForTarget(MEMBER, 'app', { app: appA })).toBe(false)
    expect(canCreateShareForTarget(MGR_A, 'app', { app: appA })).toBe(true)
    expect(canCreateShareForTarget(MGR_B, 'app', { app: appA })).toBe(false)
    expect(canCreateShareForTarget(MGR_A, 'view', { view: viewA, app: appA })).toBe(true)
    expect(canCreateShareForTarget(MGR_A, 'entry', { table: normalTbl })).toBe(true)
    expect(canCreateShareForTarget(ADMIN, 'entry', { table: advTbl })).toBe(false)
    expect(canConfigureTable(MGR_A, normalTbl, [appA])).toBe(true)

    expect(canManageShare(ADMIN, { createdBy: MGR_A.id })).toBe(true)
    expect(canManageShare(MGR_A, { createdBy: MGR_A.id })).toBe(true)
    expect(canManageShare(MGR_B, { createdBy: MGR_A.id })).toBe(false)
    expect(canManageShare(MEMBER, { createdBy: MEMBER.id })).toBe(false)
  })

  test('分享状态解析、访客只读/填报能力快照与消歧映射裁剪', () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    expect(resolveShareStatus({ expiresAt: null, revokedAt: null }, now)).toBe('active')
    expect(
      resolveShareStatus({ expiresAt: '2026-06-02T00:00:00.000Z', revokedAt: null }, now),
    ).toBe('active')
    expect(
      resolveShareStatus({ expiresAt: '2026-06-01T12:00:00.000Z', revokedAt: null }, now),
    ).toBe('expired')
    expect(
      resolveShareStatus(
        { expiresAt: '2026-06-02T00:00:00.000Z', revokedAt: '2026-06-01T10:00:00.000Z' },
        now,
      ),
    ).toBe('revoked')

    expect(computeGuestShareCapabilities('app').canEditRecords).toBe(false)
    expect(computeGuestShareCapabilities('view').canEditRecords).toBe(false)
    expect(computeGuestShareCapabilities('entry')).toEqual({
      canView: true,
      canEditRecords: true,
      canConfigure: false,
      canManagePermissions: false,
      canCreateShare: false,
      canManageDataSource: false,
    })

    expect(
      filterLookupOverridesForRecords({ r1: { g1: 'e1' }, r2: { g1: 'e2' } }, [{ _id: 'r1' }]),
    ).toEqual({ r1: { g1: 'e1' } })
  })
})
