// 关联管理草稿模型纯逻辑测试：分组草稿构建、编辑操作、dirty/校验与保存载荷构建应用。
import { describe, expect, it } from 'vitest'

import { createLookupColumnsFromWizard } from '../../src/domain/lookup-engine'
import {
  appendLookupRule,
  applyLookupManageChanges,
  buildLookupManageChanges,
  createLookupManageDraft,
  deleteLookupGroup,
  isLookupDraftDirty,
  lookupDraftError,
  removeLookupItem,
  removeLookupRule,
  setLookupItemAgg,
  setLookupItemField,
  setLookupItemTitle,
  updateLookupRule,
} from '../../src/domain/lookup-manage'
import type { TableBundle } from '../../src/shared/api-types'
import type { SmartColumn } from '../../src/shared/schema'

const EMP_COLUMNS: SmartColumn[] = [
  { key: 'emp_id', title: '工号', type: 'text', width: 100 },
  { key: 'name', title: '姓名', type: 'person', width: 100 },
  { key: 'dept', title: '部门', type: 'select', width: 120 },
]

const tablesById = new Map<string, TableBundle>([
  [
    'tbl_emp',
    {
      meta: {
        id: 'tbl_emp',
        name: '员工花名册',
        kind: 'advanced',
        columns: EMP_COLUMNS,
        views: [],
        summaries: {},
      },
      records: [],
    },
  ],
])

function makeOneColumns(): SmartColumn[] {
  const [deptCol, levelCol] = createLookupColumnsFromWizard({
    groupId: 'grp_emp',
    targetTableId: 'tbl_emp',
    matchRules: [{ sourceField: 'owner', targetField: 'name' }],
    mode: 'one',
    returnFields: [
      { field: 'dept', title: '部门' },
      { field: 'emp_id', title: '工号' },
    ],
  })
  return [{ key: 'owner', title: '负责人', type: 'text', width: 100 }, deptCol!, levelCol!]
}

function makeRollupColumns(): SmartColumn[] {
  const [countCol] = createLookupColumnsFromWizard({
    groupId: 'grp_pay',
    targetTableId: 'tbl_emp',
    matchRules: [{ sourceField: 'code', targetField: 'name' }],
    mode: 'rollup',
    returnFields: [{ field: 'dept', title: '部门计数', rollupAgg: 'count' }],
  })
  return [{ key: 'code', title: '编号', type: 'text', width: 100 }, countCol!]
}

describe('createLookupManageDraft', () => {
  it('同 groupId 聚为一组，targetTitle 由目标表列标题解析', () => {
    const draft = createLookupManageDraft(makeOneColumns(), tablesById)
    expect(draft.groups).toHaveLength(1)
    const group = draft.groups[0]!
    expect(group.mode).toBe('one')
    expect(group.items.map((item) => [item.field, item.targetTitle])).toEqual([
      ['dept', '部门'],
      ['emp_id', '工号'],
    ])
    expect(isLookupDraftDirty(draft)).toBe(false)
    expect(lookupDraftError(draft)).toBeNull()
  })
})

describe('编辑操作与 dirty', () => {
  it('规则更新/追加/删除（最后一条不可删）', () => {
    let draft = createLookupManageDraft(makeOneColumns(), tablesById)
    const groupId = draft.groups[0]!.groupId
    draft = updateLookupRule(draft, groupId, 0, { sourceField: 'title' })
    draft = appendLookupRule(draft, groupId, { sourceField: 'owner', targetField: 'dept' })
    expect(draft.groups[0]!.matchRules).toEqual([
      { sourceField: 'title', targetField: 'name' },
      { sourceField: 'owner', targetField: 'dept' },
    ])
    draft = removeLookupRule(draft, groupId, 0)
    expect(draft.groups[0]!.matchRules).toHaveLength(1)
    draft = removeLookupRule(draft, groupId, 0)
    expect(draft.groups[0]!.matchRules).toHaveLength(1)
    expect(isLookupDraftDirty(draft)).toBe(true)
  })

  it('列名/带出字段/聚合方式编辑与移除列', () => {
    let draft = createLookupManageDraft(makeRollupColumns(), tablesById)
    const groupId = draft.groups[0]!.groupId
    const itemKey = draft.groups[0]!.items[0]!.key
    draft = setLookupItemTitle(draft, groupId, itemKey, '部门个数')
    draft = setLookupItemField(draft, groupId, itemKey, 'name', '姓名')
    draft = setLookupItemAgg(draft, groupId, itemKey, 'sum')
    expect(draft.groups[0]!.items[0]).toMatchObject({
      title: '部门个数',
      field: 'name',
      targetTitle: '姓名',
      rollupAgg: 'sum',
    })
    draft = removeLookupItem(draft, groupId, itemKey)
    expect(draft.groups[0]!.items[0]!.removed).toBe(true)
  })

  it('删除整组清空追加项并标记全部列移除', () => {
    let draft = createLookupManageDraft(makeOneColumns(), tablesById)
    const groupId = draft.groups[0]!.groupId
    draft = deleteLookupGroup(draft, groupId)
    expect(draft.groups[0]!.deleted).toBe(true)
    expect(draft.groups[0]!.items.every((item) => item.removed)).toBe(true)
    expect(lookupDraftError(draft)).toBeNull()
  })

  it('空列名校验失败', () => {
    let draft = createLookupManageDraft(makeOneColumns(), tablesById)
    const groupId = draft.groups[0]!.groupId
    const itemKey = draft.groups[0]!.items[0]!.key
    draft = setLookupItemTitle(draft, groupId, itemKey, '  ')
    expect(lookupDraftError(draft)).toBe('带出列显示名称不能为空')
  })
})

describe('buildLookupManageChanges + applyLookupManageChanges', () => {
  it('改标题 + 改规则（同组联动）+ 换带出字段一次应用', () => {
    const columns = makeOneColumns()
    let draft = createLookupManageDraft(columns, tablesById)
    const groupId = draft.groups[0]!.groupId
    const [deptItem, empItem] = draft.groups[0]!.items
    draft = setLookupItemTitle(draft, groupId, deptItem!.key, '所属部门')
    draft = setLookupItemField(draft, groupId, empItem!.key, 'name', '姓名')
    draft = appendLookupRule(draft, groupId, { sourceField: 'region', targetField: 'dept' })

    const next = applyLookupManageChanges(
      columns,
      buildLookupManageChanges(draft, columns, tablesById),
    )

    expect(next.map((c) => c.key)).toEqual(columns.map((c) => c.key))
    const deptCol = next.find((c) => c.key === deptItem!.key)!
    expect(deptCol.title).toBe('所属部门')
    // 规则变更联动到同组全部列；带出字段仅本列切换
    expect(deptCol.lookupConfig?.matchRules).toHaveLength(2)
    const empCol = next.find((c) => c.key === empItem!.key)!
    expect(empCol.lookupConfig?.matchRules).toHaveLength(2)
    expect(empCol.lookupConfig?.targetReturnField).toBe('name')
  })

  it('聚合方式切换联动数值格式：count → integer、join → 清除', () => {
    const columns = makeRollupColumns()
    let draft = createLookupManageDraft(columns, tablesById)
    const groupId = draft.groups[0]!.groupId
    const itemKey = draft.groups[0]!.items[0]!.key
    draft = setLookupItemAgg(draft, groupId, itemKey, 'join')
    let next = applyLookupManageChanges(
      columns,
      buildLookupManageChanges(draft, columns, tablesById),
    )
    expect(next[1]!.numberFormat).toBeUndefined()
    expect(next[1]!.lookupConfig?.rollupAgg).toBe('join')

    draft = setLookupItemAgg(draft, groupId, itemKey, 'count')
    next = applyLookupManageChanges(columns, buildLookupManageChanges(draft, columns, tablesById))
    expect(next[1]!.numberFormat).toBe('integer')
  })

  it('移除列与删除整组产出 deletedKeys', () => {
    const columns = makeOneColumns()
    let draft = createLookupManageDraft(columns, tablesById)
    const groupId = draft.groups[0]!.groupId
    const [deptItem] = draft.groups[0]!.items
    draft = removeLookupItem(draft, groupId, deptItem!.key)
    let changes = buildLookupManageChanges(draft, columns, tablesById)
    expect(changes.deletedKeys).toEqual([deptItem!.key])

    draft = deleteLookupGroup(draft, groupId)
    changes = buildLookupManageChanges(draft, columns, tablesById)
    expect(changes.deletedKeys).toEqual(
      columns.filter((c) => c.type === 'lookup').map((c) => c.key),
    )
  })

  it('staged 追加物化为同组新列（防 key 冲突）', () => {
    const columns = makeOneColumns()
    let draft = createLookupManageDraft(columns, tablesById)
    const groupId = draft.groups[0]!.groupId
    draft = appendLookupRule(draft, groupId, { sourceField: 'owner', targetField: 'dept' })
    draft = {
      groups: draft.groups.map((group) =>
        group.groupId === groupId
          ? { ...group, staged: [{ field: 'dept', title: '部门2' }] }
          : group,
      ),
    }
    const changes = buildLookupManageChanges(draft, columns, tablesById)
    expect(changes.addedColumns).toHaveLength(1)
    const added = changes.addedColumns[0]!
    expect(added.lookupConfig?.groupId).toBe(groupId)
    // staged 携带编辑后的规则与目标列宽
    expect(added.lookupConfig?.matchRules).toHaveLength(2)
    expect(added.width).toBe(120)
    const next = applyLookupManageChanges(columns, changes)
    expect(next.map((c) => c.key)).toContain(added.key)
  })
})
