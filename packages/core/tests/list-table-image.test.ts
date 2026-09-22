// P7 集成：ListTable 图片管线（L2 media 层 + ImageService 窗口化加载 + 无闪协议）与浮动对象层

import type { RenderImageSource } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import { ImageCellNode } from '../src/media/image-cell-node'
import type { LoadedImage } from '../src/media/image-service'
import { RecordingContext } from './testing/recording-context'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'

function fakeImage(width = 10, height = 10): LoadedImage {
  return { source: { width, height } as unknown as RenderImageSource, width, height }
}

/** 手动决出的假加载器 */
function controllableLoader() {
  const pending: ((image: LoadedImage) => void)[] = []
  const started: string[] = []
  return {
    started,
    loadImage: (url: string) => {
      started.push(url)
      return new Promise<LoadedImage>((resolve) => pending.push(resolve))
    },
    resolveAll: (image = fakeImage()) => {
      for (const resolve of pending.splice(0)) resolve(image)
    },
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, (_, i) => ({ title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function createImageTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const loader = controllableLoader()
  const table = new ListTable({
    ...BASE_OPTIONS,
    rowCount: 1000,
    host,
    imageServiceOptions: { loadImage: loader.loadImage, placeholderDelay: 0 },
    ...extra,
  })
  return { host, loader, table }
}

function imageNodeAt(host: StubHost, col: number, row: number): ImageCellNode | undefined {
  const media = host.layers.get('media')
  return media?.root.children.find(
    (child): child is ImageCellNode =>
      child instanceof ImageCellNode && child.col === col && child.row === row,
  )
}

describe('ListTable 图片管线（L2 media 层 + 无闪协议）', () => {
  it('图片格在 media 层建节点，body 格文本留空；未就绪请求加载', () => {
    const { host, loader } = createImageTable({
      resolveCellImage: (col, row) => (col === 0 && row === 0 ? 'a.png' : null),
    })
    const node = imageNodeAt(host, 0, 0)
    expect(node).toBeDefined()
    expect(node?.url).toBe('a.png')
    expect(loader.started).toEqual(['a.png'])
    // 无图片格的表不建 media 层（L2 惰性）
    const plain = createImageTable()
    expect(plain.host.layers.has('media')).toBe(false)
  })

  it('加载完成：位图写回节点并 cell 定向失效（非整层重绘）', async () => {
    const { host, loader } = createImageTable({
      resolveCellImage: () => 'a.png',
    })
    host.submitted.length = 0
    loader.resolveAll()
    await flush()
    const node = imageNodeAt(host, 0, 0)
    expect(node).toBeDefined()
    const mediaInv = host.submitted.filter((s) => s.kind === 'media')
    // 逐格 cell 失效，无 full/band（带内按列降序建节点，逐格顺序不敏感断言）
    expect(mediaInv.length).toBeGreaterThan(0)
    expect(mediaInv.every((s) => s.inv.type === 'cell')).toBe(true)
    expect(mediaInv).toContainEqual({
      kind: 'media',
      inv: { type: 'cell', region: { x: 48, y: 36, width: 100, height: 32 } },
    })
  })

  it('边缘半格图片经 body 视口裁剪：滚动半行后不画进列头区域', async () => {
    const { host, loader, table } = createImageTable({
      resolveCellImage: () => 'a.png',
    })
    loader.resolveAll()
    await flush()
    // 滚动半行（16px）：格 (0,0) 顶部越过列头下缘 y=36，越界部分不得绘制
    table.scrollTo(0, 16)
    const node = imageNodeAt(host, 0, 0)
    expect(node?.y).toBe(20)
    const ctx = new RecordingContext()
    node?.paint(ctx)
    expect(ctx.callsOf('rect')[0]?.args).toEqual([0, 16, 100, 16])
    expect(ctx.callsOf('clip')).toHaveLength(1)
  })

  it('位图就绪后滚回：cell 级 LRU / ImageService 命中，首帧直接持图（无闪），不重复加载', async () => {
    const { host, loader, table } = createImageTable({
      resolveCellImage: (col, row) => (row < 20 ? `r${row}.png` : null),
    })
    // 并发 10：分两波决出（首波落定后排队请求补发）
    loader.resolveAll()
    await flush()
    loader.resolveAll()
    await flush()
    // 滚走再滚回
    table.scrollTo(0, 32 * 500)
    table.scrollTo(0, 0)
    const node = imageNodeAt(host, 0, 0)
    expect(node).toBeDefined()
    // 首帧即持位图：paint 路径有图可画（无占位帧）
    expect(node?.hasBitmap).toBe(true)
    // 每个 URL 只加载过一次
    expect(new Set(loader.started).size).toBe(loader.started.length)
  })

  it('窗口化加载：构造时窗口外图片格不发起请求（视口+240px 余量外）', () => {
    const loader = controllableLoader()
    const host = new StubHost()
    // row 100 远在窗口外；row 5 在视口内
    new ListTable({
      ...BASE_OPTIONS,
      rowCount: 1000,
      host,
      imageServiceOptions: { loadImage: loader.loadImage },
      resolveCellImage: (_col, row) => (row === 5 || row === 100 ? `r${row}.png` : null),
    })
    expect(loader.started).toEqual(['r5.png'])
  })

  it('滚动更新窗口：滚出余量的 loading 请求被取消，滚回后重新加载', async () => {
    const loader = controllableLoader()
    const host = new StubHost()
    const table = new ListTable({
      ...BASE_OPTIONS,
      rowCount: 1000,
      host,
      imageServiceOptions: { loadImage: loader.loadImage },
      resolveCellImage: (_col, row) => (row === 17 ? 'r17.png' : null),
    })
    // row 17 在视口内 → 发起加载
    expect(loader.started).toEqual(['r17.png'])
    // 滚到 row 15 顶部：row 17 出视口但仍在 240px 余量内 → 不取消
    table.scrollTo(0, 15 * 32)
    expect(loader.started).toEqual(['r17.png'])
    // 滚到 row 40 顶部：row 17 远在余量外 → loading 被取消，迟到的结果被丢弃
    table.scrollTo(0, 40 * 32)
    loader.resolveAll()
    await flush()
    expect(table.imageService.hasResource('r17.png')).toBe(false)
    // 滚回：row 17 重新可见 → 重新发起加载
    table.scrollTo(0, 0)
    expect(loader.started).toEqual(['r17.png', 'r17.png'])
  })
})

describe('ListTable 浮动对象层', () => {
  const FLOAT = {
    id: 'f1',
    kind: 'image' as const,
    anchor: { from: { col: 1, row: 2 }, to: { col: 2, row: 3 }, offsetX: 4, offsetY: 8 },
    src: 'f.png',
  }

  it('floatObjects 承载对象并按锚点定位（含表头/行号列偏移）', () => {
    const { table } = createImageTable()
    table.floatObjects.add(FLOAT)
    expect(table.floatObjects.size).toBe(1)
    // x = 行号列 48 + 列1 偏移 100 + 4；y = 列头 36 + 行2 偏移 64 + 8
    const hit = table.floatObjects.getAt(48 + 100 + 4 + 1, 36 + 64 + 8 + 1)
    expect(hit?.id).toBe('f1')
  })

  it('滚动跟随：syncPositions 帧级重排，命中区域随滚动平移', () => {
    const { table } = createImageTable()
    table.floatObjects.add(FLOAT)
    // 初始 y 区间 [108, 164)：100 在对象上方，未命中
    expect(table.floatObjects.getAt(153, 100)).toBeNull()
    table.scrollTo(0, 32)
    // 滚动 32 后 y 区间 [76, 132)：100 落入命中，原底部 160 移出
    expect(table.floatObjects.getAt(153, 100)?.id).toBe('f1')
    expect(table.floatObjects.getAt(153, 160)).toBeNull()
  })

  it('行高/列宽 resize 后：锚定对象几何随新行列尺寸重算，显式尺寸对象尺寸不受影响', () => {
    const { host, table } = createImageTable()
    table.floatObjects.add(FLOAT)
    table.floatObjects.add({ ...FLOAT, id: 'f2', size: { width: 50, height: 30 } })
    // 浮动容器是 sky root 的末子节点（最后挂载 = 层内最顶）
    const nodeAt = (index: number) => host.layers.get('sky')?.root.children.at(-1)?.children[index]

    // setColWidth：to 列（col2）100→200 → 右缘 48+100+200+100=448，宽 196→296，x 不变
    table.setColWidth(2, 200)
    expect({
      x: nodeAt(0)?.x,
      y: nodeAt(0)?.y,
      width: nodeAt(0)?.width,
      height: nodeAt(0)?.height,
    }).toEqual({
      x: 152,
      y: 108,
      width: 296,
      height: 56,
    })
    // setRowHeight：from 行（row2）32→64 → row3 底 36+32+32+64+32=196，高 56→88，y 不变
    table.setRowHeight(2, 64)
    expect({
      x: nodeAt(0)?.x,
      y: nodeAt(0)?.y,
      width: nodeAt(0)?.width,
      height: nodeAt(0)?.height,
    }).toEqual({
      x: 152,
      y: 108,
      width: 296,
      height: 88,
    })
    // 显式像素尺寸对象：位置随锚点，尺寸不随行列伸缩
    expect({
      x: nodeAt(1)?.x,
      y: nodeAt(1)?.y,
      width: nodeAt(1)?.width,
      height: nodeAt(1)?.height,
    }).toEqual({
      x: 152,
      y: 108,
      width: 50,
      height: 30,
    })
  })

  it('浮动图片经 ImageService 加载；onChange 事件供宿主入库', async () => {
    const { loader, table } = createImageTable()
    const events: string[] = []
    table.floatObjects.onChange((c) => events.push(c.type))
    table.floatObjects.add(FLOAT)
    expect(loader.started).toEqual(['f.png'])
    loader.resolveAll()
    await flush()
    table.floatObjects.update('f1', { alt: 'pic' })
    table.floatObjects.remove('f1')
    expect(events).toEqual(['add', 'update', 'remove'])
    expect(table.floatObjects.size).toBe(0)
  })

  it('destroy 释放浮动层与 ImageService（幂等）', () => {
    const { table } = createImageTable()
    table.floatObjects.add(FLOAT)
    table.destroy()
    expect(table.floatObjects.size).toBe(0)
    table.destroy()
  })
})
