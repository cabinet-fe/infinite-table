// 冻结带滚动 z 序契约（增量窗口）：滚入格/滚入行列头挂树尾后仍必须画在冻结带之下。

import type { SceneNode } from '@infinitable/render'
import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import type { ListTableOptions } from '../src/types'
import { findCellNode } from './testing/find-cell-node'
import { RecordingContext } from './testing/recording-context'
import { StubHost } from './testing/stub-host'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, ...extra })
  return { host, table }
}

/** 计算节点在场景树前序绘制次序中的位置 */
function paintOrderIndex(root: SceneNode, target: SceneNode): number {
  let index = 0
  let found = -1
  const visit = (node: SceneNode): void => {
    if (found >= 0) {
      return
    }
    if (node === target) {
      found = index
      return
    }
    index++
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(root)
  return found
}

const records100 = () => Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` }))

describe('ListTable 冻结带滚动 z 序', () => {
  it('上滚滚入行重挂树尾后，数据格仍画在冻结行带之下', () => {
    const { host, table } = createTable({ records: records100(), frozenRowCount: 1 })
    table.scrollTo(0, 96)
    table.scrollTo(0, 31)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 5, 0)
    const entering = findCellNode(root, 5, 1)
    expect(entering).toBeDefined()
    expect(entering!.y).toBe(37)
    expect(frozen).toBeDefined()
    expect(paintOrderIndex(root, frozen!)).toBeGreaterThan(paintOrderIndex(root, entering!))
  })

  it('左滚滚入列重挂树尾后，数据格仍画在冻结列带之下', () => {
    const { host, table } = createTable({ records: records100(), frozenColCount: 1 })
    table.scrollTo(200, 0)
    table.scrollTo(63, 0)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 0, 5)
    const entering = findCellNode(root, 1, 5)
    expect(entering).toBeDefined()
    expect(entering!.x).toBe(85)
    expect(frozen).toBeDefined()
    expect(paintOrderIndex(root, frozen!)).toBeGreaterThan(paintOrderIndex(root, entering!))
  })

  it('滚入行头后仍画在冻结行头之下（列头/角块保持最上）', () => {
    const { host, table } = createTable({ records: records100(), frozenRowCount: 1 })
    table.scrollTo(0, 96)
    table.scrollTo(0, 31)
    const root = host.layers.get('body')!.root
    const headerGroup = table.sceneState.groups!.headerGroup
    const frozenHeader = table.sceneState.rowHeaderNodes.get(0)
    const enteringHeader = table.sceneState.rowHeaderNodes.get(1)
    expect(frozenHeader).toBeDefined()
    expect(enteringHeader).toBeDefined()
    expect(paintOrderIndex(root, frozenHeader!)).toBeGreaterThan(
      paintOrderIndex(root, enteringHeader!),
    )
    expect(headerGroup.children[headerGroup.children.length - 1]).toBe(table.sceneState.cornerNode)
  })

  it('多次往返滚动后冻结带 z 序不劣化（重复滚入仍收口）', () => {
    const { host, table } = createTable({ records: records100(), frozenRowCount: 1 })
    for (let i = 0; i < 3; i++) {
      table.scrollTo(0, 96)
      table.scrollTo(0, 31)
    }
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 5, 0)!
    const entering = findCellNode(root, 5, 1)!
    expect(paintOrderIndex(root, frozen)).toBeGreaterThan(paintOrderIndex(root, entering))
  })
})

describe('ListTable 冻结带滚动 + resize', () => {
  it('滚动后 resize 全量重建、再滚回顶部：冻结带内容与合并主格位置正确', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenRowCount: 1,
      mergeCells: [{ startCol: 1, startRow: 4, endCol: 2, endRow: 5 }],
    })
    table.scrollTo(0, 112)
    table.resize(800, 560)
    const frozenAfterResize = findCellNode(host.layers.get('body')!.root, 0, 0)
    expect(frozenAfterResize).toMatchObject({ y: 36, text: 'r0' })
    const masterAfterResize = findCellNode(host.layers.get('body')!.root, 1, 4)
    expect(masterAfterResize).toMatchObject({ y: 36 + 128 - table.getScrollTop() })
    table.scrollTo(0, 0)
    expect(findCellNode(host.layers.get('body')!.root, 0, 0)).toMatchObject({ y: 36, text: 'r0' })
    expect(findCellNode(host.layers.get('body')!.root, 1, 4)).toMatchObject({ y: 36 + 128 })
  })
})

describe('ListTable 冻结带 + overscan 窗口边界（@infinitable/sheet 缺省 overscan 配置）', () => {
  function createOverscanTable(extra: Partial<ListTableOptions> = {}) {
    return createTable({ overscanRows: 10, overscanCols: 4, frozenRowCount: 1, ...extra })
  }

  it('overscan 扩展不得把冻结行混进滚动带窗口（geometryState.rows 语义）', () => {
    const { table } = createOverscanTable({ records: records100() })
    expect(table.geometryState.rows.start).toBe(1)
    table.scrollTo(0, 224)
    expect(table.geometryState.rows.start).toBe(1)
  })

  it('滚动把窗口行滑到冻结带位置时不盖写冻结行（overscan 下无滚入帧也成立）', () => {
    const { host, table } = createOverscanTable({ records: records100() })
    table.scrollTo(0, 224)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 5, 0)!
    const bandRow = findCellNode(root, 5, 7)!
    expect(bandRow.y).toBe(36)
    expect(paintOrderIndex(root, frozen)).toBeGreaterThan(paintOrderIndex(root, bandRow))
    table.scrollTo(0, 0)
    expect(findCellNode(root, 5, 0)).toBeDefined()
    expect(paintOrderIndex(root, frozen)).toBeGreaterThan(
      paintOrderIndex(root, findCellNode(root, 5, 1)!),
    )
  })

  it('滚动后 resize 全量重建：冻结带格由冻结带趟装配，z 序高于全部滚动带行', () => {
    const { host, table } = createOverscanTable({ records: records100() })
    table.scrollTo(0, 224)
    table.resize(800, 560)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 5, 0)!
    expect(frozen).toMatchObject({ y: 36, text: 'r0' })
    const overlapping = [...table.sceneState.cellNodes.values()].filter(
      (node) => node.row >= 1 && node.y < 68 && node.y + node.height > 36,
    )
    expect(overlapping.length).toBeGreaterThan(0)
    for (const node of overlapping) {
      expect(paintOrderIndex(root, frozen)).toBeGreaterThan(paintOrderIndex(root, node))
    }
  })
})

describe('ListTable 冻结带滚动下选区 / 高亮 / fillPreview 裁剪不消失', () => {
  class SkyRecordingContext extends RecordingContext {
    readonly styledRects: Array<{
      x: number
      y: number
      width: number
      height: number
      fill: unknown
    }> = []

    override fillRect(x: number, y: number, width: number, height: number): void {
      super.fillRect(x, y, width, height)
      this.styledRects.push({ x, y, width, height, fill: this.fillStyle })
    }
  }

  function paintSky(host: StubHost) {
    const sky = host.layers.get('sky')!
    const ctx = new SkyRecordingContext()
    sky.root.children[0]!.paint(ctx)
    return ctx
  }

  it('垂直滚动出首段滚动行后，冻结行选区、跨空隙选区与高亮框不消失，且滚动区不侵占冻结带', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenRowCount: 1,
      frozenColCount: 1,
    })
    // 滚动到 rows=[6,..), cols=[3,..)（1..5 行、1..2 列已滚出）
    table.scrollTo(200, 160)
    const range = table.getVisibleRange()
    expect(range.rows.start).toBeGreaterThanOrEqual(5)
    expect(range.cols.start).toBeGreaterThanOrEqual(2)

    // 1. 纯冻结格 (0,0) 选区：不因 rows.start 远大于 0 或混入空隙而消失
    table.applyExternalSelection({
      ranges: [{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }],
      focus: { col: 0, row: 0 },
    })
    let rects = paintSky(host)
      .callsOf('fillRect')
      .map((c) => c.args)
    expect(rects).toContainEqual([48, 36, 100, 32])

    // 2. 跨冻结带与已滚出空隙的选区 (0,0)~(0,2)：冻结部分 (0,0) 仍保持绘制
    table.applyExternalSelection({
      ranges: [{ start: { col: 0, row: 0 }, end: { col: 0, row: 2 } }],
      focus: { col: 0, row: 0 },
    })
    rects = paintSky(host)
      .callsOf('fillRect')
      .map((c) => c.args)
    expect(rects).toContainEqual([48, 36, 100, 32])

    // 3. 跨冻结带与空隙直达可见滚动格 (0,0)~(3,7)
    table.applyExternalSelection({
      ranges: [{ start: { col: 0, row: 0 }, end: { col: 3, row: 7 } }],
      focus: { col: 3, row: 7 },
    })
    rects = paintSky(host)
      .callsOf('fillRect')
      .map((c) => c.args)
    const bottomRight = table.getCellRelativeRect(3, 7)!
    expect(rects).toContainEqual([
      48,
      36,
      bottomRight.x + bottomRight.width - 48,
      bottomRight.y + bottomRight.height - 36,
    ])

    // 4. 仅滚动区高亮 (2,2)~(3,8)：起点在空隙中，裁剪后从冻结分隔线起步、不侵入冻结带
    table.clearSelection()
    table.setHighlightRanges([
      { bounds: { minCol: 2, minRow: 2, maxCol: 3, maxRow: 8 }, color: '#ff0000' },
    ])
    const hlCtx = paintSky(host)
    const redRects = hlCtx.styledRects.filter((r) => r.fill === '#ff0000')
    expect(redRects).toHaveLength(4)
    // 顶部横边 y 必 >= freezeDividerY (36 + 32 = 68)，左竖边 x 必 >= freezeDividerX (48 + 100 = 148)
    expect(Math.min(...redRects.map((r) => r.y))).toBeGreaterThanOrEqual(68)
    expect(Math.min(...redRects.map((r) => r.x))).toBeGreaterThanOrEqual(148)
  })

  it('部分滚动进冻结分隔线下方的滚动格：选区顶边夹紧到 freezeDividers.y，不盖冻结行', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenRowCount: 1,
    })
    // scrollTop = 16：row 1 的完整 y = 36 + 32 - 16 = 52（一半压在 row 0 下方）
    table.scrollTo(0, 16)
    table.applyExternalSelection({
      ranges: [{ start: { col: 1, row: 1 }, end: { col: 1, row: 2 } }],
      focus: { col: 1, row: 1 },
    })
    const rects = paintSky(host)
      .callsOf('fillRect')
      .map((c) => c.args)
    // row 1 底部 = 52 + 32 = 84，row 2 底部 = 116；顶边夹紧到 freezeDividerY = 68，高度 = 116 - 68 = 48
    expect(rects).toContainEqual([148, 68, 100, 48])
  })

  it('fillPreview 跨冻结与滚动带时正常绘制不消失', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenRowCount: 1,
    })
    table.scrollTo(0, 160)
    const overlay = table.interactionState.overlay
    const has = overlay.update({
      selection: { ranges: [], focus: null },
      resizeLine: null,
      fillHandleRange: null,
      fillPreview: { minCol: 0, minRow: 0, maxCol: 1, maxRow: 7 },
      selectionAnchor: null,
      highlightRanges: [],
      freezeDividers: { x: null, y: 68 },
      scrollbars: { vertical: null, horizontal: null },
      scrollbarGutter: { width: 0, height: 0 },
      window: {
        frozenRowCount: 1,
        frozenColCount: 0,
        rows: table.geometryState.rows,
        cols: table.geometryState.cols,
      },
    })
    expect(has).toBe(true)
    const ctx = paintSky(host)
    expect(ctx.styledRects.some((r) => r.fill === table.theme.interaction.selectionBorder)).toBe(
      true,
    )
  })
})
