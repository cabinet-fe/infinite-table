// ImageCellNode 单测：无闪协议占位延迟 + body 视口裁剪（边缘半格不画进表头/行号列）
// + 边框内缩绘制（media 层在 body 之上，内缩保持画在本格矩形内的边框可见）

import type { RenderImageSource } from '@infinitable/render'
import { describe, expect, it } from 'vitest'

import { ImageCellNode } from '../../src/media/image-cell-node'
import type { ImageCellNodeInit } from '../../src/media/image-cell-node'
import type { LoadedImage } from '../../src/media/image-service'
import { RecordingContext } from '../testing/recording-context'

function fakeImage(width = 10, height = 10): LoadedImage {
  return { source: { width, height } as unknown as RenderImageSource, width, height }
}

/** 默认几何对齐 ListTable 基准：行号列 48、列头 36，格 100×32 是静止位的格 (0,0) */
function readyNode(extra: Partial<ImageCellNodeInit> = {}): ImageCellNode {
  const node = new ImageCellNode({
    col: 0,
    row: 0,
    x: 48,
    y: 36,
    width: 100,
    height: 32,
    url: 'a.png',
    placeholderAfter: 0,
    ...extra,
  })
  node.setBitmap(fakeImage())
  return node
}

describe('ImageCellNode 绘制', () => {
  it('位图就绪即画位图；白底只垫位图实际区域（contain 留白不画，不盖网格线）', () => {
    const ctx = new RecordingContext()
    readyNode().paint(ctx)
    expect(ctx.callsOf('fillRect')).toHaveLength(1)
    expect(ctx.callsOf('drawImage')).toHaveLength(1)
    // 10×10 位图 contain 进 100×32：等比 32×32 居中，白底与位图同矩形（留白透出网格线）
    expect(ctx.callsOf('fillRect')[0]?.args).toEqual([34, 0, 32, 32])
    expect(ctx.callsOf('drawImage')[0]?.args).toEqual([expect.anything(), 34, 0, 32, 32])

    const pending = new ImageCellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      url: 'b.png',
      placeholderAfter: 10,
      now: () => 5,
    })
    pending.paint(ctx)
    expect(ctx.callsOf('fillRect')).toHaveLength(1)
  })

  it('fill 缩放：未提供内缩时白底铺满整格（直接构造缺省口径）', () => {
    const ctx = new RecordingContext()
    const node = readyNode()
    node.fit = 'fill'
    node.paint(ctx)
    expect(ctx.callsOf('fillRect')[0]?.args).toEqual([0, 0, 100, 32])
    expect(ctx.callsOf('drawImage')[0]?.args).toEqual([expect.anything(), 0, 0, 100, 32])
  })

  it('默认网格线内缩（右/下 1px）：绘制区缩到 99×31，不盖本格下/右边框', () => {
    const ctx = new RecordingContext()
    const node = readyNode({ borderInset: { top: 0, right: 1, bottom: 1, left: 0 } })
    node.fit = 'fill'
    node.paint(ctx)
    expect(ctx.callsOf('fillRect')[0]?.args).toEqual([0, 0, 99, 31])
    expect(ctx.callsOf('drawImage')[0]?.args).toEqual([expect.anything(), 0, 0, 99, 31])
    // 左/上内缩为 0：不引入 translate/save（默认网格线内缩零额外状态开销）
    expect(ctx.callsOf('translate')).toHaveLength(0)
    expect(ctx.callsOf('save')).toHaveLength(0)
  })

  it('contain 内缩：位图等比居中在内缩盒内（白底只垫位图区域，留白透出网格线）', () => {
    const ctx = new RecordingContext()
    readyNode({ borderInset: { top: 0, right: 1, bottom: 1, left: 0 } }).paint(ctx)
    // 10×10 位图 contain 进 99×31：等比 31×31 居中（x=34），白底与位图同矩形
    expect(ctx.callsOf('fillRect')[0]?.args).toEqual([34, 0, 31, 31])
    expect(ctx.callsOf('drawImage')[0]?.args).toEqual([expect.anything(), 34, 0, 31, 31])
  })

  it('四边内缩（含左/上）：经 translate 偏移绘制区，contain 位图在内缩盒内居中', () => {
    const ctx = new RecordingContext()
    // 首列/首行格的显式左/上边框：盒 96×29，translate(3,2)；10×10 位图 → 29×29 居中 x=33.5
    readyNode({ borderInset: { top: 2, right: 1, bottom: 1, left: 3 } }).paint(ctx)
    expect(ctx.callsOf('translate')[0]?.args).toEqual([3, 2])
    expect(ctx.callsOf('fillRect')[0]?.args).toEqual([33.5, 0, 29, 29])
    expect(ctx.callsOf('drawImage')[0]?.args).toEqual([expect.anything(), 33.5, 0, 29, 29])
    expect(ctx.calls.filter((call) => call.name === 'save').length).toBe(1)
    expect(ctx.calls.filter((call) => call.name === 'restore').length).toBe(1)
  })

  it('占位绘制同样内缩（占位不盖本格边框）', () => {
    const ctx = new RecordingContext()
    const node = new ImageCellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      url: 'b.png',
      placeholderAfter: 0,
      borderInset: { top: 0, right: 1, bottom: 1, left: 0 },
    })
    node.paint(ctx)
    expect(ctx.callsOf('fillRect')[0]?.args).toEqual([0, 0, 99, 31])
  })

  it('内缩超过格尺寸：绘制区夹到零，不绘制', () => {
    const ctx = new RecordingContext()
    readyNode({ borderInset: { top: 20, right: 60, bottom: 20, left: 60 } }).paint(ctx)
    expect(ctx.callsOf('fillRect')).toHaveLength(0)
    expect(ctx.callsOf('drawImage')).toHaveLength(0)
    expect(ctx.callsOf('translate')).toHaveLength(0)
  })

  it('未提供 bodyViewport：绘制不裁剪（行为不变）', () => {
    const ctx = new RecordingContext()
    readyNode().paint(ctx)
    expect(ctx.callsOf('save')).toHaveLength(0)
    expect(ctx.callsOf('rect')).toHaveLength(0)
    expect(ctx.callsOf('clip')).toHaveLength(0)
    expect(ctx.callsOf('restore')).toHaveLength(0)
  })

  it('完全在 body 视口内：不裁剪', () => {
    const ctx = new RecordingContext()
    readyNode({ bodyViewport: { x: 48, y: 36, width: 752, height: 564 } }).paint(ctx)
    expect(ctx.callsOf('clip')).toHaveLength(0)
  })

  it('顶部半格滚出视口：裁到视口内部分（格滚动至半格位置不画进列头）', () => {
    const ctx = new RecordingContext()
    // 滚动 16px 后格顶在 y=20，高于视口顶 36：视口外 16px 不得绘制
    readyNode({
      y: 20,
      bodyViewport: { x: 48, y: 36, width: 752, height: 564 },
    }).paint(ctx)
    expect(ctx.calls.map((call) => call.name)).toEqual([
      'save',
      'rect',
      'clip',
      'fillRect',
      'drawImage',
      'restore',
    ])
    expect(ctx.callsOf('rect')[0]?.args).toEqual([0, 16, 100, 16])
  })

  it('左侧半格滚出行号列：裁剪起点为视口左界', () => {
    const ctx = new RecordingContext()
    readyNode({
      x: 20,
      bodyViewport: { x: 48, y: 36, width: 752, height: 564 },
    }).paint(ctx)
    expect(ctx.callsOf('rect')[0]?.args).toEqual([28, 0, 72, 32])
  })

  it('占位绘制同样经视口裁剪', () => {
    const ctx = new RecordingContext()
    const node = new ImageCellNode({
      col: 0,
      row: 0,
      x: 48,
      y: 20,
      width: 100,
      height: 32,
      url: 'b.png',
      placeholderAfter: 0,
      bodyViewport: { x: 48, y: 36, width: 752, height: 564 },
    })
    node.paint(ctx)
    expect(ctx.callsOf('clip')).toHaveLength(1)
    expect(ctx.callsOf('rect')[0]?.args).toEqual([0, 16, 100, 16])
  })
})
