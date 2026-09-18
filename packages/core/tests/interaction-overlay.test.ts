import { SceneNode } from '@infinite-table/render'
import type { Region, RenderContext } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { FILL_HANDLE_SIZE } from '../src/fill-handle'
import { InteractionOverlay } from '../src/interaction-overlay'
import type { OverlayContent } from '../src/interaction-overlay'
import { defaultTheme, extendsTheme } from '../src/theme'
import type { InteractionTokens } from '../src/theme'

interface RectCall {
  x: number
  y: number
  width: number
  height: number
  fill: unknown
}

/** 最小记录型 2D 上下文：记录 fillRect 调用序列与当时生效的 fillStyle */
class FillRecordingContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''
  readonly rects: RectCall[] = []

  save(): void {}
  restore(): void {}
  setTransform(): void {}
  translate(): void {}
  beginPath(): void {}
  rect(): void {}
  clip(): void {}
  clearRect(): void {}
  drawImage(): void {}
  measureText(): { width: number } {
    return { width: 0 }
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height, fill: this.fillStyle })
  }

  fillText(): void {}
}

const VIEWPORT: Region = { x: 48, y: 36, width: 752, height: 564 }

function makeGeometry() {
  return {
    cellRect: (col: number, row: number): Region | null =>
      col >= 0 && row >= 0 && col < 100 && row < 100
        ? { x: 48 + col * 100, y: 36 + row * 32, width: 100, height: 32 }
        : null,
    bodyViewport: VIEWPORT,
  }
}

function makeContent(partial: Partial<OverlayContent> = {}): OverlayContent {
  return {
    selection: { ranges: [], focus: null },
    hover: null,
    resizeLine: null,
    fillHandleRange: null,
    window: { rows: { start: 0, end: 100 }, cols: { start: 0, end: 100 } },
    ...partial,
  }
}

function paint(content: OverlayContent, interaction: InteractionTokens): RectCall[] {
  const skyRoot = new SceneNode()
  const overlay = new InteractionOverlay(skyRoot, makeGeometry(), interaction)
  overlay.update(content)
  const ctx = new FillRecordingContext()
  skyRoot.children[0]!.paint(ctx)
  return ctx.rects
}

describe('交互浮层主题 token', () => {
  it('选区段：填充与四边边框用默认 token（与旧硬编码常量一致）', () => {
    const rects = paint(
      makeContent({
        selection: {
          ranges: [{ start: { col: 0, row: 0 }, end: { col: 1, row: 1 } }],
          focus: { col: 1, row: 1 },
        },
      }),
      defaultTheme.interaction,
    )
    expect(rects[0]).toEqual({
      x: 48,
      y: 36,
      width: 200,
      height: 64,
      fill: 'rgba(46, 106, 219, 0.08)',
    })
    expect(rects).toContainEqual({ x: 48, y: 36, width: 200, height: 2, fill: '#2e6adb' })
    expect(rects).toContainEqual({ x: 48, y: 98, width: 200, height: 2, fill: '#2e6adb' })
    expect(rects).toContainEqual({ x: 48, y: 36, width: 2, height: 64, fill: '#2e6adb' })
    expect(rects).toContainEqual({ x: 246, y: 36, width: 2, height: 64, fill: '#2e6adb' })
  })

  it('hover：行/列带与格填充用默认 token', () => {
    const rects = paint(makeContent({ hover: { col: 2, row: 3 } }), defaultTheme.interaction)
    expect(rects).toContainEqual({
      x: 48,
      y: 132,
      width: 752,
      height: 32,
      fill: 'rgba(31, 35, 41, 0.04)',
    })
    expect(rects).toContainEqual({
      x: 248,
      y: 36,
      width: 100,
      height: 564,
      fill: 'rgba(31, 35, 41, 0.04)',
    })
    expect(rects).toContainEqual({
      x: 248,
      y: 132,
      width: 100,
      height: 32,
      fill: 'rgba(31, 35, 41, 0.08)',
    })
  })

  it('resize 拖拽线：颜色与宽度用默认 token', () => {
    const rects = paint(
      makeContent({ resizeLine: { orientation: 'vertical', position: 200 } }),
      defaultTheme.interaction,
    )
    expect(rects).toEqual([{ x: 199, y: 36, width: 2, height: 564, fill: '#2e6adb' }])
  })

  it('填充柄方点：颜色用默认 token', () => {
    const rects = paint(
      makeContent({
        selection: {
          ranges: [{ start: { col: 0, row: 0 }, end: { col: 1, row: 1 } }],
          focus: { col: 1, row: 1 },
        },
        fillHandleRange: { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      }),
      defaultTheme.interaction,
    )
    const handle = rects.find((rect) => rect.width === FILL_HANDLE_SIZE)
    expect(handle?.fill).toBe('#2e6adb')
  })

  it('覆盖 interaction token：绘制全部改用新值', () => {
    const interaction = extendsTheme({
      interaction: {
        selectionFill: 'rgba(255, 0, 0, 0.1)',
        selectionBorder: '#ff0000',
        selectionBorderWidth: 4,
        resizeLine: '#00ff00',
        resizeLineWidth: 5,
        fillHandle: '#0000ff',
      },
    }).interaction
    const rects = paint(
      makeContent({
        selection: {
          ranges: [{ start: { col: 0, row: 0 }, end: { col: 1, row: 1 } }],
          focus: { col: 1, row: 1 },
        },
        resizeLine: { orientation: 'horizontal', position: 100 },
        fillHandleRange: { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      }),
      interaction,
    )
    expect(rects[0]?.fill).toBe('rgba(255, 0, 0, 0.1)')
    expect(rects).toContainEqual({ x: 48, y: 36, width: 200, height: 4, fill: '#ff0000' })
    expect(rects).toContainEqual({ x: 48, y: 97.5, width: 752, height: 5, fill: '#00ff00' })
    const handle = rects.find((rect) => rect.width === FILL_HANDLE_SIZE)
    expect(handle?.fill).toBe('#0000ff')
  })
})
