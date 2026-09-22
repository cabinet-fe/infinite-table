import {
  SceneNode,
  type Invalidation,
  type LayerHandle,
  type RenderImageSource,
} from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { ImageService, type LoadedImage } from '../../src/media/image-service'
import type { FloatGeometry, FloatObject } from '../../src/float/float-object-layer'
import { FloatObjectLayer } from '../../src/float/float-object-layer'

/** 记录失效的假层 */
function stubLayer() {
  const invalidated: Invalidation[] = []
  const root = new SceneNode({ pickable: false })
  const layer: LayerHandle = {
    kind: 'sky',
    root,
    canvasElement: { width: 0, height: 0, getContext: () => null },
    setSize: () => {},
    invalidate: (inv) => invalidated.push(inv),
    translateBy: () => {},
  }
  return { layer, root, invalidated }
}

/** 等行高列宽的假几何：scroll/cell 由闭包变量驱动（模拟滚动跟随与行列 resize 后尺寸变更） */
function stubGeometry(
  scroll: { left: number; top: number },
  cell: { width: number; height: number } = { width: 100, height: 32 },
): FloatGeometry {
  return {
    cellOrigin: (col, row) => ({
      x: col * cell.width - scroll.left,
      y: row * cell.height - scroll.top,
    }),
    cellSize: () => ({ width: cell.width, height: cell.height }),
  }
}

function imageObject(id: string, from: { col: number; row: number }): FloatObject {
  return {
    id,
    kind: 'image',
    anchor: { from, to: { col: from.col + 1, row: from.row + 1 }, offsetX: 4, offsetY: 8 },
    src: `${id}.png`,
  }
}

describe('FloatObjectLayer 承载与定位', () => {
  it('add：按锚点 from+偏移定位，尺寸由 from→to 格范围决定；size 优先', () => {
    const { layer } = stubLayer()
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) })
    floats.add(imageObject('a', { col: 1, row: 2 }))
    // x = 100+4, y = 64+8；宽到 col2 右缘 300-104=196，高到 row3 底 128-72=56
    const node = layer.root.children[0]?.children[0]
    expect({ x: node?.x, y: node?.y, width: node?.width, height: node?.height }).toEqual({
      x: 104,
      y: 72,
      width: 196,
      height: 56,
    })

    floats.add({ ...imageObject('b', { col: 0, row: 0 }), size: { width: 40, height: 24 } })
    const b = layer.root.children[0]?.children[1]
    expect({ width: b?.width, height: b?.height }).toEqual({ width: 40, height: 24 })
  })

  it('syncPositions：滚动后锚点重算，位置帧级跟随', () => {
    const { layer, invalidated } = stubLayer()
    const scroll = { left: 0, top: 0 }
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry(scroll) })
    floats.add(imageObject('a', { col: 1, row: 2 }))
    scroll.left = 50
    scroll.top = 32
    floats.syncPositions()
    const node = layer.root.children[0]?.children[0]
    expect({ x: node?.x, y: node?.y }).toEqual({ x: 54, y: 40 })
    expect(invalidated.at(-1)).toEqual({ type: 'full' })
  })

  it('recalcGeometry：行高/列宽 resize 后 from→to 锚定对象随新行列尺寸伸缩；显式尺寸对象不受影响', () => {
    const { layer, invalidated } = stubLayer()
    const cell = { width: 100, height: 32 }
    const floats = new FloatObjectLayer({
      layer,
      geometry: stubGeometry({ left: 0, top: 0 }, cell),
    })
    // 跨 2 列 × 2 行：from (1,2)+offset(4,8) → to (3,4) 右下缘
    const anchor = { from: { col: 1, row: 2 }, to: { col: 3, row: 4 }, offsetX: 4, offsetY: 8 }
    floats.add({ id: 'anchored', kind: 'image', anchor })
    floats.add({ id: 'explicit', kind: 'image', anchor, size: { width: 120, height: 60 } })
    invalidated.length = 0

    // 列宽 100→160：x 随 from 格原点右移，宽伸到 col3 新右缘 4*160=640；高不变
    cell.width = 160
    floats.recalcGeometry()
    let anchored = layer.root.children[0]?.children[0]
    expect({
      x: anchored?.x,
      y: anchored?.y,
      width: anchored?.width,
      height: anchored?.height,
    }).toEqual({
      x: 164,
      y: 72,
      width: 476,
      height: 88,
    })

    // 行高 32→48：y 随 from 格原点下移，高伸到 row4 新底 5*48=240；宽不变
    cell.height = 48
    floats.recalcGeometry()
    anchored = layer.root.children[0]?.children[0]
    expect({
      x: anchored?.x,
      y: anchored?.y,
      width: anchored?.width,
      height: anchored?.height,
    }).toEqual({
      x: 164,
      y: 104,
      width: 476,
      height: 136,
    })

    // 显式像素尺寸对象：位置随锚点跟随，尺寸不随行列伸缩
    const explicit = layer.root.children[0]?.children[1]
    expect({
      x: explicit?.x,
      y: explicit?.y,
      width: explicit?.width,
      height: explicit?.height,
    }).toEqual({
      x: 164,
      y: 104,
      width: 120,
      height: 60,
    })
    // 每次重算整层失效一次
    expect(invalidated).toEqual([{ type: 'full' }, { type: 'full' }])
  })

  it('update 合并 patch 并重排（双包围盒失效）；remove 移除节点', () => {
    const { layer, invalidated } = stubLayer()
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) })
    floats.add(imageObject('a', { col: 0, row: 0 }))
    invalidated.length = 0
    floats.update('a', {
      anchor: { from: { col: 2, row: 1 }, to: { col: 3, row: 2 }, offsetX: 0, offsetY: 0 },
    })
    const node = layer.root.children[0]?.children[0]
    expect({ x: node?.x, y: node?.y }).toEqual({ x: 200, y: 32 })
    expect(invalidated[0]?.type).toBe('cell')
    expect(invalidated[0]).toMatchObject({ prevRegion: { x: 4, y: 8 } })

    floats.remove('a')
    expect(layer.root.children[0]?.children).toHaveLength(0)
    expect(floats.get('a')).toBeUndefined()
  })

  it('getAt：后加的对象在上，倒序命中', () => {
    const { layer } = stubLayer()
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) })
    floats.add(imageObject('under', { col: 0, row: 0 }))
    floats.add(imageObject('over', { col: 0, row: 0 }))
    expect(floats.getAt(10, 10)?.id).toBe('over')
    expect(floats.getAt(10_000, 10_000)).toBeNull()
  })

  it('onChange：增删改事件按序抛出（供宿主 undo 入库）', () => {
    const { layer } = stubLayer()
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) })
    const events: string[] = []
    floats.onChange((change) => events.push(change.type))
    floats.add(imageObject('a', { col: 0, row: 0 }))
    floats.update('a', { alt: 'x' })
    floats.remove('a')
    expect(events).toEqual(['add', 'update', 'remove'])
  })

  it('图片对象经 ImageService 加载：未就绪画占位，加载完成定向失效并持有位图', async () => {
    const { layer, invalidated } = stubLayer()
    const image = (url: string): LoadedImage => ({
      source: { url } as unknown as RenderImageSource,
      width: 10,
      height: 10,
    })
    const service = new ImageService({ loadImage: (url) => Promise.resolve(image(url)) })
    const floats = new FloatObjectLayer({
      layer,
      geometry: stubGeometry({ left: 0, top: 0 }),
      imageService: service,
    })
    floats.add(imageObject('a', { col: 0, row: 0 }))
    expect(service.hasResource('a.png')).toBe(false)
    invalidated.length = 0
    await Promise.resolve()
    await Promise.resolve()
    expect(service.hasResource('a.png')).toBe(true)
    // 加载完成 → cell 定向失效（非整层）
    expect(invalidated).toEqual([{ type: 'cell', region: { x: 4, y: 8, width: 196, height: 56 } }])
  })

  it('dispose：容器脱离场景树，幂等', () => {
    const { layer, root } = stubLayer()
    const floats = new FloatObjectLayer({ layer, geometry: stubGeometry({ left: 0, top: 0 }) })
    floats.add(imageObject('a', { col: 0, row: 0 }))
    floats.dispose()
    expect(root.children).toHaveLength(0)
    floats.dispose()
  })
})
