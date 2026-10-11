// 图片超链接（hyperlink-image P6）：SheetImage 与嵌入图载荷（CellImagePayload）的
// link 字段写入/读取/清除；设置/清除走既有 updateImage 类命令通道（sheet.update-image
// / sheet.insert-cell-image，不另开命令种类），可 undo/redo；link 随快照序列化同步。

import { describe, expect, it } from 'vitest'

import type { ImageInput } from '../../src/core/image'
import { Sheet } from '../../src/core/sheet'

function pngBytes(tag = 1): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, tag, 0, 0, 0])
}

function makeInput(overrides: Partial<ImageInput> = {}): ImageInput {
  return {
    data: pngBytes(),
    type: 'png',
    anchor: { from: { row: 1, col: 2 } },
    width: 100,
    height: 80,
    ...overrides,
  }
}

describe('浮动图 link 字段：updateImage 命令通道', () => {
  it('insertImage 携带 link → 读取命中', () => {
    const sheet = new Sheet()
    const id = sheet.insertImage(makeInput({ link: 'https://example.com/a' }))
    expect(sheet.getImage(id)?.link).toBe('https://example.com/a')
  })

  it('updateImage 写入 link → undo 清除（恢复无 link）→ redo 恢复', () => {
    const sheet = new Sheet()
    const id = sheet.insertImage(makeInput())
    expect(sheet.getImage(id)?.link).toBeUndefined()

    sheet.updateImage(id, { link: 'https://example.com/b' })
    expect(sheet.getImage(id)?.link).toBe('https://example.com/b')

    expect(sheet.undo()).toBe(true)
    expect(sheet.getImage(id)?.link).toBeUndefined()

    expect(sheet.redo()).toBe(true)
    expect(sheet.getImage(id)?.link).toBe('https://example.com/b')
  })

  it('updateImage link: null 显式清除 → undo 恢复链接', () => {
    const sheet = new Sheet()
    const id = sheet.insertImage(makeInput({ link: 'https://example.com/c' }))
    sheet.updateImage(id, { link: null })
    expect(sheet.getImage(id)?.link).toBeUndefined()

    expect(sheet.undo()).toBe(true)
    expect(sheet.getImage(id)?.link).toBe('https://example.com/c')

    expect(sheet.redo()).toBe(true)
    expect(sheet.getImage(id)?.link).toBeUndefined()
  })

  it('link 同值写入无变更：不入历史', () => {
    const sheet = new Sheet()
    const id = sheet.insertImage(makeInput({ link: 'https://example.com/same' }))
    sheet.updateImage(id, { link: 'https://example.com/same' })
    expect(sheet.canUndo).toBe(true) // 仅 insertImage 一条历史
    sheet.undo()
    expect(sheet.getImages()).toHaveLength(0)
    sheet.updateImage(id, { link: null })
    expect(sheet.getImage(id)).toBeUndefined() // 图已删，无操作
  })

  it('link 随快照序列化 roundtrip 保留', () => {
    const sheet = new Sheet()
    sheet.insertImage(makeInput({ id: 'linked', link: 'https://example.com/snap' }))

    const snapshot = sheet.snapshot()
    const restored = new Sheet()
    restored.restore(snapshot)
    expect(restored.getImage('linked')?.link).toBe('https://example.com/snap')
  })
})

describe('嵌入图 link 字段：insert-cell-image 命令通道', () => {
  it('载荷携带 link → 读取命中', () => {
    const sheet = new Sheet()
    sheet.insertCellImage({ row: 1, col: 2 }, { src: 'blob:a', link: 'https://example.com/x' })
    expect(sheet.getCellImage({ row: 1, col: 2 })).toEqual({
      src: 'blob:a',
      link: 'https://example.com/x',
    })
  })

  it('写入 link → undo 清除（恢复无 link 载荷）→ redo 恢复', () => {
    const sheet = new Sheet()
    sheet.insertCellImage({ row: 0, col: 0 }, { src: 'blob:b' })

    sheet.insertCellImage({ row: 0, col: 0 }, { src: 'blob:b', link: 'https://example.com/y' })
    expect(sheet.getCellImage({ row: 0, col: 0 })?.link).toBe('https://example.com/y')

    expect(sheet.undo()).toBe(true)
    expect(sheet.getCellImage({ row: 0, col: 0 })).toEqual({ src: 'blob:b' })

    expect(sheet.redo()).toBe(true)
    expect(sheet.getCellImage({ row: 0, col: 0 })?.link).toBe('https://example.com/y')
  })

  it('清除 link（重设无 link 载荷，图与 fit 保留）→ undo 恢复链接', () => {
    const sheet = new Sheet()
    sheet.insertCellImage(
      { row: 2, col: 3 },
      { src: 'blob:c', fit: 'contain', link: 'https://example.com/z' },
    )

    sheet.insertCellImage({ row: 2, col: 3 }, { src: 'blob:c', fit: 'contain' })
    expect(sheet.getCellImage({ row: 2, col: 3 })).toEqual({ src: 'blob:c', fit: 'contain' })

    expect(sheet.undo()).toBe(true)
    expect(sheet.getCellImage({ row: 2, col: 3 })).toEqual({
      src: 'blob:c',
      fit: 'contain',
      link: 'https://example.com/z',
    })
  })
})
