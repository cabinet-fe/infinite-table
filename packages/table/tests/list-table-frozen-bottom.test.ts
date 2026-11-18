import { SceneNode, paintTree, type SceneEvent, type SceneEventType } from '@infinitable/render'
import { describe, expect, it, vi } from 'vitest'

import type { TableEngine } from '../src/engine'
import { ListTable } from '../src/list-table'
import { cellKey } from '../src/list-table-internal'
import type { BottomCellClickEvent, ListTableOptions } from '../src/types'
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

describe('ListTable 底部冻结行：构造/运行时切换与几何视口', () => {
  it('构造与运行时 getFrozenBottomRowCount / setFrozenBottomRowCount 同步视口、maxTop 与 TableEngine', () => {
    const { host, table } = createTable({
      records: records(50),
      frozenBottomRowCount: 1,
    })
    const face: TableEngine = table
    expect(face.getFrozenBottomRowCount()).toBe(1)
    expect(table.frozenBottomRowCount).toBe(1)
    // 视口 800x600，12 列 1200 宽 + 50 行 1600 高 → 两轴均有 10px 滚动条预留
    // viewportHeight = 600 - 36 - 10 = 554，扣除底部冻结行 32 → bodyViewport 高 522
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 742, height: 522 })
    // 滚到底部：最后一行数据底缘刚好贴紧底部冻结行顶缘
    table.scrollTo(0, Number.MAX_SAFE_INTEGER)
    expect(table.getScrollTop()).toBe(50 * 32 - 522)

    const nodeCol0 = table.sceneState.bottomCellNodes.get(cellKey(0, 0))!
    expect(nodeCol0.x).toBe(48)
    expect(nodeCol0.y).toBe(36 + 522)
    expect(nodeCol0.width).toBe(100)
    expect(nodeCol0.height).toBe(32)

    // 运行时变更为 2 行
    host.submitted.length = 0
    face.setFrozenBottomRowCount(2)
    expect(face.getFrozenBottomRowCount()).toBe(2)
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 742, height: 490 })
    expect(table.sceneState.bottomCellNodes.get(cellKey(0, 0))!.y).toBe(36 + 490)
    expect(table.sceneState.bottomCellNodes.get(cellKey(0, 1))!.y).toBe(36 + 490 + 32)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })

    // 异常值钳制，运行时关闭为 0
    face.setFrozenBottomRowCount(-5)
    expect(face.getFrozenBottomRowCount()).toBe(0)
    expect(table.sceneState.bottomCellNodes.size).toBe(0)
    expect(table.sceneState.bottomRowHeaderNodes.size).toBe(0)
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 742, height: 554 })
  })

  it('空数据表（rowCount=0）仍正常渲染底部冻结行并钉固在视口底部', () => {
    const { table } = createTable({
      records: [],
      frozenBottomRowCount: 1,
    })
    expect(table.rowCount).toBe(0)
    // 12 列 1200 宽有横向滚动条预留 10px，纵向不可滚无预留
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 752, height: 522 })
    const bottomNode = table.sceneState.bottomCellNodes.get(cellKey(0, 0))!
    expect(bottomNode.y).toBe(36 + 522)
    const bottomHeader = table.sceneState.bottomRowHeaderNodes.get(0)!
    expect(bottomHeader).toMatchObject({ x: 0, y: 36 + 522, width: 48, height: 32 })
  })

  it('底部冻结行占用视口高度触发竖向滚动条预留与滚动边界', () => {
    // 视口 600 - 36 = 564，17 行数据高 544 <= 564，本无需竖滚；加上 32px 底部冻结行后仅余 532 < 544，需竖向滚动
    const withoutBottom = createTable({
      records: records(17),
      columns: Array.from({ length: 4 }, (_, i) => ({ field: 'name', title: `C${i}` })),
    }).table
    expect(withoutBottom.scrollbarGutterWidth).toBe(0)

    const withBottom = createTable({
      records: records(17),
      columns: Array.from({ length: 4 }, (_, i) => ({ field: 'name', title: `C${i}` })),
      frozenBottomRowCount: 1,
    }).table
    expect(withBottom.scrollbarGutterWidth).toBe(10)
    expect(withBottom.scroll.maxTop).toBe(17 * 32 - (564 - 32))
  })
})

describe('ListTable 底部冻结行：滚动同步、列宽、冻结列与裁剪', () => {
  it('纵向滚动时不移动也不失效底部冻结带；横向滚动像素级同步并维护左侧冻结列', () => {
    const { host, table } = createTable({
      records: records(50),
      frozenColCount: 1,
      frozenBottomRowCount: 1,
    })
    const groups = table.sceneState.groups!
    expect(
      groups.bottomFrozenColsGroup.children.some(
        (n) => n === table.sceneState.bottomCellNodes.get(cellKey(0, 0)),
      ),
    ).toBe(true)
    expect(
      groups.bottomScrollableGroup.children.some(
        (n) => n === table.sceneState.bottomCellNodes.get(cellKey(1, 0)),
      ),
    ).toBe(true)

    // 纵向滚动：底部行 y 不变，band 失效止于底部冻结带顶缘
    host.submitted.length = 0
    table.scrollTo(0, 200)
    expect(table.sceneState.bottomCellNodes.get(cellKey(0, 0))!.y).toBe(558)
    expect(table.sceneState.bottomCellNodes.get(cellKey(1, 0))!.y).toBe(558)
    expect(host.submitted).toContainEqual({
      kind: 'body',
      inv: { type: 'band', region: { x: 0, y: 36, width: 800, height: 522 } },
    })

    // 横向滚动 250px：冻结列 0 保持 x=48，滚动列 1 移出窗口，滚入列 9（col 10 仍在右缘外）
    table.scrollTo(250, 200)
    expect(table.sceneState.bottomCellNodes.get(cellKey(0, 0))!.x).toBe(48)
    expect(table.sceneState.bottomCellNodes.get(cellKey(1, 0))).toBeUndefined()
    const col3 = table.sceneState.bottomCellNodes.get(cellKey(3, 0))!
    expect(col3.x).toBe(48 + 300 - 250)
    const col9 = table.sceneState.bottomCellNodes.get(cellKey(9, 0))!
    expect(col9.x).toBe(48 + 900 - 250)
    expect(table.sceneState.bottomCellNodes.get(cellKey(10, 0))).toBeUndefined()

    // 继续横向滚动 300px：col 10 滚入并同步 x
    table.scrollTo(300, 200)
    const col10 = table.sceneState.bottomCellNodes.get(cellKey(10, 0))!
    expect(col10.x).toBe(48 + 1000 - 300)

    // 运行时改列宽与冻结列数：底部冻结格像素级同步
    table.setColWidth(0, 140)
    table.setFrozenColCount(2)
    expect(table.sceneState.bottomCellNodes.get(cellKey(0, 0))!.width).toBe(140)
    expect(table.sceneState.bottomCellNodes.get(cellKey(1, 0))!.x).toBe(48 + 140)
    // frozenColsWidth=240 + scrollLeft=300 → 滚动区从内容 x=540（col 5 左缘）起可见
    expect(table.sceneState.bottomCellNodes.get(cellKey(5, 0))!.x).toBe(48 + 540 - 300)
    expect(table.sceneState.bottomCellNodes.get(cellKey(6, 0))!.x).toBe(48 + 640 - 300)
  })

  it('开启底部冻结行时数据带组在 paintTree 期间裁剪到 bodyViewport，避免越界盖入底部冻结带', () => {
    const { host, table } = createTable({
      records: records(50),
      frozenBottomRowCount: 1,
    })
    const groups = table.sceneState.groups!
    expect(groups.scrollableGroup.clipRect).toEqual({ x: 0, y: 36, width: 800, height: 522 })
    expect(groups.bottomFrozenGroup.clipRect).toEqual({ x: 0, y: 36, width: 800, height: 554 })

    const ctx = new RecordingContext()
    paintTree(host.layers.get('body')!.root, ctx)
    expect(ctx.calls.some((c) => c.name === 'rect' && c.args[1] === 36 && c.args[3] === 522)).toBe(
      true,
    )
  })
})

describe('ListTable 底部冻结行：样式/渲染扩展缝、局部刷新与点击事件', () => {
  it('resolveBottomCellStyle / resolveBottomCellRenderer / refreshBottomCell / refreshBottomRow', () => {
    let summaryText = '合计 100'
    let headerCount = '共 3 条'
    let bgColor = '#eef2ff'
    const drawCalls: Array<{ col: number; row: number; text: string }> = []

    const { host, table } = createTable({
      records: records(3),
      frozenBottomRowCount: 1,
      resolveBottomCellStyle: (col, row) =>
        col === 1 && row === 0 ? { background: bgColor, color: '#1d4ed8', fontWeight: 600 } : null,
      resolveBottomCellRenderer: (col, _row) => {
        if (col !== 1) return null
        return (target) => {
          drawCalls.push({ col: target.col, row: target.row, text: summaryText })
        }
      },
      resolveBottomRowHeaderStyle: () => ({ color: '#4e5969' }),
      resolveBottomRowHeaderRenderer: () => (target) => {
        drawCalls.push({ col: target.col, row: target.row, text: headerCount })
      },
    })

    const ctx = new RecordingContext()
    paintTree(host.layers.get('body')!.root, ctx)
    expect(drawCalls).toContainEqual({ col: 1, row: 0, text: '合计 100' })
    expect(drawCalls).toContainEqual({ col: -1, row: 0, text: '共 3 条' })
    expect(table.sceneState.bottomCellNodes.get(cellKey(1, 0))!.style).toMatchObject({
      background: '#eef2ff',
      color: '#1d4ed8',
      fontWeight: 600,
    })

    // 局部刷新单格（col=1）
    host.submitted.length = 0
    drawCalls.length = 0
    summaryText = '合计 250'
    bgColor = '#dcfce7'
    table.refreshBottomCell(1, 0)
    expect(table.sceneState.bottomCellNodes.get(cellKey(1, 0))!.style.background).toBe('#dcfce7')
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'region', region: { x: 148, y: 558, width: 100, height: 32 } } },
    ])

    // 局部刷新底部行头格（col=-1）与整行
    host.submitted.length = 0
    headerCount = '共 5 条'
    table.refreshBottomCell(-1, 0)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'region', region: { x: 0, y: 558, width: 48, height: 32 } } },
    ])

    host.submitted.length = 0
    table.refreshBottomRow(0)
    expect(host.submitted).toHaveLength(1)
    expect(host.submitted[0]!.inv.type).toBe('region')

    // 窗外安全跳过
    host.submitted.length = 0
    table.refreshBottomCell(11, 0)
    table.refreshBottomCell(0, 3)
    expect(host.submitted).toEqual([])
  })

  it('onBottomCellClick 携带 col/row/rect，且隔离表体选中与编辑', () => {
    const { host, table } = createTable({
      records: records(50),
      frozenBottomRowCount: 1,
    })
    const clicks: BottomCellClickEvent[] = []
    const off = table.onBottomCellClick((e) => clicks.push(e))
    const editSpy = vi.fn<() => void>()
    table.onEditStart(editSpy)

    // 先选中一个表体格
    table.selectCell(0, 0)

    // 点击底部冻结行第 2 列（x = 48 + 200 + 20 = 268, y = 558 + 16 = 574）
    fireBody(host, 'pointerdown', { x: 268, y: 574, button: 0 })
    fireBody(host, 'pointerup', { x: 270, y: 575, button: 0 })

    expect(clicks).toHaveLength(1)
    expect(clicks[0]).toMatchObject({
      col: 2,
      row: 0,
      rect: { x: 248, y: 558, width: 100, height: 32 },
      x: 270,
      y: 575,
    })
    expect(table.getBottomCellRelativeRect(2, 0)).toEqual({
      x: 248,
      y: 558,
      width: 100,
      height: 32,
    })
    // 原选区未被底部点击破坏，也未命中底部下方的表体格
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 0 }, end: { col: 0, row: 0 } },
    ])
    expect(table.getCellAtRelativePosition(268, 574)).toBeNull()

    // 双击底部冻结格不会进入表体编辑
    fireBody(host, 'pointerdown', { x: 268, y: 574, button: 0 })
    fireBody(host, 'pointerup', { x: 268, y: 574, button: 0 })
    expect(editSpy).not.toHaveBeenCalled()
    expect(clicks).toHaveLength(2)

    // 拖拽超过 CLICK_SLOP、右键、点击底部行头、点击表体均不触发
    fireBody(host, 'pointerdown', { x: 268, y: 574, button: 0 })
    fireBody(host, 'pointerup', { x: 290, y: 574, button: 0 })
    fireBody(host, 'pointerdown', { x: 268, y: 574, button: 2 })
    fireBody(host, 'pointerup', { x: 268, y: 574, button: 2 })
    fireBody(host, 'pointerdown', { x: 20, y: 574, button: 0 })
    fireBody(host, 'pointerup', { x: 20, y: 574, button: 0 })
    fireBody(host, 'pointerdown', { x: 268, y: 100, button: 0 })
    fireBody(host, 'pointerup', { x: 268, y: 100, button: 0 })
    expect(clicks).toHaveLength(2)

    off()
    fireBody(host, 'pointerdown', { x: 268, y: 574, button: 0 })
    fireBody(host, 'pointerup', { x: 268, y: 574, button: 0 })
    expect(clicks).toHaveLength(2)
  })
})
