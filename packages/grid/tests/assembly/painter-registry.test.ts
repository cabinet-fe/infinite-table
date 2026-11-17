import type { LayerPainter } from '@infinitable/protocol'
import type { RenderContext } from '@infinitable/render'
import { describe, expect, it, vi } from 'vitest'

import { PainterRegistry } from '../../src/assembly/painter-registry'

describe('PainterRegistry 绘制器注册表', () => {
  it('按槽位维护绘制器，依据 order 升序及注册序稳定排序', () => {
    const registry = new PainterRegistry()
    const order: string[] = []

    expect(registry.has('overlay')).toBe(false)
    expect(registry.getPainters('overlay')).toEqual([])

    registry.register({
      id: 'late-default',
      slot: 'overlay',
      paint: () => order.push('late-default'),
    })
    registry.register({
      id: 'first-negative',
      slot: 'overlay',
      order: -10,
      paint: () => order.push('first-negative'),
    })
    registry.register({
      id: 'zero-explicit',
      slot: 'overlay',
      order: 0,
      paint: () => order.push('zero-explicit'),
    })
    registry.register({
      id: 'last-positive',
      slot: 'overlay',
      order: 5,
      paint: () => order.push('last-positive'),
    })
    registry.register({
      id: 'bg',
      slot: 'underlay',
      paint: () => order.push('bg'),
    })

    expect(registry.has('overlay')).toBe(true)
    expect(registry.has('underlay')).toBe(true)
    expect(registry.getPainters('overlay').map((p) => p.id)).toEqual([
      'first-negative',
      'late-default',
      'zero-explicit',
      'last-positive',
    ])

    const ctx = {} as RenderContext
    const viewport = { width: 400, height: 300 }
    registry.paint('overlay', ctx, viewport)
    expect(order).toEqual(['first-negative', 'late-default', 'zero-explicit', 'last-positive'])
  })

  it('同 (slot, id) 注册覆盖旧项，旧注销函数不误删新项且注销幂等', () => {
    const registry = new PainterRegistry()
    const paintV1 = vi.fn<LayerPainter>()
    const paintV2 = vi.fn<LayerPainter>()

    const disposeV1 = registry.register({
      id: 'watermark',
      slot: 'overlay',
      order: 1,
      paint: paintV1,
    })
    const disposeV2 = registry.register({
      id: 'watermark',
      slot: 'overlay',
      order: 2,
      paint: paintV2,
    })

    expect(registry.getPainters('overlay')).toHaveLength(1)
    disposeV1()
    expect(registry.getPainters('overlay')).toHaveLength(1)

    const ctx = {} as RenderContext
    const viewport = { width: 100, height: 100 }
    registry.paint('overlay', ctx, viewport)
    expect(paintV1).not.toHaveBeenCalled()
    expect(paintV2).toHaveBeenCalledWith(ctx, viewport)

    disposeV2()
    disposeV2()
    expect(registry.has('overlay')).toBe(false)
    expect(registry.getPainters('overlay')).toEqual([])
  })

  it('clear 清空全部槽位，旧注销函数随后调用安全无副作用', () => {
    const registry = new PainterRegistry()
    const d1 = registry.register({ id: 'u', slot: 'underlay', paint: () => {} })
    const d2 = registry.register({ id: 'o', slot: 'overlay', paint: () => {} })

    registry.clear()
    expect(registry.has('underlay')).toBe(false)
    expect(registry.has('overlay')).toBe(false)

    // 注册新同名项后调用旧 disposer 不得影响新项
    registry.register({ id: 'u', slot: 'underlay', paint: () => {} })
    d1()
    d2()
    expect(registry.has('underlay')).toBe(true)
    expect(registry.has('overlay')).toBe(false)
  })
})
