import { describe, expect, it } from 'vitest'

import type { SelectionSnapshot } from '@infinite-table/core'

import { ListTable } from '@infinite-table/core'

import { bindSelectionSync } from '../../src/sheet/selection-sync'
import { StubHost } from '../testing/stub-host'

function setup() {
  const host = new StubHost()
  const table = new ListTable({
    width: 400,
    height: 200,
    columns: [
      { field: 'name', title: 'Name' },
      { field: 'qty', title: 'Qty' },
    ],
    records: Array.from({ length: 20 }, (_, i) => ({ name: `r${i}` })),
    host,
  })
  return { host, table }
}

describe('bindSelectionSync 选区双向同步', () => {
  it('表格选区变化驱动 apply；syncFromExternal 回流表格', () => {
    const { table } = setup()
    const applied: SelectionSnapshot[] = []
    const external: SelectionSnapshot = {
      ranges: [{ start: { col: 1, row: 1 }, end: { col: 2, row: 2 } }],
      focus: { col: 2, row: 2 },
    }
    const controller = bindSelectionSync({
      table,
      apply: (snapshot) => applied.push(snapshot),
      get: () => external,
    })

    table.selectCell(0, 0)
    expect(applied).toHaveLength(1)
    expect(applied[0]?.ranges).toEqual([{ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } }])

    // 外部变化 → 回流表格（applyExternalSelection 不广播，不再触发 apply）
    controller.syncFromExternal()
    expect(table.getSelection().focus).toEqual({ col: 2, row: 2 })
    expect(applied).toHaveLength(1)

    // 回流后表格选区与外部一致：再次 syncFromExternal 同签名零开销
    controller.syncFromExternal()
    expect(applied).toHaveLength(1)
    controller.dispose()
  })

  it('防回环：apply 落库与回流交替 100 次状态一致、无重复 apply', () => {
    const { table } = setup()
    let applyCount = 0
    let external: SelectionSnapshot = { ranges: [], focus: null }
    const controller = bindSelectionSync({
      table,
      apply: (snapshot) => {
        applyCount++
        external = snapshot
      },
      get: () => external,
    })

    for (let i = 0; i < 100; i++) {
      // 表格侧变化 → apply 落外部
      table.selectCell(i % 2, i % 3)
      // 宿主模拟「外部已采纳」回流：同签名应被跳过
      controller.syncFromExternal()
      expect(applyCount).toBe(i + 1)
    }
    expect(table.getSelection().focus).toEqual({ col: 99 % 2, row: 99 % 3 })
    controller.dispose()
  })
})
