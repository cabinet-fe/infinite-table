// 模型层 headless 测试：区域结构操作、格样式命令与快照条目的统一撤销链路、
// 模板 JSON 序列化 round-trip（含 v1→v2 迁移）、绑定 sidecar 形状与占位符推导。
import { describe, expect, test } from 'bun:test'

import {
  FORM_BINDING_META_NAMESPACE,
  TEMPLATE_SCHEMA_VERSION,
  formatBindingPlaceholder,
  regionsAt,
  templateRows,
  type FormTemplate,
} from '../../src/designer/template'
import { FormDoc } from '../../src/designer/form-doc'

const ADDR = (row: number, col: number) => ({ row, col })
const RANGE = (r1: number, c1: number, r2: number, c2: number) => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 },
})

describe('默认文档与区域结构', () => {
  test('空白文档只有一个全宽区域（0..2 行），不再是五类骨架', () => {
    const doc = FormDoc.create()
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
    expect(doc.effectiveCols).toBe(8)
    expect(regionsAt(doc.regions, 0, 0)).toBe(doc.regions[0])
    expect(regionsAt(doc.regions, 3, 0)).toBeUndefined()
  })

  test('添加区域：追加在最下方、全宽、既有内容不动', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(0, 0), '标题')
    const added = doc.addRegion() // 默认 3 行
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

  test('删除区域只删标记、画布内容保留', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(1, 0), '要保留的内容')
    doc.addRegion()
    doc.removeRegion(0)
    expect(doc.regions).toHaveLength(1)
    // 内容不会被删（这是与旧 removeBand 的关键差别）
    expect(doc.sheet.getDisplayValue(ADDR(1, 0))).toBe('要保留的内容')
    // 行数由剩余区域决定（第二块 3..5 行）
    expect(doc.rows).toBe(6)
  })

  test('展开方式：down / right 各最多一个，超限抛错', () => {
    const doc = FormDoc.create()
    doc.addRegion()
    doc.setRegionExpand(0, 'down')
    expect(doc.regions[0]!.expand).toBe('down')
    expect(() => doc.setRegionExpand(1, 'down')).toThrow('只能有一个')
    // 另一个方向不受影响
    doc.setRegionExpand(1, 'right')
    expect(doc.regions[1]!.expand).toBe('right')
    // 改回 none 后位置腾出
    doc.setRegionExpand(0, 'none')
    doc.setRegionExpand(1, 'down')
    expect(doc.regions[1]!.expand).toBe('down')
  })

  test('改区域范围：越界与重叠都抛错，合法改动不移动内容', () => {
    const doc = FormDoc.create()
    doc.addRegion() // 3..5
    doc.sheet.setCellValue(ADDR(4, 0), '第二块内容')
    // 越界：endRow 超过表格末行
    expect(() => doc.setRegionFields(0, { endRow: 99 })).toThrow('越界')
    // 重叠：第一块吃到 3 行就与第二块 3..5 撞上
    expect(() => doc.setRegionFields(0, { endRow: 3 })).toThrow('重叠')
    // 起点 > 终点
    expect(() => doc.setRegionFields(0, { startRow: 2, endRow: 1 })).toThrow('非法')
    // 合法：缩小列范围
    doc.setRegionFields(0, { endCol: 3 })
    expect(doc.regions[0]!.endCol).toBe(3)
    expect(doc.sheet.getDisplayValue(ADDR(4, 0))).toBe('第二块内容')
  })

  test('调整区域行数：变高底部插行、变矮删底行；与下方区域重叠时抛错', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(0, 0), '首行')
    doc.sheet.setCellValue(ADDR(2, 0), '区域尾行')
    doc.addRegion() // 3..5
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
    const doc = FormDoc.create()
    const before = JSON.stringify(doc.regions)
    doc.resizeRegionRows(0, 3) // 与当前相同
    doc.resizeRegionRows(0, 0) // 非法
    expect(JSON.stringify(doc.regions)).toBe(before)
    expect(doc.history.canUndo).toBe(false)
  })
})

describe('统一撤销链（区域结构 × 样式命令交错）', () => {
  test('样式命令：setCellStyle / 合并 / 值写入均可撤销重做', () => {
    const doc = FormDoc.create()
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
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(2, 0), '首块尾行')
    doc.addRegion() // 3..5，行数 3 → 6
    expect(doc.rows).toBe(6)
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(3)
    expect(doc.regions).toHaveLength(1)
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBe('首块尾行')
    expect(doc.history.redo()).toBe(true)
    expect(doc.rows).toBe(6)
    expect(doc.regions).toHaveLength(2)

    doc.setRegionExpand(0, 'down')
    expect(doc.regions[0]!.expand).toBe('down')
    expect(doc.history.undo()).toBe(true)
    expect(doc.regions[0]!.expand).toBe('none')
    expect(doc.history.redo()).toBe(true)
    expect(doc.regions[0]!.expand).toBe('down')
  })

  test('区域撤销/重做补发 regions-change（面板与画布同步信号）', () => {
    const doc = FormDoc.create()
    let fired = 0
    doc.on('regions-change', () => {
      fired += 1
    })
    doc.addRegion()
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
    const doc = FormDoc.create()
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 0), { font: { bold: true } })
    doc.addRegion()
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
    const doc = FormDoc.create()
    doc.addRegion()
    expect(doc.history.undo()).toBe(true)
    expect(doc.history.canRedo).toBe(true)
    doc.sheet.setCellValue(ADDR(0, 0), '新编辑')
    expect(doc.history.canRedo).toBe(false)
    expect(doc.history.redo()).toBe(false)
  })

  test('行高列宽编辑可撤销（sheet 不进 undo 的部分由快照条目补齐）', () => {
    const doc = FormDoc.create()
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

describe('模板 JSON 序列化', () => {
  test('round-trip：保存 → 加载 → 再保存等价', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(0, 0), '出库单')
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 5), {
      font: { bold: true, size: 16 },
      align: { horizontal: 'center' },
    })
    doc.sheet.mergeCells(RANGE(0, 0, 0, 5))
    doc.setRowHeight(0, 40)
    doc.setColWidth(0, 120)
    doc.setCellBinding(ADDR(2, 1), { datasetId: 'ds1', path: 'orders[0].no' })
    doc.setRegionExpand(0, 'down')

    const first = doc.toTemplate('测试模板')
    const restored = FormDoc.fromTemplate(first)
    const second = restored.toTemplate('测试模板')
    expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)))

    // 关键内容逐项断言（等价性的人类可读版）
    expect(first.schemaVersion).toBe(2)
    expect(first.cols).toBe(8)
    expect(templateRows(first.regions)).toBe(3)
    expect(restored.sheet.getDisplayValue(ADDR(0, 0))).toBe('出库单')
    expect(restored.sheet.getCellInfo(ADDR(0, 3)).kind).toBe('merged-covered')
    expect(restored.sheet.getRowHeight(0)).toBe(40)
    expect(restored.sheet.getColWidth(0)).toBe(120)
    expect(restored.getCellBinding(ADDR(2, 1))).toEqual({
      datasetId: 'ds1',
      path: 'orders[0].no',
    })
    expect(restored.regions[0]!.expand).toBe('down')
  })

  test('模板 JSON 键集不含打印弹框配置（纸张/边距/缩放/分页）', () => {
    const doc = FormDoc.create()
    const json = doc.toTemplate('t') as unknown as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(['cols', 'name', 'regions', 'schemaVersion', 'sheet'])
    for (const forbidden of ['paper', 'margin', 'scale', 'pagination', 'pageSize', 'orientation']) {
      expect(JSON.stringify(json)).not.toContain(`"${forbidden}"`)
    }
  })

  test('非法区域（重叠/越界）在加载时被拒绝', () => {
    const doc = FormDoc.create()
    const template = doc.toTemplate('t')
    const overlapping: FormTemplate = {
      ...template,
      // 快照 3 行 8 列；两块在 2..2 行 2..3 列处重叠
      regions: [
        { startRow: 0, endRow: 2, startCol: 0, endCol: 3, expand: 'none' },
        { startRow: 2, endRow: 2, startCol: 2, endCol: 5, expand: 'none' }, // 与上一块重叠
      ],
    }
    expect(() => FormDoc.fromTemplate(overlapping)).toThrow('重叠')

    const outOfBounds: FormTemplate = {
      ...template,
      regions: [{ startRow: 0, endRow: 2, startCol: 0, endCol: 99, expand: 'none' }], // 列越界
    }
    expect(() => FormDoc.fromTemplate(outOfBounds)).toThrow('越界')
  })

  test('v1 模板自动迁移到 v2（detail→down、首个 pageHeader→repeat）', () => {
    const v1 = {
      schemaVersion: 1,
      name: '旧模板',
      cols: 4,
      bands: [
        { kind: 'pageHeader', startRow: 0, endRow: 0 },
        { kind: 'detail', startRow: 1, endRow: 1 },
        { kind: 'summary', startRow: 2, endRow: 2 },
      ],
      sheet: doc0Sheet(),
    }
    const doc = FormDoc.fromTemplate(v1)
    expect(doc.regions).toEqual([
      { startRow: 0, endRow: 0, startCol: 0, endCol: 3, expand: 'none', repeat: true },
      { startRow: 1, endRow: 1, startCol: 0, endCol: 3, expand: 'down' },
      { startRow: 2, endRow: 2, startCol: 0, endCol: 3, expand: 'none' },
    ])
    expect(doc.rows).toBe(3)
    // 序列化出来的是 v2 形状
    expect(doc.toTemplate('旧模板').schemaVersion).toBe(TEMPLATE_SCHEMA_VERSION)
  })
})

/** 空快照（迁移用例的最小 sheet 载荷） */
function doc0Sheet() {
  return FormDoc.create(4).sheet.snapshot()
}

describe('绑定 sidecar 与占位符（配置态）', () => {
  test('绑定写入经 cell-meta 命令，可撤销；调整区域行数后绑定随行平移', () => {
    const doc = FormDoc.create()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    expect(doc.sheet.getCellMeta(ADDR(2, 0), FORM_BINDING_META_NAMESPACE)).toEqual({
      datasetId: 'ds1',
      path: 'items[].name',
    })
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellBinding(ADDR(2, 0))).toBeUndefined()

    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'items[].name' })
    doc.addRegion() // 追加区域不改既有行号
    doc.setRowHeight(0, 40)
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('items[].name')
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
    const doc = FormDoc.create()
    doc.setCellBinding(ADDR(2, 0), { datasetId: 'ds1', path: 'total' })
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBeUndefined()
    expect(doc.getCellBinding(ADDR(2, 0))?.path).toBe('total')
  })
})
