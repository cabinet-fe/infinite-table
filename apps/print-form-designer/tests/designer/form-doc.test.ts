// P3 模型层 headless 测试：波段结构操作、格样式命令与快照条目的统一撤销链路、
// 模板 JSON 序列化 round-trip、绑定 sidecar 形状与占位符推导。
import { describe, expect, test } from 'bun:test'

import {
  FORM_BINDING_META_NAMESPACE,
  bandAtRow,
  formatBindingPlaceholder,
  templateRows,
  type FormTemplate,
} from '../../src/designer/template'
import { FormDoc } from '../../src/designer/form-doc'

const ADDR = (row: number, col: number) => ({ row, col })
const RANGE = (r1: number, c1: number, r2: number, c2: number) => ({
  start: { row: r1, col: c1 },
  end: { row: r2, col: c2 },
})

describe('默认文档与波段结构', () => {
  test('默认五类波段连续覆盖 0..9 行', () => {
    const doc = FormDoc.create()
    expect(doc.bands.map((band) => band.kind)).toEqual([
      'pageHeader',
      'info',
      'detail',
      'summary',
      'signature',
    ])
    expect(doc.rows).toBe(10)
    expect(doc.cols).toBe(8)
    expect(bandAtRow(doc.bands, 0)?.kind).toBe('pageHeader')
    expect(bandAtRow(doc.bands, 4)?.kind).toBe('detail')
    expect(bandAtRow(doc.bands, 9)?.kind).toBe('signature')
    expect(bandAtRow(doc.bands, 10)).toBeUndefined()
  })

  test('追加波段：行区拼接且既有内容不动', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(0, 0), '标题')
    doc.addBand('detail')
    expect(doc.bands.length).toBe(6)
    expect(doc.rows).toBe(13)
    const appended = doc.bands[5]!
    expect(appended.kind).toBe('detail')
    expect(appended.startRow).toBe(10)
    expect(doc.sheet.getDisplayValue(ADDR(0, 0))).toBe('标题')
  })

  test('删除波段：下方波段上移、内容随行上移', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(4, 0), '明细内容') // detail 波段首行
    doc.sheet.setCellValue(ADDR(9, 0), '签字内容') // signature 波段末行
    doc.removeBand(0) // 删 pageHeader（2 行）
    expect(doc.bands.map((band) => band.kind)).toEqual(['info', 'detail', 'summary', 'signature'])
    expect(doc.rows).toBe(8)
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBe('明细内容')
    expect(doc.sheet.getDisplayValue(ADDR(7, 0))).toBe('签字内容')
  })

  test('最后一个波段不可删除', () => {
    const doc = FormDoc.create()
    doc.removeBand(0)
    doc.removeBand(0)
    doc.removeBand(0)
    doc.removeBand(0)
    expect(doc.bands.length).toBe(1)
    expect(() => doc.removeBand(0)).toThrow('至少保留一个波段')
  })

  test('波段排序：相邻交换后内容随行块平移', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(0, 0), '页眉A')
    doc.sheet.setCellValue(ADDR(2, 0), '信息B')
    doc.moveBand(1, -1) // info 上移与 pageHeader 交换
    expect(doc.bands.map((band) => band.kind)).toEqual([
      'info',
      'pageHeader',
      'detail',
      'summary',
      'signature',
    ])
    expect(doc.sheet.getDisplayValue(ADDR(0, 0))).toBe('信息B')
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBe('页眉A')
    doc.moveBand(0, 1) // 换回
    expect(doc.sheet.getDisplayValue(ADDR(0, 0))).toBe('页眉A')
    expect(doc.sheet.getDisplayValue(ADDR(2, 0))).toBe('信息B')
  })

  test('标记明细：类型切换不改变行区', () => {
    const doc = FormDoc.create()
    doc.setBandKind(1, 'detail')
    expect(doc.bands[1]!.kind).toBe('detail')
    expect(doc.bands[1]!.startRow).toBe(2)
    expect(doc.rows).toBe(10)
  })
})

describe('统一撤销链（波段结构 × 样式命令交错）', () => {
  test('样式命令：setCellStyle / 合并 / 值写入均可撤销重做', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 1), { fill: { color: '#ff0000' } })
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.fill?.color).toBe('#ff0000')
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.fill).toBeUndefined()
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

  test('波段增删/排序/标记：快照条目撤销与重做完整还原', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellValue(ADDR(9, 0), '签字')
    doc.addBand('summary') // 追加：行数 10 → 11
    expect(doc.rows).toBe(11)
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(10)
    expect(doc.bands.length).toBe(5)
    expect(doc.sheet.getDisplayValue(ADDR(9, 0))).toBe('签字')
    expect(doc.history.redo()).toBe(true)
    expect(doc.rows).toBe(11)
    expect(doc.bands[5]!.kind).toBe('summary')

    doc.removeBand(0)
    expect(doc.rows).toBe(9)
    expect(doc.sheet.getDisplayValue(ADDR(7, 0))).toBe('签字') // 上移 2 行
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(11)
    expect(doc.sheet.getDisplayValue(ADDR(9, 0))).toBe('签字')

    doc.moveBand(0, 1)
    expect(doc.history.undo()).toBe(true)
    expect(doc.bands[0]!.kind).toBe('pageHeader')

    doc.setBandKind(0, 'detail')
    expect(doc.bands[0]!.kind).toBe('detail')
    expect(doc.history.undo()).toBe(true)
    expect(doc.bands[0]!.kind).toBe('pageHeader')
  })

  test('波段撤销/重做补发 bands-change（面板与画布同步信号）', () => {
    const doc = FormDoc.create()
    let fired = 0
    doc.on('bands-change', () => {
      fired += 1
    })
    doc.addBand('info')
    expect(fired).toBe(1)
    doc.history.undo()
    expect(fired).toBe(2)
    doc.history.redo()
    expect(fired).toBe(3)
    // 行高编辑不改波段，撤销不应发 bands-change
    doc.setRowHeight(0, 40)
    doc.history.undo()
    expect(fired).toBe(3)
  })

  test('交错链：样式命令 → 波段操作 → 逐层撤销 → 逐层重做', () => {
    const doc = FormDoc.create()
    doc.sheet.setCellStyle(RANGE(0, 0, 0, 0), { font: { bold: true } })
    doc.addBand('info')
    doc.sheet.setCellValue(ADDR(0, 1), '画布键入')
    // 撤销顺序：键入 → 追加波段 → 样式
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getDisplayValue(ADDR(0, 1))).toBeUndefined()
    expect(doc.history.undo()).toBe(true)
    expect(doc.rows).toBe(10)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBe(true)
    expect(doc.history.undo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBeUndefined()
    expect(doc.history.undo()).toBe(false)
    // 重做逆序：样式 → 波段 → 键入
    expect(doc.history.redo()).toBe(true)
    expect(doc.sheet.getEffectiveStyle(ADDR(0, 0))?.font?.bold).toBe(true)
    expect(doc.history.redo()).toBe(true)
    expect(doc.rows).toBe(12)
    expect(doc.history.redo()).toBe(true)
    expect(doc.sheet.getDisplayValue(ADDR(0, 1))).toBe('画布键入')
    expect(doc.history.redo()).toBe(false)
  })

  test('新编辑清空重做链（工具栏与画布键入同待遇）', () => {
    const doc = FormDoc.create()
    doc.addBand('info')
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
    doc.setBandKind(3, 'detail')

    const first = doc.toTemplate('测试模板')
    const restored = FormDoc.fromTemplate(first)
    const second = restored.toTemplate('测试模板')
    expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)))

    // 关键内容逐项断言（等价性的人类可读版）
    expect(first.schemaVersion).toBe(1)
    expect(first.cols).toBe(8)
    expect(templateRows(first.bands)).toBe(10)
    expect(restored.sheet.getDisplayValue(ADDR(0, 0))).toBe('出库单')
    expect(restored.sheet.getCellInfo(ADDR(0, 3)).kind).toBe('merged-covered')
    expect(restored.sheet.getRowHeight(0)).toBe(40)
    expect(restored.sheet.getColWidth(0)).toBe(120)
    expect(restored.getCellBinding(ADDR(2, 1))).toEqual({
      datasetId: 'ds1',
      path: 'orders[0].no',
    })
    expect(restored.bands[3]!.kind).toBe('detail')
  })

  test('模板 JSON 键集不含打印弹框配置（纸张/边距/缩放/分页）', () => {
    const doc = FormDoc.create()
    const json = doc.toTemplate('t') as unknown as Record<string, unknown>
    expect(Object.keys(json).sort()).toEqual(['bands', 'cols', 'name', 'schemaVersion', 'sheet'])
    for (const forbidden of ['paper', 'margin', 'scale', 'pagination', 'pageSize', 'orientation']) {
      expect(JSON.stringify(json)).not.toContain(`"${forbidden}"`)
    }
  })

  test('非法波段行区在加载时被拒绝', () => {
    const doc = FormDoc.create()
    const template = doc.toTemplate('t')
    const broken: FormTemplate = {
      ...template,
      bands: [
        { kind: 'pageHeader', startRow: 0, endRow: 1 },
        { kind: 'info', startRow: 3, endRow: 4 }, // 行区断档
      ],
    }
    expect(() => FormDoc.fromTemplate(broken)).toThrow('波段行区不连续')
  })
})

describe('绑定 sidecar 与占位符（配置态）', () => {
  test('绑定写入经 cell-meta 命令，可撤销，随波段移动平移', () => {
    const doc = FormDoc.create()
    doc.setCellBinding(ADDR(4, 0), { datasetId: 'ds1', path: 'items[].name' })
    expect(doc.sheet.getCellMeta(ADDR(4, 0), FORM_BINDING_META_NAMESPACE)).toEqual({
      datasetId: 'ds1',
      path: 'items[].name',
    })
    expect(doc.history.undo()).toBe(true)
    expect(doc.getCellBinding(ADDR(4, 0))).toBeUndefined()

    doc.setCellBinding(ADDR(4, 0), { datasetId: 'ds1', path: 'items[].name' })
    doc.removeBand(0) // 删除上方 2 行 → 绑定随行上移
    expect(doc.getCellBinding(ADDR(2, 0))).toEqual({ datasetId: 'ds1', path: 'items[].name' })
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
