// 图片超链接单击（hyperlink-image P6）：带链接浮动图与带链接嵌入图单击派发图片
// 链接点击事件（onImageLinkClick，事件通道对齐 P2 的单元格链接点击：默认打开走
// openCellLinkOnClick）；无链接图片单击零派发、仅保持现有选中行为（回归保护两分支）。

import type { SceneEvent, SceneEventType } from '@infinitable/render'
import { describe, expect, it, vi } from 'vitest'

import { ListTable } from '../src/list-table'
import type {
  CellLinkClickEvent,
  ImageLinkClickEvent,
  ListTableOptions,
  ResolveCellImageLink,
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

/** 台架：表上叠一个 120×80 浮动图片（锚在 (0,2) 格 + (10,10) 偏移 → 覆盖
 * (58,110)–(178,190)；无 imageService，占位即可——交互命中不依赖位图） */
function mountTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({
    ...BASE_OPTIONS,
    records: Array.from({ length: 8 }, (_, i) => ({ a: `r${i}`, b: `r${i}` })),
    host,
    openCellLinkOnClick: false,
    ...extra,
  })
  table.floatObjects.add({
    id: 'fx',
    kind: 'image',
    anchor: { from: { col: 0, row: 2 }, to: { col: 1, row: 3 }, offsetX: 10, offsetY: 10 },
    size: { width: 120, height: 80 },
  })
  host.submitted.length = 0
  return { host, table }
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

/** 浮动图片中心（对象覆盖 (58,110)–(178,190)） */
const FLOAT_CENTER = { x: 118, y: 150 }

/** 主键指针单击（down + up 同点） */
function clickAt(host: StubHost, x: number, y: number, extra: Partial<SceneEvent> = {}) {
  fireBody(host, 'pointerdown', { x, y, button: 0, ...extra })
  fireBody(host, 'pointerup', { x, y, button: 0, ...extra })
}

describe('浮动图片链接单击（kind: float）', () => {
  it('带链接浮动图单击：派发图片链接点击（id/url/originalEvent），选中行为保持', () => {
    const { host, table } = mountTable()
    table.floatObjects.update('fx', { link: 'https://example.com/float' })
    const originalEvent = {}
    const seen: ImageLinkClickEvent[] = []
    table.onImageLinkClick((event) => seen.push(event))

    clickAt(host, FLOAT_CENTER.x, FLOAT_CENTER.y, { originalEvent })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      kind: 'float',
      id: 'fx',
      url: 'https://example.com/float',
    })
    expect(seen[0]!.originalEvent).toBe(originalEvent)
    // 无链接让位语义不破坏既有选中（选中在按下完成）
    expect(table.floatObjects.getSelectedId()).toBe('fx')
  })

  it('无链接浮动图单击：零派发，选中行为不变（回归保护）', () => {
    const { host, table } = mountTable()
    const seen: ImageLinkClickEvent[] = []
    table.onImageLinkClick((event) => seen.push(event))

    clickAt(host, FLOAT_CENTER.x, FLOAT_CENTER.y)
    expect(seen).toEqual([])
    expect(table.floatObjects.getSelectedId()).toBe('fx')
  })

  it('链接清除后（update 显式置空 link）单击：零派发，选中保持（B1 回归）', () => {
    const { host, table } = mountTable()
    table.floatObjects.update('fx', { link: 'https://example.com/cleared' })
    // 桥接层清除语义：补丁显式携带 link: undefined 覆盖旧值（缺键删不掉）
    table.floatObjects.update('fx', { link: undefined })
    const seen: ImageLinkClickEvent[] = []
    table.onImageLinkClick((event) => seen.push(event))

    clickAt(host, FLOAT_CENTER.x, FLOAT_CENTER.y)
    expect(seen).toEqual([])
    expect(table.floatObjects.getSelectedId()).toBe('fx')
  })

  it('拖拽移动浮动图松手：零派发（拖拽不是单击）', () => {
    const { host, table } = mountTable()
    table.floatObjects.update('fx', { link: 'https://example.com/float-drag' })
    const seen: ImageLinkClickEvent[] = []
    table.onImageLinkClick((event) => seen.push(event))

    fireBody(host, 'pointerdown', { ...FLOAT_CENTER, button: 0 })
    fireBody(host, 'pointermove', { x: FLOAT_CENTER.x + 20, y: FLOAT_CENTER.y })
    fireBody(host, 'pointerup', { x: FLOAT_CENTER.x + 20, y: FLOAT_CENTER.y, button: 0 })
    expect(seen).toEqual([])
  })

  it('只读浮动图点按（无拖拽会话路径）：带链接同样派发', () => {
    const { host, table } = mountTable()
    table.floatObjects.isReadonly = true
    table.floatObjects.update('fx', { link: 'https://example.com/readonly' })
    const seen: ImageLinkClickEvent[] = []
    table.onImageLinkClick((event) => seen.push(event))

    clickAt(host, FLOAT_CENTER.x, FLOAT_CENTER.y)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ kind: 'float', id: 'fx', url: 'https://example.com/readonly' })
  })
})

describe('嵌入图链接单击（kind: cell）', () => {
  /** 嵌入图链接格 (1,2)：resolveCellImageLink 命中返回 URL */
  const IMAGE_CELL = { col: 1, row: 2 }
  const IMAGE_URL = 'https://example.com/embed'
  const resolveImageLink: ResolveCellImageLink = (col, row) =>
    col === IMAGE_CELL.col && row === IMAGE_CELL.row ? IMAGE_URL : null

  it('带链接嵌入图格单击：派发图片链接点击（格坐标/url），选区照常流动', () => {
    const { host, table } = mountTable({ resolveCellImageLink: resolveImageLink })
    const originalEvent = {}
    const seen: ImageLinkClickEvent[] = []
    table.onImageLinkClick((event) => seen.push(event))

    clickAt(host, cellX(IMAGE_CELL.col), cellY(IMAGE_CELL.row), { originalEvent })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      kind: 'cell',
      col: IMAGE_CELL.col,
      row: IMAGE_CELL.row,
      url: IMAGE_URL,
    })
    expect(seen[0]!.originalEvent).toBe(originalEvent)
    // 单击仍选中该格（选区语义不因图片链接让位）
    expect(table.getSelection().focus).toEqual({ col: IMAGE_CELL.col, row: IMAGE_CELL.row })
  })

  it('无链接格单击：零派发，单元格链接与选区照常（回归保护）', () => {
    const cellLink: ResolveCellLink = (col, row) =>
      col === 0 && row === 2 ? { url: 'https://example.com/cell' } : null
    const { host, table } = mountTable({
      resolveCellImageLink: resolveImageLink,
      resolveCellLink: cellLink,
    })
    const imageSeen: ImageLinkClickEvent[] = []
    const cellSeen: CellLinkClickEvent[] = []
    table.onImageLinkClick((event) => imageSeen.push(event))
    table.onCellLinkClick((event) => cellSeen.push(event))

    // 非嵌入图链接格：单元格链接照常
    clickAt(host, cellX(0), cellY(2))
    expect(imageSeen).toEqual([])
    expect(cellSeen).toHaveLength(1)

    // 无任何链接格：双双零派发，仅选中
    clickAt(host, cellX(0), cellY(0))
    expect(imageSeen).toEqual([])
    expect(cellSeen).toHaveLength(1)
    expect(table.getSelection().focus).toEqual({ col: 0, row: 0 })
  })

  it('同格既有嵌入图链接又有单元格链接：嵌入图优先（图片盖在格上），单元格链接零派发', () => {
    const cellLink: ResolveCellLink = (col, row) =>
      col === IMAGE_CELL.col && row === IMAGE_CELL.row ? { url: 'https://example.com/cell' } : null
    const { host, table } = mountTable({
      resolveCellImageLink: resolveImageLink,
      resolveCellLink: cellLink,
    })
    const imageSeen: ImageLinkClickEvent[] = []
    const cellSeen: CellLinkClickEvent[] = []
    table.onImageLinkClick((event) => imageSeen.push(event))
    table.onCellLinkClick((event) => cellSeen.push(event))

    clickAt(host, cellX(IMAGE_CELL.col), cellY(IMAGE_CELL.row))
    expect(imageSeen).toHaveLength(1)
    expect(imageSeen[0]).toMatchObject({ kind: 'cell', url: IMAGE_URL })
    expect(cellSeen).toEqual([])
  })

  it('框选拖选从嵌入图链接格起拖到远处：零派发（拖拽不是单击）', () => {
    const { host, table } = mountTable({ resolveCellImageLink: resolveImageLink })
    const seen: ImageLinkClickEvent[] = []
    table.onImageLinkClick((event) => seen.push(event))

    fireBody(host, 'pointerdown', {
      x: cellX(IMAGE_CELL.col),
      y: cellY(IMAGE_CELL.row),
      button: 0,
    })
    fireBody(host, 'pointermove', { x: cellX(0), y: cellY(5) })
    fireBody(host, 'pointerup', { x: cellX(0), y: cellY(5), button: 0 })
    expect(seen).toEqual([])
  })
})

describe('图片链接默认打开（对齐单元格链接单击通道）', () => {
  // mountTable 台架缺省 openCellLinkOnClick: false（事件断言不被默认打开干扰）；
  // 本组用例显式传 undefined 覆盖为引擎缺省（开）
  it('openCellLinkOnClick 缺省开：派发后默认 window.open；false：事件仍派发但不打开', () => {
    const open = vi.fn<(url: string, target: string, features: string) => unknown>()
    vi.stubGlobal('window', { open })

    const floatOpened = mountTable({ openCellLinkOnClick: undefined })
    floatOpened.table.floatObjects.update('fx', { link: 'https://example.com/open' })
    const floatSeen: ImageLinkClickEvent[] = []
    floatOpened.table.onImageLinkClick((event) => floatSeen.push(event))
    clickAt(floatOpened.host, FLOAT_CENTER.x, FLOAT_CENTER.y)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/open', '_blank', 'noopener')
    expect(floatSeen).toHaveLength(1)

    open.mockClear()
    const cellOpened = mountTable({
      resolveCellImageLink: (col, row) =>
        col === 1 && row === 2 ? 'https://example.com/open-cell' : null,
      openCellLinkOnClick: undefined,
    })
    clickAt(cellOpened.host, cellX(1), cellY(2))
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://example.com/open-cell', '_blank', 'noopener')

    open.mockClear()
    const disabled = mountTable({
      resolveCellImageLink: (col, row) =>
        col === 1 && row === 2 ? 'https://example.com/disabled' : null,
    })
    const disabledSeen: ImageLinkClickEvent[] = []
    disabled.table.onImageLinkClick((event) => disabledSeen.push(event))
    clickAt(disabled.host, cellX(1), cellY(2))
    expect(open).not.toHaveBeenCalled()
    expect(disabledSeen).toHaveLength(1)

    vi.unstubAllGlobals()
  })
})
