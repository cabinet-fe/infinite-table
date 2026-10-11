// @vitest-environment happy-dom
// 单元格超链接（P1）：模型载荷（Cell Meta cell-link namespace）+ 可 undo/redo 命令
// + SheetGrid 门面 set/get/clear 透传 + 插入/删除行列载荷随格平移

import '../grid/setup'

import { describe, expect, it } from 'vitest'

import { CELL_LINK_META_NAMESPACE } from '../../src/core/cell-meta'
import { Sheet } from '../../src/core/sheet'
import { createGrid } from '../grid/grid-test-utils'

describe('单元格超链接：模型 + 命令 + SheetGrid 门面', () => {
  it('set→get 命中（URL 与显示文本）；载荷经 Cell Meta（cell-link namespace）存取', () => {
    const sheet = new Sheet()
    expect(sheet.getCellLink({ row: 2, col: 3 })).toBeUndefined()
    sheet.setCellLink({ row: 2, col: 3 }, { url: 'https://example.com', text: '示例' })
    expect(sheet.getCellLink({ row: 2, col: 3 })).toEqual({
      url: 'https://example.com',
      text: '示例',
    })
    // 不带显示文本
    sheet.setCellLink({ row: 1, col: 1 }, { url: 'https://example.com/bare' })
    expect(sheet.getCellLink({ row: 1, col: 1 })).toEqual({ url: 'https://example.com/bare' })
    // 载荷确实落在 Cell Meta 机制上（可序列化、命令通道）
    expect(sheet.getCellMeta({ row: 2, col: 3 }, CELL_LINK_META_NAMESPACE)).toEqual({
      url: 'https://example.com',
      text: '示例',
    })
  })

  it('clear 后 get 为空；link 为 null 或 URL 空白等同清除', () => {
    const sheet = new Sheet()
    sheet.setCellLink({ row: 0, col: 0 }, { url: 'https://example.com' })
    expect(sheet.getCellLink({ row: 0, col: 0 })).toBeDefined()
    sheet.clearCellLink({ row: 0, col: 0 })
    expect(sheet.getCellLink({ row: 0, col: 0 })).toBeUndefined()
    // null / 空白 URL 写入等同清除（对齐 setCellImage 的空载荷语义）
    sheet.setCellLink({ row: 0, col: 0 }, { url: 'https://example.com' })
    sheet.setCellLink({ row: 0, col: 0 }, null)
    expect(sheet.getCellLink({ row: 0, col: 0 })).toBeUndefined()
    sheet.setCellLink({ row: 0, col: 0 }, { url: '   ' })
    expect(sheet.getCellLink({ row: 0, col: 0 })).toBeUndefined()
  })

  it('undo 撤销设置 / redo 恢复', () => {
    const sheet = new Sheet()
    sheet.setCellLink({ row: 1, col: 1 }, { url: 'https://example.com/undo' })
    expect(sheet.getCellLink({ row: 1, col: 1 })).toBeDefined()
    expect(sheet.undo()).toBe(true)
    expect(sheet.getCellLink({ row: 1, col: 1 })).toBeUndefined()
    expect(sheet.redo()).toBe(true)
    expect(sheet.getCellLink({ row: 1, col: 1 })).toEqual({ url: 'https://example.com/undo' })
  })

  it('undo 撤销清除 / redo 恢复', () => {
    const sheet = new Sheet()
    sheet.setCellLink({ row: 1, col: 1 }, { url: 'https://example.com/x', text: '待清' })
    sheet.clearCellLink({ row: 1, col: 1 })
    expect(sheet.getCellLink({ row: 1, col: 1 })).toBeUndefined()
    expect(sheet.undo()).toBe(true)
    expect(sheet.getCellLink({ row: 1, col: 1 })).toEqual({
      url: 'https://example.com/x',
      text: '待清',
    })
    expect(sheet.redo()).toBe(true)
    expect(sheet.getCellLink({ row: 1, col: 1 })).toBeUndefined()
  })

  it('插入/删除行列后载荷随格平移（undo 回放结构反向平移回到原坐标）', () => {
    const sheet = new Sheet()
    sheet.setCellLink({ row: 2, col: 1 }, { url: 'https://example.com/move', text: '平移' })
    sheet.insertRows(0, 3)
    expect(sheet.getCellLink({ row: 5, col: 1 })).toEqual({
      url: 'https://example.com/move',
      text: '平移',
    })
    expect(sheet.getCellLink({ row: 2, col: 1 })).toBeUndefined()
    sheet.deleteCols(0, 1)
    expect(sheet.getCellLink({ row: 5, col: 0 })).toEqual({
      url: 'https://example.com/move',
      text: '平移',
    })
    // undo 回放结构反向平移：链接逐级回到原坐标
    sheet.undo()
    expect(sheet.getCellLink({ row: 5, col: 1 })).toBeDefined()
    sheet.undo()
    expect(sheet.getCellLink({ row: 2, col: 1 })).toEqual({
      url: 'https://example.com/move',
      text: '平移',
    })
  })

  it('合并格：读写均解析锚点', () => {
    const sheet = new Sheet()
    sheet.mergeCells({ start: { row: 0, col: 0 }, end: { row: 1, col: 1 } })
    sheet.setCellLink({ row: 1, col: 1 }, { url: 'https://example.com/merge' })
    expect(sheet.getCellLink({ row: 0, col: 0 })).toEqual({ url: 'https://example.com/merge' })
  })

  it('快照序列化：链接随 meta 快照保存/还原', () => {
    const sheet = new Sheet()
    sheet.setCellLink({ row: 0, col: 0 }, { url: 'https://example.com/snap' })
    const restored = new Sheet()
    restored.restore(sheet.snapshot())
    expect(restored.getCellLink({ row: 0, col: 0 })).toEqual({ url: 'https://example.com/snap' })
  })

  it('SheetGrid 门面透出 set/get/clear（模型命令通道，可 undo/redo）', () => {
    const { grid, sheet } = createGrid()
    try {
      grid.setCellLink({ row: 1, col: 2 }, { url: 'https://example.com/facade', text: '门面' })
      expect(grid.getCellLink({ row: 1, col: 2 })).toEqual({
        url: 'https://example.com/facade',
        text: '门面',
      })
      // 门面写的就是模型命令通道
      expect(sheet.getCellLink({ row: 1, col: 2 })).toEqual({
        url: 'https://example.com/facade',
        text: '门面',
      })
      expect(sheet.undo()).toBe(true)
      expect(grid.getCellLink({ row: 1, col: 2 })).toBeUndefined()
      expect(sheet.redo()).toBe(true)
      grid.clearCellLink({ row: 1, col: 2 })
      expect(grid.getCellLink({ row: 1, col: 2 })).toBeUndefined()
      expect(sheet.getCellLink({ row: 1, col: 2 })).toBeUndefined()
    } finally {
      grid.release()
    }
  })
})
