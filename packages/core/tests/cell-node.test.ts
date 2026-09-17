import type { RenderContext } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { CellNode } from '../src/cell-node'
import type { CellRenderTarget } from '../src/cell-renderer'

interface RectCall {
  x: number
  y: number
  width: number
  height: number
  fill: unknown
}

/** 最小记录型 2D 上下文：只关心 fillRect/fillText 调用序列与测量/绘制时刻的生效 font */
class StubContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  /** font 赋值序列（按赋值顺序） */
  readonly fonts: string[] = []
  /** measureText 时刻的生效 font */
  readonly measureFonts: string[] = []
  /** fillText 时刻的生效 font */
  readonly drawFonts: string[] = []
  readonly rects: RectCall[] = []
  readonly texts: string[] = []

  private fontValue = ''
  get font(): string {
    return this.fontValue
  }
  set font(value: string) {
    this.fontValue = value
    this.fonts.push(value)
  }

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
    this.measureFonts.push(this.fontValue)
    return { width: 0 }
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height, fill: this.fillStyle })
  }

  fillText(text: string): void {
    this.texts.push(text)
    this.drawFonts.push(this.fontValue)
  }
}

describe('CellNode 绘制', () => {
  it('text 类型：背景 + 文本', () => {
    const ctx = new StubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: 'hello',
      style: { background: '#fff' },
    })
    node.paint(ctx)
    expect(ctx.rects).toEqual([{ x: 0, y: 0, width: 100, height: 32, fill: '#fff' }])
    expect(ctx.texts).toEqual(['hello'])
  })

  it('逐边边框：四边独立绘制（背景之后、内容之上）', () => {
    const ctx = new StubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      style: {
        border: {
          top: { width: 1, color: '#aaa' },
          bottom: { width: 2, color: '#bbb' },
          left: { width: 3, color: '#ccc' },
          right: { width: 4, color: '#ddd' },
        },
      },
    })
    node.paint(ctx)
    expect(ctx.rects).toEqual([
      { x: 0, y: 0, width: 100, height: 1, fill: '#aaa' },
      { x: 0, y: 30, width: 100, height: 2, fill: '#bbb' },
      { x: 0, y: 0, width: 3, height: 32, fill: '#ccc' },
      { x: 96, y: 0, width: 4, height: 32, fill: '#ddd' },
    ])
  })

  it('只给单边：其余边不绘制', () => {
    const ctx = new StubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      style: { border: { left: { width: 1, color: '#f00' } } },
    })
    node.paint(ctx)
    expect(ctx.rects).toEqual([{ x: 0, y: 0, width: 1, height: 32, fill: '#f00' }])
  })

  it('内置 text 路径：font 串单一推导，测量与绘制共用（结构化字段样式，R3-2）', () => {
    const ctx = new StubContext()
    const node = new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: 'hello',
      style: { fontStyle: 'italic', fontWeight: 600, fontSize: 14, fontFamily: 'Arial' },
    })
    node.paint(ctx)
    // 测量与绘制的生效 font 同源一致，均为 cellStyleFont(style) 的唯一推导结果
    expect(ctx.measureFonts).toEqual(['italic 600 14px Arial'])
    expect(ctx.drawFonts).toEqual(['italic 600 14px Arial'])
    // style/text 未变重绘：测量缓存命中不再重设 font，绘制 font 仍与推导值一致
    ctx.fonts.length = 0
    ctx.measureFonts.length = 0
    ctx.drawFonts.length = 0
    node.paint(ctx)
    expect(ctx.measureFonts).toEqual([])
    expect(ctx.drawFonts).toEqual(['italic 600 14px Arial'])
  })

  it('checkbox 类型：未勾选只画框，勾选加实心块', () => {
    const unchecked = new StubContext()
    new CellNode({ col: 0, row: 0, width: 100, height: 32, cellType: 'checkbox' }).paint(unchecked)
    // 框体四条边
    expect(unchecked.rects).toHaveLength(4)

    const checked = new StubContext()
    new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      cellType: 'checkbox',
      value: true,
    }).paint(checked)
    // 框体四条边 + 勾选块
    expect(checked.rects).toHaveLength(5)
    const mark = checked.rects[4]!
    expect(mark.x).toBe(8 + 3)
    expect(mark.fill).toBe('#3370ff')
  })

  it('checkbox 类型：不绘制取值文本（布尔 records 列经默认管线得到 true/false 文本也不上屏）', () => {
    const ctx = new StubContext()
    new CellNode({
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      cellType: 'checkbox',
      text: 'true',
      value: true,
    }).paint(ctx)
    expect(ctx.texts).toEqual([])
  })

  it('自定义渲染 hook 接管内容：内置文本不再绘制', () => {
    const ctx = new StubContext()
    const seen: CellRenderTarget[] = []
    const node = new CellNode({
      col: 2,
      row: 3,
      width: 100,
      height: 32,
      text: 'ignored',
      renderer: (target) => {
        seen.push(target)
        target.ctx.fillRect(1, 2, 3, 4)
      },
    })
    node.paint(ctx)
    expect(ctx.texts).toEqual([])
    expect(ctx.rects).toEqual([{ x: 1, y: 2, width: 3, height: 4, fill: '#000' }])
    expect(seen[0]).toMatchObject({ col: 2, row: 3, width: 100, height: 32, text: 'ignored' })
  })
})
