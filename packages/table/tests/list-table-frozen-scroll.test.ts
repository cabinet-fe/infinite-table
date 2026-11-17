// 冻结带滚动 z 序契约（增量窗口）：滚入格/滚入行列头挂树尾后仍必须画在冻结带之下。

import type { SceneNode } from '@infinitable/render'
import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import type { ListTableOptions } from '../src/types'
import { findCellNode } from './testing/find-cell-node'
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
    const headerGroup = table.sceneState.headerGroup!
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
