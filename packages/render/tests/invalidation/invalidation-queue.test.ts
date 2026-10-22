import { describe, expect, it } from 'vitest'

import { InvalidationQueue } from '../../src/invalidation/invalidation-queue'
import type { LayerConsumption } from '../../src/types'

describe('InvalidationQueue 合并语义', () => {
  it('region 归一化：双包围盒 union + 扩边 10 + 像素对齐', () => {
    const queue = new InvalidationQueue('regions')
    queue.push({
      type: 'region',
      region: { x: 0.5, y: 0.5, width: 10, height: 10 },
      prevRegion: { x: 20, y: 0.5, width: 10, height: 10 },
    })
    // union → {0.5,0.5,29.5,10}；spread(10) → {-9.5,-9.5,49.5,30}；ceil → {-10,-10,50,31}
    expect(queue.drain()).toEqual({
      full: false,
      regions: [{ x: -10, y: -10, width: 50, height: 31 }],
    })
  })

  it('相同 region 去重，drain 后队列重置', () => {
    const queue = new InvalidationQueue('regions')
    const region = { x: 0, y: 0, width: 10, height: 10 }
    queue.push({ type: 'region', region })
    queue.push({ type: 'region', region })
    const plan = queue.drain()
    expect(plan).toEqual({
      full: false,
      regions: [{ x: -10, y: -10, width: 30, height: 30 }],
    })
    expect(queue.drain()).toBeNull()
  })

  it('band 吸收被完全包含的 region（先 region 后 band）', () => {
    const queue = new InvalidationQueue('regions')
    queue.push({ type: 'region', region: { x: 5, y: 5, width: 10, height: 10 } })
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } })
    expect(queue.drain()).toEqual({
      full: false,
      regions: [{ x: 0, y: 0, width: 800, height: 40 }],
    })
  })

  it('band 仅相交不包含 region 时不吸收：region 重绘区保留（窄条带旁的大脏区失效不被吞掉）', () => {
    const queue = new InvalidationQueue('regions')
    // 窄 band [0..46] 与溢出 region [46..2046] 仅重叠边缘，region 必须保留自身重绘
    queue.push({ type: 'region', region: { x: 46, y: 168, width: 2000, height: 28 } })
    queue.push({ type: 'band', region: { x: 0, y: 168, width: 46, height: 56 } })
    const plan = queue.drain()
    expect(plan).toEqual({
      full: false,
      regions: [
        { x: 0, y: 168, width: 46, height: 56 },
        { x: 36, y: 158, width: 2020, height: 48 },
      ],
    })
  })

  it('已有 band 吸收后到的被包含 region', () => {
    const queue = new InvalidationQueue('regions')
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } })
    queue.push({ type: 'region', region: { x: 5, y: 5, width: 10, height: 10 } })
    queue.push({ type: 'region', region: { x: 500, y: 500, width: 10, height: 10 } })
    const plan = queue.drain()
    expect(plan).toEqual({
      full: false,
      regions: [
        { x: 0, y: 0, width: 800, height: 40 },
        { x: 490, y: 490, width: 30, height: 30 },
      ],
    })
  })

  it('已有 band 后到的 region 仅相交不被吸收', () => {
    const queue = new InvalidationQueue('regions')
    queue.push({ type: 'band', region: { x: 0, y: 168, width: 46, height: 56 } })
    queue.push({ type: 'region', region: { x: 46, y: 168, width: 2000, height: 28 } })
    const plan = queue.drain()
    expect(plan).toEqual({
      full: false,
      regions: [
        { x: 0, y: 168, width: 46, height: 56 },
        { x: 36, y: 158, width: 2020, height: 48 },
      ],
    })
  })

  it('band 数超过 8 升级为 full', () => {
    const queue = new InvalidationQueue('regions')
    for (let i = 0; i <= 8; i++) {
      queue.push({ type: 'band', region: { x: 0, y: i * 100, width: 800, height: 40 } })
    }
    expect(queue.drain()).toEqual({ full: true })
  })

  it('full 吸收一切，且 full 之后的增量失效被忽略', () => {
    const queue = new InvalidationQueue('regions')
    queue.push({ type: 'region', region: { x: 0, y: 0, width: 10, height: 10 } })
    queue.push({ type: 'full' })
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } })
    expect(queue.drain()).toEqual({ full: true })
  })
})

describe('InvalidationQueue 消费策略（建层注入）', () => {
  function planOf(consumption: LayerConsumption, push: (queue: InvalidationQueue) => void) {
    const queue = new InvalidationQueue(consumption)
    push(queue)
    return queue.drain()
  }

  it('band-full-only 仅响应 band/full：region 档被忽略', () => {
    expect(
      planOf('band-full-only', (q) =>
        q.push({ type: 'region', region: { x: 0, y: 0, width: 10, height: 10 } }),
      ),
    ).toBeNull()
    expect(
      planOf('band-full-only', (q) =>
        q.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } }),
      ),
    ).toEqual({
      full: false,
      regions: [{ x: 0, y: 0, width: 800, height: 40 }],
    })
    expect(planOf('band-full-only', (q) => q.push({ type: 'full' }))).toEqual({ full: true })
  })

  it('regions 逐 region 增量补画', () => {
    expect(
      planOf('regions', (q) =>
        q.push({ type: 'region', region: { x: 0, y: 0, width: 10, height: 10 } }),
      ),
    ).toEqual({ full: false, regions: [{ x: -10, y: -10, width: 30, height: 30 }] })
  })

  it('always-full 响应一切但整层重画', () => {
    expect(
      planOf('always-full', (q) =>
        q.push({ type: 'region', region: { x: 0, y: 0, width: 10, height: 10 } }),
      ),
    ).toEqual({
      full: true,
    })
    expect(
      planOf('always-full', (q) =>
        q.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } }),
      ),
    ).toEqual({
      full: true,
    })
  })

  it('空队列 drain 返回 null', () => {
    expect(new InvalidationQueue('regions').drain()).toBeNull()
  })
})
