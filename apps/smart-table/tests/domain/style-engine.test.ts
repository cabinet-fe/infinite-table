import { describe, expect, it } from 'vitest'
import { runSmartTablePipeline } from '../../src/domain/query-engine'
import {
  createViewStyleResolver,
  resolveCellStyle,
  resolveHeaderStyle,
  resolveRowHeightPx,
  resolveVisibleColumns,
} from '../../src/domain/style-engine'
import type { SmartColumn, SmartRecord, SmartTableMeta, SmartView } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'code', title: '编号', type: 'text', width: 120 },
  { key: 'name', title: '名称', type: 'text', width: 200 },
  { key: 'status', title: '状态', type: 'select', width: 110 },
  { key: 'amount', title: '金额', type: 'number', width: 140, numberFormat: 'currency' },
  { key: 'progress', title: '进度', type: 'progress', width: 120 },
]

const RECORDS: SmartRecord[] = [
  { _id: 'r1', code: 'P-1', name: '正常项目', status: '进行中', amount: 500, progress: 80 },
  { _id: 'r2', code: 'P-2', name: '预警项目', status: '风险预警', amount: 200, progress: 25 },
]

describe('style-engine', () => {
  it('resolveVisibleColumns 支持列顺序、隐藏列、新增列追加与列宽覆盖', () => {
    const visible = resolveVisibleColumns(COLUMNS, {
      columnOrder: ['name', 'amount', 'missing_col'],
      hiddenColumns: ['status'],
      columnWidths: { amount: 180, name: 0 },
    })

    expect(visible.map((c) => c.key)).toEqual(['name', 'amount', 'code', 'progress'])
    expect(visible.find((c) => c.key === 'amount')?.width).toBe(180)
    // 非法宽度 0 忽略，沿用列默认宽度
    expect(visible.find((c) => c.key === 'name')?.width).toBe(200)
  })

  it('resolveRowHeightPx 与 resolveHeaderStyle 返回正确的行高与列头样式', () => {
    expect(resolveRowHeightPx()).toBe(38)
    expect(resolveRowHeightPx('compact')).toBe(32)
    expect(resolveRowHeightPx('standard')).toBe(38)
    expect(resolveRowHeightPx('comfortable')).toBe(52)

    const header = resolveHeaderStyle('amount', {
      amount: {
        align: 'right',
        headerBgColor: '#eff6ff',
        headerTextColor: '#1d4ed8',
        bgColor: '#f8fafc',
      },
    })
    expect(header).toEqual({
      align: 'right',
      bgColor: '#eff6ff',
      textColor: '#1d4ed8',
    })
  })

  it('样式层级合并严格遵循 条件格式 > 单元格自定义 > 列级样式（含 row 与 cell 作用域）', () => {
    const view: Pick<SmartView, 'columnStyles' | 'cellStyles' | 'conditionalFormats'> = {
      columnStyles: {
        amount: {
          align: 'right',
          bgColor: '#f8fafc',
          textColor: '#334155',
        },
        progress: {
          align: 'center',
          bgColor: '#f1f5f9',
        },
      },
      cellStyles: {
        r1: {
          amount: { bgColor: '#fef9c3', textColor: '#854d0e' },
        },
        r2: {
          amount: { bgColor: '#e0f2fe', textColor: '#0369a1', align: 'center' },
          progress: { bgColor: '#e0f2fe' },
        },
      },
      conditionalFormats: [
        {
          id: 'cf_disabled',
          enabled: false,
          field: 'code',
          operator: 'eq',
          value: 'P-1',
          scope: 'row',
          bgColor: '#000000',
        },
        {
          id: 'cf_risk_row',
          field: 'status',
          operator: 'eq',
          value: '风险预警',
          scope: 'row',
          bgColor: '#fef2f2',
          textColor: '#991b1b',
        },
        {
          id: 'cf_low_progress',
          field: 'progress',
          operator: 'lt',
          value: 40,
          scope: 'cell',
          bgColor: '#fff7ed',
          textColor: '#c2410c',
        },
      ],
    }

    // r1.amount：未命中条件格式，单元格自定义覆盖列级样式，但继承列级 align
    expect(resolveCellStyle(RECORDS[0]!, 'amount', COLUMNS, view)).toEqual({
      bgColor: '#fef9c3',
      textColor: '#854d0e',
      align: 'right',
      matchedRuleIds: [],
    })

    // r1.progress：仅列级样式生效
    expect(resolveCellStyle(RECORDS[0]!, 'progress', COLUMNS, view)).toEqual({
      bgColor: '#f1f5f9',
      textColor: undefined,
      align: 'center',
      matchedRuleIds: [],
    })

    // r2.amount：命中整行条件格式 cf_risk_row，覆盖单元格自定义颜色，但保留单元格自定义 align
    expect(resolveCellStyle(RECORDS[1]!, 'amount', COLUMNS, view)).toEqual({
      bgColor: '#fef2f2',
      textColor: '#991b1b',
      align: 'center',
      matchedRuleIds: ['cf_risk_row'],
    })

    // r2.progress：同时命中 row 规则与后续 cell 规则，cell 规则覆盖整行底色/字色
    const resolver = createViewStyleResolver(COLUMNS, view)
    expect(resolver.resolveCell(RECORDS[1]!, 'progress')).toEqual({
      bgColor: '#fff7ed',
      textColor: '#c2410c',
      align: 'center',
      matchedRuleIds: ['cf_risk_row', 'cf_low_progress'],
    })
  })

  it('runSmartTablePipeline 优先消费视图级 summaries 覆盖', () => {
    const meta: SmartTableMeta = {
      id: 't1',
      name: '表',
      kind: 'normal',
      columns: COLUMNS,
      views: [],
      summaries: { amount: 'sum' },
    }
    const view: SmartView = {
      id: 'v1',
      name: '视图1',
      type: 'table',
      filterGroup: { conjunction: 'and', conditions: [] },
      quickFilterFields: [],
      sortRules: [],
      summaries: { amount: 'avg', code: 'count' },
    }
    const res = runSmartTablePipeline(meta, RECORDS, new Map(), view)
    expect(res.summaries.amount).toEqual({ type: 'avg', value: 350, text: '¥350' })
    expect(res.summaries.code).toEqual({ type: 'count', value: 2, text: '2' })
  })
})
