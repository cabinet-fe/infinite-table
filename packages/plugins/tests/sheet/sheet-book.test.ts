import { describe, expect, it } from 'vitest'

import { SheetBook, type SheetDef } from '../../src/sheet/sheet-book'
import { SheetStore } from '../../src/sheet/sheet-store'
import { StubHost } from '../testing/stub-host'

function createStore(seed: Record<string, unknown>, rowCount = 20, colCount = 3): SheetStore {
  const store = new SheetStore({ rowCount, colCount, defaultColWidth: 100, defaultRowHeight: 28 })
  for (const [key, value] of Object.entries(seed)) {
    const [col, row] = key.split(',').map(Number)
    store.setValue(col!, row!, value)
  }
  return store
}

function createBook(defs: SheetDef[]) {
  const hosts: StubHost[] = []
  const book = new SheetBook({
    createHost: () => {
      const host = new StubHost()
      hosts.push(host)
      return { host }
    },
  })
  for (const def of defs) {
    book.register(def)
  }
  return { book, hosts }
}

describe('SheetBook 实例池', () => {
  it('switchTo 惰性创建实例；同 id 复用（池化）；切换抛 change 事件', () => {
    const { book } = createBook([
      { id: 'a', store: createStore({ '0,0': 'A1' }) },
      { id: 'b', store: createStore({}) },
    ])
    const events: { activeId: string | null; created: boolean }[] = []
    book.onChange((event) => events.push({ activeId: event.activeId, created: event.created }))

    const first = book.switchTo('a')
    expect(book.activeId).toBe('a')
    expect(first.getCellText(0, 0)).toBe('A1')
    expect(events).toEqual([{ activeId: 'a', created: true }])

    // 同 id 复用同一实例
    const again = book.switchTo('a')
    expect(again).toBe(first)
    expect(events).toEqual([
      { activeId: 'a', created: true },
      { activeId: 'a', created: false },
    ])

    // 切 b：新实例
    const b = book.switchTo('b')
    expect(b).not.toBe(first)
    expect(b.getCellText(0, 0)).toBe('')
    expect(events).toHaveLength(3)
  })

  it('切换后实例状态为对应 Store：值/冻结/列宽', () => {
    const storeA = createStore({ '1,1': 'data' })
    storeA.setFrozen({ colCount: 1, rowCount: 0 })
    storeA.setMerges([{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }])
    storeA.setColWidth(0, 160)
    const storeB = createStore({})
    const { book } = createBook([
      { id: 'a', store: storeA },
      { id: 'b', store: storeB },
    ])

    const tableB = book.switchTo('b')
    expect(tableB.getFrozenColCount()).toBe(0)
    expect(tableB.getColWidth(0)).toBe(100)

    const tableA = book.switchTo('a')
    expect(tableA.getCellText(1, 1)).toBe('data')
    expect(tableA.getFrozenColCount()).toBe(1)
    expect(tableA.getColWidth(0)).toBe(160)
    // 合并区为 A 的状态：被覆盖格 (2,2) 命中主格 (1,1) 文本（合并生效）
    expect(tableA.getCellText(2, 2)).toBe('data')

    // 未注册 id 抛错
    expect(() => book.switchTo('missing')).toThrow(/unknown sheet id/)
  })

  it('remove 销毁实例并剔除池；移除活跃 sheet 置空 activeId 并抛事件', () => {
    const { book } = createBook([
      { id: 'a', store: createStore({}) },
      { id: 'b', store: createStore({}) },
    ])
    const tableA = book.switchTo('a')

    const events: (string | null)[] = []
    book.onChange((event) => events.push(event.activeId))
    book.remove('a')
    expect(book.has('a')).toBe(false)
    expect(book.get('a')).toBeUndefined()
    expect(book.activeId).toBeNull()
    expect(events).toEqual([null])

    // 移除非活跃 sheet 不抛事件
    book.switchTo('b')
    events.length = 0
    book.register({ id: 'c', store: createStore({}) })
    book.remove('c')
    expect(events).toEqual([])

    // 移除后重新注册并切换：新实例
    book.register({ id: 'a', store: createStore({ '0,0': 'new' }) })
    const rebuilt = book.switchTo('a')
    expect(rebuilt.getCellText(0, 0)).toBe('new')
    expect(rebuilt).not.toBe(tableA)
  })

  it('dispose 销毁全部实例；定义保留可重建', () => {
    const { book, hosts } = createBook([
      { id: 'a', store: createStore({}) },
      { id: 'b', store: createStore({}) },
    ])
    book.switchTo('a')
    book.switchTo('b')
    expect(hosts).toHaveLength(2)
    book.dispose()
    // 池已清空：切换重建出第 3 个实例
    const rebuilt = book.switchTo('a')
    expect(hosts).toHaveLength(3)
    expect(rebuilt.getCellText(0, 0)).toBe('')
  })
})
