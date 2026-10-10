// @vitest-environment happy-dom
// 原生滚动条挂载安全：真实滚动容器落宿主容器（overflow 滚动 + scrollbar-gutter
// stable）、无自建 thumb/track 部件、四层 canvas 落滚动容器 sticky 视口内、
// canvas 模式挂载路径不受影响、destroy 清理干净；滚动范围随内容尺寸更新、
// 视口走滚动容器 clientWidth 口径、DOM↔引擎滚动同步。
// 默认几何：行号列 48、列头 36、行高 32、列宽 100；400×200 视口 10 列
// （contentWidth 1000）× 100 行（contentHeight 3200）——happy-dom 无布局，
// clientWidth=0 回落逻辑尺寸 → 视口 352×164、maxLeft 648、maxTop 3036。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../../src/list-table'
import type { ListTableOptions } from '../../src/types'

const COLUMNS = Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` }))

function mountNative(extra: Partial<ListTableOptions> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const table = new ListTable({
    width: 400,
    height: 200,
    columns: COLUMNS,
    rowCount: 100,
    scrollbar: { mode: 'native' },
    hostOptions: { container },
    ...extra,
  })
  return { container, table }
}

/** 挂载树三件套：wrapper（滚动容器）→ spacer（撑滚动范围）→ viewport（sticky 层挂载点） */
function nativeParts(container: HTMLElement) {
  const wrapper = container.querySelector<HTMLElement>('[data-native-scroll]')
  if (!wrapper) {
    throw new Error('原生滚动容器未落宿主容器')
  }
  const spacer = wrapper.firstElementChild as HTMLElement
  const viewport = spacer.firstElementChild as HTMLElement
  return { wrapper, spacer, viewport }
}

describe('happy-dom 原生滚动条挂载', () => {
  it('滚动 wrapper 落宿主容器：overflow 滚动 + scrollbar-gutter: stable；无自建 thumb/track', () => {
    const { container, table } = mountNative()
    expect(table.usesNativeScrollbar).toBe(true)
    const { wrapper, spacer, viewport } = nativeParts(container)
    expect(wrapper.style.overflow).toBe('scroll')
    expect(wrapper.style.getPropertyValue('scrollbar-gutter')).toBe('stable')
    expect(wrapper.style.width).toBe('400px')
    expect(wrapper.style.height).toBe('200px')
    // 无自建滚动条部件：wrapper 内除 spacer/viewport 与层 canvas 外无其它元素
    const divs = [...wrapper.querySelectorAll('div')]
    expect(divs).toHaveLength(2)
    expect(divs).toContain(spacer)
    expect(divs).toContain(viewport)
    expect(
      wrapper.querySelector('[class*="scrollbar"], [class*="thumb"], [class*="track"]'),
    ).toBeNull()
    table.destroy()
  })

  it('四层 canvas 落滚动容器 sticky 视口内', () => {
    const { container, table } = mountNative()
    const { viewport } = nativeParts(container)
    expect(viewport.style.position).toBe('sticky')
    expect(viewport.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2)
    expect(viewport.querySelector('[data-layer-kind="body"]')).not.toBeNull()
    expect(viewport.querySelector('[data-layer-kind="sky"]')).not.toBeNull()
    table.destroy()
  })

  it('canvas 模式挂载路径不受影响（无滚动容器，canvas 直落容器）', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: COLUMNS,
      rowCount: 100,
      hostOptions: { container },
    })
    expect(table.usesNativeScrollbar).toBe(false)
    expect(container.querySelector('[data-native-scroll]')).toBeNull()
    expect(container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('[data-layer-kind="body"]')).not.toBeNull()
    table.destroy()
  })

  it('destroy 后容器清理干净（幂等）', () => {
    const { container, table } = mountNative()
    table.destroy()
    table.destroy()
    expect(container.childNodes.length).toBe(0)
  })

  it('滚动范围随内容尺寸更新：spacer 与 maxLeft/maxTop 同构', () => {
    const { container, table } = mountNative()
    const { spacer } = nativeParts(container)
    expect(spacer.style.width).toBe(`${400 + 648}px`)
    expect(spacer.style.height).toBe(`${200 + 3036}px`)
    // 行数翻倍：contentHeight 6400 → maxTop 6400 − 164 = 6236
    table.setRowCount(200)
    expect(spacer.style.height).toBe(`${200 + 6236}px`)
    table.destroy()
  })

  it('视口口径走滚动容器 clientWidth/clientHeight（模拟布局扣 gutter）；canvas 预留为 0', () => {
    const { container, table } = mountNative()
    const { wrapper, spacer } = nativeParts(container)
    Object.defineProperty(wrapper, 'clientWidth', { value: 380 })
    Object.defineProperty(wrapper, 'clientHeight', { value: 180 })
    expect(table.viewportWidth).toBe(380 - 48)
    expect(table.viewportHeight).toBe(180 - 36)
    expect(table.scrollbarGutterWidth).toBe(0)
    expect(table.scrollbarGutterHeight).toBe(0)
    // 几何变更重算后滚动范围随新口径同步：视口 332×144 → maxLeft 668、maxTop 3056
    table.applyGeometryChange()
    expect(spacer.style.width).toBe(`${380 + 668}px`)
    expect(spacer.style.height).toBe(`${180 + 3056}px`)
    table.destroy()
  })

  it('DOM↔引擎滚动同步：scroll 事件→状态；程序化滚动→写回', () => {
    const { container, table } = mountNative()
    const { wrapper } = nativeParts(container)
    wrapper.scrollTop = 100
    wrapper.dispatchEvent(new Event('scroll'))
    expect(table.getScrollTop()).toBe(100)
    table.scrollTo(30, 150)
    expect(wrapper.scrollLeft).toBe(30)
    expect(wrapper.scrollTop).toBe(150)
    table.destroy()
  })
})
