// 模型层 headless 测试：区域结构操作（含选区建区与数据源绑定）、内容包围盒驱动的
// 行列尺寸、格样式命令与快照条目的统一撤销链路、绑定 sidecar 形状与占位符推导。
// 模板序列化在 template.test.ts。
import { describe, expect, test } from 'bun:test'

import {
  FORM_BINDING_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  formatBindingPlaceholder,
  regionsAt,
} from '../../src/designer/template'
import { FormDoc } from '../../src/designer/form-doc'
import { ADDR, RANGE } from './testing/fixtures'

/** 明细展开源（展开区必须带 source，测试里统一用它） */
const SOURCE = { datasetId: 'ds1', path: '' }

describe('默认文档与区域结构', () => {
  test('空白文档只有一个全宽区域（0..2 行）', () => {
    const doc = FormDoc.create(8)
    expect(doc.regions).toHaveLength(1)
    expect(doc.regions[0]).toEqual({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 7,
      expand: 'none',
    })
    expect(doc.rows).toBe(3)
    expect(doc.cols).toBe(8)
    expect(regionsAt(doc.regions, 0, 0)).toBe(doc.regions[0])
    expect(regionsAt(doc.regions, 3, 0)).toBeUndefined()
  })

  test('添加区域：追加在内容包围盒最下方、全宽、既有内容不动', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(0, 0), '标题')
    const added = doc.addRegion(3) // 默认 3 行
    expect(doc.regions).toHaveLength(2)
    expect(doc.rows).toBe(6)
    expect(added).toEqual({
      startRow: 3,
      endRow: 5,
      startCol: 0,
      endCol: 7,
      expand: 'none',
    })
    expect(doc.sheet.getDisplayValue(ADDR(0, 0))).toBe('标题')
  })

  test('添加区域：起点跟内容包围盒（内容撑到第 10 行时不再从区域末尾算）', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(5, 2), '区域外内容')
    const added = doc.addRegion(2)
    expect(added).toMatchObject({ startRow: 6, endRow: 7, startCol: 0, endCol: 7 })
    expect(doc.rows).toBe(8)
    expect(doc.sheet.getDisplayValue(ADDR(5, 2))).toBe('区域外内容')
  })

  test('删除区域只删标记、画布内容保留', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(1, 0), '要保留的内容')
    doc.addRegion(3)
    doc.removeRegion(0)
    expect(doc.regions).toHaveLength(1)
    // 只删注册表项，画布内容不动
    expect(doc.sheet.getDisplayValue(ADDR(1, 0))).toBe('要保留的内容')
    // 行数由剩余区域决定（第二块 3..5 行）
    expect(doc.rows).toBe(6)
  })

  test('展开方式：down / right 各最多一个，超限抛错；展开区必须有数据源', () => {
    const doc = FormDoc.create(8)
    doc.addRegion(3)
    // 没有数据源时不允许设展开（否则份数无据可依）
    expect(() => doc.setRegionExpand(0, 'down')).toThrow('数据源')
    doc.setRegionSource(0, SOURCE)
    doc.setRegionSource(1, SOURCE)
    doc.setRegionExpand(0, 'down')
    expect(doc.regions[0]!.expand).toBe('down')
    expect(() => doc.setRegionExpand(1, 'down')).toThrow('只能有一个')
    // 另一个方向不受影响
    doc.setRegionExpand(1, 'right')
    expect(doc.regions[1]!.expand).toBe('right')
    // 改回 none：位置腾出，且这块的数据源随之丢弃（显式放弃展开驱动）
    doc.setRegionExpand(0, 'none')
    expect(doc.regions[0]!.source).toBeUndefined()
    doc.setRegionExpand(1, 'down')
    expect(doc.regions[1]!.expand).toBe('down')
  })

  test('区域数据源：先选数据源再改展开是主流程，过渡态不被其它区域操作清掉', () => {
    const doc = FormDoc.create(8)
    doc.addRegion(3)
    doc.setRegionSource(0, { datasetId: 'ds1', expression: 'rows', path: '[0].items' })
    // 此刻还没展开，source 必须留住，否则下一步设展开方式就无从校验
    expect(doc.regions[0]!.source).toEqual({
      datasetId: 'ds1',
      expression: 'rows',
      path: '[0].items',
    })
    // 别的区域的编辑不该把这个过渡态数据源顺手清掉
    doc.setRegionFields(1, { repeat: false })
    expect(doc.regions[0]!.source).toBeDefined()

    doc.setRegionExpand(0, 'down')
    expect(doc.regions[0]!.source).toBeDefined()
    // 落模板时展开区保留 source；不展开区不带 source
    const template = doc.toTemplate('t')
    expect(template.regions[0]!.source).toEqual({
      datasetId: 'ds1',
      expression: 'rows',
      path: '[0].items',
    })
    expect(template.regions[1]!.source).toBeUndefined()
  })

  test('区域改名：空白名回到缺省的「区域 N」', () => {
    const doc = FormDoc.create(8)
    doc.renameRegion(0, '  标题块  ')
    expect(doc.regions[0]!.name).toBe('标题块')
    doc.renameRegion(0, '   ')
    expect(doc.regions[0]!.name).toBeUndefined()
  })

  test('选区 → 区域：矩形规范化、默认不展开、可带名称/展开/数据源', () => {
    const doc = FormDoc.create(8)
    const region = doc.createRegionFromRange(RANGE(4, 1, 3, 3), {})
    expect(region).toEqual({
      startRow: 3,
      endRow: 4,
      startCol: 1,
      endCol: 3,
      expand: 'none',
    })
    expect(doc.regions).toHaveLength(2)
    expect(doc.rows).toBe(5)

    const named = doc.createRegionFromRange(RANGE(5, 0, 5, 2), {
      name: '明细',
      expand: 'down',
      source: SOURCE,
    })
    expect(named).toMatchObject({ name: '明细', expand: 'down', source: SOURCE })
    // 展开区缺数据源直接拒绝（不留半配状态）
    expect(() => doc.createRegionFromRange(RANGE(6, 0, 6, 2), { expand: 'down' })).toThrow('数据源')
  })

  test('选区 → 区域：任一格落在已有区域内即拒绝', () => {
    const doc = FormDoc.create(8) // 0..2 行全宽
    expect(() => doc.createRegionFromRange(RANGE(2, 0, 4, 0), {})).toThrow(
      '选区包含已有区域的单元格，无法再设为区域',
    )
    expect(doc.regions).toHaveLength(1)
  })

  test('改区域范围：无限画布不设上界，非法/重叠仍抛错，合法改动不移动内容', () => {
    const doc = FormDoc.create(8)
    doc.addRegion(3) // 3..5
    doc.sheet.setCellValue(ADDR(4, 0), '第二块内容')
    // 重叠：第一块吃到 3 行就与第二块 3..5 撞上
    expect(() => doc.setRegionFields(0, { endRow: 3 })).toThrow('重叠')
    // 起点 > 终点
    expect(() => doc.setRegionFields(0, { startRow: 2, endRow: 1 })).toThrow('非法')
    // 负坐标
    expect(() => doc.setRegionFields(0, { startCol: -1 })).toThrow('非法')
    // 合法：缩小列范围
    doc.setRegionFields(0, { endCol: 3 })
    expect(doc.regions[0]!.endCol).toBe(3)
    expect(doc.sheet.getDisplayValue(ADDR(4, 0))).toBe('第二块内容')
  })

  test('改区域范围：可以把区域拉到远超当前内容的行（无限画布无尺寸上界）', () => {
    const doc = FormDoc.create(8)
    doc.setRegionFields(0, { endRow: 49 })
    expect(doc.regions[0]!.endRow).toBe(49)
    expect(doc.rows).toBe(50)
  })

  test('调整区域行数：变高底部插行、变矮删底行；与下方区域重叠时抛错', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(0, 0), '首行')
    doc.sheet.setCellValue(ADDR(2, 0), '区域尾行')
    doc.addRegion(3) // 3..5
    doc.sheet.setCellValue(ADDR(4, 0), '第二块')

    doc.resizeRegionRows(0, 5) // 3 → 5 行
    expect(doc.rows).toBe(8)
    expect(doc.regions[0]).toMatchObject({ startRow: 0, endRow: 4 })
    // 下方区域整体下移 2 行
    expect(doc.regions[1]).toMatchObject({ startRow: 5, endRow: 7 })
    // 内容留在原处
    expect(doc.sheet.getDisplayValue(ADDR(0, 0))).toBe('首行')
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBe('区域尾行')
    expect(doc.sheet.getDisplayValue(ADDR(6, 0))).toBe('第二块')

    // 撤销回到原状
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(6)
    expect(doc.regions[0]).toMatchObject({ startRow: 0, endRow: 2 })
    expect(doc.regions[1]).toMatchObject({ startRow: 3, endRow: 5 })
  })

  test('行数不变或小于 1 时不做任何改动（不入撤销链）', () => {
    const doc = FormDoc.create(8)
    const before = JSON.stringify(doc.regions)
    doc.resizeRegionRows(0, 3) // 与当前相同
    doc.resizeRegionRows(0, 0) // 非法
    expect(JSON.stringify(doc.regions)).toBe(before)
    expect(doc.history.canUndo).toBe(false)
  })
})

describe('内容包围盒驱动的画布尺寸', () => {
  test('行列数不再看引擎扩容：快照声明 100 行也只按内容算', () => {
    const doc = FormDoc.create(8)
    doc.sheet.ensureTableSize(100, 26)
    doc.sheet.setCellValue(ADDR(4, 3), '右下角')
    expect(doc.rows).toBe(5)
    expect(doc.cols).toBe(8)
  })

  test('空内容回落 1 行 1 列（不返回 0）', () => {
    const doc = FormDoc.fromTemplate({
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      name: 't',
      regions: [],
      sheet: { cells: [], styles: [], merges: [], frozen: { rows: 0, cols: 0 }, rows: 0, cols: 0 },
    })
    expect(doc.regions).toEqual([])
    expect(doc.rows).toBe(1)
    expect(doc.cols).toBe(1)
  })

  test('toTemplate 把 sheet 行列收紧到包围盒（模板不留扩容噪声）', () => {
    const doc = FormDoc.create(8)
    doc.sheet.ensureTableSize(120, 30)
    const template = doc.toTemplate('t')
    expect(template.sheet.rows).toBe(3)
    expect(template.sheet.cols).toBe(8)
  })
})

describe('统一撤销链（区域结构 × 样式命令交错）', () => {
  test('样式命令：setCellStyle / 合并 / 值写入均可撤销重做', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 1), { fill: { color: '#ff0000' } })
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.fill?.color).toBe('#ff0000')
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.fill?.color).toBeUndefined()
    expect(doc.history.redo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.fill?.color).toBe('#ff0000')

    doc.sheet.mergeCells(RANGE(0, 0, 0, 3))
    expect(doc.sheet.getCellInfo(ADDR(0, 2)).kind).toBe('merged-covered')
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getCellInfo(ADDR(0, 2)).kind).toBe('normal')

    doc.sheet.setCellValue(ADDR(1, 1), 42)
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getDisplayValue(ADDR(1, 1))).toBeUndefined()
  })

  test('区域增删/改展开方式：快照条目撤销与重做完整还原', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(2, 0), '首块尾行')
    doc.addRegion(3) // 3..5，行数 3 → 6
    expect(doc.rows).toBe(6)
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(3)
    expect(doc.regions).toHaveLength(1)
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBe('首块尾行')
    expect(doc.history.redo()).toBe(true)
    expect(doc.rows).toBe(6)
    expect(doc.regions).toHaveLength(2)

    doc.setRegionSource(0, SOURCE)
    doc.setRegionExpand(0, 'down')
    expect(doc.regions[0]!.expand).toBe('down')
    expect(doc.history.undo()).toBe(true)
    expect(doc.regions[0]!.expand).toBe('none')
    expect(doc.history.redo()).toBe(true)
    expect(doc.regions[0]!.expand).toBe('down')
  })

  test('选区建区 / 改名可撤销重做', () => {
    const doc = FormDoc.create(8)
    doc.createRegionFromRange(RANGE(4, 0, 5, 2), { name: '明细' })
    expect(doc.regions).toHaveLength(2)
    expect(doc.history.undo()).toBe(true)
    expect(doc.regions).toHaveLength(1)
    expect(doc.history.redo()).toBe(true)

    doc.renameRegion(1, '合计')
    expect(doc.regions[1]!.name).toBe('合计')
    expect(doc.history.undo()).toBe(true)
    expect(doc.regions[1]!.name).toBe('明细')
  })

  test('区域撤销/重做补发 regions-change（面板与画布同步信号）', () => {
    const doc = FormDoc.create(8)
    let fired = 0
    doc.on('regions-change', () => {
      fired += 1
    })
    doc.addRegion(3)
    expect(fired).toBe(1)
    doc.history.undo()
    expect(fired).toBe(2)
    doc.history.redo()
    expect(fired).toBe(3)
    // 行高编辑不改区域，撤销不应发 regions-change
    doc.setRowHeight(0, 40)
    doc.history.undo()
    expect(fired).toBe(3)
  })

  test('交错链：样式命令 → 区域操作 → 逐层撤销 → 逐层重做', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 0), { font: { bold: true } })
    doc.addRegion(3)
    doc.sheet.setCellValue(ADDR(0, 1), '画布键入')
    // 撤销顺序：键入 → 加区域 → 样式
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getDisplayValue(ADDR(0, 1))).toBeUndefined()
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(3)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBe(true)
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBeUndefined()
    expect(doc.history.undo()).toBe(false)
    // 重做逆序：样式 → 加区域 → 键入
    expect(doc.history.redo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBe(true)
    expect(doc.history.redo()).toBe(true)
    expect(doc.rows).toBe(6)
    expect(doc.history.redo()).toBe(true)
    expect(doc.sheet.getDisplayValue(ADDR(0, 1))).toBe('画布键入')
    expect(doc.history.redo()).toBe(false)
  })

  test('新编辑清空重做链（工具栏与画布键入同待遇）', () => {
    const doc = FormDoc.create(8)
    doc.addRegion(3)
    expect(doc.history.undo()).toBe(true)
    expect(doc.history.canRedo).toBe(true)
    doc.sheet.setCellValue(ADDR(0, 0), '新编辑')
    expect(doc.history.canRedo).toBe(false)
    expect(doc.history.redo()).toBe(false)
  })

  test('行高列宽编辑可撤销（sheet 不进 undo 的部分由快照条目补齐）', () => {
    const doc = FormDoc.create(8)
    doc.setRowHeight(0, 48)
    doc.setColWidth(0, 160)
    expect(doc.sheet.getRowHeight(0)).toBe(48)
    expect(doc.sheet.getColWidth(0)).toBe(160)
    expect(doc.history.undo()).toBe(true) // 撤销列宽
    expect(doc.sheet.getColWidth(0)).toBeUndefined()
    expect(doc.sheet.getRowHeight(0)).toBe(48)
    expect(doc.history.undo()).toBe(true) // 撤销行高
    expect(doc.sheet.getRowHeight(0)).toBeUndefined()
    expect(doc.history.redo()).toBe(true)
    expect(doc.sheet.getRowHeight(0)).toBe(48)
  })
})

describe('绑定 sidecar 与占位符（配置态）', () => {
  test('绑定写入经 cell-meta 命令，可撤销；调整区域行数后绑定随行平移', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    expect(doc.sheet.getCellMeta(ADDR(2, 0), FORM_BINDING_META_NAMESPACE)).toEqual({
      datasetId: 'ds1',
      path: 'items[].name',
    })
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellBinding(ADDR(2, 0))).toBeUndefined()

    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    doc.addRegion(3) // 追加区域不改既有行号
    doc.setRowHeight(0, 40)
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('items[].name')
  })

  test('展开区内的相对绑定：落盘形态只有 path（继承区域 source）', () => {
    const doc = FormDoc.create(8)
    doc.setRegionSource(0, SOURCE)
    doc.setRegionExpand(0, 'down')
    doc.setCellBinding(ADDR(1, 2), { path: 'item_name' } as never)
    const payload = doc.sheet.getCellMeta(ADDR(1, 2), FORM_BINDING_META_NAMESPACE)
    expect(payload).toEqual({ path: 'item_name' })
    expect(formatBindingPlaceholder(doc.getCellBinding(ADDR(1, 2))!)).toBe('{{item_name}}')
  })

  test('占位符推导：路径与聚合形态', () => {
    expect(formatBindingPlaceholder({ datasetId: 'ds1', path: 'customer.name' })).toBe(
      '{{customer.name}}',
    )
    expect(
      formatBindingPlaceholder({ datasetId: 'ds1', path: 'items[].amount', aggregate: 'sum' }),
    ).toBe('{{sum:items[].amount}}')
  })

  test('配置态口径：绑定格存储值保持空（占位符只是显示层）', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'total' })
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBeUndefined()
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('total')
  })
})
