// @vitest-environment happy-dom
// plugins 侧 happy-dom 挂载安全：SheetStore 模型 + container 挂载 + 渲染帧 + 清理。

import { describe, expect, it } from 'vitest'

import { ListTable } from '@infinite-table/core'
import { SheetStore } from '../../src/sheet/sheet-store'

describe('SheetStore + ListTable happy-dom 挂载', () => {
  it('模型形态挂载 container 不抛错、渲染帧、destroy 清理', () => {
    const store = new SheetStore({ rowCount: 50, colCount: 5 })
    store.setValue(0, 0, 'A1')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: [{ field: 'c0' }, { field: 'c1' }],
      model: store.asModel(),
      hostOptions: { container },
    })
    expect(container.querySelectorAll('canvas').length).toBeGreaterThanOrEqual(2)
    expect(table.getCellText(0, 0)).toBe('A1')
    // 写值 → 模型事件 → 表格局部刷新（DOM 环境全链路）
    store.setValue(1, 1, 'B2')
    expect(table.getCellText(1, 1)).toBe('B2')
    table.destroy()
    expect(container.querySelectorAll('canvas').length).toBe(0)
  })
})
