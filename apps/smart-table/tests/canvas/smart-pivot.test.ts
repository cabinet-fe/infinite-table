// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import type { PivotCellDrillEvent } from '@infinitable/pivot'
import type { RenderContext } from '@infinitable/render'
import type { ListTable } from '@infinitable/table'

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
  {
    key: 'rate',
    title: '达成率',
    type: 'formula',
    width: 100,
    numberFormat: 'percent',
    formulaExpr: '[paid]/[amount]',
  },
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

  it('双击数据格透传 onCellDrill，支持展开/收起与水印插件', () => {
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

    expect(adapter.getWatermarkPlugin().getConfig().text).toBe('多维数据台 · DataDesk · 透视分析')
    adapter.setWatermark(true, '透视机密')
    expect(adapter.getWatermarkPlugin().isEnabled()).toBe(true)
    expect(adapter.getWatermarkPlugin().getConfig().text).toBe('透视机密')

    unsub()
    adapter.destroy()
  })

  it('update 在维度与度量配置未变时保留折叠状态，避免冗余重建', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const config: SmartPivotConfig = {
      rowDimensions: ['dept', 'status'],
      columnDimensions: [],
      measures: [{ key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 }],
    }
    const adapter = new SmartPivotAdapter({
      container,
      columns: COLUMNS,
      records: RECORDS,
      config,
    })

    const pivot = adapter.getPivot()
    pivot.collapseAll()
    expect(pivot.getSubtotalRowCount()).toBe(2)

    // 仅刷新记录（配置/列定义结构签名未变），折叠状态应保持
    adapter.update({
      columns: COLUMNS.map((c) => ({ ...c })),
      records: [...RECORDS, { _id: 'r4', dept: '销售部', status: '已交付', amount: 300 }],
      config: {
        rowDimensions: ['dept', 'status'],
        columnDimensions: [],
        measures: [{ key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 }],
      },
    })
    expect(pivot.getSubtotalRowCount()).toBe(2)

    adapter.destroy()
  })

  it('透视表按 SmartColumn.numberFormat 格式化货币与百分比，count 计数列维持整数', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const adapter = new SmartPivotAdapter({
      container,
      columns: COLUMNS,
      records: RECORDS,
      config: {
        rowDimensions: ['dept'],
        columnDimensions: [],
        measures: [
          { key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 },
          { key: 'rate', title: '平均达成率', field: 'rate', agg: 'avg', width: 100 },
          { key: '__count__', title: '项目数', field: '__count__', agg: 'count', width: 90 },
        ],
      },
    })

    const table = adapter.getPivot().getTable() as ListTable
    // 第 1 行（研发部）：amount=3000 -> ¥3,000，avg(rate)=0.8 -> 80%，count=2 -> 2
    expect(table.getCellText(1, 1)).toBe('¥3,000')
    expect(table.getCellText(2, 1)).toBe('80%')
    expect(table.getCellText(3, 1)).toBe('2')

    adapter.destroy()
  })

  it('行头长维度文本裁剪省略不溢出，首行滚出视口上方后仍可点击合并组展开钮折叠', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 480 })
    Object.defineProperty(container, 'clientHeight', { value: 160 })
    document.body.appendChild(container)

    const longGroupRecords: SmartRecord[] = [
      {
        _id: 'g1',
        dept: 'AAA_这是一个非常非常长的部门名称测试截断效果',
        status: '阶段1',
        amount: 100,
      },
      {
        _id: 'g2',
        dept: 'AAA_这是一个非常非常长的部门名称测试截断效果',
        status: '阶段2',
        amount: 200,
      },
      {
        _id: 'g3',
        dept: 'AAA_这是一个非常非常长的部门名称测试截断效果',
        status: '阶段3',
        amount: 300,
      },
      {
        _id: 'g4',
        dept: 'AAA_这是一个非常非常长的部门名称测试截断效果',
        status: '阶段4',
        amount: 400,
      },
      { _id: 'g5', dept: '财务部', status: '阶段1', amount: 500 },
    ]
    const adapter = new SmartPivotAdapter({
      container,
      columns: COLUMNS,
      records: longGroupRecords,
      config: {
        rowDimensions: ['dept', 'status'],
        columnDimensions: [],
        measures: [{ key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 }],
      },
    })

    const pivot = adapter.getPivot()
    const table = pivot.getTable() as ListTable

    // 验证行头超长文本会裁剪出省略号而不是溢出
    const drawnTexts: string[] = []
    const mockCtx: RenderContext = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '12px sans-serif',
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      translate: () => {},
      beginPath: () => {},
      rect: () => {},
      moveTo: () => {},
      lineTo: () => {},
      bezierCurveTo: () => {},
      quadraticCurveTo: () => {},
      arc: () => {},
      closePath: () => {},
      stroke: () => {},
      fill: () => {},
      clip: () => {},
      clearRect: () => {},
      fillRect: () => {},
      fillText: (text: string) => drawnTexts.push(text),
      drawImage: () => {},
      measureText: (text: string) => ({ width: text.length * 10 }),
    }
    const treeRenderer = table.options.resolveCellRenderer?.(0, 1)
    treeRenderer?.({
      ctx: mockCtx,
      col: 0,
      row: 1,
      width: 90,
      height: 128,
      text: '',
      value: '',
      style: {},
    })
    expect(drawnTexts[0]).toMatch(/…$/)

    // 向下滚动 32px：该组首行（row=1）滚出视口上方（getCellRelativeRect(0, 1) 为 null），
    // 该组可见区间 [32, 128] 的粘性居中展开钮位于视口 y = (32 + 128) / 2 = 80 处
    table.scrollBy(0, 32)
    expect(table.getCellRelativeRect(0, 1)).toBeNull()
    expect(pivot.getSubtotalRowCount()).toBe(0)

    // 点击展开钮热区（x=9, y=80）应成功折叠该组
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 9, clientY: 80 }))
    container.dispatchEvent(new MouseEvent('click', { clientX: 9, clientY: 80 }))
    expect(pivot.getSubtotalRowCount()).toBe(1)

    adapter.destroy()
  })

  it('动态切换 showGrandTotal 原地更新总计行，不重建 PivotGrid 与 ListTable 且保留折叠态', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const config: SmartPivotConfig = {
      rowDimensions: ['dept', 'status'],
      columnDimensions: [],
      measures: [{ key: 'amount', title: '合同金额', field: 'amount', agg: 'sum', width: 120 }],
      showGrandTotal: true,
      collapsible: true,
    }
    const adapter = new SmartPivotAdapter({
      container,
      columns: COLUMNS,
      records: RECORDS,
      config,
    })

    const pivot = adapter.getPivot()
    const table = pivot.getTable() as ListTable
    // 研发部2行 + 销售部1行 + 总计1行 = 4
    expect(adapter.getShowGrandTotal()).toBe(true)
    expect(pivot.getVisibleRowCount()).toBe(4)

    // 先折叠 1 个组，再切换总计开关验证折叠态与实例均保留
    pivot.collapseAll()
    expect(pivot.getSubtotalRowCount()).toBe(2) // 研发部、销售部 2 个折叠载体行 + 总计 = 3
    expect(pivot.getVisibleRowCount()).toBe(3)

    // 通过 update 原地关闭总计
    adapter.update({
      columns: COLUMNS,
      records: RECORDS,
      config: { ...config, showGrandTotal: false },
    })

    expect(adapter.getPivot()).toBe(pivot)
    expect(pivot.getTable()).toBe(table)
    expect(adapter.getShowGrandTotal()).toBe(false)
    expect(pivot.getVisibleRowCount()).toBe(2) // 仅剩 2 个折叠载体行
    expect(pivot.getSubtotalRowCount()).toBe(2)

    // 通过 setShowGrandTotal 原地重新开启总计
    adapter.setShowGrandTotal(true)
    expect(adapter.getPivot()).toBe(pivot)
    expect(pivot.getTable()).toBe(table)
    expect(adapter.getShowGrandTotal()).toBe(true)
    expect(pivot.getVisibleRowCount()).toBe(3)
    expect(pivot.getSubtotalRowCount()).toBe(2)
    expect(pivot.getCellValue(2, 3)).toBe(3500) // 总计行：1000 + 2000 + 500 = 3500

    adapter.destroy()
  })

  it('宿主容器定位检查补齐 relative 且销毁时不破坏外部显式样式，初始化与 ResizeObserver 同步宽高', () => {
    const staticContainer = document.createElement('div')
    document.body.appendChild(staticContainer)
    const absContainer = document.createElement('div')
    absContainer.style.position = 'fixed'
    document.body.appendChild(absContainer)

    const roCallbacks: ResizeObserverCallback[] = []
    class MockResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        roCallbacks.push(cb)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    try {
      vi.spyOn(staticContainer, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 620,
        height: 380,
        right: 620,
        bottom: 380,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect)

      const adapter = new SmartPivotAdapter({
        container: staticContainer,
        columns: COLUMNS,
        records: RECORDS,
        config: BASE_CONFIG,
      })

      expect(staticContainer.style.position).toBe('relative')
      const table = adapter.getPivot().getTable() as ListTable
      expect(table.width).toBe(620)
      expect(table.height).toBe(380)

      roCallbacks[0]?.(
        [{ contentRect: { width: 840, height: 520 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      )
      expect(table.width).toBe(840)
      expect(table.height).toBe(520)

      adapter.destroy()
      expect(staticContainer.style.position).toBe('')

      const fixedAdapter = new SmartPivotAdapter({
        container: absContainer,
        columns: COLUMNS,
        records: RECORDS,
        config: BASE_CONFIG,
      })
      expect(absContainer.style.position).toBe('fixed')
      fixedAdapter.destroy()
      expect(absContainer.style.position).toBe('fixed')
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      staticContainer.remove()
      absContainer.remove()
    }
  })

  it('透视指标优先应用 measure.decimalPlaces，未设时回退列 decimalPlaces，count 忽略小数位且动态 update 刷新格式化', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const decimalCols: SmartColumn[] = [
      { key: 'dept', title: '部门', type: 'text', width: 120 },
      { key: 'status', title: '状态', type: 'select', width: 100 },
      {
        key: 'amount',
        title: '合同金额',
        type: 'number',
        width: 120,
        numberFormat: 'currency',
        decimalPlaces: 2,
      },
      {
        key: 'rate',
        title: '达成率',
        type: 'number',
        width: 100,
        numberFormat: 'percent',
        decimalPlaces: 1,
      },
    ]
    const decimalRecs: SmartRecord[] = [
      { _id: '1', dept: '研发部', status: '进行中', amount: 100.1, rate: 0.5 },
      { _id: '2', dept: '研发部', status: '已交付', amount: 200.2, rate: 1 },
    ]
    const adapter = new SmartPivotAdapter({
      container,
      columns: decimalCols,
      records: decimalRecs,
      config: {
        rowDimensions: ['dept'],
        columnDimensions: [],
        measures: [
          // 1) measure 未设 decimalPlaces -> 回退列 decimalPlaces (2)
          { key: 'm_sum', title: '总额', field: 'amount', agg: 'sum', width: 120 },
          // 2) measure 显式覆盖 decimalPlaces (4)
          {
            key: 'm_avg',
            title: '均值',
            field: 'amount',
            agg: 'avg',
            width: 120,
            decimalPlaces: 4,
          },
          // 3) percent 回退列 decimalPlaces (1)
          { key: 'm_rate', title: '平均达成率', field: 'rate', agg: 'avg', width: 100 },
          // 4) count 保持整数
          { key: 'm_cnt', title: '数量', field: '', agg: 'count', width: 80 },
        ],
        showGrandTotal: true,
      },
    })

    const table = adapter.getPivot().getTable() as ListTable
    expect(table.getCellText(1, 1)).toBe('¥300.30')
    expect(table.getCellText(2, 1)).toBe('¥150.1500')
    expect(table.getCellText(3, 1)).toBe('75.0%')
    expect(table.getCellText(4, 1)).toBe('2')

    // 动态切换 measure.decimalPlaces 与列 decimalPlaces 立即刷新
    adapter.update({
      columns: decimalCols.map((col) => (col.key === 'rate' ? { ...col, decimalPlaces: 3 } : col)),
      records: decimalRecs,
      config: {
        rowDimensions: ['dept'],
        columnDimensions: [],
        measures: [
          { key: 'm_sum', title: '总额', field: 'amount', agg: 'sum', width: 120 },
          {
            key: 'm_avg',
            title: '均值',
            field: 'amount',
            agg: 'avg',
            width: 120,
            decimalPlaces: 1,
          },
          { key: 'm_rate', title: '平均达成率', field: 'rate', agg: 'avg', width: 100 },
          { key: 'm_cnt', title: '数量', field: '', agg: 'count', width: 80 },
        ],
        showGrandTotal: true,
      },
    })

    expect(table.getCellText(2, 1)).toBe('¥150.2')
    expect(table.getCellText(3, 1)).toBe('75.000%')

    adapter.destroy()
    container.remove()
  })
})
