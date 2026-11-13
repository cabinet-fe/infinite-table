import { describe, expect, it } from 'vitest'

import {
  computeSummaries,
  filterRecords,
  formatSummaryValue,
  runSmartTablePipeline,
  sortRecords,
} from '../../src/domain/query-engine'
import type { TableBundle } from '../../src/shared/api-types'
import type {
  FilterGroup,
  SmartColumn,
  SmartRecord,
  SmartTableMeta,
  SmartView,
} from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 100 },
  { key: 'status', title: '状态', type: 'select', width: 100 },
  { key: 'amount', title: '金额', type: 'number', width: 120, numberFormat: 'currency' },
  { key: 'verified', title: '已核验', type: 'checkbox', width: 80 },
  { key: 'date', title: '日期', type: 'date', width: 110 },
]

const SAMPLE_RECORDS: SmartRecord[] = [
  { _id: '1', code: 'P-10', status: '进行中', amount: 200, verified: true, date: '2025-03-01' },
  { _id: '2', code: 'P-2', status: '已交付', amount: 50, verified: true, date: '2025-01-15' },
  { _id: '3', code: 'P-1', status: '风险预警', amount: null, verified: false, date: '' },
  { _id: '4', code: 'P-3', status: '', amount: 500, verified: false, date: '2025-02-10' },
]

describe('query-engine', () => {
  it('filterRecords 支持快捷胶囊筛选（含 (空)）与全部 11 种高级条件操作符', () => {
    const emptyGroup: FilterGroup = { conjunction: 'and', conditions: [] }

    // 快捷胶囊筛选 '(空)'
    const emptyStatus = filterRecords(SAMPLE_RECORDS, COLUMNS, emptyGroup, { status: ['(空)'] })
    expect(emptyStatus.map((r) => r._id)).toEqual(['4'])

    // 多字段快捷胶囊同时生效
    const quickMulti = filterRecords(SAMPLE_RECORDS, COLUMNS, emptyGroup, {
      status: ['进行中', '已交付'],
      verified: ['true'],
    })
    expect(quickMulti.map((r) => r._id)).toEqual(['1', '2'])

    const checkOp = (
      field: string,
      operator: FilterGroup['conditions'][number]['operator'],
      value: unknown,
    ) =>
      filterRecords(SAMPLE_RECORDS, COLUMNS, {
        conjunction: 'and',
        conditions: [{ id: 'c1', field, operator, value }],
      }).map((r) => r._id)

    expect(checkOp('status', 'eq', '进行中')).toEqual(['1'])
    expect(checkOp('status', 'neq', '进行中')).toEqual(['2', '3', '4'])
    expect(checkOp('status', 'contains', '交付')).toEqual(['2'])
    expect(checkOp('status', 'not_contains', '交付')).toEqual(['1', '3', '4'])
    expect(checkOp('amount', 'gt', 100)).toEqual(['1', '4'])
    expect(checkOp('amount', 'gte', 200)).toEqual(['1', '4'])
    expect(checkOp('amount', 'lt', 200)).toEqual(['2'])
    expect(checkOp('amount', 'lte', 200)).toEqual(['1', '2'])
    expect(checkOp('status', 'in', ['已交付', '风险预警'])).toEqual(['2', '3'])
    expect(checkOp('amount', 'is_empty', null)).toEqual(['3'])
    expect(checkOp('amount', 'is_not_empty', null)).toEqual(['1', '2', '4'])

    // OR 组合
    const orRes = filterRecords(SAMPLE_RECORDS, COLUMNS, {
      conjunction: 'or',
      conditions: [
        { id: 'c1', field: 'status', operator: 'eq', value: '已交付' },
        { id: 'c2', field: 'amount', operator: 'gte', value: 500 },
      ],
    })
    expect(orRes.map((r) => r._id)).toEqual(['2', '4'])
  })

  it('sortRecords 支持多级排序、空值统一置底与自然序排序', () => {
    const byAmountAsc = sortRecords(SAMPLE_RECORDS, COLUMNS, [
      { field: 'amount', direction: 'asc' },
    ])
    // 50 < 200 < 500，null 置底
    expect(byAmountAsc.map((r) => r._id)).toEqual(['2', '1', '4', '3'])

    const byAmountDesc = sortRecords(SAMPLE_RECORDS, COLUMNS, [
      { field: 'amount', direction: 'desc' },
    ])
    // 降序时 null 依然置底
    expect(byAmountDesc.map((r) => r._id)).toEqual(['4', '1', '2', '3'])

    // 自然序：P-1 < P-2 < P-3 < P-10
    const byCodeAsc = sortRecords(SAMPLE_RECORDS, COLUMNS, [{ field: 'code', direction: 'asc' }])
    expect(byCodeAsc.map((r) => r.code)).toEqual(['P-1', 'P-2', 'P-3', 'P-10'])

    // 多级排序：先按 verified 降序，再按 amount 升序
    const multiSort = sortRecords(SAMPLE_RECORDS, COLUMNS, [
      { field: 'verified', direction: 'desc' },
      { field: 'amount', direction: 'asc' },
    ])
    expect(multiSort.map((r) => r._id)).toEqual(['2', '1', '4', '3'])
  })

  it('computeSummaries 与 formatSummaryValue 计算并格式化各类底部汇总', () => {
    const summaries = computeSummaries(SAMPLE_RECORDS, COLUMNS, {
      code: 'count',
      amount: 'sum',
      verified: 'filled_rate',
      date: 'none',
    })

    expect(summaries['code']).toEqual({ type: 'count', value: 4, text: '4' })
    expect(summaries['amount']).toEqual({ type: 'sum', value: 750, text: '¥750' })
    expect(summaries['verified']).toEqual({ type: 'filled_rate', value: 0.5, text: '50%' })
    expect(summaries['date']).toEqual({ type: 'none', value: null, text: '' })

    expect(formatSummaryValue(0.8333, 'avg', 'percent')).toBe('83.3%')
    expect(formatSummaryValue(null, 'avg', 'decimal')).toBe('-')
  })

  it('runSmartTablePipeline 串联 VLOOKUP → 公式列 → 过滤 → 排序 → 汇总', () => {
    const empBundle: TableBundle = {
      meta: {
        id: 'tbl_emp',
        name: '员工',
        kind: 'advanced',
        columns: [
          { key: 'name', title: '姓名', type: 'text', width: 100 },
          { key: 'dept', title: '部门', type: 'text', width: 100 },
        ],
        views: [],
        summaries: {},
      },
      records: [
        { _id: 'e1', name: '张三', dept: '研发部' },
        { _id: 'e2', name: '张三', dept: '销售部' },
        { _id: 'e3', name: '李四', dept: '交付部' },
      ],
    }

    const prjMeta: SmartTableMeta = {
      id: 'tbl_prj',
      name: '项目',
      kind: 'normal',
      columns: [
        { key: 'owner', title: '负责人', type: 'person', width: 100 },
        {
          key: 'lookup_dept',
          title: '部门',
          type: 'lookup',
          width: 100,
          lookupConfig: {
            groupId: 'grp_emp',
            targetTableId: 'tbl_emp',
            matchRules: [{ sourceField: 'owner', targetField: 'name' }],
            targetReturnField: 'dept',
            mode: 'one',
          },
        },
        { key: 'paid', title: '回款', type: 'number', width: 100, numberFormat: 'currency' },
        { key: 'contract', title: '合同', type: 'number', width: 100, numberFormat: 'currency' },
        {
          key: 'rate',
          title: '达成率',
          type: 'formula',
          width: 100,
          formulaExpr: '[paid] / [contract]',
          numberFormat: 'percent',
        },
      ],
      views: [],
      summaries: {
        paid: 'sum',
        rate: 'avg',
      },
    }

    const rawRecords: SmartRecord[] = [
      { _id: 'r1', owner: '张三', paid: 80, contract: 100 },
      { _id: 'r2', owner: '李四', paid: 50, contract: 100 },
      { _id: 'r3', owner: '李四', paid: 20, contract: 100 },
    ]

    const view: SmartView = {
      id: 'v1',
      name: '仅交付部',
      type: 'table',
      filterGroup: {
        conjunction: 'and',
        conditions: [{ id: 'f1', field: 'lookup_dept', operator: 'eq', value: '交付部' }],
      },
      quickFilterFields: ['lookup_dept'],
      sortRules: [{ field: 'paid', direction: 'desc' }],
    }

    const result = runSmartTablePipeline(
      prjMeta,
      rawRecords,
      new Map([['tbl_emp', empBundle]]),
      view,
    )

    expect(result.allComputedRecords).toHaveLength(3)
    expect(result.unresolvedConflictCount).toBe(1)
    expect(result.displayRecords.map((r) => r._id)).toEqual(['r2', 'r3'])
    expect(result.displayRecords[0]!['rate']).toBe(0.5)
    expect(result.summaries['paid']).toEqual({ type: 'sum', value: 70, text: '¥70' })
    expect(result.summaries['rate']?.text).toBe('35%')
  })
})
