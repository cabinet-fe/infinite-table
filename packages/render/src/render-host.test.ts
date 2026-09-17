import { describe, expect, it } from 'vitest'

import { createRenderHost, type RenderHostOptions } from './render-host'
import { SceneNode } from './scene/scene-node'
import { FakeCanvas, createFakeCanvas } from './testing/fake-canvas'
import type { RenderContext } from './types'

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

  it('destroy 取消挂起帧并可安全重复调用', () => {
    const scheduler = makeManualScheduler()
    const host = createHost(scheduler.options)
    host.submitInvalidation('body', { type: 'full' })
    expect(scheduler.scheduled).toHaveLength(1)
    host.destroy()
    expect(scheduler.cancelled).toEqual([1])
    expect(() => host.destroy()).not.toThrow()
  })
})
