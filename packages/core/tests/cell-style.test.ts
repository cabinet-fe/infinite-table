import type { RenderContext } from '@infinite-table/render'
import { describe, expect, it } from 'vitest'

import { projectCellStyle, type CellStyle } from '../src/cell-style'
import { renderCheckboxCell, renderTextCell, type CellRenderTarget } from '../src/cell-renderer'
import { CellNode } from '../src/cell-node'

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

  it('边框线型逐边独立合并：线型随边框整体覆盖与保留', () => {
    const base: CellStyle = {
      border: {
        top: { width: 1, color: '#ddd', style: 'dashed' },
        bottom: { width: 1, color: '#ddd' },
      },
    }
    const result = projectCellStyle(base, {
      border: { left: { width: 2, color: '#f00', style: 'double' } },
    })
    expect(result.border).toEqual({
      top: { width: 1, color: '#ddd', style: 'dashed' },
      bottom: { width: 1, color: '#ddd' },
      left: { width: 2, color: '#f00', style: 'double' },
    })
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

describe('三层覆盖链：主题分区 token → 列级 → 按格 hook', () => {
  // 链路经两次 projectCellStyle 组合：projectCellStyle(projectCellStyle(主题分区, 列级), hook)
  const THEME_BODY: CellStyle = {
    color: '#1f2329',
    textAlign: 'right',
    verticalAlign: 'bottom',
    padding: [1, 2, 3, 4],
    border: {
      top: { width: 1, color: '#ddd', style: 'dashed' },
      left: { width: 1, color: '#ddd' },
    },
  }
  const COLUMN: CellStyle = {
    textAlign: 'center',
    fontSize: 14,
    underline: true,
    border: { left: { width: 2, color: '#f00', style: 'double' } },
  }
  const HOOK: CellStyle = {
    fontSize: 16,
    border: { top: { width: 3, color: '#00c' } },
  }

  const merged = projectCellStyle(projectCellStyle(THEME_BODY, COLUMN), HOOK)

  it('列级压主题分区', () => {
    expect(merged.textAlign).toBe('center')
    expect(merged.border?.left).toEqual({ width: 2, color: '#f00', style: 'double' })
  })

  it('按格 hook 压列级', () => {
    expect(merged.fontSize).toBe(16)
    expect(merged.border?.top).toEqual({ width: 3, color: '#00c' })
  })

  it('未给的沿用上层', () => {
    expect(merged.color).toBe('#1f2329')
    expect(merged.verticalAlign).toBe('bottom')
    expect(merged.padding).toEqual([1, 2, 3, 4])
    expect(merged.underline).toBe(true)
  })

  it('边框逐边跨层合并：线型随所在边整体覆盖或保留', () => {
    // top：hook 给了 → 整边覆盖主题的 dashed（线型回落 solid）；left：hook 未给 → 保留列级的 double
    expect(merged.border).toEqual({
      top: { width: 3, color: '#00c' },
      left: { width: 2, color: '#f00', style: 'double' },
    })
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
  fill: unknown
}

/** 记录型假 ctx：记录 font 赋值序列与 fillText/fillRect 调用（fillRect 附带 fillStyle） */
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
  measureText(text: string): { width: number } {
    return { width: text.length * 10 }
  }
  fillRect(x: number, y: number, width: number, height: number): void {
    this.rects.push({ x, y, width, height, fill: this.fillStyle })
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

  it('入参 font 优先：直接生效、不按 style 重组装（缺省回退 cellStyleFont，R3-2）', () => {
    const ctx = new RecordingContext()
    renderTextCell({ ...TEXT_RENDER_BASE, ctx, style: { fontWeight: 700 }, font: '9px custom' })
    expect(ctx.fonts).toEqual(['9px custom'])
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
      { x: 8, y: 22, width: 40, height: 1, fill: '#1f2329' },
      { x: 8, y: 16, width: 40, height: 1, fill: '#1f2329' },
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
    expect(centered.rects[0]).toEqual({ x: 43, y: 9, width: 14, height: 1, fill: '#8f959e' })

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
    expect(left.rects[0]).toEqual({ x: 8, y: 9, width: 14, height: 1, fill: '#8f959e' })
  })
})

describe('CellNode 边框线型绘制痕迹', () => {
  /** 绘制只含边框的空文本节点（文本为空时内置渲染不产生绘制痕迹） */
  function paintBorder(border: CellStyle['border']): RecordingContext {
    const ctx = new RecordingContext()
    new CellNode({ col: 0, row: 0, width: 100, height: 32, style: { border } }).paint(ctx)
    return ctx
  }

  it('solid（含缺省）：全长实线', () => {
    const ctx = paintBorder({
      top: { width: 1, color: '#a00' },
      bottom: { width: 2, color: '#0b0', style: 'solid' },
    })
    expect(ctx.rects).toEqual([
      { x: 0, y: 0, width: 100, height: 1, fill: '#a00' },
      { x: 0, y: 30, width: 100, height: 2, fill: '#0b0' },
    ])
  })

  it('dashed：沿边按段绘制（段长 6、间隔 4）', () => {
    const ctx = paintBorder({ top: { width: 1, color: '#a00', style: 'dashed' } })
    expect(ctx.rects).toEqual(
      Array.from({ length: 10 }, (_, i) => ({
        x: i * 10,
        y: 0,
        width: 6,
        height: 1,
        fill: '#a00',
      })),
    )
  })

  it('dotted：沿边按点段绘制（段长 1、间隔 2，厚度方向整带宽）', () => {
    const ctx = paintBorder({ left: { width: 2, color: '#0b0', style: 'dotted' } })
    expect(ctx.rects).toEqual(
      Array.from({ length: 11 }, (_, i) => ({
        x: 0,
        y: i * 3,
        width: 2,
        height: 1,
        fill: '#0b0',
      })),
    )
  })

  it('double：双线绘制痕迹（两条平行实线各占约 1/3 厚度），非 dash 近似', () => {
    const ctx = paintBorder({ top: { width: 3, color: '#00c', style: 'double' } })
    expect(ctx.rects).toEqual([
      { x: 0, y: 0, width: 100, height: 1, fill: '#00c' },
      { x: 0, y: 2, width: 100, height: 1, fill: '#00c' },
    ])
  })

  it('四边线型独立生效：solid/dashed/dotted/double 并存且 width/color 各随各边', () => {
    const ctx = paintBorder({
      top: { width: 1, color: '#a00', style: 'dashed' },
      bottom: { width: 2, color: '#0b0', style: 'dotted' },
      left: { width: 3, color: '#00c', style: 'double' },
      right: { width: 1, color: '#d40', style: 'solid' },
    })
    expect(ctx.rects).toEqual([
      // top：dashed 10 段
      ...Array.from({ length: 10 }, (_, i) => ({
        x: i * 10,
        y: 0,
        width: 6,
        height: 1,
        fill: '#a00',
      })),
      // bottom：dotted 34 点
      ...Array.from({ length: 34 }, (_, i) => ({
        x: i * 3,
        y: 30,
        width: 1,
        height: 2,
        fill: '#0b0',
      })),
      // left：double 双线
      { x: 0, y: 0, width: 1, height: 32, fill: '#00c' },
      { x: 2, y: 0, width: 1, height: 32, fill: '#00c' },
      // right：solid 实线
      { x: 99, y: 0, width: 1, height: 32, fill: '#d40' },
    ])
  })
})

describe('renderTextCell 换行符强制断行', () => {
  /** textWrap 模式绘制（测量宽按每字符 10px） */
  function paintWrapped(text: string, width = 100, height = 32): RecordingContext {
    const ctx = new RecordingContext()
    renderTextCell({
      ...TEXT_RENDER_BASE,
      ctx,
      text,
      width,
      height,
      textWidth: undefined,
      style: { textWrap: true },
    })
    return ctx
  }

  it('含 \\n：按换行符强制断行，逐段一行', () => {
    const ctx = paintWrapped('ab\ncd')
    expect(ctx.texts).toEqual([
      { text: 'ab', x: 8, y: 12 },
      { text: 'cd', x: 8, y: 28 },
    ])
  })

  it('连续 \\n 产生空行占位（行高保留）', () => {
    const ctx = paintWrapped('a\n\nb')
    // 格高 32 最多 2 行：'a' 与空行，'b' 舍弃
    expect(ctx.texts).toEqual([
      { text: 'a', x: 8, y: 12 },
      { text: '', x: 8, y: 28 },
    ])
  })

  it('与 textWrap 自动换行叠加：先按 \\n 分段，段内再贪心断行', () => {
    // 内容盒宽 44（格宽 60 - 左右内边距 8）：段 'aaaaaa'（宽 60）贪心断为 'aaaa'+'aa'
    const ctx = paintWrapped('aaaaaa\nbb', 60, 48)
    expect(ctx.texts).toEqual([
      { text: 'aaaa', x: 8, y: 12 },
      { text: 'aa', x: 8, y: 28 },
      { text: 'bb', x: 8, y: 44 },
    ])
  })
})
