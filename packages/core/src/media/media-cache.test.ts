import type { RenderImageSource } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { MediaCache } from './media-cache'

function fakeBitmap(tag: string): RenderImageSource {
  // node 环境无真实位图，结构化类型下用标记对象即可
  return { tag } as unknown as RenderImageSource
}

describe('MediaCache 容量淘汰', () => {
  it('超出 bytes 预算时从最久未用端逐出', () => {
    const cache = new MediaCache({ maxBytes: 100 })
    cache.put('a', fakeBitmap('a'), 40)
    cache.put('b', fakeBitmap('b'), 40)
    cache.put('c', fakeBitmap('c'), 40)
    // 120 > 100：逐出最久未用的 a
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeDefined()
    expect(cache.get('c')).toBeDefined()
    expect(cache.totalBytes).toBe(80)
  })

  it('get 命中提升为最近使用，淘汰顺序随之变化', () => {
    const cache = new MediaCache({ maxBytes: 100 })
    cache.put('a', fakeBitmap('a'), 40)
    cache.put('b', fakeBitmap('b'), 40)
    cache.get('a')
    cache.put('c', fakeBitmap('c'), 40)
    // a 刚被访问，逐出 b
    expect(cache.get('a')).toBeDefined()
    expect(cache.get('b')).toBeUndefined()
  })

  it('超出 count 上限时按 LRU 逐出', () => {
    const cache = new MediaCache({ maxCount: 2 })
    cache.put('a', fakeBitmap('a'), 1)
    cache.put('b', fakeBitmap('b'), 1)
    cache.put('c', fakeBitmap('c'), 1)
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
  })

  it('同 key 覆盖先扣旧账，不重复计字节', () => {
    const cache = new MediaCache({ maxBytes: 100 })
    cache.put('a', fakeBitmap('a'), 40)
    cache.put('a', fakeBitmap('a2'), 50)
    expect(cache.size).toBe(1)
    expect(cache.totalBytes).toBe(50)
  })

  it('configure 收紧预算立即触发淘汰', () => {
    const cache = new MediaCache()
    cache.put('a', fakeBitmap('a'), 60)
    cache.put('b', fakeBitmap('b'), 60)
    cache.configure({ maxBytes: 80 })
    expect(cache.get('a')).toBeUndefined()
    expect(cache.totalBytes).toBe(60)
  })

  it('invalidateKey / invalidateAll 释放计量', () => {
    const cache = new MediaCache()
    cache.put('a', fakeBitmap('a'), 40)
    cache.put('b', fakeBitmap('b'), 40)
    cache.invalidateKey('a')
    expect(cache.totalBytes).toBe(40)
    cache.invalidateAll()
    expect(cache.size).toBe(0)
    expect(cache.totalBytes).toBe(0)
  })
})
