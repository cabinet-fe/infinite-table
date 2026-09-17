import { describe, expect, it } from 'vitest'

import {
  EventSystem,
  type DomEventLike,
  type DomListener,
  type SceneEvent,
} from '../../src/events/event-system'
import { SceneNode } from '../../src/scene/scene-node'

class FakeEventTarget {
  rect = { left: 0, top: 0 }
  private readonly listeners = new Map<string, Set<DomListener>>()

  addEventListener(type: string, listener: DomListener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: DomListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  getBoundingClientRect(): { left: number; top: number } {
    return this.rect
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }

  emit(type: string, event: DomEventLike = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

function makeLayers() {
  // 自顶向下：sky → body
  const sky = new SceneNode({ width: 800, height: 600, pickable: false })
  const body = new SceneNode({ width: 800, height: 600, pickable: false })
  return { roots: [sky, body] as const, sky, body }
}

describe('EventSystem 事件归一化', () => {
  it('指针事件换算为层坐标（扣除容器偏移）并自顶向下跨层命中', () => {
    const target = new FakeEventTarget()
    target.rect = { left: 100, top: 50 }
    const { roots, sky, body } = makeLayers()
    const bodyCell = new SceneNode({ x: 0, y: 0, width: 50, height: 30 })
    const skyOverlay = new SceneNode({ x: 0, y: 0, width: 50, height: 30 })
    body.appendChild(bodyCell)
    const events: SceneEvent[] = []
    bodyCell.on('pointerdown', (e) => events.push(e))
    const system = new EventSystem(target, () => roots)

    target.emit('pointerdown', { clientX: 110, clientY: 60 })
    expect(events).toHaveLength(1)
    expect(events[0]?.target).toBe(bodyCell)
    expect(events[0]?.x).toBe(10)
    expect(events[0]?.y).toBe(10)

    // sky 层叠上节点后命中 sky（z 序优先）
    sky.appendChild(skyOverlay)
    const skyEvents: SceneEvent[] = []
    skyOverlay.on('pointerdown', (e) => skyEvents.push(e))
    target.emit('pointerdown', { clientX: 110, clientY: 60 })
    expect(skyEvents).toHaveLength(1)
    expect(events).toHaveLength(1)
    system.dispose()
  })

  it('命中节点沿父链冒泡到层根', () => {
    const target = new FakeEventTarget()
    const { roots, body } = makeLayers()
    const group = new SceneNode({ x: 0, y: 0, width: 100, height: 100 })
    const leaf = new SceneNode({ x: 10, y: 10, width: 20, height: 20 })
    body.appendChild(group)
    group.appendChild(leaf)
    const order: string[] = []
    leaf.on('pointermove', () => order.push('leaf'))
    group.on('pointermove', () => order.push('group'))
    body.on('pointermove', () => order.push('root'))
    new EventSystem(target, () => roots)
    target.emit('pointermove', { clientX: 15, clientY: 15 })
    expect(order).toEqual(['leaf', 'group', 'root'])
  })

  it('未命中任何节点时派发到最顶层根', () => {
    const target = new FakeEventTarget()
    const { roots, sky, body } = makeLayers()
    const skyEvents: SceneEvent[] = []
    const bodyEvents: SceneEvent[] = []
    sky.on('pointerup', (e) => skyEvents.push(e))
    body.on('pointerup', (e) => bodyEvents.push(e))
    new EventSystem(target, () => roots)
    target.emit('pointerup', { clientX: 15, clientY: 15 })
    expect(skyEvents).toHaveLength(1)
    expect(skyEvents[0]?.target).toBeNull()
    expect(bodyEvents).toHaveLength(0)
  })

  it('滚轮事件带 delta，键盘事件不命中、带 key', () => {
    const target = new FakeEventTarget()
    const { roots, sky } = makeLayers()
    const wheelEvents: SceneEvent[] = []
    const keyEvents: SceneEvent[] = []
    sky.on('wheel', (e) => wheelEvents.push(e))
    sky.on('keydown', (e) => keyEvents.push(e))
    new EventSystem(target, () => roots)
    target.emit('wheel', { clientX: 1, clientY: 2, deltaX: 3, deltaY: 120 })
    expect(wheelEvents[0]).toMatchObject({ deltaX: 3, deltaY: 120, x: 1, y: 2 })
    target.emit('keydown', { key: 'ArrowDown' })
    expect(keyEvents[0]).toMatchObject({ key: 'ArrowDown', target: null })
  })

  it('contextmenu 命中并带层坐标；键盘事件带 shiftKey', () => {
    const target = new FakeEventTarget()
    const { roots, sky } = makeLayers()
    const menuEvents: SceneEvent[] = []
    const keyEvents: SceneEvent[] = []
    sky.on('contextmenu', (e) => menuEvents.push(e))
    sky.on('keydown', (e) => keyEvents.push(e))
    new EventSystem(target, () => roots)
    target.emit('contextmenu', { clientX: 30, clientY: 40 })
    expect(menuEvents[0]).toMatchObject({ x: 30, y: 40 })
    target.emit('keydown', { key: 'ArrowRight', shiftKey: true })
    expect(keyEvents[0]?.shiftKey).toBe(true)
    // Ctrl/Cmd 修饰键同样归一化透传，缺省 false
    expect(keyEvents[0]?.ctrlKey).toBe(false)
    expect(keyEvents[0]?.metaKey).toBe(false)
    target.emit('keydown', { key: 'a', ctrlKey: true, metaKey: true })
    expect(keyEvents[1]?.ctrlKey).toBe(true)
    expect(keyEvents[1]?.metaKey).toBe(true)
  })

  it('触摸事件取第一个触点归一化为层坐标', () => {
    const target = new FakeEventTarget()
    target.rect = { left: 10, top: 20 }
    const { roots, sky } = makeLayers()
    const events: SceneEvent[] = []
    sky.on('touchstart', (e) => events.push(e))
    sky.on('touchmove', (e) => events.push(e))
    const system = new EventSystem(target, () => roots)
    target.emit('touchstart', { changedTouches: [{ clientX: 15, clientY: 25 }] })
    target.emit('touchmove', { changedTouches: [{ clientX: 20, clientY: 30 }] })
    expect(events[0]).toMatchObject({ type: 'touchstart', x: 5, y: 5 })
    expect(events[1]).toMatchObject({ type: 'touchmove', x: 10, y: 10 })
    system.dispose()
    expect(target.listenerCount('touchcancel')).toBe(0)
  })

  it('dispose 解绑全部 DOM 监听', () => {
    const target = new FakeEventTarget()
    const { roots } = makeLayers()
    const system = new EventSystem(target, () => roots)
    expect(target.listenerCount('pointerdown')).toBe(1)
    system.dispose()
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup']) {
      expect(target.listenerCount(type)).toBe(0)
    }
  })
})
