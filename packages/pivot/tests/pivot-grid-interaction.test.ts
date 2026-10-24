// @vitest-environment happy-dom
// PivotGrid 组高亮交互回归：选区不复用 sheet 交互面（interactiveSelection 关闭），
// 组格点击回写整行带状段（组的可见行块 × 全部列），图标折叠/展开后按新结构重算
// 组块再回写（旧实现按折叠前区间回写到新结构，高亮滞后于结构——本文件锚定该缺陷）。
// 拖拽释放（down/up 位移超阈）不触发高亮。事件经真实 DOM 派发（容器 rect 为零矩形，
// clientX/clientY 即容器相对坐标）；选区快照经引擎 getSelection 读取。

import { describe, expect, it } from 'vitest'

import { ListTable } from '@infinitable/table'

import { PivotGrid } from '../src/pivot-grid'
import type { PivotDimension, PivotMeasure, PivotRecord } from '../src/types'

const DIMENSIONS: PivotDimension[] = [
  { key: 'status', title: '状态', width: 120 },
  { key: 'priority', title: '优先级', width: 100 },
]
const MEASURES: PivotMeasure[] = [
  { key: 'amount', title: '金额和', field: 'amount', agg: 'sum', width: 120 },
  { key: 'count', title: '记录数', field: 'amount', agg: 'count', width: 120 },
]
/** 已完成×{中,低} + 待启动×{中,低}：引擎行序 row1-4 leaf + row5 总计（row0 表头） */
const RECORDS: PivotRecord[] = [
  { status: '已完成', priority: '中', amount: 1 },
  { status: '已完成', priority: '低', amount: 2 },
  { status: '待启动', priority: '中', amount: 3 },
  { status: '待启动', priority: '低', amount: 4 },
]

function createPivot(): { pivot: PivotGrid; table: ListTable; container: HTMLElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const pivot = new PivotGrid({
    container,
    dimensions: DIMENSIONS,
    measures: MEASURES,
    records: RECORDS,
    rowDimensions: ['status', 'priority'],
    columnDimensions: [],
  })
  return { pivot, table: pivot.getTable() as unknown as ListTable, container }
}

/** 引擎行 r 的中点 y（表头 1 行 + 数据行统一高 32） */
const rowMidY = (row: number) => row * 32 + 16

function click(container: HTMLElement, x: number, y: number): void {
  container.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y }))
  container.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }))
}

describe('PivotGrid 组高亮（选区不复用 sheet 交互面）', () => {
  it('主题默认无边框：高亮为纯填充（selectionBorderWidth 压 0）', () => {
    const { pivot } = createPivot()
    expect(pivot.getTable().getTheme().interaction.selectionBorderWidth).toBe(0)
    pivot.destroy()
  })

  it('点击组格：高亮从命中维度列起的整行带（延展到最后一列，含数据列）', () => {
    const { pivot, table, container } = createPivot()
    // 组格「已完成」主格 (0,1)，合并区 rows 1-2；点在格身（非左缘图标带）
    click(container, 60, rowMidY(1))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 3, row: 2 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 0, row: 1 })
    pivot.destroy()
  })

  it('点击深层维度格：高亮从该维度列（col 1）起，不含更浅维度列', () => {
    const { pivot, table, container } = createPivot()
    // 优先级列格「中」(1,1)：前缀 [已完成, 中] → 单行 leaf，带从 col 1 起
    click(container, 120 + 50, rowMidY(1))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 1, row: 1 }, end: { col: 3, row: 1 } },
    ])
    pivot.destroy()
  })

  it('点击列维度表头：高亮该列组 × 全部数据行（度量行单列，含总计行）', () => {
    const { pivot, table, container } = createPivot()
    // 度量标题头「金额和」(2,0)：单列 × 数据行 rows 1-5
    click(container, 220 + 60, 16)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 2, row: 1 }, end: { col: 2, row: 5 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 2, row: 0 })
    pivot.destroy()
  })

  it('点击数据格：高亮单元格自身', () => {
    const { pivot, table, container } = createPivot()
    click(container, 220 + 60, rowMidY(2))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 2, row: 2 }, end: { col: 2, row: 2 } },
    ])
    expect(table.getSelection().focus).toEqual({ col: 2, row: 2 })
    pivot.destroy()
  })

  it('点击总计行头：高亮总计行（从合并主格列起）', () => {
    const { pivot, table, container } = createPivot()
    click(container, 60, rowMidY(5))
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 5 }, end: { col: 3, row: 5 } },
    ])
    pivot.destroy()
  })

  it('图标折叠后按新结构重放：高亮收敛为载体行整行，不残留旧区间（滞后缺陷锚点）', () => {
    const { pivot, table, container } = createPivot()
    // 左缘图标带内点击「已完成」主格：折叠 → 组收敛为载体行 row1（y=63 避开行边界，
    // 合并区竖直中线 64 处的图标命中带 ±12）
    click(container, 5, 63)
    expect(pivot.getVisibleRowCount()).toBe(4)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 3, row: 1 } },
    ])
    // 再点图标展开：组恢复 rows 1-2，高亮重放回整组
    click(container, 5, 32 + 16)
    expect(pivot.getVisibleRowCount()).toBe(5)
    expect(table.getSelection().ranges).toEqual([
      { start: { col: 0, row: 1 }, end: { col: 3, row: 2 } },
    ])
    pivot.destroy()
  })

  it('拖拽释放不触发高亮：down/up 位移超阈的 click 被忽略（无拖选能力）', () => {
    const { pivot, table, container } = createPivot()
    click(container, 60, rowMidY(1))
    const before = table.getSelection().ranges
    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 60, clientY: 48 }))
    container.dispatchEvent(new MouseEvent('click', { clientX: 300, clientY: 48 }))
    expect(table.getSelection().ranges).toEqual(before)
    pivot.destroy()
  })

  it('结构变化清空旧高亮：领域操作（收起全部）后无残留段', () => {
    const { pivot, table, container } = createPivot()
    click(container, 60, rowMidY(1))
    expect(table.getSelection().ranges).toHaveLength(1)
    pivot.collapseAll()
    expect(table.getSelection().ranges).toEqual([])
    pivot.destroy()
  })
})
