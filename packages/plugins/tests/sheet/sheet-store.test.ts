import { describe, expect, it } from 'vitest'

import { ListTable } from '@infinite-table/core'

import { SheetStore } from '../../src/sheet/sheet-store'
import { StubHost } from '../testing/stub-host'

describe('SheetStore 值与维度', () => {
  it('坐标寻址读写：越界读 undefined、越界写空操作；维度查询', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    expect(store.getRowCount()).toBe(10)
    expect(store.getColCount()).toBe(5)
    expect(store.getValue(0, 0)).toBeUndefined()
    store.setValue(0, 0, 'hello')
    expect(store.getValue(0, 0)).toBe('hello')
    // 越界（含负坐标）
    expect(store.getValue(5, 0)).toBeUndefined()
    expect(store.getValue(0, 10)).toBeUndefined()
    expect(store.getValue(-1, 0)).toBeUndefined()
    expect(() => store.setValue(5, 0, 'x')).not.toThrow()
    expect(() => store.setValue(0, -1, 'x')).not.toThrow()
    expect(store.getValue(0, 0)).toBe('hello')
  })
})

describe('SheetStore 样式', () => {
  it('格级样式稀疏存储：set/get/clear，未设置返回 undefined', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    expect(store.getStyle(1, 1)).toBeUndefined()
    store.setStyle(1, 1, { background: '#ff0000' })
    expect(store.getStyle(1, 1)?.background).toBe('#ff0000')
    store.clearStyle(1, 1)
    expect(store.getStyle(1, 1)).toBeUndefined()
    // 其它格不受影响
    expect(store.getStyle(2, 2)).toBeUndefined()
  })
})

describe('SheetStore 行列尺寸与冻结、合并', () => {
  it('尺寸：缺省回落构造值，覆盖逐列逐行生效', () => {
    const store = new SheetStore({
      rowCount: 10,
      colCount: 5,
      defaultColWidth: 80,
      defaultRowHeight: 24,
    })
    expect(store.getColWidth(0)).toBe(80)
    expect(store.getRowHeight(0)).toBe(24)
    store.setColWidth(0, 120)
    store.setRowHeight(2, 48)
    expect(store.getColWidth(0)).toBe(120)
    expect(store.getColWidth(1)).toBe(80)
    expect(store.getRowHeight(2)).toBe(48)
    expect(store.getRowHeight(3)).toBe(24)
    expect(store.getColWidthOverrides().get(0)).toBe(120)
    expect(store.getRowHeightOverrides().get(2)).toBe(48)
  })

  it('冻结：读写返回副本', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    expect(store.getFrozen()).toEqual({ colCount: 0, rowCount: 0 })
    store.setFrozen({ colCount: 2, rowCount: 1 })
    expect(store.getFrozen()).toEqual({ colCount: 2, rowCount: 1 })
    const frozen = store.getFrozen()
    frozen.colCount = 99
    expect(store.getFrozen().colCount).toBe(2)
  })

  it('合并区：set 后按归一化顺序读回', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    store.setMerges([
      { startCol: 1, startRow: 1, endCol: 2, endRow: 3 },
      { startCol: 3, startRow: 0, endCol: 3, endRow: 0 },
    ])
    expect(store.getMerges()).toEqual([
      { startCol: 1, startRow: 1, endCol: 2, endRow: 3 },
      { startCol: 3, startRow: 0, endCol: 3, endRow: 0 },
    ])
  })
})

describe('SheetStore 变更通知', () => {
  it('各写路径抛对应类型事件；退订后不再收到', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    const events: { type: string; col?: number; row?: number }[] = []
    const off = store.onChange((event) => events.push(event))

    store.setValue(0, 0, 'a')
    store.setStyle(1, 1, { background: '#000' })
    store.setColWidth(2, 100)
    store.setRowHeight(3, 30)
    store.setFrozen({ colCount: 1, rowCount: 0 })
    store.setMerges([{ startCol: 0, startRow: 0, endCol: 1, endRow: 1 }])
    store.clearStyle(1, 1)

    expect(events.map((event) => event.type)).toEqual([
      'value',
      'style',
      'geometry',
      'geometry',
      'freeze',
      'merge',
      'style',
    ])
    expect(events[0]).toEqual({ type: 'value', col: 0, row: 0 })
    expect(events[2]).toEqual({ type: 'geometry', col: 2 })
    expect(events[3]).toEqual({ type: 'geometry', row: 3 })

    off()
    store.setValue(0, 0, 'b')
    expect(events).toHaveLength(7)
  })
})

describe('SheetStore asModel 引擎接线', () => {
  function createTable(store: SheetStore) {
    const host = new StubHost()
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: [
        { field: 'name', title: 'Name' },
        { field: 'qty', title: 'Qty' },
      ],
      model: store.asModel(),
      host,
    })
    return { host, table }
  }

  it('表格读 Store 值；updateCell 回写落 Store；Store 直接写触发表格局部刷新', () => {
    const store = new SheetStore({ rowCount: 20, colCount: 2 })
    store.setValue(0, 0, 'A1')
    const { host, table } = createTable(store)
    expect(table.getCellText(0, 0)).toBe('A1')

    // 引擎回驱：updateCell → ModelBinding.writeBack → Store 落值
    table.updateCell(1, 0, 42)
    expect(store.getValue(1, 0)).toBe(42)
    expect(host.submitted.some((entry) => entry.kind === 'body')).toBe(true)

    // Store 直接写：模型事件 → 表格局部刷新（body 失效再次登记）
    host.submitted.length = 0
    store.setValue(0, 1, 'B2')
    expect(host.submitted.some((entry) => entry.kind === 'body')).toBe(true)
    expect(table.getCellText(0, 1)).toBe('B2')
  })
})
