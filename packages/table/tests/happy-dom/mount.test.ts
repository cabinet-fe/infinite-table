// @vitest-environment happy-dom
// happy-dom 挂载安全（ultra-ui 无 canvas 环境教训）：container 挂载不炸、
// 层 canvas 落容器、destroy 清理、编辑浮层 DOM 路径可用。

import { describe, expect, it } from 'vitest'

import { EditorRegistry } from '../../src/editor-registry'
import { ListTable } from '../../src/list-table'

function mountInContainer() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const table = new ListTable({
    width: 400,
    height: 200,
    columns: [{ field: 'name', title: 'Name', editor: 'text' }],
    records: [{ name: 'a' }],
    hostOptions: { container },
  })
  return { container, table }
}

describe('happy-dom 挂载安全', () => {
  it('container 挂载不抛错；层 canvas 落容器', () => {
    const { container, table } = mountInContainer()
    const canvases = container.querySelectorAll('canvas')
    expect(canvases.length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('[data-layer-kind="body"]')).not.toBeNull()
    expect(container.querySelector('[data-layer-kind="sky"]')).not.toBeNull()
    table.destroy()
  })

  it('destroy 后容器内层 canvas 清理', () => {
    const { container, table } = mountInContainer()
    table.destroy()
    expect(container.querySelectorAll('canvas').length).toBe(0)
  })

  it('可编格 startEdit 走真实 DOM 编辑器路径不抛错', () => {
    const registry = new EditorRegistry()
    registry.registerEditor('text', {})
    const container = document.createElement('div')
    document.body.appendChild(container)
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: [{ field: 'name', title: 'Name', editor: 'text' }],
      records: [{ name: 'a' }],
      hostOptions: { container },
      editorRegistry: registry,
    })
    expect(table.startEdit(0, 0)).toBe(true)
    expect(table.isEditing()).toBe(true)
    expect(container.querySelector('textarea, input')).not.toBeNull()
    expect(table.commitEdit()).toBe(true)
    table.destroy()
  })
})
