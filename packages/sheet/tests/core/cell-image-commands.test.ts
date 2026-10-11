// @vitest-environment happy-dom
// 按格嵌入图命令与变更事件（P4）：插入/移除命令入既有命令栈可 undo/redo；
// 执行/undo/redo 三时机派发 cell-image-change（载荷含格坐标）；
// 与插入/删除行列命令组合后图位置与事件一致 + SheetGrid 门面透出命令入口

import '../grid/setup'

import { describe, expect, it, vi } from 'vitest'

import { Sheet } from '../../src/core/sheet'
import { createGrid } from '../grid/grid-test-utils'

/** 收集 cell-image-change 载荷（浅拷贝 addr，避免与后续变更共享引用） */
function collectEvents(sheet: Sheet): { addr?: { row: number; col: number } }[] {
  const events: { addr?: { row: number; col: number } }[] = []
  sheet.on('cell-image-change', (payload) => {
    events.push(payload.addr ? { addr: { ...payload.addr } } : {})
  })
  return events
}

describe('按格嵌入图：插入/移除命令 + 变更事件', () => {
  it('插入→undo→模型无图、redo→恢复', () => {
    const sheet = new Sheet()
    sheet.insertCellImage({ row: 1, col: 2 }, { src: 'https://example.com/a.png' })
    expect(sheet.hasCellImage({ row: 1, col: 2 })).toBe(true)
    expect(sheet.getCellImage({ row: 1, col: 2 })).toEqual({ src: 'https://example.com/a.png' })

    expect(sheet.undo()).toBe(true)
    expect(sheet.hasCellImage({ row: 1, col: 2 })).toBe(false)
    expect(sheet.getCellImage({ row: 1, col: 2 })).toBeUndefined()

    expect(sheet.redo()).toBe(true)
    expect(sheet.hasCellImage({ row: 1, col: 2 })).toBe(true)
    expect(sheet.getCellImage({ row: 1, col: 2 })).toEqual({ src: 'https://example.com/a.png' })
  })

  it('移除→undo→恢复、redo→再移除', () => {
    const sheet = new Sheet()
    sheet.insertCellImage({ row: 0, col: 0 }, { src: 'https://example.com/b.png' })
    sheet.removeCellImage({ row: 0, col: 0 })
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)

    expect(sheet.undo()).toBe(true)
    expect(sheet.getCellImage({ row: 0, col: 0 })).toEqual({ src: 'https://example.com/b.png' })

    expect(sheet.redo()).toBe(true)
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)
  })

  it('插入命令三时机事件：执行/undo/redo 各触发一次且载荷为格坐标', () => {
    const sheet = new Sheet()
    const events = collectEvents(sheet)

    sheet.insertCellImage({ row: 2, col: 3 }, { src: 'https://example.com/e.png' })
    expect(events).toEqual([{ addr: { row: 2, col: 3 } }])

    sheet.undo()
    expect(events).toEqual([{ addr: { row: 2, col: 3 } }, { addr: { row: 2, col: 3 } }])

    sheet.redo()
    expect(events).toEqual([
      { addr: { row: 2, col: 3 } },
      { addr: { row: 2, col: 3 } },
      { addr: { row: 2, col: 3 } },
    ])
  })

  it('移除命令三时机事件：执行/undo/redo 各触发一次且载荷为格坐标', () => {
    const sheet = new Sheet()
    sheet.insertCellImage({ row: 4, col: 1 }, { src: 'https://example.com/r.png' })
    const events = collectEvents(sheet)

    sheet.removeCellImage({ row: 4, col: 1 })
    expect(events).toEqual([{ addr: { row: 4, col: 1 } }])

    sheet.undo()
    expect(events).toEqual([{ addr: { row: 4, col: 1 } }, { addr: { row: 4, col: 1 } }])

    sheet.redo()
    expect(events).toEqual([
      { addr: { row: 4, col: 1 } },
      { addr: { row: 4, col: 1 } },
      { addr: { row: 4, col: 1 } },
    ])
  })

  it('相同载荷重复插入与无图移除均为无操作：不发事件、不占历史', () => {
    const sheet = new Sheet()
    sheet.insertCellImage({ row: 0, col: 0 }, { src: 'https://example.com/same.png' })
    const events = collectEvents(sheet)

    sheet.insertCellImage({ row: 0, col: 0 }, { src: 'https://example.com/same.png' })
    sheet.removeCellImage({ row: 5, col: 5 })
    expect(events).toEqual([])
    // 两次无操作均未入历史：唯一可撤销项是首次插入
    sheet.undo()
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)
    expect(sheet.undo()).toBe(false)
  })

  it('与插入/删除行列命令组合：图位置与事件一致', () => {
    const sheet = new Sheet()
    sheet.insertCellImage({ row: 2, col: 1 }, { src: 'https://example.com/move.png' })
    const events = collectEvents(sheet)

    // 插入行：图平移到 (5,1)；结构平移无单格坐标，事件为全量刷新变体（addr 缺省）
    sheet.insertRows(0, 3)
    expect(sheet.hasCellImage({ row: 5, col: 1 })).toBe(true)
    expect(sheet.hasCellImage({ row: 2, col: 1 })).toBe(false)
    expect(events).toEqual([{}])

    // 删除列：图平移到 (5,0)，同样全量刷新
    sheet.deleteCols(0, 1)
    expect(sheet.hasCellImage({ row: 5, col: 0 })).toBe(true)
    expect(events).toEqual([{}, {}])

    // undo 删除列 → (5,1)；undo 插入行 → 回到 (2,1)
    sheet.undo()
    expect(sheet.hasCellImage({ row: 5, col: 1 })).toBe(true)
    sheet.undo()
    expect(sheet.hasCellImage({ row: 2, col: 1 })).toBe(true)
    expect(events).toEqual([{}, {}, {}, {}])

    // 结构全还原后撤销插入图命令：事件带原格坐标 (2,1)，模型无图
    sheet.undo()
    expect(sheet.hasCellImage({ row: 2, col: 1 })).toBe(false)
    expect(events).toEqual([{}, {}, {}, {}, { addr: { row: 2, col: 1 } }])

    // redo 插入图命令：回到 (2,1)
    sheet.redo()
    expect(sheet.hasCellImage({ row: 2, col: 1 })).toBe(true)
    expect(events).toEqual([
      {},
      {},
      {},
      {},
      { addr: { row: 2, col: 1 } },
      { addr: { row: 2, col: 1 } },
    ])
  })

  it('setCellImage 语义保持：null / 空载荷等同移除（走移除命令通道）', () => {
    const sheet = new Sheet()
    sheet.setCellImage({ row: 0, col: 0 }, { src: 'https://example.com/legacy.png' })
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(true)

    const events = collectEvents(sheet)
    sheet.setCellImage({ row: 0, col: 0 }, null)
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)
    expect(events).toEqual([{ addr: { row: 0, col: 0 } }])
    sheet.undo()
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(true)

    sheet.setCellImage({ row: 0, col: 0 }, {})
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)
    sheet.undo()
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(true)
  })

  it('合并格：插入/移除均解析锚点', () => {
    const sheet = new Sheet()
    sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } })
    sheet.insertCellImage({ row: 1, col: 1 }, { src: 'https://example.com/merge.png' })
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(true)
    sheet.removeCellImage({ row: 1, col: 0 })
    expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)
  })

  it('SheetGrid 门面透出插入/移除命令入口（模型命令通道，可 undo/redo，事件带格坐标）', () => {
    const { grid, sheet } = createGrid()
    try {
      const handler = vi.fn<(payload: { addr?: { row: number; col: number } }) => void>()
      sheet.on('cell-image-change', handler)

      grid.insertCellImage({ row: 1, col: 2 }, { src: 'https://example.com/facade.png' })
      // 门面写的就是模型命令通道
      expect(sheet.getCellImage({ row: 1, col: 2 })).toEqual({
        src: 'https://example.com/facade.png',
      })
      expect(handler).toHaveBeenLastCalledWith({ addr: { row: 1, col: 2 } })

      expect(sheet.undo()).toBe(true)
      expect(sheet.hasCellImage({ row: 1, col: 2 })).toBe(false)
      expect(handler).toHaveBeenLastCalledWith({ addr: { row: 1, col: 2 } })
      expect(sheet.redo()).toBe(true)
      expect(sheet.hasCellImage({ row: 1, col: 2 })).toBe(true)

      grid.removeCellImage({ row: 1, col: 2 })
      expect(sheet.hasCellImage({ row: 1, col: 2 })).toBe(false)
      expect(handler).toHaveBeenLastCalledWith({ addr: { row: 1, col: 2 } })
      expect(handler).toHaveBeenCalledTimes(4)
    } finally {
      grid.release()
    }
  })
})
