// 跨冻结边界合并区：引擎放开「合并不跨冻结边界」构造期校验后的场景契约。
// 主格按其自身坐标的冻结带归属钉固（滚动不平移），整块跨度绘制、覆盖格不建节点
// （内容只画一次、不缺格）；增量滚动把跨边界主格重挂在滚入格之上（无错切盖写）；
// 模型越界（行列范围越出表格）的合并区仍抛错且表保持原状。

import { describe, expect, it } from 'vitest'

import type { SceneNode } from '@infinite-table/render'

import { CellNode } from '../src/cell-node'
import { ListTable } from '../src/list-table'
import { RecordingContext } from './testing/recording-context'
import { findCellNode } from './testing/find-cell-node'
import { StubHost } from './testing/stub-host'
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

/** 在 body 场景树中按坐标找节点（递归：表头节点在表头容器内） */
function findNode(host: StubHost, col: number, row: number): CellNode | undefined {
  const body = host.layers.get('body')
  return body ? findCellNode(body.root, col, row) : undefined
}

/** 命中：找包围盒包含层坐标点的最浅数据格节点（递归含表头容器） */
function findNodeAt(host: StubHost, x: number, y: number): CellNode | undefined {
  const body = host.layers.get('body')
  if (!body) {
    return undefined
  }
  const search = (node: SceneNode): CellNode | undefined => {
    for (const child of node.children) {
      if (
        child instanceof CellNode &&
        x >= child.x &&
        x < child.x + child.width &&
        y >= child.y &&
        y < child.y + child.height
      ) {
        return child
      }
      const found = search(child)
      if (found) {
        return found
      }
    }
    return undefined
  }
  return search(body.root)
}

const records100 = () => Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` }))

describe('ListTable 跨冻结边界合并区', () => {
  it('含冻结行/列构造跨边界合并区不抛错，取值路由主格', () => {
    const { table } = createTable({
      records: records100(),
      frozenColCount: 1,
      frozenRowCount: 1,
      mergeCells: [
        { startCol: 0, startRow: 0, endCol: 3, endRow: 0 }, // 跨列冻结边界
        { startCol: 5, startRow: 0, endCol: 5, endRow: 3 }, // 跨行冻结边界
      ],
    })
    expect(table.mergeCells.ranges).toHaveLength(2)
    // 被覆盖格取主格文本（跨冻结边界不改变取值路由）
    expect(table.getCellText(2, 0)).toBe('r0')
    expect(table.getCellText(5, 3)).toBe('r0')
  })

  it('场景装配：主格钉固冻结角整块绘制，覆盖格不建节点（内容只画一次、不缺格）', () => {
    const { host } = createTable({
      records: records100(),
      frozenColCount: 1,
      frozenRowCount: 1,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 3, endRow: 1 }],
    })
    // 主格钉固冻结角：x=48、y=36，整块跨 4 列 2 行（400 x 64）不错切
    const master = findNode(host, 0, 0)
    expect(master).toMatchObject({ x: 48, y: 36, width: 400, height: 64, text: 'r0' })
    // 覆盖格（冻结列侧 + 滚动列侧）全部不建节点
    for (const [col, row] of [
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]) {
      expect(findNode(host, col!, row!)).toBeUndefined()
    }
    // 命中：覆盖格坐标落点路由主格节点
    expect(findNodeAt(host, 260, 80)).toBe(master)
    // 内容只画一次：主格文本绘制调用恰一次
    const ctx = new RecordingContext()
    master!.paint(ctx)
    expect(ctx.callsOf('fillText').filter((call) => call.args[0] === 'r0')).toHaveLength(1)
  })

  it('滚动增量：跨边界主格钉固不平移，且重挂在滚入格之上（延伸段不被盖写）', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenColCount: 1,
      frozenRowCount: 1,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 3, endRow: 1 }],
    })
    table.scrollTo(0, 96)
    // 钉固：主格仍在冻结角原位，整块尺寸不变
    const master = findNode(host, 0, 0)!
    expect(master).toMatchObject({ x: 48, y: 36, width: 400, height: 64 })
    const root = host.layers.get('body')!.root
    const order = (node: SceneNode) => root.children.indexOf(node)
    // 主格后画于本帧滚入的滚动带格；表头容器仍在主格之上
    const entering = findNode(host, 5, 19)!
    expect(order(master)).toBeGreaterThan(order(entering))
    expect(order(master)).toBeLessThan(order(table.headerGroup!))
  })

  it('行向跨边界合并区：主格纵向钉固、滚入行重挂其下（延伸段不被盖写）', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenRowCount: 2,
      mergeCells: [{ startCol: 5, startRow: 1, endCol: 6, endRow: 4 }],
    })
    // 向下滚再向上滚：滚入的行 5 滑到主格延伸段之下
    table.scrollTo(0, 128)
    table.scrollTo(0, 96)
    const master = findNode(host, 5, 1)!
    // 纵向钉固（行 1 < 冻结行 2）：y = 36 + 32；横向属滚动带随滚动：x = 48 + 500
    expect(master).toMatchObject({ x: 548, y: 68, width: 200, height: 128 })
    const root = host.layers.get('body')!.root
    const entering = findNode(host, 5, 5)!
    expect(root.children.indexOf(master)).toBeGreaterThan(root.children.indexOf(entering))
  })

  it('冻结计数运行时变化：跨边界合并区主格按新边界重钉，包围盒不错切', () => {
    const { host, table } = createTable({
      records: records100(),
      mergeCells: [{ startCol: 1, startRow: 1, endCol: 3, endRow: 3 }],
    })
    expect(findNode(host, 1, 1)).toMatchObject({ x: 148, y: 68, width: 300, height: 96 })
    table.setFrozenColCount(2)
    table.setFrozenRowCount(2)
    // 主格 (1,1) 随新冻结数归入冻结角带：坐标与整块跨度不变（只换钉固归属，不错切）
    expect(findNode(host, 1, 1)).toMatchObject({ x: 148, y: 68, width: 300, height: 96 })
    expect(findNode(host, 3, 3)).toBeUndefined()
    // 横向滚动：主格已属冻结带，不再平移
    table.scrollTo(120, 0)
    expect(findNode(host, 1, 1)).toMatchObject({ x: 148, width: 300 })
  })

  it('越界合并区：构造期抛错；运行时增改抛错且保持原状', () => {
    // 构造期：endRow 100 越出行数 100
    expect(() =>
      createTable({
        records: records100(),
        mergeCells: [{ startCol: 0, startRow: 98, endCol: 0, endRow: 100 }],
      }),
    ).toThrow(/outside the table bounds/)
    // 负坐标同样越界
    expect(() =>
      createTable({
        records: records100(),
        mergeCells: [{ startCol: -1, startRow: 0, endCol: 1, endRow: 0 }],
      }),
    ).toThrow(/outside the table bounds/)

    const { host, table } = createTable({
      records: records100(),
      frozenColCount: 1,
      mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
    })
    host.submitted.length = 0
    expect(() => table.addMergeCell({ startCol: 8, startRow: 5, endCol: 10, endRow: 5 })).toThrow(
      /outside the table bounds/,
    )
    expect(() =>
      table.setMergeCells([
        { startCol: 0, startRow: 0, endCol: 1, endRow: 0 },
        { startCol: 2, startRow: 2, endCol: 2, endRow: 102 },
      ]),
    ).toThrow(/outside the table bounds/)
    // 原状：集合未替换、场景未重建（无新失效提交），既有合并区照常
    expect(table.mergeCells.ranges).toHaveLength(1)
    expect(findNode(host, 0, 0)).toMatchObject({ width: 200 })
    expect(host.submitted).toEqual([])
  })
})
