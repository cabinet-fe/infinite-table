// 单格行列头高亮（S9-P3）：选区焦点格所在行号格与列头格恒以
// theme.interaction.headerHighlight 高亮（合并区按主格解析），选区随动、原格恢复；
// appendCell 建格装配与 applyHeaderHighlight 选区变化重涂两条路径观感一致；
// 整轴（spansAll）表头带高亮不回退且不跨轴点亮焦点格（对齐 Excel/WPS）；
// 表头高亮重绘只登记表头条带 band 失效，不产生 body band/full。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import type { ListTableOptions } from '../src/types'
import { findCellNode } from './testing/find-cell-node'
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

const RECORDS = Array.from({ length: 8 }, (_, i) => ({ name: `v${i}` }))

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, records: RECORDS, host, ...extra })
  host.submitted.length = 0
  return { host, table }
}

/** 表头格节点：列头为 (col, -1)、行号格为 (-1, row)（递归查找：表头节点在表头容器内） */
function headerNode(host: StubHost, col: number, row: number) {
  const body = host.layers.get('body')
  return body ? findCellNode(body.root, col, row) : undefined
}

const colHeaderBg = (host: StubHost, col: number) => headerNode(host, col, -1)?.style.background
const rowHeaderBg = (host: StubHost, row: number) => headerNode(host, -1, row)?.style.background

describe('单格行列头高亮（S9-P3）', () => {
  it('appendCell 建格路径：选中单格后几何变更重建场景，焦点格行列头带高亮', () => {
    const { host, table } = createTable()
    const hl = table.theme.interaction.headerHighlight
    table.selectCell(2, 3)
    // 几何变更 → 场景全量重建（appendCell 建格装配按当前选区点亮）
    table.setColWidth(0, 120)
    expect(colHeaderBg(host, 2)).toBe(hl)
    expect(rowHeaderBg(host, 3)).toBe(hl)
    // 非焦点格的行列头不高亮
    expect(colHeaderBg(host, 3)).not.toBe(hl)
    expect(rowHeaderBg(host, 2)).not.toBe(hl)
  })

  it('applyHeaderHighlight 重涂路径：焦点移动高亮随动、原格恢复', () => {
    const { host, table } = createTable()
    const hl = table.theme.interaction.headerHighlight
    table.selectCell(2, 3)
    expect(colHeaderBg(host, 2)).toBe(hl)
    expect(rowHeaderBg(host, 3)).toBe(hl)
    // 未高亮表头格的常态背景（恢复断言口径）
    const normalColBg = colHeaderBg(host, 4)
    const normalRowBg = rowHeaderBg(host, 4)
    table.selectCell(5, 1)
    expect(colHeaderBg(host, 5)).toBe(hl)
    expect(rowHeaderBg(host, 1)).toBe(hl)
    expect(colHeaderBg(host, 2)).toBe(normalColBg)
    expect(rowHeaderBg(host, 3)).toBe(normalRowBg)
  })

  it('多段选区按焦点格点亮（末段焦点格）', () => {
    const { host, table } = createTable()
    const hl = table.theme.interaction.headerHighlight
    table.selectCells([
      { start: { col: 0, row: 0 }, end: { col: 1, row: 1 } },
      { start: { col: 4, row: 5 }, end: { col: 6, row: 7 } },
    ])
    expect(colHeaderBg(host, 6)).toBe(hl)
    expect(rowHeaderBg(host, 7)).toBe(hl)
    expect(colHeaderBg(host, 4)).not.toBe(hl)
    expect(rowHeaderBg(host, 5)).not.toBe(hl)
  })

  it('合并区按主格点亮：覆盖格焦点解析到主格，重涂与建格两条路径一致', () => {
    const merges = [{ startCol: 1, startRow: 1, endCol: 2, endRow: 2 }]
    const { host, table } = createTable({ mergeCells: merges })
    const hl = table.theme.interaction.headerHighlight
    // 焦点落在合并区覆盖格 (2,2)：按主格 (1,1) 点亮，覆盖格自身的行列头不点亮
    table.selectCell(2, 2)
    expect(colHeaderBg(host, 1)).toBe(hl)
    expect(rowHeaderBg(host, 1)).toBe(hl)
    expect(colHeaderBg(host, 2)).not.toBe(hl)
    expect(rowHeaderBg(host, 2)).not.toBe(hl)
    // 建格路径（几何变更重建）同口径
    table.setColWidth(0, 120)
    expect(colHeaderBg(host, 1)).toBe(hl)
    expect(rowHeaderBg(host, 1)).toBe(hl)
    expect(colHeaderBg(host, 2)).not.toBe(hl)
    expect(rowHeaderBg(host, 2)).not.toBe(hl)
  })

  it('失效登记：表头高亮重绘只提交 body band 且落在表头条带内，无 body full', () => {
    const { host, table } = createTable()
    table.selectCell(2, 3)
    const bodyInvs = host.submitted
      .filter((entry) => entry.kind === 'body')
      .map((entry) => entry.inv)
    expect(bodyInvs.length).toBeGreaterThan(0)
    expect(bodyInvs.some((inv) => inv.type !== 'band')).toBe(false)
    // 表头条带：列头带（y 在表头高度内）或行号列带（x 在行号列宽内），不跨数据区
    const regions = bodyInvs.map((inv) => (inv.type === 'band' ? inv.region : null))
    const allInHeaderStrip = regions.every(
      (region) =>
        region !== null && (region.y < table.headerHeight || region.x < table.rowHeaderWidth),
    )
    expect(allInHeaderStrip).toBe(true)
    expect(host.submitted.some((entry) => entry.kind === 'body' && entry.inv.type === 'full')).toBe(
      false,
    )
  })

  it('整行选择：行号带点亮、列头不跨轴点亮（整轴不回退）', () => {
    const { host, table } = createTable()
    const hl = table.theme.interaction.headerHighlight
    table.selectRow(3)
    expect(rowHeaderBg(host, 3)).toBe(hl)
    expect(rowHeaderBg(host, 4)).not.toBe(hl)
    expect(colHeaderBg(host, 0)).not.toBe(hl)
    expect(colHeaderBg(host, 6)).not.toBe(hl)
  })

  it('整列选择：列头带点亮、行号不跨轴点亮（整轴不回退）', () => {
    const { host, table } = createTable()
    const hl = table.theme.interaction.headerHighlight
    table.selectCol(2)
    expect(colHeaderBg(host, 2)).toBe(hl)
    expect(colHeaderBg(host, 3)).not.toBe(hl)
    expect(rowHeaderBg(host, 0)).not.toBe(hl)
    expect(rowHeaderBg(host, 7)).not.toBe(hl)
  })

  it('全选：列头与行号带全部点亮（整轴不回退）', () => {
    const { table } = createTable()
    const hl = table.theme.interaction.headerHighlight
    table.selectAll()
    expect(table.colHeaderNodes.size).toBeGreaterThan(0)
    expect(table.rowHeaderNodes.size).toBeGreaterThan(0)
    for (const node of table.colHeaderNodes.values()) {
      expect(node.style.background).toBe(hl)
    }
    for (const node of table.rowHeaderNodes.values()) {
      expect(node.style.background).toBe(hl)
    }
  })
})
