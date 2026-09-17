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
) {
  const host = new StubHost()
  const table = new ListTable({
    width: 800,
    height: 600,
    columns: [{ field: 'name', title: 'Name' }],
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
