// @vitest-environment happy-dom
// 按格嵌入图（P3）：模型载荷（Cell Meta cell-image namespace）+ SheetGrid 自动接线
// 引擎 resolveCellImage/media 渲染通道（宿主不传 hook）+ fit 缩放 + 查询 API + 结构平移

import '../grid/setup'

import type { ListTable, LoadedImage } from '@infinitable/core'
import { describe, expect, it, vi } from 'vitest'

import { CELL_IMAGE_META_NAMESPACE } from '../../src/core/cell-meta'
import { Sheet } from '../../src/core/sheet'
import { createGrid } from '../grid/grid-test-utils'

/** happy-dom 可能缺 objectURL 实现：测试内补最小桩（同 grid-float-images.test.ts 先例） */
function ensureObjectURLStubs(): void {
  const owner = URL as unknown as Record<string, unknown>
  if (typeof owner.createObjectURL !== 'function') {
    owner.createObjectURL = (): string => `blob:mock-${Math.random().toString(36).slice(2)}`
  }
  if (typeof owner.revokeObjectURL !== 'function') {
    owner.revokeObjectURL = (): void => {}
  }
}

const PNG_BYTES = new Uint8Array([137, 80, 78, 71])

/** 找 (col, row) 的 ImageCellNode（media 层格内图片节点） */
function findImageNode(
  table: ListTable,
  col: number,
  row: number,
): { col: number; row: number; url: string; fit: string } | undefined {
  return [...table.imageCellNodes.values()].find((node) => node.col === col && node.row === row)
}

/** 取 (col, row) 的 ImageCellNode 本体（断言 paint / 几何等实例行为） */
function imageNodeAt(table: ListTable, col: number, row: number) {
  return [...table.imageCellNodes.values()].find((node) => node.col === col && node.row === row)
}

/** 冲一帧 rAF：让渲染宿主的失效队列消费、层 flush 落地 */
const flushFrame = async (): Promise<void> => {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

describe('按格嵌入图：模型 + SheetGrid 自动接线', () => {
  it('设图后该格进入 media 请求并产出 ImageCellNode（宿主未传任何 hook）', () => {
    const { grid, table, sheet } = createGrid()
    try {
      const request = vi.spyOn(table.imageService, 'request').mockReturnValue('idle')
      sheet.setCellImage({ row: 1, col: 2 }, { src: 'https://example.com/a.png' })
      const node = findImageNode(table, 2, 1)
      expect(node).toBeDefined()
      expect(node?.url).toBe('https://example.com/a.png')
      expect(request).toHaveBeenCalledWith('https://example.com/a.png', { col: 2, row: 1 })
    } finally {
      grid.release()
    }
  })

  it('构造期模型已有图的格在引擎首帧装配即产出节点', () => {
    const sheet = new Sheet()
    sheet.setCellImage({ row: 0, col: 1 }, { src: 'https://example.com/init.png' })
    const { grid, table } = createGrid({ sheet })
    try {
      const node = findImageNode(table, 1, 0)
      expect(node).toBeDefined()
      expect(node?.url).toBe('https://example.com/init.png')
    } finally {
      grid.release()
    }
  })

  it('字节来源：转 objectURL 渲染；查询返回字节副本', () => {
    ensureObjectURLStubs()
    const { grid, table, sheet } = createGrid()
    try {
      sheet.setCellImage({ row: 0, col: 0 }, { data: PNG_BYTES, type: 'png' })
      const node = findImageNode(table, 0, 0)
      expect(node).toBeDefined()
      expect(node?.url).toMatch(/^blob:/)
      expect(sheet.getCellImage({ row: 0, col: 0 })?.data).toEqual(PNG_BYTES)
    } finally {
      grid.release()
    }
  })

  it('缩放 fit：缺省 contain 保比例，可配置 fill；URL 不变仅改 fit 时原地生效', () => {
    const { grid, table, sheet } = createGrid()
    try {
      vi.spyOn(table.imageService, 'request').mockReturnValue('idle')
      sheet.setCellImage({ row: 0, col: 0 }, { src: 'https://example.com/fit.png' })
      expect(findImageNode(table, 0, 0)?.fit).toBe('contain')
      sheet.setCellImage({ row: 0, col: 0 }, { src: 'https://example.com/fit.png', fit: 'fill' })
      expect(findImageNode(table, 0, 0)?.fit).toBe('fill')
      sheet.setCellImage({ row: 0, col: 0 }, { src: 'https://example.com/fit.png', fit: 'contain' })
      expect(findImageNode(table, 0, 0)?.fit).toBe('contain')
    } finally {
      grid.release()
    }
  })

  it('清除嵌入图：media 节点摘除，查询落回无图', () => {
    const { grid, table, sheet } = createGrid()
    try {
      vi.spyOn(table.imageService, 'request').mockReturnValue('idle')
      sheet.setCellImage({ row: 0, col: 0 }, { src: 'https://example.com/gone.png' })
      expect(findImageNode(table, 0, 0)).toBeDefined()
      sheet.setCellImage({ row: 0, col: 0 }, null)
      expect(findImageNode(table, 0, 0)).toBeUndefined()
      expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)
    } finally {
      grid.release()
    }
  })

  it('设图/清图命令可 undo：媒体节点与查询随之恢复/回退', () => {
    const { grid, table, sheet } = createGrid()
    try {
      vi.spyOn(table.imageService, 'request').mockReturnValue('idle')
      sheet.setCellImage({ row: 0, col: 0 }, { src: 'https://example.com/undo.png' })
      expect(findImageNode(table, 0, 0)).toBeDefined()
      expect(sheet.undo()).toBe(true)
      expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(false)
      expect(findImageNode(table, 0, 0)).toBeUndefined()
      expect(sheet.redo()).toBe(true)
      expect(sheet.hasCellImage({ row: 0, col: 0 })).toBe(true)
      expect(findImageNode(table, 0, 0)).toBeDefined()
    } finally {
      grid.release()
    }
  })

  it('media 层已存在且位图即时可得：补建节点同帧提交 media 失效并上屏（B1 防回归）', async () => {
    const { grid, table, sheet } = createGrid()
    try {
      vi.spyOn(table.imageService, 'request').mockReturnValue('idle')
      const url = 'https://example.com/readd.png'
      // 首图：惰性建 media 层并留下本格缓存 key 口径（image:col:row:WxH），随后清图
      sheet.setCellImage({ row: 0, col: 0 }, { src: url })
      expect(table.media).toBeDefined()
      const first = imageNodeAt(table, 0, 0)
      expect(first).toBeDefined()
      const cacheKey = `image:0:0:${Math.round(first!.width)}x${Math.round(first!.height)}`
      sheet.setCellImage({ row: 0, col: 0 }, null)
      // 冲一帧：摘除分支的 media 失效消费干净（层队列排空后，无新失效即不重绘）
      await flushFrame()
      expect(findImageNode(table, 0, 0)).toBeUndefined()

      // 位图即时可得：cell 级 mediaCache 预置命中（appendImageCell 首帧直接持真实位图）
      const image = {
        source: { width: 8, height: 8 },
        width: 8,
        height: 8,
      } as unknown as LoadedImage
      table.mediaCache.put(cacheKey, image, 8 * 8 * 4)

      const submit = vi.spyOn(table.host, 'submitInvalidation')
      sheet.setCellImage({ row: 0, col: 0 }, { src: url })
      const node = imageNodeAt(table, 0, 0)
      expect(node).toBeDefined()
      expect(node?.hasBitmap).toBe(true)
      // 补建分支必须同帧提交 media 层 cell 失效（appendChild 不触发失效）
      expect(submit.mock.calls.some(([kind, inv]) => kind === 'media' && inv.type === 'cell')).toBe(
        true,
      )

      // 上屏：位图即时可得时无异步加载回写兜底，靠该失效在下一帧真实绘制本格
      const paint = vi.spyOn(node!, 'paint')
      await flushFrame()
      expect(paint).toHaveBeenCalled()
    } finally {
      grid.release()
    }
  })

  it('查询 API：有图/无图两分支；载荷经 Cell Meta（cell-image namespace）存取', () => {
    const sheet = new Sheet()
    expect(sheet.hasCellImage({ row: 3, col: 3 })).toBe(false)
    expect(sheet.getCellImage({ row: 3, col: 3 })).toBeUndefined()
    sheet.setCellImage({ row: 3, col: 3 }, { src: 'https://example.com/q.png', fit: 'fill' })
    expect(sheet.hasCellImage({ row: 3, col: 3 })).toBe(true)
    expect(sheet.getCellImage({ row: 3, col: 3 })).toEqual({
      src: 'https://example.com/q.png',
      fit: 'fill',
    })
    // 载荷确实落在 Cell Meta 机制上（可序列化、命令通道）
    expect(sheet.getCellMeta({ row: 3, col: 3 }, CELL_IMAGE_META_NAMESPACE)).toEqual({
      src: 'https://example.com/q.png',
      fit: 'fill',
    })
  })

  it('insertRows/deleteCols 后按新坐标查询到该图（字节载荷平移存活，错位即失败）', () => {
    const sheet = new Sheet()
    sheet.setCellImage({ row: 2, col: 1 }, { data: PNG_BYTES, type: 'png' })
    sheet.insertRows(0, 3)
    expect(sheet.hasCellImage({ row: 5, col: 1 })).toBe(true)
    expect(sheet.hasCellImage({ row: 2, col: 1 })).toBe(false)
    expect(sheet.getCellImage({ row: 5, col: 1 })?.data).toEqual(PNG_BYTES)
    sheet.deleteCols(0, 1)
    expect(sheet.hasCellImage({ row: 5, col: 0 })).toBe(true)
    // undo 回放结构反向平移：图逐级回到原坐标，字节仍存活
    sheet.undo()
    expect(sheet.hasCellImage({ row: 5, col: 1 })).toBe(true)
    sheet.undo()
    expect(sheet.hasCellImage({ row: 2, col: 1 })).toBe(true)
    expect(sheet.getCellImage({ row: 2, col: 1 })?.data).toEqual(PNG_BYTES)
  })
})
