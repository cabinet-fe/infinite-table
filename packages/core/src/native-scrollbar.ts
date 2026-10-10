// 原生滚动条模式：真实 DOM 滚动容器（浏览器原生渲染滚动条）与唯一滚动状态源
// ScrollManager 的双向同步装配。canvas 内建滚动条（sky 浮层绘制 + 指针拦截）见
// scrollbar.ts / list-table-interaction.ts——本模块不画任何像素、不自建 thumb/track，
// 滚动条完全由浏览器渲染（保留 OS 外观、触控板惯性与系统辅助功能）。
//
// DOM 结构（宿主容器内；四层 canvas 由 RenderHost 挂 viewport 节点，接口不变）：
//   wrapper（overflow: scroll + scrollbar-gutter: stable——横向/纵向 gutter 含右下角
//   corner 从布局扣除、永不覆盖内容；尺寸 = 表 CSS 视口）
//   └─ spacer（in-flow 块，尺寸 = 视口 + maxLeft/maxTop，撑出原生滚动范围）
//      └─ viewport（position: sticky 恒贴滚动视口，层 canvas 挂其内——canvas 不随
//         滚动位移，引擎按滚动状态整帧重绘，视觉与 canvas 档同构）
//
// 同步协议（防回环）：DOM scroll 事件（滚轮/触控板/拖原生 thumb/系统惯性）读
// wrapper 偏移 → ScrollManager.scrollTo；引擎滚动广播（scrollTo/scrollBy/惯性/
// ensureCellVisible）→ 写回 wrapper.scrollLeft/scrollTop。自身写回引发的 scroll
// 事件与引擎状态相等即跳过——单次增量恰好一次等量位移，无回环放大。

import type { ScrollManager } from './scroll-manager'

/**
 * 原生滚动容器同步所需的最小滚动元素面（真实 wrapper 或单测替身）：
 * scrollLeft/scrollTop 读写与 scroll 事件订阅、视口 clientWidth/clientHeight
 * （CSS 像素，已含原生 gutter 扣除）。
 */
export interface NativeScrollSurface {
  scrollLeft: number
  scrollTop: number
  readonly clientWidth: number
  readonly clientHeight: number
  addEventListener(type: 'scroll', listener: () => void): void
  removeEventListener(type: 'scroll', listener: () => void): void
}

/** 原生滚动条装配参数 */
export interface NativeScrollbarHostOptions {
  /** 宿主容器（canvas 档挂层 canvas 的同一容器）；无 DOM 环境不装配（离屏空转） */
  parent?: HTMLElement
  /** 注入滚动元素（单测替身）；给出时不做 DOM 装配，同步协议绑定该元素 */
  surface?: NativeScrollSurface
  /** 逻辑视口尺寸（CSS 像素）：wrapper/viewport CSS 尺寸与 clientWidth 为 0 的回落口径 */
  width: number
  height: number
  /** 唯一滚动状态源（原生容器只作其输入/输出设备，不另立状态） */
  scroll: ScrollManager
}

/**
 * 原生滚动条宿主：DOM 装配 + ScrollManager 双向同步 + 滚动范围维护。
 * ListTable 构造期按 scrollbar.mode === 'native' 装配（canvas 档不创建本类）；
 * 视口口径取滚动容器 clientWidth/clientHeight（已扣原生 gutter），无布局环境
 * （离屏/headless 无 clientWidth）回落逻辑尺寸。
 */
export class NativeScrollbarHost {
  private readonly scroll: ScrollManager
  private surface: NativeScrollSurface | null
  private wrapper: HTMLElement | null = null
  private spacer: HTMLElement | null = null
  private viewport: HTMLElement | null = null
  private width: number
  private height: number
  private disposed = false
  private readonly unsubscribeEngine: () => void
  /** DOM scroll 事件：读容器偏移回灌引擎（写回引发的等值事件跳过，防回环） */
  private readonly handleSurfaceScroll = (): void => {
    const surface = this.surface
    if (!surface || this.disposed) {
      return
    }
    const { left, top } = this.scroll.state
    if (surface.scrollLeft === left && surface.scrollTop === top) {
      return
    }
    this.scroll.scrollTo(surface.scrollLeft, surface.scrollTop)
  }
  /** 引擎滚动广播：状态写回容器偏移（等值不写，浏览器不再派发 scroll） */
  private readonly handleEngineScroll = (): void => {
    const surface = this.surface
    if (!surface || this.disposed) {
      return
    }
    const { left, top } = this.scroll.state
    if (surface.scrollLeft !== left) {
      surface.scrollLeft = left
    }
    if (surface.scrollTop !== top) {
      surface.scrollTop = top
    }
  }

  constructor(options: NativeScrollbarHostOptions) {
    this.scroll = options.scroll
    this.width = Math.max(0, options.width)
    this.height = Math.max(0, options.height)
    if (options.surface) {
      this.surface = options.surface
    } else if (options.parent && typeof document !== 'undefined') {
      this.assemble(options.parent)
      this.surface = this.wrapper
    } else {
      // 离屏（无 DOM 环境/未给容器）：无滚动容器，仅保留逻辑尺寸口径
      this.surface = null
    }
    if (this.surface) {
      this.surface.addEventListener('scroll', this.handleSurfaceScroll)
      this.unsubscribeEngine = this.scroll.onScroll(this.handleEngineScroll)
    } else {
      this.unsubscribeEngine = () => {}
    }
  }

  /** 层 canvas 挂载容器（sticky 视口）；离屏/替身形态为 null（层挂载回落宿主容器） */
  get viewportElement(): HTMLElement | null {
    return this.viewport
  }

  /** 视口宽（CSS 像素）：滚动容器 clientWidth 口径（已扣原生 gutter）；无布局回落逻辑尺寸 */
  get clientWidth(): number {
    return this.surface?.clientWidth || this.width
  }

  /** 视口高（CSS 像素）：滚动容器 clientHeight 口径（已扣原生 gutter）；无布局回落逻辑尺寸 */
  get clientHeight(): number {
    return this.surface?.clientHeight || this.height
  }

  /**
   * 滚动范围同步：spacer 尺寸 = 视口 + 滚动余量（与 ScrollManager maxLeft/maxTop
   * 同构——DOM scrollWidth/scrollHeight 撑出的滚动边界即引擎边界）。向上取整，
   * 防 DOM 像素取整先于引擎钳制。内容/视口尺寸变更（setRowCount/setColCount/
   * resize 等）后由 applyGeometryChange 调用。
   */
  updateScrollRange(): void {
    if (!this.spacer) {
      return
    }
    this.spacer.style.width = `${Math.ceil(this.clientWidth + this.scroll.maxLeft)}px`
    this.spacer.style.height = `${Math.ceil(this.clientHeight + this.scroll.maxTop)}px`
  }

  /** 容器尺寸原地调整（表 resize 路径）：wrapper/viewport CSS 尺寸 + 滚动范围重算 */
  resize(width: number, height: number): void {
    this.width = Math.max(0, width)
    this.height = Math.max(0, height)
    if (this.wrapper) {
      this.wrapper.style.width = `${this.width}px`
      this.wrapper.style.height = `${this.height}px`
    }
    if (this.viewport) {
      this.viewport.style.width = `${this.width}px`
      this.viewport.style.height = `${this.height}px`
    }
    this.updateScrollRange()
  }

  /** 解绑同步协议并摘除 DOM（幂等；层 canvas 由 RenderHost 自行清理） */
  destroy(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.surface?.removeEventListener('scroll', this.handleSurfaceScroll)
    this.unsubscribeEngine()
    this.wrapper?.remove()
    this.wrapper = null
    this.spacer = null
    this.viewport = null
    this.surface = null
  }

  /** DOM 装配：wrapper（滚动容器）→ spacer（撑滚动范围）→ viewport（sticky 层挂载点） */
  private assemble(parent: HTMLElement): void {
    const wrapper = document.createElement('div')
    const spacer = document.createElement('div')
    const viewport = document.createElement('div')
    // 真实 overflow 滚动 + 两轴（含右下角 corner）gutter 常驻预留：滚动条由浏览器
    // 原生渲染，clientWidth/clientHeight 即已扣 gutter 的视口口径
    wrapper.style.overflow = 'scroll'
    wrapper.style.setProperty('scrollbar-gutter', 'stable')
    wrapper.style.width = `${this.width}px`
    wrapper.style.height = `${this.height}px`
    wrapper.dataset.nativeScroll = ''
    // sticky 恒贴滚动视口：canvas 不随滚动位移（引擎按滚动状态重绘）；sticky 元素
    // 是 positioned 祖先，层 canvas 的 absolute 定位锚定本节点原点
    viewport.style.position = 'sticky'
    viewport.style.top = '0'
    viewport.style.left = '0'
    viewport.style.width = `${this.width}px`
    viewport.style.height = `${this.height}px`
    // spacer 在流内撑出滚动范围（sticky 视口的粘附约束块）；空元素不绘制，
    // 关闭指针命中避免盖住视口
    spacer.style.pointerEvents = 'none'
    spacer.appendChild(viewport)
    wrapper.appendChild(spacer)
    parent.appendChild(wrapper)
    this.wrapper = wrapper
    this.spacer = spacer
    this.viewport = viewport
  }
}
