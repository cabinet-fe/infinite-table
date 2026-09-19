import { SceneNode } from '@infinite-table/render'
import type { Region, SceneEvent, SceneEventType } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import {
  FILL_HANDLE_SIZE,
  fillHandleRect,
  hitFillHandle,
  resolveFocusRange,
  type FillDragEndEvent,
  type FillHandleDownEvent,
} from '../src/fill-handle'
import { InteractionOverlay } from '../src/interaction-overlay'
import type { OverlayContent } from '../src/interaction-overlay'
import { ListTable } from '../src/list-table'
import type { SelectionRange, SelectionSnapshot } from '../src/selection'
import { defaultTheme } from '../src/theme'
import type { ListTableOptions } from '../src/types'
import { RecordingContext } from './testing/recording-context'
import { StubHost } from './testing/stub-host'

describe('resolveFocusRange 焦点段', () => {
  it('无选区返回 null', () => {
    expect(resolveFocusRange({ ranges: [], focus: null })).toBeNull()
  })

  it('多段时返回焦点格所在段', () => {
    const ranges: SelectionRange[] = [
      { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      { start: { col: 3, row: 2 }, end: { col: 4, row: 3 } },
    ]
    const snapshot: SelectionSnapshot = { ranges, focus: { col: 4, row: 2 } }
    expect(resolveFocusRange(snapshot)).toBe(ranges[1])
  })

  it('焦点不在任何段内时返回末段', () => {
    const ranges: SelectionRange[] = [
      { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      { start: { col: 3, row: 2 }, end: { col: 4, row: 3 } },
    ]
    expect(resolveFocusRange({ ranges, focus: { col: 9, row: 9 } })).toBe(ranges[1])
    expect(resolveFocusRange({ ranges, focus: null })).toBe(ranges[1])
  })
})

describe('fillHandleRect 与 hitFillHandle', () => {
  const cell: Region = { x: 148, y: 36, width: 100, height: 32 }

  it('方点骑在右下角格的角点上（向内外各伸半边长）', () => {
    expect(fillHandleRect(cell)).toEqual({
      x: 148 + 100 - FILL_HANDLE_SIZE / 2,
      y: 36 + 32 - FILL_HANDLE_SIZE / 2,
      width: FILL_HANDLE_SIZE,
      height: FILL_HANDLE_SIZE,
    })
  })

  it('命中判定：角点及格外一半在内，格中心与超出方点在外', () => {
    const cornerX = 148 + 100
    const cornerY = 36 + 32
    expect(hitFillHandle(cornerX, cornerY, cell)).toBe(true)
    expect(hitFillHandle(cornerX + 3, cornerY + 3, cell)).toBe(true)
    expect(hitFillHandle(148 + 50, 36 + 16, cell)).toBe(false)
    expect(hitFillHandle(cornerX + 5, cornerY, cell)).toBe(false)
    expect(hitFillHandle(cornerX, cornerY - 5, cell)).toBe(false)
  })
})

describe('InteractionOverlay 绘制填充柄', () => {
  const geometry = {
    cellRect: (col: number, row: number): Region => ({
      x: 48 + col * 100,
      y: 36 + row * 32,
      width: 100,
      height: 32,
    }),
    bodyViewport: { x: 48, y: 36, width: 752, height: 564 },
  }

  function makeContent(ranges: SelectionRange[], focus: SelectionSnapshot['focus']) {
    const rangesSnapshot: SelectionSnapshot = { ranges, focus }
    const content: OverlayContent = {
      selection: rangesSnapshot,
      hover: null,
      resizeLine: null,
      fillHandleRange: resolveFocusRange(rangesSnapshot),
      fillPreview: null,
      window: { rows: { start: 0, end: 100 }, cols: { start: 0, end: 100 } },
    }
    return content
  }

  it('同帧绘制全部选区段，并在焦点段右下角画柄方点', () => {
    const skyRoot = new SceneNode()
    const overlay = new InteractionOverlay(skyRoot, geometry, defaultTheme.interaction)
    const node = skyRoot.children[0]!
    const ranges: SelectionRange[] = [
      { start: { col: 0, row: 0 }, end: { col: 1, row: 0 } },
      { start: { col: 3, row: 2 }, end: { col: 4, row: 3 } },
    ]
    expect(overlay.update(makeContent(ranges, { col: 4, row: 3 }))).toBe(true)

    const ctx = new RecordingContext()
    node.paint(ctx)
    const rects = ctx.callsOf('fillRect').map((call) => call.args)
    // 两个选区段的填充矩形同帧出现（窗口内未被裁剪）
    expect(rects).toContainEqual([48, 36, 200, 32])
    expect(rects).toContainEqual([348, 100, 200, 64])
    // 柄方点：焦点段右下角格 (4,3) 的角点上，FILL_HANDLE_SIZE 见方
    expect(rects).toContainEqual([544, 160, FILL_HANDLE_SIZE, FILL_HANDLE_SIZE])
  })

  it('无选区时不画柄且浮层无内容', () => {
    const skyRoot = new SceneNode()
    const overlay = new InteractionOverlay(skyRoot, geometry, defaultTheme.interaction)
    const node = skyRoot.children[0]!
    expect(overlay.update(makeContent([], null))).toBe(false)

    const ctx = new RecordingContext()
    node.paint(ctx)
    expect(ctx.callsOf('fillRect')).toEqual([])
  })
})

// ---- ListTable 集成：填充柄按下/拖拽结束两个公开事件（交互路径） ----

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  columns: Array.from({ length: 8 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, ...extra })
  host.submitted.length = 0
  return { host, table }
}

/** 绕过 EventSystem 直接在场景根上派发事件（hit-test 已由坐标换算替代） */
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

describe('ListTable 填充柄事件载荷', () => {
  it('按下事件携带柄所在选区段且不改选区；拖拽松开抛锚定段范围与目标格范围；无写值', () => {
    const records = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
    const { host, table } = createTable({ records })
    table.selectCells([{ start: { col: 0, row: 0 }, end: { col: 1, row: 0 } }])
    const downs: FillHandleDownEvent[] = []
    const ends: FillDragEndEvent[] = []
    table.onFillHandleDown((event) => downs.push(event))
    table.onFillDragEnd((event) => ends.push(event))

    // 柄方点：焦点段右下角格 (1,0) 的角点 (248, 68)，8px 见方，取角点按下
    fireBody(host, 'pointerdown', { x: 248, y: 68 })
    expect(downs).toEqual([{ range: { start: { col: 0, row: 0 }, end: { col: 1, row: 0 } } }])
    // 按下不改变选区
    expect(table.getSelectedCellRanges()).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 1, row: 0 } },
    ])

    fireBody(host, 'pointermove', { x: cellX(3), y: cellY(2) })
    fireBody(host, 'pointerup', { x: cellX(3), y: cellY(2) })
    expect(ends).toEqual([
      {
        anchor: { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 },
        // 轴锁定：行/列位移同为 2 时取纵向，列夹回锚定段跨度（不再产生对角目标）
        target: { minCol: 1, minRow: 0, maxCol: 1, maxRow: 2 },
      },
    ])
    // 填充生成不在内核：记录与选区均未被改动
    expect(records).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    expect(table.getSelectedCellRanges()).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 1, row: 0 } },
    ])
  })

  it('轴锁定：纯向下拖拽带横向漂移不产生侧向扩展；原地按压松开无扩展', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ name: `r${i}` }))
    const { host, table } = createTable({ records })
    table.selectCells([{ start: { col: 0, row: 0 }, end: { col: 1, row: 0 } }])
    const ends: FillDragEndEvent[] = []
    table.onFillDragEnd((event) => ends.push(event))

    // 从柄角点 (248,68) 按下（裸命中即 (2,1) 格），向下拖 2 行且横向漂到 D 列再折回 A 列
    fireBody(host, 'pointerdown', { x: 248, y: 68 })
    fireBody(host, 'pointermove', { x: cellX(3), y: cellY(2) })
    fireBody(host, 'pointermove', { x: cellX(0), y: cellY(3) })
    fireBody(host, 'pointerup', { x: cellX(0), y: cellY(3) })
    expect(ends).toEqual([
      {
        anchor: { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 },
        // 纵向为主轴：列始终夹在锚定段跨度 [0,1] 内，目标只向下扩展（漂移不产生侧向填充）
        target: { minCol: 0, minRow: 0, maxCol: 1, maxRow: 3 },
      },
    ])

    // 原地按压松开（角点裸命中 (2,1)，无位移）：目标退化为原点，无扩展
    ends.length = 0
    table.selectCells([{ start: { col: 0, row: 0 }, end: { col: 1, row: 0 } }])
    fireBody(host, 'pointerdown', { x: 248, y: 68 })
    fireBody(host, 'pointerup', { x: 248, y: 68 })
    expect(ends).toEqual([
      {
        anchor: { minCol: 0, minRow: 0, maxCol: 1, maxRow: 0 },
        target: { minCol: 1, minRow: 0, maxCol: 1, maxRow: 0 },
      },
    ])
  })

  it('边缘自动滚动：拖拽驻留视口底缘时按帧续滚并扩展目标；退订事件后会话结束', () => {
    const records = Array.from({ length: 60 }, (_, i) => ({ name: `r${i}` }))
    const { host, table } = createTable({ records })
    // 视口高 600、列头 36 → 可视约 17 行；选区底部在可视区内
    table.selectCells([{ start: { col: 0, row: 10 }, end: { col: 1, row: 12 } }])
    const ends: FillDragEndEvent[] = []
    table.onFillDragEnd((event) => ends.push(event))

    // 柄角点：焦点段右下角格 (1,12) 的右下角 (248, 36 + 13*32)
    const cornerY = 36 + 13 * 32
    fireBody(host, 'pointerdown', { x: 248, y: cornerY })
    // 拖到视口底缘区内并驻留：StubHost 同步执行帧任务，逐帧续滚直到指针位置换算的终点行稳定
    fireBody(host, 'pointermove', { x: 200, y: 596 })
    fireBody(host, 'pointerup', { x: 200, y: 596 })
    expect(ends).toHaveLength(1)
    const target = ends[0]!.target
    // 底缘驻留自动滚动后目标显著越过初始可视窗口（60 行内容可滚）
    expect(target.maxRow).toBeGreaterThan(20)
    expect(target.maxCol).toBe(1)
    expect(table.getScrollTop()).toBeGreaterThan(0)
  })

  it('非柄区域按下不抛事件；退订后不再触发且选区不受柄按压影响', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    table.selectCells([{ start: { col: 0, row: 0 }, end: { col: 1, row: 0 } }])
    let downs = 0
    let ends = 0
    const offDown = table.onFillHandleDown(() => downs++)
    const offEnd = table.onFillDragEnd(() => ends++)

    // 格中心（非柄区域）按下：不抛按下事件，走普通选区路径
    fireBody(host, 'pointerdown', { x: cellX(0), y: cellY(0) })
    fireBody(host, 'pointerup', { x: cellX(0), y: cellY(0) })
    expect(downs).toBe(0)
    expect(ends).toBe(0)

    offDown()
    offEnd()
    // 恢复两格选区后，柄上按下：无订阅者时同样不产生任何行为（不改选区、无事件）
    table.selectCells([{ start: { col: 0, row: 0 }, end: { col: 1, row: 0 } }])
    fireBody(host, 'pointerdown', { x: 248, y: 68 })
    fireBody(host, 'pointerup', { x: 248, y: 68 })
    expect(table.getSelectedCellRanges()).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 1, row: 0 } },
    ])
  })
})
