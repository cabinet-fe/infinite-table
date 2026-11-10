// 画布右键菜单项构建测试：body 菜单（设置数据块/调整范围/删除/合并）的启用与禁用
// 原因、行头菜单（行角色）的当前态与分组前置条件。纯逻辑，不挂 DOM。
import { describe, expect, test } from 'bun:test'

import { FormDoc } from '../../src/domain/form-doc'
import { buildCanvasContextMenu, type CanvasContextMenuActions } from '../../src/designer/canvas-context-menu'
import { ADDR, RANGE } from './testing/fixtures'

/** 无动作桩：断言只看菜单结构（label/disabledReason/checked） */
const NOOP: CanvasContextMenuActions = {
  createRegionFromSelection: () => {},
  resizeRegionToSelection: () => {},
  removeRegion: () => {},
  mergeSelection: () => {},
  unmergeSelection: () => {},
  setRowRole: () => {},
}

function bodyInfo(addr: { row: number; col: number } | null) {
  return { x: 0, y: 0, kind: 'body' as const, addr }
}

function rowHeaderInfo(row: number | undefined) {
  return { x: 0, y: 0, kind: 'row-header' as const, addr: null, row }
}

const keysOf = (items: { key: string }[]) => items.map((item) => item.key)
const reasonOf = (items: { key: string; disabledReason?: string }[], key: string) =>
  items.find((item) => item.key === key)?.disabledReason

describe('body 菜单：设置为数据块', () => {
  test('无选区 → 禁用并提示框选（附数据块定位口径）', () => {
    const doc = FormDoc.create(8)
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(5, 5)), null, NOOP)
    expect(reasonOf(items, 'create-region')).toBe(
      '先在画布上框选一块范围（数据块只为绑数据集或数组型聚合而存在；固定文字直接写在格子里）',
    )
  })

  test('选区与既有数据块重叠 → 禁用', () => {
    const doc = FormDoc.create(8) // 0..2 行全宽数据块
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(5, 5)), RANGE(2, 0, 4, 0), NOOP)
    expect(reasonOf(items, 'create-region')).toContain('重叠')
  })

  test('选区含相对绑定的单元格 → 禁用', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(6, 0), { path: 'name' })
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(5, 5)), RANGE(5, 0, 6, 1), NOOP)
    expect(reasonOf(items, 'create-region')).toContain('绑定字段')
  })

  test('选区含聚合引用绑定的单元格 → 不禁用（聚合引用不依赖数据块）', () => {
    const doc = FormDoc.create(8)
    doc.setCellBinding(ADDR(6, 0), { kind: 'agg', aggName: 'head', path: 'title' })
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(5, 5)), RANGE(5, 0, 6, 1), NOOP)
    expect(reasonOf(items, 'create-region')).toBeUndefined()
  })

  test('干净选区 → 可用', () => {
    const doc = FormDoc.create(8)
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(5, 5)), RANGE(5, 0, 6, 1), NOOP)
    expect(reasonOf(items, 'create-region')).toBeUndefined()
  })
})

describe('body 菜单：调整范围 / 删除数据块', () => {
  test('落点不在数据块内 → 调整与删除不出现/禁用', () => {
    const doc = FormDoc.create(8)
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(6, 0)), null, NOOP)
    expect(reasonOf(items, 'resize-region')).toBe('落点不在任何数据块内')
    expect(keysOf(items)).not.toContain('remove-region')
  })

  test('落点在数据块内 + 有选区 → 可调整', () => {
    const doc = FormDoc.create(8)
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(0, 0)), RANGE(0, 0, 1, 3), NOOP)
    expect(reasonOf(items, 'resize-region')).toBeUndefined()
    expect(keysOf(items)).toContain('remove-region')
    expect(reasonOf(items, 'remove-region')).toBeUndefined()
  })
})

describe('body 菜单：合并 / 取消合并', () => {
  test('单格 → 合并禁用；无合并 → 取消合并禁用', () => {
    const doc = FormDoc.create(8)
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(0, 0)), RANGE(0, 0, 0, 0), NOOP)
    expect(reasonOf(items, 'merge')).toContain('两个以上单元格')
    expect(reasonOf(items, 'unmerge')).toContain('没有合并单元格')
  })

  test('多格选区 → 合并可用；含合并区 → 取消合并可用', () => {
    const doc = FormDoc.create(8)
    doc.sheet.mergeCells(RANGE(0, 0, 0, 2))
    const items = buildCanvasContextMenu(doc, bodyInfo(ADDR(0, 0)), RANGE(0, 0, 0, 3), NOOP)
    expect(reasonOf(items, 'merge')).toBeUndefined()
    expect(reasonOf(items, 'unmerge')).toBeUndefined()
  })
})

describe('行头菜单：行角色', () => {
  test('行头不在数据块内 → 空菜单', () => {
    const doc = FormDoc.create(8) // 0..2 行
    expect(buildCanvasContextMenu(doc, rowHeaderInfo(6), null, NOOP)).toEqual([])
  })

  test('非 down 数据块：全部禁用并提示', () => {
    const doc = FormDoc.create(8) // expand none
    const items = buildCanvasContextMenu(doc, rowHeaderInfo(0), null, NOOP)
    expect(keysOf(items)).toEqual(['role-detail', 'role-groupHeader', 'role-groupFooter', 'role-summary'])
    for (const item of items) expect(item.disabledReason).toContain('纵向列表')
  })

  test('down 数据块：明细行默认选中；组头/小计需要分组字段（未绑数据源时行为一致）', () => {
    const doc = FormDoc.create(8)
    // 展开方式可先设：无数据源的 down 数据块行角色照常可配
    doc.setRegionExpand(0, 'down')
    let items = buildCanvasContextMenu(doc, rowHeaderInfo(0), null, NOOP)
    expect(items.find((item) => item.key === 'role-detail')?.checked).toBe(true)
    expect(reasonOf(items, 'role-groupHeader')).toContain('分组字段')
    expect(reasonOf(items, 'role-summary')).toBeUndefined()

    doc.setRegionGroupBy(0, ['customer'])
    // 0 → ≥1 自动预填典型布局（3 行数据块 → 首行组头、末行合计）
    expect(doc.regions[0]!.rowRoles).toEqual([
      { row: 0, role: 'groupHeader' },
      { row: 2, role: 'summary' },
    ])
    doc.setRegionRowRole(0, 1, 'groupFooter')
    items = buildCanvasContextMenu(doc, rowHeaderInfo(1), null, NOOP)
    expect(items.find((item) => item.key === 'role-groupFooter')?.checked).toBe(true)
    expect(reasonOf(items, 'role-groupHeader')).toBeUndefined()
  })

  test('列头 → 空菜单（暂无条目）', () => {
    const doc = FormDoc.create(8)
    expect(
      buildCanvasContextMenu(doc, { x: 0, y: 0, kind: 'col-header', addr: null }, null, NOOP),
    ).toEqual([])
  })
})
