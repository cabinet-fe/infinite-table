// 冻结带滚动 z 序契约（增量窗口）：滚入格/滚入行列头挂树尾后仍必须画在冻结带之下。
// 窗口起点行/列在非对齐滚动位置与冻结带几何重叠（局部可见行顶部伸进冻结带），若
// 滚入格重挂在既有冻结带格之上，滚动 band 失效不覆盖冻结带区域，任何全量重绘会把
// 「滚动区内容盖住冻结行」烙进冻结带像素（下游冻结行滚动后渲染错乱的根因）。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import { StubHost } from './testing/stub-host'
import { findCellNode } from './testing/find-cell-node'
import type { ListTableOptions } from '../src/types'

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

const records100 = () => Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` }))

describe('ListTable 冻结带滚动 z 序', () => {
  it('上滚滚入行重挂树尾后，数据格仍画在冻结行带之下', () => {
    const { host, table } = createTable({ records: records100(), frozenRowCount: 1 })
    // 缺省行高 32、表头高 36：scrollTop=31 时窗口起点行 1 的 y = 36 + 32 - 31 = 37，
    // 与冻结行带 [36, 68) 几何重叠；该行经下滚滚出、上滚重新滚入被 appendCell 重挂树尾
    table.scrollTo(0, 96)
    table.scrollTo(0, 31)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 5, 0)
    const entering = findCellNode(root, 5, 1)
    expect(entering).toBeDefined()
    expect(entering!.y).toBe(37)
    expect(frozen).toBeDefined()
    expect(root.children.indexOf(frozen!)).toBeGreaterThan(root.children.indexOf(entering!))
  })

  it('左滚滚入列重挂树尾后，数据格仍画在冻结列带之下', () => {
    const { host, table } = createTable({ records: records100(), frozenColCount: 1 })
    // 缺省列宽 100、行号列宽 48：scrollLeft=63 时窗口起点列 1 的 x = 48 + 100 - 63 = 85，
    // 与冻结列带 [48, 148) 几何重叠
    table.scrollTo(200, 0)
    table.scrollTo(63, 0)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 0, 5)
    const entering = findCellNode(root, 1, 5)
    expect(entering).toBeDefined()
    expect(entering!.x).toBe(85)
    expect(frozen).toBeDefined()
    expect(root.children.indexOf(frozen!)).toBeGreaterThan(root.children.indexOf(entering!))
  })

  it('滚入行头重挂后仍画在冻结行头之下（列头/角块保持最上）', () => {
    const { table } = createTable({ records: records100(), frozenRowCount: 1 })
    table.scrollTo(0, 96)
    table.scrollTo(0, 31)
    const headerGroup = table.headerGroup!
    const frozenHeader = table.rowHeaderNodes.get(0)
    const enteringHeader = table.rowHeaderNodes.get(1)
    expect(frozenHeader).toBeDefined()
    expect(enteringHeader).toBeDefined()
    expect(headerGroup.children.indexOf(frozenHeader!)).toBeGreaterThan(
      headerGroup.children.indexOf(enteringHeader!),
    )
    // 角块恒为容器末子节点（列头重挂后仍最上）
    expect(headerGroup.children[headerGroup.children.length - 1]).toBe(table.cornerNode)
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
    expect(root.children.indexOf(frozen)).toBeGreaterThan(root.children.indexOf(entering))
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
    // resize 全量重建后：冻结行内容仍在原位（y=36），合并主格按 scrollTop=112 定位
    // （行高 32：rowOffsets[4]=128，主格 y = 36 + 128 − 112 = 52）
    const frozenAfterResize = findCellNode(host.layers.get('body')!.root, 0, 0)
    expect(frozenAfterResize).toMatchObject({ y: 36, text: 'r0' })
    const masterAfterResize = findCellNode(host.layers.get('body')!.root, 1, 4)
    expect(masterAfterResize).toMatchObject({ y: 36 + 128 - table.getScrollTop() })
    // 滚回顶部：存活节点平移，冻结行不动、主格回到 164
    table.scrollTo(0, 0)
    expect(findCellNode(host.layers.get('body')!.root, 0, 0)).toMatchObject({ y: 36, text: 'r0' })
    expect(findCellNode(host.layers.get('body')!.root, 1, 4)).toMatchObject({ y: 36 + 128 })
  })
})

describe('ListTable 冻结带 + overscan 窗口边界（@infinitable/sheet 缺省 overscan 配置）', () => {
  function createOverscanTable(extra: Partial<ListTableOptions> = {}) {
    return createTable({ overscanRows: 10, overscanCols: 4, frozenRowCount: 1, ...extra })
  }

  it('overscan 扩展不得把冻结行混进滚动带窗口（table.rows 语义）', () => {
    const { table } = createOverscanTable({ records: records100() })
    // 构造期 scrollTop=0：带内窗口 start=1，overscan 回退 10 行会被钳回 1
    expect(table.rows.start).toBe(1)
    table.scrollTo(0, 224)
    // scrollTop=224（8 行）：带内 start=8，overscan 回退到 0 同样被钳回 1
    expect(table.rows.start).toBe(1)
  })

  it('滚动把窗口行滑到冻结带位置时不盖写冻结行（overscan 下无滚入帧也成立）', () => {
    const { host, table } = createOverscanTable({ records: records100() })
    // overscan 让窗口恒含近端行：下滚全程无滚入行、无 bodyChanged 帧，
    // 冻结带 z 序必须自构造期重建起就正确（滚动带行在其下）
    table.scrollTo(0, 224)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 5, 0)!
    // 行 7 的 y = 36 + 224 − 224 = 36，恰与冻结行带 [36, 68) 重叠
    const bandRow = findCellNode(root, 5, 7)!
    expect(bandRow.y).toBe(36)
    expect(root.children.indexOf(frozen)).toBeGreaterThan(root.children.indexOf(bandRow))
    // 滚回顶部仍正确
    table.scrollTo(0, 0)
    expect(findCellNode(root, 5, 0)).toBeDefined()
    expect(root.children.indexOf(frozen)).toBeGreaterThan(
      root.children.indexOf(findCellNode(root, 5, 1)!),
    )
  })

  it('滚动后 resize 全量重建：冻结带格由冻结带趟装配，z 序高于全部滚动带行', () => {
    const { host, table } = createOverscanTable({ records: records100() })
    table.scrollTo(0, 224)
    table.resize(800, 560)
    const root = host.layers.get('body')!.root
    const frozen = findCellNode(root, 5, 0)!
    expect(frozen).toMatchObject({ y: 36, text: 'r0' })
    // 全部与冻结带几何重叠的滚动带行（y < 带底 68）都必须画在冻结格之下
    const overlapping = [...table.cellNodes.values()].filter(
      (node) => node.row >= 1 && node.y < 68 && node.y + node.height > 36,
    )
    expect(overlapping.length).toBeGreaterThan(0)
    for (const node of overlapping) {
      expect(root.children.indexOf(frozen)).toBeGreaterThan(root.children.indexOf(node))
    }
  })
})

