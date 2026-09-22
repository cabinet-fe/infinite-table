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

describe('SheetStore cell meta 命名空间', () => {
  it('存取与命名空间隔离：同格不同 ns 互不串值；未写返回 undefined；越界写空操作', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    store.setCellMeta('binding', 1, 2, { field: 'sales' })
    store.setCellMeta('format', 1, 2, '0.00')
    expect(store.getCellMeta<{ field: string }>('binding', 1, 2)).toEqual({ field: 'sales' })
    expect(store.getCellMeta<string>('format', 1, 2)).toBe('0.00')
    // 未写 / 未知 ns
    expect(store.getCellMeta('binding', 0, 0)).toBeUndefined()
    expect(store.getCellMeta('unknown', 1, 2)).toBeUndefined()
    // 命名空间隔离：清 format 同格不影响 binding
    store.clearCellMeta('format', 1, 2)
    expect(store.getCellMeta('format', 1, 2)).toBeUndefined()
    expect(store.getCellMeta<{ field: string }>('binding', 1, 2)).toEqual({ field: 'sales' })
    // 越界写为空操作
    expect(() => store.setCellMeta('binding', 5, 0, 'x')).not.toThrow()
    expect(store.getCellMeta('binding', 5, 0)).toBeUndefined()
    expect(store.entriesCellMeta('binding')).toHaveLength(1)
    // 越界读返回 undefined：负列/超范围列不得经 styleKey 回绕读到其它合法格
    // （colCount=5 下 styleKey(-1,2) 与格 (4,1) 同键、styleKey(6,0) 与格 (1,1) 同键）
    store.setCellMeta('binding', 4, 1, 'wrap-a')
    store.setCellMeta('binding', 1, 1, 'wrap-b')
    expect(store.getCellMeta('binding', -1, 2)).toBeUndefined()
    expect(store.getCellMeta('binding', 6, 0)).toBeUndefined()
    expect(store.getCellMeta('binding', -1, -1)).toBeUndefined()
    expect(store.getCellMeta('binding', 4, 1)).toBe('wrap-a')
    expect(store.getCellMeta('binding', 1, 1)).toBe('wrap-b')
    expect(store.entriesCellMeta('binding')).toHaveLength(3)
  })

  it('枚举：entriesCellMeta 按行主序确定性返回；空命名空间返回 []', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    // 乱序写入，枚举仍按行主序（行升序、行内列升序）
    store.setCellMeta('binding', 3, 2, 'c')
    store.setCellMeta('binding', 0, 4, 'd')
    store.setCellMeta('binding', 1, 2, 'a')
    store.setCellMeta('binding', 0, 2, 'b')
    expect(store.entriesCellMeta('binding')).toEqual([
      { col: 0, row: 2, value: 'b' },
      { col: 1, row: 2, value: 'a' },
      { col: 3, row: 2, value: 'c' },
      { col: 0, row: 4, value: 'd' },
    ])
    expect(store.entriesCellMeta('format')).toEqual([])
  })

  it('清空：带坐标清单格，不带清整个命名空间；其它命名空间不受影响', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    store.setCellMeta('binding', 1, 1, 'a')
    store.setCellMeta('binding', 2, 3, 'b')
    store.setCellMeta('format', 2, 3, 'x')
    store.clearCellMeta('binding', 1, 1)
    expect(store.getCellMeta('binding', 1, 1)).toBeUndefined()
    expect(store.getCellMeta('binding', 2, 3)).toBe('b')
    expect(store.entriesCellMeta('binding')).toEqual([{ col: 2, row: 3, value: 'b' }])
    // 整清 binding，format 不受影响
    store.clearCellMeta('binding')
    expect(store.entriesCellMeta('binding')).toEqual([])
    expect(store.entriesCellMeta('format')).toEqual([{ col: 2, row: 3, value: 'x' }])
    // 越界清单格为空操作：不误删回绕同键的合法格、不广播错误坐标
    store.setCellMeta('format', 4, 1, 'keep-a')
    store.setCellMeta('format', 1, 1, 'keep-b')
    const metaEvents: { ns: string; col?: number; row?: number }[] = []
    store.onMetaChange((event) => metaEvents.push(event))
    store.clearCellMeta('format', -1, 2)
    store.clearCellMeta('format', 6, 0)
    expect(store.getCellMeta('format', 4, 1)).toBe('keep-a')
    expect(store.getCellMeta('format', 1, 1)).toBe('keep-b')
    expect(store.entriesCellMeta('format')).toEqual([
      { col: 1, row: 1, value: 'keep-b' },
      { col: 4, row: 1, value: 'keep-a' },
      { col: 2, row: 3, value: 'x' },
    ])
    expect(metaEvents).toEqual([])
  })

  it('meta-change 事件：写/清单格带 ns 与格坐标，整清只带 ns；不进 onChange；退订后不再收到', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    const metaEvents: { ns: string; col?: number; row?: number }[] = []
    const changeEvents: string[] = []
    const offMeta = store.onMetaChange((event) => metaEvents.push(event))
    const offChange = store.onChange((event) => changeEvents.push(event.type))

    store.setCellMeta('binding', 1, 2, 'a')
    store.clearCellMeta('binding', 1, 2)
    store.clearCellMeta('binding')

    expect(metaEvents).toEqual([
      { ns: 'binding', col: 1, row: 2 },
      { ns: 'binding', col: 1, row: 2 },
      { ns: 'binding' },
    ])
    // meta 走独立事件面，不并入 onChange
    expect(changeEvents).toEqual([])

    offMeta()
    store.setCellMeta('binding', 0, 0, 'b')
    expect(metaEvents).toHaveLength(3)
    offChange()
  })
})

describe('SheetStore 有效样式 getEffectiveStyle', () => {
  it('基础 → 列级 → 格级逐字段合成：上层字段胜出，未覆盖字段保留下层', () => {
    const store = new SheetStore({
      rowCount: 10,
      colCount: 5,
      baseStyle: { color: '#111111', background: '#ffffff', textAlign: 'left' },
    })
    store.setColumnStyle(1, { color: '#ff0000', fontWeight: 700 })
    store.setStyle(1, 3, { background: '#ffffcc' })

    const effective = store.getEffectiveStyle(1, 3)
    expect(effective?.color).toBe('#ff0000') // 列级胜基础
    expect(effective?.fontWeight).toBe(700) // 列级独有
    expect(effective?.background).toBe('#ffffcc') // 格级胜基础
    expect(effective?.textAlign).toBe('left') // 无人覆盖保留基础
    // 同列其它格：无格级片段，回落 base + 列级
    const sibling = store.getEffectiveStyle(1, 4)
    expect(sibling?.color).toBe('#ff0000')
    expect(sibling?.background).toBe('#ffffff')
    // 其它列：仅 base
    expect(store.getEffectiveStyle(2, 3)).toMatchObject({
      color: '#111111',
      background: '#ffffff',
    })
    // 返回新对象，不别名格级/列级片段
    expect(effective).not.toBe(store.getStyle(1, 3))
    expect(effective).not.toBe(store.getColumnStyle(1))
  })

  it('边框逐边独立合成：各层给不同边，四边并集且层高者胜', () => {
    const store = new SheetStore({
      rowCount: 10,
      colCount: 5,
      baseStyle: { border: { top: { width: 1, color: '#base-top' } } },
    })
    store.setColumnStyle(0, { border: { bottom: { width: 2, color: '#col-bottom' } } })
    store.setStyle(0, 0, { border: { left: { width: 3, color: '#cell-left' } } })

    const effective = store.getEffectiveStyle(0, 0)
    expect(effective?.border).toEqual({
      top: { width: 1, color: '#base-top' },
      bottom: { width: 2, color: '#col-bottom' },
      left: { width: 3, color: '#cell-left' },
    })
    // 格级对同边整边替换（非逐属性混合）
    store.setStyle(0, 0, { border: { top: { width: 9, color: '#cell-top' } } })
    expect(store.getEffectiveStyle(0, 0)?.border?.top).toEqual({ width: 9, color: '#cell-top' })
  })

  it('无任何片段返回空样式；越界返回 undefined；列级写清广播 style 事件（仅 col）', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    expect(store.getEffectiveStyle(0, 0)).toEqual({})
    expect(store.getEffectiveStyle(-1, 0)).toBeUndefined()
    expect(store.getEffectiveStyle(0, 10)).toBeUndefined()

    const events: { type: string; col?: number; row?: number }[] = []
    store.onChange((event) => events.push(event))
    store.setColumnStyle(2, { color: '#000' })
    store.clearColumnStyle(2)
    expect(events).toEqual([
      { type: 'style', col: 2 },
      { type: 'style', col: 2 },
    ])
    expect(store.getColumnStyle(2)).toBeUndefined()
  })
})

describe('SheetStore 显示值 getDisplayValue', () => {
  it('缺省注入回落原始值口径：原样返回 getValue（数值保持数值，空格 undefined）', () => {
    const store = new SheetStore({ rowCount: 10, colCount: 5 })
    store.setValue(0, 0, 42)
    store.setValue(1, 0, 'text')
    expect(store.getDisplayValue(0, 0)).toBe(42)
    expect(store.getDisplayValue(1, 0)).toBe('text')
    expect(store.getDisplayValue(2, 0)).toBeUndefined()
  })

  it('宿主注入显示链：resolveDisplayValue 接管显示形态（可按坐标与原始值产出）', () => {
    const seen: Array<[number, number, unknown]> = []
    const store = new SheetStore({
      rowCount: 10,
      colCount: 5,
      resolveDisplayValue: (col, row, value) => {
        seen.push([col, row, value])
        return value == null ? '' : `${col},${row} = ${String(value)}`
      },
    })
    store.setValue(2, 3, 7)
    expect(store.getDisplayValue(2, 3)).toBe('2,3 = 7')
    expect(store.getDisplayValue(0, 0)).toBe('')
    // 注入收到原始值与坐标（显示链不改存储值）
    expect(seen).toEqual([
      [2, 3, 7],
      [0, 0, undefined],
    ])
    expect(store.getValue(2, 3)).toBe(7)
  })
})
