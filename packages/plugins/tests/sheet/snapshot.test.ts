import { describe, expect, it } from 'vitest'

import type { FloatObject, SelectionSnapshot } from '@infinite-table/core'

import { restore, snapshot } from '../../src/sheet/snapshot'
import { SheetStore } from '../../src/sheet/sheet-store'

const STORE_OPTIONS = {
  rowCount: 8,
  colCount: 4,
  defaultColWidth: 90,
  defaultRowHeight: 30,
} as const

const IMAGES: FloatObject[] = [
  {
    id: 'img-1',
    kind: 'image',
    anchor: { from: { col: 1, row: 1 }, to: { col: 3, row: 3 }, offsetX: 4, offsetY: 6 },
    size: { width: 120, height: 80 },
    src: 'https://example.com/a.png',
  },
  {
    id: 'img-2',
    kind: 'image',
    anchor: { from: { col: 0, row: 5 }, to: { col: 2, row: 7 }, offsetX: 0, offsetY: 0 },
    src: 'https://example.com/b.png',
  },
]

const SELECTION: SelectionSnapshot = {
  ranges: [{ start: { col: 0, row: 0 }, end: { col: 2, row: 1 } }],
  focus: { col: 2, row: 1 },
}

/** 九字段全量布置的源 Store（cells/styles/merges/frozen/rowHeights/colWidths/meta 七类落 Store） */
function createPopulatedStore(): SheetStore {
  const store = new SheetStore(STORE_OPTIONS)
  // 值（含显式 undefined 不入快照）
  store.setValue(0, 0, 'A1')
  store.setValue(2, 1, 99)
  store.setValue(2, 2, undefined)
  store.setValue(1, 3, 'x')
  store.setValue(3, 7, 42)
  // 格级 + 列级样式
  store.setStyle(1, 1, {
    background: '#ff0000',
    border: { top: { width: 1, color: '#top' } },
    padding: [1, 2, 3, 4],
  })
  store.setStyle(0, 2, { color: '#00ff00' })
  store.setColumnStyle(2, { fontWeight: 700 })
  // 合并 / 冻结
  store.setMerges([{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }])
  store.setFrozen({ colCount: 1, rowCount: 1 })
  // 行列尺寸
  store.setRowHeight(2, 48)
  store.setRowHeight(5, 60)
  store.setColWidth(0, 120)
  // cell meta（两个命名空间）
  store.setCellMeta('binding', 1, 2, { field: 'sales' })
  store.setCellMeta('binding', 0, 4, 'sum')
  store.setCellMeta('format', 1, 2, '0.00')
  return store
}

/** restore 接线记录器（宿主应用回调的测试替身） */
function createWiringRecorder() {
  const applied: { images: FloatObject[] | null; selection: SelectionSnapshot | null } = {
    images: null,
    selection: null,
  }
  const wiring = {
    images: (images: readonly FloatObject[]) => {
      applied.images = [...images]
    },
    selection: (selection: SelectionSnapshot | null) => {
      applied.selection = selection
    },
  }
  return { wiring, applied }
}

describe('snapshot 九字段采集', () => {
  it('字段覆盖 cells/styles/merges/frozen/rowHeights/colWidths/images/meta/selection，逐项内容与确定性排序', () => {
    const store = createPopulatedStore()
    const snap = snapshot(store, { images: IMAGES, selection: SELECTION })

    // cells：稀疏采集（undefined 格不入快照），行主序
    expect(snap.cells).toEqual([
      { col: 0, row: 0, value: 'A1' },
      { col: 2, row: 1, value: 99 },
      { col: 1, row: 3, value: 'x' },
      { col: 3, row: 7, value: 42 },
    ])
    // styles：格级（行主序）+ 列级（列升序）
    expect(snap.styles.cells).toEqual([
      { col: 1, row: 1, style: store.getStyle(1, 1) },
      { col: 0, row: 2, style: store.getStyle(0, 2) },
    ])
    expect(snap.styles.cells[0]?.style).not.toBe(store.getStyle(1, 1)) // 值物化，不别名 Store
    expect(snap.styles.columns).toEqual([{ col: 2, style: { fontWeight: 700 } }])
    expect(snap.merges).toEqual([{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }])
    expect(snap.frozen).toEqual({ colCount: 1, rowCount: 1 })
    expect(snap.rowHeights).toEqual([
      { row: 2, height: 48 },
      { row: 5, height: 60 },
    ])
    expect(snap.colWidths).toEqual([{ col: 0, width: 120 }])
    // images / selection 随快照携带（自 extras 注入）
    expect(snap.images).toEqual(IMAGES)
    expect(snap.images[0]).not.toBe(IMAGES[0])
    expect(snap.images[0]?.anchor).not.toBe(IMAGES[0]?.anchor)
    expect(snap.selection).toEqual(SELECTION)
    // meta：命名空间字典序，条目行主序
    expect(snap.meta).toEqual([
      {
        ns: 'binding',
        entries: [
          { col: 1, row: 2, value: { field: 'sales' } },
          { col: 0, row: 4, value: 'sum' },
        ],
      },
      { ns: 'format', entries: [{ col: 1, row: 2, value: '0.00' }] },
    ])
  })

  it('extras 缺省：images 空列表、selection 为 null', () => {
    const snap = snapshot(new SheetStore(STORE_OPTIONS))
    expect(snap.images).toEqual([])
    expect(snap.selection).toBeNull()
    expect(snap.cells).toEqual([])
    expect(snap.styles).toEqual({ cells: [], columns: [] })
    expect(snap.meta).toEqual([])
    expect(snap.merges).toEqual([])
    expect(snap.frozen).toEqual({ colCount: 0, rowCount: 0 })
    expect(snap.rowHeights).toEqual([])
    expect(snap.colWidths).toEqual([])
  })
})

describe('restore 全量灌回', () => {
  it('替换语义：值/样式/尺寸/meta 不在快照内的既有状态被清场，九字段全部落 Store', () => {
    const snap = snapshot(createPopulatedStore(), { images: IMAGES, selection: SELECTION })
    // 预脏目标：每类都塞快照外的状态
    const target = new SheetStore(STORE_OPTIONS)
    target.setValue(0, 1, 'stale')
    target.setValue(0, 0, 'old-A1')
    target.setStyle(2, 2, { color: '#stale' })
    target.setColumnStyle(1, { fontStyle: 'italic' })
    target.setRowHeight(0, 99)
    target.setColWidth(3, 111)
    target.setMerges([{ startCol: 0, startRow: 0, endCol: 3, endRow: 7 }])
    target.setFrozen({ colCount: 3, rowCount: 3 })
    target.setCellMeta('stale-ns', 0, 0, 's')
    target.setCellMeta('binding', 0, 0, 'old')

    const { wiring, applied } = createWiringRecorder()
    restore(target, snap, wiring)

    // 值：快照外清空、快照内重建
    expect(target.getValue(0, 1)).toBeUndefined()
    expect(target.getValue(0, 0)).toBe('A1')
    expect(target.getValue(3, 7)).toBe(42)
    // 样式：格级/列级清场重建
    expect(target.getStyle(2, 2)).toBeUndefined()
    expect(target.getStyle(1, 1)?.background).toBe('#ff0000')
    expect(target.getStyle(1, 1)?.border?.top).toEqual({ width: 1, color: '#top' })
    expect(target.getStyle(1, 1)?.padding).toEqual([1, 2, 3, 4])
    expect(target.getStyle(1, 1)).not.toBe(snap.styles.cells[0]?.style)
    expect(target.getColumnStyle(1)).toBeUndefined()
    expect(target.getColumnStyle(2)?.fontWeight).toBe(700)
    // 合并 / 冻结
    expect(target.getMerges()).toEqual([{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }])
    expect(target.getFrozen()).toEqual({ colCount: 1, rowCount: 1 })
    // 行列尺寸：覆盖清场重建，清掉的回落缺省
    expect(target.getRowHeight(0)).toBe(30)
    expect(target.getRowHeight(2)).toBe(48)
    expect(target.getColWidth(3)).toBe(90)
    expect(target.getColWidth(0)).toBe(120)
    // meta：快照外命名空间整清、快照内重建（旧条目不残留）
    expect(target.getCellMeta('stale-ns', 0, 0)).toBeUndefined()
    expect(target.entriesCellMeta('stale-ns')).toEqual([])
    expect(target.getCellMeta('binding', 0, 0)).toBeUndefined()
    expect(target.entriesCellMeta('binding')).toEqual(snap.meta[0]?.entries)
    expect(target.entriesCellMeta('format')).toEqual([{ col: 1, row: 2, value: '0.00' }])
    // images / selection 不落 Store，经接线回调交宿主（内容等价、对象为快照副本）
    expect(applied.images).toEqual(IMAGES)
    expect(applied.images?.[0]).not.toBe(snap.images[0])
    expect(applied.selection).toEqual(SELECTION)
    expect(applied.selection).not.toBe(snap.selection)
  })

  it('越目标维度的快照条目静默丢弃', () => {
    const snap = snapshot(createPopulatedStore())
    const smaller = new SheetStore({ ...STORE_OPTIONS, rowCount: 4, colCount: 2 })
    restore(smaller, snap)

    // 值：(3,7) 越界丢弃、(1,3) 保留
    expect(smaller.getValue(3, 7)).toBeUndefined()
    expect(smaller.getValue(1, 3)).toBe('x')
    // 样式：格级 (0,2) 保留；列级 col 2 越界丢弃；行高 (2,48) 保留、(5,60) 丢弃
    expect(smaller.getStyle(0, 2)?.color).toBe('#00ff00')
    expect(smaller.getColumnStyle(2)).toBeUndefined()
    expect(smaller.getRowHeight(2)).toBe(48)
    expect(smaller.getRowHeight(5)).toBe(30)
    // meta：越界格坐标条目经 setCellMeta 空操作丢弃，界内保留
    expect(smaller.entriesCellMeta('binding')).toEqual([
      { col: 1, row: 2, value: { field: 'sales' } },
    ])
    expect(smaller.getCellMeta('format', 1, 2)).toBe('0.00')
  })

  it('广播收敛：灌回不逐格广播，完成后发一次 rebuild 汇总 + 每个触碰命名空间一条 meta 汇总', () => {
    const snap = snapshot(createPopulatedStore())
    const target = new SheetStore(STORE_OPTIONS)
    target.setCellMeta('stale-ns', 0, 0, 's')
    const changes: string[] = []
    const metaEvents: { ns: string; col?: number; row?: number }[] = []
    target.onChange((event) => changes.push(event.type))
    target.onMetaChange((event) => metaEvents.push(event))

    restore(target, snap)

    expect(changes).toEqual(['rebuild'])
    expect(metaEvents).toEqual([{ ns: 'binding' }, { ns: 'format' }, { ns: 'stale-ns' }])
  })

  it('wiring 缺省：不接线也可灌回（images/selection 仅随快照存在，不强制应用）', () => {
    const snap = snapshot(createPopulatedStore(), { images: IMAGES, selection: SELECTION })
    const target = new SheetStore(STORE_OPTIONS)
    expect(() => restore(target, snap)).not.toThrow()
    expect(target.getValue(0, 0)).toBe('A1')
  })
})

describe('快照/恢复全量往返等价', () => {
  it('snapshot → restore → snapshot 深等价（九字段全量，images/selection 经接线回采）', () => {
    const snap1 = snapshot(createPopulatedStore(), { images: IMAGES, selection: SELECTION })
    const target = new SheetStore(STORE_OPTIONS)
    const { wiring, applied } = createWiringRecorder()
    restore(target, snap1, wiring)

    // 宿主把接线收到的 images/selection 视作引擎侧状态回采
    const snap2 = snapshot(target, { images: applied.images ?? [], selection: applied.selection })
    expect(snap2).toEqual(snap1)

    // 再来一轮（恢复态再次快照/灌回）仍稳定
    const target3 = new SheetStore(STORE_OPTIONS)
    const recorder3 = createWiringRecorder()
    restore(target3, snap2, recorder3.wiring)
    expect(
      snapshot(target3, {
        images: recorder3.applied.images ?? [],
        selection: recorder3.applied.selection,
      }),
    ).toEqual(snap1)
  })

  it('空快照往返：空白 Store 恢复到已布置 Store 后等价于空白', () => {
    const emptySnap = snapshot(new SheetStore(STORE_OPTIONS))
    const target = createPopulatedStore()
    restore(target, emptySnap)
    const snap2 = snapshot(target)
    expect(snap2).toEqual(emptySnap)
    expect(target.getValue(0, 0)).toBeUndefined()
    expect(target.getStyle(1, 1)).toBeUndefined()
  })
})

describe('SheetStore rebuild 批量重建支撑入口', () => {
  it('括号内写路径静默，收口发一次 rebuild 汇总；meta 按命名空间汇总；收口后恢复正常逐项广播', () => {
    const store = new SheetStore(STORE_OPTIONS)
    const changes: string[] = []
    const metaEvents: { ns: string; col?: number; row?: number }[] = []
    store.onChange((event) => changes.push(event.type))
    store.onMetaChange((event) => metaEvents.push(event))

    store.rebuild(() => {
      store.setValue(0, 0, 'a')
      store.setValue(1, 0, 'b')
      store.setStyle(0, 0, { color: '#000' })
      store.setCellMeta('binding', 0, 0, 'x')
      store.setCellMeta('format', 1, 1, 'y')
    })
    expect(changes).toEqual(['rebuild'])
    expect(metaEvents).toEqual([{ ns: 'binding' }, { ns: 'format' }])
    expect(store.getValue(0, 0)).toBe('a')

    changes.length = 0
    metaEvents.length = 0
    store.setValue(2, 2, 'c')
    store.setCellMeta('binding', 2, 2, 'z')
    expect(changes).toEqual(['value'])
    expect(metaEvents).toEqual([{ ns: 'binding', col: 2, row: 2 }])
  })

  it('嵌套 rebuild 只在最外层收口时汇总一次', () => {
    const store = new SheetStore(STORE_OPTIONS)
    const changes: string[] = []
    store.onChange((event) => changes.push(event.type))
    store.rebuild(() => {
      store.setValue(0, 0, 'a')
      store.rebuild(() => {
        store.setValue(1, 1, 'b')
      })
      expect(changes).toEqual([])
    })
    expect(changes).toEqual(['rebuild'])
  })

  it('update 抛错：状态保留已写部分、仍收口发一次汇总，异常原样上抛', () => {
    const store = new SheetStore(STORE_OPTIONS)
    const changes: string[] = []
    store.onChange((event) => changes.push(event.type))
    expect(() =>
      store.rebuild(() => {
        store.setValue(0, 0, 'kept')
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(store.getValue(0, 0)).toBe('kept')
    expect(changes).toEqual(['rebuild'])
    // 收口后无残留：后续正常写逐项广播
    changes.length = 0
    store.setValue(1, 1, 'after')
    expect(changes).toEqual(['value'])
  })
})
