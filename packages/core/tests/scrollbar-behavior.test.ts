// 内建滚动条行为（P3 重构）：三态绘制、显隐状态机、画布外 pointerup 捕获语义、
// rAF 合帧、min-thumb 钳位全程可达、轨道点按中心跳转。默认几何同 scrollbar.test.ts：
// 行号列 48、列头 36、行高 32、列宽 100；800×600 视口下 10 列 100 行（两轴可滚，
// 右/下缘各预留 10px 轨道 → 视口 742×554）→ maxLeft = 258、maxTop = 2646、
// 竖轴轨道 590、滑块 102（usable 488）。
// happy-dom 环境：画布外指针接续（window 级监听）需要真实 window/DOM。

// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest'

import {
  SceneNode,
  type FrameTask,
  type Region,
  type RenderContext,
  type SceneEvent,
  type SceneEventType,
} from '@infinitable/render'

import { InteractionOverlay } from '../src/interaction-overlay'
import type { OverlayContent } from '../src/interaction-overlay'
import { ListTable } from '../src/list-table'
import {
  mapScrollbarThumbDrag,
  MIN_SCROLLBAR_THUMB_PX,
  planScrollbarThumb,
  resolveScrollbarConfig,
} from '../src/scrollbar'
import { defaultTheme } from '../src/theme'
import type { ListTableOptions } from '../src/types'
import { StubHost } from './testing/stub-host'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function rows(count: number): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({ name: `r${i}` }))
}

function createTable(extra: Partial<ListTableOptions> = {}, container?: HTMLElement) {
  const host = new StubHost()
  const table = new ListTable({
    ...BASE_OPTIONS,
    host,
    records: rows(100),
    ...(container ? { hostOptions: { container } } : {}),
    ...extra,
  })
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

/** 容器外（window 级）指针事件：滚动条拖拽画布外接续路径（捕获语义） */
function fireWindowPointer(
  type: 'pointermove' | 'pointerup',
  init: { clientX: number; clientY: number; buttons?: number },
): void {
  document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }))
}

/** 帧排队假宿主：requestFrame 收进队列，flushFrames 显式冲帧（rAF 合帧断言用） */
class FrameQueueHost extends StubHost {
  private readonly pending: FrameTask[] = []
  override requestFrame(task: FrameTask): void {
    this.pending.push(task)
  }
  flushFrames(): void {
    for (const task of this.pending.splice(0)) {
      task()
    }
  }
}

function createQueuedTable(extra: Partial<ListTableOptions> = {}) {
  const host = new FrameQueueHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, records: rows(100), ...extra })
  return { host, table }
}

/* ---------- 三态与圆角内缩绘制（浮层直测） ---------- */

interface RectCall {
  x: number
  y: number
  width: number
  height: number
  fill: unknown
}

class FillRecordingContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''
  readonly rects: RectCall[] = []

  save(): void {}
  restore(): void {}
  setTransform(): void {}
  translate(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {}
  clearRect(): void {}
  drawImage(): void {}
  measureText(): { width: number } {
    return { width: 0 }
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height, fill: this.fillStyle })
  }
  fillText(): void {}
}

const VIEWPORT: Region = { x: 48, y: 36, width: 752, height: 564 }
const THUMB_FILL = 'rgba(31, 35, 41, 0.4)'
const THUMB_HOVER = 'rgba(31, 35, 41, 0.55)'
const THUMB_ACTIVE = 'rgba(31, 35, 41, 0.7)'

function paintViews(scrollbars: OverlayContent['scrollbars']): RectCall[] {
  const root = new SceneNode()
  const overlay = new InteractionOverlay(
    root,
    {
      cellRect: (): Region | null => null,
      bodyViewport: () => VIEWPORT,
      canvas: () => ({ width: 800, height: 600 }),
    },
    defaultTheme.interaction,
  )
  overlay.update({
    selection: { ranges: [], focus: null },
    resizeLine: null,
    fillHandleRange: null,
    fillPreview: null,
    selectionAnchor: null,
    highlightRanges: [],
    freezeDividers: { x: null, y: null },
    scrollbars,
    scrollbarGutter: { width: 0, height: 0 },
    window: { rows: { start: 0, end: 100 }, cols: { start: 0, end: 10 } },
  })
  const ctx = new FillRecordingContext()
  root.children[0]!.paint(ctx)
  return ctx.rects
}

const VERTICAL_GEOMETRY = planScrollbarThumb({ maxScroll: 2636, viewport: 564, offset: 0 }, 590)!

describe('滚动条三态与圆角内缩绘制', () => {
  it('默认态：内缩于条带（厚度 = size − 2×margin）、圆角光栅化、默认色', () => {
    const rects = paintViews({
      vertical: { geometry: VERTICAL_GEOMETRY, hover: false, active: false },
      horizontal: null,
    })
    // 中段整条：x = 800 − 10 + 2 = 792、厚度 10 − 2×2 = 6；半径钳到厚度一半（3）成胶囊
    expect(rects).toContainEqual({ x: 792, y: 3, width: 6, height: 98, fill: THUMB_FILL })
    // 两端圆角光栅化：端行比中段窄（两端内缩 > 0）且非空
    const capRows = rects.filter((rect) => rect.fill === THUMB_FILL && rect.y < 3)
    expect(capRows.length).toBe(3)
    for (const row of capRows) {
      expect(row.width).toBeGreaterThan(0)
      expect(row.width).toBeLessThan(6)
    }
    // 对称：底部端行镜像存在
    expect(
      rects.filter((rect) => rect.fill === THUMB_FILL && rect.y + rect.height > 101).length,
    ).toBe(3)
  })

  it('hover 态：hover 色 + 收窄内缩变粗（厚度 = size − 2×marginHover）', () => {
    const rects = paintViews({
      vertical: { geometry: VERTICAL_GEOMETRY, hover: true, active: false },
      horizontal: null,
    })
    expect(rects).toContainEqual({ x: 791, y: 4, width: 8, height: 96, fill: THUMB_HOVER })
    expect(rects.some((rect) => rect.fill === THUMB_FILL)).toBe(false)
  })

  it('激活态：拖拽会话期间取激活色', () => {
    const rects = paintViews({
      vertical: { geometry: VERTICAL_GEOMETRY, hover: false, active: true },
      horizontal: null,
    })
    expect(rects.length).toBeGreaterThan(0)
    expect(rects.every((rect) => rect.fill === THUMB_ACTIVE)).toBe(true)
  })

  it('updateTheme 运行时换 token：后续绘制读新值', () => {
    // 'always' 常驻：浮层滑块恒可画（hover/scrolling 档静止隐藏时不绘制）
    const { host, table } = createTable({ scrollbar: true })
    // 换 token：直角满厚（margin 0 / radius 0）+ 自定义色，绘制结果可精确断言
    table.updateTheme({
      interaction: { scrollbarThumb: '#123456', scrollbarMargin: 0, scrollbarRadius: 0 },
    })
    const ctx = new FillRecordingContext()
    const skyRoot = host.layers.get('sky')!.root
    skyRoot.children[0]!.paint(ctx)
    // 运行中实例的浮层已改读新 token：两轴滑块各一条直角满厚色条（竖轴滑块按视口 554 → 102）
    expect(ctx.rects).toContainEqual({ x: 790, y: 0, width: 10, height: 102, fill: '#123456' })
    // 横轴滑块与预留轨道同在 y=590：按滑块色过滤（轨道画在滑块之下）
    const horizontal = ctx.rects.find((rect) => rect.fill === '#123456' && rect.y === 590)
    expect(horizontal?.height).toBe(10)
    expect(horizontal?.width).toBe(586)
  })

  it('横轴镜像几何；隐藏轴（null）不绘制', () => {
    // 视口 752、余量 248 → 滑块 594；厚度 6、半径钳 3 = 胶囊：逐行覆盖全厚度、两端收窄
    const horizontal = planScrollbarThumb({ maxScroll: 248, viewport: 752, offset: 0 }, 790)!
    const rects = paintViews({
      vertical: null,
      horizontal: { geometry: horizontal, hover: false, active: false },
    })
    const rows = rects.filter((rect) => rect.fill === THUMB_FILL)
    expect(rows).toHaveLength(6)
    expect(rows.some((rect) => rect.height <= 0 || rect.width <= 0)).toBe(false)
    for (const row of rows) {
      expect(row.y).toBeGreaterThanOrEqual(592)
      expect(row.y).toBeLessThan(598)
      expect(row.x).toBeGreaterThanOrEqual(0)
      expect(row.x + row.width).toBeLessThanOrEqual(594)
    }
    // 端行（y=592）比中间行窄（左端内缩 > 0）
    const edge = rows.find((row) => row.y === 592)!
    const center = rows.find((row) => row.y === 594 || row.y === 595)!
    expect(edge.x).toBeGreaterThan(0)
    expect(edge.width).toBeLessThan(center.width)
    expect(paintViews({ vertical: null, horizontal: null })).toEqual([])
  })
})

/* ---------- 显隐状态机 ---------- */

describe("'scrolling'/'hover' 显隐状态机", () => {
  it('resolveScrollbarConfig：false 关闭、true 映射 always、缺省/空对象映射 hover、对象形态透传', () => {
    expect(resolveScrollbarConfig(false)).toEqual({
      enabled: false,
      visibility: 'always',
      hideDelay: undefined,
      reserve: false,
    })
    // 未配置缺省 hover：悬停表格内或滚动时显示；预留轨道缺省开启
    expect(resolveScrollbarConfig(undefined)).toEqual({
      enabled: true,
      visibility: 'hover',
      hideDelay: undefined,
      reserve: true,
    })
    // 显式 true 保留旧语义：常驻
    expect(resolveScrollbarConfig(true)).toEqual({
      enabled: true,
      visibility: 'always',
      hideDelay: undefined,
      reserve: true,
    })
    expect(resolveScrollbarConfig({})).toEqual({
      enabled: true,
      visibility: 'hover',
      hideDelay: undefined,
      reserve: true,
    })
    expect(resolveScrollbarConfig({ visibility: 'scrolling', hideDelay: 300 })).toEqual({
      enabled: true,
      visibility: 'scrolling',
      hideDelay: 300,
      reserve: true,
    })
    expect(resolveScrollbarConfig({ visibility: 'hover', hideDelay: 300 })).toEqual({
      enabled: true,
      visibility: 'hover',
      hideDelay: 300,
      reserve: true,
    })
    // reserve: false 显式回悬浮式
    expect(resolveScrollbarConfig({ reserve: false })).toEqual({
      enabled: true,
      visibility: 'hover',
      hideDelay: undefined,
      reserve: false,
    })
  })

  it('滚动触发显示、静止超时隐藏；悬停滑块保持可见、离开后重新计时', () => {
    vi.useFakeTimers()
    try {
      const { host, table } = createTable({
        scrollbar: { visibility: 'scrolling', hideDelay: 60 },
      })
      // 初始静止：隐藏
      expect(table.scrollbarVisible).toBe(false)
      // 无关区域 move 不触发
      fireBody(host, 'pointermove', { x: 400, y: 300 })
      expect(table.scrollbarVisible).toBe(false)
      // 滚动触发显示
      table.scrollBy(0, 96)
      expect(table.scrollbarVisible).toBe(true)
      vi.advanceTimersByTime(59)
      expect(table.scrollbarVisible).toBe(true)
      vi.advanceTimersByTime(2)
      expect(table.scrollbarVisible).toBe(false)
      // 悬停滑块：显示 + hover 态保持（计时到点不隐藏）
      fireBody(host, 'pointermove', { x: 795, y: 50 })
      expect(table.scrollbarVisible).toBe(true)
      expect(table.scrollbarHover).toBe('vertical')
      vi.advanceTimersByTime(10_000)
      expect(table.scrollbarVisible).toBe(true)
      // 离开滑块：清 hover 并重新计时
      fireBody(host, 'pointermove', { x: 400, y: 300 })
      expect(table.scrollbarHover).toBeNull()
      vi.advanceTimersByTime(59)
      expect(table.scrollbarVisible).toBe(true)
      vi.advanceTimersByTime(2)
      expect(table.scrollbarVisible).toBe(false)
      // 轨道悬停（非滑块）也触发显示（滚动条交互语义）
      fireBody(host, 'pointermove', { x: 795, y: 400 })
      expect(table.scrollbarVisible).toBe(true)
      expect(table.scrollbarHover).toBeNull()
      // 销毁清理：隐藏定时器与画布外接续解绑（回调不再翻转可见性）
      table.destroy()
      expect(table.scrollbarReleaseCapture).toBeNull()
      vi.advanceTimersByTime(10_000)
      expect(table.scrollbarVisible).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("'always' 档（显式 true）常驻可见，无隐藏计时", () => {
    vi.useFakeTimers()
    try {
      const { table } = createTable({ scrollbar: true })
      expect(table.scrollbarVisible).toBe(true)
      table.scrollBy(0, 96)
      vi.advanceTimersByTime(10_000)
      expect(table.scrollbarVisible).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("'hover' 档（缺省）：表格内移动即显示，静止 1.5s（主题缺省延时）后隐藏", () => {
    vi.useFakeTimers()
    try {
      const { host, table } = createTable()
      expect(table.scrollbarConfig.visibility).toBe('hover')
      // 初始静止：隐藏；表格内任意移动即显示（无需命中滚动条条带/滚动）
      expect(table.scrollbarVisible).toBe(false)
      fireBody(host, 'pointermove', { x: 400, y: 300 })
      expect(table.scrollbarVisible).toBe(true)
      // 移动持续续期：1.5s 内多次 move 不隐藏
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(300)
        fireBody(host, 'pointermove', { x: 400 + i, y: 300 })
        expect(table.scrollbarVisible).toBe(true)
      }
      // 静止：1499ms 仍可见，1500ms 到点隐藏（主题 scrollbarHideDelay 缺省）
      vi.advanceTimersByTime(1499)
      expect(table.scrollbarVisible).toBe(true)
      vi.advanceTimersByTime(2)
      expect(table.scrollbarVisible).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("'hover' 档：滚动同样触发显示；悬停滑块计时到点保持，离开后重新计时隐藏", () => {
    vi.useFakeTimers()
    try {
      const { host, table } = createTable({ scrollbar: { visibility: 'hover' } })
      // 滚动触发显示（与悬停同一脉动汇入）
      table.scrollBy(0, 96)
      expect(table.scrollbarVisible).toBe(true)
      vi.advanceTimersByTime(10_000)
      expect(table.scrollbarVisible).toBe(false)
      // 悬停滑块：hover 态保持可见（计时到点不隐藏）
      fireBody(host, 'pointermove', { x: 795, y: 50 })
      expect(table.scrollbarVisible).toBe(true)
      expect(table.scrollbarHover).toBe('vertical')
      vi.advanceTimersByTime(10_000)
      expect(table.scrollbarVisible).toBe(true)
      // 离开滑块：清 hover 并重新计时隐藏
      fireBody(host, 'pointermove', { x: 400, y: 300 })
      expect(table.scrollbarHover).toBeNull()
      vi.advanceTimersByTime(1499)
      expect(table.scrollbarVisible).toBe(true)
      vi.advanceTimersByTime(2)
      expect(table.scrollbarVisible).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

/* ---------- 捕获语义：画布外拖拽接续与会话终结 ---------- */

describe('拖拽会话指针捕获（画布外接续）', () => {
  it('拖拽期间画布外 move 仍持续滚动；画布外 pointerup 必然结束会话', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { host, table } = createTable({}, container)

    // 滑块上（0..104）按下起拖
    fireBody(host, 'pointerdown', { x: 795, y: 50, button: 0 })
    expect(table.getScrollTop()).toBe(0)

    // 指针移出画布（容器外目标）：滚动持续（等价 setPointerCapture 的接续语义）
    fireWindowPointer('pointermove', { clientX: 900, clientY: 300, buttons: 1 })
    expect(table.getScrollTop()).toBeGreaterThan(0)
    const moved = table.getScrollTop()

    // 画布外释放：会话必然清除
    fireWindowPointer('pointerup', { clientX: 900, clientY: 320 })
    expect(table.scrollbarDrag).toBeNull()

    // 结束后画布外/画布内 move 都不再滚动
    fireWindowPointer('pointermove', { clientX: 900, clientY: 520, buttons: 1 })
    fireBody(host, 'pointermove', { x: 795, y: 550 })
    expect(table.getScrollTop()).toBe(moved)
    table.destroy()
  })

  it('窗外释放（up 不可达）后回画布不再续滚：buttons=0 兜底闸终结会话', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { host, table } = createTable({}, container)

    fireBody(host, 'pointerdown', { x: 795, y: 50, button: 0 })
    fireWindowPointer('pointermove', { clientX: 900, clientY: 120, buttons: 1 })
    const before = table.getScrollTop()
    expect(before).toBeGreaterThan(0)

    // 已释放（buttons=0）的 move：会话即时终结，不再按该 move 滚动
    fireWindowPointer('pointermove', { clientX: 900, clientY: 300, buttons: 0 })
    expect(table.scrollbarDrag).toBeNull()

    // 回画布后未按住不再续滚（原悬挂缺陷消失）
    fireWindowPointer('pointermove', { clientX: 900, clientY: 500, buttons: 1 })
    fireBody(host, 'pointermove', { x: 795, y: 500 })
    expect(table.getScrollTop()).toBe(before)
    table.destroy()
  })
})

/* ---------- rAF 合帧 ---------- */

describe('拖拽滚动 rAF 合帧', () => {
  it('一帧内多次 pointermove 收敛为一次 setScroll 提交；冲帧后落地', () => {
    const { host, table } = createQueuedTable()
    const commit = vi.spyOn(table, 'setScrollTop')

    fireBody(host, 'pointerdown', { x: 795, y: 50, button: 0 })
    fireBody(host, 'pointermove', { x: 795, y: 70 })
    fireBody(host, 'pointermove', { x: 795, y: 100 })
    fireBody(host, 'pointermove', { x: 795, y: 140 })

    // 冲帧前：零提交、滚动未落地（合帧中）
    expect(commit).not.toHaveBeenCalled()
    expect(table.getScrollTop()).toBe(0)

    host.flushFrames()
    expect(commit).toHaveBeenCalledTimes(1)
    // 末次位移 90px：offset = 90 × 2646 / 488
    expect(table.getScrollTop()).toBeCloseTo((90 * 2646) / 488, 5)

    // 无新 move 的空帧不再提交
    host.flushFrames()
    expect(commit).toHaveBeenCalledTimes(1)

    // 会话结束同步冲刷末次目标（不依赖下一帧）
    fireBody(host, 'pointermove', { x: 795, y: 180 })
    fireBody(host, 'pointerup', { x: 795, y: 180 })
    expect(commit).toHaveBeenCalledTimes(2)
    expect(table.getScrollTop()).toBeCloseTo((130 * 2646) / 488, 5)
  })
})

/* ---------- min-thumb 钳位全程可达 ---------- */

describe('min-thumb 钳位换算全程可达', () => {
  it('内容远超视口钳到最小滑块后，拖拽换算仍覆盖 0..maxScroll 全程', () => {
    const geometry = planScrollbarThumb({ maxScroll: 1_000_000, viewport: 564, offset: 0 }, 590)!
    expect(geometry.thumbSize).toBe(MIN_SCROLLBAR_THUMB_PX)
    // usable = 590 − 24 = 566：一个轨道行程内换算覆盖全程（钳制取整）
    expect(mapScrollbarThumbDrag(geometry, 0, -1000)).toBe(0)
    expect(mapScrollbarThumbDrag(geometry, 0, 10_000)).toBe(1_000_000)
    expect(mapScrollbarThumbDrag(geometry, 0, 566)).toBe(1_000_000)
    // 中段比例线性
    expect(mapScrollbarThumbDrag(geometry, 500_000, 56.6)).toBeCloseTo(500_000 + 100_000, -2)
  })
})

/* ---------- 轨道点按中心跳转 ---------- */

describe('轨道点按中心跳转', () => {
  it('点按处成为滑块中心（跳转后重算几何中心 ≈ 点按处），按住可继续拖拽', () => {
    const { host, table } = createTable()
    // 滑块 0..102：y=300 在轨道空白处 → 跳转
    fireBody(host, 'pointerdown', { x: 795, y: 300, button: 0 })
    const jumped = Math.round(((300 - 102 / 2) / (590 - 102)) * 2646)
    expect(table.getScrollTop()).toBe(jumped)

    // 跳转后的滑块中心回到点按处（±1px 取整误差）
    const geometry = planScrollbarThumb(
      { maxScroll: 2646, viewport: 554, offset: table.getScrollTop() },
      590,
    )!
    expect(Math.abs(geometry.thumbPos + geometry.thumbSize / 2 - 300)).toBeLessThanOrEqual(1)

    // 跳转后按住继续拖拽：以跳转后的偏移起算
    fireBody(host, 'pointermove', { x: 795, y: 350 })
    expect(table.getScrollTop()).toBeCloseTo(jumped + (50 * 2646) / 488, 5)
    fireBody(host, 'pointerup', { x: 795, y: 350 })
  })
})

/* ---------- 预留轨道区（reserve） ---------- */

describe('预留轨道区（reserve）', () => {
  /** 画 sky 首子节点（交互浮层）收集 fillRect */
  const paintOverlay = (host: StubHost): RectCall[] => {
    const ctx = new FillRecordingContext()
    host.layers.get('sky')!.root.children[0]!.paint(ctx)
    return ctx.rects
  }

  it('缺省预留：可滚动轴视口扣减 10px，右/下缘常驻轨道底色（滑块隐藏时也在）', () => {
    const { host, table } = createTable()
    // 两轴可滚（10 列 1000 宽 / 100 行 3200 高）→ 视口 742×554
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 742, height: 554 })
    expect(table.scrollbarGutterWidth).toBe(10)
    expect(table.scrollbarGutterHeight).toBe(10)
    // 'hover' 档静止（滑块隐藏），轨道底色仍常驻：右缘条带 [790,0,10,590)、
    // 下缘条带 [0,590,800,10)（右下角由下缘条带整宽覆盖）
    const rects = paintOverlay(host)
    expect(rects).toContainEqual({ x: 790, y: 0, width: 10, height: 590, fill: '#f0f1f3' })
    expect(rects).toContainEqual({ x: 0, y: 590, width: 800, height: 10, fill: '#f0f1f3' })
  })

  it('reserve: false 回悬浮式：视口不扣减、无轨道底色（旧语义）', () => {
    const { host, table } = createTable({ scrollbar: { reserve: false } })
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 752, height: 564 })
    expect(table.scrollbarGutterWidth).toBe(0)
    expect(table.scrollbarGutterHeight).toBe(0)
    expect(paintOverlay(host)).toEqual([])
  })

  it('滚动条整体关闭：不预留任何轨道', () => {
    const { table } = createTable({ scrollbar: false })
    expect(table.scrollbarConfig.reserve).toBe(false)
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 752, height: 564 })
  })

  it('不可滚轴不预留：3 行内容纵向不可滚（右缘不预留），横向照常（下缘预留）', () => {
    const { table } = createTable({ records: rows(3) })
    expect(table.scrollbarGutterWidth).toBe(0)
    expect(table.scrollbarGutterHeight).toBe(10)
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 752, height: 554 })
  })
})
