// wrap 行高引擎：构造期估算 / 短路 / 候选行扫描（模型侧口径）
// （迁移自 sheet-core grid/__test__/grid-row-height.test.ts。原测试经 SheetGrid
// 挂载驱动——本阶段 SheetGrid 装配层（P9）未迁入，构造期各例改为直接驱动
// GridRowHeightEngine.applyWrapEstimates，仅保留模型侧行高断言；引擎侧落地
// （table.getRowHeight 同步）与动态写入 / 显式换行符两例（依赖 SheetGrid
// cell-change 接线）随 P9 迁入 sheet-grid.ts 后回补）

import { describe, expect, it, vi } from 'vitest'

import { Sheet } from '../../src/core/sheet'
import { GridRowHeightEngine } from '../../src/grid/grid-row-height-engine'
import { SHEET_DEFAULT_COL_WIDTH, SHEET_DEFAULT_ROW_HEIGHT } from '../../src/grid/grid-theme'

describe('wrap 行高引擎', () => {
  it('构造期估算：wrap 长文本行高按估算升高', () => {
    const sheet = new Sheet()
    sheet.setCellStyle(
      { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      { align: { wrap: true } },
    )
    sheet.setCellValue({ row: 0, col: 0 }, 'x'.repeat(200))
    new GridRowHeightEngine(sheet, 20, 6).applyWrapEstimates(SHEET_DEFAULT_COL_WIDTH)
    const height = sheet.getRowHeight(0)
    expect(height).not.toBeUndefined()
    expect(height!).toBeGreaterThan(SHEET_DEFAULT_ROW_HEIGHT)
  })

  it('只升不降：高于估算的人工/导入行高保留', () => {
    const sheet = new Sheet()
    sheet.setRowHeight(0, 600)
    sheet.setCellStyle(
      { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      { align: { wrap: true } },
    )
    sheet.setCellValue({ row: 0, col: 0 }, 'x'.repeat(200))
    new GridRowHeightEngine(sheet, 20, 6).applyWrapEstimates(SHEET_DEFAULT_COL_WIDTH)
    expect(sheet.getRowHeight(0)).toBe(600)
  })

  it('合并格跨列 wrap：按合并总宽度估算', () => {
    const sheet = new Sheet()
    sheet.setCellValue({ row: 0, col: 0 }, 'x'.repeat(200))
    sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 0, col: 2 } })
    sheet.setCellStyle(
      { start: { row: 0, col: 0 }, end: { row: 0, col: 2 } },
      { align: { wrap: true } },
    )
    new GridRowHeightEngine(sheet, 20, 6).applyWrapEstimates(SHEET_DEFAULT_COL_WIDTH)
    // 单列（80px）估算约 5+ 行，3 列（240px）合并宽估算约 2 行——合并后明显更矮
    const merged = sheet.getRowHeight(0)!
    expect(merged).toBeGreaterThan(SHEET_DEFAULT_ROW_HEIGHT)
    expect(merged).toBeLessThan(200)
  })

  it('只扫有数据格：wrap 样式的空列不撑行高', () => {
    const sheet = new Sheet()
    sheet.setCellStyle(
      { start: { row: 0, col: 0 }, end: { row: 9, col: 0 } },
      { align: { wrap: true } },
    )
    new GridRowHeightEngine(sheet, 20, 6).applyWrapEstimates(SHEET_DEFAULT_COL_WIDTH)
    // 无文本内容：估算不高于默认行高（宽表空列不参与扫描的性能口径）
    expect(sheet.getRowHeight(0) ?? SHEET_DEFAULT_ROW_HEIGHT).toBe(SHEET_DEFAULT_ROW_HEIGHT)
  })

  it('短路：样式池无 wrap 样式时 applyWrapEstimates 零全格遍历直接返回', () => {
    const sheet = new Sheet()
    // 无任何样式：即使存在换行符格也不触发构造期扫描（动态写入路径另行重估）
    sheet.setCellValue({ row: 0, col: 0 }, 'a\nb\nc\nd')
    for (let row = 1; row < 100; row++) sheet.setCellValue({ row, col: 0 }, `plain-${row}`)
    const rowKeysSpy = vi.spyOn(sheet.store, 'rowKeys')
    const engine = new GridRowHeightEngine(sheet, 100, 6)
    engine.applyWrapEstimates(SHEET_DEFAULT_COL_WIDTH)
    expect(rowKeysSpy).not.toHaveBeenCalled()
    expect(sheet.getRowHeight(0)).toBeUndefined()
  })

  it('候选扫描：含 wrap 样式时仅候选行做生效样式判定', () => {
    const sheet = new Sheet()
    sheet.setCellStyle(
      { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      { align: { wrap: true } },
    )
    sheet.setCellValue({ row: 0, col: 0 }, 'x'.repeat(200))
    // 无样式的换行符格：wrap 迹象候选
    sheet.setCellValue({ row: 1, col: 0 }, 'a\nb\nc\nd')
    // 大量无 wrap 迹象的普通格
    for (let row = 2; row < 50; row++) sheet.setCellValue({ row, col: 0 }, `plain-${row}`)
    const styleSpy = vi.spyOn(sheet, 'getEffectiveStyle')
    const engine = new GridRowHeightEngine(sheet, 50, 6)
    engine.applyWrapEstimates(SHEET_DEFAULT_COL_WIDTH)
    expect(styleSpy).toHaveBeenCalled()
    // 生效样式判定只发生在候选行（wrap 样式行 0 / 换行符行 1）
    const scannedRows = new Set(styleSpy.mock.calls.map(([addr]) => addr.row))
    expect([...scannedRows]).toEqual([0, 1])
    expect(sheet.getRowHeight(0)!).toBeGreaterThan(SHEET_DEFAULT_ROW_HEIGHT)
    expect(sheet.getRowHeight(1)!).toBeGreaterThan(SHEET_DEFAULT_ROW_HEIGHT)
  })
})
