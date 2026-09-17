// ImageCellNode 单测：无闪协议占位延迟 + body 视口裁剪（边缘半格不画进表头/行号列）

import type { RenderImageSource } from '@infinite-table/render'
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
  it('位图就绪即画位图；占位未到期本帧不画', () => {
    const ctx = new RecordingContext()
    readyNode().paint(ctx)
    expect(ctx.callsOf('fillRect')).toHaveLength(1)
    expect(ctx.callsOf('drawImage')).toHaveLength(1)

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
