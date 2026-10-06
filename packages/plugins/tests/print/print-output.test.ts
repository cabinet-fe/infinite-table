// 打印输出单测（P2，happy-dom）：printPages 隐藏 iframe 装载文档、print 钩子注入替换
// 真实 print、结束后 iframe 清理（幂等）。headless 构建函数不触 DOM 的断言在
// page-html/header-footer 测试（node 环境跑通即证明）。

// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { buildPrintDocumentHtml } from '../../src/print/page-html'
import { printPages } from '../../src/print/print-output'
import type { PrintSource } from '../../src/print/types'

const SOURCE: PrintSource = {
  name: '打印输出测试',
  rowCount: 2,
  colCount: 2,
  rowHeight: () => 28,
  colWidth: () => 100,
  merges: () => [],
  cellValue: () => undefined,
  cellStyle: () => undefined,
  displayValue: (col, row) => `v${row}-${col}`,
}

describe('printPages：iframe 装载与清理', () => {
  it('print 钩子被调用一次，iframe 内装载打印文档，结束后 iframe 已移除', async () => {
    const calls: string[] = []
    await printPages(
      SOURCE,
      {},
      {
        print: (iframe) => {
          calls.push('print')
          // 装载内容 = headless 构建产物（srcdoc 全文）
          expect(iframe.srcdoc).toBe(buildPrintDocumentHtml(SOURCE, {}))
          expect(iframe.srcdoc).toContain('<table class="print-table">')
          // 打印时机 iframe 仍挂在文档上（隐藏态）
          expect(document.body.contains(iframe)).toBe(true)
        },
      },
    )
    expect(calls).toEqual(['print'])
    expect(document.body.querySelector('iframe')).toBeNull()
  })

  it('print 钩子抛错时同样清理 iframe（finally 兜底）', async () => {
    await expect(
      printPages(
        SOURCE,
        {},
        {
          print: () => {
            throw new Error('打印取消')
          },
        },
      ),
    ).rejects.toThrow('打印取消')
    expect(document.body.querySelector('iframe')).toBeNull()
  })
})
