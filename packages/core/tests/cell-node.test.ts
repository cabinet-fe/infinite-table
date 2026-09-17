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

/** 最小记录型 2D 上下文：只关心 fillRect/fillText 调用序列 */
class StubContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''
  readonly rects: RectCall[] = []
  readonly texts: string[] = []

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

  fillText(text: string): void {
    this.texts.push(text)
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
