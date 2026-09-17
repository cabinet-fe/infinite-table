import { describe, expect, it } from 'vitest'

import { SheetModel } from './sheet-model'
import type { CellChangeEvent } from './types'

describe('SheetModel 内置内存坐标模型', () => {
  it('读写往返：setCellValue 后 getCellValue 返回新值', () => {
    const model = new SheetModel(3, 4)
    expect(model.getCellValue(1, 2)).toBeUndefined()
    model.setCellValue(1, 2, 'a')
    expect(model.getCellValue(1, 2)).toBe('a')
  })

  it('可用初始二维数组构造（内部拷贝，rowCount 取行数）', () => {
    const initialCells = [
      [1, 2],
      [3, 4],
    ]
    const model = new SheetModel(initialCells)
    expect(model.rowCount).toBe(2)
    expect(model.getCellValue(0, 1)).toBe(3)
    expect(model.getCellValue(1, 1)).toBe(4)
    // 外部改动初始数组不影响模型
    const firstRow = initialCells[0]
    expect(firstRow).toBeDefined()
    if (firstRow) {
      firstRow[0] = 99
    }
    expect(model.getCellValue(0, 0)).toBe(1)
  })

  it('越界读返回 undefined', () => {
    const model = new SheetModel(2, 2)
    expect(model.getCellValue(2, 0)).toBeUndefined()
    expect(model.getCellValue(0, 2)).toBeUndefined()
    expect(model.getCellValue(-1, 0)).toBeUndefined()
  })

  it('setCellValue 同步通知订阅者：事件 col/row 正确且含 oldValue/newValue', () => {
    const model = new SheetModel([['x']])
    const events: CellChangeEvent[] = []
    model.onCellChange((change) => events.push(change))
    model.setCellValue(0, 0, 'y')
    expect(model.getCellValue(0, 0)).toBe('y')
    expect(events).toEqual([{ col: 0, row: 0, oldValue: 'x', newValue: 'y' }])
  })

  it('退订后不再收事件', () => {
    const model = new SheetModel(1, 1)
    const events: CellChangeEvent[] = []
    const unsubscribe = model.onCellChange((change) => events.push(change))
    unsubscribe()
    model.setCellValue(0, 0, 'v')
    expect(events).toEqual([])
  })

  it('rowCount 响应行数变更：扩大补空行，缩小截断', () => {
    const model = new SheetModel(2, 2)
    model.setCellValue(0, 1, 'keep')
    model.setRowCount(4)
    expect(model.rowCount).toBe(4)
    expect(model.getCellValue(0, 1)).toBe('keep')
    expect(model.getCellValue(0, 3)).toBeUndefined()
    model.setRowCount(1)
    expect(model.rowCount).toBe(1)
    expect(model.getCellValue(0, 1)).toBeUndefined()
  })
})
