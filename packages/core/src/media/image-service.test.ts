import type { RenderImageSource } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import type { ImageLoader, LoadedImage } from './image-service'
import { ImageService } from './image-service'

function fakeImage(width: number, height: number): LoadedImage {
  return { source: { width, height } as unknown as RenderImageSource, width, height }
}

/** 手动决出的假加载器：记录发起的 URL，由测试逐条 settle */
function controllableLoader() {
  const pending = new Map<string, ((image: LoadedImage) => void)[]>()
  const failures = new Map<string, ((error: unknown) => void)[]>()
  const started: string[] = []
  const loadImage: ImageLoader = (url) => {
    started.push(url)
    return new Promise<LoadedImage>((resolve, reject) => {
      pending.set(url, [...(pending.get(url) ?? []), resolve])
      failures.set(url, [...(failures.get(url) ?? []), reject])
    })
  }
  return {
    started,
    loadImage,
    resolve: (url: string, image = fakeImage(10, 10)) => {
      for (const fn of pending.get(url) ?? []) fn(image)
    },
    reject: (url: string, error: unknown = new Error('boom')) => {
      for (const fn of failures.get(url) ?? []) fn(error)
    },
  }
}

/** 等待微任务队列清空（加载回调均为 promise 续体） */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('ImageService 加载状态机', () => {
  it('request → loading → ready：hasResource/getBitmap 就绪，onSettled 与 onImageLoad 触发', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    const settled: string[] = []
    const loaded: string[] = []
    service.onImageLoad((e) => loaded.push(`${e.url}:${e.width}x${e.height}`))

    expect(service.request('a.png', { col: 0, row: 0 }, (s) => settled.push(s))).toBe('loading')
    expect(service.hasResource('a.png')).toBe(false)
    loader.resolve('a.png', fakeImage(20, 8))
    await flush()

    expect(service.hasResource('a.png')).toBe(true)
    expect(service.getBitmap('a.png')).toEqual(fakeImage(20, 8))
    expect(settled).toEqual(['ready'])
    expect(loaded).toEqual(['a.png:20x8'])
  })

  it('已 ready 的 URL 再请求同步返回 ready，不再发起加载、不补发 onSettled', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    service.request('a.png', { col: 0, row: 0 })
    loader.resolve('a.png')
    await flush()
    const settled: string[] = []
    expect(service.request('a.png', { col: 1, row: 1 }, (s) => settled.push(s))).toBe('ready')
    expect(loader.started).toEqual(['a.png'])
    expect(settled).toEqual([])
  })

  it('同 URL 多格引用只加载一次，onImageLoad 带出全部引用格', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    const cells: unknown[] = []
    service.onImageLoad((e) => cells.push(e.cells))
    service.request('a.png', { col: 0, row: 0 })
    service.request('a.png', { col: 3, row: 5 })
    loader.resolve('a.png')
    await flush()
    expect(loader.started).toEqual(['a.png'])
    expect(cells).toEqual([
      [
        { col: 0, row: 0 },
        { col: 3, row: 5 },
      ],
    ])
  })

  it('加载失败进入 error 态并触发 onImageError（无"永远 loading"）', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    const errors: string[] = []
    const settled: string[] = []
    service.onImageError((e) => errors.push(e.url))
    expect(service.request('bad.png', { col: 0, row: 0 }, (s) => settled.push(s))).toBe('loading')
    loader.reject('bad.png')
    await flush()
    expect(service.hasResource('bad.png')).toBe(false)
    expect(settled).toEqual(['error'])
    expect(errors).toEqual(['bad.png'])
  })

  it('URL resolver 返回 null 判定非法：直接 error，不发起加载', () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    const errors: string[] = []
    service.onImageError((e) => errors.push(e.url))
    service.setUrlResolver((raw) => (raw.startsWith('ok:') ? raw.slice(3) : null))
    expect(service.request('nope', { col: 0, row: 0 })).toBe('error')
    expect(errors).toEqual(['nope'])
    expect(loader.started).toEqual([])
  })

  it('并发上限：超出的请求排队，槽位释放后补发', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage, concurrency: 2 })
    service.request('a.png', { col: 0, row: 0 })
    service.request('b.png', { col: 0, row: 1 })
    expect(service.request('c.png', { col: 0, row: 2 })).toBe('idle')
    expect(loader.started).toEqual(['a.png', 'b.png'])
    loader.resolve('a.png')
    await flush()
    expect(loader.started).toEqual(['a.png', 'b.png', 'c.png'])
  })
})

describe('ImageService 窗口化加载', () => {
  it('窗口外请求不发起；updateWindow 划入窗口后提权加载', () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    service.updateWindow((cell) => cell.row < 10)
    expect(service.request('far.png', { col: 0, row: 100 })).toBe('idle')
    expect(loader.started).toEqual([])
    service.updateWindow((cell) => cell.row >= 10)
    expect(loader.started).toEqual(['far.png'])
  })

  it('滚出窗口的 loading 请求被取消：迟到的加载结果被丢弃', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    service.updateWindow((cell) => cell.row < 10)
    service.request('a.png', { col: 0, row: 0 })
    expect(loader.started).toEqual(['a.png'])
    // 滚出：引用格全部在窗口外 → 取消降级
    service.updateWindow((cell) => cell.row >= 50)
    loader.resolve('a.png')
    await flush()
    expect(service.hasResource('a.png')).toBe(false)
    // 重新划入窗口 → 重新加载
    service.updateWindow(() => true)
    expect(loader.started).toEqual(['a.png', 'a.png'])
    loader.resolve('a.png')
    await flush()
    expect(service.hasResource('a.png')).toBe(true)
  })

  it('同 URL 一格在窗口内即视为窗口内，不取消', () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    service.updateWindow((cell) => cell.row < 10)
    service.request('a.png', { col: 0, row: 0 })
    service.request('a.png', { col: 0, row: 999 })
    service.updateWindow((cell) => cell.row >= 900)
    expect(loader.started).toEqual(['a.png'])
    service.updateWindow(() => true)
  })
})

describe('ImageService 位图 LRU 与失效', () => {
  it('ready 位图超 bytes 预算：逐出最久未用且不在窗口内的条目', async () => {
    const loader = controllableLoader()
    const service = new ImageService({
      loadImage: loader.loadImage,
      maxCacheBytes: 100,
      estimateBytes: () => 40,
    })
    service.request('a.png', { col: 0, row: 0 })
    service.request('b.png', { col: 0, row: 1 })
    service.request('c.png', { col: 0, row: 2 })
    loader.resolve('a.png')
    loader.resolve('b.png')
    loader.resolve('c.png')
    await flush()
    // 当前窗口只含 row 1：b 在窗口内，a/c 在窗口外
    service.updateWindow((cell) => cell.row === 1)
    // 第 4 张（窗口内）就绪后 160 > 100：逐出窗口外最久未用的 a、c
    service.request('d.png', { col: 0, row: 1 })
    loader.resolve('d.png')
    await flush()
    expect(service.hasResource('a.png')).toBe(false)
    expect(service.hasResource('c.png')).toBe(false)
    expect(service.hasResource('b.png')).toBe(true)
    expect(service.hasResource('d.png')).toBe(true)
  })

  it('invalidate 逐出 URL 并返回引用格；invalidateAll 清空', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    service.request('a.png', { col: 1, row: 2 })
    service.request('b.png', { col: 3, row: 4 })
    loader.resolve('a.png')
    loader.resolve('b.png')
    await flush()
    expect(service.invalidate('a.png')).toEqual([{ col: 1, row: 2 }])
    expect(service.hasResource('a.png')).toBe(false)
    service.invalidateAll()
    expect(service.hasResource('b.png')).toBe(false)
  })

  it('dispose 后迟到结果被吞，监听器清空', async () => {
    const loader = controllableLoader()
    const service = new ImageService({ loadImage: loader.loadImage })
    const loaded: string[] = []
    service.onImageLoad((e) => loaded.push(e.url))
    service.request('a.png', { col: 0, row: 0 })
    service.dispose()
    loader.resolve('a.png')
    await flush()
    expect(loaded).toEqual([])
  })
})
