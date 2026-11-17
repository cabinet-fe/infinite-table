// createSnapshotPrintSource → GridReadView 适配回归测试

import { describe, expect, it } from 'vitest'

import type { GridReadView } from '@infinitable/protocol'

import { SHEET_DEFAULT_COL_WIDTH, SHEET_DEFAULT_ROW_HEIGHT } from '../../src/core/defaults'
import { createSnapshotPrintSource } from '../../src/core/print-source'
import { Sheet } from '../../src/core/sheet'

describe('createSnapshotPrintSource (GridReadView)', () => {
  it('将 SheetSnapshot 投影为协议统一的 GridReadView', () => {
    const sheet = new Sheet('s1')
    sheet.ensureTableSize(10, 5)
    sheet.setRowHeight(1, 44)
    sheet.setColWidth(2, 160)
    sheet.setCellValue({ row: 0, col: 0 }, '标题')
    sheet.setCellValue({ row: 1, col: 1 }, 1234.5)
    sheet.setCellStyle(
      { start: { row: 1, col: 1 }, end: { row: 1, col: 1 } },
      { numFmt: { type: 'thousands' }, font: { bold: true } },
    )
    sheet.setCellValue({ row: 2, col: 0 }, '=1+2')
    sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 0, col: 2 } })

    const view: GridReadView = createSnapshotPrintSource(sheet.snapshot(), '销售表')

    expect(view.name).toBe('销售表')
    expect(view.rowCount).toBe(10)
    expect(view.colCount).toBe(5)
    expect(view.getRowHeight(0)).toBe(SHEET_DEFAULT_ROW_HEIGHT)
    expect(view.getRowHeight(1)).toBe(44)
    expect(view.getColWidth(0)).toBe(SHEET_DEFAULT_COL_WIDTH)
    expect(view.getColWidth(2)).toBe(160)

    expect(view.getMergeRanges()).toEqual([{ startRow: 0, startCol: 0, endRow: 0, endCol: 2 }])

    expect(view.getCellValue(0, 0)).toBe('标题')
    expect(view.getCellText(0, 0)).toBe('标题')
    expect(view.getCellValue(1, 1)).toBe(1234.5)
    expect(view.getCellText(1, 1)).toBe('1,234.5')
    expect(view.getCellStyle(1, 1)?.fontWeight).toBe('bold')
    expect(view.getCellText(0, 2)).toBe('3')
    expect(view.getCellText(4, 4)).toBe('')
    expect(view.getCellValue(4, 4)).toBeUndefined()
  })
})
