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

  it('runSmartTablePipeline 支持 SmartApp 派生上下文（VLOOKUP → 公式列 → 过滤 → 排序 → 汇总）与数据源纯原始模式', () => {
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
        { key: 'paid', title: '回款', type: 'number', width: 100, numberFormat: 'currency' },
        { key: 'contract', title: '合同', type: 'number', width: 100, numberFormat: 'currency' },
      ],
      views: [],
      summaries: {
        paid: 'sum',
        rate: 'avg',
      },
    }

    const derivedColumns: SmartColumn[] = [
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
      {
        key: 'rate',
        title: '达成率',
        type: 'formula',
        width: 100,
        formulaExpr: '[paid] / [contract]',
        numberFormat: 'percent',
      },
    ]

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

    // 1. SmartApp 派生上下文模式（支持 lookupOverrides 消歧锁定）
    const tablesById = new Map([['tbl_emp', empBundle]])
    const result = runSmartTablePipeline(prjMeta, rawRecords, tablesById, view, {
      derivedColumns,
      lookupOverrides: { r1: { grp_emp: 'e2' } },
    })

    expect(result.allComputedRecords).toHaveLength(3)
    expect(result.allComputedRecords[0]!['lookup_dept']).toBe('销售部')
    expect(result.unresolvedConflictCount).toBe(0)
    expect(result.displayRecords.map((r) => r._id)).toEqual(['r2', 'r3'])
    expect(result.displayRecords[0]!['rate']).toBe(0.5)
    expect(result.summaries['paid']).toEqual({ type: 'sum', value: 70, text: '¥70' })
    expect(result.summaries['rate']?.text).toBe('35%')

    // 2. 数据源中心模式（未传 appContext）：即使 meta.columns 残留派生列，也不执行 VLOOKUP 与公式
    const dirtyMeta: SmartTableMeta = {
      ...prjMeta,
      columns: [...prjMeta.columns, ...derivedColumns],
      summaries: { paid: 'sum' },
    }
    const rawResult = runSmartTablePipeline(dirtyMeta, rawRecords, tablesById)
    expect(rawResult.allComputedRecords[0]!['lookup_dept']).toBeUndefined()
    expect(rawResult.allComputedRecords[0]!['rate']).toBeUndefined()
    expect(rawResult.unresolvedConflictCount).toBe(0)
    expect(rawResult.conflictsByRow.size).toBe(0)
    expect(rawResult.summaries['paid']).toEqual({ type: 'sum', value: 150, text: '¥150' })
  })

  it('修复数值/日期比较非数字文本、链接对象/空白筛选、checkbox 视同 false 与全空 sum/格式对齐', () => {
    const cols: SmartColumn[] = [
      { key: 'amount', title: '金额', type: 'number', width: 100, numberFormat: 'currency' },
      { key: 'score', title: '小数', type: 'number', width: 100, numberFormat: 'decimal' },
      { key: 'date', title: '日期', type: 'date', width: 110 },
      { key: 'verified', title: '核验', type: 'checkbox', width: 80 },
      { key: 'site', title: '链接', type: 'link', width: 140 },
    ]
    const recs: SmartRecord[] = [
      {
        _id: '1',
        amount: 200,
        score: null,
        date: '2025-03-01',
        verified: null,
        site: { url: 'https://a.com', text: ' 官网A ' },
      },
      {
        _id: '2',
        amount: 'abc',
        score: null,
        date: 'invalid-date',
        verified: 1,
        site: { url: '', text: '' },
      },
      {
        _id: '3',
        amount: 50,
        score: null,
        date: '2025-01-15',
        verified: 'true',
        site: { url: 'https://b.com', text: '' },
      },
    ]

    // 数值列与日期列遇到非数字/非法日期时，gt/gte/lt/lte 返回 false（绝不回退字符串比较）
    const gtNonNum = filterRecords(recs, cols, {
      conjunction: 'and',
      conditions: [{ id: 'c1', field: 'amount', operator: 'gt', value: 'not_a_number' }],
    })
    expect(gtNonNum).toEqual([])

    const ltBadDate = filterRecords(recs, cols, {
      conjunction: 'and',
      conditions: [{ id: 'c1', field: 'date', operator: 'lt', value: '2025-04-01' }],
    })
    // invalid-date 不参与大小比较，仅 2025-03-01 和 2025-01-15 命中
    expect(ltBadDate.map((r) => r._id)).toEqual(['1', '3'])

    // checkbox null 视同 false
    const unverified = filterRecords(recs, cols, {
      conjunction: 'and',
      conditions: [{ id: 'c1', field: 'verified', operator: 'eq', value: false }],
    })
    expect(unverified.map((r) => r._id)).toEqual(['1'])

    // 快捷筛选对 link 对象支持 { url, text } trim 后匹配及空链接匹配 '(空)'
    const emptyGroup: FilterGroup = { conjunction: 'and', conditions: [] }
    expect(
      filterRecords(recs, cols, emptyGroup, { site: ['官网A', 'https://b.com'] }).map((r) => r._id),
    ).toEqual(['1', '3'])
    expect(filterRecords(recs, cols, emptyGroup, { site: ['(空)'] }).map((r) => r._id)).toEqual([
      '2',
    ])

    // checkbox filled_rate 识别 true / 'true' / 1，全空列 sum 返回 null 显示 '-'
    const sums = computeSummaries(recs, cols, {
      verified: 'filled_rate',
      score: 'sum',
    })
    expect(sums['verified']?.value).toBeCloseTo(2 / 3)
    expect(sums['score']).toEqual({ type: 'sum', value: null, text: '-' })

    // formatSummaryValue 小数位与千分位对齐画布
    expect(formatSummaryValue(12.3, 'avg', 'decimal')).toBe('12.30')
    expect(formatSummaryValue(1234.5, 'sum', 'currency')).toBe('¥1,234.50')
    expect(formatSummaryValue(-1234, 'sum', 'currency')).toBe('-¥1,234')
  })
})
