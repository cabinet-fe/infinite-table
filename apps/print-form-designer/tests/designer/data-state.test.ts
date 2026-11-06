// 数据态渲染管线测试：展开份数由区域 source 驱动（与区域内绑定
// 路径无关）、展开区内绑定按条目相对字段取值、无 source 出一份、空数组塌缩、
// 聚合与非展开区绝对路径、包围盒裁剪，以及配置态画布不被数据态渲染触碰。
import { describe, expect, test } from 'bun:test'

import { Sheet, type SheetSnapshot } from '@infinitable/sheet'

import { renderDataState, datasetShapeKey, type DatasetShapes } from '../../src/designer/data-state'
import { FormDoc } from '../../src/designer/form-doc'
import {
  TEMPLATE_SCHEMA_VERSION,
  type FormCellBinding,
  type FormTemplate,
  type RegionSource,
} from '../../src/designer/template'
import { ADDR, relativeBinding } from './testing/fixtures'

/**
 * 展开区内的绑定：形状就是 `{ path }`（datasetId/expression 继承区域 source）。
 * 带聚合的那档只在验证「展开区忽略聚合」时用。
 */
const item = (path: string, aggregate?: FormCellBinding['aggregate']): FormCellBinding =>
  aggregate ? { ...relativeBinding(path), aggregate } : relativeBinding(path)

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
    sheet: new Sheet('form').snapshot(),
  }
  return FormDoc.fromTemplate(template)
}

/** 区域 source：明细数据集 + 根即数组的循环路径 */
const ITEMS_SOURCE: RegionSource = { datasetId: 'ds1', path: '' }

/** 数据态快照还原进 Sheet 便于取值断言 */
function materialize(doc: FormDoc, shapes: DatasetShapes): Sheet {
  const sheet = new Sheet('data-state')
  sheet.restore(renderDataState(doc, shapes))
  return sheet
}

const ITEMS = [
  { name: '货架', qty: 2, price: 120 },
  { name: '推车', qty: 1, price: 80 },
  { name: '地牛', qty: 1, price: 900 },
]

describe('向下展开：区域 source 驱动份数', () => {
  test('份数 = source 数组长度，区内绑定按条目相对字段取值', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 0), item('name'))
    doc.setCellBinding(ADDR(2, 1), item('qty'))
    const shapes = new Map([['ds1', ITEMS]])
    // 3 行模板外行 + 3 条数据各 1 行
    expect(renderDataState(doc, shapes).rows).toBe(6)
    const sheet = materialize(doc, shapes)
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(4, 1))).toBe(1)
    expect(sheet.getDisplayValue(ADDR(5, 0))).toBeUndefined() // 签字行未被明细占用
  })

  test('空数组 → 0 份（区域内容塌缩）；展开区缺 source 属模型损坏，直接抛错', () => {
    const withSource = expandDownDoc(ITEMS_SOURCE)
    withSource.setCellBinding(ADDR(2, 0), item('name'))
    const collapsed = renderDataState(withSource, new Map([['ds1', []]]))
    // 0 份：展开区的格子全部消失（版面尺寸按包围盒兜底，不会短于模板）
    expect(collapsed.cells.filter((cell) => cell.row === 2 && cell.v !== undefined)).toEqual([])

    // 展开区必须有 source（新建/编辑/加载三条路径都由 normalizeRegions 把关），
    // 绕过模型直接改注册表就是损坏状态：渲染快速失败，不静默出一份。
    const noSource = expandDownDoc(ITEMS_SOURCE)
    noSource.regions = noSource.regions.map((region) => ({ ...region, source: undefined }))
    expect(() => renderDataState(noSource, new Map([['ds1', ITEMS]]))).toThrow('数据源')
  })

  test('source 取不到数组（形态缺失 / 路径不是数组 / 数据集没取数）→ 1 份', () => {
    const doc = expandDownDoc({ datasetId: 'ds1', path: 'missing' })
    expect(renderDataState(doc, new Map([['ds1', ITEMS]])).rows).toBe(4)
    // 数据集根本没取到（rowsByDataset 里没有）→ 形态表无键，同样 1 份
    expect(renderDataState(doc, new Map()).rows).toBe(4)
  })

  test('多行展开区按元素分块复制（元素外层、区域内行内层）', () => {
    const doc = FormDoc.create(8)
    // 先声明数据源，再设展开方式（模型层要求展开区必须有 source）
    doc.setRegionSource(0, ITEMS_SOURCE)
    doc.setRegionExpand(0, 'down')
    doc.setCellBinding(ADDR(0, 0), item('name'))
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    // 区域 3 行 × 3 个元素 = 9 行
    expect(sheet.snapshot().rows).toBe(9)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('货架')
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
    expect(sheet.getDisplayValue(ADDR(6, 0))).toBe('地牛')
    expect(sheet.getDisplayValue(ADDR(9, 0))).toBeUndefined() // 区域外不串行
  })

  test('未绑定格与固定文本、行高、区内合并随块复制', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.sheet.setCellValue(ADDR(2, 3), '备注列')
    doc.setRowHeight(2, 40)
    doc.sheet.mergeCells({ start: ADDR(2, 0), end: ADDR(2, 1) })
    doc.setCellBinding(ADDR(2, 0), item('name'))
    const shapes = new Map([['ds1', ITEMS]])
    const state = renderDataState(doc, shapes)
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
    const doc = expandDownDoc({ datasetId: 'ds1', path: '[0].items' })
    doc.setCellBinding(ADDR(2, 0), item('qty'))
    const shapes = new Map([['ds1', rows]])
    expect(renderDataState(doc, shapes).rows).toBe(6) // 3 外行 + 3 行明细
    const sheet = materialize(doc, shapes)
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe(2)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe(5)
    expect(sheet.getDisplayValue(ADDR(4, 0))).toBe(1)
  })

  test("path 'order.lines' 形式：对象形态内多层下钻", () => {
    const doc = expandDownDoc({ datasetId: 'ds1', path: 'order.lines' })
    doc.setCellBinding(ADDR(2, 0), item('qty'))
    const shapes = new Map([['ds1', { order: { lines } }]])
    expect(renderDataState(doc, shapes).rows).toBe(6)
    expect(materialize(doc, shapes).getDisplayValue(ADDR(4, 0))).toBe(1)
  })

  test('同一形态：区域 source 的表达式与绑定的绝对路径各自独立取形态', () => {
    // 区域 source 带表达式（rows[0] → 单据头对象），再下钻 items
    const doc = expandDownDoc({ datasetId: 'ds1', expression: 'rows[0]', path: 'items' })
    doc.setCellBinding(ADDR(2, 0), item('qty'))
    // 非展开区绑定仍走绝对路径（自己的表达式形态：裸行数组 → 取 no）
    doc.setCellBinding(ADDR(0, 0), { datasetId: 'ds1', path: '[0].no' })
    const shapes = new Map<string, unknown>([
      [datasetShapeKey('ds1', 'rows[0]'), rows[0]],
      [datasetShapeKey('ds1'), rows],
    ])
    expect(renderDataState(doc, shapes).rows).toBe(6)
    const sheet = materialize(doc, shapes)
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('A')
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe(2)
  })
})

describe('非展开区：绝对路径与聚合', () => {
  test('直取、嵌套对象、聚合合计、固定下标', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(0, 0), { datasetId: 'ds2', path: 'title' })
    doc.setCellBinding(ADDR(1, 0), { datasetId: 'ds2', path: 'customer.name' })
    doc.setCellBinding(ADDR(1, 1), { datasetId: 'ds2', path: 'items[].price', aggregate: 'sum' })
    doc.setCellBinding(ADDR(3, 0), { datasetId: 'ds2', path: 'items[1].name' })
    const shape = {
      title: '销货单',
      customer: { name: '甲公司' },
      items: [
        { name: '货架', price: 120 },
        { name: '推车', price: 80 },
      ],
    }
    const sheet = materialize(doc, new Map([['ds2', shape]]))
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBe('销货单')
    expect(sheet.getDisplayValue(ADDR(1, 0))).toBe('甲公司')
    expect(sheet.getDisplayValue(ADDR(1, 1))).toBe(200)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe('推车')
  })

  test('展开区内的绑定忽略聚合（按份取值）', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 0), item('price', 'sum'))
    const sheet = materialize(doc, new Map([['ds1', ITEMS]]))
    expect(sheet.getDisplayValue(ADDR(2, 0))).toBe(120)
    expect(sheet.getDisplayValue(ADDR(3, 0))).toBe(80)
  })
})

describe('向右展开（列轴平铺）', () => {
  /** 2 列向右展开区 + 左右各一段静态列（共 4 列） */
  function expandRightDoc(source?: FormTemplate['regions'][number]['source']): FormDoc {
    const template: FormTemplate = {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [
        { startRow: 0, endRow: 0, startCol: 0, endCol: 0, expand: 'none' },
        { startRow: 0, endRow: 0, startCol: 1, endCol: 2, expand: 'right', source },
        { startRow: 0, endRow: 0, startCol: 3, endCol: 3, expand: 'none' },
      ],
      sheet: new Sheet('form').snapshot(),
    }
    return FormDoc.fromTemplate(template)
  }

  const ROWS3 = [
    { name: '甲', qty: 1 },
    { name: '乙', qty: 2 },
    { name: '丙', qty: 3 },
  ]

  test('3 条数据 → 区域平铺 3 份、右侧静态列右移、每份取相对字段', () => {
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

  test('向右展开 + 空数组 → 0 份（区域内列消失）', () => {
    const doc = expandRightDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(0, 1), item('name'))
    doc.sheet.setCellValue(ADDR(0, 3), '右静态')
    const shape = new Map([['ds1', []]])
    const sheet = materialize(doc, shape)
    // 区域内 2 列整块消失：右侧静态列被拉到第 1 列；版面尺寸按内容包围盒兜底
    expect(sheet.getDisplayValue(ADDR(0, 0))).toBeUndefined()
    expect(sheet.getDisplayValue(ADDR(0, 1))).toBe('右静态')
    expect(sheet.getDisplayValue(ADDR(0, 2))).toBeUndefined()
    expect(renderDataState(doc, shape).cols).toBe(4)
  })

  test('跨列合并随份复制', () => {
    const doc = expandRightDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(0, 1), item('name'))
    doc.sheet.mergeCells({ start: ADDR(0, 1), end: ADDR(0, 2) })
    const state = renderDataState(doc, new Map([['ds1', ROWS3]]))
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
      sheet: paddedSnapshot(),
    })
    const state = renderDataState(doc, new Map([['ds1', ITEMS]]))
    // 1 静态行 + 3 条明细 = 4 行；列 = 区域宽度 3（不是引擎扩容的 60）
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
      sheet: { ...new Sheet('form').snapshot(), rows: 120, cols: 40 },
    })
    // 空内容：包围盒下限 1×1（引擎与打印内核都不接受 0 行列）
    const empty = renderDataState(doc, new Map())
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
      sheet: new Sheet('form').snapshot(),
    })
    doc.setCellBinding(ADDR(0, 0), item('name'))
    doc.sheet.mergeCells({ start: ADDR(0, 0), end: ADDR(0, 1) })
    // 跨边界合并（第 0 行 → 第 1 行）：首行 3 份、末行 1 份，份数不一致 → 丢弃
    doc.sheet.mergeCells({ start: ADDR(0, 2), end: ADDR(1, 3) })
    const state = renderDataState(doc, new Map([['ds1', ITEMS]]))
    expect(state.merges).toHaveLength(3)
    expect(state.merges.every((range) => range.start.row === range.end.row)).toBe(true)
  })
})

describe('数据态与配置态分离', () => {
  test('绑定 sidecar 不进数据态快照，原文档不被触碰', () => {
    const doc = expandDownDoc(ITEMS_SOURCE)
    doc.setCellBinding(ADDR(2, 0), item('name'))
    const state = renderDataState(doc, new Map([['ds1', [ITEMS[0]!]]]))
    expect(state.meta).toBeUndefined()
    expect(state.selection).toBeUndefined()
    // 配置态口径：画布存储值仍为空，绑定仍是条目内相对路径
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBeUndefined()
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('name')
  })
})
