import type { RenderContext } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { projectCellStyle, type CellStyle } from '../src/cell-style'
import { renderCheckboxCell, renderTextCell, type CellRenderTarget } from '../src/cell-renderer'

const BASE: CellStyle = {
  background: '#ffffff',
  color: '#1f2329',
  font: '12px sans-serif',
}

describe('projectCellStyle 样式投影', () => {
  it('hook 返回 null：沿用基础样式', () => {
    expect(projectCellStyle(BASE, null)).toEqual(BASE)
  })

  it('逐字段覆盖：未覆盖字段继承基础样式', () => {
    const result = projectCellStyle(BASE, { background: '#fafafa' })
    expect(result).toEqual({ ...BASE, background: '#fafafa' })
  })

  it('逐边边框：override 只给一边时基础样式其余边保留', () => {
    const base: CellStyle = {
      border: {
        top: { width: 1, color: '#ddd' },
        bottom: { width: 1, color: '#ddd' },
      },
    }
    const result = projectCellStyle(base, {
      border: { left: { width: 2, color: '#f00' } },
    })
    expect(result.border).toEqual({
      top: { width: 1, color: '#ddd' },
      bottom: { width: 1, color: '#ddd' },
      left: { width: 2, color: '#f00' },
    })
  })

  it('同边覆盖以 override 为准', () => {
    const base: CellStyle = { border: { top: { width: 1, color: '#ddd' } } }
    const result = projectCellStyle(base, { border: { top: { width: 3, color: '#000' } } })
    expect(result.border?.top).toEqual({ width: 3, color: '#000' })
  })

  it('不改入参（投影产出新对象）', () => {
    const base: CellStyle = { border: { top: { width: 1, color: '#ddd' } } }
    projectCellStyle(base, { border: { left: { width: 2, color: '#f00' } } })
    expect(base.border).toEqual({ top: { width: 1, color: '#ddd' } })
  })

  it('override 给空 border 对象：保留基础边框', () => {
    const base: CellStyle = { border: { right: { width: 1, color: '#ddd' } } }
    const result = projectCellStyle(base, { border: {} })
    expect(result.border).toEqual({ right: { width: 1, color: '#ddd' } })
  })
})

describe('projectCellStyle 文本样式字段逐字段覆盖', () => {
  const TEXT_BASE: CellStyle = {
    textAlign: 'left',
    verticalAlign: 'middle',
    fontWeight: 'bold',
    fontStyle: 'italic',
    fontSize: 12,
    fontFamily: 'Arial',
    underline: true,
    lineThrough: false,
  }

  it('override 未给的新字段沿用 base', () => {
    expect(projectCellStyle(TEXT_BASE, { background: '#fafafa' })).toEqual({
      ...TEXT_BASE,
      background: '#fafafa',
    })
  })

  it('override 给了的字段覆盖 base，其余字段保持 base', () => {
    const result = projectCellStyle(TEXT_BASE, {
      textAlign: 'center',
      verticalAlign: 'bottom',
      fontWeight: 400,
      fontSize: 16,
      lineThrough: true,
    })
    expect(result.textAlign).toBe('center')
    expect(result.verticalAlign).toBe('bottom')
    expect(result.fontWeight).toBe(400)
    expect(result.fontSize).toBe(16)
    expect(result.lineThrough).toBe(true)
    expect(result.fontStyle).toBe('italic')
    expect(result.fontFamily).toBe('Arial')
    expect(result.underline).toBe(true)
  })

  it('border 逐边合并在新字段存在时不回归', () => {
    const base: CellStyle = { ...TEXT_BASE, border: { top: { width: 1, color: '#ddd' } } }
    const result = projectCellStyle(base, {
      textAlign: 'right',
      border: { left: { width: 2, color: '#f00' } },
    })
    expect(result.border).toEqual({
      top: { width: 1, color: '#ddd' },
      left: { width: 2, color: '#f00' },
    })
    expect(result.textAlign).toBe('right')
  })
})

interface TextCall {
  text: string
  x: number
  y: number
}

interface RectCall {
  x: number
  y: number
  width: number
  height: number
}

/** 记录型假 ctx：记录 font 赋值序列与 fillText/fillRect 调用 */
class RecordingContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  readonly fonts: string[] = []
  readonly texts: TextCall[] = []
  readonly rects: RectCall[] = []

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
    return { width: 0 }
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height })
  }
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y })
  }
}

const TEXT_RENDER_BASE: CellRenderTarget = {
  ctx: new RecordingContext(),
  col: 0,
  row: 0,
  width: 100,
  height: 32,
  text: 'hello',
  value: undefined,
  style: {},
  textWidth: 40,
}

function paintText(style: CellStyle): RecordingContext {
  const ctx = new RecordingContext()
  renderTextCell({ ...TEXT_RENDER_BASE, ctx, style })
  return ctx
}

describe('renderTextCell 字体与对齐', () => {
  it('font 串按结构化字段组装：font-style font-weight font-size font-family', () => {
    const ctx = paintText({
      fontStyle: 'italic',
      fontWeight: 'bold',
      fontSize: 14,
      fontFamily: 'Arial',
    })
    expect(ctx.fonts).toEqual(['italic bold 14px Arial'])
  })

  it('部分分量：缺省分量补 12px/sans-serif', () => {
    expect(paintText({ fontWeight: 600 }).fonts).toEqual(['600 12px sans-serif'])
    expect(paintText({ fontSize: 16 }).fonts).toEqual(['16px sans-serif'])
  })

  it('未给结构化分量：回退 font 简写，再回退默认字体', () => {
    expect(paintText({ font: '10px serif' }).fonts).toEqual(['10px serif'])
    expect(paintText({}).fonts).toEqual(['12px sans-serif'])
  })

  it('缺省锚点：左对齐 + 垂直居中（既有语义不回归）', () => {
    expect(paintText({}).texts).toEqual([{ text: 'hello', x: 8, y: 20 }])
  })

  it('textAlign：center/right 锚点随测量宽变化', () => {
    expect(paintText({ textAlign: 'center' }).texts).toEqual([{ text: 'hello', x: 30, y: 20 }])
    expect(paintText({ textAlign: 'right' }).texts).toEqual([{ text: 'hello', x: 52, y: 20 }])
  })

  it('verticalAlign：top/bottom 基线分别贴行盒顶/底', () => {
    expect(paintText({ verticalAlign: 'top' }).texts).toEqual([{ text: 'hello', x: 8, y: 12 }])
    expect(paintText({ verticalAlign: 'bottom' }).texts).toEqual([{ text: 'hello', x: 8, y: 28 }])
  })

  it('对齐组合：center + bottom 叠加生效', () => {
    expect(paintText({ textAlign: 'center', verticalAlign: 'bottom' }).texts).toEqual([
      { text: 'hello', x: 30, y: 28 },
    ])
  })

  it('underline/lineThrough 有绘制痕迹：基线下 2px 与文本中部，宽随测量文本', () => {
    const ctx = paintText({ underline: true, lineThrough: true })
    expect(ctx.texts).toEqual([{ text: 'hello', x: 8, y: 20 }])
    expect(ctx.rects).toEqual([
      { x: 8, y: 22, width: 40, height: 1 },
      { x: 8, y: 16, width: 40, height: 1 },
    ])
  })

  it('checkbox 跟随水平对齐：center 居中绘制，缺省保持左对齐', () => {
    const centered = new RecordingContext()
    renderCheckboxCell({
      ctx: centered,
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: '',
      value: false,
      style: { textAlign: 'center' },
    })
    // 首条 fillRect 为框体顶边（size 14，y 垂直居中 9）
    expect(centered.rects[0]).toEqual({ x: 43, y: 9, width: 14, height: 1 })

    const left = new RecordingContext()
    renderCheckboxCell({
      ctx: left,
      col: 0,
      row: 0,
      width: 100,
      height: 32,
      text: '',
      value: false,
      style: {},
    })
    expect(left.rects[0]).toEqual({ x: 8, y: 9, width: 14, height: 1 })
  })
})
