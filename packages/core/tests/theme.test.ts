import { describe, expect, it } from 'vitest'

import { CellNode } from '../src/cell-node'
import { ListTable } from '../src/list-table'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'
import { defaultTheme, extendsTheme } from '../src/theme'

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
  return host.layers
    .get('body')
    ?.root.children.find(
      (n): n is CellNode => n instanceof CellNode && n.col === col && n.row === row,
    )
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
