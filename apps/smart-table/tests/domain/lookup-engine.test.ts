import { describe, expect, it } from 'vitest'

import {
  appendMatchRuleToLookupGroup,
  createLookupColumnsFromWizard,
  evaluateTableLookups,
  getEligibleLookupSourceColumns,
  getEligibleLookupTargetColumns,
  previewLookupStats,
} from '../../src/domain/lookup-engine'
import type { TableBundle } from '../../src/shared/api-types'
import type { SmartColumn, SmartRecord, SmartTableMeta } from '../../src/shared/schema'

function makeEmpTable(): TableBundle {
  return {
    meta: {
      id: 'tbl_emp',
      name: '员工花名册',
      kind: 'advanced',
      primaryKeyField: 'emp_id',
      columns: [
        { key: 'emp_id', title: '工号', type: 'text', width: 100 },
        { key: 'name', title: '姓名', type: 'person', width: 100 },
        { key: 'dept', title: '部门', type: 'select', width: 120 },
        { key: 'level', title: '职级', type: 'select', width: 80 },
      ],
      views: [],
      summaries: {},
    },
    records: [
      { _id: 'e1', emp_id: 'EMP-001', name: '张三', dept: '研发部', level: 'P7' },
      { _id: 'e2', emp_id: 'EMP-009', name: '张三', dept: '华东销售部', level: 'P6' },
      { _id: 'e3', emp_id: 'EMP-002', name: '李四', dept: '交付部', level: 'P8' },
      { _id: 'e4', emp_id: '', name: '', dept: '未知', level: 'P5' },
    ],
  }
}

function makePayTable(): TableBundle {
  return {
    meta: {
      id: 'tbl_pay',
      name: '回款流水',
      kind: 'advanced',
      primaryKeyField: 'pay_id',
      columns: [
        { key: 'pay_id', title: '流水号', type: 'text', width: 100 },
        { key: 'project_code', title: '项目编号', type: 'text', width: 120 },
        { key: 'amount', title: '金额', type: 'number', width: 100 },
        { key: 'method', title: '方式', type: 'text', width: 100 },
      ],
      views: [],
      summaries: {},
    },
    records: [
      { _id: 'p1', pay_id: 'P01', project_code: 'PRJ-1', amount: 0.1, method: '电汇' },
      { _id: 'p2', pay_id: 'P02', project_code: 'PRJ-1', amount: 0.2, method: '支票' },
      { _id: 'p3', pay_id: 'P03', project_code: 'PRJ-1', amount: 100, method: '电汇' },
      { _id: 'p4', pay_id: 'P04', project_code: 'PRJ-2', amount: 50, method: null },
    ],
  }
}

describe('lookup-engine', () => {
  it('支持一对一匹配、重名冲突检测、同组共享 LookupConflictInfo 与消歧锁定', () => {
    const meta: SmartTableMeta = {
      id: 'tbl_prj',
      name: '项目表',
      kind: 'normal',
      columns: [
        { key: 'owner', title: '负责人', type: 'person', width: 100 },
        { key: 'dept_hint', title: '部门', type: 'text', width: 100 },
        ...createLookupColumnsFromWizard({
          groupId: 'grp_emp',
          targetTableId: 'tbl_emp',
          matchRules: [{ sourceField: 'owner', targetField: 'name' }],
          mode: 'one',
          returnFields: [
            { field: 'emp_id', title: '工号' },
            { field: 'dept', title: '所属部门' },
            { field: 'level', title: '职级' },
          ],
        }),
      ],
      views: [],
      summaries: {},
    }

    const records: SmartRecord[] = [
      // 唯一命中（含首尾空白 trim）
      { _id: 'r1', owner: ' 李四 ', dept_hint: '交付部' },
      // 重名冲突未消歧
      { _id: 'r2', owner: '张三', dept_hint: '华东销售部' },
      // 重名冲突已通过 _lookupOverrides 锁定第二条
      { _id: 'r3', owner: '张三', dept_hint: '华东销售部', _lookupOverrides: { grp_emp: 'e2' } },
      // 失效的 overrideId 应回退为未消歧
      { _id: 'r4', owner: '张三', dept_hint: '研发部', _lookupOverrides: { grp_emp: 'non_exist' } },
      // 空值不参与匹配，即使目标表存在空 name 行
      { _id: 'r5', owner: '', dept_hint: '' },
      // 未命中
      { _id: 'r6', owner: '王五', dept_hint: '' },
    ]

    const tablesById = new Map<string, TableBundle>([
      ['tbl_emp', makeEmpTable()],
      ['tbl_pay', makePayTable()],
    ])

    const res = evaluateTableLookups(meta, records, tablesById)

    // 不修改原记录
    expect(records[0]!['lookup_grp_emp_emp_id_0']).toBeUndefined()

    // r1 唯一命中
    expect(res.records[0]!['lookup_grp_emp_emp_id_0']).toBe('EMP-002')
    expect(res.records[0]!['lookup_grp_emp_dept_1']).toBe('交付部')
    expect(res.records[0]!['lookup_grp_emp_level_2']).toBe('P8')
    expect(res.conflictsByRow.has('r1')).toBe(false)

    // r2 未消歧默认取首条，同 groupId 的多列共享同一个 LookupConflictInfo 实例
    expect(res.records[1]!['lookup_grp_emp_emp_id_0']).toBe('EMP-001')
    expect(res.records[1]!['lookup_grp_emp_dept_1']).toBe('研发部')
    const r2Conflict = res.conflictsByRow.get('r2')?.get('grp_emp')
    expect(r2Conflict).toBeDefined()
    expect(r2Conflict?.isResolved).toBe(false)
    expect(r2Conflict?.selectedRecordId).toBe('e1')
    expect(r2Conflict?.candidates).toHaveLength(2)

    // r3 已消歧锁定 e2
    expect(res.records[2]!['lookup_grp_emp_emp_id_0']).toBe('EMP-009')
    expect(res.records[2]!['lookup_grp_emp_dept_1']).toBe('华东销售部')
    expect(res.records[2]!['lookup_grp_emp_level_2']).toBe('P6')
    expect(res.records[2]!._lookupOverrides).toEqual({ grp_emp: 'e2' })
    const r3Conflict = res.conflictsByRow.get('r3')?.get('grp_emp')
    expect(r3Conflict?.isResolved).toBe(true)
    expect(r3Conflict?.selectedRecordId).toBe('e2')

    // r4 失效 override 回退未消歧
    expect(res.records[3]!['lookup_grp_emp_emp_id_0']).toBe('EMP-001')
    expect(res.conflictsByRow.get('r4')?.get('grp_emp')?.isResolved).toBe(false)

    // r5 空值、r6 未命中均返回 null
    expect(res.records[4]!['lookup_grp_emp_emp_id_0']).toBeNull()
    expect(res.records[5]!['lookup_grp_emp_emp_id_0']).toBeNull()

    // r2 和 r4 未解决冲突，r3 已解决 -> 共 2 个
    expect(res.unresolvedConflictCount).toBe(2)
  })

  it('支持 appendMatchRuleToLookupGroup 追加联合条件消除重名冲突', () => {
    const baseCols = createLookupColumnsFromWizard({
      groupId: 'grp_emp',
      targetTableId: 'tbl_emp',
      matchRules: [{ sourceField: 'owner', targetField: 'name' }],
      mode: 'one',
      returnFields: [{ field: 'emp_id', title: '工号' }],
    })

    // 重复追加同规则不产生冗余项
    const dedupedCols = appendMatchRuleToLookupGroup(baseCols, 'grp_emp', {
      sourceField: 'owner',
      targetField: 'name',
    })
    expect(dedupedCols[0]?.lookupConfig?.matchRules).toHaveLength(1)

    const updatedCols = appendMatchRuleToLookupGroup(dedupedCols, 'grp_emp', {
      sourceField: 'dept_hint',
      targetField: 'dept',
    })
    expect(updatedCols[0]?.lookupConfig?.matchRules).toHaveLength(2)

    const meta: SmartTableMeta = {
      id: 'tbl_prj',
      name: '项目表',
      kind: 'normal',
      columns: [
        { key: 'owner', title: '负责人', type: 'person', width: 100 },
        { key: 'dept_hint', title: '部门', type: 'text', width: 100 },
        ...updatedCols,
      ],
      views: [],
      summaries: {},
    }

    const res = evaluateTableLookups(
      meta,
      [{ _id: 'r1', owner: '张三', dept_hint: '华东销售部' }],
      new Map([['tbl_emp', makeEmpTable()]]),
    )
    expect(res.records[0]!['lookup_grp_emp_emp_id_0']).toBe('EMP-009')
    expect(res.unresolvedConflictCount).toBe(0)
  })

  it('支持一对多 Rollup 全部聚合模式（sum/count/avg/min/max/join）', () => {
    const meta: SmartTableMeta = {
      id: 'tbl_prj',
      name: '项目表',
      kind: 'normal',
      columns: [
        { key: 'code', title: '编号', type: 'text', width: 100 },
        ...createLookupColumnsFromWizard({
          groupId: 'grp_pay',
          targetTableId: 'tbl_pay',
          matchRules: [{ sourceField: 'code', targetField: 'project_code' }],
          mode: 'rollup',
          returnFields: [
            { field: 'amount', title: '总金额', rollupAgg: 'sum', numberFormat: 'currency' },
            { field: 'pay_id', title: '笔数', rollupAgg: 'count', numberFormat: 'integer' },
            { field: 'amount', title: '均值', rollupAgg: 'avg' },
            { field: 'amount', title: '最小', rollupAgg: 'min' },
            { field: 'amount', title: '最大', rollupAgg: 'max' },
            { field: 'method', title: '方式集合', rollupAgg: 'join' },
          ],
        }),
      ],
      views: [],
      summaries: {},
    }

    const res = evaluateTableLookups(
      meta,
      [
        { _id: 'r1', code: 'PRJ-1' },
        { _id: 'r2', code: 'PRJ-NONE' },
      ],
      new Map([['tbl_pay', makePayTable()]]),
    )

    // PRJ-1 命中 0.1, 0.2, 100
    expect(res.records[0]!['lookup_grp_pay_amount_0']).toBe(100.3)
    expect(res.records[0]!['lookup_grp_pay_pay_id_1']).toBe(3)
    expect(res.records[0]!['lookup_grp_pay_amount_2']).toBeCloseTo(100.3 / 3)
    expect(res.records[0]!['lookup_grp_pay_amount_3']).toBe(0.1)
    expect(res.records[0]!['lookup_grp_pay_amount_4']).toBe(100)
    expect(res.records[0]!['lookup_grp_pay_method_5']).toBe('电汇, 支票')

    // 无命中边界值
    expect(res.records[1]!['lookup_grp_pay_amount_0']).toBe(0)
    expect(res.records[1]!['lookup_grp_pay_pay_id_1']).toBe(0)
    expect(res.records[1]!['lookup_grp_pay_amount_2']).toBeNull()
    expect(res.records[1]!['lookup_grp_pay_amount_3']).toBeNull()
    expect(res.records[1]!['lookup_grp_pay_amount_4']).toBeNull()
    expect(res.records[1]!['lookup_grp_pay_method_5']).toBe('')
    expect(res.unresolvedConflictCount).toBe(0)
  })

  it('previewLookupStats 实时统计唯一命中、冲突与未命中行数', () => {
    const empRecords = makeEmpTable().records
    const sourceRecords: SmartRecord[] = [
      { _id: '1', owner: '李四' },
      { _id: '2', owner: '张三' },
      { _id: '3', owner: '张三' },
      { _id: '4', owner: '不存在' },
      { _id: '5', owner: null },
    ]
    const stats = previewLookupStats(sourceRecords, empRecords, [
      { sourceField: 'owner', targetField: 'name' },
    ])
    expect(stats).toEqual({ matchedRows: 1, conflictRows: 2, unmatchedRows: 2 })

    const emptyRules = previewLookupStats(sourceRecords, empRecords, [])
    expect(emptyRules).toEqual({ matchedRows: 0, conflictRows: 0, unmatchedRows: 5 })
  })

  it('支持本表拓扑排序与循环保护，并严格禁止关联目标表非原始字段（lookup/formula）', () => {
    const partsBundle: TableBundle = {
      meta: {
        id: 'tbl_parts',
        name: '零件表',
        kind: 'normal',
        columns: [
          { key: 'part_id', title: '零件', type: 'text', width: 100 },
          { key: 'base_days', title: '基础交期', type: 'number', width: 80 },
          // 模拟历史残留非原始列，VLOOKUP 禁止读取或匹配它们
          {
            key: 'sup_total_days',
            title: '供应商总交期',
            type: 'lookup',
            width: 100,
          },
          {
            key: 'total_days',
            title: '公式总交期',
            type: 'formula',
            width: 100,
            formulaExpr: '[base_days] + 2',
          },
        ],
        views: [],
        summaries: {},
      },
      records: [
        {
          _id: 'pt1',
          part_id: 'P-1',
          base_days: 5,
          sup_total_days: 99,
          total_days: 7,
        },
      ],
    }

    // 目标原始列过滤助手剔除 lookup/formula
    expect(getEligibleLookupTargetColumns(partsBundle.meta.columns).map((c) => c.key)).toEqual([
      'part_id',
      'base_days',
    ])

    // 本表：后置 lookup 排在前面（依赖排在后面的 lookup_part_id），经拓扑排序正确求值；
    // 引用目标表 lookup/formula 列则返回 null
    const ordersMeta: SmartTableMeta = {
      id: 'tbl_orders',
      name: '采购单',
      kind: 'normal',
      columns: [
        { key: 'part_ref', title: '零件链接', type: 'link', width: 120 },
        {
          key: 'lookup_lead_days',
          title: '交期',
          type: 'lookup',
          width: 100,
          lookupConfig: {
            groupId: 'grp_o2',
            targetTableId: 'tbl_parts',
            matchRules: [{ sourceField: 'lookup_part_id', targetField: 'part_id' }],
            targetReturnField: 'base_days',
            mode: 'one',
          },
        },
        {
          key: 'lookup_part_id',
          title: '标准零件号',
          type: 'lookup',
          width: 100,
          lookupConfig: {
            groupId: 'grp_o1',
            targetTableId: 'tbl_parts',
            matchRules: [{ sourceField: 'part_ref', targetField: 'part_id' }],
            targetReturnField: 'part_id',
            mode: 'one',
          },
        },
        {
          key: 'lookup_blocked_formula',
          title: '非法引用公式列',
          type: 'lookup',
          width: 100,
          lookupConfig: {
            groupId: 'grp_bad_ret',
            targetTableId: 'tbl_parts',
            matchRules: [{ sourceField: 'lookup_part_id', targetField: 'part_id' }],
            targetReturnField: 'total_days',
            mode: 'one',
          },
        },
        {
          key: 'lookup_blocked_match',
          title: '非法匹配公式列',
          type: 'lookup',
          width: 100,
          lookupConfig: {
            groupId: 'grp_bad_match',
            targetTableId: 'tbl_parts',
            matchRules: [{ sourceField: 'part_ref', targetField: 'sup_total_days' }],
            targetReturnField: 'part_id',
            mode: 'one',
          },
        },
        // 本表循环 lookup（自己依赖自己）应安全收敛为 null
        {
          key: 'lookup_cycle',
          title: '循环列',
          type: 'lookup',
          width: 100,
          lookupConfig: {
            groupId: 'grp_cyc',
            targetTableId: 'tbl_parts',
            matchRules: [{ sourceField: 'lookup_cycle', targetField: 'part_id' }],
            targetReturnField: 'part_id',
            mode: 'one',
          },
        },
      ],
      views: [],
      summaries: {},
    }

    const tablesById = new Map<string, TableBundle>([['tbl_parts', partsBundle]])

    const res = evaluateTableLookups(
      ordersMeta,
      [{ _id: 'o1', part_ref: { url: 'https://example.com/p1', text: 'P-1' } }],
      tablesById,
    )
    expect(res.records[0]!['lookup_part_id']).toBe('P-1')
    expect(res.records[0]!['lookup_lead_days']).toBe(5)
    expect(res.records[0]!['lookup_blocked_formula']).toBeNull()
    expect(res.records[0]!['lookup_blocked_match']).toBeNull()
    expect(res.records[0]!['lookup_cycle']).toBeNull()

    // previewLookupStats 传入 targetColumns 时禁止匹配非原始字段
    const badStats = previewLookupStats(
      [{ _id: '1', k: 99 }],
      partsBundle.records,
      [{ sourceField: 'k', targetField: 'sup_total_days' }],
      partsBundle.meta.columns,
    )
    expect(badStats).toEqual({ matchedRows: 0, conflictRows: 0, unmatchedRows: 1 })
  })

  it('支持传入 SmartApp.derivedColumns 与 SmartApp.lookupOverrides 求值与重名消歧', () => {
    const rawMeta: SmartTableMeta = {
      id: 'tbl_prj',
      name: '项目表',
      kind: 'normal',
      columns: [{ key: 'owner', title: '负责人', type: 'person', width: 100 }],
      views: [],
      summaries: {},
    }
    const derivedColumns = createLookupColumnsFromWizard({
      groupId: 'grp_emp',
      targetTableId: 'tbl_emp',
      matchRules: [{ sourceField: 'owner', targetField: 'name' }],
      mode: 'one',
      returnFields: [{ field: 'emp_id', title: '工号' }],
    })
    const records: SmartRecord[] = [
      { _id: 'r1', owner: '张三' },
      { _id: 'r2', owner: '张三' },
    ]
    const tablesById = new Map<string, TableBundle>([['tbl_emp', makeEmpTable()]])

    const res = evaluateTableLookups(rawMeta, records, tablesById, {
      derivedColumns,
      lookupOverrides: { r1: { grp_emp: 'e2' } },
    })

    const key = derivedColumns[0]!.key
    expect(res.records[0]![key]).toBe('EMP-009')
    expect(res.records[1]![key]).toBe('EMP-001')
    expect(res.conflictsByRow.get('r1')?.get('grp_emp')?.isResolved).toBe(true)
    expect(res.conflictsByRow.get('r2')?.get('grp_emp')?.isResolved).toBe(false)
    expect(res.unresolvedConflictCount).toBe(1)
  })

  it('createLookupColumnsFromWizard 防止 key 冲突且 count 强制使用 integer 格式', () => {
    const first = createLookupColumnsFromWizard({
      groupId: 'grp_pay',
      targetTableId: 'tbl_pay',
      matchRules: [{ sourceField: 'code', targetField: 'project_code' }],
      mode: 'rollup',
      returnFields: [
        { field: 'amount', title: '笔数', rollupAgg: 'count', numberFormat: 'currency' },
      ],
    })
    expect(first[0]?.numberFormat).toBe('integer')

    const second = createLookupColumnsFromWizard({
      groupId: 'grp_pay',
      targetTableId: 'tbl_pay',
      matchRules: [{ sourceField: 'code', targetField: 'project_code' }],
      mode: 'rollup',
      existingKeys: first.map((c) => c.key),
      returnFields: [{ field: 'amount', title: '二次笔数', rollupAgg: 'count' }],
    })
    expect(second[0]?.key).not.toBe(first[0]?.key)
    expect(second[0]?.numberFormat).toBe('integer')
  })

  it('getEligibleLookupSourceColumns 与 appendMatchRuleToLookupGroup 禁止把本组带出字段、依赖列或公式列加入匹配条件', () => {
    const grpEmpCols = createLookupColumnsFromWizard({
      groupId: 'grp_emp',
      targetTableId: 'tbl_emp',
      matchRules: [{ sourceField: 'owner', targetField: 'name' }],
      mode: 'one',
      returnFields: [
        { field: 'dept', title: '所属部门' },
        { field: 'emp_id', title: '唯一工号' },
      ],
    })
    const grpDeptLeadCols = createLookupColumnsFromWizard({
      groupId: 'grp_dept_lead',
      targetTableId: 'tbl_dept',
      matchRules: [{ sourceField: grpEmpCols[0]!.key, targetField: 'dept' }],
      mode: 'one',
      returnFields: [{ field: 'lead', title: '部门总监' }],
    })
    const grpIndependentCols = createLookupColumnsFromWizard({
      groupId: 'grp_pay',
      targetTableId: 'tbl_pay',
      matchRules: [{ sourceField: 'code', targetField: 'project_code' }],
      mode: 'rollup',
      returnFields: [{ field: 'amount', title: '累计回款', rollupAgg: 'sum' }],
    })

    const columns: SmartColumn[] = [
      { key: 'code', title: '项目编号', type: 'text', width: 100 },
      { key: 'owner', title: '负责人', type: 'person', width: 100 },
      { key: 'region', title: '大区', type: 'select', width: 100 },
      ...grpEmpCols,
      ...grpDeptLeadCols,
      ...grpIndependentCols,
      {
        key: 'formula_rate',
        title: '达成率',
        type: 'formula',
        width: 100,
        formulaExpr: '[code]',
      },
    ]

    // grp_emp 不能选自身带出列、依赖自身的 grp_dept_lead 列或公式列；保留原生列与无环外部关联列
    const eligibleForEmp = getEligibleLookupSourceColumns(columns, 'grp_emp').map((c) => c.key)
    expect(eligibleForEmp).toEqual(['code', 'owner', 'region', grpIndependentCols[0]!.key])

    // appendMatchRuleToLookupGroup 拒绝追加本组带出列、成环依赖列与公式列
    for (const badSource of [
      grpEmpCols[0]!.key,
      grpEmpCols[1]!.key,
      grpDeptLeadCols[0]!.key,
      'formula_rate',
    ]) {
      const next = appendMatchRuleToLookupGroup(columns, 'grp_emp', {
        sourceField: badSource,
        targetField: 'dept',
      })
      const empCol = next.find((c) => c.key === grpEmpCols[0]!.key)!
      expect(empCol.lookupConfig?.matchRules).toHaveLength(1)
    }

    // 原生字段可正常追加
    const validNext = appendMatchRuleToLookupGroup(columns, 'grp_emp', {
      sourceField: 'region',
      targetField: 'dept',
    })
    expect(
      validNext.find((c) => c.key === grpEmpCols[0]!.key)?.lookupConfig?.matchRules,
    ).toHaveLength(2)
  })
})
