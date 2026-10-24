// 浮动对象右键不穿透（hyperlink-image P5）：contextmenu 路由以「浮动层优先」命中——
// 右键浮动图片不派发单元格右键事件，改派发携带 id/落点的浮动对象右键事件；
// 未命中浮动层时单元格右键事件序列与现状完全一致（回归保护）。

import type { SceneEvent, SceneEventType } from '@infinitable/render'

import { describe, expect, it, vi } from 'vitest'

import type { FloatContextMenuEvent } from '@infinitable/grid'
import { ListTable } from '../../src/list-table'
import type { ListTableOptions, TableContextMenuEvent } from '../../src/types'
import { StubHost } from '../testing/stub-host'

const BASE_OPTIONS = {
  width: 400,
  height: 260,
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  columns: [
    { field: 'a', title: 'A' },
    { field: 'b', title: 'B' },
  ],
} satisfies Partial<ListTableOptions>

/**
 * 台架：表上叠一个 120×80 浮动图片（锚在 (0,2) 格 + (10,10) 偏移 → 覆盖
 * (58,110)–(178,190)，压在第 0/1 列数据格上；无 imageService，占位即可）。
 */
function mountTable() {
  const host = new StubHost()
  const table = new ListTable({
    ...BASE_OPTIONS,
    records: Array.from({ length: 8 }, (_, i) => ({ a: `r${i}`, b: `r${i}` })),
    host,
  })
  table.floatObjects.add({
    id: 'fx',
    kind: 'image',
    anchor: { from: { col: 0, row: 2 }, to: { col: 1, row: 3 }, offsetX: 10, offsetY: 10 },
    size: { width: 120, height: 80 },
  })
  host.submitted.length = 0
  return { host, table }
}

/** 绕过 EventSystem 直接在 body 场景根上派发事件（与既有 contextmenu 用例同口径） */
function fireBody(host: StubHost, type: SceneEventType, init: Partial<SceneEvent>): void {
  host.layers.get('body')!.root.handleEvent({
    type,
    target: null,
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY: 0,
    key: undefined,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    originalEvent: {},
    ...init,
  })
}

// 数据格 (col, row) 的视口坐标（默认几何：行号列 48、列头 36、列宽 100、行高 32）
const cellX = (col: number) => 48 + col * 100 + 1
const cellY = (row: number) => 36 + row * 32 + 1

/** 浮动图片中心（对象覆盖 (58,110)–(178,190)） */
const FLOAT_CENTER = { x: 118, y: 150 }

describe('浮动对象右键不穿透（contextmenu 浮动层优先）', () => {
  it('命中浮动图片：无单元格右键事件，浮动对象右键事件载荷含 id 与落点', () => {
    const { host, table } = mountTable()
    const originalEvent = { preventDefault: () => {} }
    const cellSeen: TableContextMenuEvent[] = []
    const floatSeen: FloatContextMenuEvent[] = []
    table.onContextMenu((event) => cellSeen.push(event))
    table.floatObjects.onContextMenu((event) => floatSeen.push(event))

    fireBody(host, 'contextmenu', { ...FLOAT_CENTER, originalEvent })
    expect(cellSeen).toEqual([])
    expect(floatSeen).toHaveLength(1)
    expect(floatSeen[0]).toMatchObject({ id: 'fx', x: 118, y: 150 })
    expect(floatSeen[0]!.originalEvent).toBe(originalEvent)
  })

  it('未命中浮动层：单元格右键事件序列与现状一致（回归保护）', () => {
    const { host, table } = mountTable()
    const cellSeen: TableContextMenuEvent[] = []
    const floatSeen: FloatContextMenuEvent[] = []
    table.onContextMenu((event) => cellSeen.push(event))
    table.floatObjects.onContextMenu((event) => floatSeen.push(event))

    // 表体普通格（未被浮动图覆盖）+ 列头带 / 行号列带 / 角点（cell 为 null，region 归属现状）
    fireBody(host, 'contextmenu', { x: cellX(1), y: cellY(0) })
    fireBody(host, 'contextmenu', { x: cellX(1), y: 10 })
    fireBody(host, 'contextmenu', { x: 10, y: cellY(0) })
    fireBody(host, 'contextmenu', { x: 10, y: 10 })
    expect(floatSeen).toEqual([])
    expect(cellSeen.map((e) => ({ cell: e.cell, region: e.region, x: e.x, y: e.y }))).toEqual([
      { cell: { col: 1, row: 0 }, region: 'body', x: cellX(1), y: cellY(0) },
      { cell: null, region: 'col-header', x: cellX(1), y: 10 },
      { cell: null, region: 'row-header', x: 10, y: cellY(0) },
      // 角点（行号列×列头交叉）归 body 且 cell 为 null（类型注释定义的归属）
      { cell: null, region: 'body', x: 10, y: 10 },
    ])
  })

  it('命中浮动图片且宿主只订阅单元格右键：不穿透派发、不阻止原生菜单', () => {
    const preventDefault = vi.fn<() => void>()
    const { host, table } = mountTable()
    const cellSeen: TableContextMenuEvent[] = []
    table.onContextMenu((event) => cellSeen.push(event))

    fireBody(host, 'contextmenu', { ...FLOAT_CENTER, originalEvent: { preventDefault } })
    expect(cellSeen).toEqual([])
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('有浮动右键监听时阻止默认（原生菜单），退订后不再阻止也不再派发', () => {
    const preventDefault = vi.fn<() => void>()
    const { host, table } = mountTable()
    const floatSeen: FloatContextMenuEvent[] = []
    const off = table.floatObjects.onContextMenu((event) => floatSeen.push(event))

    fireBody(host, 'contextmenu', { ...FLOAT_CENTER, originalEvent: { preventDefault } })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(floatSeen).toHaveLength(1)

    off()
    fireBody(host, 'contextmenu', { ...FLOAT_CENTER, originalEvent: { preventDefault } })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(floatSeen).toHaveLength(1)
  })
})
