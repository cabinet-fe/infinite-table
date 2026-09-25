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
    bodyViewport: () => VIEWPORT,
  }
}

function makeContent(partial: Partial<OverlayContent> = {}): OverlayContent {
  return {
    selection: { ranges: [], focus: null },
    hover: null,
    resizeLine: null,
    fillHandleRange: null,
    fillPreview: null,
    selectionAnchor: null,
    highlightRanges: [],
    freezeDividers: { x: null, y: null },
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

  it('填充拖拽预览：扩展区画虚线边框（fillPreview 非空即有内容）', () => {
    const skyRoot = new SceneNode()
    const overlay = new InteractionOverlay(skyRoot, makeGeometry(), defaultTheme.interaction)
    const node = skyRoot.children[0]!
    // 预览区 (0,2)~(1,3)：视口矩形 (48,100) 200×64；虚线段 5px 交替
    expect(
      overlay.update(
        makeContent({
          fillPreview: { minCol: 0, minRow: 2, maxCol: 1, maxRow: 3 },
        }),
      ),
    ).toBe(true)
    const ctx = new FillRecordingContext()
    node.paint(ctx)
    const borders = ctx.rects.filter((rect) => rect.fill === '#2e6adb')
    // 上下边各 24/3 段、左右边各 8 段虚线（5px 段 + 4px 间隙，步进 9px）
    expect(borders).toContainEqual({ x: 48, y: 100, width: 5, height: 2, fill: '#2e6adb' })
    expect(borders).toContainEqual({ x: 237, y: 162, width: 5, height: 2, fill: '#2e6adb' })
    expect(borders).toContainEqual({ x: 246, y: 100, width: 2, height: 5, fill: '#2e6adb' })
    expect(borders).toContainEqual({ x: 48, y: 136, width: 2, height: 5, fill: '#2e6adb' })
    // 无选区但预览在：浮层仍有内容
    expect(overlay.update(makeContent())).toBe(false)
  })

  it('冻结分隔线：冻结边界画线（线体贴边界落冻结带内侧），无冻结为无内容', () => {
    const skyRoot = new SceneNode()
    const overlay = new InteractionOverlay(skyRoot, makeGeometry(), defaultTheme.interaction)
    const node = skyRoot.children[0]!
    // 仅冻结分隔线也算有内容（sky 需要重绘）
    expect(overlay.update(makeContent({ freezeDividers: { x: 148, y: 68 } }))).toBe(true)
    const ctx = new FillRecordingContext()
    node.paint(ctx)
    // 竖线 x=148 宽 1 → [147,148)；横线 y=68 → [67,68)，裁剪到 body 视口
    expect(ctx.rects).toEqual([
      { x: 147, y: 36, width: 1, height: 564, fill: '#c9cdd4' },
      { x: 48, y: 67, width: 752, height: 1, fill: '#c9cdd4' },
    ])
    // 冻结数 0：两轴皆 null → 不画且无内容
    expect(overlay.update(makeContent())).toBe(false)
  })

  it('宿主高亮区域：四边细条边框取逐条颜色，无选区时也撑起浮层', () => {
    const skyRoot = new SceneNode()
    const overlay = new InteractionOverlay(skyRoot, makeGeometry(), defaultTheme.interaction)
    const node = skyRoot.children[0]!
    // 高亮 (1,1)~(2,2)：视口矩形 (148,68) 200×64；边框宽随 selectionBorderWidth
    expect(
      overlay.update(
        makeContent({
          highlightRanges: [
            { bounds: { minCol: 1, minRow: 1, maxCol: 2, maxRow: 2 }, color: '#ff0000' },
          ],
        }),
      ),
    ).toBe(true)
    const ctx = new FillRecordingContext()
    node.paint(ctx)
    expect(ctx.rects).toEqual([
      { x: 148, y: 68, width: 200, height: 2, fill: '#ff0000' },
      { x: 148, y: 130, width: 200, height: 2, fill: '#ff0000' },
      { x: 148, y: 68, width: 2, height: 64, fill: '#ff0000' },
      { x: 346, y: 68, width: 2, height: 64, fill: '#ff0000' },
    ])
    // 清空后即无内容
    expect(overlay.update(makeContent())).toBe(false)
  })

  it('选区锚点：选区样式绘制且先于高亮区域（引用染色框保持在上），非空即有内容', () => {
    const skyRoot = new SceneNode()
    const overlay = new InteractionOverlay(skyRoot, makeGeometry(), defaultTheme.interaction)
    const node = skyRoot.children[0]!
    // 锚点 (2,1) 单格：视口矩形 (248,68) 100×32
    expect(
      overlay.update(
        makeContent({
          selectionAnchor: { minCol: 2, minRow: 1, maxCol: 2, maxRow: 1 },
          highlightRanges: [
            { bounds: { minCol: 2, minRow: 1, maxCol: 2, maxRow: 1 }, color: '#ff0000' },
          ],
        }),
      ),
    ).toBe(true)
    const ctx = new FillRecordingContext()
    node.paint(ctx)
    // 填充 + 四边边框用选区 token，且整体画在高亮区域边框之前（引用染色框不被盖住）
    const anchorFillIndex = ctx.rects.findIndex(
      (rect) => rect.fill === 'rgba(46, 106, 219, 0.08)' && rect.x === 248,
    )
    const anchorBorderIndex = ctx.rects.findIndex(
      (rect) => rect.fill === '#2e6adb' && rect.x === 248 && rect.width === 100 && rect.height === 2,
    )
    const highlightIndex = ctx.rects.findIndex((rect) => rect.fill === '#ff0000')
    expect(anchorFillIndex).toBeGreaterThanOrEqual(0)
    expect(anchorBorderIndex).toBeGreaterThan(anchorFillIndex)
    expect(highlightIndex).toBeGreaterThan(anchorBorderIndex)
    // 清除锚点后无内容
    expect(overlay.update(makeContent())).toBe(false)
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
