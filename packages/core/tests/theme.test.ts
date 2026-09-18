import { describe, expect, it } from 'vitest'

import type { RenderContext } from '@infinite-table/render'

import { CellNode } from '../src/cell-node'
import { FrameNode, UnderlayNode } from '../src/list-table-scene'
import { ListTable } from '../src/list-table'
import { findCellNode } from './testing/find-cell-node'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'
import { defaultTheme, extendsTheme } from '../src/theme'

/** 最小记录型 2D 上下文：记录 fillRect 序列与阴影字段赋值（外框/底色节点绘制断言用） */
class PaintRecordingContext implements RenderContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000'
  strokeStyle: string | CanvasGradient | CanvasPattern = '#000'
  lineWidth = 1
  font = ''
  shadowColor?: string
  shadowBlur?: number
  readonly rects: { x: number; y: number; width: number; height: number; fill: unknown }[] = []

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

function createTable(
  theme?: Parameters<typeof extendsTheme>[0],
  rowHeight?: number,
  resolveCellStyle?: ListTableOptions['resolveCellStyle'],
  columns?: ListTableOptions['columns'],
) {
  const host = new StubHost()
  const table = new ListTable({
    width: 800,
    height: 600,
    columns: columns ?? [{ field: 'name', title: 'Name' }],
    records: Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` })),
    theme,
    rowHeight,
    resolveCellStyle,
    host,
  })
  return { host, table }
}

function findCell(host: StubHost, col: number, row: number): CellNode | undefined {
  const body = host.layers.get('body')
  return body ? findCellNode(body.root, col, row) : undefined
}

describe('主题系统', () => {
  it('默认主题开箱可用：extendsTheme() 返回完整默认 token', () => {
    expect(extendsTheme()).toEqual(defaultTheme)
    expect(defaultTheme.body.background).toBe('#ffffff')
    expect(defaultTheme.header.background).toBe('#f5f6f7')
  })

  it('extends 深覆盖：嵌套 token 按键覆盖，未覆盖的继承默认主题', () => {
    const theme = extendsTheme({ rowHeight: 24, header: { background: '#000000' } })
    expect(theme.rowHeight).toBe(24)
    expect(theme.header.background).toBe('#000000')
    expect(theme.header.font).toBe(defaultTheme.header.font)
    expect(theme.body).toEqual(defaultTheme.body)
  })

  it('可基于派生主题再派生（链式 extends）', () => {
    const base = extendsTheme({ body: { color: '#111111' } })
    const theme = extendsTheme({ body: { background: '#222222' } }, base)
    expect(theme.body.color).toBe('#111111')
    expect(theme.body.background).toBe('#222222')
    expect(theme.header).toEqual(defaultTheme.header)
  })

  it('派生主题接入样式管线：几何与格样式由主题决定', () => {
    const { host, table } = createTable({
      rowHeight: 20,
      headerHeight: 40,
      body: { background: '#fafafa', color: '#123456' },
      header: { background: '#333333' },
    })
    expect(table.getTheme().rowHeight).toBe(20)
    // 视口高 560 = 600 - 表头高 40；行高 20 → 窗口 28 行
    expect(table.getVisibleRange().rows).toEqual({ start: 0, end: 28 })
    const cell = findCell(host, 0, 0)
    expect(cell?.style.background).toBe('#fafafa')
    expect(cell?.style.color).toBe('#123456')
    expect(findCell(host, 0, -1)?.style.background).toBe('#333333')
  })

  it('显式 options 优先于主题 token', () => {
    const { table } = createTable({ rowHeight: 20 }, 30)
    // 行高取显式 30：视口 564 → ceil(564/30) = 19 行
    expect(table.getVisibleRange().rows).toEqual({ start: 0, end: 19 })
  })

  it('extends 深覆盖新 token：padding/textOverflow 按键覆盖，未覆盖的继承', () => {
    const theme = extendsTheme({
      body: { padding: [1, 2, 3, 4] },
      header: { textOverflow: 'clip' },
    })
    expect(theme.body.padding).toEqual([1, 2, 3, 4])
    expect(theme.body.textOverflow).toBeUndefined()
    expect(theme.body.color).toBe(defaultTheme.body.color)
    expect(theme.header.textOverflow).toBe('clip')
    expect(theme.header.padding).toBeUndefined()
  })
})

describe('主题分区 textOverflow/padding token', () => {
  it('body 分区 token 进数据格样式；ellipsis 数据格不再 Excel 式溢出', () => {
    const { host } = createTable({
      body: { textOverflow: 'ellipsis', padding: [4, 8, 4, 8] },
    })
    const cell = findCell(host, 0, 0)
    expect(cell?.style.textOverflow).toBe('ellipsis')
    expect(cell?.style.padding).toEqual([4, 8, 4, 8])
    expect(cell?.textMaxX).toBe(100)
  })

  it('列头/行号列缺省 ellipsis；header 分区显式 token 覆盖缺省', () => {
    const fallback = createTable()
    expect(findCell(fallback.host, 0, -1)?.style.textOverflow).toBe('ellipsis')
    expect(findCell(fallback.host, -1, 0)?.style.textOverflow).toBe('ellipsis')

    const themed = createTable({ header: { textOverflow: 'clip' } })
    expect(findCell(themed.host, 0, -1)?.style.textOverflow).toBe('clip')
  })

  it('格级 hook 逐字段覆盖主题级 textOverflow/padding', () => {
    const { host } = createTable(
      { body: { textOverflow: 'ellipsis', padding: [4, 8, 4, 8] } },
      undefined,
      (col) => (col === 0 ? { textOverflow: 'clip', padding: [1, 2, 3, 4] } : null),
    )
    const cell = findCell(host, 0, 0)
    expect(cell?.style.textOverflow).toBe('clip')
    expect(cell?.style.padding).toEqual([1, 2, 3, 4])
  })
})

describe('主题分区 P2~P4 新增样式 token', () => {
  it('新 token 缺省值：默认主题不设值，extendsTheme() 仍等于默认主题', () => {
    expect(defaultTheme.body.textAlign).toBeUndefined()
    expect(defaultTheme.body.verticalAlign).toBeUndefined()
    expect(defaultTheme.body.fontWeight).toBeUndefined()
    expect(defaultTheme.body.fontStyle).toBeUndefined()
    expect(defaultTheme.body.fontSize).toBeUndefined()
    expect(defaultTheme.body.fontFamily).toBeUndefined()
    expect(defaultTheme.body.underline).toBeUndefined()
    expect(defaultTheme.body.lineThrough).toBeUndefined()
    expect(defaultTheme.body.border).toBeUndefined()
    expect(defaultTheme.header.textAlign).toBeUndefined()
    expect(defaultTheme.header.border).toBeUndefined()
    expect(extendsTheme()).toEqual(defaultTheme)
  })

  it('extends 深覆盖新 token：按键覆盖、边框按整体边覆盖，未覆盖的继承', () => {
    const theme = extendsTheme({
      body: {
        textAlign: 'right',
        verticalAlign: 'bottom',
        fontWeight: 'bold',
        fontStyle: 'italic',
        fontSize: 14,
        fontFamily: 'Arial',
        underline: true,
        lineThrough: true,
        border: { top: { width: 1, color: '#333', style: 'dashed' } },
      },
      header: { textAlign: 'center', fontSize: 13 },
    })
    expect(theme.body.textAlign).toBe('right')
    expect(theme.body.verticalAlign).toBe('bottom')
    expect(theme.body.fontWeight).toBe('bold')
    expect(theme.body.fontStyle).toBe('italic')
    expect(theme.body.fontSize).toBe(14)
    expect(theme.body.fontFamily).toBe('Arial')
    expect(theme.body.underline).toBe(true)
    expect(theme.body.lineThrough).toBe(true)
    expect(theme.body.border?.top).toEqual({ width: 1, color: '#333', style: 'dashed' })
    expect(theme.body.border?.left).toBeUndefined()
    expect(theme.body.color).toBe(defaultTheme.body.color)
    expect(theme.header.textAlign).toBe('center')
    expect(theme.header.fontSize).toBe(13)
    expect(theme.header.font).toBe(defaultTheme.header.font)
    expect(theme.header.border).toBeUndefined()
  })

  it('body 分区新 token 落数据格样式；header 分区 token 落列头/行号列/角格', () => {
    const { host } = createTable({
      body: {
        textAlign: 'right',
        verticalAlign: 'bottom',
        fontWeight: 'bold',
        fontSize: 14,
        underline: true,
        border: { top: { width: 2, color: '#333', style: 'dashed' } },
      },
      header: {
        fontStyle: 'italic',
        verticalAlign: 'top',
        border: { bottom: { width: 3, color: '#09f', style: 'double' } },
      },
    })
    const cell = findCell(host, 0, 0)
    expect(cell?.style.textAlign).toBe('right')
    expect(cell?.style.verticalAlign).toBe('bottom')
    expect(cell?.style.fontWeight).toBe('bold')
    expect(cell?.style.fontSize).toBe(14)
    expect(cell?.style.underline).toBe(true)
    expect(cell?.style.fontStyle).toBeUndefined()
    expect(cell?.style.border?.top).toEqual({ width: 2, color: '#333', style: 'dashed' })
    // 列头/行号列/角格沿用 header 分区
    for (const [col, row] of [
      [0, -1],
      [-1, 0],
      [-1, -1],
    ] as const) {
      const header = findCell(host, col, row)
      expect(header?.style.fontStyle).toBe('italic')
      expect(header?.style.verticalAlign).toBe('top')
      expect(header?.style.border?.bottom).toEqual({ width: 3, color: '#09f', style: 'double' })
    }
  })

  it('覆盖链：主题分区 token → 列级样式 → 按格 hook 逐字段覆盖', () => {
    const { host } = createTable(
      {
        body: {
          textAlign: 'right',
          color: '#123456',
          border: {
            top: { width: 1, color: '#333', style: 'dashed' },
            left: { width: 1, color: '#333' },
          },
        },
      },
      undefined,
      (col) =>
        col === 0 ? { fontWeight: 400, border: { top: { width: 3, color: '#00c' } } } : null,
      [{ field: 'name', title: 'Name', style: { textAlign: 'center', underline: true } }],
    )
    const cell = findCell(host, 0, 0)
    // 列级压主题分区
    expect(cell?.style.textAlign).toBe('center')
    // 按格 hook 压列级
    expect(cell?.style.fontWeight).toBe(400)
    // 未给的沿用上层：color 主题给、列级/hook 未给 → 主题；underline 列级给、hook 未给 → 列级
    expect(cell?.style.color).toBe('#123456')
    expect(cell?.style.underline).toBe(true)
    // 边框逐边跨层合并：top 被 hook 整边覆盖（线型回落 solid）、left 保留主题
    expect(cell?.style.border?.top).toEqual({ width: 3, color: '#00c' })
    expect(cell?.style.border?.left).toEqual({ width: 1, color: '#333' })
  })
})

describe('S1 交互/底色/外框/表头分区 token', () => {
  it('interaction 默认值与既有交互浮层视觉一致（原硬编码常量逐项相等）', () => {
    expect(defaultTheme.interaction).toEqual({
      selectionFill: 'rgba(46, 106, 219, 0.08)',
      selectionBorder: '#2e6adb',
      selectionBorderWidth: 2,
      fillHandle: '#2e6adb',
      hoverCell: 'rgba(31, 35, 41, 0.08)',
      hoverBand: 'rgba(31, 35, 41, 0.04)',
      resizeLine: '#2e6adb',
      resizeLineWidth: 2,
      headerHighlight: 'rgba(46, 106, 219, 0.18)',
    })
  })

  it('underlayBackgroundColor 默认白色；frameStyle 默认不绘制', () => {
    expect(defaultTheme.underlayBackgroundColor).toBe('#ffffff')
    expect(defaultTheme.frameStyle).toEqual({ lineWidth: 0, color: '#e5e6eb', shadow: false })
  })

  it('extends 深覆盖：interaction/frameStyle 按键覆盖、underlay 标量覆盖，未覆盖键继承', () => {
    const theme = extendsTheme({
      underlayBackgroundColor: '#f0f0f0',
      interaction: { selectionFill: 'rgba(255, 0, 0, 0.1)', resizeLineWidth: 4 },
      frameStyle: { lineWidth: 1, shadow: true },
    })
    expect(theme.underlayBackgroundColor).toBe('#f0f0f0')
    expect(theme.interaction.selectionFill).toBe('rgba(255, 0, 0, 0.1)')
    expect(theme.interaction.selectionBorder).toBe(defaultTheme.interaction.selectionBorder)
    expect(theme.interaction.resizeLineWidth).toBe(4)
    expect(theme.frameStyle).toEqual({ lineWidth: 1, color: '#e5e6eb', shadow: true })
  })

  it('rowHeader/corner 缺省随生效 header 派生；显式分区键最后生效', () => {
    const derived = extendsTheme({ header: { background: '#ff0000' } })
    expect(derived.rowHeader).toEqual(derived.header)
    expect(derived.corner).toEqual(derived.header)
    const explicit = extendsTheme({
      header: { background: '#ff0000' },
      rowHeader: { background: '#00ff00' },
      corner: { color: '#0000ff' },
    })
    expect(explicit.rowHeader.background).toBe('#00ff00')
    expect(explicit.rowHeader.color).toBe(defaultTheme.header.color)
    expect(explicit.corner.color).toBe('#0000ff')
    expect(explicit.corner.background).toBe('#ff0000')
    expect(explicit.header).toEqual(derived.header)
  })

  it('rowHeader/corner 分区 token 分别落行号格与左上角格样式；列头仍用 header', () => {
    const { host } = createTable({
      header: { background: '#eeeeee' },
      rowHeader: { background: '#aaaaaa', color: '#111111' },
      corner: { background: '#222222' },
    })
    expect(findCell(host, 0, -1)?.style.background).toBe('#eeeeee')
    expect(findCell(host, -1, 0)?.style.background).toBe('#aaaaaa')
    expect(findCell(host, -1, 0)?.style.color).toBe('#111111')
    expect(findCell(host, -1, -1)?.style.background).toBe('#222222')
  })

  it('underlay 底色节点为首子节点并铺全表底色；数据区外空白处可见', () => {
    const { host } = createTable({ underlayBackgroundColor: '#f0f0f0' })
    const root = host.layers.get('body')!.root
    const underlay = root.children[0]
    expect(underlay).toBeInstanceOf(UnderlayNode)
    expect(underlay?.width).toBe(800)
    expect(underlay?.height).toBe(600)
    const ctx = new PaintRecordingContext()
    underlay!.paint(ctx)
    expect(ctx.rects).toEqual([{ x: 0, y: 0, width: 800, height: 600, fill: '#f0f0f0' }])
  })

  it('frameStyle 关闭：外框节点存在但不绘制；开启：四边线框 + 阴影字段生效', () => {
    const off = createTable()
    const frameOff = off.host.layers.get('body')!.root.children.at(-1)
    expect(frameOff).toBeInstanceOf(FrameNode)
    const ctxOff = new PaintRecordingContext()
    frameOff!.paint(ctxOff)
    expect(ctxOff.rects).toEqual([])

    const on = createTable({ frameStyle: { lineWidth: 3, color: '#123456', shadow: true } })
    const frameOn = on.host.layers.get('body')!.root.children.at(-1)
    expect(frameOn).toBeInstanceOf(FrameNode)
    const ctxOn = new PaintRecordingContext()
    frameOn!.paint(ctxOn)
    expect(ctxOn.shadowColor).toBe('#123456')
    expect(ctxOn.shadowBlur).toBeGreaterThan(0)
    expect(ctxOn.rects).toEqual([
      { x: 0, y: 0, width: 800, height: 3, fill: '#123456' },
      { x: 0, y: 597, width: 800, height: 3, fill: '#123456' },
      { x: 0, y: 0, width: 3, height: 600, fill: '#123456' },
      { x: 797, y: 0, width: 3, height: 600, fill: '#123456' },
    ])
  })
})
