// 单元格超链接渲染外观与悬停/单击事件（hyperlink-image P2）：
// resolveCellLink 命中的格获得默认链接外观（主题 linkColor 蓝字 + 下划线，被
// resolveCellStyle 覆盖）；悬停切 pointer 光标并派发携带 URL 与格坐标的 hover
// 事件、移出派发 leave；真实指针单击命中派发 click 事件（默认打开可配置），
// 框选拖选与键盘方向键选中零派发。

import type { SceneEvent, SceneEventType } from '@infinitable/render'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ListTable } from '../src/list-table'
import type {
  CellLinkClickEvent,
  CellLinkHoverEvent,
  CellLinkLeaveEvent,
  CellLink,
  ListTableOptions,
  ResolveCellLink,
} from '../src/types'
import { StubHost } from './testing/stub-host'

const BASE_OPTIONS = {
  width: 400,
  height: 260,
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  columns: [
    { field: 'a', title: 'A' },
    { field: 'b', title: 'B' },
  ],
} satisfies Partial<ListTableOptions>

/** 链接格 (1,2)：URL + 可选显示文本 */
const LINK_CELL = { col: 1, row: 2 }
const LINK: CellLink = { url: 'https://example.com', text: '示例链接' }
const resolveLink: ResolveCellLink = (col, row) =>
  col === LINK_CELL.col && row === LINK_CELL.row ? LINK : null

/** 台架：注入式假宿主 + 记录 style.cursor 写入的假容器（光标用例共用） */
function mountTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const container = { style: { cursor: '' } } as unknown as HTMLElement
  const table = new ListTable({
    ...BASE_OPTIONS,
    records: Array.from({ length: 8 }, (_, i) => ({ a: `r${i}`, b: `r${i}` })),
    host,
    hostOptions: { container },
    ...extra,
  })
  host.submitted.length = 0
  return { host, container, table }
}

/** 绕过 EventSystem 直接在 body 场景根上派发事件（与既有交互用例同口径） */
function fireBody(host: StubHost, type: SceneEventType, init: Partial<SceneEvent>): void {
  host.layers.get('body')!.root.handleEvent({
    type,
    target: null,
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY: 0,
    key: undefined,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    originalEvent: {},
    ...init,
  })
}

// 数据格 (col, row) 的视口坐标（默认几何：行号列 48、列头 36、列宽 100、行高 32）
const cellX = (col: number) => 48 + col * 100 + 1
const cellY = (row: number) => 36 + row * 32 + 1

/** 主键指针单击（down + up 同点） */
function clickCell(host: StubHost, col: number, row: number, extra: Partial<SceneEvent> = {}) {
  fireBody(host, 'pointerdown', { x: cellX(col), y: cellY(row), button: 0, ...extra })
  fireBody(host, 'pointerup', { x: cellX(col), y: cellY(row), button: 0, ...extra })
}

describe('链接默认外观（resolveStyle）', () => {
  it('有链接格：默认链接色 + 下划线；非链接格不受影响', () => {
    const { table } = mountTable({ resolveCellLink: resolveLink })
    const linked = table.resolveStyle(LINK_CELL.col, LINK_CELL.row)
    expect(linked.color).toBe('#0563c1')
    expect(linked.underline).toBe(true)
    const plain = table.resolveStyle(0, 0)
    expect(plain.color).toBe('#1f2329')
    expect(plain.underline).toBeUndefined()
  })

  it('resolveCellStyle 覆盖值优先：显式字段覆盖默认链接外观，未给字段保留默认', () => {
    const { table } = mountTable({
      resolveCellLink: resolveLink,
      resolveCellStyle: (col, row) =>
        col === LINK_CELL.col && row === LINK_CELL.row ? { color: 'red', underline: false } : null,
    })
    const style = table.resolveStyle(LINK_CELL.col, LINK_CELL.row)
    expect(style.color).toBe('red')
    expect(style.underline).toBe(false)
    // 部分覆盖：只给 color，下划线保留链接默认
    const { table: partial } = mountTable({
      resolveCellLink: resolveLink,
      resolveCellStyle: (col, row) =>
        col === LINK_CELL.col && row === LINK_CELL.row ? { color: 'green' } : null,
    })
    const partialStyle = partial.resolveStyle(LINK_CELL.col, LINK_CELL.row)
    expect(partialStyle.color).toBe('green')
    expect(partialStyle.underline).toBe(true)
  })

  it('主题 linkColor token 覆盖默认蓝', () => {
    const { table } = mountTable({
      resolveCellLink: resolveLink,
      theme: { linkColor: '#00aa88' },
    })
    expect(table.resolveStyle(LINK_CELL.col, LINK_CELL.row).color).toBe('#00aa88')
  })
})

describe('链接悬停事件与光标', () => {
  it('悬停命中：pointer 光标 + hover 事件载荷（URL/格坐标/落点/originalEvent）；同格移动不重复派发', () => {
    const { host, container, table } = mountTable({ resolveCellLink: resolveLink })
    const originalEvent = {}
    const seen: CellLinkHoverEvent[] = []
    table.onCellLinkHover((event) => seen.push(event))

    fireBody(host, 'pointermove', {
      x: cellX(LINK_CELL.col),
      y: cellY(LINK_CELL.row),
      originalEvent,
    })
    expect(container.style.cursor).toBe('pointer')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      col: LINK_CELL.col,
      row: LINK_CELL.row,
      url: LINK.url,
      text: LINK.text,
      x: cellX(LINK_CELL.col),
      y: cellY(LINK_CELL.row),
    })
    expect(seen[0]!.originalEvent).toBe(originalEvent)

    // 同格内移动：光标保持，不重复派发
    fireBody(host, 'pointermove', { x: cellX(LINK_CELL.col) + 5, y: cellY(LINK_CELL.row) + 5 })
    expect(container.style.cursor).toBe('pointer')
    expect(seen).toHaveLength(1)
  })

  it('移出到非链接格：leave 事件 + 光标恢复缺省', () => {
    const { host, container, table } = mountTable({ resolveCellLink: resolveLink })
    const hovers: CellLinkHoverEvent[] = []
    const leaves: CellLinkLeaveEvent[] = []
    table.onCellLinkHover((event) => hovers.push(event))
    table.onCellLinkLeave((event) => leaves.push(event))

    fireBody(host, 'pointermove', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row) })
    fireBody(host, 'pointermove', { x: cellX(0), y: cellY(0) })
    expect(container.style.cursor).toBe('auto')
    expect(hovers).toHaveLength(1)
    expect(leaves).toEqual([{ col: LINK_CELL.col, row: LINK_CELL.row }])
  })

  it('移出到表头带（无数据格命中）：leave 派发、光标恢复', () => {
    const { host, container, table } = mountTable({ resolveCellLink: resolveLink })
    const leaves: CellLinkLeaveEvent[] = []
    table.onCellLinkLeave((event) => leaves.push(event))

    fireBody(host, 'pointermove', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row) })
    // 列头带中部（避开列缘 resize 手柄命中区）
    fireBody(host, 'pointermove', { x: cellX(LINK_CELL.col) + 50, y: 10 })
    expect(container.style.cursor).toBe('auto')
    expect(leaves).toEqual([{ col: LINK_CELL.col, row: LINK_CELL.row }])
  })

  it('链接格 A → 链接格 B 一次移动：先 leave(A) 后 hover(B)', () => {
    const linkAB: ResolveCellLink = (col, row) =>
      (col === 1 && row === 2) || (col === 0 && row === 3)
        ? { url: `https://e.test/${col},${row}` }
        : null
    const { host, table } = mountTable({ resolveCellLink: linkAB })
    const order: string[] = []
    table.onCellLinkHover((event) => order.push(`hover:${event.col},${event.row}:${event.url}`))
    table.onCellLinkLeave((event) => order.push(`leave:${event.col},${event.row}`))

    fireBody(host, 'pointermove', { x: cellX(1), y: cellY(2) })
    fireBody(host, 'pointermove', { x: cellX(0), y: cellY(3) })
    expect(order).toEqual([
      'hover:1,2:https://e.test/1,2',
      'leave:1,2',
      'hover:0,3:https://e.test/0,3',
    ])
  })

  it('悬停中原地清除链接（同格 link 变空）：leave 派发、光标恢复', () => {
    let active = true
    const { host, container, table } = mountTable({
      resolveCellLink: (col, row) =>
        active && col === LINK_CELL.col && row === LINK_CELL.row ? LINK : null,
    })
    const hovers: CellLinkHoverEvent[] = []
    const leaves: CellLinkLeaveEvent[] = []
    table.onCellLinkHover((event) => hovers.push(event))
    table.onCellLinkLeave((event) => leaves.push(event))

    fireBody(host, 'pointermove', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row) })
    expect(container.style.cursor).toBe('pointer')
    active = false
    fireBody(host, 'pointermove', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row) })
    expect(container.style.cursor).toBe('auto')
    expect(hovers).toHaveLength(1)
    expect(leaves).toEqual([{ col: LINK_CELL.col, row: LINK_CELL.row }])
  })

  it('未配置 resolveCellLink：无事件、光标缺省（回归保护）', () => {
    const { host, container, table } = mountTable()
    const hovers: CellLinkHoverEvent[] = []
    table.onCellLinkHover((event) => hovers.push(event))

    fireBody(host, 'pointermove', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row) })
    expect(container.style.cursor).toBe('auto')
    expect(hovers).toEqual([])
  })
})

describe('链接单击事件', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('真实指针单击命中：click 事件载荷（URL/格坐标/originalEvent），选区照常流动', () => {
    const { host, table } = mountTable({
      resolveCellLink: resolveLink,
      openCellLinkOnClick: false,
    })
    const originalEvent = {}
    const clicks: CellLinkClickEvent[] = []
    table.onCellLinkClick((event) => clicks.push(event))

    clickCell(host, LINK_CELL.col, LINK_CELL.row, { originalEvent })
    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toMatchObject({
      col: LINK_CELL.col,
      row: LINK_CELL.row,
      url: LINK.url,
      text: LINK.text,
    })
    expect(clicks[0]!.originalEvent).toBe(originalEvent)
    // 单击仍选中该格（选区语义不因链接让位）
    expect(table.getSelection().focus).toEqual({ col: LINK_CELL.col, row: LINK_CELL.row })
  })

  it('默认打开开关：缺省开 → window.open 新标签 + noopener；false → 不打开但事件仍派发', () => {
    const open = vi.fn<(url: string, target: string, features: string) => unknown>()
    vi.stubGlobal('window', { open })

    const defaultOpen = mountTable({ resolveCellLink: resolveLink })
    const defaultClicks: CellLinkClickEvent[] = []
    defaultOpen.table.onCellLinkClick((event) => defaultClicks.push(event))
    clickCell(defaultOpen.host, LINK_CELL.col, LINK_CELL.row)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(LINK.url, '_blank', 'noopener')
    expect(defaultClicks).toHaveLength(1)

    open.mockClear()
    const disabled = mountTable({ resolveCellLink: resolveLink, openCellLinkOnClick: false })
    const disabledClicks: CellLinkClickEvent[] = []
    disabled.table.onCellLinkClick((event) => disabledClicks.push(event))
    clickCell(disabled.host, LINK_CELL.col, LINK_CELL.row)
    expect(open).not.toHaveBeenCalled()
    expect(disabledClicks).toHaveLength(1)
  })

  it('单击非链接格：零派发', () => {
    const { host, table } = mountTable({
      resolveCellLink: resolveLink,
      openCellLinkOnClick: false,
    })
    const clicks: CellLinkClickEvent[] = []
    table.onCellLinkClick((event) => clicks.push(event))

    clickCell(host, 0, 0)
    expect(clicks).toEqual([])
  })

  it('右键 down/up 在链接格：零派发（非主键不是单击）', () => {
    const { host, table } = mountTable({
      resolveCellLink: resolveLink,
      openCellLinkOnClick: false,
    })
    const clicks: CellLinkClickEvent[] = []
    table.onCellLinkClick((event) => clicks.push(event))

    fireBody(host, 'pointerdown', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row), button: 2 })
    fireBody(host, 'pointerup', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row), button: 2 })
    expect(clicks).toEqual([])
  })
})

describe('框选与键盘选中零派发', () => {
  it('框选拖选：从链接格按下拖到远处格抬起，零派发', () => {
    const { host, table } = mountTable({
      resolveCellLink: resolveLink,
      openCellLinkOnClick: false,
    })
    const clicks: CellLinkClickEvent[] = []
    table.onCellLinkClick((event) => clicks.push(event))

    fireBody(host, 'pointerdown', { x: cellX(LINK_CELL.col), y: cellY(LINK_CELL.row), button: 0 })
    fireBody(host, 'pointermove', { x: cellX(0), y: cellY(5) })
    fireBody(host, 'pointerup', { x: cellX(0), y: cellY(5), button: 0 })
    expect(clicks).toEqual([])
    // 框选照常生效（选区扩展到落点格）
    expect(table.getSelection().focus).toEqual({ col: 0, row: 5 })
  })

  it('down/up 同在链接格但拖拽越阈：零派发（拖拽不是单击）', () => {
    const { host, table } = mountTable({
      resolveCellLink: resolveLink,
      openCellLinkOnClick: false,
    })
    const clicks: CellLinkClickEvent[] = []
    table.onCellLinkClick((event) => clicks.push(event))

    // 链接格 (1,2) 宽 100：down 在左缘 +1，up 在右缘 -1，位移 98 > 阈值 10
    fireBody(host, 'pointerdown', {
      x: cellX(LINK_CELL.col) - 1,
      y: cellY(LINK_CELL.row),
      button: 0,
    })
    fireBody(host, 'pointerup', {
      x: cellX(LINK_CELL.col) + 98,
      y: cellY(LINK_CELL.row),
      button: 0,
    })
    expect(clicks).toEqual([])
  })

  it('键盘方向键移动选中（含移入/移出链接格）：零派发', () => {
    const { host, table } = mountTable({
      resolveCellLink: resolveLink,
      openCellLinkOnClick: false,
    })
    const clicks: CellLinkClickEvent[] = []
    table.onCellLinkClick((event) => clicks.push(event))

    table.selectCell(0, LINK_CELL.row)
    const fireSky = (key: string) =>
      host.layers.get('sky')!.root.handleEvent({
        type: 'keydown',
        target: null,
        x: 0,
        y: 0,
        deltaX: 0,
        deltaY: 0,
        key,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        originalEvent: {},
      })
    fireSky('ArrowRight') // 移入链接格
    expect(table.getSelection().focus).toEqual({ col: LINK_CELL.col, row: LINK_CELL.row })
    fireSky('ArrowLeft') // 移出链接格
    fireSky('ArrowDown')
    expect(clicks).toEqual([])
  })
})
