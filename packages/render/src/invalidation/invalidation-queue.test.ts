import { describe, expect, it } from 'vitest'

import { InvalidationQueue } from './invalidation-queue'
import type { LayerKind } from '../types'

describe('InvalidationQueue 合并语义', () => {
  it('cell 归一化：双包围盒 union + 扩边 10 + 像素对齐', () => {
    const queue = new InvalidationQueue('body')
    queue.push({
      type: 'cell',
      region: { x: 0.5, y: 0.5, width: 10, height: 10 },
      prevRegion: { x: 20, y: 0.5, width: 10, height: 10 },
    })
    // union → {0.5,0.5,29.5,10}；spread(10) → {-9.5,-9.5,49.5,30}；ceil → {-10,-10,50,31}
    expect(queue.drain()).toEqual({
      full: false,
      regions: [{ x: -10, y: -10, width: 50, height: 31 }],
    })
  })

  it('相同 cell 去重，drain 后队列重置', () => {
    const queue = new InvalidationQueue('body')
    const region = { x: 0, y: 0, width: 10, height: 10 }
    queue.push({ type: 'cell', region })
    queue.push({ type: 'cell', region })
    const plan = queue.drain()
    expect(plan).toEqual({
      full: false,
      regions: [{ x: -10, y: -10, width: 30, height: 30 }],
    })
    expect(queue.drain()).toBeNull()
  })

  it('band 吸收相交 cell（先 cell 后 band）', () => {
    const queue = new InvalidationQueue('body')
    queue.push({ type: 'cell', region: { x: 5, y: 5, width: 10, height: 10 } })
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } })
    expect(queue.drain()).toEqual({
      full: false,
      regions: [{ x: 0, y: 0, width: 800, height: 40 }],
    })
  })

  it('已有 band 吸收后到的相交 cell', () => {
    const queue = new InvalidationQueue('body')
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } })
    queue.push({ type: 'cell', region: { x: 5, y: 5, width: 10, height: 10 } })
    queue.push({ type: 'cell', region: { x: 500, y: 500, width: 10, height: 10 } })
    const plan = queue.drain()
    expect(plan).toEqual({
      full: false,
      regions: [
        { x: 0, y: 0, width: 800, height: 40 },
        { x: 490, y: 490, width: 30, height: 30 },
      ],
    })
  })

  it('band 数超过 8 升级为 full', () => {
    const queue = new InvalidationQueue('body')
    for (let i = 0; i <= 8; i++) {
      queue.push({ type: 'band', region: { x: 0, y: i * 100, width: 800, height: 40 } })
    }
    expect(queue.drain()).toEqual({ full: true })
  })

  it('full 吸收一切，且 full 之后的增量失效被忽略', () => {
    const queue = new InvalidationQueue('body')
    queue.push({ type: 'cell', region: { x: 0, y: 0, width: 10, height: 10 } })
    queue.push({ type: 'full' })
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } })
    expect(queue.drain()).toEqual({ full: true })
  })
})

describe('InvalidationQueue 分层消费策略', () => {
  function planOf(kind: LayerKind, push: (queue: InvalidationQueue) => void) {
    const queue = new InvalidationQueue(kind)
    push(queue)
    return queue.drain()
  }

  it('ground 仅响应 band/full：cell 被忽略', () => {
    expect(
      planOf('ground', (q) =>
        q.push({ type: 'cell', region: { x: 0, y: 0, width: 10, height: 10 } }),
      ),
    ).toBeNull()
    expect(
      planOf('ground', (q) =>
        q.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } }),
      ),
    ).toEqual({
      full: false,
      regions: [{ x: 0, y: 0, width: 800, height: 40 }],
    })
    expect(planOf('ground', (q) => q.push({ type: 'full' }))).toEqual({ full: true })
  })

  it('body/media 逐 region 增量补画', () => {
    for (const kind of ['body', 'media'] as const) {
      expect(
        planOf(kind, (q) =>
          q.push({ type: 'cell', region: { x: 0, y: 0, width: 10, height: 10 } }),
        ),
      ).toEqual({ full: false, regions: [{ x: -10, y: -10, width: 30, height: 30 }] })
    }
  })

  it('sky 响应一切但整层重画', () => {
    expect(
      planOf('sky', (q) => q.push({ type: 'cell', region: { x: 0, y: 0, width: 10, height: 10 } })),
    ).toEqual({
      full: true,
    })
    expect(
      planOf('sky', (q) =>
        q.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 40 } }),
      ),
    ).toEqual({
      full: true,
    })
  })

  it('空队列 drain 返回 null', () => {
    expect(new InvalidationQueue('body').drain()).toBeNull()
  })
})
