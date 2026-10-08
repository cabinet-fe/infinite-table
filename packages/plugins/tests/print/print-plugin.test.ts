// 打印插件单测（happy-dom）：TablePlugin 契约（name/mount 占位无表侧副作用）、
// handle 方法与包内深路径实现逐字节同产物（分页/文档构建委托）、基线 config 回落、
// print/openPreview 触 DOM 链路经 options.hooks 注入桩。

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { createPrintPlugin } from '../../src/print/print-plugin'
import { buildPrintDocumentHtml } from '../../src/print/page-html'
import { paginate } from '../../src/print/paginate'
import type { PrintSource } from '../../src/print/types'

const SOURCE: PrintSource = {
  name: '打印插件测试',
  rowCount: 3,
  colCount: 2,
  rowHeight: () => 28,
  colWidth: () => 100,
  merges: () => [],
  cellValue: () => undefined,
  cellStyle: () => undefined,
  displayValue: (col, row) => `v${row}-${col}`,
}

const CONFIG = { paperSize: { widthMm: 200, heightMm: 200 }, margin: 0 }

describe('createPrintPlugin 插件契约', () => {
  it('name + mount 满足 TablePlugin 契约，mount 为无表侧副作用的占位', () => {
    const plugin = createPrintPlugin({ source: SOURCE })
    expect(plugin.name).toBe('print')
    expect(typeof plugin.mount).toBe('function')
    // headless 插件不接线表格挂点：mount 传任意表格桩不抛错
    expect(() => plugin.mount({} as Parameters<typeof plugin.mount>[0])).not.toThrow()
  })

  it('paginate/buildDocumentHtml 与深路径实现同参数同产物', () => {
    const plugin = createPrintPlugin({ source: SOURCE })
    expect(plugin.paginate(CONFIG)).toEqual(paginate(SOURCE, CONFIG))
    expect(plugin.buildDocumentHtml(CONFIG)).toBe(buildPrintDocumentHtml(SOURCE, CONFIG))
  })

  it('未显式传 config 的调用回落 options.config 基线', () => {
    const plugin = createPrintPlugin({ source: SOURCE, config: CONFIG })
    expect(plugin.buildDocumentHtml()).toBe(buildPrintDocumentHtml(SOURCE, CONFIG))
    // 逐次覆盖优先于基线（演示区按控件合成配置的形态）
    expect(plugin.paginate({ ...CONFIG, headerRepeatRows: 1 })).toEqual(
      paginate(SOURCE, { ...CONFIG, headerRepeatRows: 1 }),
    )
  })
})

describe('print / openPreview 触 DOM 入口', () => {
  it('print 经 options.hooks 注入桩调起一次，结束后清理 iframe', async () => {
    const calls: string[] = []
    const plugin = createPrintPlugin({
      source: SOURCE,
      config: CONFIG,
      hooks: {
        print: (iframe) => {
          calls.push('print')
          expect(iframe.srcdoc).toBe(buildPrintDocumentHtml(SOURCE, CONFIG))
        },
      },
    })
    await plugin.print()
    expect(calls).toEqual(['print'])
    expect(document.body.querySelector('iframe')).toBeNull()
  })

  it('openPreview 打开弹层（缩略 + 放大预览），handle.close 清理', () => {
    const plugin = createPrintPlugin({ source: SOURCE })
    const handle = plugin.openPreview(CONFIG)
    const overlay = document.querySelector<HTMLElement>('.print-preview-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay!.querySelectorAll('.print-preview-thumb').length).toBe(1)
    expect(overlay!.querySelector<HTMLIFrameElement>('iframe')!.srcdoc).toContain('.print-table')
    handle.close()
    expect(document.querySelector('.print-preview-overlay')).toBeNull()
  })

  it('预览内打印按钮汇到 options.hooks（print 与预览共用钩子）', async () => {
    const calls: number[] = []
    const plugin = createPrintPlugin({
      source: SOURCE,
      hooks: {
        print: () => {
          calls.push(calls.length)
        },
      },
    })
    const handle = plugin.openPreview(CONFIG)
    document
      .querySelector<HTMLButtonElement>('.print-preview-print')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => {
      expect(calls.length).toBe(1)
    })
    handle.close()
  })
})
