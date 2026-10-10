// @vitest-environment happy-dom
// SheetGrid 原生滚动条模式（scrollbar.mode: 'native' 透传）：
// 配置全形态透传（构造后引擎收到等价配置）、宿主滚轮接线让位（原生容器接管，
// 单次增量恰好一次位移不双滚）、growOnScroll 扩容后原生容器滚动范围与
// ScrollManager 边界一致。
// 默认几何：行号列 46、列头 28、行高 28、列宽 80；800×600 视口（happy-dom
// 无布局，滚动容器 clientWidth/clientHeight 回落逻辑尺寸 → 纵向视口 572）。

import './setup'

import { describe, expect, it } from 'vitest'

import { SHEET_HEADER_HEIGHT } from '../../src/grid/grid-theme'
import { createGrid, VIEW_H, VIEW_W } from './grid-test-utils'

/** 滚动树三件套：wrapper（滚动容器）→ spacer（撑滚动范围）→ viewport（sticky 层挂载点） */
function nativeParts(container: HTMLElement) {
  const wrapper = container.querySelector<HTMLElement>('[data-native-scroll]')
  if (!wrapper) {
    throw new Error('原生滚动容器未落宿主容器')
  }
  const spacer = wrapper.firstElementChild as HTMLElement
  return { wrapper, spacer }
}

/** 向容器派发滚轮事件（口径同 sheet-grid.test.ts 宿主滚轮用例） */
function fireWheel(container: HTMLElement, deltaY: number): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY })
  container.dispatchEvent(event)
  return event
}

describe('SheetGrid scrollbar 透传（构造后引擎收到等价配置）', () => {
  it("mode: 'native'：引擎原生档生效——挂载容器内真实滚动容器 + gutter stable 预留", () => {
    const { grid, table, container } = createGrid({
      scrollbar: { mode: 'native' },
      rows: 40,
      cols: 20,
    })
    try {
      expect(table.usesNativeScrollbar).toBe(true)
      const { wrapper } = nativeParts(container)
      expect(wrapper.style.overflow).toBe('scroll')
      expect(wrapper.style.getPropertyValue('scrollbar-gutter')).toBe('stable')
      // 原生档 canvas 预留轨道为 0（gutter 由滚动容器布局扣除）
      expect(table.scrollbarGutterWidth).toBe(0)
      expect(table.scrollbarGutterHeight).toBe(0)
    } finally {
      grid.release()
    }
  })

  it('canvas 档对象形态字段生效：reserve 关闭则画布预留轨道为 0（区别于缺省 10）', () => {
    const { grid, table } = createGrid({
      scrollbar: { visibility: 'always', reserve: false },
      rows: 40,
      cols: 6,
    })
    try {
      expect(table.usesNativeScrollbar).toBe(false)
      // 内容 40×28 = 1120 > 600 − 28 纵向可滚：缺省 reserve 会预留 scrollbarSize(10)
      expect(table.scrollbarGutterWidth).toBe(0)
    } finally {
      grid.release()
    }
  })

  it('缺省与 false 形态不变：缺省 canvas 档纵向预留 10；false 整体关闭无预留', () => {
    const { grid: def, table: defTable } = createGrid({ rows: 40, cols: 6 })
    try {
      expect(defTable.usesNativeScrollbar).toBe(false)
      expect(defTable.scrollbarGutterWidth).toBe(10)
    } finally {
      def.release()
    }
    const { grid: off, table: offTable } = createGrid({ scrollbar: false, rows: 40, cols: 6 })
    try {
      expect(offTable.usesNativeScrollbar).toBe(false)
      expect(offTable.scrollbarGutterWidth).toBe(0)
    } finally {
      off.release()
    }
  })
})

describe('SheetGrid 宿主滚轮让位（原生模式不双滚）', () => {
  it('原生容器滚动为唯一位移源：位移 == 增量；宿主 wheel 接线不再位移、不吞事件', () => {
    const { grid, table, container } = createGrid({
      scrollbar: { mode: 'native' },
      rows: 40,
      cols: 6,
    })
    try {
      // 模拟用户滚轮/触控板：原生容器偏移 + 浏览器派发 scroll → 引擎状态同步
      const { wrapper } = nativeParts(container)
      wrapper.scrollTop = 120
      wrapper.dispatchEvent(new Event('scroll'))
      expect(table.getScrollTop()).toBe(120)

      // 宿主既有滚轮接线让位：事件经容器冒泡不 preventDefault、不 scrollBy
      // （若未让位则 scrollTop 会再 +100 产生双滚）
      const event = fireWheel(container, 100)
      expect(event.defaultPrevented).toBe(false)
      expect(table.getScrollTop()).toBe(120)

      // 后续原生增量照常推进（位移 == 增量，无残留接线）
      wrapper.scrollTop = 150
      wrapper.dispatchEvent(new Event('scroll'))
      expect(table.getScrollTop()).toBe(150)
    } finally {
      grid.release()
    }
  })
})

describe('SheetGrid growOnScroll 扩容与原生滚动范围同步', () => {
  /** 冲一帧 rAF：onScrollFrame 合帧任务落地（增长接线在其内） */
  const flushFrame = async (): Promise<void> => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  /** 引擎纵向滚动边界（ScrollManager maxTop）：内容高 − 纵向视口高 */
  const maxTopOf = (rowCount: number): number => rowCount * 28 - (VIEW_H - SHEET_HEADER_HEIGHT)

  it('扩容后 spacer 撑出的滚动范围与 ScrollManager 边界一致（viewport + maxTop 同构）', async () => {
    const { grid, table, sheet, container } = createGrid({
      scrollbar: { mode: 'native' },
      rows: undefined,
      cols: 6,
      growOnScroll: true,
    })
    try {
      const { wrapper, spacer } = nativeParts(container)
      // 初始 100 行（视口 600 下限）：contentHeight 2800 → maxTop 2800 − 572
      const initialRows = sheet.rows
      expect(initialRows).toBe(100)
      expect(spacer.style.height).toBe(`${Math.ceil(VIEW_H + maxTopOf(initialRows))}px`)

      // 滚到底触发扩容：行数增长，引擎与原生容器滚动范围同步到新边界
      table.setScrollTop(Number.MAX_SAFE_INTEGER)
      await flushFrame()
      const grownRows = sheet.rows
      expect(grownRows).toBeGreaterThan(initialRows)
      expect(table.rowCount).toBe(grownRows)
      expect(spacer.style.height).toBe(`${Math.ceil(VIEW_H + maxTopOf(grownRows))}px`)
      // 滚动容器自身尺寸 = 表 CSS 视口（800×600，不随内容增长）
      expect(wrapper.style.width).toBe(`${VIEW_W}px`)
      expect(wrapper.style.height).toBe(`${VIEW_H}px`)
    } finally {
      grid.release()
    }
  })
})
