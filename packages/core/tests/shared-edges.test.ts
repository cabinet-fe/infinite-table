// 共享边裁决单测：strongerEdge/resolveSharedEdges 纯函数各规则分支 +
// 场景接线（生效边框落 CellNode.border、refreshCell 左/上邻居联动、合并格区域缘取强）。

import { describe, expect, it } from 'vitest'

import type { CellBorderEdge } from '../src/cell-style'
import { ListTable } from '../src/list-table'
import { resolveSharedEdges, strongerEdge } from '../src/shared-edges'
import { findCellNode } from './testing/find-cell-node'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'

const GRID: CellBorderEdge = { width: 1, color: '#e5e6eb', grid: true }
const RED1: CellBorderEdge = { width: 1, color: '#f00' }
const RED3: CellBorderEdge = { width: 3, color: '#f00' }
const BLUE1: CellBorderEdge = { width: 1, color: '#00f' }
const BLUE3: CellBorderEdge = { width: 3, color: '#00f' }

describe('strongerEdge 两边取强', () => {
  it('单边缺省：取有定义的一侧', () => {
    expect(strongerEdge(RED1, undefined)).toBe(RED1)
    expect(strongerEdge(undefined, BLUE1)).toBe(BLUE1)
    expect(strongerEdge(undefined, undefined)).toBeUndefined()
  })

  it('显式边恒胜网格派生边（不论宽度）', () => {
    expect(strongerEdge(GRID, RED1)).toBe(RED1)
    expect(strongerEdge(RED1, GRID)).toBe(RED1)
    // 网格 1px vs 显式 1px：无标记区分则无法裁决，grid 标记是关键输入
    expect(strongerEdge({ ...GRID }, RED1)).toBe(RED1)
  })

  it('同档宽者胜', () => {
    expect(strongerEdge(RED1, BLUE3)).toBe(BLUE3)
    expect(strongerEdge(RED3, BLUE1)).toBe(RED3)
    // 同显式档：宽者胜
    expect(strongerEdge(RED1, BLUE3)).toBe(BLUE3)
  })

  it('等宽同档取前者（所有者自己的边，确定性）', () => {
    expect(strongerEdge(RED1, BLUE1)).toBe(RED1)
    expect(strongerEdge(BLUE1, RED1)).toBe(BLUE1)
    expect(strongerEdge(GRID, { ...GRID, color: '#ddd' })).toBe(GRID)
  })
})

describe('resolveSharedEdges 生效四边', () => {
  it('非所有者不画 left/top：非首列/首行的 left/top 被剔除', () => {
    const result = resolveSharedEdges(
      { top: RED1, right: RED1, bottom: RED1, left: RED1 },
      {},
      { firstCol: false, firstRow: false },
    )
    expect(result).toEqual({ top: undefined, right: RED1, bottom: RED1, left: undefined })
  })

  it('首列/首行自画 left/top', () => {
    const result = resolveSharedEdges(
      { top: RED1, left: BLUE1 },
      {},
      { firstCol: true, firstRow: true },
    )
    expect(result).toEqual({ top: RED1, right: undefined, bottom: undefined, left: BLUE1 })
  })

  it('所有者画生效边：right/bottom 与 facing 对侧边取强', () => {
    const result = resolveSharedEdges(
      { right: GRID, bottom: GRID },
      { right: RED3, bottom: BLUE1 },
      { firstCol: false, firstRow: false },
    )
    expect(result?.right).toBe(RED3)
    expect(result?.bottom).toBe(BLUE1)
  })

  it('facing 为网格边时所有者自己的显式边不动', () => {
    const result = resolveSharedEdges(
      { right: RED1, bottom: RED3 },
      { right: GRID, bottom: GRID },
      { firstCol: false, firstRow: false },
    )
    expect(result?.right).toBe(RED1)
    expect(result?.bottom).toBe(RED3)
  })

  it('四边皆无（含 left/top 被剔除后）返回 undefined', () => {
    expect(
      resolveSharedEdges({ left: RED1, top: RED1 }, {}, { firstCol: false, firstRow: false }),
    ).toBeUndefined()
    expect(resolveSharedEdges(undefined, {}, { firstCol: true, firstRow: true })).toBeUndefined()
  })

  it('胜出的边对象原引用返回（不拷贝）', () => {
    const result = resolveSharedEdges(
      { right: RED1 },
      { bottom: BLUE3 },
      { firstCol: false, firstRow: false },
    )
    expect(result?.right).toBe(RED1)
    expect(result?.bottom).toBe(BLUE3)
  })
})

// ---- 场景接线（StubHost 建表，断言 CellNode.border 生效边） ----

function createTable(
  resolveCellStyle?: ListTableOptions['resolveCellStyle'],
  extra: Partial<ListTableOptions> = {},
) {
  const host = new StubHost()
  const table = new ListTable({
    width: 800,
    height: 600,
    columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
    records: Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` })),
    resolveCellStyle,
    host,
    ...extra,
  })
  const findNode = (col: number, row: number) => {
    const body = host.layers.get('body')
    return body ? findCellNode(body.root, col, row) : undefined
  }
  return { host, table, findNode }
}

describe('场景接线：共享边裁决落生效边框', () => {
  it('相邻格对侧边不叠画：所有者画强边，非所有者 left/top 剔除', () => {
    const { findNode } = createTable((col, row) => {
      if (row !== 1) {
        return null
      }
      if (col === 1) {
        return { border: { right: RED3 } }
      }
      if (col === 2) {
        return { border: { left: BLUE3, top: RED1 } }
      }
      return null
    })
    // (1,1) 拥有共享竖边：等宽（3px）取所有者自己的红边；网格右/下保留
    const owner = findNode(1, 1)
    expect(owner?.border?.right).toEqual(RED3)
    expect(owner?.border?.bottom).toEqual({ width: 1, color: '#e5e6eb', grid: true })
    // (2,1) 非首列：left 剔除（由 (1,1).right 呈现）；top 非首行剔除；right 网格边保留
    const next = findNode(2, 1)
    expect(next?.border?.left).toBeUndefined()
    expect(next?.border?.top).toBeUndefined()
    expect(next?.border?.right).toEqual({ width: 1, color: '#e5e6eb', grid: true })
  })

  it('首列/首行格自画 left/top（无同带左/上邻居）', () => {
    const { findNode } = createTable((col, row) =>
      col === 0 && row === 0 ? { border: { left: RED3, top: BLUE3 } } : null,
    )
    const cell = findNode(0, 0)
    expect(cell?.border?.left).toEqual(RED3)
    expect(cell?.border?.top).toEqual(BLUE3)
  })

  it('显式 facing 边胜过所有者网格边：邻居显式 3px 由所有者呈现', () => {
    const { findNode } = createTable((col, row) =>
      col === 2 && row === 1 ? { border: { left: BLUE3 } } : null,
    )
    // (1,1) 自身无边框设置（仅网格边），生效 right = 邻居显式蓝 3px
    expect(findNode(1, 1)?.border?.right).toEqual(BLUE3)
  })

  it('refreshCell 联动：改本格 left 边触发左邻居生效边刷新（左邻居不级联）', () => {
    let leftEdge: CellBorderEdge | undefined
    const { table, findNode } = createTable((col, row) =>
      col === 2 && row === 1 && leftEdge ? { border: { left: leftEdge } } : null,
    )
    expect(findNode(1, 1)?.border?.right).toEqual({ width: 1, color: '#e5e6eb', grid: true })
    leftEdge = BLUE3
    table.refreshCell(2, 1)
    // 左邻居 (1,1) 生效 right 联动更新为邻居显式蓝 3px
    expect(findNode(1, 1)?.border?.right).toEqual(BLUE3)
  })

  it('合并主格拥有区域右/下缘：生效边 = max(master 边, 区域外邻居逐格对侧边)', () => {
    const { findNode } = createTable(
      (col, row) => {
        // 合并区 (1,1)~(2,2)；区域外右邻 (3,1) 设显式 left 3px、(3,2) 设显式 left 1px
        if (col === 3 && row === 1) {
          return { border: { left: BLUE3 } }
        }
        if (col === 3 && row === 2) {
          return { border: { left: RED1 } }
        }
        // 主格自身 right 2px
        if (col === 1 && row === 1) {
          return { border: { right: { width: 2, color: '#0a0' } } }
        }
        return null
      },
      { mergeCells: [{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }] },
    )
    const master = findNode(1, 1)
    // 区域右缘：逐行 facing 取强 → 3px 蓝边（胜过 master 2px 绿边与 1px 红边）
    expect(master?.border?.right).toEqual(BLUE3)
    // 被覆盖格不建节点
    expect(findNode(2, 2)).toBeUndefined()
  })

  it('表头走裁决：列头 bottom 保留，行号格/角格 right 保留（带内网格边完整）', () => {
    const { findNode } = createTable()
    const colHeader = findNode(0, -1)
    expect(colHeader?.border?.bottom).toEqual({ width: 1, color: '#e5e6eb', grid: true })
    expect(colHeader?.border?.right).toEqual({ width: 1, color: '#e5e6eb', grid: true })
    const rowHeader = findNode(-1, 0)
    expect(rowHeader?.border?.right).toEqual({ width: 1, color: '#e5e6eb', grid: true })
    expect(rowHeader?.border?.bottom).toEqual({ width: 1, color: '#e5e6eb', grid: true })
    const corner = findNode(-1, -1)
    expect(corner?.border?.right).toEqual({ width: 1, color: '#e5e6eb', grid: true })
    expect(corner?.border?.bottom).toEqual({ width: 1, color: '#e5e6eb', grid: true })
  })
})
