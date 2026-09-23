// ListTable 容器 resize 原地自适应：构造后 resize() 调整视口尺寸，
// 滚动位置与选区保留、实例不重建；几何变更统一走 applyGeometryChange
// （宿主 resize + 场景全量重建 + body 整层失效）。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function rows(count: number): Record<string, string>[] {
  return Array.from({ length: count }, (_, i) => ({ name: `r${i}` }))
}

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, records: rows(100), ...extra })
  return { host, table }
}

// 缺省几何：行号列 48、列头 36、行高 32、列宽 100；内容高 100×32 = 3200
describe('ListTable 容器 resize 原地自适应', () => {
  it('resize：视口尺寸、可视窗口按新尺寸更新，宿主收到 resize 与 body 全量失效', () => {
    const { host, table } = createTable()
    const rowsBefore = table.getVisibleRange().rows.end
    table.resize(1000, 800)
    expect(table.width).toBe(1000)
    expect(table.height).toBe(800)
    // 画布内容区 = 视口扣除行号列 48 / 列头 36
    expect(table.getDrawRange()).toEqual({ x: 48, y: 36, width: 952, height: 764 })
    // 可视行数按新视口扩（视口高 564 → 764）
    expect(table.getVisibleRange().rows.end).toBeGreaterThan(rowsBefore)
    expect(host.submitted).toContainEqual({ kind: 'body', inv: { type: 'full' } })
  })

  it('resize：滚动位置与选区保留（视口增大仍在界内，不重置不重建）', () => {
    const { table } = createTable()
    table.setScrollTop(320)
    table.selectCell(2, 5)
    const scrollBefore = table.getScrollState()
    const selectionBefore = table.getSelection()
    table.resize(1000, 800)
    expect(table.getScrollState()).toEqual(scrollBefore)
    expect(table.getSelection()).toEqual(selectionBefore)
    expect(table.getSelectedCellRanges()).toEqual([
      { start: { col: 2, row: 5 }, end: { col: 2, row: 5 } },
    ])
  })

  it('resize：视口增大时滚动位置按新边界夹取（原 maxTop 越界收敛）', () => {
    const { table } = createTable()
    // 600 高视口的 maxTop = 3200 - 564 = 2636
    table.setScrollTop(2636)
    expect(table.getScrollTop()).toBe(2636)
    // 视口高 764 → maxTop = 2436，原位置越界夹取
    table.resize(800, 800)
    expect(table.getScrollTop()).toBe(2436)
  })

  it('resize：尺寸未变化为空操作（不提交任何失效）', () => {
    const { host, table } = createTable()
    host.submitted.length = 0
    table.resize(800, 600)
    expect(host.submitted).toEqual([])
  })
})
