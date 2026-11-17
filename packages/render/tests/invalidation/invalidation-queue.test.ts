import { describe, expect, it } from 'vitest'

import { InvalidationQueue } from '../../src/invalidation/invalidation-queue'
import { intersects } from '../../src/region'
import type { LayerConsumption, Region } from '../../src/types'

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

/** 断言矩形集两两不相交，且总面积等于预期并集面积 */
function expectPairwiseDisjointWithArea(regions: readonly Region[], expectedArea: number): void {
  let totalArea = 0
  for (let i = 0; i < regions.length; i++) {
    const a = regions[i]!
    expect(a.width).toBeGreaterThan(0)
    expect(a.height).toBeGreaterThan(0)
    totalArea += a.width * a.height
    for (let j = i + 1; j < regions.length; j++) {
      expect(intersects(a, regions[j]!)).toBe(false)
    }
  }
  expect(totalArea).toBe(expectedArea)
}

describe('InvalidationQueue 对角 band 去重与 region 合并上限', () => {
  it('对角滚动（水平 band + 垂直 band）拆解为两两不相交矩形，总面积等于精确并集且交叉角只绘一次', () => {
    const queue = new InvalidationQueue('regions')
    // 水平 band [0..800, 500..540] 面积 32000，垂直 band [760..800, 0..540] 面积 21600
    // 交叉角 [760..800, 500..540] 面积 1600，精确并集面积 = 32000 + 21600 - 1600 = 52000
    queue.push({ type: 'band', region: { x: 0, y: 500, width: 800, height: 40 } })
    queue.push({ type: 'band', region: { x: 760, y: 0, width: 40, height: 540 } })
    const plan = queue.drain()
    expect(plan).not.toBeNull()
    expect(plan!.full).toBe(false)
    if (!plan || plan.full) throw new Error('expected partial plan')
    expectPairwiseDisjointWithArea(plan.regions, 52000)

    // 十字交叉（垂直 band 穿中水平 band）拆成上下两段 + 水平整条，同样两两不相交且面积精确
    const crossQueue = new InvalidationQueue('band-full-only')
    crossQueue.push({ type: 'band', region: { x: 0, y: 200, width: 800, height: 40 } })
    crossQueue.push({ type: 'band', region: { x: 300, y: 0, width: 50, height: 600 } })
    const crossPlan = crossQueue.drain()
    expect(crossPlan).not.toBeNull()
    if (!crossPlan || crossPlan.full) throw new Error('expected partial plan')
    // 32000 + 30000 - 2000 = 60000
    expectPairwiseDisjointWithArea(crossPlan.regions, 60000)
  })

  it('被已有 band 完全包含的新 band 直接忽略，被新 band 完全包含的旧 band 被吸收', () => {
    const queue = new InvalidationQueue('regions')
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 100 } })
    queue.push({ type: 'band', region: { x: 10, y: 10, width: 100, height: 50 } })
    expect(queue.drain()).toEqual({
      full: false,
      regions: [{ x: 0, y: 0, width: 800, height: 100 }],
    })

    queue.push({ type: 'band', region: { x: 10, y: 10, width: 100, height: 50 } })
    queue.push({ type: 'band', region: { x: 0, y: 0, width: 800, height: 100 } })
    expect(queue.drain()).toEqual({
      full: false,
      regions: [{ x: 0, y: 0, width: 800, height: 100 }],
    })
  })

  it('重叠与桥接 region 通过 union 级联合并（不重复绘制）', () => {
    const queue = new InvalidationQueue('regions')
    // 两个原本分离的 region
    queue.push({ type: 'region', region: { x: 0, y: 0, width: 10, height: 10 } })
    queue.push({ type: 'region', region: { x: 60, y: 0, width: 10, height: 10 } })
    // 第三个 region 桥接两者 → 三者合并为一个包围盒
    queue.push({ type: 'region', region: { x: 25, y: 0, width: 20, height: 10 } })
    // raw: [0..70, 0..10]，spread(10) → [-10..80, -10..20] = { x: -10, y: -10, width: 90, height: 30 }
    expect(queue.drain()).toEqual({
      full: false,
      regions: [{ x: -10, y: -10, width: 90, height: 30 }],
    })
  })

  it('离散 region 数超过 MAX_REGIONS (24) 升级为 full，重叠合并后未超上限不升级', () => {
    const coalesced = new InvalidationQueue('regions')
    for (let i = 0; i < 30; i++) {
      // 步长 15 < 2*SPREAD + width(10) = 30，全部重叠合并成单个 region
      coalesced.push({ type: 'region', region: { x: i * 15, y: 0, width: 10, height: 10 } })
    }
    const coalescedPlan = coalesced.drain()
    expect(coalescedPlan).toEqual({
      full: false,
      regions: [{ x: -10, y: -10, width: 30 * 15 - 15 + 10 + 20, height: 30 }],
    })

    const overflowed = new InvalidationQueue('regions')
    for (let i = 0; i <= 24; i++) {
      // 步长 100，两两严格分离，第 25 个触发 MAX_REGIONS 上限升级 full
      overflowed.push({ type: 'region', region: { x: i * 100, y: 0, width: 10, height: 10 } })
    }
    expect(overflowed.drain()).toEqual({ full: true })
  })
})
