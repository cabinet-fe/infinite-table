import { describe, expect, it, vi } from 'vitest'

import { createRenderHost, type RenderHostOptions } from '../src/render-host'
import { SceneNode } from '../src/scene/scene-node'
import { FakeCanvas, createFakeCanvas } from './testing/fake-canvas'
import type { RenderContext } from '../src/types'

/** 手动步进的帧调度：schedule 收 callback，step() 执行一帧 */
function makeManualScheduler() {
  const scheduled: (() => void)[] = []
  const cancelled: number[] = []
  return {
    scheduled,
    cancelled,
    options: {
      scheduleFrame: (cb: () => void) => {
        scheduled.push(cb)
        return scheduled.length
      },
      cancelFrame: (handle: number) => {
        cancelled.push(handle)
      },
    } satisfies Partial<RenderHostOptions>,
    step(): void {
      const cb = scheduled.shift()
      cb?.()
    },
  }
}

/** matchMedia 桩：记录查询串与 change 监听，供 DPR 变更探测用例手动触发 */
class FakeMediaQueryList {
  readonly listeners: Array<() => void> = []
  constructor(readonly query: string) {}
  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.push(listener)
  }
  removeEventListener(_type: 'change', listener: () => void): void {
    const index = this.listeners.indexOf(listener)
    if (index >= 0) {
      this.listeners.splice(index, 1)
    }
  }
}

/** 桩掉全局 window（携带可变的 devicePixelRatio、resize 监听记录与 matchMedia 记录器） */
function stubWindow(devicePixelRatio: number) {
  const mediaQueries: FakeMediaQueryList[] = []
  const resizeListeners: Array<() => void> = []
  const win = {
    devicePixelRatio,
    addEventListener(type: string, listener: () => void): void {
      if (type === 'resize') {
        resizeListeners.push(listener)
      }
    },
    removeEventListener(type: string, listener: () => void): void {
      if (type === 'resize') {
        const index = resizeListeners.indexOf(listener)
        if (index >= 0) {
          resizeListeners.splice(index, 1)
        }
      }
    },
    matchMedia: (query: string) => {
      const mediaQuery = new FakeMediaQueryList(query)
      mediaQueries.push(mediaQuery)
      return mediaQuery
    },
  }
  vi.stubGlobal('window', win)
  return { win, mediaQueries, resizeListeners }
}

class PaintNode extends SceneNode {
  painted = 0
  override paint(_ctx: RenderContext): void {
    this.painted += 1
  }
}

function createHost(extra: Partial<RenderHostOptions> = {}) {
  return createRenderHost({
    width: 800,
    height: 600,
    dpr: 2,
    createCanvas: createFakeCanvas,
    ...extra,
  })
}

describe('RenderHost 窄接口', () => {
  it('createLayer 按 kind 幂等返回，四层各自独立 canvas 并按 dpr 换算物理尺寸', () => {
    const host = createHost()
    const body = host.createLayer({ kind: 'body' })
    expect(host.createLayer({ kind: 'body' })).toBe(body)
    const ground = host.createLayer({ kind: 'ground' })
    expect(ground).not.toBe(body)
    expect(ground.canvasElement).not.toBe(body.canvasElement)
    expect(body.canvasElement.width).toBe(1600)
    expect(body.canvasElement.height).toBe(1200)
    expect(body.kind).toBe('body')
    host.destroy()
  })

  it('提交失效后单帧收敛：同帧多次失效只触发一次调度，帧末按消费策略重绘', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    const body = host.createLayer({ kind: 'body' })
    const cell = new PaintNode({ x: 0, y: 0, width: 50, height: 30 })
    body.root.appendChild(cell)

    host.submitInvalidation('body', {
      type: 'cell',
      region: { x: 0, y: 0, width: 50, height: 30 },
    })
    host.submitInvalidation('body', {
      type: 'cell',
      region: { x: 100, y: 0, width: 50, height: 30 },
    })
    expect(scheduler.scheduled).toHaveLength(1)

    scheduler.step()
    const ctx = (body.canvasElement as FakeCanvas).context
    // 两个不相交 cell → 两个 region，逐 region clearRect + 裁剪增量补画
    expect(ctx.callsOf('clearRect')).toHaveLength(2)
    expect(ctx.callsOf('clip')).toHaveLength(2)
    // cell 只与第一个 region 相交，只被重画一次
    expect(cell.painted).toBe(1)

    // 下一帧无失效则不重绘
    scheduler.step()
    expect(ctx.callsOf('clearRect')).toHaveLength(2)
    host.destroy()
  })

  it('sky 层任何失效整层重画；ground 层忽略 cell', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    const sky = host.createLayer({ kind: 'sky' })
    const ground = host.createLayer({ kind: 'ground' })
    host.submitInvalidation('sky', { type: 'cell', region: { x: 0, y: 0, width: 10, height: 10 } })
    host.submitInvalidation('ground', {
      type: 'cell',
      region: { x: 0, y: 0, width: 10, height: 10 },
    })
    scheduler.step()
    const skyCtx = (sky.canvasElement as FakeCanvas).context
    const groundCtx = (ground.canvasElement as FakeCanvas).context
    expect(skyCtx.callsOf('clearRect')).toEqual([{ name: 'clearRect', args: [0, 0, 800, 600] }])
    expect(groundCtx.callsOf('clearRect')).toHaveLength(0)
    host.destroy()
  })

  it('requestFrame 同一任务同帧去重，不同任务都执行', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    let a = 0
    let b = 0
    const taskA = () => {
      a += 1
    }
    host.requestFrame(taskA)
    host.requestFrame(taskA)
    host.requestFrame(() => {
      b += 1
    })
    expect(scheduler.scheduled).toHaveLength(1)
    scheduler.step()
    expect(a).toBe(1)
    expect(b).toBe(1)
    host.destroy()
  })

  it('measure：注入的测量函数优先；缺省走测量画布', () => {
    const host = createHost({ measureText: (text) => ({ width: text.length, height: 12 }) })
    expect(host.measure('abc', '12px sans')).toEqual({ width: 3, height: 12 })
    host.destroy()

    const host2 = createHost()
    expect(host2.measure('abc', '12px sans')).toEqual({ width: 30, height: 10 })
    host2.destroy()
  })

  it('translateBy blit 自拷贝并把暴露带转 band 失效增量补画', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    const body = host.createLayer({ kind: 'body' })
    const exposed = new PaintNode({ x: 0, y: 560, width: 800, height: 40 })
    const top = new PaintNode({ x: 0, y: 0, width: 800, height: 40 })
    body.root.appendChild(exposed)
    body.root.appendChild(top)

    body.translateBy(0, -40)
    const ctx = (body.canvasElement as FakeCanvas).context
    // blit：本层 ctx 上 drawImage 一次（temp ← layer 的一次记录在临时画布 ctx 上）
    expect(ctx.callsOf('drawImage')).toHaveLength(1)
    // blit 本身清屏一次
    expect(ctx.callsOf('clearRect')).toEqual([{ name: 'clearRect', args: [0, 0, 1600, 1200] }])
    // 暴露底部 40px 横带 → band 失效，帧末只补画该区域
    scheduler.step()
    expect(ctx.callsOf('clearRect')).toEqual([
      { name: 'clearRect', args: [0, 0, 1600, 1200] },
      { name: 'clearRect', args: [0, 560, 800, 40] },
    ])
    expect(exposed.painted).toBe(1)
    expect(top.painted).toBe(0)
    host.destroy()
  })

  it('平移超过层尺寸退化为整层重绘', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    const body = host.createLayer({ kind: 'body' })
    body.translateBy(0, 700)
    scheduler.step()
    const ctx = (body.canvasElement as FakeCanvas).context
    expect(ctx.callsOf('drawImage')).toHaveLength(0)
    expect(ctx.callsOf('clearRect')).toEqual([{ name: 'clearRect', args: [0, 0, 800, 600] }])
    host.destroy()
  })

  it('setSize 调整物理像素尺寸并整层重绘', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    const body = host.createLayer({ kind: 'body' })
    body.setSize(400, 300)
    expect(body.canvasElement.width).toBe(800)
    expect(body.canvasElement.height).toBe(600)
    scheduler.step()
    const ctx = (body.canvasElement as FakeCanvas).context
    expect(ctx.callsOf('clearRect')).toEqual([{ name: 'clearRect', args: [0, 0, 400, 300] }])
    host.destroy()
  })

  it('缺省 dpr 取运行环境值（无 window 回落 1）；显式注入 dpr 优先于环境值', () => {
    const { mediaQueries, resizeListeners } = stubWindow(2)
    try {
      const host = createRenderHost({ width: 800, height: 600, createCanvas: createFakeCanvas })
      const body = host.createLayer({ kind: 'body' })
      expect(body.canvasElement.width).toBe(1600)
      expect(body.canvasElement.height).toBe(1200)
      host.destroy()

      // 浏览器形态环境：DPR 探测按环境 resolution 武装（headless 无 window 环境不武装）
      expect(mediaQueries).toHaveLength(1)
      expect(mediaQueries[0]!.query).toBe('(resolution: 2dppx)')
      expect(mediaQueries[0]!.listeners).toHaveLength(0)
      expect(resizeListeners).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }

    // 显式注入 dpr 的构造路径行为不变：注入值优先于环境值（stubWindow(2) 已还原）
    const injected = createHost()
    expect(injected.createLayer({ kind: 'body' }).canvasElement.width).toBe(1600)
    injected.destroy()
  })

  it('运行期 DPR 变更（resize / matchMedia 双通道）：全部已建层以新 dpr 重设物理尺寸并整层重绘', () => {
    const { win, mediaQueries, resizeListeners } = stubWindow(1)
    try {
      const scheduler = makeManualScheduler()
      const host = createRenderHost({
        width: 800,
        height: 600,
        ...scheduler.options,
        createCanvas: createFakeCanvas,
      })
      const body = host.createLayer({ kind: 'body' })
      const sky = host.createLayer({ kind: 'sky' })
      expect(body.canvasElement.width).toBe(800)
      expect(mediaQueries).toHaveLength(1)
      expect(resizeListeners).toHaveLength(1)

      // resize 通道：window.devicePixelRatio 变更后 resize 触发跟随
      win.devicePixelRatio = 2
      resizeListeners[0]!()
      expect(body.canvasElement.width).toBe(1600)
      expect(body.canvasElement.height).toBe(1200)
      expect(sky.canvasElement.width).toBe(1600)
      expect(scheduler.scheduled).toHaveLength(1)
      scheduler.step()
      const ctx = (body.canvasElement as FakeCanvas).context
      expect(ctx.callsOf('clearRect')).toEqual([{ name: 'clearRect', args: [0, 0, 800, 600] }])
      // 探测按新 resolution 重武装
      expect(mediaQueries).toHaveLength(2)
      expect(mediaQueries[0]!.listeners).toHaveLength(0)
      expect(mediaQueries[1]!.query).toBe('(resolution: 2dppx)')

      // matchMedia 通道：resolution 失配触发跟随回 1×，同样重武装
      win.devicePixelRatio = 1
      mediaQueries[1]!.listeners[0]!()
      expect(body.canvasElement.width).toBe(800)
      expect(mediaQueries).toHaveLength(3)
      expect(mediaQueries[2]!.query).toBe('(resolution: 1dppx)')

      host.destroy()
      expect(resizeListeners).toHaveLength(0)
      expect(mediaQueries[2]!.listeners).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('resize 显式传 dpr：内部 dpr 同步更新，已建层与后续新建层都取新值', () => {
    const host = createHost()
    const ground = host.createLayer({ kind: 'ground' })
    host.resize(400, 300, 1)
    expect(ground.canvasElement.width).toBe(400)
    expect(ground.canvasElement.height).toBe(300)
    const body = host.createLayer({ kind: 'body' })
    expect(body.canvasElement.width).toBe(400)
    expect(body.canvasElement.height).toBe(300)
    host.destroy()
  })

  it('destroy 取消挂起帧并可安全重复调用', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    host.submitInvalidation('body', { type: 'full' })
    expect(scheduler.scheduled).toHaveLength(1)
    host.destroy()
    expect(scheduler.cancelled).toEqual([1])
    expect(() => host.destroy()).not.toThrow()
  })

  it('mount 按 LAYER_ORDER 叠放：先建 body/sky、惰性创建的 media 仍落在 sky 之下', () => {
    // node 测试环境无 DOM：以最小桩顶替 HTMLCanvasElement 与 container（只记录子节点顺序）
    class StubDomCanvas extends FakeCanvas {
      style: Record<string, string> = {}
      dataset: Record<string, string> = {}
      remove(): void {}
    }
    const children: StubDomCanvas[] = []
    const container = {
      children,
      appendChild(child: StubDomCanvas): void {
        children.push(child)
      },
      insertBefore(child: StubDomCanvas, anchor: StubDomCanvas): void {
        children.splice(children.indexOf(anchor), 0, child)
      },
      contains(child: StubDomCanvas): boolean {
        return children.includes(child)
      },
      addEventListener(): void {},
      removeEventListener(): void {},
    }
    vi.stubGlobal('HTMLCanvasElement', StubDomCanvas)
    try {
      const host = createRenderHost({
        width: 800,
        height: 600,
        container: container as unknown as HTMLElement,
        createCanvas: () => new StubDomCanvas(),
      })
      // 实际用例：构造期只建 body/sky，media 由首个图片格惰性创建
      host.createLayer({ kind: 'body' })
      host.createLayer({ kind: 'sky' })
      host.createLayer({ kind: 'media' })
      expect(children.map((canvas) => canvas.dataset.layerKind)).toEqual(['body', 'media', 'sky'])
      // ground 最后创建也排最底；幂等 createLayer 不改变叠放
      host.createLayer({ kind: 'ground' })
      host.createLayer({ kind: 'body' })
      expect(children.map((canvas) => canvas.dataset.layerKind)).toEqual([
        'ground',
        'body',
        'media',
        'sky',
      ])
      host.destroy()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
