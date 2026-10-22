// 打印插件单测（happy-dom）：TablePlugin 契约（name/mount 记录挂载引擎、无引擎侧
// 副作用）、handle 方法与包内深路径实现逐字节同产物（分页/文档构建委托）、基线
// config 回落、print/openPreview 触 DOM 链路经 options.hooks 注入桩、引擎协议面
// 供数（装配协议导出读取面 → PrintSource，G12-G15）。

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { ListTable, type EngineAssembly } from '@infinitable/table'

import { createEnginePrintSource } from '../../src/print/engine-source'
import { createPrintPlugin } from '../../src/print/print-plugin'
import { buildPrintDocumentHtml } from '../../src/print/page-html'
import { paginate } from '../../src/print/paginate'
import type { PrintSource } from '../../src/print/types'
import { StubHost } from '../testing/stub-host'

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

/** 构造挂载目标引擎（协议实现；2×3 数据格 + 一个合并区） */
function createEngine(): EngineAssembly {
  const host = new StubHost()
  const table = new ListTable({
    width: 400,
    height: 200,
    columns: [
      { field: 'a', title: 'a', width: 100 },
      { field: 'b', title: 'b', width: 120 },
    ],
    records: [
      { a: 'a0', b: 'b0' },
      { a: 'a1', b: 'b1' },
      { a: 'a2', b: 'b2' },
    ],
    rowHeight: 28,
    mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
    host,
  })
  return table
}

describe('createPrintPlugin 插件契约', () => {
  it('name + mount 满足 TablePlugin 契约，mount 仅记录挂载引擎（无引擎侧副作用）', () => {
    const plugin = createPrintPlugin({ source: SOURCE })
    expect(plugin.name).toBe('print')
    expect(typeof plugin.mount).toBe('function')
    // headless 插件不接线引擎挂点：mount 传协议面桩不抛错
    expect(() => plugin.mount({} as EngineAssembly)).not.toThrow()
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

describe('引擎协议面供数（装配协议导出读取面，G12-G15）', () => {
  it('createEnginePrintSource 经 engine.read 适配 PrintSource：字段逐项映射', () => {
    const engine = createEngine()
    const source = createEnginePrintSource(engine, { name: '引擎供数' })
    expect(source.name).toBe('引擎供数')
    expect(source.rowCount).toBe(3)
    expect(source.colCount).toBe(2)
    expect(source.rowHeight(0)).toBe(28)
    expect(source.colWidth(1)).toBe(120)
    // 有效数据：displayValue 走取值管线、cellValue 为原始值、合并区几何区间
    expect(source.displayValue(0, 1)).toBe('a1')
    expect(source.cellValue(0, 1)).toBe('a1')
    expect(source.merges()).toEqual([{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }])
    // 有效样式：主题投影链产物（table 恒有样式）
    expect(source.cellStyle(0, 1)?.font).toBeTruthy()
    engine.destroy()
  })

  it('挂载引擎供数：无显式 source 时 handle 方法经挂载引擎的读取面供数', () => {
    const engine = createEngine()
    const plugin = createPrintPlugin({})
    plugin.mount(engine)
    // 与手工按读取面构造的 source 同产物（分页逐字节一致）
    const expected = paginate(createEnginePrintSource(engine), CONFIG)
    expect(plugin.paginate(CONFIG)).toEqual(expected)
    // 显式 source 优先于挂载引擎
    const explicit = createPrintPlugin({ source: SOURCE })
    explicit.mount(engine)
    expect(explicit.paginate(CONFIG)).toEqual(paginate(SOURCE, CONFIG))
    plugin.unmount?.(engine)
    engine.destroy()
  })

  it('可供数源缺失 fail-fast：无 source 且未挂载（或挂载后卸载）时 handle 方法抛错', () => {
    const plugin = createPrintPlugin({})
    expect(() => plugin.paginate(CONFIG)).toThrow(/可供数源/)
    const engine = createEngine()
    plugin.mount(engine)
    plugin.unmount?.(engine)
    expect(() => plugin.paginate(CONFIG)).toThrow(/可供数源/)
    engine.destroy()
  })

  it('引擎未提供导出读取面（engine.read 缺失）时适配抛错', () => {
    const bare = {} as EngineAssembly
    expect(() => createEnginePrintSource(bare)).toThrow(/导出读取面/)
    const plugin = createPrintPlugin({})
    plugin.mount(bare)
    expect(() => plugin.buildDocumentHtml(CONFIG)).toThrow(/可供数源/)
  })
})
