// P6 数据态渲染管线测试：明细波段按绑定数组循环展开（展开行数与数组长度一致）、
// 嵌套二级数组路径逐行取数、聚合、未绑定格回落模板值、绑定 sidecar 不进数据态、
// 以及配置态画布（FormDoc 原文档）不被数据态渲染触碰。
import { describe, expect, test } from 'bun:test'

import { Sheet } from '@infinitable/sheet'

import { renderDataState, type DatasetShapes } from '../../src/designer/data-state'
import { FormDoc } from '../../src/designer/form-doc'
import { TEMPLATE_SCHEMA_VERSION, type FormTemplate } from '../../src/designer/template'

const ADDR = (row: number, col: number) => ({ row, col })

/** 单行向下展开区模板：静态首行 / 向下展开行 / 静态尾行（4 列全宽区域） */
function expandDownDoc(): FormDoc {
  const template: FormTemplate = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 't',
    regions: [
      { startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'none' },
      { startRow: 1, endRow: 1, startCol: 0, endCol: 3, expand: 'none' },
      { startRow: 2, endRow: 2, startCol: 0, endCol: 3, expand: 'down' },
      { startRow: 3, endRow: 3, startCol: 0, endCol: 3, expand: 'none' },
    ],
    cols: 4,
    sheet: new Sheet('form').snapshot(),
  }
  return FormDoc.fromTemplate(template)
}

/** 数据态快照还原进 Sheet 便于取值断言 */
function materialize(doc: FormDoc, shapes: DatasetShapes): Sheet {
  const sheet = new Sheet('data-state')
  sheet.restore(renderDataState(doc, shapes))
  return sheet
}

describe('向下展开区循环展开', () => {
  const items = [
    { name: '货架', qty: 2, price: 120 },
    { name: '推车', qty: 1, price: 80 },
    { name: '地牛', qty: 1, price: 900 },
  ]

  test('展开行数与数组长度一致，格值按元素逐行取数', () => {
    const doc = expandDownDoc()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    doc.setCellBinding(ADDR(2, 1), { datasetId: 'ds1', path: 'items[].qty' })
    const sheet = materialize(doc, new Map([['ds1', { items }]]))
    // 3 行模板外行 + 3 个数组元素各 1 行
    expect(renderDataState(doc, new Map([['ds1', { items }]])).rows).toBe(6)
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(4, 1))).toBe(1)
    expect(sheet.getDisplayValue(ADDR(5, 0))).toBeUndefined() // 签字行未被明细占用
  })

  test('多行展开区按元素分块复制（元素外层、区域内行内层）', () => {
    const doc = FormDoc.create()
    doc.setRegionExpand(0, 'down') // 默认唯一区域 0..2 改为向下展开
    doc.setCellBinding(ADDR(0, 0), { datasetId: 'ds1', path: 'items[].name' })
    const sheet = materialize(doc, new Map([['ds1', { items }]]))
    // 区域 3 行 × 3 个元素 = 9 行
    expect(sheet.snapshot().rows).toBe(9)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(6, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(9, 0))).toBeUndefined() // 区域外不串行
  })

  test('未绑定格与固定文本随块复制', () => {
    const doc = expandDownDoc()
    doc.sheet.setCellValue(ADDR(2, 3), '备注列')
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    const sheet = materialize(doc, new Map([['ds1', { items }]]))
    expect(sheet.getDisplayValue(ADDR(2, 3))).toBe('备注列')
    expect(sheet.getDisplayValue(ADDR(3, 3))).toBe('备注列')
    expect(sheet.getDisplayValue(ADDR(4, 3))).toBe('备注列')
  })

  test('展开区行高与区域内合并随块复制', () => {
    const doc = expandDownDoc()
    doc.setRowHeight(2, 40)
    doc.sheet.mergeCells({ start: ADDR(2, 0), end: ADDR(2, 1) })
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    const state = renderDataState(doc, new Map([['ds1', { items }]]))
    expect(state.rowHeights).toEqual([
      [2, 40],
      [3, 40],
      [4, 40],
    ])
    expect(state.merges.map((range) => [range.start.row, range.end.row])).toEqual([
      [2, 2],
      [3, 3],
      [4, 4],
    ])
  })

  test('空数组 = 区域塌缩；无有效循环数组 = 保持模板形态出一份', () => {
    const doc = expandDownDoc()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    const collapsed = renderDataState(doc, new Map([['ds1', { items: [] }]]))
    expect(collapsed.rows).toBe(3)
    const untouched = renderDataState(doc, new Map())
    expect(untouched.rows).toBe(4)
    expect(untouched.cells.filter((cell) => cell.row === 2)).toEqual([])
  })
})

describe('非明细格取值与聚合', () => {
  test('直取、嵌套对象与聚合合计', () => {
    const doc = expandDownDoc()
    doc.setCellBinding(ADDR(0, 0), { datasetId: 'ds1', path: 'title' })
    doc.setCellBinding(ADDR(1, 0), { datasetId: 'ds1', path: 'customer.name' })
    doc.setCellBinding(ADDR(1, 1), { datasetId: 'ds1', path: 'items[].price', aggregate: 'sum' })
    doc.setCellBinding(ADDR(3, 0), { datasetId: 'ds1', path: 'items[1].name' })
    const shape = {
      title: '销货单',
      customer: { name: '甲公司' },
      items: [
        { name: '货架', price: 120 },
        { name: '推车', price: 80 },
      ],
    }
    const sheet = materialize(doc, new Map([['ds1', shape]]))
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('销货单')
    expect(sheet.getDisplayValue(ADDR(1, 0))).toBe('甲公司')
    expect(sheet.getDisplayValue(ADDR(1, 1))).toBe(200)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
  })
})

describe('嵌套二级数组循环展开', () => {
  const shape = {
    orders: [
      { no: 'A', lines: [{ qty: 2 }, { qty: 5 }, { qty: 1 }] },
      { no: 'B', lines: [{ qty: 8 }] },
    ],
  }

  test('[] 放在目标层：展开区按二级数组展开取数', () => {
    const doc = expandDownDoc()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'orders[0].lines[].qty' })
    const sheet = materialize(doc, new Map([['ds1', shape]]))
    expect(renderDataState(doc, new Map([['ds1', shape]])).rows).toBe(6) // 3 外行 + 3 行明细
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe(2)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe(5)
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe(1)
  })

  test('一级数组循环 + 区域内固定下标取二级数组', () => {
    const doc = expandDownDoc()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'orders[].no' })
    doc.setCellBinding(ADDR(2, 1), { datasetId: 'ds1', path: 'orders[].lines[0].qty' })
    const sheet = materialize(doc, new Map([['ds1', shape]]))
    expect(sheet.snapshot().rows).toBe(5) // 3 外行 + 2 张订单
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('A')
    expect(sheet.getDisplayValue(ADDR(2, 1))).toBe(2)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('B')
    expect(sheet.getDisplayValue(ADDR(3, 1))).toBe(8)
  })
})

describe('数据态与配置态分离', () => {
  test('绑定 sidecar 不进数据态快照，原文档不被触碰', () => {
    const doc = expandDownDoc()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    const state = renderDataState(doc, new Map([['ds1', { items: [{ name: '货架' }] }]]))
    expect(state.meta).toBeUndefined()
    expect(state.selection).toBeUndefined()
    // 配置态口径：画布存储值仍为空，行数仍是模板行数
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBeUndefined()
    expect(doc.rows).toBe(4)
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('items[].name')
  })
})

/** 两条轴的通用 3 条数据（字段 name / qty） */
const ROWS3 = [
  { name: '甲', qty: 1 },
  { name: '乙', qty: 2 },
  { name: '丙', qty: 3 },
]

describe('向右展开（列轴平铺）', () => {
  /** 2 列向右展开区 + 左右各一段静态列（共 5 列） */
  function expandRightDoc(): FormDoc {
    const template: FormTemplate = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        { startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'none' },
        { startRow: 0, endRow: 0, startCol: 1, endCol: 2, expand: 'right' },
        { startRow: 0, endRow: 0, startCol: 3, endCol: 3, expand: 'none' },
      ],
      cols: 4,
      sheet: new Sheet('form').snapshot(),
    }
    return FormDoc.fromTemplate(template)
  }

  test('3 条数据 → 2 列区域平铺 3 份、右侧静态列右移、每份取值正确', () => {
    const doc = expandRightDoc()
    // 区域第 1 列绑 name、第 2 列绑 qty
    doc.setCellBinding(ADDR(0, 1), { datasetId: 'ds1', path: '[].name' })
    doc.setCellBinding(ADDR(0, 2), { datasetId: 'ds1', path: '[].qty' })
    doc.sheet.setCellValue(ADDR(0, 0), '左静态')
    doc.sheet.setCellValue(ADDR(0, 3), '右静态')
    const sheet = materialize(doc, new Map([['ds1', ROWS3]]))
    // 1 左静态列 + 2 列 × 3 份 + 1 右静态列 = 8 列
    expect(sheet.snapshot().cols).toBe(8)
    // 第 1 份占 1-2 列、第 2 份 3-4 列、第 3 份 5-6 列
    expect(sheet.getDisplayValue(ADDR(0, 1))).toBe('甲')
    expect(sheet.getDisplayValue(ADDR(0, 2))).toBe(1)
    expect(sheet.getDisplayValue(ADDR(0, 3))).toBe('乙')
    expect(sheet.getDisplayValue(ADDR(0, 4))).toBe(2)
    expect(sheet.getDisplayValue(ADDR(0, 5))).toBe('丙')
    expect(sheet.getDisplayValue(ADDR(0, 6))).toBe(3)
    // 静态列位置正确（左在 0，右被推到第 7 列）
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('左静态')
    expect(sheet.getDisplayValue(ADDR(0, 7))).toBe('右静态')
  })

  test('向右展开 + 空数组 → 塌缩为 0 份（区域内列消失）', () => {
    const doc = expandRightDoc()
    doc.setCellBinding(ADDR(0, 1), { datasetId: 'ds1', path: '[].name' })
    doc.sheet.setCellValue(ADDR(0, 3), '右静态')
    const state = renderDataState(doc, new Map([['ds1', []]]))
    // 1 左静态列 + 0 份 + 1 右静态列 = 2 列
    expect(state.cols).toBe(2)
    const sheet = materialize(doc, new Map([['ds1', []]]))
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBeUndefined()
    expect(sheet.getDisplayValue(ADDR(0, 1))).toBe('右静态')
  })

  test('同一份数据的格子落在同一列份：跨列合并随份复制', () => {
    const doc = expandRightDoc()
    doc.setCellBinding(ADDR(0, 1), { datasetId: 'ds1', path: '[].name' })
    doc.sheet.mergeCells({ start: ADDR(0, 1), end: ADDR(0, 2) })
    const state = renderDataState(doc, new Map([['ds1', ROWS3]]))
    // 合并区在每份内部各出一份（3 份 → 3 个合并）
    expect(state.merges).toHaveLength(3)
    expect(state.merges.map((range) => [range.start.col, range.end.col])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
  })
})

describe('双轴与合并边界', () => {
  test('向下展开区下方的内容整体下移，跨展开边界的合并被丢弃', () => {
    const template: FormTemplate = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        { startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'down' },
        { startRow: 1, endRow: 1, startCol: 0, endCol: 3, expand: 'none' },
      ],
      cols: 4,
      sheet: new Sheet('form').snapshot(),
    }
    const doc = FormDoc.fromTemplate(template)
    doc.setCellBinding(ADDR(0, 0), { datasetId: 'ds1', path: '[].name' })
    doc.sheet.setCellValue(ADDR(1, 0), '页脚')
    const sheet = materialize(doc, new Map([['ds1', ROWS3]]))
    // 3 行展开 + 1 行页脚
    expect(sheet.snapshot().rows).toBe(4)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('甲')
    expect(sheet.getDisplayValue(ADDR(1, 0))).toBe('乙')
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('丙')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('页脚')
  })

  test('跨展开区边界的合并被丢弃，区内合并在每份内保留', () => {
    const template: FormTemplate = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      // 展开区只占第 0 行；第 1 行在区域外（静态）
      regions: [{ startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'down' }],
      cols: 4,
      sheet: new Sheet('form').snapshot(),
    }
    const doc = FormDoc.fromTemplate(template)
    doc.setCellBinding(ADDR(0, 0), { datasetId: 'ds1', path: '[].name' })
    // 区内合并（第 0 行内部）：每份各出一份
    doc.sheet.mergeCells({ start: ADDR(0, 0), end: ADDR(0, 1) })
    // 跨边界合并（第 0 行 → 第 1 行）：首行 3 份、末行 1 份，份数不一致 → 丢弃
    doc.sheet.mergeCells({ start: ADDR(0, 2), end: ADDR(1, 3) })
    const state = renderDataState(doc, new Map([['ds1', ROWS3]]))
    // 只剩 3 个区内合并（跨边界那个被丢弃）
    expect(state.merges).toHaveLength(3)
    expect(state.merges.every((range) => range.start.row === range.end.row)).toBe(true)
  })
})
