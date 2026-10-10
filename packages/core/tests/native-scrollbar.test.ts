// 原生滚动条模式：配置归一化（canvas 档零变化 / native 档标记）+ 滚动同步协议
// （DOM scroll → 引擎状态、程序化滚动 → DOM 写回、防回环：单次增量位移 == 增量）。
// 滚动元素用替身注入（NativeScrollSurface 最小面）；DOM 装配与挂载断言见
// happy-dom/native-scrollbar-mount.test.ts。

import { describe, expect, it } from 'vitest'

import { NativeScrollbarHost } from '../src/native-scrollbar'
import { ScrollManager } from '../src/scroll-manager'
import { resolveScrollbarConfig } from '../src/scrollbar'

/** 滚动元素替身：固定视口尺寸（模拟已扣 gutter 的 clientWidth/clientHeight）+ 手动派发 scroll */
class FakeSurface {
  scrollLeft = 0
  scrollTop = 0
  readonly clientWidth: number
  readonly clientHeight: number
  private readonly listeners = new Set<() => void>()

  constructor(width: number, height: number) {
    this.clientWidth = width
    this.clientHeight = height
  }

  addEventListener(_type: 'scroll', listener: () => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'scroll', listener: () => void): void {
    this.listeners.delete(listener)
  }

  /** 浏览器滚动完成后派发 scroll 事件（真实环境由浏览器触发） */
  dispatchScroll(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

/** 视口 800×600、内容 1200×2000 → maxLeft 400、maxTop 1400 */
function createHost(width = 800, height = 600, contentWidth = 1200, contentHeight = 2000) {
  const scroll = new ScrollManager()
  const surface = new FakeSurface(width, height)
  const host = new NativeScrollbarHost({ surface, width, height, scroll })
  scroll.setViewportSize(width, height)
  scroll.setContentSize(contentWidth, contentHeight)
  return { scroll, surface, host }
}

describe('resolveScrollbarConfig 原生档', () => {
  it("mode: 'native' 输出原生档标记，canvas 档字段归一为不生效值", () => {
    expect(resolveScrollbarConfig({ mode: 'native' })).toEqual({
      enabled: true,
      mode: 'native',
      visibility: 'always',
      hideDelay: undefined,
      reserve: false,
    })
  })

  it('缺省/boolean/无 mode 对象不带原生标记（canvas 档输出逐字段不变）', () => {
    expect(resolveScrollbarConfig(undefined)).toEqual({
      enabled: true,
      visibility: 'hover',
      hideDelay: undefined,
      reserve: true,
    })
    expect(resolveScrollbarConfig(true).mode).toBeUndefined()
    expect(resolveScrollbarConfig({ visibility: 'always', hideDelay: 300 })).toEqual({
      enabled: true,
      visibility: 'always',
      hideDelay: 300,
      reserve: true,
    })
    expect(resolveScrollbarConfig({ mode: 'canvas' }).mode).toBeUndefined()
  })
})

describe('NativeScrollbarHost 同步协议', () => {
  it('DOM 滚动（滚轮/触控板/原生 thumb）→ 引擎状态：单次增量位移 == 增量', () => {
    const { scroll, surface } = createHost()
    let broadcasts = 0
    scroll.onScroll(() => broadcasts++)
    surface.scrollTop = 120
    surface.dispatchScroll()
    expect(scroll.state.top).toBe(120)
    expect(scroll.state.left).toBe(0)
    expect(broadcasts).toBe(1)
    surface.scrollLeft += 33
    surface.dispatchScroll()
    expect(scroll.state.left).toBe(33)
    expect(scroll.state.top).toBe(120)
    expect(broadcasts).toBe(2)
  })

  it('DOM 滚动钳制在引擎边界内（spacer 撑出的范围与 maxLeft/maxTop 同构）', () => {
    const { scroll, surface } = createHost()
    surface.scrollTop = 99999
    surface.dispatchScroll()
    expect(scroll.state.top).toBe(1400)
    surface.scrollLeft = -1
    surface.dispatchScroll()
    expect(scroll.state.left).toBe(0)
  })

  it('程序化滚动（scrollTo/scrollBy）→ 写回容器偏移', () => {
    const { scroll, surface } = createHost()
    scroll.scrollTo(100, 200)
    expect(surface.scrollLeft).toBe(100)
    expect(surface.scrollTop).toBe(200)
    scroll.scrollBy(50, 25)
    expect(surface.scrollLeft).toBe(150)
    expect(surface.scrollTop).toBe(225)
  })

  it('防回环：写回引发的 scroll 事件与状态相等即跳过（不二次广播、无放大）', () => {
    const { scroll, surface } = createHost()
    let broadcasts = 0
    scroll.onScroll(() => broadcasts++)
    scroll.scrollTo(0, 300)
    expect(broadcasts).toBe(1)
    // 浏览器对程序化赋值派发的 scroll 事件（替身同步模拟）：位置 == 状态 → 吸收
    surface.dispatchScroll()
    expect(broadcasts).toBe(1)
    expect(scroll.state.top).toBe(300)
    // 用户增量在此基础上恰好推进一次（位移 == 增量）
    surface.scrollTop = 340
    surface.dispatchScroll()
    expect(scroll.state.top).toBe(340)
    expect(broadcasts).toBe(2)
  })

  it('视口口径取滚动容器 clientWidth/clientHeight；无滚动元素回落逻辑尺寸', () => {
    const withSurface = new NativeScrollbarHost({
      surface: new FakeSurface(760, 560),
      width: 800,
      height: 600,
      scroll: new ScrollManager(),
    })
    expect(withSurface.clientWidth).toBe(760)
    expect(withSurface.clientHeight).toBe(560)
    const offline = new NativeScrollbarHost({
      width: 800,
      height: 600,
      scroll: new ScrollManager(),
    })
    expect(offline.clientWidth).toBe(800)
    expect(offline.clientHeight).toBe(600)
    expect(offline.viewportElement).toBeNull()
  })

  it('destroy 幂等：解绑双向同步（事件不再回灌、状态不再写回）', () => {
    const { scroll, surface, host } = createHost()
    host.destroy()
    host.destroy()
    surface.scrollTop = 500
    surface.dispatchScroll()
    expect(scroll.state.top).toBe(0)
    scroll.scrollTo(50, 60)
    expect(surface.scrollLeft).toBe(0)
    expect(surface.scrollTop).toBe(500)
  })
})
