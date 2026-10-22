// @vitest-environment happy-dom
// 显式 hostOptions.dpr 在 resize 沿构造值（像素断言/离屏出图等确定性场景锁 dpr，
// 不被环境值覆盖）；未注入时 resize 跟随宿主环境（跨屏/缩放的既有通道）；
// resolveDevicePixelRatio 注入读取源接管环境读取（无头测试固定值），显式
// hostOptions.dpr 仍最优先。

import { describe, expect, it } from 'vitest'

import { ListTable } from '../src/list-table'
import type { ListTableOptions } from '../src/types'
import { StubHost } from './testing/stub-host'

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const resized: number[] = []
  host.resize = ((_: number, __: number, dpr: number) => {
    resized.push(dpr)
  }) as unknown as typeof host.resize
  const table = new ListTable({
    width: 300,
    height: 200,
    columns: [{ field: 'name' }],
    records: [{ name: 'a' }],
    host,
    ...extra,
  })
  return { table, resized }
}

describe('ListTable dpr：显式注入锁定 / 缺省随宿主环境', () => {
  it('显式 dpr：构造与 resize 均沿注入值，环境变化不覆盖', () => {
    window.devicePixelRatio = 2
    try {
      const { table, resized } = createTable({ hostOptions: { dpr: 1 } })
      expect(table.hostDpr).toBe(1)
      table.resize(320, 220)
      expect(resized).toEqual([1])
      expect(table.hostDpr).toBe(1)
    } finally {
      window.devicePixelRatio = 1
    }
  })

  it('未注入 dpr：构造与 resize 随宿主环境（跨屏/缩放通道）', () => {
    window.devicePixelRatio = 2
    try {
      const { table, resized } = createTable()
      expect(table.hostDpr).toBe(2)
      table.resize(320, 220)
      expect(resized).toEqual([2])
      expect(table.hostDpr).toBe(2)
    } finally {
      window.devicePixelRatio = 1
    }
  })

  it('resolveDevicePixelRatio 注入：构造与 resize 沿注入读取源，不读环境值', () => {
    window.devicePixelRatio = 2
    let injected = 3
    try {
      const { table, resized } = createTable({ resolveDevicePixelRatio: () => injected })
      expect(table.hostDpr).toBe(3)
      // 读取源每次调用：resize 拾取新值（无头测试的跨屏/缩放通道）
      injected = 4
      table.resize(320, 220)
      expect(resized).toEqual([4])
      expect(table.hostDpr).toBe(4)

      // 显式 hostOptions.dpr 锁值仍最优先（不被注入读取源覆盖）
      const locked = createTable({
        hostOptions: { dpr: 1 },
        resolveDevicePixelRatio: () => injected,
      })
      expect(locked.table.hostDpr).toBe(1)
    } finally {
      window.devicePixelRatio = 1
    }
  })
})
