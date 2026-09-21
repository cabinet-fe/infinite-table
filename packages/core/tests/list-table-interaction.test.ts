import { SceneNode } from '@infinite-table/render'
import type { SceneEvent, SceneEventType } from '@infinite-table/render'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorRegistry } from '../src/editor-registry'
import type { FillDragEndEvent, FillHandleDoubleClickEvent } from '../src/fill-handle'
import { ListTable } from '../src/list-table'
import type { SelectionSnapshot } from '../src/selection'
import { createFakeDoc, FakeEditorHost } from './testing/fake-editor-dom'
import { findCellNode } from './testing/find-cell-node'
import { StubHost } from './testing/stub-host'
import type { CellChangeEvent, DataRecord, ListTableOptions, TableModel } from '../src/types'

/** 在 body 场景树中按坐标找节点（递归：表头节点在表头容器内） */
function findNode(host: StubHost, col: number, row: number) {
  const body = host.layers.get('body')
  return body ? findCellNode(body.root, col, row) : undefined
}

/** 同步 echo 的假模型：setCellValue 内同步发变更事件 */
class EchoModel implements TableModel {
  readonly data = new Map<string, unknown>()
  private readonly listeners = new Set<(change: CellChangeEvent) => void>()

  constructor(readonly rowCount: number) {}

  getCellValue(col: number, row: number): unknown {
    return this.data.get(`${col}:${row}`)
  }

  setCellValue(col: number, row: number, value: unknown): void {
    const oldValue = this.data.get(`${col}:${row}`)
    this.data.set(`${col}:${row}`, value)
    this.emit({ col, row, oldValue, newValue: value })
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(change: CellChangeEvent): void {
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}

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

function fireSky(host: StubHost, type: SceneEventType, init: Partial<SceneEvent>): void {
  fire(host.layers.get('sky')!.root, type, init)
}

// 数据格 (col, row) 的视口坐标（默认几何：行号列 48、列头 36、列宽 100、行高 32）
const cellX = (col: number) => 48 + col * 100 + 1
const cellY = (row: number) => 36 + row * 32 + 1

describe('ListTable 选区', () => {
  it('selectCell/selectRow/selectCol/selectAll/clearSelection 驱动选区与 sky 浮层失效', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    const sky = host.layers.get('sky')
    // 浮层节点挂在 sky 根上
    expect(sky?.root.children).toHaveLength(1)

    table.selectCell(1, 0)
    expect(table.getSelection().focus).toEqual({ col: 1, row: 0 })
    expect(host.submitted).toContainEqual({ kind: 'sky', inv: { type: 'full' } })

    host.submitted.length = 0
    table.selectRow(0)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 9, row: 0 } },
    ])
    table.selectCol(1)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 1, row: 0 } },
    ])

    table.clearSelection()
    expect(table.getSelection().ranges).toEqual([])
    // 清空后再发一次 sky 失效把旧选区擦掉
    expect(host.submitted).toContainEqual({ kind: 'sky', inv: { type: 'full' } })
  })

  it('指针拖选：数据格 pointerdown/move/up 产出选区，行列头与左上角分别整列/整行/全选', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })

    fireBody(host, 'pointerdown', { x: cellX(1), y: cellY(0) })
    fireBody(host, 'pointermove', { x: cellX(3), y: cellY(0) })
    fireBody(host, 'pointerup', { x: cellX(3), y: cellY(0) })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 0 }, end: { col: 3, row: 0 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 3, row: 0 })

    // 列头 → 整列；行号列 → 整行；左上角 → 全选（避开列缘 ±4px 的 resize 手柄区）
    fireBody(host, 'pointerdown', { x: cellX(2) + 50, y: 10 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 2, row: 0 }, end: { col: 2, row: 0 } },
    ])
    fireBody(host, 'pointerdown', { x: 10, y: cellY(0) })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 9, row: 0 } },
    ])
    fireBody(host, 'pointerdown', { x: 10, y: 10 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 9, row: 0 } },
    ])
  })

  it('selectCells 多段选中：快照含多个选区段、sky 浮层同帧失效；getSelectedCellRanges 返回全部段', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    table.selectCells([
      { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      { start: { col: 3, row: 0 }, end: { col: 4, row: 0 } },
    ])
    expect(table.getSelection().ranges).toHaveLength(2)
    // 焦点落在末段焦点格（填充柄挂在焦点段上）
    expect(table.getSelection().focus).toEqual({ col: 4, row: 0 })
    expect(table.getSelectedCellRanges()).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      { start: { col: 3, row: 0 }, end: { col: 4, row: 0 } },
    ])
    expect(host.submitted).toContainEqual({ kind: 'sky', inv: { type: 'full' } })
  })

  it('ctrlMultiSelect 开关两态：开启后 Ctrl/Cmd 点选在既有选区上追加选区段；关闭时点选替换选区', () => {
    const records = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
    const { host, table } = createTable({ records, ctrlMultiSelect: true })
    table.selectCell(0, 0)
    // Ctrl 点选 (2,1)：追加选区段，焦点同步到新段
    fireBody(host, 'pointerdown', { x: cellX(2), y: cellY(1), ctrlKey: true })
    fireBody(host, 'pointerup', { x: cellX(2), y: cellY(1) })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
      { start: { col: 2, row: 1 }, end: { col: 2, row: 1 } },
    ])
    // Cmd 点选 (4,2) 同样追加
    fireBody(host, 'pointerdown', { x: cellX(4), y: cellY(2), metaKey: true })
    fireBody(host, 'pointerup', { x: cellX(4), y: cellY(2) })
    expect(table.getSelection().ranges).toHaveLength(3)

    // 关闭（缺省 false）：Ctrl 点选仍替换选区（现状行为）
    const fallback = createTable({ records })
    fallback.table.selectCell(0, 0)
    fireBody(fallback.host, 'pointerdown', { x: cellX(2), y: cellY(1), ctrlKey: true })
    fireBody(fallback.host, 'pointerup', { x: cellX(2), y: cellY(1) })
    expect(fallback.table.getSelection().ranges).toEqual([
      { start: { col: 2, row: 1 }, end: { col: 2, row: 1 } },
    ])
  })

  it('hover：指针移动经 sky 浮层提交失效，移出数据区清除', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    fireBody(host, 'pointermove', { x: cellX(1), y: cellY(0) })
    expect(host.submitted).toContainEqual({ kind: 'sky', inv: { type: 'full' } })

    // 原地不动不重复提交；移到列头（非数据区）清除 hover 再提交一次擦掉
    host.submitted.length = 0
    fireBody(host, 'pointermove', { x: cellX(1), y: cellY(0) })
    expect(host.submitted).toEqual([])
    fireBody(host, 'pointermove', { x: cellX(1), y: 10 })
    expect(host.submitted).toContainEqual({ kind: 'sky', inv: { type: 'full' } })
    expect(table.getSelection().ranges).toEqual([])
  })

  it('外部模型订阅选区变更并回写：不回环，只广播一次', () => {
    const { table } = createTable({ records: [{ name: 'a' }] })
    let broadcasts = 0
    table.onSelectionChange((snapshot: SelectionSnapshot) => {
      broadcasts++
      table.applyExternalSelection(snapshot)
    })
    table.selectCell(1, 0)
    expect(broadcasts).toBe(1)
    expect(table.getSelection().focus).toEqual({ col: 1, row: 0 })
  })
})

describe('ListTable 键盘导航', () => {
  it('方向键移动活动格并滚动跟随；shift+方向键扩展选区且焦点同步；Tab 右移', () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({ name: `r${i}` }))
    const { host, table } = createTable({ records })
    table.selectCell(0, 0)

    fireSky(host, 'keydown', { key: 'ArrowDown' })
    expect(table.getSelection().focus).toEqual({ col: 0, row: 1 })

    fireSky(host, 'keydown', { key: 'ArrowRight', shiftKey: true })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 1, row: 1 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 1, row: 1 })

    fireSky(host, 'keydown', { key: 'Tab' })
    expect(table.getSelection().focus).toEqual({ col: 2, row: 1 })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 2, row: 1 }, end: { col: 2, row: 1 } },
    ])

    // 滚动跟随：活动格部分露出视为不可见，选中即滚到刚好完整可见
    table.selectCell(0, 17)
    // 行 17 下缘 576 超出 564 高视口：top = 17*32 + 32 - 564 = 12
    expect(table.getScrollState().top).toBe(12)
    fireSky(host, 'keydown', { key: 'ArrowDown' })
    // 行 18 完整进入视口：top = 18*32 + 32 - 564 = 44
    expect(table.getSelection().focus).toEqual({ col: 0, row: 18 })
    expect(table.getScrollState().top).toBe(44)
  })
})

describe('ListTable 行列 resize', () => {
  it('setColWidth/setRowHeight 改宽高并全量重建；布局与滚动边界随之更新', () => {
    const records = Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` }))
    const { host, table } = createTable({ records })

    table.setColWidth(0, 150)
    expect(table.getColWidth(0)).toBe(150)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })

    host.submitted.length = 0
    table.setRowHeight(0, 60)
    expect(table.getRowHeight(0)).toBe(60)
    expect(table.getRowHeight(1)).toBe(32)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })
  })

  it('指针拖拽列缘：拖拽期只画指示线（sky），pointerup 一次提交生效', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    // 第 0 列右缘视口 x = 48 + 100 = 148，列头带内
    fireBody(host, 'pointerdown', { x: 148, y: 10 })
    expect(table.getColWidth(0)).toBe(100)

    fireBody(host, 'pointermove', { x: 178, y: 10 })
    // 拖拽中只提交 sky 指示线，body 不重绘、宽度未改
    expect(host.submitted).toEqual([{ kind: 'sky', inv: { type: 'full' } }])
    expect(table.getColWidth(0)).toBe(100)

    fireBody(host, 'pointerup', { x: 178, y: 10 })
    expect(table.getColWidth(0)).toBe(130)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })
  })

  it('拖拽会话成功结束抛 onColResizeEnd/onRowResizeEnd：载荷带索引与最终尺寸，退订后不再触发', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    const colEnds: Array<{ col: number; width: number }> = []
    const rowEnds: Array<{ row: number; height: number }> = []
    const offCol = table.onColResizeEnd((event) => colEnds.push(event))
    const offRow = table.onRowResizeEnd((event) => rowEnds.push(event))

    // 列：第 0 列右缘 148 拖到 178，最终宽 130
    fireBody(host, 'pointerdown', { x: 148, y: 10 })
    fireBody(host, 'pointermove', { x: 178, y: 10 })
    fireBody(host, 'pointerup', { x: 178, y: 10 })
    expect(colEnds).toEqual([{ col: 0, width: 130 }])
    expect(table.getColWidth(0)).toBe(130)
    expect(rowEnds).toEqual([])

    // 行：第 0 行下缘 68（手柄区内取 66）拖到 96，最终高 62
    fireBody(host, 'pointerdown', { x: 20, y: 66 })
    fireBody(host, 'pointermove', { x: 20, y: 96 })
    fireBody(host, 'pointerup', { x: 20, y: 96 })
    expect(rowEnds).toEqual([{ row: 0, height: 62 }])
    expect(table.getRowHeight(0)).toBe(62)

    // 退订后拖拽仍生效，但不再收到事件
    offCol()
    offRow()
    // 列 0 新右缘 48 + 130 = 178
    fireBody(host, 'pointerdown', { x: 178, y: 10 })
    fireBody(host, 'pointerup', { x: 208, y: 10 })
    expect(table.getColWidth(0)).toBe(160)
    expect(colEnds).toEqual([{ col: 0, width: 130 }])
    expect(rowEnds).toEqual([{ row: 0, height: 62 }])
  })

  it('canResizeRow 返回 false：行手柄禁用，按下落在行号列走整行选择', () => {
    const records = Array.from({ length: 3 }, (_, i) => ({ name: `r${i}` }))
    const { host, table } = createTable({
      records,
      canResizeRow: () => false,
    })
    // 第 0 行下缘视口 y = 36 + 32 = 68，手柄 ±4px 区内取 y=66（行号列带内）
    fireBody(host, 'pointerdown', { x: 20, y: 66 })
    fireBody(host, 'pointermove', { x: 20, y: 96 })
    fireBody(host, 'pointerup', { x: 20, y: 96 })
    expect(table.getRowHeight(0)).toBe(32)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 9, row: 0 } },
    ])
  })
})

describe('ListTable 批量更新', () => {
  it('batchUpdate 内多次变更只提交一次 band 失效（区域为各格包围盒的并集）', () => {
    const model = new EchoModel(100)
    const { host, table } = createTable({ model })

    table.batchUpdate(() => {
      table.updateCell(0, 0, 'a')
      table.updateCell(1, 0, 'b')
      table.updateCell(0, 1, 'c')
    })
    expect(table.getCellText(0, 0)).toBe('a')
    // 各格失效区并入各自溢出走廊（批内写入时右邻尚空，走廊到表缘），并集到表缘
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'band', region: { x: 48, y: 36, width: 1000, height: 64 } } },
    ])

    // 批外恢复单格 cell 失效；右邻已有内容，无溢出走廊
    host.submitted.length = 0
    model.emit({ col: 0, row: 0, oldValue: undefined, newValue: undefined })
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 100, height: 32 } } },
    ])
  })

  it('嵌套 batchUpdate 只在最外层结束时提交一次', () => {
    const model = new EchoModel(100)
    const { host, table } = createTable({ model })
    table.batchUpdate(() => {
      table.updateCell(0, 0, 'a')
      table.batchUpdate(() => {
        table.updateCell(1, 0, 'b')
      })
      table.updateCell(2, 0, 'c')
    })
    // 各格失效区（含溢出走廊与来源格重算区）的并集到表缘
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'band', region: { x: 48, y: 36, width: 1000, height: 32 } } },
    ])
  })
})

describe('ListTable contextmenu 与 onScrollFrame', () => {
  it('contextmenu 事件带命中格坐标；行列头处 cell 为 null', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    const seen: Array<{ cell: unknown; x: number; y: number }> = []
    table.onContextMenu((event) => seen.push({ cell: event.cell, x: event.x, y: event.y }))

    fireBody(host, 'contextmenu', { x: cellX(1), y: cellY(0) })
    fireBody(host, 'contextmenu', { x: cellX(1), y: 10 })
    expect(seen).toEqual([
      { cell: { col: 1, row: 0 }, x: cellX(1), y: cellY(0) },
      { cell: null, x: cellX(1), y: 10 },
    ])
  })

  it('有 onContextMenu 监听时阻止默认（原生菜单），无监听时不阻止', () => {
    const preventDefault = vi.fn()
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    fireBody(host, 'contextmenu', { x: cellX(1), y: cellY(0), originalEvent: {} })
    expect(preventDefault).not.toHaveBeenCalled()

    const off = table.onContextMenu(() => {})
    fireBody(host, 'contextmenu', { x: cellX(1), y: cellY(0), originalEvent: { preventDefault } })
    expect(preventDefault).toHaveBeenCalledTimes(1)

    off()
    fireBody(host, 'contextmenu', { x: cellX(1), y: cellY(0), originalEvent: { preventDefault } })
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('onScrollFrame 在滚动帧上带最新位置触发；退订后不再触发', () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({ name: `r${i}` }))
    const { table } = createTable({ records })
    const seen: Array<{ left: number; top: number }> = []
    const off = table.onScrollFrame((state) => seen.push(state))

    table.scrollTo(0, 320)
    expect(seen).toEqual([{ left: 0, top: 320 }])
    table.scrollTo(0, 640)
    expect(seen).toEqual([
      { left: 0, top: 320 },
      { left: 0, top: 640 },
    ])
    off()
    table.scrollTo(0, 960)
    expect(seen).toHaveLength(2)
  })

  it('触控拖拽滚动：touchmove 增量驱动 scrollBy，touchcancel 终止跟踪', () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({ name: `r${i}` }))
    const { host, table } = createTable({ records })

    fireBody(host, 'touchstart', { x: 200, y: 200 })
    fireBody(host, 'touchmove', { x: 200, y: 180 })
    expect(table.getScrollState().top).toBe(20)
    fireBody(host, 'touchmove', { x: 190, y: 180 })
    expect(table.getScrollState()).toEqual({ left: 10, top: 20 })

    // cancel 后后续 move 不再产生滚动
    fireBody(host, 'touchcancel', {})
    fireBody(host, 'touchmove', { x: 190, y: 100 })
    expect(table.getScrollState()).toEqual({ left: 10, top: 20 })
  })
})

// ---- 编辑（P2）：ListTable 集成（假容器 + 假文档，node 环境无真实 DOM） ----

describe('ListTable 编辑', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const EDIT_COLUMNS = [
    { field: 'name', title: 'Name', editor: 'text' },
    { field: 'age', title: 'Age', editor: 'text' },
    { title: 'Note' },
  ]

  function createEditingTable(extra: Partial<ListTableOptions> = {}) {
    const host = new StubHost()
    const container = new FakeEditorHost()
    const { doc, created } = createFakeDoc()
    vi.stubGlobal('document', doc)
    const registry = new EditorRegistry()
    registry.registerEditor('text', {})
    const records: DataRecord[] = [
      { name: 'Ada', age: '36' },
      { name: 'Bob', age: '25' },
    ]
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

  function fireDoubleTap(host: StubHost, col: number, row: number): void {
    const x = cellX(col)
    const y = cellY(row)
    fireBody(host, 'pointerdown', { x, y })
    fireBody(host, 'pointerup', { x, y })
    fireBody(host, 'pointerdown', { x, y })
    fireBody(host, 'pointerup', { x, y })
  }

  it('双击可编格出浮层：初值为基础值（未过 resolveDisplayValue），定位含行号列/列头偏移', () => {
    const { host, container, table, created } = createEditingTable({
      resolveDisplayValue: () => 'DISPLAY',
    })
    fireDoubleTap(host, 0, 0)
    expect(table.isEditing()).toBe(true)
    const element = created[0]!
    expect(container.children).toEqual([element])
    expect(element.value).toBe('Ada')
    // 视口矩形：x = 行号列 48，y = 列头 36，宽高 = 列宽 100 / 行高 32；
    // 定位向外扩 1px（2px 边框骑格缘，内外各半）
    expect(element.style.left).toBe('47px')
    expect(element.style.top).toBe('35px')
    expect(element.style.width).toBe('102px')
    expect(element.style.height).toBe('34px')
  })

  it('双击不可编格（列未声明 editor）无浮层；双击列头/行头也不进编辑', () => {
    const { host, container, table } = createEditingTable()
    // 第 2 列无 editor 且无路由命中
    fireDoubleTap(host, 2, 0)
    expect(table.isEditing()).toBe(false)
    expect(container.children).toEqual([])
    // 列头带（y < headerHeight）与行号列带（x < rowHeaderWidth）不进编辑
    fireBody(host, 'pointerdown', { x: cellX(0), y: 10 })
    fireBody(host, 'pointerup', { x: cellX(0), y: 10 })
    fireBody(host, 'pointerdown', { x: cellX(0), y: 10 })
    fireBody(host, 'pointerup', { x: cellX(0), y: 10 })
    fireBody(host, 'pointerdown', { x: 10, y: cellY(0) })
    fireBody(host, 'pointerup', { x: 10, y: cellY(0) })
    fireBody(host, 'pointerdown', { x: 10, y: cellY(0) })
    fireBody(host, 'pointerup', { x: 10, y: cellY(0) })
    expect(table.isEditing()).toBe(false)
  })

  it('Enter 提交并选区下移：records 行对象回写、cell 级失效、onCellChange 带 oldValue/newValue', () => {
    const { host, table, created, records } = createEditingTable()
    const changes: CellChangeEvent[] = []
    table.onCellChange((change) => changes.push(change))

    fireDoubleTap(host, 0, 0)
    created[0]!.value = 'Ada2'
    created[0]!.dispatchKey('Enter')

    expect(records[0]!.name).toBe('Ada2')
    expect(table.getSelection().focus).toEqual({ col: 0, row: 1 })
    expect(changes).toEqual([{ col: 0, row: 0, oldValue: 'Ada', newValue: 'Ada2' }])
    // 提交只产生该格 cell 失效（非 full 重绘）
    expect(host.submitted).toContainEqual({
      kind: 'body',
      inv: { type: 'cell', region: { x: 48, y: 36, width: 100, height: 32 } },
    })
    expect(table.isEditing()).toBe(false)
  })

  it('editCellOnEnter 开启：非编辑态按 Enter 进入焦点格编辑，编辑器内 Enter 提交并下移', () => {
    const { host, table, created, records } = createEditingTable({ editCellOnEnter: true })
    table.selectCell(0, 0)
    fireSky(host, 'keydown', { key: 'Enter' })
    expect(table.isEditing()).toBe(true)
    expect(created[0]!.value).toBe('Ada')

    created[0]!.value = 'Ada2'
    created[0]!.dispatchKey('Enter')
    expect(records[0]!.name).toBe('Ada2')
    expect(table.getSelection().focus).toEqual({ col: 0, row: 1 })
    expect(table.isEditing()).toBe(false)
  })

  it('editCellOnEnter 关闭（缺省）：非编辑态按 Enter 保持现状不进编辑', () => {
    const { host, table } = createEditingTable()
    table.selectCell(0, 0)
    fireSky(host, 'keydown', { key: 'Enter' })
    expect(table.isEditing()).toBe(false)
    expect(table.getSelection().focus).toEqual({ col: 0, row: 0 })
  })

  it('Tab 提交并选区右移；Esc 取消不回写不抛事件且焦点交还容器', () => {
    const { host, container, table, created, records } = createEditingTable()
    const changes: CellChangeEvent[] = []
    table.onCellChange((change) => changes.push(change))

    fireDoubleTap(host, 0, 0)
    created[0]!.value = 'Ada2'
    created[0]!.dispatchKey('Tab')
    expect(records[0]!.name).toBe('Ada2')
    expect(table.getSelection().focus).toEqual({ col: 1, row: 0 })
    expect(changes).toHaveLength(1)

    fireDoubleTap(host, 0, 0)
    created[1]!.value = 'ZZZ'
    created[1]!.dispatchKey('Escape')
    expect(records[0]!.name).toBe('Ada2')
    expect(changes).toHaveLength(1)
    expect(table.isEditing()).toBe(false)
    expect(container.children).toEqual([])
    expect(container.focusCalls).toBeGreaterThan(0)
  })

  it('API：startEdit 可编 true/不可编 false；重复 startEdit 幂等；commitEdit/cancelEdit 一致', () => {
    const { table, container, records } = createEditingTable({
      resolveEditable: (col) => col === 0,
    })
    expect(table.startEdit(1, 0)).toBe(false)
    expect(table.isEditing()).toBe(false)

    expect(table.startEdit(0, 0)).toBe(true)
    expect(table.startEdit(0, 0)).toBe(true)
    expect(container.children).toHaveLength(1)
    table.cancelEdit()
    expect(records[0]!.name).toBe('Ada')

    expect(table.startEdit(0, 0)).toBe(true)
    const element = container.children[0]!
    element.value = 'Ada2'
    expect(table.commitEdit()).toBe(true)
    expect(records[0]!.name).toBe('Ada2')
    expect(table.commitEdit()).toBe(false)
    expect(table.cancelEdit()).toBeUndefined()
  })

  it('API：无回写目标的格（列无 field 且非 model 形态）startEdit 返回 false', () => {
    const { table } = createEditingTable({
      columns: [
        { field: 'name', title: 'Name', editor: 'text' },
        { title: 'NoField', editor: 'text' },
      ],
    })
    expect(table.startEdit(1, 0)).toBe(false)
    expect(table.startEdit(0, 0)).toBe(true)
  })

  it('API：远格 startEdit 滚动跟随，浮层按视口矩形定位（含表头偏移）', () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({
      name: `r${i}`,
      age: String(i),
    }))
    const { table, created } = createEditingTable({ records })
    expect(table.startEdit(0, 30)).toBe(true)
    // 行 30 完整进入视口：top = 30*32 + 32 - 564 = 428
    expect(table.getScrollState().top).toBe(428)
    // y = 行 30 内容偏移 960 - 428 + 列头 36 = 568；骑格缘偏移 -1 → 567
    expect(created[0]!.style.top).toBe('567px')
  })

  it('model 形态经 ModelBinding 回写（echo 不回环，只一次本格刷新）', () => {
    const model = new EchoModel(10)
    model.data.set('0:0', 'Ada')
    const { host, container, created } = createEditingTable({ model, records: undefined })

    fireDoubleTap(host, 0, 0)
    created[0]!.value = 'Zed'
    created[0]!.dispatchKey('Enter')

    expect(model.data.get('0:0')).toBe('Zed')
    expect(container.children).toEqual([])
    // 编辑提交只产生一次本格 cell 失效：模型 echo 被 ModelBinding 吞掉，无回环二次刷新
    expect(host.submitted.filter((s) => s.kind === 'body' && s.inv.type === 'cell')).toHaveLength(1)
  })

  it('model 形态 onCellChange 事件带 oldValue/newValue', () => {
    const model = new EchoModel(10)
    model.data.set('0:0', 'Ada')
    const { host, created, table } = createEditingTable({ model, records: undefined })
    const changes: CellChangeEvent[] = []
    table.onCellChange((change) => changes.push(change))

    fireDoubleTap(host, 0, 0)
    created[0]!.value = 'Zed'
    created[0]!.dispatchKey('Enter')
    expect(changes).toEqual([{ col: 0, row: 0, oldValue: 'Ada', newValue: 'Zed' }])
  })

  it('编辑中点击其它格：先提交当前会话；场景键盘让位给编辑器', () => {
    const { host, table, records, container } = createEditingTable()
    table.startEdit(0, 0)
    container.children[0]!.value = 'Ada2'
    fireBody(host, 'pointerdown', { x: cellX(1), y: cellY(0) })
    expect(records[0]!.name).toBe('Ada2')
    expect(table.isEditing()).toBe(false)

    // 编辑中方向键不再驱动选区导航（Esc/Enter/Tab 由编辑器拦截，其余键让位）
    table.startEdit(0, 0)
    fireSky(host, 'keydown', { key: 'ArrowDown' })
    expect(table.getSelection().focus).toEqual({ col: 0, row: 0 })
  })

  it('destroy 结束编辑会话：浮层摘除', () => {
    const { table, container } = createEditingTable()
    table.startEdit(0, 0)
    expect(container.children).toHaveLength(1)
    table.destroy()
    expect(container.children).toEqual([])
  })
})

describe('ListTable 填充柄双击', () => {
  // 选区 (0,0)：格矩形 48..148 × 36..68，柄方点骑右下角点 144..148 × 64..68
  const HANDLE = { x: 146, y: 66 }

  it('双击柄：第二次抬起抛双击事件（携带选区段），与拖拽结束互斥且成交后重新计击', () => {
    const { host, table } = createTable({ records: [{ name: 'a' }] })
    table.selectCell(0, 0)
    const dragEnds: FillDragEndEvent[] = []
    const doubleClicks: FillHandleDoubleClickEvent[] = []
    table.onFillDragEnd((event) => dragEnds.push(event))
    table.onFillHandleDoubleClick((event) => doubleClicks.push(event))

    const tap = (): void => {
      fireBody(host, 'pointerdown', HANDLE)
      fireBody(host, 'pointerup', HANDLE)
    }
    tap() // 单击：抛拖拽结束（无扩展的空点按）
    expect(dragEnds).toHaveLength(1)
    expect(doubleClicks).toHaveLength(0)

    tap() // 连击窗口内第二击：抛双击，不再抛拖拽结束
    expect(doubleClicks).toHaveLength(1)
    expect(doubleClicks[0]!.range).toEqual({
      start: { col: 0, row: 0 },
      end: { col: 0, row: 0 },
    })
    expect(dragEnds).toHaveLength(1)

    tap() // 双击成交后计击清零：第三击回到单击语义
    expect(dragEnds).toHaveLength(2)
    expect(doubleClicks).toHaveLength(1)
  })

  it('第二击拖出扩展区：按拖拽处理，双击被吃掉', () => {
    const { host, table } = createTable({
      records: Array.from({ length: 10 }, (_, i) => ({ name: `r${i}` })),
    })
    table.selectCell(0, 0)
    const dragEnds: FillDragEndEvent[] = []
    const doubleClicks: FillHandleDoubleClickEvent[] = []
    table.onFillDragEnd((event) => dragEnds.push(event))
    table.onFillHandleDoubleClick((event) => doubleClicks.push(event))

    fireBody(host, 'pointerdown', HANDLE)
    fireBody(host, 'pointerup', HANDLE)
    fireBody(host, 'pointerdown', HANDLE)
    fireBody(host, 'pointermove', { x: cellX(0), y: cellY(3) })
    fireBody(host, 'pointerup', { x: cellX(0), y: cellY(3) })

    expect(doubleClicks).toHaveLength(0)
    expect(dragEnds).toHaveLength(2)
    expect(dragEnds[1]!.target).toEqual({ minCol: 0, minRow: 0, maxCol: 0, maxRow: 3 })
  })
})

describe('ListTable 表头高亮', () => {
  const records20 = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}` }))

  /** body 层失效条带是否完全落在给定条带内（表头高亮只允许表头条带 band） */
  function bandsWithinStrip(
    host: StubHost,
    inside: (region: { x: number; y: number; width: number; height: number }) => boolean,
  ): boolean {
    const bands = host.submitted.filter(
      (entry) => entry.kind === 'body' && entry.inv.type === 'band',
    )
    return (
      bands.length > 0 &&
      bands.every((entry) => 'region' in entry.inv && inside(entry.inv.region as never))
    )
  }

  it('selectRow 高亮对应行号格并只失效行号列条带；部分格选区不触发表头高亮', () => {
    const { host, table } = createTable({ records: records20 })
    // 部分格选区：不高亮任何表头
    table.selectCell(1, 1)
    expect(findNode(host, -1, 1)?.style.background).toBe('#f5f6f7')
    expect(findNode(host, 1, -1)?.style.background).toBe('#f5f6f7')

    // 整行选区：对应行号格高亮，列头不受影响
    host.submitted.length = 0
    table.selectRow(2)
    expect(findNode(host, -1, 2)?.style.background).toBe('rgba(46, 106, 219, 0.18)')
    expect(findNode(host, -1, 3)?.style.background).toBe('#f5f6f7')
    expect(findNode(host, 2, -1)?.style.background).toBe('#f5f6f7')
    // 失效只登记行号列条带 band（x+width ≤ 行号列宽 48），无 body full
    expect(host.submitted.some((e) => e.kind === 'body' && e.inv.type === 'full')).toBe(false)
    expect(bandsWithinStrip(host, (r) => r.x + r.width <= 48 && r.y >= 36)).toBe(true)
  })

  it('selectCol 高亮对应列头并只失效列头条带；清除选区恢复普通表头样式', () => {
    const { host, table } = createTable({ records: records20 })
    table.selectCol(3)
    expect(findNode(host, 3, -1)?.style.background).toBe('rgba(46, 106, 219, 0.18)')
    expect(findNode(host, 4, -1)?.style.background).toBe('#f5f6f7')
    expect(findNode(host, -1, 0)?.style.background).toBe('#f5f6f7')
    expect(host.submitted.some((e) => e.kind === 'body' && e.inv.type === 'full')).toBe(false)
    expect(bandsWithinStrip(host, (r) => r.y + r.height <= 36 && r.x >= 48)).toBe(true)

    // 清除选区：行号列/列头恢复默认背景
    host.submitted.length = 0
    table.clearSelection()
    expect(findNode(host, 3, -1)?.style.background).toBe('#f5f6f7')
    expect(findNode(host, -1, 0)?.style.background).toBe('#f5f6f7')
    expect(host.submitted.some((e) => e.kind === 'body' && e.inv.type === 'full')).toBe(false)
  })

  it('hover 变更经同一刷新路径但不触发表头重涂（签名守卫）', () => {
    const { host, table } = createTable({ records: records20 })
    table.selectRow(2)
    host.submitted.length = 0
    table.hoverState.set(0, 0)
    expect(host.submitted.some((e) => e.kind === 'body')).toBe(false)
  })
})

describe('ListTable 合并格命中', () => {
  const mergeRecords = Array.from({ length: 20 }, (_, i) => ({ name: `r${i}` }))

  it('点击合并区覆盖格：选区即整块合并区、焦点为主格；命中查询路由主格', () => {
    const { host, table } = createTable({
      records: mergeRecords,
      mergeCells: [{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }],
    })
    // 点击覆盖格 (2,2)
    fireBody(host, 'pointerdown', { x: cellX(2), y: cellY(2) })
    fireBody(host, 'pointerup', { x: cellX(2), y: cellY(2) })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 1 }, end: { col: 2, row: 2 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 1, row: 1 })
    expect(table.getCellAtRelativePosition(cellX(2), cellY(2))).toEqual({ col: 1, row: 1 })
  })

  it('从合并区拖出到普通格：扩展段为合并包围盒与目标格的并（不丢合并列/行）', () => {
    const { host, table } = createTable({
      records: mergeRecords,
      mergeCells: [{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }],
    })
    fireBody(host, 'pointerdown', { x: cellX(2), y: cellY(2) })
    fireBody(host, 'pointermove', { x: cellX(4), y: cellY(3) })
    fireBody(host, 'pointerup', { x: cellX(4), y: cellY(3) })
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 1 }, end: { col: 4, row: 3 } },
    ])
  })
})

describe('ListTable 合并格编辑', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('双击合并区覆盖格：编辑主格（初值取主格），浮层矩形跨满合并区', () => {
    const host = new StubHost()
    const container = new FakeEditorHost()
    const { doc, created } = createFakeDoc()
    vi.stubGlobal('document', doc)
    const registry = new EditorRegistry()
    registry.registerEditor('text', {})
    const table = new ListTable({
      ...BASE_OPTIONS,
      columns: [
        { field: 'name', title: 'Name', editor: 'text' },
        { field: 'age', title: 'Age', editor: 'text' },
      ],
      records: [
        { name: 'Ada', age: '36' },
        { name: 'Bob', age: '25' },
      ],
      host,
      hostOptions: { container: container as unknown as HTMLElement },
      editorRegistry: registry,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 1 }],
    })
    // 双击覆盖格 (1,1)
    fireBody(host, 'pointerdown', { x: cellX(1), y: cellY(1) })
    fireBody(host, 'pointerup', { x: cellX(1), y: cellY(1) })
    fireBody(host, 'pointerdown', { x: cellX(1), y: cellY(1) })
    fireBody(host, 'pointerup', { x: cellX(1), y: cellY(1) })
    expect(table.isEditing()).toBe(true)
    expect(table.editManager.editingCell()).toEqual({ col: 0, row: 0 })
    const element = created[0]!
    expect(element.value).toBe('Ada')
    // 浮层跨满合并区：两列宽 200 / 两行高 64（含 1px 外扩）
    expect(element.style.left).toBe('47px')
    expect(element.style.top).toBe('35px')
    expect(element.style.width).toBe('202px')
    expect(element.style.height).toBe('66px')
  })
})
