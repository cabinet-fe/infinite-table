// P6 数据态渲染管线测试：明细波段按绑定数组循环展开（展开行数与数组长度一致）、
// 嵌套二级数组路径逐行取数、聚合、未绑定格回落模板值、绑定 sidecar 不进数据态、
// 以及配置态画布（FormDoc 原文档）不被数据态渲染触碰。
import { describe, expect, test } from 'bun:test'

import { Sheet } from '@infinitable/sheet'

import { renderDataState, type DatasetShapes } from '../../src/designer/data-state'
import { FormDoc } from '../../src/designer/form-doc'
import { TEMPLATE_SCHEMA_VERSION, type FormTemplate } from '../../src/designer/template'

const ADDR = (row: number, col: number) => ({ row, col })

/** 单行明细波段模板（页眉 1 行 / 信息 1 行 / 明细 1 行 / 签字 1 行） */
function detailDoc(): FormDoc {
  const template: FormTemplate = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 't',
    bands: [
      { kind: 'pageHeader', startRow: 0, endRow: 0 },
      { kind: 'info', startRow: 1, endRow: 1 },
      { kind: 'detail', startRow: 2, endRow: 2 },
      { kind: 'signature', startRow: 3, endRow: 3 },
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

describe('明细波段循环展开', () => {
  const items = [
    { name: '货架', qty: 2, price: 120 },
    { name: '推车', qty: 1, price: 80 },
    { name: '地牛', qty: 1, price: 900 },
  ]

  test('展开行数与数组长度一致，格值按元素逐行取数', () => {
    const doc = detailDoc()
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

  test('多行明细波段按元素分块复制（元素外层、波段行区内层）', () => {
    const doc = FormDoc.create() // 默认明细波段 3 行（4..6）
    doc.setCellBinding(ADDR(4, 0), { datasetId: 'ds1', path: 'items[].name' })
    const sheet = materialize(doc, new Map([['ds1', { items }]]))
    // 非明细 7 行 + 3 元素 × 3 行
    expect(sheet.snapshot().rows).toBe(16)
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(7, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(10, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(13, 0))).toBeUndefined() // 波段外不串行
  })

  test('未绑定格与固定文本随块复制', () => {
    const doc = detailDoc()
    doc.sheet.setCellValue(ADDR(2, 3), '备注列')
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    const sheet = materialize(doc, new Map([['ds1', { items }]]))
    expect(sheet.getDisplayValue(ADDR(2, 3))).toBe('备注列')
    expect(sheet.getDisplayValue(ADDR(3, 3))).toBe('备注列')
    expect(sheet.getDisplayValue(ADDR(4, 3))).toBe('备注列')
  })

  test('明细行高与波段内合并随块复制', () => {
    const doc = detailDoc()
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

  test('空数组 = 波段塌缩；无有效循环数组 = 保持模板形态出一份', () => {
    const doc = detailDoc()
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
    const doc = detailDoc()
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

  test('[] 放在目标层：明细波段按二级数组展开取数', () => {
    const doc = detailDoc()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'orders[0].lines[].qty' })
    const sheet = materialize(doc, new Map([['ds1', shape]]))
    expect(renderDataState(doc, new Map([['ds1', shape]])).rows).toBe(6) // 3 外行 + 3 行明细
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe(2)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe(5)
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe(1)
  })

  test('一级数组循环 + 波段内固定下标取二级数组', () => {
    const doc = detailDoc()
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
    const doc = detailDoc()
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
