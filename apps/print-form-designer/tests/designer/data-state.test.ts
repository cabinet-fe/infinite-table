// 数据态渲染管线测试（v4）：展开份数由数据块 source 驱动、数据块内绑定按条目相对
// 字段取值（不展开带源的数据块取第 1 条）、空数组塌缩、分组（组头/明细/小计/合计）、
// 单元格函数（SUM/SUBTOTAL/GROUP/item/agg）、聚合作数据块数据源、包围盒裁剪，
// 以及配置态画布不被数据态渲染触碰。
import { describe, expect, test } from 'vitest'

import { Sheet, type SheetSnapshot } from '@infinitable/sheet'

import { renderDataState, datasetShapeKey, type DatasetShapes } from '../../src/designer/data-state'
import { FormDoc } from '../../src/domain/form-doc'
import {
  TEMPLATE_SCHEMA_VERSION,
  type FormCellBinding,
  type FormRegion,
  type FormTemplate,
  type RegionSource,
} from '../../src/shared/template-schema'
import { ADDR, relativeBinding } from './testing/fixtures'

/** 数据块内绑定：条目内相对路径 */
const item = (path: string): FormCellBinding => relativeBinding(path)

/** 数据集来源快捷写法 */
const datasetSource = (datasetId: string, path = '', expression?: string): RegionSource => ({
  kind: 'dataset',
  datasetId,
  path,
  ...(expression ? { expression } : {}),
})

/**
 * 单行向下展开区模板：静态首行 / 静态次行 / 向下展开行 / 静态尾行（4 列）。
 */
function expandDownDoc(source?: RegionSource): FormDoc {
  const template: FormTemplate = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: 't',
    regions: [
      { startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'none' },
      { startRow: 1, endRow: 1, startCol: 0, endCol: 3, expand: 'none' },
      { startRow: 2, endRow: 2, startCol: 0, endCol: 3, expand: 'down', source },
      { startRow: 3, endRow: 3, startCol: 0, endCol: 3, expand: 'none' },
    ],
    aggregations: [],
    sheet: new Sheet('form').snapshot(),
  }
  return FormDoc.fromTemplate(template)
}

/** 数据块 source：明细数据集 + 根即数组的循环路径 */
const ITEMS_SOURCE: RegionSource = datasetSource('ds1')

/** 渲染快捷入口（v4 输入 = 形态表 + 聚合结果） */
function render(doc: FormDoc, shapes: DatasetShapes, agg: Record<string, unknown> = {}) {
  return renderDataState(doc, { shapes, agg })
}

/** 数据态快照还原进 Sheet 便于取值断言 */
function materialize(
  doc: FormDoc,
  shapes: DatasetShapes,
  agg: Record<string, unknown> = {},
): Sheet {
  const sheet = new Sheet('data-state')
  sheet.restore(render(doc, shapes, agg))
  return sheet
}

const ITEMS = [
  { name: '货架', qty: 2, price: 120 },
  { name: '推车', qty: 1, price: 80 },
  { name: '地牛', qty: 1, price: 900 },
]

describe('向下展开：数据块 source 驱动份数', () => {
  test('份数 = source 数组长度，区内绑定按条目相对字段取值', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 0), item('name'))
    doc.setCellBinding(ADDR(2, 1), item('qty'))
    const shapes = new Map([['ds1', ITEMS]])
    // 3 行模板外行 + 3 条数据各 1 行
    expect(render(doc, shapes).rows).toBe(6)
    const sheet = materialize(doc, shapes)
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(4, 1))).toBe(1)
    expect(sheet.getDisplayValue(ADDR(5, 0))).toBeUndefined() // 签字行未被明细占用
  })

  test('空数组 → 0 份（数据块内容塌缩）', () => {
    const withSource = expandDownDoc(ITEMS_SOURCE)
    withSource.setCellBinding(ADDR(2, 0), item('name'))
    const collapsed = render(withSource, new Map([['ds1', []]]))
    // 0 份：展开区的格子全部消失（版面尺寸按包围盒兜底，不会短于模板）
    expect(collapsed.cells.filter((cell) => cell.row === 2 && cell.v !== undefined)).toEqual([])
  })

  test('展开区无数据源 → 暂按 1 份渲染、绑定解析为空（合法中间态）', () => {
    const noSource = expandDownDoc(undefined)
    noSource.setCellBinding(ADDR(2, 0), item('name'))
    // 3 外行 + 1 份（不随数据条数变化，与「取不到数组 → 1 份」口径一致）
    expect(render(noSource, new Map([['ds1', ITEMS]])).rows).toBe(4)
    expect(
      materialize(noSource, new Map([['ds1', ITEMS]])).getDisplayValue(ADDR(2, 0)),
    ).toBeUndefined()
  })

  test('source 取不到数组（形态缺失 / 路径不是数组 / 数据集没取数）→ 1 份', () => {
    const doc = expandDownDoc(datasetSource('ds1', 'missing'))
    expect(render(doc, new Map([['ds1', ITEMS]])).rows).toBe(4)
    // 数据集根本没取到（rowsByDataset 里没有）→ 形态表无键，同样 1 份
    expect(render(doc, new Map()).rows).toBe(4)
  })

  test('多行展开区按元素分块复制（元素外层、数据块内行内层）', () => {
    const doc = FormDoc.create(8)
    // 展开方式可先设、数据源后绑（展开未绑源是合法中间态）
    doc.setRegionExpand(0, 'down')
    doc.setRegionSource(0, ITEMS_SOURCE)
    doc.setCellBinding(ADDR(0, 0), item('name'))
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    // 数据块 3 行 × 3 个元素 = 9 行
    expect(sheet.snapshot().rows).toBe(9)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(6, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(9, 0))).toBeUndefined() // 数据块外不串行
  })

  test('未绑定格与固定文本、行高、区内合并随块复制', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.sheet.setCellValue(ADDR(2, 3), '备注列')
    doc.setRowHeight(2, 40)
    doc.sheet.mergeCells({ start: ADDR(2, 0), end: ADDR(2, 1) })
    doc.setCellBinding(ADDR(2, 0), item('name'))
    const shapes = new Map([['ds1', ITEMS]])
    const state = render(doc, shapes)
    const sheet = materialize(doc, shapes)
    expect(sheet.getDisplayValue(ADDR(2, 3))).toBe('备注列')
    expect(sheet.getDisplayValue(ADDR(3, 3))).toBe('备注列')
    expect(sheet.getDisplayValue(ADDR(4, 3))).toBe('备注列')
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
})

describe('嵌套列表路径（source.path）', () => {
  const lines = [{ qty: 2 }, { qty: 5 }, { qty: 1 }]
  /** 原始行形态：单据头数组，明细挂在首单的 items 上 */
  const rows = [{ no: 'A', items: lines }]

  test("path '[0].items' 形式：从单据头下钻到明细数组", () => {
    const doc = expandDownDoc(datasetSource('ds1', '[0].items'))
    doc.setCellBinding(ADDR(2, 0), item('qty'))
    const shapes = new Map([['ds1', rows]])
    expect(render(doc, shapes).rows).toBe(6) // 3 外行 + 3 行明细
    const sheet = materialize(doc, shapes)
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe(2)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe(5)
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe(1)
  })

  test("path 'order.lines' 形式：对象形态内多层下钻", () => {
    const doc = expandDownDoc(datasetSource('ds1', 'order.lines'))
    doc.setCellBinding(ADDR(2, 0), item('qty'))
    const shapes = new Map([['ds1', { order: { lines } }]])
    expect(render(doc, shapes).rows).toBe(6)
    expect(materialize(doc, shapes).getDisplayValue(ADDR(4, 0))).toBe(1)
  })

  test('数据块 source 的重塑表达式决定自己的形态键', () => {
    // 数据块 source 带表达式（rows[0] → 单据头对象），再下钻 items
    const doc = expandDownDoc(datasetSource('ds1', 'items', 'rows[0]'))
    doc.setCellBinding(ADDR(2, 0), item('qty'))
    const shapes = new Map<string, unknown>([[datasetShapeKey('ds1', 'rows[0]'), rows[0]]])
    expect(render(doc, shapes).rows).toBe(6)
    expect(materialize(doc, shapes).getDisplayValue(ADDR(2, 0))).toBe(2)
  })
})

describe('不展开 + 带源的数据块：静态取第 1 条', () => {
  test('数据块内绑定取循环数组第 1 条（表头区直取字段）', () => {
    const template: FormTemplate = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 3,
          expand: 'none',
          source: datasetSource('ds2', 'orders'),
        },
      ],
      aggregations: [],
      sheet: new Sheet('form').snapshot(),
    }
    const doc = FormDoc.fromTemplate(template)
    doc.setCellBinding(ADDR(0, 0), item('title'))
    doc.setCellBinding(ADDR(0, 1), item('customer.name'))
    const shape = { orders: [{ title: '销货单', customer: { name: '甲公司' } }] }
    const sheet = materialize(doc, new Map([['ds2', shape]]))
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('销货单')
    expect(sheet.getDisplayValue(ADDR(0, 1))).toBe('甲公司')
  })
})

describe('单元格函数（作用方式的替代）', () => {
  test('SUM 同列省字段：合计格取所在列在数据块内的绑定字段求和', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 1), item('qty'))
    doc.setCellFunction(ADDR(3, 1), { expression: "SUM('数据块 3')" })
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    expect(sheet.getDisplayValue(ADDR(5, 1))).toBe(4) // 2 + 1 + 1
  })

  test('SUM 显式字段 + 基本聚合函数族', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 1), item('qty'))
    doc.setCellFunction(ADDR(3, 0), { expression: "SUM('数据块 3', 'price')" })
    doc.setCellFunction(ADDR(3, 1), { expression: "AVG('数据块 3', 'price')" })
    doc.setCellFunction(ADDR(3, 2), { expression: "COUNT('数据块 3')" })
    doc.setCellFunction(ADDR(3, 3), { expression: "MAX('数据块 3', 'price')" })
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    expect(sheet.getDisplayValue(ADDR(5, 0))).toBe(1100) // 120 + 80 + 900
    expect(sheet.getDisplayValue(ADDR(5, 1))).toBeCloseTo(1100 / 3)
    expect(sheet.getDisplayValue(ADDR(5, 2))).toBe(3)
    expect(sheet.getDisplayValue(ADDR(5, 3))).toBe(900)
  })

  test('明细行内的计算列：item 引用当前条目', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellFunction(ADDR(2, 3), { expression: 'item.qty * item.price' })
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    expect(sheet.getDisplayValue(ADDR(2, 3))).toBe(240)
    expect(sheet.getDisplayValue(ADDR(3, 3))).toBe(80)
    expect(sheet.getDisplayValue(ADDR(4, 3))).toBe(900)
  })

  test('agg 引用：聚合结果对象在函数里直接取值', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellFunction(ADDR(3, 0), { expression: "agg.summary['total'] * 2" })
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]), { summary: { total: 21 } })
    expect(sheet.getDisplayValue(ADDR(5, 0))).toBe(42)
  })

  test('未知数据块引用快速失败', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellFunction(ADDR(3, 0), { expression: "SUM('不存在')" })
    expect(() => render(doc, new Map([['ds1', ITEMS]]))).toThrow('没有名为')
  })
})

describe('分组（groupBy + 行角色）', () => {
  /** 两组明细：甲公司 2 条、乙公司 1 条 */
  const GROUPED = [
    { customer: '甲', name: '货架', qty: 2 },
    { customer: '甲', name: '推车', qty: 1 },
    { customer: '乙', name: '地牛', qty: 5 },
  ]

  /**
   * 分组区模板：第 0 行组头、第 1 行明细、第 2 行小计、第 3 行合计（4 列）。
   */
  function groupedDoc(groupBy = ['customer']): FormDoc {
    const region: FormRegion = {
      startRow: 0,
      endRow: 3,
      startCol: 0,
      endCol: 3,
      expand: 'down',
      source: ITEMS_SOURCE,
      groupBy,
      rowRoles: [
        { row: 0, role: 'groupHeader' },
        { row: 2, role: 'groupFooter' },
        { row: 3, role: 'summary' },
      ],
    }
    return FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [region],
      aggregations: [],
      sheet: new Sheet('form').snapshot(),
    })
  }

  test('逐组渲染：组头 ×1 + 明细 × 组内条数 + 小计 ×1，合计垫底', () => {
    const doc = groupedDoc()
    doc.setCellBinding(ADDR(0, 0), item('customer')) // 组头行绑定取组内第 1 条
    doc.setCellBinding(ADDR(1, 0), item('name'))
    doc.setCellBinding(ADDR(1, 1), item('qty'))
    doc.setCellFunction(ADDR(2, 1), { expression: "SUBTOTAL('数据块 1', 'qty')" })
    doc.setCellFunction(ADDR(3, 1), { expression: "SUM('数据块 1', 'qty')" })
    const sheet = materialize(doc, new Map([['ds1', GROUPED]]))
    // 甲组：组头 + 2 明细 + 小计 = 4 行；乙组：组头 + 1 明细 + 小计 = 3 行；合计 1 行
    expect(sheet.snapshot().rows).toBe(8)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('甲') // 组头
    expect(sheet.getDisplayValue(ADDR(1, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(3, 1))).toBe(3) // 甲小计 2+1
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe('乙') // 乙组头
    expect(sheet.getDisplayValue(ADDR(5, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(6, 1))).toBe(5) // 乙小计
    expect(sheet.getDisplayValue(ADDR(7, 1))).toBe(8) // 合计 3+5
  })

  test('GROUP() 出组名（缺省取首个分组字段）', () => {
    const doc = groupedDoc()
    doc.setCellFunction(ADDR(0, 0), { expression: 'GROUP()' })
    doc.setCellFunction(ADDR(0, 1), { expression: "GROUP('customer')" })
    const sheet = materialize(doc, new Map([['ds1', GROUPED]]))
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('甲')
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe('乙')
  })

  test('空数组：明细/组头/小计塌缩，仅合计行保留（版面按包围盒兜底）', () => {
    const doc = groupedDoc()
    doc.setCellFunction(ADDR(3, 1), { expression: "SUM('数据块 1', 'qty')" })
    const sheet = materialize(doc, new Map([['ds1', []]]))
    // 仅合计行有输出（槽位 0），其余行是包围盒兜底的空版面
    expect(sheet.getDisplayValue(ADDR(0, 1))).toBe(0)
    expect(sheet.getDisplayValue(ADDR(1, 1))).toBeUndefined()
    expect(sheet.getDisplayValue(ADDR(2, 1))).toBeUndefined()
  })

  test('未分组的 down 数据块也支持合计行（明细 ×N + 合计 ×1）', () => {
    const region: FormRegion = {
      startRow: 0,
      endRow: 1,
      startCol: 0,
      endCol: 1,
      expand: 'down',
      source: ITEMS_SOURCE,
      rowRoles: [{ row: 1, role: 'summary' }],
    }
    const doc = FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [region],
      aggregations: [],
      sheet: new Sheet('form').snapshot(),
    })
    doc.setCellBinding(ADDR(0, 0), item('name'))
    doc.setCellFunction(ADDR(1, 0), { expression: "COUNT('数据块 1')" })
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    expect(sheet.snapshot().rows).toBe(4) // 3 明细 + 1 合计
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe(3)
  })
})

describe('聚合引用绑定（kind:"agg"，块外格直取非数组聚合）', () => {
  test('从聚合结果取值：值本身 / 嵌套路径 / 取不到为空（与绑定 miss 同口径）', () => {
    const doc = expandDownDoc(undefined)
    doc.setCellBinding(ADDR(0, 0), { kind: 'agg', aggName: 'head', path: '' })
    doc.setCellBinding(ADDR(1, 0), { kind: 'agg', aggName: 'head', path: 'customer.name' })
    doc.setCellBinding(ADDR(3, 0), { kind: 'agg', aggName: 'missing', path: '' })
    doc.setCellBinding(ADDR(3, 1), { kind: 'agg', aggName: 'head', path: 'nope' })
    // head 是对象：path '' 取不到（对象不进格），嵌套路径下钻取到
    const sheet = materialize(doc, new Map(), { head: { customer: { name: '甲公司' } } })
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBeUndefined()
    expect(sheet.getDisplayValue(ADDR(1, 0))).toBe('甲公司')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBeUndefined()
    expect(sheet.getDisplayValue(ADDR(3, 1))).toBeUndefined()
  })

  test('原始值聚合：path "" 值本身直接进格', () => {
    const doc = expandDownDoc(undefined)
    doc.setCellBinding(ADDR(0, 0), { kind: 'agg', aggName: 'total', path: '' })
    const sheet = materialize(doc, new Map(), { total: 42 })
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe(42)
  })

  test('块外格随展开位移保持引用（聚合绑定与数据块槽位无关）', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 0), item('name'))
    // 签字行（模板第 3 行）在展开区下方，随明细份数下移
    doc.setCellBinding(ADDR(3, 0), { kind: 'agg', aggName: 'total', path: '' })
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]), { total: '共 3 条' })
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(5, 0))).toBe('共 3 条')
  })
})

describe('聚合作数据块数据源', () => {
  test("kind:'agg' 的 source 从聚合结果里取循环数组", () => {
    const doc = FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 1,
          expand: 'down',
          source: { kind: 'agg', aggName: 'grouped', path: 'items' },
        },
      ],
      aggregations: [
        {
          // 返回订单对象（value 型）：数据块源从其 items 键挖循环数组
          name: 'grouped',
          type: 'value',
          params: [{ datasetId: 'ds1', varName: 'rows' }],
          expression: 'return rows[0]',
        },
      ],
      sheet: new Sheet('form').snapshot(),
    })
    doc.setCellBinding(ADDR(0, 0), item('qty'))
    const sheet = materialize(doc, new Map(), { grouped: { items: [{ qty: 7 }, { qty: 9 }] } })
    expect(sheet.snapshot().rows).toBe(2)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe(7)
    expect(sheet.getDisplayValue(ADDR(1, 0))).toBe(9)
  })
})

describe('向右展开（列轴平铺）', () => {
  /** 2 列向右展开区 + 左右各一段静态列（共 4 列） */
  function expandRightDoc(source?: RegionSource): FormDoc {
    const template: FormTemplate = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        { startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'none' },
        { startRow: 0, endRow: 0, startCol: 1, endCol: 2, expand: 'right', source },
        { startRow: 0, endRow: 0, startCol: 3, endCol: 3, expand: 'none' },
      ],
      aggregations: [],
      sheet: new Sheet('form').snapshot(),
    }
    return FormDoc.fromTemplate(template)
  }

  const ROWS3 = [
    { name: '甲', qty: 1 },
    { name: '乙', qty: 2 },
    { name: '丙', qty: 3 },
  ]

  test('3 条数据 → 数据块平铺 3 份、右侧静态列右移、每份取相对字段', () => {
    const doc = expandRightDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(0, 1), item('name'))
    doc.setCellBinding(ADDR(0, 2), item('qty'))
    doc.sheet.setCellValue(ADDR(0, 0), '左静态')
    doc.sheet.setCellValue(ADDR(0, 3), '右静态')
    const sheet = materialize(doc, new Map([['ds1', ROWS3]]))
    // 1 左静态列 + 2 列 × 3 份 + 1 右静态列 = 8 列
    expect(sheet.snapshot().cols).toBe(8)
    // 第 1 份占 1-2 列、第 2 份 3-4 列、第 3 份 5-6 列
    expect(sheet.getDisplayValue(ADDR(0, 1))).toBe('甲')
    expect(sheet.getDisplayValue(ADDR(0, 2))).toBe(1)
    expect(sheet.getDisplayValue(ADDR(0, 3))).toBe('乙')
    expect(sheet.getDisplayValue(ADDR(0, 5))).toBe('丙')
    expect(sheet.getDisplayValue(ADDR(0, 6))).toBe(3)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('左静态')
    expect(sheet.getDisplayValue(ADDR(0, 7))).toBe('右静态')
  })

  test('向右展开 + 空数组 → 0 份（数据块内列消失）', () => {
    const doc = expandRightDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(0, 1), item('name'))
    doc.sheet.setCellValue(ADDR(0, 3), '右静态')
    const shape = new Map([['ds1', []]])
    const sheet = materialize(doc, shape)
    // 数据块内 2 列整块消失：右侧静态列被拉到第 1 列；版面尺寸按内容包围盒兜底
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBeUndefined()
    expect(sheet.getDisplayValue(ADDR(0, 1))).toBe('右静态')
    expect(sheet.getDisplayValue(ADDR(0, 2))).toBeUndefined()
    expect(render(doc, shape).cols).toBe(4)
  })

  test('跨列合并随份复制', () => {
    const doc = expandRightDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(0, 1), item('name'))
    doc.sheet.mergeCells({ start: ADDR(0, 1), end: ADDR(0, 2) })
    const state = render(doc, new Map([['ds1', ROWS3]]))
    expect(state.merges).toHaveLength(3)
    expect(state.merges.map((range) => [range.start.col, range.end.col])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
  })
})

describe('包围盒裁剪', () => {
  /** 引擎扩容噪声：rows/cols 远大于内容（无限画布 + growOnScroll 的常态） */
  function paddedSnapshot(): SheetSnapshot {
    const sheet = new Sheet('form')
    sheet.setCellValue(ADDR(0, 0), '标题')
    const snapshot = sheet.snapshot()
    return { ...snapshot, rows: 200, cols: 60 }
  }

  test('模板长度取内容包围盒，扩容出的空行空列不进输出', () => {
    const doc = FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        { startRow: 0, endRow: 0, startCol: 0, endCol: 2, expand: 'none' },
        {
          startRow: 1,
          endRow: 1,
          startCol: 0,
          endCol: 2,
          expand: 'down',
          source: ITEMS_SOURCE,
        },
      ],
      aggregations: [],
      sheet: paddedSnapshot(),
    })
    const state = render(doc, new Map([['ds1', ITEMS]]))
    // 1 静态行 + 3 条明细 = 4 行；列 = 数据块宽度 3（不是引擎扩容的 60）
    expect(state.rows).toBe(4)
    expect(state.cols).toBe(3)
    // 落在包围盒外的扩容空行不会进快照
    expect(state.cells.every((cell) => cell.row < 4 && cell.col < 3)).toBe(true)
  })

  test('扩容出的空行空列不进输出（尺寸 = 内容包围盒与展开后尺寸的较大者）', () => {
    const doc = FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [],
      aggregations: [],
      sheet: { ...new Sheet('form').snapshot(), rows: 120, cols: 40 },
    })
    // 空内容：包围盒下限 1×1（引擎与打印内核都不接受 0 行列）
    const empty = render(doc, new Map())
    expect(empty.rows).toBe(1)
    expect(empty.cols).toBe(1)
    expect(empty.cells).toEqual([])
  })
})

describe('双轴与合并边界', () => {
  test('向下展开区下方内容整体下移，跨展开边界的合并被丢弃', () => {
    const doc = FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 3,
          expand: 'down',
          source: ITEMS_SOURCE,
        },
        { startRow: 1, endRow: 1, startCol: 0, endCol: 3, expand: 'none' },
      ],
      aggregations: [],
      sheet: new Sheet('form').snapshot(),
    })
    doc.setCellBinding(ADDR(0, 0), item('name'))
    doc.sheet.setCellValue(ADDR(1, 0), '页脚')
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    expect(sheet.snapshot().rows).toBe(4)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(1, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('页脚')
  })

  test('跨展开区边界的合并被丢弃，区内合并在每份内保留', () => {
    const doc = FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        {
          startRow: 0,
          endRow: 0,
          startCol: 0,
          endCol: 3,
          expand: 'down',
          source: ITEMS_SOURCE,
        },
      ],
      aggregations: [],
      sheet: new Sheet('form').snapshot(),
    })
    doc.setCellBinding(ADDR(0, 0), item('name'))
    doc.sheet.mergeCells({ start: ADDR(0, 0), end: ADDR(0, 1) })
    // 跨边界合并（第 0 行 → 第 1 行）：首行 3 份、末行 1 份，份数不一致 → 丢弃
    doc.sheet.mergeCells({ start: ADDR(0, 2), end: ADDR(1, 3) })
    const state = render(doc, new Map([['ds1', ITEMS]]))
    expect(state.merges).toHaveLength(3)
    expect(state.merges.every((range) => range.start.row === range.end.row)).toBe(true)
  })
})

describe('数据态与配置态分离', () => {
  test('绑定/函数 sidecar 不进数据态快照，原文档不被触碰', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 0), item('name'))
    doc.setCellFunction(ADDR(3, 0), { expression: "COUNT('数据块 3')" })
    const state = render(doc, new Map([['ds1', [ITEMS[0]!]]]))
    expect(state.meta).toBeUndefined()
    expect(state.selection).toBeUndefined()
    // 配置态口径：画布存储值仍为空，绑定仍是条目内相对路径
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBeUndefined()
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('name')
  })
})
