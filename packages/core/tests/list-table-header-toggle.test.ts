// 行列头可关闭（P4）：showRowHeader/showColHeader 构造期归一化为零宽/零高后，
// 渲染（关闭侧不建表头节点）、命中、选区（角点全选/表头拖选不触发、表体拖选不回归）、
// resize（关闭侧手柄不可命中、开放侧不回归）、右键落点区域、编辑浮层定位全链路三态覆盖。

import type { SceneEvent, SceneEventType } from '@infinite-table/render'
import { SceneNode } from '@infinite-table/render'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorRegistry } from '../src/editor-registry'
import { ListTable } from '../src/list-table'
import type {
  CellRef,
  DataRecord,
  ListTableOptions,
  TableContextMenuEvent,
} from '../src/types'
import { createFakeDoc, FakeEditorHost } from './testing/fake-editor-dom'
import { StubHost } from './testing/stub-host'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, ...extra })
  host.submitted.length = 0
  return { host, table }
}

/** 绕过 EventSystem 直接在场景根上派发事件（hit-test 已由坐标换算替代） */
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

const records3 = Array.from({ length: 3 }, (_, i) => ({ name: `r${i}` }))
const records100 = Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` }))

describe('ListTable 行列头关闭：构造归一化与渲染', () => {
  it('单关行头：rowHeaderWidth 归一化为 0（显式宽度被忽略），行号列/角点节点不建，列头不受影响', () => {
    const { table } = createTable({ records: records3, showRowHeader: false, rowHeaderWidth: 60 })
    expect(table.rowHeaderWidth).toBe(0)
    expect(table.headerHeight).toBe(36)
    // 内容原点左移到 x=0，数据区占满全宽
    expect(table.getDrawRange()).toEqual({ x: 0, y: 36, width: 800, height: 564 })
    expect(table.rowHeaderNodes.size).toBe(0)
    expect(table.cornerNode).toBeNull()
    // 列头照常装配（场景只建可视窗口：752 宽可见 8 列）
    expect(table.colHeaderNodes.size).toBe(8)
    expect(table.getCellRelativeRect(0, 0)).toEqual({ x: 0, y: 36, width: 100, height: 32 })
  })

  it('单关列头：headerHeight 归一化为 0（显式高度被忽略），列头/角点节点不建，行号列不受影响', () => {
    const { table } = createTable({ records: records3, showColHeader: false, headerHeight: 50 })
    expect(table.headerHeight).toBe(0)
    expect(table.rowHeaderWidth).toBe(48)
    expect(table.getDrawRange()).toEqual({ x: 48, y: 0, width: 752, height: 600 })
    expect(table.colHeaderNodes.size).toBe(0)
    expect(table.cornerNode).toBeNull()
    expect(table.rowHeaderNodes.size).toBe(3)
    expect(table.getCellRelativeRect(0, 0)).toEqual({ x: 48, y: 0, width: 100, height: 32 })
  })

  it('双关：两侧表头节点全不建，内容原点为 (0,0)', () => {
    const { table } = createTable({ records: records3, showRowHeader: false, showColHeader: false })
    expect(table.getDrawRange()).toEqual({ x: 0, y: 0, width: 800, height: 600 })
    expect(table.colHeaderNodes.size).toBe(0)
    expect(table.rowHeaderNodes.size).toBe(0)
    expect(table.cornerNode).toBeNull()
    expect(table.getCellRelativeRect(0, 0)).toEqual({ x: 0, y: 0, width: 100, height: 32 })
  })

  it('等价零宽/零高路径：直接传 rowHeaderWidth: 0 / headerHeight: 0 行为与开关关闭一致', () => {
    const noRow = createTable({ records: records3, rowHeaderWidth: 0 })
    expect(noRow.table.rowHeaderWidth).toBe(0)
    expect(noRow.table.rowHeaderNodes.size).toBe(0)
    expect(noRow.table.cornerNode).toBeNull()
    const noCol = createTable({ records: records3, headerHeight: 0 })
    expect(noCol.table.headerHeight).toBe(0)
    expect(noCol.table.colHeaderNodes.size).toBe(0)
    expect(noCol.table.cornerNode).toBeNull()
  })

  it('缺省 true 保持现状：两侧表头节点照常装配', () => {
    const { table } = createTable({ records: records3 })
    expect(table.rowHeaderWidth).toBe(48)
    expect(table.headerHeight).toBe(36)
    expect(table.colHeaderNodes.size).toBe(8)
    expect(table.rowHeaderNodes.size).toBe(3)
    expect(table.cornerNode).not.toBeNull()
  })

  it('滚动帧增量维护不复活关闭侧表头节点', () => {
    const { table } = createTable({ records: records100, showRowHeader: false, showColHeader: false })
    table.scrollTo(200, 640)
    expect(table.colHeaderNodes.size).toBe(0)
    expect(table.rowHeaderNodes.size).toBe(0)
    expect(table.cornerNode).toBeNull()
  })

  it('关闭行头时冻结列偏移不错位：冻结列贴内容原点，滚动区随滚动平移', () => {
    const { table } = createTable({ records: records100, showRowHeader: false, frozenColCount: 2 })
    table.scrollTo(50, 0)
    // 冻结列 0/1 固定于 x 0/100（无行号列偏移）；滚动列 2/3 起 x=150/250（offsets 200/300 − 50）
    expect(table.getCellRelativeRect(0, 0)).toEqual({ x: 0, y: 36, width: 100, height: 32 })
    expect(table.getCellRelativeRect(1, 0)!.x).toBe(100)
    expect(table.getCellRelativeRect(2, 0)!.x).toBe(150)
    expect(table.getCellRelativeRect(3, 0)!.x).toBe(250)
  })

  it('关闭列头时冻结行偏移不错位：冻结行贴内容原点，滚动区随滚动平移', () => {
    const { table } = createTable({ records: records100, showColHeader: false, frozenRowCount: 1 })
    table.scrollTo(0, 320)
    // 冻结行 0 固定于 y=0（无列头偏移）；行 11（offsets 352 − top 320）起 y=32
    expect(table.getCellRelativeRect(0, 0)!.y).toBe(0)
    expect(table.getCellRelativeRect(0, 11)!.y).toBe(32)
  })
})

describe('ListTable 行列头关闭：命中与选区', () => {
  it('双关：原表头带命中走表体分支，角点全选与表头拖选不触发，表体拖选不回归', () => {
    const { host, table } = createTable({ records: records3, showRowHeader: false, showColHeader: false })
    // 原列头带 (y<36) 命中数据格而非表头
    expect(table.getCellAtRelativePosition(150, 10)).toEqual({ col: 1, row: 0 })
    // 原行号列带 (x<48) 命中数据格
    expect(table.getCellAtRelativePosition(10, 70)).toEqual({ col: 0, row: 2 })
    // 原角点位置按下：单选 (0,0)，不触发全选
    fireBody(host, 'pointerdown', { x: 5, y: 5 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
    ])
    // 拖选走表体语义：跨原列头带的横向拖选扩展为格区间（非整列）
    fireBody(host, 'pointermove', { x: 205, y: 5 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 2, row: 0 } },
    ])
    // 表体拖选不回归：(1,0) 拖到 (3,2) 得连续格区间
    fireBody(host, 'pointerup', { x: 205, y: 5 })
    fireBody(host, 'pointerdown', { x: 101, y: 1 })
    fireBody(host, 'pointermove', { x: 305, y: 65 })
    fireBody(host, 'pointerup', { x: 305, y: 65 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 3, row: 2 } },
    ])
  })

  it('单关行头：原行号列带命中数据格并按表体拖选，开放侧列头（含原角点区）仍整列选择', () => {
    const { host, table } = createTable({ records: records3, showRowHeader: false })
    // 原行号列带 x=10（< 原 48）：命中 (0,0)
    expect(table.getCellAtRelativePosition(10, 37)).toEqual({ col: 0, row: 0 })
    // 原行号列带按下后拖选走表体分支（不再整行）
    fireBody(host, 'pointerdown', { x: 1, y: 37 })
    fireBody(host, 'pointermove', { x: 201, y: 69 })
    fireBody(host, 'pointerup', { x: 201, y: 69 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 2, row: 1 } },
    ])
    // 开放侧列头横贯全宽：原角点位置 (10,10) 现在是列头带 → 整列选择
    fireBody(host, 'pointerdown', { x: 10, y: 10 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 2 } },
    ])
  })

  it('单关列头：原列头带命中数据格并按表体拖选，开放侧行号列仍整行选择', () => {
    const { host, table } = createTable({ records: records3, showColHeader: false })
    // 原列头带 y=10（< 原 36）：命中 (1,0)，不再整列
    expect(table.getCellAtRelativePosition(150, 10)).toEqual({ col: 1, row: 0 })
    fireBody(host, 'pointerdown', { x: 149, y: 8 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 1, row: 0 } },
    ])
    fireBody(host, 'pointermove', { x: 249, y: 40 })
    fireBody(host, 'pointerup', { x: 249, y: 40 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 2, row: 1 } },
    ])
    // 开放侧行号列纵贯全高：y=37（原列头带内）落在行号列带 → 整行选择（行 1：32..64）
    fireBody(host, 'pointerdown', { x: 10, y: 37 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 9, row: 1 } },
    ])
  })
})

describe('ListTable 行列头关闭：contextmenu 落点区域', () => {
  it('双关：原表头带落点区域恒为 body 且命中数据格', () => {
    const { host, table } = createTable({ records: records3, showRowHeader: false, showColHeader: false })
    const seen: Array<{ region: TableContextMenuEvent['region']; cell: CellRef | null }> = []
    table.onContextMenu((event) => seen.push({ region: event.region, cell: event.cell }))
    fireBody(host, 'contextmenu', { x: 150, y: 10 })
    fireBody(host, 'contextmenu', { x: 10, y: 70 })
    expect(seen).toEqual([
      { region: 'body', cell: { col: 1, row: 0 } },
      { region: 'body', cell: { col: 0, row: 2 } },
    ])
  })

  it('单关时开放侧区域字段仍正确：关行头 → 原角点归 col-header；关列头 → 原角点归 row-header', () => {
    const noRow = createTable({ records: records3, showRowHeader: false })
    const seenNoRow: TableContextMenuEvent['region'][] = []
    noRow.table.onContextMenu((event) => seenNoRow.push(event.region))
    fireBody(noRow.host, 'contextmenu', { x: 10, y: 10 })
    fireBody(noRow.host, 'contextmenu', { x: 150, y: 10 })
    expect(seenNoRow).toEqual(['col-header', 'col-header'])

    const noCol = createTable({ records: records3, showColHeader: false })
    const seenNoCol: TableContextMenuEvent['region'][] = []
    noCol.table.onContextMenu((event) => seenNoCol.push(event.region))
    fireBody(noCol.host, 'contextmenu', { x: 10, y: 10 })
    fireBody(noCol.host, 'contextmenu', { x: 10, y: 70 })
    expect(seenNoCol).toEqual(['row-header', 'row-header'])
  })
})

describe('ListTable 行列头关闭：resize 手柄', () => {
  it('关闭列头：列手柄不可命中（含 y=0 退化带边缘），原列头带走表体选择；行手柄不受影响', () => {
    const { host, table } = createTable({ records: records3, showColHeader: false })
    // 原 col 0 右缘 x=148、退化带边缘 y=0：拖拽不产生列宽变更
    fireBody(host, 'pointerdown', { x: 148, y: 0 })
    fireBody(host, 'pointermove', { x: 178, y: 0 })
    fireBody(host, 'pointerup', { x: 178, y: 0 })
    expect(table.getColWidth(0)).toBe(100)
    // 原列头带中部：走表体选择 (1,0)
    fireBody(host, 'pointerdown', { x: 150, y: 10 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 1, row: 0 } },
    ])
    // 行手柄（行号列开放）：行 0 下缘 y=32（原 68 − 列头 36），拖拽改高生效
    fireBody(host, 'pointerup', { x: 150, y: 10 })
    fireBody(host, 'pointerdown', { x: 20, y: 30 })
    fireBody(host, 'pointermove', { x: 20, y: 60 })
    fireBody(host, 'pointerup', { x: 20, y: 60 })
    expect(table.getRowHeight(0)).toBe(62)
  })

  it('关闭行头：行手柄不可命中（含 x=0 退化带边缘），原行号列带走表体选择；列手柄不受影响', () => {
    const { host, table } = createTable({ records: records3, showRowHeader: false })
    // 原 row 0 下缘 y=68、退化带边缘 x=0：拖拽不产生行高变更
    fireBody(host, 'pointerdown', { x: 0, y: 66 })
    fireBody(host, 'pointermove', { x: 0, y: 96 })
    fireBody(host, 'pointerup', { x: 0, y: 96 })
    expect(table.getRowHeight(0)).toBe(32)
    // 原行号列带中部：走表体选择 (0,1)
    fireBody(host, 'pointerdown', { x: 20, y: 70 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 0, row: 1 } },
    ])
    // 列手柄（列头开放）：col 0 右缘 x=100（无行号列偏移），列头带内拖拽改宽生效
    fireBody(host, 'pointerup', { x: 20, y: 70 })
    fireBody(host, 'pointerdown', { x: 100, y: 10 })
    fireBody(host, 'pointermove', { x: 130, y: 10 })
    fireBody(host, 'pointerup', { x: 130, y: 10 })
    expect(table.getColWidth(0)).toBe(130)
  })
})

describe('ListTable 行列头关闭：编辑浮层按新几何定位', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const EDIT_COLUMNS = [{ field: 'name', title: 'Name', editor: 'text' }]

  function createEditingTable(extra: Partial<ListTableOptions> = {}) {
    const host = new StubHost()
    const container = new FakeEditorHost()
    const { doc, created } = createFakeDoc()
    vi.stubGlobal('document', doc)
    const registry = new EditorRegistry()
    registry.registerEditor('text', {})
    const records: DataRecord[] = [{ name: 'Ada' }, { name: 'Bob' }]
    const table = new ListTable({
      ...BASE_OPTIONS,
      columns: EDIT_COLUMNS,
      records,
      host,
      hostOptions: { container: container as unknown as HTMLElement },
      editorRegistry: registry,
      ...extra,
    })
    host.submitted.length = 0
    return { host, container, table, created, records }
  }

  function fireDoubleTap(host: StubHost, x: number, y: number): void {
    fireBody(host, 'pointerdown', { x, y })
    fireBody(host, 'pointerup', { x, y })
    fireBody(host, 'pointerdown', { x, y })
    fireBody(host, 'pointerup', { x, y })
  }

  it('双关：双击 (0,0) 出浮层，定位贴表体原点（无表头偏移），提交链路正常', () => {
    const { host, container, table, created, records } = createEditingTable({
      showRowHeader: false,
      showColHeader: false,
    })
    fireDoubleTap(host, 1, 1)
    expect(table.isEditing()).toBe(true)
    expect(table.editManager.editingCell()).toEqual({ col: 0, row: 0 })
    // 格矩形 (0,0,100,32)，浮层向外扩 1px（2px 边框骑格缘）
    expect(created[0]!.style.left).toBe('-1px')
    expect(created[0]!.style.top).toBe('-1px')
    expect(created[0]!.style.width).toBe('102px')
    expect(created[0]!.style.height).toBe('34px')
    created[0]!.value = 'Ada2'
    created[0]!.dispatchKey('Enter')
    expect(records[0]!.name).toBe('Ada2')
    expect(table.isEditing()).toBe(false)
    expect(container.children).toEqual([])
  })

  it('单关行头：浮层 left 贴 0，top 仍含列头偏移', () => {
    const { host, created } = createEditingTable({ showRowHeader: false })
    fireDoubleTap(host, 1, 37)
    expect(created[0]!.style.left).toBe('-1px')
    expect(created[0]!.style.top).toBe('35px')
  })

  it('单关列头：浮层 top 贴 0，left 仍含行号列偏移', () => {
    const { host, created } = createEditingTable({ showColHeader: false })
    fireDoubleTap(host, 49, 1)
    expect(created[0]!.style.left).toBe('47px')
    expect(created[0]!.style.top).toBe('-1px')
  })
})
