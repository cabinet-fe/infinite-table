// Sheet 模型：合并值语义 / 数据与选区 / Workbook 基础 / 快照行高列宽与行列样式
// （迁移自 sheet-core __test__/sheet.test.ts；`new Sheet({rows, cols})` 旧形态
// 收敛为 `new Sheet()`——尺寸声明与断言无关，边框合成口径不变）

import { describe, expect, it, vi } from 'vitest'

import { parseRange } from '../../src/core/address'
import type { SheetEvents } from '../../src/core/sheet'
import type { WorkbookEvents } from '../../src/core/workbook'
import { Sheet, type SheetSnapshot } from '../../src/core/sheet'
import { Workbook } from '../../src/core/workbook'

const B2 = { row: 1, col: 1 }
const C3 = { row: 2, col: 2 }

describe('Sheet 合并值语义', () => {
  it('B2、C3 各有值 → 合并后仅 B2 值保留；getCellData(C3) = undefined；getDisplayValue(C3) = B2 的值', () => {
    const sheet = new Sheet()
    sheet.setCellValue(B2, 'keep')
    sheet.setCellValue(C3, 'drop')

    sheet.mergeCells(parseRange('B2:C3')!)

    expect(sheet.getDisplayValue(B2)).toBe('keep')
    expect(sheet.getCellData(C3)).toBeUndefined()
    expect(sheet.getDisplayValue(C3)).toBe('keep')
  })

  it('嵌套合并：已有 B2:C3，再 merge C3:D4 → 包围盒 B2:D4，数据按保留规则落 B2', () => {
    const sheet = new Sheet()
    sheet.setCellValue(B2, 'v-b2')
    sheet.mergeCells(parseRange('B2:C3')!)
    sheet.setCellValue({ row: 3, col: 3 }, 'v-d4')

    const finalRange = sheet.mergeCells(parseRange('C3:D4')!)

    expect(finalRange).toEqual(parseRange('B2:D4'))
    expect(sheet.getCellInfo(B2).kind).toBe('merged-anchor')
    expect(sheet.getDisplayValue(B2)).toBe('v-b2')
    expect(sheet.getDisplayValue({ row: 3, col: 3 })).toBe('v-b2')
    expect(sheet.getCellData({ row: 3, col: 3 })).toBeUndefined()
  })

  it('左上方向第一个有值格优先：锚点无值时取行主序首个有值格', () => {
    const sheet = new Sheet()
    sheet.setCellValue(C3, 'first-valued')

    sheet.mergeCells(parseRange('B2:C3')!)

    expect(sheet.getDisplayValue(B2)).toBe('first-valued')
    expect(sheet.getCellData(C3)).toBeUndefined()
  })

  it('unmerge 后仅锚点留值', () => {
    const sheet = new Sheet()
    sheet.setCellValue(B2, 'keep')
    sheet.setCellValue(C3, 'drop')
    sheet.mergeCells(parseRange('B2:C3')!)

    sheet.unmergeCells(parseRange('B2:C3')!)

    expect(sheet.getCellInfo(B2)).toEqual({ kind: 'normal', anchor: B2 })
    expect(sheet.getCellData(B2)).toMatchObject({ v: 'keep' })
    expect(sheet.getCellData(C3)).toBeUndefined()
  })

  it('merge-change 事件', () => {
    const sheet = new Sheet()
    const handler = vi.fn<(payload: SheetEvents['merge-change']) => void>()
    sheet.on('merge-change', handler)

    sheet.mergeCells(parseRange('B2:C3')!)
    expect(handler).toHaveBeenCalledWith({ range: parseRange('B2:C3') })
  })
})

describe('Sheet 数据与选区', () => {
  it('setCellValue / getCellData / cell-change 事件', () => {
    const sheet = new Sheet()
    const handler = vi.fn<(payload: SheetEvents['cell-change']) => void>()
    sheet.on('cell-change', handler)

    sheet.setCellValue(B2, 42)
    expect(sheet.getCellData(B2)).toEqual({ v: 42, t: 'n' })
    expect(handler).toHaveBeenCalledWith({ addr: B2 })

    sheet.setCellValue(B2, null)
    expect(sheet.getCellData(B2)).toBeUndefined()
  })

  it('selectCell(C3)（被覆盖）→ activeCell = B2', () => {
    const sheet = new Sheet()
    sheet.mergeCells(parseRange('B2:C3')!)

    sheet.selectCell(C3)

    expect(sheet.getSelection().activeCell).toEqual(B2)
  })

  it('selection-change 事件', () => {
    const sheet = new Sheet()
    const handler = vi.fn<(state: SheetEvents['selection-change']) => void>()
    sheet.on('selection-change', handler)

    sheet.selectCell(B2)
    expect(handler).toHaveBeenCalledWith({ activeCell: B2, ranges: [{ start: B2, end: B2 }] })
  })

  it('对被覆盖格写入 → 落到锚点', () => {
    const sheet = new Sheet()
    sheet.mergeCells(parseRange('B2:C3')!)

    sheet.setCellValue(C3, 'via-covered')
    expect(sheet.getCellData(B2)).toMatchObject({ v: 'via-covered' })
    expect(sheet.getCellData(C3)).toBeUndefined()
  })
})

describe('Workbook', () => {
  it('默认一个 sheet，可增删激活', () => {
    const wb = new Workbook()
    expect(wb.sheetCount).toBe(1)
    expect(wb.activeSheet.name).toBe('Sheet1')
    expect(wb.activeSheet.getSelection().activeCell).toEqual({ row: 0, col: 0 })

    const s2 = wb.addSheet()
    expect(s2.name).toBe('Sheet2')
    expect(s2.getSelection().activeCell).toEqual({ row: 0, col: 0 })
    expect(wb.activeSheet.name).toBe('Sheet1')

    expect(wb.activateSheet('Sheet2')).toBe(true)
    expect(wb.activeSheet).toBe(s2)

    expect(wb.removeSheet('Sheet2')).toBe(true)
    expect(wb.activeSheet.name).toBe('Sheet1')

    // 至少保留一个
    expect(wb.removeSheet('Sheet1')).toBe(false)
  })

  it('激活切换事件', () => {
    const wb = new Workbook()
    wb.addSheet('Data')
    const handler = vi.fn<(payload: WorkbookEvents['active-sheet-change']) => void>()
    wb.on('active-sheet-change', handler)

    wb.activateSheet('Data')
    expect(handler).toHaveBeenCalledWith({ sheet: wb.getSheet('Data'), index: 1 })
  })
})

describe('Sheet 快照行高', () => {
  it('snapshot/restore 保留自定义行高（worker 导入/导出与宿主持久化经快照传输）', () => {
    const sheet = new Sheet()
    sheet.setRowHeight(2, 40)
    sheet.setRowHeight(5, 24)

    // 经 JSON 序列化模拟结构化克隆 / 持久化边界
    const restored = new Sheet()
    restored.restore(JSON.parse(JSON.stringify(sheet.snapshot())) as SheetSnapshot)
    expect([...restored.getRowHeights()]).toEqual([
      [2, 40],
      [5, 24],
    ])
  })

  it('旧快照无 rowHeights 字段 → 还原为空（向后兼容）', () => {
    const sheet = new Sheet()
    sheet.setRowHeight(1, 30)
    const legacy = sheet.snapshot() as SheetSnapshot
    delete legacy.rowHeights

    const restored = new Sheet()
    restored.restore(legacy)
    expect(restored.getRowHeights().size).toBe(0)
  })

  it('未设置行高时快照不携带 rowHeights 字段', () => {
    const sheet = new Sheet()
    expect(sheet.snapshot().rowHeights).toBeUndefined()
  })
})

describe('Sheet 快照列宽与行列样式', () => {
  it('snapshot/restore 保留 colWidths / rowStyles / colStyles', () => {
    const sheet = new Sheet()
    sheet.setColWidth(1, 120)
    sheet.setColWidth(3, 90)
    sheet.setRowStyle(2, { font: { color: '#FF0000' } })
    sheet.setColStyle(1, { fill: { color: '#EEEEEE' } })

    const restored = new Sheet()
    restored.restore(JSON.parse(JSON.stringify(sheet.snapshot())) as SheetSnapshot)
    expect([...restored.getColWidths()]).toEqual([
      [1, 120],
      [3, 90],
    ])
    expect(restored.getRowStyle(2)).toEqual({ font: { color: '#FF0000' } })
    expect(restored.getColStyle(1)).toEqual({ fill: { color: '#EEEEEE' } })
  })

  it('旧快照缺字段 → 空 Map（向后兼容）', () => {
    const sheet = new Sheet()
    sheet.setColWidth(0, 100)
    sheet.setRowStyle(0, { font: { bold: true } })
    const legacy = sheet.snapshot() as SheetSnapshot
    delete legacy.colWidths
    delete legacy.rowStyles
    delete legacy.colStyles

    const restored = new Sheet()
    restored.restore(legacy)
    expect(restored.getColWidths().size).toBe(0)
    expect(restored.getRowStyleIds().size).toBe(0)
    expect(restored.getColStyleIds().size).toBe(0)
  })

  it('restoreContent 还原行列样式但不碰列宽', () => {
    const sheet = new Sheet()
    sheet.setColWidth(0, 100)
    sheet.setRowStyle(0, { font: { color: '#111111' } })
    const snap = sheet.snapshot()

    const target = new Sheet()
    target.setColWidth(2, 200)
    target.restoreContent(snap)
    expect(target.getColWidth(2)).toBe(200)
    expect(target.getColWidth(0)).toBeUndefined()
    expect(target.getRowStyle(0)).toEqual({ font: { color: '#111111' } })
  })

  it('getEffectiveStyle：空格继承行列样式；格样式字段级覆盖', () => {
    const sheet = new Sheet()
    sheet.setColStyle(0, { font: { color: '#FF0000', size: 14 } })
    sheet.setRowStyle(0, { font: { bold: true } })
    expect(sheet.getEffectiveStyle({ row: 0, col: 0 })).toEqual({
      font: { color: '#FF0000', size: 14, bold: true },
    })

    sheet.setCellValue({ row: 0, col: 0 }, 'x')
    sheet.setCellStyle(
      { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      { font: { color: '#0000FF' } },
    )
    expect(sheet.getEffectiveStyle({ row: 0, col: 0 })).toEqual({
      font: { color: '#0000FF', size: 14, bold: true },
    })
  })

  it('setRowStyle / setColStyle 进 undo', () => {
    const sheet = new Sheet()
    sheet.setRowStyle(1, { fill: { color: '#AA0000' } })
    expect(sheet.getRowStyle(1)).toEqual({ fill: { color: '#AA0000' } })
    expect(sheet.undo()).toBe(true)
    expect(sheet.getRowStyle(1)).toBeUndefined()
    expect(sheet.redo()).toBe(true)
    expect(sheet.getRowStyle(1)).toEqual({ fill: { color: '#AA0000' } })

    sheet.setColStyle(2, { font: { italic: true } })
    expect(sheet.undo()).toBe(true)
    expect(sheet.getColStyle(2)).toBeUndefined()
  })

  it('mergeCells：合成选区边界格上的有效外边框到新锚点格', () => {
    const sheet = new Sheet()
    // A1 (0,0) 设置 top 边框
    sheet.setCellStyle(
      { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      { border: { top: { style: 'thin', width: 1, color: '#000000' } } },
    )
    // A3 (2,0) 设置 bottom 边框
    sheet.setCellStyle(
      { start: { row: 2, col: 0 }, end: { row: 2, col: 0 } },
      { border: { bottom: { style: 'thick', width: 3, color: '#FF0000' } } },
    )

    // 合并 A1:A3
    sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 2, col: 0 } })

    const anchorStyle = sheet.getCellStyle({ row: 0, col: 0 })
    expect(anchorStyle?.border).toEqual({
      top: { style: 'thin', width: 1, color: '#000000' },
      bottom: { style: 'thick', width: 3, color: '#FF0000' },
    })
  })
})

describe('Sheet.restore 公式依赖图重建', () => {
  it('restore 清除旧公式节点并按快照重建，后续编辑正常触发重算', () => {
    const src = new Sheet()
    src.setCellValue({ row: 0, col: 0 }, 10)
    src.setCellFormula({ row: 0, col: 1 }, '=A1*2')
    const snap = JSON.parse(JSON.stringify(src.snapshot())) as SheetSnapshot

    const restored = new Sheet()
    // 预先存在一条旧公式（应被 restore 清理）
    restored.setCellFormula({ row: 2, col: 2 }, '=1+1')
    expect(restored.formulaGraph.nodeCount).toBe(1)

    restored.restore(snap)
    expect(restored.formulaGraph.nodeCount).toBe(1)
    expect(restored.getCellData({ row: 0, col: 1 })).toMatchObject({ f: 'A1*2', v: 20 })

    // 修改 A1，验证重建后的依赖边驱动 B1 重算
    restored.setCellValue({ row: 0, col: 0 }, 25)
    expect(restored.getCellData({ row: 0, col: 1 })?.v).toBe(50)
  })
})

describe('Sheet batch-start / batch-end 生命周期事件', () => {
  it('executeCommand / undo / redo / applyDerivedPatches 成对发出 batch-start 与 batch-end', () => {
    const sheet = new Sheet()
    const log: string[] = []
    sheet.on('batch-start', () => log.push('start'))
    sheet.on('cell-change', ({ addr }) => log.push(`cell:${addr.row},${addr.col}`))
    sheet.on('batch-end', () => log.push('end'))

    sheet.setCellFormula({ row: 0, col: 1 }, '=A1+1')
    // SetCellFormulaCommand 写公式 + recalcAfterCommand 写缓存值，两次 cell-change 共处同一 batch
    expect(log).toEqual(['start', 'cell:0,1', 'cell:0,1', 'end'])

    log.length = 0
    sheet.setCellValue({ row: 0, col: 0 }, 5)
    expect(log).toEqual(['start', 'cell:0,0', 'cell:0,1', 'end'])

    log.length = 0
    sheet.undo()
    // undo 逆序回放：先回退派生格 (0,1)，再回退源格 (0,0)
    expect(log).toEqual(['start', 'cell:0,1', 'cell:0,0', 'end'])

    log.length = 0
    sheet.redo()
    expect(log).toEqual(['start', 'cell:0,0', 'cell:0,1', 'end'])

    log.length = 0
    sheet.applyDerivedPatches([])
    expect(log).toEqual([])
    sheet.applyDerivedPatches([
      {
        kind: 'cell',
        addr: { row: 1, col: 0 },
        before: undefined,
        after: { v: 9, t: 'n' },
      },
    ])
    expect(log).toEqual(['start', 'cell:1,0', 'end'])
  })

  it('嵌套 beginTransaction / commit 与 rollback 正确收尾 batch 事件', () => {
    const sheet = new Sheet()
    const log: string[] = []
    sheet.on('batch-start', () => log.push('start'))
    sheet.on('cell-change', ({ addr }) => log.push(`cell:${addr.row},${addr.col}`))
    sheet.on('batch-end', () => log.push('end'))

    sheet.beginTransaction()
    sheet.beginTransaction()
    sheet.setCellValue({ row: 0, col: 0 }, 1)
    sheet.setCellValue({ row: 0, col: 1 }, 2)
    sheet.commit()
    expect(log).toEqual(['start', 'cell:0,0', 'cell:0,1'])
    sheet.commit()
    expect(log).toEqual(['start', 'cell:0,0', 'cell:0,1', 'end'])

    // rollback 应在回放完撤销补丁后再发 batch-end
    log.length = 0
    sheet.beginTransaction()
    sheet.beginTransaction()
    sheet.setCellValue({ row: 1, col: 0 }, 99)
    sheet.rollback()
    expect(log).toEqual(['start', 'cell:1,0', 'cell:1,0', 'end'])
    expect(sheet.getCellData({ row: 1, col: 0 })).toBeUndefined()
  })
})
