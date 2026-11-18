import { SceneNode, paintTree, type SceneEvent, type SceneEventType } from '@infinitable/render'
import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import { HEADER_COORD } from '../src/list-table-internal'
import type { ColHeaderClickEvent, ListTableOptions } from '../src/types'
import { RecordingContext } from './testing/recording-context'
import { StubHost } from './testing/stub-host'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  columns: Array.from({ length: 12 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, ...extra })
  host.submitted.length = 0
  return { host, table }
}

function fire(root: SceneNode, type: SceneEventType, init: Partial<SceneEvent>): void {
  root.handleEvent({
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

function fireBody(host: StubHost, type: SceneEventType, init: Partial<SceneEvent>): void {
  fire(host.layers.get('body')!.root, type, init)
}

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `r${i}` }))

describe('ListTable 列头自定义样式 resolveColHeaderStyle 与局部刷新', () => {
  it('resolveColHeaderStyle 覆盖主题默认并在选区高亮/取消高亮后完整保留', () => {
    const { table } = createTable({
      records: records(5),
      resolveColHeaderStyle: (col) =>
        col === 1
          ? {
              background: '#eef2ff',
              color: '#1d4ed8',
              fontWeight: 700,
              textAlign: 'right',
            }
          : null,
    })

    const col1Node = table.sceneState.colHeaderNodes.get(1)!
    expect(col1Node.style).toMatchObject({
      background: '#eef2ff',
      color: '#1d4ed8',
      fontWeight: 700,
      textAlign: 'right',
    })
    expect(table.styleAt(1, HEADER_COORD)).toMatchObject({
      background: '#eef2ff',
      color: '#1d4ed8',
      fontWeight: 700,
    })

    // 选中列 1：高亮混色但保留自定义 color / fontWeight / textAlign
    table.selectCol(1)
    const highlighted = table.sceneState.colHeaderNodes.get(1)!.style
    expect(highlighted.background).not.toBe('#eef2ff')
    expect(highlighted.color).toBe('#1d4ed8')
    expect(highlighted.fontWeight).toBe(700)
    expect(highlighted.textAlign).toBe('right')

    // 取消选区：恢复自定义样式
    table.clearSelection()
    expect(table.sceneState.colHeaderNodes.get(1)!.style).toMatchObject({
      background: '#eef2ff',
      color: '#1d4ed8',
      fontWeight: 700,
      textAlign: 'right',
    })
  })

  it('refreshColHeader / refreshColHeaders 局部刷新列头标题、样式与自定义渲染器', () => {
    let sortAsc = false
    let headerColor = '#4e5969'
    const rendered: Array<{ col: number; sortAsc: boolean }> = []

    const { host, table } = createTable({
      records: records(5),
      resolveColHeaderStyle: (col) => (col === 2 ? { color: headerColor } : null),
      resolveColHeaderRenderer: (col) =>
        col === 2
          ? (target) => {
              rendered.push({ col: target.col, sortAsc })
            }
          : null,
    })

    const ctx = new RecordingContext()
    paintTree(host.layers.get('body')!.root, ctx)
    expect(rendered).toEqual([{ col: 2, sortAsc: false }])

    // 单列局部刷新
    host.submitted.length = 0
    rendered.length = 0
    sortAsc = true
    headerColor = '#3370ff'
    table.columns[2]!.title = 'C2-Updated'
    table.refreshColHeader(2)
    const node2 = table.sceneState.colHeaderNodes.get(2)!
    expect(node2.text).toBe('C2-Updated')
    expect(node2.style.color).toBe('#3370ff')
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'region', region: { x: 248, y: 0, width: 100, height: 36 } } },
    ])
    paintTree(host.layers.get('body')!.root, new RecordingContext())
    expect(rendered).toEqual([{ col: 2, sortAsc: true }])

    // 窗外列安全跳过
    host.submitted.length = 0
    table.refreshColHeader(11)
    expect(host.submitted).toEqual([])

    // 全列头刷新合并为单次 region 失效
    host.submitted.length = 0
    table.refreshColHeaders()
    expect(host.submitted).toHaveLength(1)
    expect(host.submitted[0]!.inv.type).toBe('region')
  })
})

describe('ListTable 列头交互热区命中与单击隔离', () => {
  it('点列头本体仅选中整列且 hitId=null；点按钮热区隔离整列选中并携带 hitId/hitRect', () => {
    const cursorEl = { style: { cursor: '' } } as unknown as HTMLElement
    const { host, table } = createTable({
      records: records(10),
      hostOptions: { container: cursorEl },
      resolveColHeaderRegions: (_col, size) => [
        {
          id: 'sort',
          rect: { x: size.width - 42, y: 8, width: 18, height: 20 },
          cursor: 'pointer',
        },
        {
          id: 'menu',
          rect: { x: size.width - 22, y: 8, width: 18, height: 20 },
          cursor: 'pointer',
        },
      ],
    })
    const clicks: ColHeaderClickEvent[] = []
    table.onColHeaderClick((e) => clicks.push(e))

    // 先选中一个单元格 (0, 2)
    table.selectCell(0, 2)

    // 1) 悬停与点击列 1 的排序按钮热区（列 1 位于 x=[148, 248)，sort 热区 x=[206, 224), y=[8, 28)）
    fireBody(host, 'pointermove', { x: 215, y: 18 })
    expect(cursorEl.style.cursor).toBe('pointer')

    fireBody(host, 'pointerdown', { x: 215, y: 18, button: 0 })
    fireBody(host, 'pointerup', { x: 215, y: 18, button: 0 })

    // 原有选区完全不被破坏（不选中整列）
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 2 }, end: { col: 0, row: 2 } },
    ])
    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toMatchObject({
      col: 1,
      hitId: 'sort',
      rect: { x: 148, y: 0, width: 100, height: 36 },
      hitRect: { x: 206, y: 8, width: 18, height: 20 },
    })

    // 2) 点击列 1 的菜单按钮热区（x=[226, 244), y=[8, 28)）
    fireBody(host, 'pointerdown', { x: 235, y: 18, button: 0 })
    fireBody(host, 'pointerup', { x: 235, y: 18, button: 0 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 2 }, end: { col: 0, row: 2 } },
    ])
    expect(clicks).toHaveLength(2)
    expect(clicks[1]).toMatchObject({
      col: 1,
      hitId: 'menu',
      hitRect: { x: 226, y: 8, width: 18, height: 20 },
    })

    // 3) 点击列 1 本体区域（x=170, y=18）：选中整列，且 hitId=null
    fireBody(host, 'pointermove', { x: 170, y: 18 })
    expect(cursorEl.style.cursor).toBe('auto')
    fireBody(host, 'pointerdown', { x: 170, y: 18, button: 0 })
    fireBody(host, 'pointerup', { x: 170, y: 18, button: 0 })

    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 1, row: 9 } },
    ])
    expect(clicks).toHaveLength(3)
    expect(clicks[2]).toMatchObject({
      col: 1,
      hitId: null,
      hitRect: null,
      rect: { x: 148, y: 0, width: 100, height: 36 },
    })
  })

  it('resize 手柄优先于热区；跨热区拖移取消点击；横向滚动后热区命中精确对齐', () => {
    const cursorEl = { style: { cursor: '' } } as unknown as HTMLElement
    const { host, table } = createTable({
      records: records(10),
      frozenColCount: 1,
      hostOptions: { container: cursorEl },
      resolveColHeaderRegions: (_col, size) => [
        { id: 'menu', rect: { x: size.width - 20, y: 6, width: 20, height: 24 } },
      ],
    })
    const clicks: ColHeaderClickEvent[] = []
    table.onColHeaderClick((e) => clicks.push(e))

    // 右缘 resize 手柄（x=248）优先于紧贴右缘的菜单热区
    fireBody(host, 'pointermove', { x: 247, y: 18 })
    expect(cursorEl.style.cursor).toBe('col-resize')
    fireBody(host, 'pointerdown', { x: 247, y: 18, button: 0 })
    fireBody(host, 'pointerup', { x: 247, y: 18, button: 0 })
    expect(clicks).toHaveLength(0)

    // 从按钮热区按下但拖到热区外松开（即便位移在 CLICK_SLOP 内）不误触按钮也不选列
    table.selectCell(0, 0)
    fireBody(host, 'pointerdown', { x: 235, y: 18, button: 0 })
    fireBody(host, 'pointerup', { x: 227, y: 18, button: 0 })
    expect(clicks).toHaveLength(0)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
    ])

    // 横向滚动 150px 后命中滚动列 3（x = 48 + 300 - 150 = 198，按钮 x = 198 + 80 = 278..298）
    table.scrollTo(150, 0)
    fireBody(host, 'pointerdown', { x: 285, y: 18, button: 0 })
    fireBody(host, 'pointerup', { x: 285, y: 18, button: 0 })
    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toMatchObject({
      col: 3,
      hitId: 'menu',
      rect: { x: 198, y: 0, width: 100, height: 36 },
      hitRect: { x: 278, y: 6, width: 20, height: 24 },
    })
  })
})
