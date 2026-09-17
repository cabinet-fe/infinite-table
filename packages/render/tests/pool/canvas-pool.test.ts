import { describe, expect, it } from 'vitest'

import { CanvasPool } from '../../src/pool/canvas-pool'
import { FakeCanvas } from '../testing/fake-canvas'

describe('CanvasPool 池化', () => {
  it('release 后同尺寸 acquire 复用同一实例', () => {
    const pool = new CanvasPool(() => new FakeCanvas())
    const first = pool.acquire(100, 50)
    expect(first.width).toBe(100)
    expect(first.height).toBe(50)
    pool.release(first)
    expect(pool.size).toBe(1)
    const second = pool.acquire(100, 50)
    expect(second).toBe(first)
    expect(pool.size).toBe(0)
  })

  it('不同尺寸分桶，不复用', () => {
    const pool = new CanvasPool(() => new FakeCanvas())
    const first = pool.acquire(100, 50)
    pool.release(first)
    const second = pool.acquire(200, 50)
    expect(second).not.toBe(first)
    expect(second.width).toBe(200)
  })

  it('超过容量上限时丢弃归还的画布', () => {
    const pool = new CanvasPool(() => new FakeCanvas(), 2)
    const a = pool.acquire(10, 10)
    const b = pool.acquire(20, 20)
    const c = pool.acquire(30, 30)
    pool.release(a)
    pool.release(b)
    pool.release(c)
    expect(pool.size).toBe(2)
    // c 被丢弃：再申请 30x30 是新实例
    expect(pool.acquire(30, 30)).not.toBe(c)
  })

  it('clear 清空池', () => {
    const pool = new CanvasPool(() => new FakeCanvas())
    pool.release(pool.acquire(10, 10))
    pool.clear()
    expect(pool.size).toBe(0)
  })
})
