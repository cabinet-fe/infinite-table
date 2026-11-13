// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import type { PivotCellDrillEvent } from '@infinitable/pivot'

import { SmartPivotAdapter, columnsToPivotFields } from '../../src/canvas/smart-pivot'
import type { SmartColumn, SmartPivotConfig, SmartRecord } from '../../src/shared/schema'

const COLUMNS: SmartColumn[] = [
  { key: 'dept', title: '部门', type: 'lookup', width: 120 },
  { key: 'status', title: '状态', type: 'select', width: 100 },
  { key: 'amount', title: '合同金额', type: 'number', width: 120, numberFormat: 'currency' },
  { key: 'progress', title: '进度', type: 'progress', width: 100 },
  {
    key: 'paid',
    title: '累计回款',
    type: 'lookup',
    width: 120,
    lookupConfig: {
      groupId: 'pay_rollup',
      targetTableId: 'payments',
      matchRules: [{ sourceField: 'code', targetField: 'code' }],
      targetReturnField: 'amount',
      mode: 'rollup',
      rollupAgg: 'sum',
    },
  },
  { key: 'rate', title: '达成率', type: 'formula', width: 100, formulaExpr: '[paid]/[amount]' },
  { key: 'img', title: '缩略图', type: 'image', width: 100 },
  { key: 'link', title: '文档链接', type: 'link', width: 120 },
]

const RECORDS: SmartRecord[] = [
  { _id: 'r1', dept: '研发部', status: '进行中', amount: 1000, progress: 60, paid: 600, rate: 0.6 },
  { _id: 'r2', dept: '研发部', status: '已交付', amount: 2000, progress: 100, paid: 2000, rate: 1 },
  { _id: 'r3', dept: '销售部', status: '进行中', amount: 500, progress: 40, paid: 200, rate: 0.4 },
]

const BASE_CONFIG: SmartPivotConfig = {
  rowDimensions: ['dept'],
  columnDimensions: ['status'],
  measures: [
    { key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 },
    { key: '__count__', title: '项目数', field: '__count__', agg: 'count', width: 90 },
  ],
  showGrandTotal: true,
  collapsible: true,
}

describe('SmartPivotAdapter', () => {
  it('columnsToPivotFields 正确排除 image/link 并生成数值度量与通用计数度量', () => {
    const { dimensions, measures } = columnsToPivotFields(COLUMNS)

    expect(dimensions.map((d) => d.key)).toEqual([
      'dept',
      'status',
      'amount',
      'progress',
      'paid',
      'rate',
    ])
    expect(measures.map((m) => m.key)).toEqual(['amount', 'progress', 'paid', 'rate', '__count__'])
    expect(measures.find((m) => m.key === '__count__')?.agg).toBe('count')
  })

  it('构造并挂载 PivotGrid，支持过滤后 update 原地刷新行数与聚合值', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const adapter = new SmartPivotAdapter({
      container,
      columns: COLUMNS,
      records: RECORDS,
      config: BASE_CONFIG,
    })

    const pivot = adapter.getPivot()
    expect(container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2)
    // 行维度 dept 有「研发部」「销售部」2 行 + 总计 1 行 = 3 可见数据行
    expect(pivot.getVisibleRowCount()).toBe(3)
    expect(pivot.getRecordCount()).toBe(3)

    // 原地过滤为仅「研发部」
    adapter.update({
      columns: COLUMNS,
      records: RECORDS.filter((r) => r.dept === '研发部'),
      config: BASE_CONFIG,
    })

    expect(adapter.getPivot()).toBe(pivot)
    expect(pivot.getVisibleRowCount()).toBe(2) // 研发部 + 总计
    expect(pivot.getRecordCount()).toBe(2)

    // 切换配置到仅按 status 分行、无列维度、按 paid 求和
    adapter.update({
      columns: COLUMNS,
      records: RECORDS,
      config: {
        rowDimensions: ['status'],
        columnDimensions: [],
        measures: [{ key: 'paid', title: '累计回款', field: 'paid', agg: 'sum', width: 120 }],
      },
    })
    expect(pivot.getRowDimensionKeys()).toEqual(['status'])
    expect(pivot.getColumnDimensionKeys()).toEqual([])
    expect(pivot.getMeasureKeys()).toEqual(['paid'])
    // 表头 1 行 + 已交付 + 进行中 + 总计 = 4 行；第 0 列为 status，第 1 列为 paid
    expect(pivot.getCellValue(0, 1)).toBe('已交付')
    expect(pivot.getCellValue(1, 1)).toBe(2000)
    expect(pivot.getCellValue(0, 2)).toBe('进行中')
    expect(pivot.getCellValue(1, 2)).toBe(800)

    adapter.destroy()
    expect(container.querySelectorAll('canvas').length).toBe(0)
  })

  it('双击数据格透传 onCellDrill，支持展开/收起、水印与打印插件', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const onDrill = vi.fn<(event: PivotCellDrillEvent) => void>()
    const adapter = new SmartPivotAdapter({
      container,
      columns: COLUMNS,
      records: RECORDS,
      config: {
        rowDimensions: ['dept', 'status'],
        columnDimensions: [],
        measures: [{ key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 }],
      },
    })
    const unsub = adapter.onCellDrill(onDrill)

    const pivot = adapter.getPivot()
    const table = pivot.getTable()
    // 表头 1 行（y=0..32），第一条数据行（研发部 × 已交付）数据格在 col=2, row=1
    const rect = table.getCellRelativeRect(2, 1)!
    expect(rect).not.toBeNull()

    container.dispatchEvent(
      new MouseEvent('dblclick', {
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
      }),
    )

    expect(onDrill).toHaveBeenCalledTimes(1)
    expect(onDrill.mock.calls[0]?.[0].records).toHaveLength(1)
    expect(onDrill.mock.calls[0]?.[0].records[0]?._id).toBe('r2')

    adapter.collapseAll()
    expect(pivot.getSubtotalRowCount()).toBe(2)
    adapter.expandAll()
    expect(pivot.getSubtotalRowCount()).toBe(0)

    adapter.setWatermark(true, '透视机密')
    expect(adapter.getWatermarkPlugin().isEnabled()).toBe(true)
    expect(adapter.getWatermarkPlugin().getConfig().text).toBe('透视机密')
    expect(adapter.getPrintPlugin().paginate().length).toBeGreaterThanOrEqual(1)

    unsub()
    adapter.destroy()
  })
})
