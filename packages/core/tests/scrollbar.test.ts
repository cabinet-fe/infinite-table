// 画布内建滚动条：几何换算 / 命中纯函数 + 真实表格交互（拖拽会话、轨道点按跳转、
// 选项关闭）。默认几何：行号列 48、列头 36、行高 32、列宽 100；800×600 视口下
// 10 列 100 行（两轴可滚，右/下缘各预留 10px 轨道 → 视口 742×554）→
// maxLeft = 1000 − 742 = 258、maxTop = 3200 − 554 = 2646。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import {
  hitScrollbar,
  mapScrollbarThumbDrag,
  mapScrollbarTrackPoint,
  MIN_SCROLLBAR_THUMB_PX,
  planScrollbarThumb,
} from '../src/scrollbar'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'
import type { SceneEvent, SceneEventType } from '@infinitable/render'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function rows(count: number): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({ name: `r${i}` }))
}

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, records: rows(100), ...extra })
  return { host, table }
}

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

describe('planScrollbarThumb 滑块几何', () => {
  it('溢出轴按「视口 /（视口+滚动余量）」比例定长，行程与滚动范围同构', () => {
    // 视口 400、余量 600 → 内容 1000 → 滑块 40% 轨道
    expect(planScrollbarThumb({ maxScroll: 600, viewport: 400, offset: 0 }, 500)).toEqual({
      trackLen: 500,
      thumbSize: 200,
      thumbPos: 0,
      maxScroll: 600,
    })
    // 滚到底：pos = 轨道 − 滑块
    expect(planScrollbarThumb({ maxScroll: 600, viewport: 400, offset: 600 }, 500)?.thumbPos).toBe(
      300,
    )
    // offset 超界按 0..maxScroll 钳制
    expect(planScrollbarThumb({ maxScroll: 600, viewport: 400, offset: -50 }, 500)?.thumbPos).toBe(
      0,
    )
    expect(planScrollbarThumb({ maxScroll: 600, viewport: 400, offset: 900 }, 500)?.thumbPos).toBe(
      300,
    )
  })

  it('无滚动余量 / 轨道非正返回 null；内容远超视口保持最小滑块', () => {
    expect(planScrollbarThumb({ maxScroll: 0, viewport: 400, offset: 0 }, 500)).toBeNull()
    expect(planScrollbarThumb({ maxScroll: 600, viewport: 400, offset: 0 }, 0)).toBeNull()
    expect(
      planScrollbarThumb({ maxScroll: 9600, viewport: 400, offset: 4800 }, 500)?.thumbSize,
    ).toBe(MIN_SCROLLBAR_THUMB_PX)
  })

  it('拖拽与轨道点按换算均钳制在 0..maxScroll', () => {
    const geometry = planScrollbarThumb({ maxScroll: 600, viewport: 400, offset: 300 }, 500)!
    // 轨道 500 / 滑块 200 → 可拖 300px 对应 600（1px = 2）
    expect(mapScrollbarThumbDrag(geometry, 300, 30)).toBe(360)
    expect(mapScrollbarThumbDrag(geometry, 0, -100)).toBe(0)
    expect(mapScrollbarThumbDrag(geometry, 500, 100)).toBe(600)
    expect(mapScrollbarTrackPoint(geometry, 250)).toBe(300)
    expect(mapScrollbarTrackPoint(geometry, -10)).toBe(0)
    expect(mapScrollbarTrackPoint(geometry, 999)).toBe(600)
  })
})

describe('hitScrollbar 命中判定', () => {
  const vertical = planScrollbarThumb({ maxScroll: 600, viewport: 400, offset: 0 }, 590)!
  const horizontal = planScrollbarThumb({ maxScroll: 600, viewport: 700, offset: 0 }, 790)!

  it('右缘条带命中竖轴（含列头带），下缘条带命中横轴；空白角不命中', () => {
    // 800×600 画布、size 10：竖条带 x∈[790,800) y∈[0,590)；横条带 y∈[590,600) x∈[0,790)
    expect(hitScrollbar(800, 600, 10, vertical, horizontal, 795, 100)).toEqual({
      axis: 'vertical',
      pointPx: 100,
      onThumb: true,
    })
    expect(hitScrollbar(800, 600, 10, vertical, horizontal, 100, 595)).toEqual({
      axis: 'horizontal',
      pointPx: 100,
      onThumb: true,
    })
    // 右下空白角
    expect(hitScrollbar(800, 600, 10, vertical, horizontal, 795, 595)).toBeNull()
    // 画布内部
    expect(hitScrollbar(800, 600, 10, vertical, horizontal, 400, 300)).toBeNull()
    // 轨道空白（超出滑块范围）
    expect(hitScrollbar(800, 600, 10, vertical, horizontal, 795, 400)?.onThumb).toBe(false)
  })

  it('该轴无滑块（不可滚动）时条带不命中', () => {
    expect(hitScrollbar(800, 600, 10, null, horizontal, 795, 100)).toBeNull()
    expect(hitScrollbar(800, 600, 10, vertical, null, 100, 595)).toBeNull()
  })
})

describe('ListTable 内建滚动条交互', () => {
  it('缺省开启：竖轴轨道点按跳转（点按处为滑块中心），拖拽按比例换算滚动', () => {
    const { host, table } = createTable()
    expect(table.getScrollTop()).toBe(0)

    // 竖轴轨道 y=300 点按（滑块 0..102，非滑块上）→ 跳转；trackLen 590、滑块 102
    fireBody(host, 'pointerdown', { x: 795, y: 300, button: 0 })
    const jumped = Math.round(((300 - 102 / 2) / (590 - 102)) * 2646)
    expect(table.getScrollTop()).toBe(jumped)

    // 拖拽 +50px：offset = jumped + 50×2646/488
    fireBody(host, 'pointermove', { x: 795, y: 350 })
    expect(table.getScrollTop()).toBeCloseTo(jumped + (50 * 2646) / 488, 5)

    // 会话中不落选区（无选区产生）
    expect(table.getSelection().ranges.length).toBe(0)

    fireBody(host, 'pointerup', { x: 795, y: 350 })
    fireBody(host, 'pointermove', { x: 795, y: 500 })
    // 会话已结束：后续 move 不再滚动
    const settled = table.getScrollTop()
    expect(settled).toBeCloseTo(jumped + (50 * 2646) / 488, 5)
  })

  it('滑块上按下直接起拖（无跳转）', () => {
    const { host, table } = createTable()
    // 滑块 0..102：y=50 在滑块上
    fireBody(host, 'pointerdown', { x: 795, y: 50, button: 0 })
    expect(table.getScrollTop()).toBe(0)
    fireBody(host, 'pointermove', { x: 795, y: 100 })
    expect(table.getScrollTop()).toBeCloseTo((50 * 2646) / (590 - 102), 5)
    fireBody(host, 'pointerup', { x: 795, y: 100 })
  })

  it('scrollbar: false 不命中条带（点按落入格交互）', () => {
    const { host, table } = createTable({ scrollbar: false })
    fireBody(host, 'pointerdown', { x: 795, y: 300, button: 0 })
    fireBody(host, 'pointermove', { x: 795, y: 350 })
    expect(table.getScrollTop()).toBe(0)
    // 800 宽第 795px 落在最后一列（752 视口内 col 7），按格拖选语义生效
    expect(table.getSelection().ranges.length).toBe(1)
  })

  it('内容不溢出的轴不命中', () => {
    // 3 列 × 100 = 300 + 48 = 348 < 800 → 横向不可滚
    const { host, table } = createTable({
      columns: Array.from({ length: 3 }, (_, i) => ({ field: 'name', title: `C${i}` })),
    })
    fireBody(host, 'pointerdown', { x: 700, y: 595, button: 0 })
    expect(table.getScrollLeft()).toBe(0)
    // 竖向仍可滚（100 行）
    fireBody(host, 'pointerdown', { x: 795, y: 300, button: 0 })
    expect(table.getScrollTop()).toBeGreaterThan(0)
  })
})
