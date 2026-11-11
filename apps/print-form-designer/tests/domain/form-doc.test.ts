// 模型层 headless 测试（v4）：数据块结构操作（含选区建块守卫、数据源绑定与绑定清除）、
// 内容包围盒驱动的行列尺寸、格样式命令与快照条目的统一撤销链路、绑定/函数 sidecar
// 形状与占位符推导、重命名联动改写引用。模板序列化在 shared/template-schema.test.ts。
import { describe, expect, test } from 'vitest'

import { FormDoc } from '../../src/domain/form-doc'
import {
  FORM_BINDING_META_NAMESPACE,
  FORM_FUNCTION_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  formatBindingPlaceholder,
  formatFunctionPlaceholder,
  regionsAt,
} from '../../src/shared/template-schema'
import { ADDR, RANGE } from '../designer/testing/fixtures'

/** 明细展开源（展开区必须带 source，测试里统一用它） */
const SOURCE = { kind: 'dataset', datasetId: 'ds1', path: '' } as const

describe('默认文档与数据块结构', () => {
  test('空白文档只有一个全宽数据块（0..2 行）', () => {
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

  test('追加数据块：在内容包围盒最下方、全宽、既有内容不动', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(0, 0), '标题')
    doc.addRegion(3) // 默认 3 行
    expect(doc.regions).toHaveLength(2)
    expect(doc.rows).toBe(6)
    expect(doc.regions[1]).toEqual({
      startRow: 3,
      endRow: 5,
      startCol: 0,
      endCol: 7,
      expand: 'none',
    })
    expect(doc.sheet.getDisplayValue(ADDR(0, 0))).toBe('标题')
  })

  test('删除数据块只删标记、画布内容保留，但数据块内绑定一并清除', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(1, 0), '要保留的内容')
    doc.setRegionSource(0, SOURCE)
    doc.setCellBinding(ADDR(1, 0), { path: 'name' })
    doc.addRegion(3)
    doc.removeRegion(0)
    expect(doc.regions).toHaveLength(1)
    // 只删注册表项，画布内容不动；绑定以数据块为归属，随数据块清除
    expect(doc.sheet.getDisplayValue(ADDR(1, 0))).toBe('要保留的内容')
    expect(doc.getCellBinding(ADDR(1, 0))).toBeUndefined()
    // 行数由剩余数据块决定（第二块 3..5 行）
    expect(doc.rows).toBe(6)
  })

  test('展开方式：down / right 各最多一个，超限抛错；数据源可后绑', () => {
    const doc = FormDoc.create(8)
    doc.addRegion(3)
    // 展开未绑源是合法中间态：先设展开、后绑数据源
    doc.setRegionExpand(0, 'down')
    expect(doc.regions[0]!.expand).toBe('down')
    expect(doc.regions[0]!.source).toBeUndefined()
    doc.setRegionSource(0, SOURCE)
    doc.setRegionSource(1, SOURCE)
    expect(() => doc.setRegionExpand(1, 'down')).toThrow('只能有一个')
    // 另一个方向不受影响
    doc.setRegionExpand(1, 'right')
    expect(doc.regions[1]!.expand).toBe('right')
    // v4：改回 none **保留**数据源（不展开 + 带源 = 静态取第 1 条）
    doc.setRegionExpand(0, 'none')
    expect(doc.regions[0]!.source).toBeDefined()
    doc.setRegionExpand(1, 'down')
    expect(doc.regions[1]!.expand).toBe('down')
  })

  test('离开 down 时分组与行角色随之清除（数据源保留）', () => {
    const doc = FormDoc.create(8)
    doc.setRegionSource(0, SOURCE)
    doc.setRegionExpand(0, 'down')
    doc.setRegionGroupBy(0, ['customer'])
    doc.setRegionRowRole(0, 1, 'groupFooter')
    expect(doc.regions[0]!.groupBy).toEqual(['customer'])
    doc.setRegionExpand(0, 'none')
    expect(doc.regions[0]!.groupBy).toBeUndefined()
    expect(doc.regions[0]!.rowRoles).toBeUndefined()
    expect(doc.regions[0]!.source).toBeDefined()
  })

  test('数据块数据源：先选数据源再改展开是主流程，过渡态不被其它数据块操作清掉', () => {
    const doc = FormDoc.create(8)
    doc.addRegion(3)
    doc.setRegionSource(0, {
      kind: 'dataset',
      datasetId: 'ds1',
      expression: 'rows',
      path: '[0].items',
    })
    // 此刻还没展开，source 必须留住（设顺序随意，绑好的源不能被其它操作顺手清掉）
    expect(doc.regions[0]!.source).toEqual({
      kind: 'dataset',
      datasetId: 'ds1',
      expression: 'rows',
      path: '[0].items',
    })
    // 别的数据块的编辑不该把这个过渡态数据源顺手清掉
    doc.setRegionFields(1, {})
    expect(doc.regions[0]!.source).toBeDefined()

    doc.setRegionExpand(0, 'down')
    expect(doc.regions[0]!.source).toBeDefined()
    // v4：落模板时任何数据块的 source 都保留（不展开的数据块 = 静态取第 1 条）
    const template = doc.toTemplate('t')
    expect(template.regions[0]!.source).toEqual({
      kind: 'dataset',
      datasetId: 'ds1',
      expression: 'rows',
      path: '[0].items',
    })
  })

  test('清空数据源：数据块内绑定一并清除（绑定以数据源为归属）', () => {
    const doc = FormDoc.create(8)
    doc.setRegionSource(0, SOURCE)
    doc.setCellBinding(ADDR(0, 0), { path: 'a' })
    doc.setCellBinding(ADDR(2, 1), { path: 'b' })
    // 数据块外（第 5 行）的函数不受影响
    doc.setCellFunction(ADDR(5, 0), { expression: '1' })
    doc.setRegionSource(0, undefined)
    expect(doc.regions[0]!.source).toBeUndefined()
    expect(doc.getCellBinding(ADDR(0, 0))).toBeUndefined()
    expect(doc.getCellBinding(ADDR(2, 1))).toBeUndefined()
    expect(doc.getCellFunction(ADDR(5, 0))).toBeDefined()
  })

  test('清空展开中数据块的数据源：展开方式保留（合法中间态），绑定随之清除', () => {
    const doc = FormDoc.create(8)
    doc.setRegionExpand(0, 'down')
    doc.setRegionSource(0, SOURCE)
    doc.setCellBinding(ADDR(0, 0), { path: 'a' })
    doc.setRegionSource(0, undefined)
    expect(doc.regions[0]!.expand).toBe('down')
    expect(doc.regions[0]!.source).toBeUndefined()
    expect(doc.getCellBinding(ADDR(0, 0))).toBeUndefined()
  })

  test('清源/删数据块只清相对绑定：聚合引用绑定保留（不以数据块为归属）', () => {
    const doc = FormDoc.create(8)
    doc.setRegionSource(0, SOURCE)
    doc.setCellBinding(ADDR(0, 0), { path: 'a' })
    doc.setCellBinding(ADDR(0, 1), { kind: 'agg', aggName: 'head', path: 'title' })
    doc.setRegionSource(0, undefined)
    expect(doc.getCellBinding(ADDR(0, 0))).toBeUndefined()
    expect(doc.getCellBinding(ADDR(0, 1))).toEqual({ kind: 'agg', aggName: 'head', path: 'title' })
  })

  test('数据块改名：空白名回到缺省的「数据块 N」', () => {
    const doc = FormDoc.create(8)
    doc.renameRegion(0, '  标题块  ')
    expect(doc.regions[0]!.name).toBe('标题块')
    doc.renameRegion(0, '   ')
    expect(doc.regions[0]!.name).toBeUndefined()
  })

  test('选区 → 数据块：矩形规范化、默认不展开、可带名称/展开/数据源', () => {
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
    // 展开未绑源是合法中间态：建区时可以先设展开、数据源后绑
    const bare = doc.createRegionFromRange(RANGE(6, 0, 6, 2), { expand: 'down' })
    expect(bare).toMatchObject({ expand: 'down' })
    expect(bare.source).toBeUndefined()
  })

  test('选区 → 数据块守卫：重叠拒绝、选区含绑定格拒绝', () => {
    const doc = FormDoc.create(8) // 0..2 行全宽
    expect(() => doc.createRegionFromRange(RANGE(2, 0, 4, 0), {})).toThrow(
      '选区包含已有数据块的单元格，无法再设为数据块',
    )
    // 数据块外有绑定格的选区也要拒绝——但 v4 里绑定格只可能在数据块内，
    // 构造方式：先删数据块（绑定会被清）不成立，改为直接绕过守卫写 sidecar
    doc.sheet.setCellMeta(ADDR(6, 0), FORM_BINDING_META_NAMESPACE, { path: 'x' })
    expect(() => doc.createRegionFromRange(RANGE(5, 0, 7, 1), {})).toThrow('绑定字段的单元格')
    expect(doc.regions).toHaveLength(1)
  })

  test('改数据块范围：无限画布不设上界，非法/重叠仍抛错，合法改动不移动内容', () => {
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

  test('改数据块范围守卫：缩小不得把绑定格挤出数据块', () => {
    const doc = FormDoc.create(8)
    doc.setRegionSource(0, SOURCE)
    doc.setCellBinding(ADDR(0, 0), { path: 'a' })
    expect(() => doc.setRegionFields(0, { startRow: 1 })).toThrow('挤出了数据块')
    // 扩大不受影响
    doc.setRegionFields(0, { endRow: 4 })
    // 列方向把绑定格挤出同样拒绝
    expect(() => doc.setRegionFields(0, { startCol: 1 })).toThrow('挤出了数据块')
    expect(doc.getCellBinding(ADDR(0, 0))).toBeDefined()
  })

  test('调整数据块行数：变高底部插行、变矮删底行；与下方数据块重叠时抛错', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellValue(ADDR(0, 0), '首行')
    doc.sheet.setCellValue(ADDR(2, 0), '数据块尾行')
    doc.addRegion(3) // 3..5
    doc.sheet.setCellValue(ADDR(4, 0), '第二块')

    doc.resizeRegionRows(0, 5) // 3 → 5 行
    expect(doc.rows).toBe(8)
    expect(doc.regions[0]).toMatchObject({ startRow: 0, endRow: 4 })
    // 下方数据块整体下移 2 行
    expect(doc.regions[1]).toMatchObject({ startRow: 5, endRow: 7 })
    // 内容留在原处
    expect(doc.sheet.getDisplayValue(ADDR(0, 0))).toBe('首行')
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBe('数据块尾行')
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

describe('分组典型布局自动预填', () => {
  /** 造一个 n 行的 down 数据块（默认文档 0..2 行 → 调整行数后设为向下展开） */
  const downDoc = (rows: number): FormDoc => {
    const doc = FormDoc.create(8)
    doc.resizeRegionRows(0, rows)
    doc.setRegionExpand(0, 'down')
    return doc
  }

  test('0 → ≥1 且角色全默认：首行组头、倒数第 2 行小计（≥4 行）、末行合计', () => {
    const doc = downDoc(5) // 0..4
    doc.setRegionGroupBy(0, ['customer'])
    expect(doc.regions[0]!.groupBy).toEqual(['customer'])
    expect(doc.regions[0]!.rowRoles).toEqual([
      { row: 0, role: 'groupHeader' },
      { row: 3, role: 'groupFooter' },
      { row: 4, role: 'summary' },
    ])
  })

  test('行数不足降级：3 行 → 组头+明细+合计；2 行 → 组头+合计；1 行 → 仅组头', () => {
    const three = downDoc(3)
    three.setRegionGroupBy(0, ['customer'])
    expect(three.regions[0]!.rowRoles).toEqual([
      { row: 0, role: 'groupHeader' },
      { row: 2, role: 'summary' },
    ])

    const two = downDoc(2)
    two.setRegionGroupBy(0, ['customer'])
    expect(two.regions[0]!.rowRoles).toEqual([
      { row: 0, role: 'groupHeader' },
      { row: 1, role: 'summary' },
    ])

    const one = downDoc(1)
    one.setRegionGroupBy(0, ['customer'])
    expect(one.regions[0]!.rowRoles).toEqual([{ row: 0, role: 'groupHeader' }])
  })

  test('已手动配过角色则不预填（覆盖）', () => {
    const doc = downDoc(5)
    doc.setRegionRowRole(0, 4, 'summary')
    doc.setRegionGroupBy(0, ['customer'])
    expect(doc.regions[0]!.rowRoles).toEqual([{ row: 4, role: 'summary' }])
  })

  test('预填与分组字段同属一次撤销：一次 undo 一并回滚，redo 一并恢复', () => {
    const doc = downDoc(5)
    doc.setRegionGroupBy(0, ['customer'])
    expect(doc.history.undo()).toBe(true)
    expect(doc.regions[0]!.groupBy).toBeUndefined()
    expect(doc.regions[0]!.rowRoles).toBeUndefined()
    expect(doc.history.redo()).toBe(true)
    expect(doc.regions[0]!.groupBy).toEqual(['customer'])
    expect(doc.regions[0]!.rowRoles).toEqual([
      { row: 0, role: 'groupHeader' },
      { row: 3, role: 'groupFooter' },
      { row: 4, role: 'summary' },
    ])
  })

  test('再次改分组字段不重复预填（手动改动保留）', () => {
    const doc = downDoc(5)
    doc.setRegionGroupBy(0, ['customer']) // 预填
    doc.setRegionRowRole(0, 0, 'detail') // 手动改回首行明细
    doc.setRegionGroupBy(0, ['customer', 'month']) // 1 → 2：不再预填
    expect(doc.regions[0]!.groupBy).toEqual(['customer', 'month'])
    expect(doc.regions[0]!.rowRoles).toEqual([
      { row: 3, role: 'groupFooter' },
      { row: 4, role: 'summary' },
    ])
  })

  test('清空分组字段：组头/小计随之剔除（合计保留），回全默认后可再次预填', () => {
    const doc = downDoc(5)
    doc.setRegionGroupBy(0, ['customer']) // 预填
    doc.setRegionGroupBy(0, undefined) // 清空：不再被「必须先配置分组字段」卡住
    expect(doc.regions[0]!.groupBy).toBeUndefined()
    expect(doc.regions[0]!.rowRoles).toEqual([{ row: 4, role: 'summary' }])
    doc.setRegionRowRole(0, 4, 'detail') // 回到全默认
    doc.setRegionGroupBy(0, ['shop']) // 0 → 1：重新预填
    expect(doc.regions[0]!.rowRoles).toEqual([
      { row: 0, role: 'groupHeader' },
      { row: 3, role: 'groupFooter' },
      { row: 4, role: 'summary' },
    ])
  })
})

describe('重命名联动改写引用', () => {
  test('renameRegion：函数表达式里的字符串引用同步改写（含撤销）', () => {
    const doc = FormDoc.create(8)
    doc.renameRegion(0, '明细')
    doc.setCellFunction(ADDR(4, 0), { expression: "SUM('明细', 'qty') + agg.x" })
    doc.renameRegion(0, '货品')
    expect(doc.getCellFunction(ADDR(4, 0))).toMatchObject({
      kind: 'expr',
      expression: "SUM('货品', 'qty') + agg.x",
    })
    // 撤销重命名连带改写一起回滚
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellFunction(ADDR(4, 0))).toMatchObject({
      kind: 'expr',
      expression: "SUM('明细', 'qty') + agg.x",
    })
    // 引用名撞车（与另一数据块的引用名相同）会被拒绝
    doc.addRegion(2)
    expect(() => doc.renameRegion(1, '明细')).toThrow('引用名重复')
  })

  test('renameRegion：结构化 fn 的 region 字段同步改写（GROUP 不带数据块参数不受影响）', () => {
    const doc = FormDoc.create(8)
    doc.renameRegion(0, '明细')
    doc.setCellFunction(ADDR(4, 0), { kind: 'fn', fn: 'SUM', region: '明细', field: 'qty' })
    doc.setCellFunction(ADDR(4, 1), { kind: 'fn', fn: 'GROUP' })
    doc.renameRegion(0, '货品')
    expect(doc.getCellFunction(ADDR(4, 0))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '货品',
      field: 'qty',
    })
    expect(doc.getCellFunction(ADDR(4, 1))).toEqual({ kind: 'fn', fn: 'GROUP' })
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellFunction(ADDR(4, 0))).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '明细',
      field: 'qty',
    })
  })

  test('renameAggregation：数据块 agg 数据源、函数与聚合引用绑定里的 agg.old 同步改写（含撤销）', () => {
    const doc = FormDoc.create(8)
    doc.setAggregations([
      {
        name: 'summary',
        type: 'array',
        params: [{ datasetId: 'd1', varName: 'r' }],
        expression: 'return r',
      },
    ])
    doc.setRegionSource(0, { kind: 'agg', aggName: 'summary', path: '' })
    doc.setCellFunction(ADDR(4, 0), { expression: "agg['summary'] + 1" })
    doc.setCellBinding(ADDR(4, 1), { kind: 'agg', aggName: 'summary', path: '' })
    doc.setCellBinding(ADDR(4, 2), { kind: 'agg', aggName: 'summary', path: 'total' })
    doc.setCellBinding(ADDR(4, 3), { path: 'summary' }) // 相对绑定同名不受影响
    doc.renameAggregation('summary', 'totals')
    expect(doc.aggregations[0]!.name).toBe('totals')
    expect(doc.regions[0]!.source).toMatchObject({ kind: 'agg', aggName: 'totals' })
    expect(doc.getCellFunction(ADDR(4, 0))).toMatchObject({
      kind: 'expr',
      expression: "agg['totals'] + 1",
    })
    expect(doc.getCellBinding(ADDR(4, 1))).toEqual({ kind: 'agg', aggName: 'totals', path: '' })
    expect(doc.getCellBinding(ADDR(4, 2))).toEqual({
      kind: 'agg',
      aggName: 'totals',
      path: 'total',
    })
    expect(doc.getCellBinding(ADDR(4, 3))).toEqual({ path: 'summary' })
    // 撤销重命名：绑定里的聚合名随快照条目一并回滚
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellBinding(ADDR(4, 1))).toEqual({ kind: 'agg', aggName: 'summary', path: '' })
    expect(doc.getCellBinding(ADDR(4, 2))).toEqual({
      kind: 'agg',
      aggName: 'summary',
      path: 'total',
    })
  })

  test('setAggregations：删除被数据块数据源引用的聚合会被拒绝', () => {
    const doc = FormDoc.create(8)
    doc.setAggregations([
      {
        name: 'a',
        type: 'array',
        params: [{ datasetId: 'd1', varName: 'r' }],
        expression: 'return r',
      },
    ])
    doc.setRegionSource(0, { kind: 'agg', aggName: 'a', path: '' })
    expect(() => doc.setAggregations([])).toThrow('聚合不存在')
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
      aggregations: [],
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

describe('统一撤销链（数据块结构 × 样式命令交错）', () => {
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

  test('数据块增删/改展开方式：快照条目撤销与重做完整还原', () => {
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

  test('聚合编辑可撤销重做（快照条目补发 aggregations-change）', () => {
    const doc = FormDoc.create(8)
    let fired = 0
    doc.on('aggregations-change', () => {
      fired += 1
    })
    doc.setAggregations([
      {
        name: 'a',
        type: 'array',
        params: [{ datasetId: 'd1', varName: 'r' }],
        expression: 'return r',
      },
    ])
    expect(doc.aggregations).toHaveLength(1)
    expect(fired).toBe(1)
    expect(doc.history.undo()).toBe(true)
    expect(doc.aggregations).toHaveLength(0)
    expect(fired).toBe(2)
    expect(doc.history.redo()).toBe(true)
    expect(doc.aggregations).toHaveLength(1)
  })

  test('数据块撤销/重做补发 regions-change（面板与画布同步信号）', () => {
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
    // 行高编辑不改数据块，撤销不应发 regions-change
    doc.setRowHeight(0, 40)
    doc.history.undo()
    expect(fired).toBe(3)
  })

  test('交错链：样式命令 → 数据块操作 → 逐层撤销 → 逐层重做', () => {
    const doc = FormDoc.create(8)
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 0), { font: { bold: true } })
    doc.addRegion(3)
    doc.sheet.setCellValue(ADDR(0, 1), '画布键入')
    // 撤销顺序：键入 → 加数据块 → 样式
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getDisplayValue(ADDR(0, 1))).toBeUndefined()
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(3)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBe(true)
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBeUndefined()
    expect(doc.history.undo()).toBe(false)
    // 重做逆序：样式 → 加数据块 → 键入
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

describe('绑定/函数 sidecar 与占位符（配置态）', () => {
  test('绑定写入经 cell-meta 命令，可撤销；追加数据块不改既有行号', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(2, 0), { path: 'items.name' })
    expect(doc.sheet.getCellMeta(ADDR(2, 0), FORM_BINDING_META_NAMESPACE)).toEqual({
      path: 'items.name',
    })
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellBinding(ADDR(2, 0))).toBeUndefined()

    doc.setCellBinding(ADDR(2, 0), { path: 'items.name' })
    doc.addRegion(3) // 追加数据块不改既有行号
    doc.setRowHeight(0, 40)
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('items.name')
  })

  test('绑定只有 path；函数 sidecar 独立命名空间且可撤销', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(1, 2), { path: 'item_name' })
    const payload = doc.sheet.getCellMeta(ADDR(1, 2), FORM_BINDING_META_NAMESPACE)
    expect(payload).toEqual({ path: 'item_name' })
    expect(formatBindingPlaceholder(doc.getCellBinding(ADDR(1, 2))!)).toBe('{{item_name}}')

    doc.setCellFunction(ADDR(2, 2), { expression: "SUM('数据块 1')" })
    expect(doc.sheet.getCellMeta(ADDR(2, 2), FORM_FUNCTION_META_NAMESPACE)).toEqual({
      kind: 'fn',
      fn: 'SUM',
      region: '数据块 1',
    })
    expect(formatFunctionPlaceholder(doc.getCellFunction(ADDR(2, 2))!)).toBe("{{SUM('数据块 1')}}")
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellFunction(ADDR(2, 2))).toBeUndefined()
  })

  test('setCellFunction 新形状：结构化 fn 原样落 sidecar，旧表达式写入即嗅探', () => {
    const doc = FormDoc.create(8)
    doc.setCellFunction(ADDR(0, 0), {
      kind: 'fn',
      fn: 'SUBTOTAL',
      region: '数据块 1',
      field: 'qty',
    })
    expect(doc.sheet.getCellMeta(ADDR(0, 0), FORM_FUNCTION_META_NAMESPACE)).toEqual({
      kind: 'fn',
      fn: 'SUBTOTAL',
      region: '数据块 1',
      field: 'qty',
    })
    doc.setCellFunction(ADDR(1, 0), { kind: 'expr', expression: 'item.qty * item.price' })
    expect(doc.getCellFunction(ADDR(1, 0))).toEqual({
      kind: 'expr',
      expression: 'item.qty * item.price',
    })
    // 旧表达式形状（v5 早期载荷）写入时嗅探转换，文档内不留旧形状
    doc.setCellFunction(ADDR(2, 0), { expression: "COUNT('数据块 1')" })
    expect(doc.getCellFunction(ADDR(2, 0))).toEqual({ kind: 'fn', fn: 'COUNT', region: '数据块 1' })
  })

  test('绑定与函数互斥对新形状同样成立：写结构化函数清绑定、写绑定清函数', () => {
    const doc = FormDoc.create(8)
    doc.setCellFunction(ADDR(0, 0), { kind: 'fn', fn: 'SUM', region: '数据块 1' })
    doc.setCellBinding(ADDR(0, 0), { path: 'name' })
    expect(doc.getCellFunction(ADDR(0, 0))).toBeUndefined()
    doc.setCellFunction(ADDR(0, 0), { kind: 'fn', fn: 'SUM', region: '数据块 1' })
    expect(doc.getCellBinding(ADDR(0, 0))).toBeUndefined()
    expect(doc.getCellFunction(ADDR(0, 0))).toEqual({ kind: 'fn', fn: 'SUM', region: '数据块 1' })
  })

  test('配置态口径：绑定/函数格存储值保持空（占位符只是显示层）', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(2, 0), { path: 'total' })
    doc.setCellFunction(ADDR(3, 0), { expression: '1 + 1' })
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBeUndefined()
    expect(doc.sheet.getDisplayValue(ADDR(3, 0))).toBeUndefined()
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('total')
  })
})
