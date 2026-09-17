// cell 级位图缓存（docs/perf-redesign 03 §2.4 MediaCache）：
// 按格 key 缓存解码位图，LRU 淘汰，容量受 bytes 与条数双重预算约束。
// media 层滚动帧只 blit 命中位图，不重算格内容。

import type { RenderImageSource } from '@infinite-table/render'

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_COUNT = 1000

export interface MediaCacheOptions {
  /** 位图字节总预算（默认 256MB） */
  maxBytes?: number
  /** 条目上限（默认 1000） */
  maxCount?: number
}

interface CacheEntry<T> {
  value: T
  bytes: number
}

export class MediaCache<T = RenderImageSource> {
  /** Map 迭代序即 LRU 序：get/put 命中时移到末尾（最新） */
  private readonly entries = new Map<string, CacheEntry<T>>()
  private maxBytes: number
  private maxCount: number
  private bytes = 0

  constructor(options: MediaCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxCount = options.maxCount ?? DEFAULT_MAX_COUNT
  }

  get size(): number {
    return this.entries.size
  }

  get totalBytes(): number {
    return this.bytes
  }

  /** 命中则提升为最近使用 */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  /** 写入并淘汰至预算内；同 key 覆盖先扣旧账 */
  put(key: string, value: T, bytes: number): void {
    this.invalidateKey(key)
    this.entries.set(key, { value, bytes })
    this.bytes += bytes
    this.evictWithinBudget()
  }

  invalidateKey(key: string): void {
    const entry = this.entries.get(key)
    if (entry) {
      this.entries.delete(key)
      this.bytes -= entry.bytes
    }
  }

  invalidateAll(): void {
    this.entries.clear()
    this.bytes = 0
  }

  configure(options: MediaCacheOptions): void {
    this.maxBytes = options.maxBytes ?? this.maxBytes
    this.maxCount = options.maxCount ?? this.maxCount
    this.evictWithinBudget()
  }

  /** 从最久未用端逐出，直到回落进 bytes/count 预算 */
  private evictWithinBudget(): void {
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.maxBytes && this.entries.size <= this.maxCount) {
        return
      }
      this.entries.delete(key)
      this.bytes -= entry.bytes
    }
  }
}
