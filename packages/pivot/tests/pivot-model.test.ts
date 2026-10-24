// PivotModel 状态机：行维度多列树（同组跨行合并 + 折叠载体行）× 列维度多级表头
// × 度量聚合 + 动态勾选/聚合切换重算。fixture 六条记录全部可手算，聚合断言用
// 独立推导的期望值（不复制实现）。getCellValue/rows 均为引擎坐标：前 headerRowCount
// 行为表头伪行。

import { describe, expect, it } from 'vitest'

import { PivotModel } from '../src/pivot-model'
import type { PivotDimension, PivotMeasure, PivotRecord } from '../src/types'

const DIMENSIONS: PivotDimension[] = [
  { key: 'region', title: '区域', width: 110 },
  { key: 'product', title: '产品', width: 90 },
  { key: 'channel', title: '渠道', width: 100 },
]

const MEASURES: PivotMeasure[] = [
  { key: 'qty-sum', title: '数量和', field: 'qty', agg: 'sum', width: 110 },
  { key: 'amount-sum', title: '金额和', field: 'amount', agg: 'sum', width: 130 },
  { key: 'rating-avg', title: '评分均', field: 'rating', agg: 'avg', width: 110 },
  { key: 'record-count', title: '记录数', field: '', agg: 'count', width: 100 },
]

/** 六条记录：东/西 × A/B × 线上/线下，覆盖空交叉（东·B·线下） */
const RECORDS: PivotRecord[] = [
  { region: '东', product: 'A', channel: '线上', qty: 1, amount: 100, rating: 0.5 },
  { region: '东', product: 'A', channel: '线下', qty: 2, amount: 200, rating: 1.0 },
  { region: '东', product: 'B', channel: '线上', qty: 3, amount: 300, rating: 0.5 },
  { region: '西', product: 'A', channel: '线上', qty: 4, amount: 400, rating: 2.0 },
  { region: '西', product: 'B', channel: '线下', qty: 5, amount: 500, rating: 1.0 },
  { region: '西', product: 'B', channel: '线上', qty: 6, amount: 600, rating: 1.5 },
]

/** 默认形态：行维度 [区域, 产品] 全展开、列维度 [渠道]、度量全开（含总计） */
function model(): PivotModel {
  return new PivotModel({
    dimensions: DIMENSIONS,
    measures: MEASURES,
    records: RECORDS,
    rowDimensions: ['region', 'product'],
    columnDimensions: ['channel'],
  })
}

describe('多列树形行结构', () => {
  it('全展开只有 leaf + 总计（展开组无自有行），码点序排列', () => {
    const pivot = model()
    expect(pivot.rowCount).toBe(7) // 表头 2 行 + 4 leaf + 1 总计
    expect(pivot.rows.map((row) => [row.type, row.path.join('/'), row.depth])).toEqual([
      ['leaf', '东/A', 1],
      ['leaf', '东/B', 1],
      ['leaf', '西/A', 1],
      ['leaf', '西/B', 1],
      ['grand', '', -1],
    ])
    expect(pivot.branchRowCount).toBe(0)
  })

  it('单行维度：全为 leaf（depth 0），保留总计，角落区纵向合并', () => {
    const pivot = model()
    pivot.setRowDimensions(['region'])
    expect(pivot.rowCount).toBe(5) // 表头 2 行 + 2 leaf + 1 总计
    expect(pivot.rows.map((row) => row.type)).toEqual(['leaf', 'leaf', 'grand'])
    expect(pivot.mergeRanges).toEqual([
      { startCol: 0, endCol: 0, startRow: 0, endRow: 1 }, // 区域标题竖条（单列 × 2 表头行）
      { startCol: 1, endCol: 4, startRow: 0, endRow: 0 }, // 线上（数据列自 col1 起）
      { startCol: 5, endCol: 8, startRow: 0, endRow: 0 }, // 线下
    ])
  })

  it('关闭总计行：只剩树节点行', () => {
    const pivot = new PivotModel({
      dimensions: DIMENSIONS,
      measures: MEASURES,
      records: RECORDS,
      rowDimensions: ['region', 'product'],
      columnDimensions: ['channel'],
      showGrandTotal: false,
    })
    expect(pivot.rows.at(-1)?.type).toBe('leaf')
  })
})

describe('合并区（多列树 + 多级表头）', () => {
  it('标题竖条 / 表头层横并 / 行组跨行 / 总计横并', () => {
    const pivot = model()
    // 列结构：col0 区域、col1 产品；线上 4 度量（col2-5）、线下 4 度量（col6-9）
    expect(pivot.mergeRanges).toEqual([
      { startCol: 0, endCol: 0, startRow: 0, endRow: 1 }, // 区域标题竖条
      { startCol: 1, endCol: 1, startRow: 0, endRow: 1 }, // 产品标题竖条
      { startCol: 2, endCol: 5, startRow: 0, endRow: 0 }, // 线上
      { startCol: 6, endCol: 9, startRow: 0, endRow: 0 }, // 线下
      { startCol: 0, endCol: 0, startRow: 2, endRow: 3 }, // 东 跨两 leaf
      { startCol: 0, endCol: 0, startRow: 4, endRow: 5 }, // 西 跨两 leaf
      { startCol: 0, endCol: 1, startRow: 6, endRow: 6 }, // 总计行头横并
    ])
  })

  it('折叠后：组收敛为载体行（行头横并），祖先组跨行合并缩短', () => {
    const pivot = model()
    pivot.toggleNode(['东'])
    expect(pivot.rows.map((row) => `${row.type}:${row.path.join('/')}`)).toEqual([
      'branch:东',
      'leaf:西/A',
      'leaf:西/B',
      'grand:',
    ])
    expect(pivot.mergeRanges).toEqual([
      { startCol: 0, endCol: 0, startRow: 0, endRow: 1 }, // 区域标题竖条
      { startCol: 1, endCol: 1, startRow: 0, endRow: 1 }, // 产品标题竖条
      { startCol: 2, endCol: 5, startRow: 0, endRow: 0 }, // 线上
      { startCol: 6, endCol: 9, startRow: 0, endRow: 0 }, // 线下
      { startCol: 0, endCol: 0, startRow: 3, endRow: 4 }, // 西（东收敛后缩短）
      { startCol: 0, endCol: 1, startRow: 2, endRow: 2 }, // 东 载体行头横并
      { startCol: 0, endCol: 1, startRow: 5, endRow: 5 }, // 总计
    ])
  })

  it('多级列维度：逐层表头行 + 同层前缀横并 + 度量行', () => {
    const pivot = model()
    pivot.setColumnDimensions(['region', 'channel'])
    // 表头 3 行（区域/渠道/度量）；列路径 东/线上、东/线下、西/线上、西/线下 × 4 度量
    expect(pivot.headerRowCount).toBe(3)
    expect(pivot.dataColumnCount).toBe(16)
    expect(pivot.getCellValue(0, 0)).toBe('区域') // 标题竖条按维度分列
    expect(pivot.getCellValue(1, 0)).toBe('产品')
    expect(pivot.getCellValue(0, 1)).toBe('') // 竖条被覆盖格出空
    expect(pivot.getCellValue(2, 0)).toBe('东') // 第一层
    expect(pivot.getCellValue(2, 1)).toBe('线上') // 第二层
    expect(pivot.getCellValue(2, 2)).toBe('数量和') // 度量行
    expect(pivot.mergeRanges).toContainEqual({ startCol: 0, endCol: 0, startRow: 0, endRow: 2 })
    expect(pivot.mergeRanges).toContainEqual({ startCol: 2, endCol: 9, startRow: 0, endRow: 0 })
    expect(pivot.mergeRanges).toContainEqual({ startCol: 2, endCol: 5, startRow: 1, endRow: 1 })
  })

  it('groupRange：组的可见行块（引擎坐标，选区几何）', () => {
    const pivot = model()
    expect(pivot.groupRange(['东'])).toEqual({ startRow: 2, endRow: 3 }) // 东 跨两 leaf
    expect(pivot.groupRange(['东', 'A'])).toEqual({ startRow: 2, endRow: 2 }) // leaf 单行
    expect(pivot.groupRange(['西', 'B'])).toEqual({ startRow: 5, endRow: 5 })
    expect(pivot.groupRange(['不存在'])).toBeNull()
    pivot.toggleNode(['东'])
    expect(pivot.groupRange(['东'])).toEqual({ startRow: 2, endRow: 2 }) // 折叠后收敛为载体行
    expect(pivot.groupRange(['东', 'A'])).toBeNull() // 隐藏子组无可见行
  })

  it('headerColumnRange：表头格的列组区间（列头点击高亮几何）', () => {
    const pivot = model()
    // 默认 [渠道] 列维度：表头 2 行（渠道层 row0 + 度量行 row1）
    expect(pivot.headerColumnRange(2, 0)).toEqual({ startCol: 2, endCol: 5 }) // 线上 4 度量
    expect(pivot.headerColumnRange(9, 0)).toEqual({ startCol: 6, endCol: 9 }) // 线下（组内任意格取所在组）
    expect(pivot.headerColumnRange(3, 1)).toEqual({ startCol: 3, endCol: 3 }) // 度量行单列
    expect(pivot.headerColumnRange(0, 0)).toBeNull() // 行维度标题竖条
    expect(pivot.headerColumnRange(2, 5)).toBeNull() // 非表头行
    // 多级列维度：顶层「东」跨 8 列，第二层按前缀收敛
    pivot.setColumnDimensions(['region', 'channel'])
    expect(pivot.headerColumnRange(2, 0)).toEqual({ startCol: 2, endCol: 9 })
    expect(pivot.headerColumnRange(4, 1)).toEqual({ startCol: 2, endCol: 5 })
    expect(pivot.headerColumnRange(7, 2)).toEqual({ startCol: 7, endCol: 7 })
  })
})

describe('展开/折叠', () => {
  it('toggleNode 折叠组：收敛为载体行且聚合值可见，再切还原', () => {
    const pivot = model()
    expect(pivot.toggleNode(['东'])).toBe(true)
    // 东 载体 × 线上：数量和 1+3=4、记录数 2；× 线下 数量和 2
    expect(pivot.getCellValue(2, 2)).toBe(4)
    expect(pivot.getCellValue(5, 2)).toBe(2)
    expect(pivot.getCellValue(6, 2)).toBe(2)
    expect(pivot.toggleNode(['东'])).toBe(true)
    expect(pivot.rowCount).toBe(7)
  })

  it('toggleNode 只对可见组生效：折叠后再 toggle 隐藏子节点返回 false', () => {
    const pivot = model()
    pivot.toggleNode(['东'])
    expect(pivot.toggleNode(['东', 'A'])).toBe(false)
    expect(pivot.toggleNode(['不存在的组'])).toBe(false)
  })

  it('collapseAll 整树收拢到一级（含嵌套组），expandAll 复原；无变化返回 false', () => {
    const pivot = model()
    expect(pivot.collapseAll()).toBe(true)
    expect(pivot.rows.map((row) => row.type)).toEqual(['branch', 'branch', 'grand'])
    expect(pivot.expandAll()).toBe(true)
    expect(pivot.rowCount).toBe(7)
    expect(pivot.expandAll()).toBe(false)
    const collapsed = model()
    collapsed.collapseAll()
    expect(collapsed.collapseAll()).toBe(false)
  })

  it('结构变更清空折叠态，setRecords 保留', () => {
    const pivot = model()
    pivot.toggleNode(['东'])
    pivot.setMeasures(['record-count'])
    expect(pivot.rows.map((row) => row.type)).toEqual(['leaf', 'leaf', 'leaf', 'leaf', 'grand'])
    pivot.toggleNode(['东'])
    pivot.setRecords(RECORDS)
    expect(pivot.rows[0]?.type).toBe('branch') // 数据刷新非结构变更：折叠态保留
  })
})

describe('collapsible 配置（不可折叠时始终平铺）', () => {
  it('collapsible false：折叠操作恒拒绝、无载体行；恢复可折叠后从平铺起步', () => {
    const pivot = new PivotModel({
      dimensions: DIMENSIONS,
      measures: MEASURES,
      records: RECORDS,
      rowDimensions: ['region', 'product'],
      columnDimensions: ['channel'],
      collapsible: false,
    })
    expect(pivot.collapsible).toBe(false)
    expect(pivot.toggleNode(['东'])).toBe(false)
    expect(pivot.collapseAll()).toBe(false)
    expect(pivot.branchRowCount).toBe(0)
    expect(pivot.rows.map((row) => row.type)).toEqual(['leaf', 'leaf', 'leaf', 'leaf', 'grand'])
    expect(pivot.setCollapsible(true)).toBe(true)
    expect(pivot.toggleNode(['东'])).toBe(true) // 恢复后折叠能力可用
    expect(pivot.rows[0]?.type).toBe('branch')
    expect(pivot.setCollapsible(false)).toBe(true)
    expect(pivot.rows[0]?.type).toBe('leaf') // 关闭时既有折叠态清空、整树平铺
    expect(pivot.setCollapsible(false)).toBe(false) // 无变化拒绝
  })
})

describe('列结构', () => {
  it('行头列 = 行维度数，数据列 = 列维度值 × 度量；表头文本分层', () => {
    const pivot = model()
    expect(pivot.rowHeaderCount).toBe(2)
    expect(pivot.headerRowCount).toBe(2)
    expect(pivot.dataColumnCount).toBe(8) // 渠道 2 值 × 4 度量
    expect(pivot.getColumnWidth(0)).toBe(110)
    expect(pivot.getColumnWidth(1)).toBe(90)
    expect(pivot.getCellValue(0, 0)).toBe('区域') // 标题竖条主格，被覆盖格出空
    expect(pivot.getCellValue(1, 0)).toBe('产品')
    expect(pivot.getCellValue(0, 1)).toBe('')
    expect(pivot.getCellValue(2, 0)).toBe('线上') // 列维度层
    expect(pivot.getCellValue(2, 1)).toBe('数量和') // 度量行
  })

  it('取消列维度：仅度量行表头，度量直排', () => {
    const pivot = model()
    pivot.setColumnDimensions([])
    expect(pivot.headerRowCount).toBe(1)
    expect(pivot.dataColumnCount).toBe(4)
    expect(pivot.getCellValue(2, 0)).toBe('数量和')
  })
})

describe('交叉聚合', () => {
  it('leaf 交叉格：按全路径 × 列维度值过滤聚合', () => {
    const pivot = model()
    expect(pivot.getCellValue(0, 2)).toBe('东') // 行头区域列
    expect(pivot.getCellValue(1, 2)).toBe('A') // 行头产品列
    expect(pivot.getCellValue(2, 2)).toBe(1) // 东·A·线上 数量和
    expect(pivot.getCellValue(3, 2)).toBe(100) // 东·A·线上 金额和
    expect(pivot.getCellValue(5, 2)).toBe(1) // 东·A·线上 记录数
    expect(pivot.getCellValue(6, 3)).toBe(0) // 东·B·线下 数量和（空交叉）
    expect(pivot.getCellValue(9, 3)).toBe(0) // 东·B·线下 记录数（空交叉）
    expect(pivot.getCellValue(8, 3)).toBeUndefined() // 空 avg 无值
  })

  it('折叠载体交叉格 = 前缀路径全体聚合（小计载体），列维度仍生效', () => {
    const pivot = model()
    pivot.toggleNode(['西'])
    // 行序：东/A、东/B leaf（eng2-3）→ 西 载体（eng4）→ 总计（eng5）
    // 西 载体：线上 {西A线上, 西B线上} 数量和 4+6=10、金额和 1000、记录数 2
    expect(pivot.getCellValue(2, 4)).toBe(10)
    expect(pivot.getCellValue(3, 4)).toBe(1000)
    expect(pivot.getCellValue(5, 4)).toBe(2)
    expect(pivot.getCellValue(6, 4)).toBe(5) // 线下 数量和
  })

  it('总计行 = 全体记录，评分均按列维度分列', () => {
    const pivot = model()
    // 总计（engine row 6）：线上数量和 14、金额和 1400、记录数 4、评分均 1.125
    expect(pivot.getCellValue(2, 6)).toBe(14)
    expect(pivot.getCellValue(3, 6)).toBe(1400)
    expect(pivot.getCellValue(5, 6)).toBe(4)
    expect(pivot.getCellValue(4, 6)).toBeCloseTo(1.125)
    expect(pivot.getCellValue(0, 6)).toBe('总计')
  })

  it('avg/min/max：评分均与空集口径', () => {
    const pivot = model()
    expect(pivot.getCellValue(8, 2)).toBeCloseTo(1.0) // 东·A·线下 评分均
    expect(pivot.getCellValue(4, 4)).toBe(2.0) // 西·A·线上 评分均（单条）
  })

  it('多级列维度交叉格：按列路径逐层过滤', () => {
    const pivot = model()
    pivot.setColumnDimensions(['region', 'channel'])
    // 表头 3 行 → 数据行 eng3 起。列序：东/线上 4 度量（col2-5）、东/线下（col6-9）、
    // 西/线上（col10-13）、西/线下（col14-17）
    // leaf 东/A（eng3）× 东/线上 数量和 = 1；× 西/线上 数量和 = 0（空交叉）
    expect(pivot.getCellValue(2, 3)).toBe(1)
    expect(pivot.getCellValue(10, 3)).toBe(0)
    // 总计行（eng7）× 西/线下 记录数 = 1
    expect(pivot.getCellValue(17, 7)).toBe(1)
  })
})

describe('交叉格明细（下钻数据源）', () => {
  it('leaf 格取全路径匹配记录，载体格取前缀路径全体，表头行出空', () => {
    const pivot = model()
    const leafRecords = pivot.getCellRecords(2, 2) // 东·A·线上
    expect(leafRecords).toHaveLength(1)
    expect(leafRecords[0]).toMatchObject({ region: '东', product: 'A', channel: '线上' })
    expect(pivot.getCellRecords(0, 2)).toHaveLength(2) // 东/A 行头格 = 线上+线下
    expect(pivot.getCellRecords(2, 6)).toHaveLength(4) // 总计 × 线上
    expect(pivot.getCellRecords(2, 1)).toHaveLength(0) // 表头行无明细
    expect(pivot.getCellRecords(2, 99)).toHaveLength(0) // 越界出空
  })
})

describe('动态勾选与聚合切换', () => {
  it('行维度序列按调用方顺序生效（不回池序），空序列拒绝', () => {
    const pivot = model()
    expect(pivot.setRowDimensions(['channel', 'product'])).toBe(true)
    expect(pivot.activeRowDimensions.map((dimension) => dimension.key)).toEqual([
      'channel',
      'product',
    ])
    expect(pivot.getCellValue(0, 0)).toBe('渠道') // 标题竖条跟随行维度序列
    expect(pivot.getCellValue(1, 0)).toBe('产品')
    expect(pivot.setRowDimensions(['unknown', 'product'])).toBe(true) // 非法 key 剔除，保持相对序
    expect(pivot.activeRowDimensions.map((dimension) => dimension.key)).toEqual(['product'])
    expect(pivot.setRowDimensions([])).toBe(false) // 至少一个，拒绝
  })

  it('切列维度序列：交叉矩阵按新列路径重排', () => {
    const pivot = model()
    expect(pivot.setColumnDimensions(['product'])).toBe(true)
    // 列 = 产品 2 值 × 4 度量；表头 2 行；行头 2 + 8 = 10 列不变量
    expect(pivot.dataColumnCount).toBe(8)
    expect(pivot.getCellValue(2, 0)).toBe('A')
    // leaf 东/A × A 产品 数量和 = {东A线上,东A线下} 1+2=3
    expect(pivot.getCellValue(2, 2)).toBe(3)
  })

  it('度量序列按调用方顺序生效，至少一个', () => {
    const pivot = model()
    expect(pivot.setMeasures(['record-count', 'qty-sum'])).toBe(true)
    expect(pivot.activeMeasures.map((measure) => measure.key)).toEqual(['record-count', 'qty-sum'])
    expect(pivot.getCellValue(2, 0)).toBe('线上')
    expect(pivot.getCellValue(2, 1)).toBe('记录数')
    expect(pivot.getCellValue(3, 1)).toBe('数量和')
    expect(pivot.setMeasures([])).toBe(false)
  })

  it('updateMeasure 换聚合方式与标题：重算交叉格，不改勾选序列', () => {
    const pivot = model()
    expect(pivot.updateMeasure('qty-sum', { agg: 'count' })).toBe(true)
    // 西·B·线上 数量列由 sum 6 → count 1；leaf 西/B 在 engine row 5
    expect(pivot.getCellValue(2, 5)).toBe(1)
    expect(pivot.updateMeasure('qty-sum', { title: '数量计数' })).toBe(true)
    expect(pivot.getCellValue(2, 1)).toBe('数量计数')
    expect(pivot.updateMeasure('qty-sum', { agg: 'sum' })).toBe(true)
    expect(pivot.getCellValue(2, 5)).toBe(6)
    expect(pivot.updateMeasure('qty-sum', { agg: 'sum' })).toBe(false) // 无变化拒绝
    expect(pivot.updateMeasure('missing', { agg: 'sum' })).toBe(false)
  })

  it('空维度值记录归 (空) 组', () => {
    const pivot = new PivotModel({
      dimensions: DIMENSIONS,
      measures: MEASURES,
      records: [
        ...RECORDS,
        { region: '东', product: 'A', channel: '', qty: 10, amount: 50, rating: 0.5 },
      ],
      rowDimensions: ['region', 'product'],
      columnDimensions: ['channel'],
    })
    expect(pivot.dataColumnCount).toBe(12) // 渠道 3 值（含 (空)）× 4 度量
    expect(pivot.getCellValue(2, 0)).toBe('(空)') // (空) 码点序最前
    // 东·A·(空) 数量和 = 10
    expect(pivot.getCellValue(2, 2)).toBe(10)
  })
})
