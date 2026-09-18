import { describe, expect, it } from 'vitest'

import { SceneNode } from '@infinite-table/render'
import type { SceneEvent, SceneEventType } from '@infinite-table/render'

import { ListTable } from '@infinite-table/core'

import { bindFillGeneration, type FillCell } from '../../src/sheet/fill'
import { SheetStore } from '../../src/sheet/sheet-store'
import { StubHost } from '../testing/stub-host'

/** 绕过 EventSystem 直接在场景根上派发事件（对齐 core 交互测试做法） */
function fire(root: SceneNode, type: SceneEventType, x: number, y: number): void {
  root.handleEvent({
    type,
    target: null,
    x,
    y,
    deltaX: 0,
    deltaY: 0,
    key: undefined,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    originalEvent: {},
  } as SceneEvent)
}

/** 默认几何：行号列 48、列头 36、列宽 100、行高 32；数据格 (col,row) 左上角 (48+col*100, 36+row*32) */
function setup(values: Record<string, unknown> = {}): {
  store: SheetStore
  host: StubHost
  table: ListTable
  root: SceneNode
} {
  const store = new SheetStore({ rowCount: 50, colCount: 5 })
  for (const [key, value] of Object.entries(values)) {
    const [col, row] = key.split(',').map(Number)
    store.setValue(col!, row!, value)
  }
  const host = new StubHost()
  const table = new ListTable({
    width: 600,
    height: 300,
    rowHeight: 32,
    headerHeight: 36,
    rowHeaderWidth: 48,
    columns: [{ field: 'c0' }, { field: 'c1' }],
    model: store.asModel(),
    host,
  })
  return { store, host, table, root: host.layers.get('body')!.root }
}

describe('bindFillGeneration 接线', () => {
  it('填充柄按下拖拽 → onFillDragEnd 驱动 write 收到序列值；不写 anchor 区', () => {
    const { store, table, root } = setup({ '0,0': 5 })
    table.selectCell(0, 0)
    const written: FillCell[] = []
    const unsubscribe = bindFillGeneration({
      table,
      read: (col, row) => store.getValue(col, row),
      write: (cells) => {
        written.push(...cells)
      },
    })

    // 填充柄挂在锚定段右下角格 (0,0) 的右下角点：格矩形 48..148 × 36..68，柄方点 144..148 × 64..68
    fire(root, 'pointerdown', 146, 66)
    // 拖到格 (0,3)（纵向 132..164）中心
    fire(root, 'pointermove', 98, 148)
    fire(root, 'pointerup', 98, 148)

    expect(written.map((cell) => cell.row)).toEqual([1, 2, 3])
    expect(written.map((cell) => cell.value)).toEqual([6, 7, 8])
    expect(store.getValue(0, 0)).toBe(5)
    unsubscribe()
  })

  it('宿主 write 内经 batchUpdate 收敛为一次 band 失效', () => {
    const { store, table, root } = setup({ '0,0': 1 })
    table.selectCell(0, 0)
    const host = table.host as StubHost
    bindFillGeneration({
      table,
      read: (col, row) => store.getValue(col, row),
      write: (cells) => {
        table.batchUpdate(() => {
          for (const cell of cells) {
            store.setValue(cell.col, cell.row, cell.value)
          }
        })
      },
    })
    host.submitted.length = 0
    fire(root, 'pointerdown', 146, 66)
    fire(root, 'pointermove', 98, 148)
    fire(root, 'pointerup', 98, 148)

    expect(store.getValue(0, 1)).toBe(2)
    expect(store.getValue(0, 3)).toBe(4)
    // body 侧只有 batchUpdate 收敛出的一次 band
    const bodyInvs = host.submitted.filter((entry) => entry.kind === 'body').map((e) => e.inv.type)
    expect(bodyInvs).toEqual(['band'])
  })
})
