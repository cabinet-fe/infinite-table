// ImageService：URL 级图片资源服务——
// 窗口化加载（视口+余量内才发起/保持请求，滚出即取消降级）、
// 解码位图 LRU（bytes 计量、超预算逐出最久未用且不在窗口内的条目）、
// hasResource 同步查询支撑首帧无闪、error 态必触发 onImageError（消灭"永远 loading"）。

import type { RenderImageSource } from '@infinite-table/render'

import type { CellRef } from '../types'

const DEFAULT_MAX_CACHE_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_CACHE_COUNT = 1000
const DEFAULT_CONCURRENCY = 10
const DEFAULT_PLACEHOLDER_DELAY = 80

/** 图片资源状态机：idle（未发起/已降级）→ loading → ready | error */
export type ImageState = 'idle' | 'loading' | 'ready' | 'error'

/** 加载完成的可用位图 */
export interface LoadedImage {
  source: RenderImageSource
  width: number
  height: number
}

/** 传输层：默认走 DOM Image，测试注入假加载器 */
export type ImageLoader = (
  url: string,
  crossOrigin: string | null | undefined,
) => Promise<LoadedImage>

export interface ImageServiceOptions {
  /** 解码位图 LRU 字节预算（默认 256MB） */
  maxCacheBytes?: number
  /** 解码位图条目上限（默认 1000） */
  maxCacheCount?: number
  /** 并发加载上限（默认 10） */
  concurrency?: number
  /** 占位延迟显示 ms（默认 80，防快速滚动占位闪烁） */
  placeholderDelay?: number
  crossOrigin?: string | null
  loadImage?: ImageLoader
  /** 位图字节估算（默认 宽×高×4） */
  estimateBytes?: (image: LoadedImage) => number
}

export interface ImageLoadEvent {
  url: string
  width: number
  height: number
  cells: CellRef[]
}

export interface ImageErrorEvent {
  url: string
  error: unknown
  cells: CellRef[]
}

export type ImageSettledCallback = (state: ImageState) => void
/** 窗口判定：返回 cell 是否位于「视口+余量」内 */
export type WindowPredicate = (cell: CellRef) => boolean

type UrlResolver = (raw: string) => string | null

interface EntryRef {
  cell: CellRef
  onSettled?: ImageSettledCallback
}

interface Entry {
  state: ImageState
  image?: LoadedImage
  bytes: number
  error?: unknown
  /** 引用该 URL 的格（key 为 `col:row`） */
  refs: Map<string, EntryRef>
  /** 加载代际：取消/失效后迟到的加载结果按代际丢弃 */
  generation: number
}

function defaultEstimateBytes(image: LoadedImage): number {
  return image.width * image.height * 4
}

function defaultLoadImage(
  url: string,
  crossOrigin: string | null | undefined,
): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin != null) {
      img.crossOrigin = crossOrigin
    }
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error(`image load failed: ${url}`))
    img.src = url
  })
}

function cellKey(cell: CellRef): string {
  return `${cell.col}:${cell.row}`
}

export class ImageService {
  /** Map 迭代序即 LRU 序：ready 条目被取用/完成时移到末尾（最新） */
  private readonly entries = new Map<string, Entry>()
  /** 窗口内 idle 待加载队列（登记序）：pump 按序补位，免去每次补位的全表扫描 */
  private readonly idleQueue = new Set<string>()
  private readonly loadImage: ImageLoader
  private readonly estimateBytes: (image: LoadedImage) => number
  private readonly loadListeners = new Set<(e: ImageLoadEvent) => void>()
  private readonly errorListeners = new Set<(e: ImageErrorEvent) => void>()
  private resolver: UrlResolver | null = null
  private window: WindowPredicate = () => true
  private maxCacheBytes: number
  private maxCacheCount: number
  private concurrency: number
  private crossOrigin: string | null | undefined
  private activeLoads = 0
  private readyBytes = 0
  private readyCount = 0
  private disposed = false

  /** 占位延迟显示 ms（防快速滚动占位闪烁） */
  placeholderDelay: number

  constructor(options: ImageServiceOptions = {}) {
    this.loadImage = options.loadImage ?? defaultLoadImage
    this.estimateBytes = options.estimateBytes ?? defaultEstimateBytes
    this.maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES
    this.maxCacheCount = options.maxCacheCount ?? DEFAULT_MAX_CACHE_COUNT
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
    this.placeholderDelay = options.placeholderDelay ?? DEFAULT_PLACEHOLDER_DELAY
    this.crossOrigin = options.crossOrigin
  }

  /** 同步查询：资源是否已就绪（首帧无闪的关键，纯查询不动 LRU 序） */
  hasResource(url: string): boolean {
    return this.entries.get(url)?.state === 'ready'
  }

  /** 取已就绪位图（命中提升为最近使用）；未就绪返回 undefined */
  getBitmap(url: string): LoadedImage | undefined {
    const entry = this.entries.get(url)
    if (!entry || entry.state !== 'ready' || !entry.image) {
      return undefined
    }
    this.touch(url, entry)
    return entry.image
  }

  /**
   * 请求资源并登记格引用，返回当前状态。
   * 已 ready：直接返回 'ready'（调用方当帧画位图，onSettled 不再补发）；
   * 窗口内 idle：发起或排队加载；窗口外：保持 idle 不发起（随 updateWindow 调度）。
   * onSettled 只在请求后异步落定（ready/error）时触发一次。
   */
  request(url: string, cell: CellRef, onSettled?: ImageSettledCallback): ImageState {
    const resolved = this.resolveUrl(url)
    if (resolved === null) {
      const error = new Error(`invalid image url: ${url}`)
      this.emitError(url, error, [cell])
      onSettled?.('error')
      return 'error'
    }
    const entry = this.ensureEntry(resolved)
    entry.refs.set(cellKey(cell), { cell, onSettled })
    if (entry.state === 'ready') {
      this.touch(resolved, entry)
      return 'ready'
    }
    if (entry.state === 'idle') {
      if (this.isInWindow(entry)) {
        this.idleQueue.add(resolved)
        this.pump()
      }
      return entry.state
    }
    return entry.state
  }

  /**
   * 引用裁剪原语（R2-7）：格滚出窗口被清扫时由宿主接线调用，移除该格引用；
   * idle/error 态条目随之无引用时立即脱离跟踪面（重入由格重建时 request 重登记），
   * 图片密集长会话中滚动帧的窗口调度扫描面从 O(累计条目) 收窄到 O(活跃窗口引用)。
   * 浮动对象引用（request 带 onSettled）生命周期跟随对象本身、不可随窗口裁剪
   * （否则滚回后 onSettled 丢失导致浮动图永不加载），本原语对其不做移除。
   */
  releaseRef(url: string, cell: CellRef): void {
    const entry = this.entries.get(url)
    if (!entry) {
      return
    }
    const ref = entry.refs.get(cellKey(cell))
    if (!ref || ref.onSettled !== undefined) {
      return
    }
    entry.refs.delete(cellKey(cell))
    if (entry.refs.size === 0 && (entry.state === 'idle' || entry.state === 'error')) {
      this.idleQueue.delete(url)
      this.entries.delete(url)
    }
  }

  /**
   * 窗口化调度：以「视口+余量」谓词重估所有条目——
   * 窗口内 idle 条目入队提权加载；滚出窗口的 loading 条目取消降级为 idle
   * （迟到的结果按代际丢弃）、滚出窗口的 idle 条目出队。
   */
  updateWindow(predicate: WindowPredicate): void {
    this.window = predicate
    for (const [url, entry] of this.entries) {
      if (entry.state === 'loading') {
        if (!this.isInWindow(entry)) {
          entry.generation++
          entry.state = 'idle'
          this.activeLoads--
          // 引用已随清扫裁剪光：取消降级后直接脱离跟踪面，重入由格重建重登记
          if (entry.refs.size === 0) {
            this.entries.delete(url)
          }
        }
        continue
      }
      if (entry.state === 'idle' && entry.refs.size > 0) {
        if (this.isInWindow(entry)) {
          this.idleQueue.add(url)
        } else {
          this.idleQueue.delete(url)
        }
      }
    }
    this.pump()
  }

  /** 按 URL 逐出缓存；返回引用它的格（供调用方重绘这些可见 cell） */
  invalidate(url: string): CellRef[] {
    const entry = this.entries.get(url)
    if (!entry) {
      return []
    }
    if (entry.state === 'loading') {
      entry.generation++
      this.activeLoads--
    }
    this.idleQueue.delete(url)
    this.untrackReady(entry)
    this.entries.delete(url)
    this.pump()
    return [...entry.refs.values()].map((ref) => ref.cell)
  }

  invalidateAll(): void {
    // Map 迭代期删除当前条目是安全的（逐条 invalidate 只删当前 key）
    for (const url of this.entries.keys()) {
      this.invalidate(url)
    }
  }

  onImageLoad(listener: (e: ImageLoadEvent) => void): () => void {
    this.loadListeners.add(listener)
    return () => this.loadListeners.delete(listener)
  }

  onImageError(listener: (e: ImageErrorEvent) => void): () => void {
    this.errorListeners.add(listener)
    return () => this.errorListeners.delete(listener)
  }

  /** URL 规范化钩子：鉴权/相对路径由宿主补全；返回 null = 判定非法，直接走 error */
  setUrlResolver(resolver: UrlResolver | null): void {
    this.resolver = resolver
  }

  configure(options: ImageServiceOptions): void {
    this.maxCacheBytes = options.maxCacheBytes ?? this.maxCacheBytes
    this.maxCacheCount = options.maxCacheCount ?? this.maxCacheCount
    this.concurrency = options.concurrency ?? this.concurrency
    this.placeholderDelay = options.placeholderDelay ?? this.placeholderDelay
    if (options.crossOrigin !== undefined) {
      this.crossOrigin = options.crossOrigin
    }
    this.evictWithinBudget()
    this.pump()
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.entries.values()) {
      entry.generation++
    }
    this.entries.clear()
    this.idleQueue.clear()
    this.activeLoads = 0
    this.readyBytes = 0
    this.readyCount = 0
    this.loadListeners.clear()
    this.errorListeners.clear()
  }

  private resolveUrl(url: string): string | null {
    if (this.resolver) {
      return this.resolver(url)
    }
    // 内置宽松判定：任何非空字符串都尝试加载，失败即 error 态
    return url.trim() === '' ? null : url
  }

  private ensureEntry(url: string): Entry {
    let entry = this.entries.get(url)
    if (!entry) {
      entry = { state: 'idle', bytes: 0, refs: new Map(), generation: 0 }
      this.entries.set(url, entry)
    }
    return entry
  }

  private isInWindow(entry: Entry): boolean {
    for (const ref of entry.refs.values()) {
      if (this.window(ref.cell)) {
        return true
      }
    }
    return false
  }

  private touch(url: string, entry: Entry): void {
    this.entries.delete(url)
    this.entries.set(url, entry)
  }

  private trackReady(entry: Entry, image: LoadedImage): void {
    entry.image = image
    entry.bytes = this.estimateBytes(image)
    this.readyBytes += entry.bytes
    this.readyCount++
  }

  private untrackReady(entry: Entry): void {
    if (entry.state === 'ready') {
      this.readyBytes -= entry.bytes
      this.readyCount--
    }
  }

  /** 填充空闲并发槽：按登记序消费窗口内 idle 队列发起加载（槽满即返回，均摊每条目 O(1)） */
  private pump(): void {
    if (this.disposed) {
      return
    }
    for (const url of this.idleQueue) {
      if (this.activeLoads >= this.concurrency) {
        return
      }
      this.idleQueue.delete(url)
      const entry = this.entries.get(url)
      if (entry && entry.state === 'idle' && entry.refs.size > 0 && this.isInWindow(entry)) {
        this.startLoad(url, entry)
      }
    }
  }

  private startLoad(url: string, entry: Entry): void {
    entry.state = 'loading'
    const generation = ++entry.generation
    this.activeLoads++
    this.loadImage(url, this.crossOrigin).then(
      (image) => {
        if (this.disposed || entry.generation !== generation) {
          return
        }
        this.activeLoads--
        entry.state = 'ready'
        this.trackReady(entry, image)
        this.touch(url, entry)
        const cells = [...entry.refs.values()].map((ref) => ref.cell)
        for (const ref of entry.refs.values()) {
          ref.onSettled?.('ready')
        }
        this.emitLoad({ url, width: image.width, height: image.height, cells })
        this.evictWithinBudget()
        this.pump()
      },
      (error: unknown) => {
        if (this.disposed || entry.generation !== generation) {
          return
        }
        this.activeLoads--
        entry.state = 'error'
        entry.error = error
        const cells = [...entry.refs.values()].map((ref) => ref.cell)
        for (const ref of entry.refs.values()) {
          ref.onSettled?.('error')
        }
        this.emitError(url, error, cells)
        this.pump()
      },
    )
  }

  /** 超预算逐出：优先逐出最久未用且不在当前窗口内的 ready 条目；仍超则按 LRU 强逐 */
  private evictWithinBudget(): void {
    for (const pass of ['out-of-window', 'any'] as const) {
      for (const [url, entry] of this.entries) {
        if (this.readyBytes <= this.maxCacheBytes && this.readyCount <= this.maxCacheCount) {
          return
        }
        if (entry.state !== 'ready') {
          continue
        }
        if (pass === 'out-of-window' && this.isInWindow(entry)) {
          continue
        }
        this.untrackReady(entry)
        this.entries.delete(url)
      }
    }
  }

  private emitLoad(e: ImageLoadEvent): void {
    for (const listener of this.loadListeners) {
      listener(e)
    }
  }

  private emitError(url: string, error: unknown, cells: CellRef[]): void {
    for (const listener of this.errorListeners) {
      listener({ url, error, cells })
    }
  }
}
