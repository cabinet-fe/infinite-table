// 打印预览 DOM 薄壳单测（P3，happy-dom）：弹层结构（缩略列表页数/指示行/放大预览
// iframe 装载当前页）、缩略切换、打印按钮触发注入的 print 钩子（经 printPages 汇点）、
// 关闭三入口（ESC/关闭按钮/handle.close）幂等清理、空表兜底单页。

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { openPrintPreview } from '../../src/print/preview'
import type { PrintSource } from '../../src/print/types'

/** 数据行高/表头行高 32px；表头 1 行 + 50 数据行 */
const ROW_HEIGHT = 32
const DATA_ROWS = 50
const SOURCE: PrintSource = {
  name: '预览测试表',
  rowCount: 1 + DATA_ROWS,
  colCount: 3,
  rowHeight: () => ROW_HEIGHT,
  colWidth: () => 120,
  merges: () => [],
  cellValue: () => undefined,
  cellStyle: () => undefined,
  displayValue: (col, row) => (row === 0 ? `表头${col}` : `r${row}c${col}`),
}

// 自定义纸 200×200mm、零边距：可用高 ≈ 755.9 − 页脚 32 − 表头 32 = 691.9px
// → 每页 21 行（21×32=672 装得下，22×32=704 放不下），50 行 → 3 页
const CONFIG = {
  paperSize: { widthMm: 200, heightMm: 200 },
  margin: 0,
  headerRepeatRows: 1,
  headerFooter: { footer: { center: '第 {page} 页 / 共 {pageCount} 页' } },
}

const EMPTY_SOURCE: PrintSource = {
  ...SOURCE,
  rowCount: 0,
}

function queryOverlay(): HTMLElement {
  const overlay = document.querySelector<HTMLElement>('.print-preview-overlay')
  expect(overlay).not.toBeNull()
  return overlay!
}

describe('openPrintPreview：弹层结构与分页', () => {
  it('打开即见缩略列表（3 页）与第 1 页放大预览（重复表头 + 页脚占位符已求值）', () => {
    const handle = openPrintPreview(SOURCE, CONFIG)
    const overlay = queryOverlay()

    const thumbs = overlay.querySelectorAll<HTMLButtonElement>('.print-preview-thumb')
    expect(thumbs.length).toBe(3)
    expect(thumbs[0]!.classList.contains('active')).toBe(true)

    const indicator = overlay.querySelector<HTMLElement>('.print-preview-indicator')!
    expect(indicator.textContent).toBe('第 1 页 / 共 3 页')

    const frame = overlay.querySelector<HTMLIFrameElement>('iframe')!
    expect(frame.srcdoc).toContain('.print-table')
    // 每页重复表头：第 1 页放大预览含表头行文本
    expect(frame.srcdoc).toContain('表头0')
    // 页脚占位符已按当前页求值
    expect(frame.srcdoc).toContain('第 1 页 / 共 3 页')

    handle.close()
    expect(document.querySelector('.print-preview-overlay')).toBeNull()
  })

  it('点缩略切换当前页：指示行、active 标记与放大预览内容同步', () => {
    const handle = openPrintPreview(SOURCE, CONFIG)
    const overlay = queryOverlay()
    const frame = overlay.querySelector<HTMLIFrameElement>('iframe')!
    const firstDoc = frame.srcdoc

    const thumbs = overlay.querySelectorAll<HTMLButtonElement>('.print-preview-thumb')
    thumbs[1]!.click()

    expect(overlay.querySelector('.print-preview-indicator')!.textContent).toBe('第 2 页 / 共 3 页')
    expect(thumbs[1]!.classList.contains('active')).toBe(true)
    expect(thumbs[0]!.classList.contains('active')).toBe(false)
    expect(frame.srcdoc).not.toBe(firstDoc)
    expect(frame.srcdoc).toContain('第 2 页 / 共 3 页')
    // 重复表头在每一页都出现
    expect(frame.srcdoc).toContain('表头0')

    handle.close()
    expect(document.querySelector('.print-preview-overlay')).toBeNull()
  })

  it('空表兜底：单页缩略（标注空表），放大预览装载整文档', () => {
    const handle = openPrintPreview(EMPTY_SOURCE, CONFIG)
    const overlay = queryOverlay()

    const thumbs = overlay.querySelectorAll<HTMLButtonElement>('.print-preview-thumb')
    expect(thumbs.length).toBe(1)
    expect(thumbs[0]!.textContent).toContain('空表')
    expect(overlay.querySelector('.print-preview-indicator')!.textContent).toBe('第 1 页 / 共 1 页')
    expect(overlay.querySelector<HTMLIFrameElement>('iframe')!.srcdoc).toContain('.print-table')

    handle.close()
    expect(document.querySelector('.print-preview-overlay')).toBeNull()
  })
})

describe('openPrintPreview：打印与关闭', () => {
  it('打印按钮触发注入的 print 钩子一次（经 printPages，装载完整打印文档）', async () => {
    const calls: HTMLIFrameElement[] = []
    const handle = openPrintPreview(SOURCE, CONFIG, {
      print: (iframe) => {
        calls.push(iframe)
        expect(iframe.srcdoc).toContain('<table class="print-table">')
      },
    })
    const overlay = queryOverlay()

    overlay.querySelector<HTMLButtonElement>('.print-preview-print')!.click()
    await vi.waitFor(() => {
      expect(calls.length).toBe(1)
    })

    // 打印不关预览（可继续翻页/再次打印），弹层仍在
    expect(document.querySelector('.print-preview-overlay')).not.toBeNull()
    handle.close()
    expect(document.querySelector('.print-preview-overlay')).toBeNull()
  })

  it('ESC 与关闭按钮均可关闭，handle.close 幂等', () => {
    const escHandle = openPrintPreview(SOURCE, CONFIG)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('.print-preview-overlay')).toBeNull()
    escHandle.close()
    expect(document.querySelector('.print-preview-overlay')).toBeNull()

    const buttonHandle = openPrintPreview(SOURCE, CONFIG)
    queryOverlay().querySelector<HTMLButtonElement>('.print-preview-close')!.click()
    expect(document.querySelector('.print-preview-overlay')).toBeNull()
    buttonHandle.close()
  })
})
