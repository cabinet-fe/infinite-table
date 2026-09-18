import { describe, expect, it } from 'vitest'

import { EditorRegistry, ListTable } from '@infinite-table/core'

import { SheetStore } from '../../src/sheet/sheet-store'
import { UndoStack, bindCellChangeUndo } from '../../src/sheet/undo'
import { createFakeDoc } from '../testing/fake-editor-dom'
import { StubHost } from '../testing/stub-host'

describe('UndoStack 栈语义', () => {
  it('push/undo/redo 往返；空栈空操作；canUndo/canRedo', () => {
    const stack = new UndoStack()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
    stack.undo()
    stack.redo()

    const log: string[] = []
    stack.push({
      undo: () => log.push('undo'),
      redo: () => log.push('redo'),
    })
    expect(stack.canUndo).toBe(true)
    stack.undo()
    expect(log).toEqual(['undo'])
    expect(stack.canRedo).toBe(true)
    stack.redo()
    expect(log).toEqual(['undo', 'redo'])
    expect(stack.canUndo).toBe(true)
  })

  it('组合命令：undo 逆序、redo 正序', () => {
    const stack = new UndoStack()
    const log: string[] = []
    stack.push([
      { undo: () => log.push('u1'), redo: () => log.push('r1') },
      { undo: () => log.push('u2'), redo: () => log.push('r2') },
    ])
    stack.undo()
    expect(log).toEqual(['u2', 'u1'])
    stack.redo()
    expect(log).toEqual(['u2', 'u1', 'r1', 'r2'])
  })

  it('新命令清空 redo 分支', () => {
    const stack = new UndoStack()
    stack.push({ undo: () => {}, redo: () => {} })
    stack.undo()
    expect(stack.canRedo).toBe(true)
    stack.push({ undo: () => {}, redo: () => {} })
    expect(stack.canRedo).toBe(false)
  })

  it('超限丢最旧：limit=2 push 3 条后只能撤销最近 2 条', () => {
    const stack = new UndoStack(2)
    const log: string[] = []
    stack.push({ undo: () => log.push('u1'), redo: () => {} })
    stack.push({ undo: () => log.push('u2'), redo: () => {} })
    stack.push({ undo: () => log.push('u3'), redo: () => {} })

    stack.undo()
    stack.undo()
    expect(log).toEqual(['u3', 'u2'])
    // 最旧命令（u1）已被丢弃：第三次 undo 为空操作
    expect(stack.canUndo).toBe(false)
    stack.undo()
    expect(log).toEqual(['u3', 'u2'])
  })

  it('clear 清空双栈', () => {
    const stack = new UndoStack()
    stack.push({ undo: () => {}, redo: () => {} })
    stack.undo()
    stack.clear()
    expect(stack.canUndo).toBe(false)
    expect(stack.canRedo).toBe(false)
  })
})

describe('bindCellChangeUndo 编辑撤销链路', () => {
  function setup() {
    const store = new SheetStore({ rowCount: 20, colCount: 3 })
    const host = new StubHost()
    const editorRegistry = new EditorRegistry()
    editorRegistry.registerEditor('text', {})
    const table = new ListTable({
      width: 400,
      height: 200,
      columns: [{ field: 'name', title: 'Name', editor: 'text' }],
      model: store.asModel(),
      host,
      editorRegistry,
    })
    const fake = createFakeDoc()
    const globalDoc = globalThis as { document?: unknown }
    const previous = globalDoc.document
    globalDoc.document = fake.doc
    return { store, table, fake, globalDoc, previous }
  }

  it('编辑提交入栈；undo/redo 回写 Store 并刷新表格；撤销回写不生成新命令', () => {
    const { store, table, fake, globalDoc, previous } = setup()
    globalDoc.document = fake.doc
    try {
      const stack = new UndoStack()
      const binding = bindCellChangeUndo({ table, store, stack })
      store.setValue(0, 0, 'old')

      // 引擎编辑提交：a → b
      expect(table.startEdit(0, 0)).toBe(true)
      fake.created[0]!.value = 'new'
      expect(table.commitEdit()).toBe(true)
      expect(store.getValue(0, 0)).toBe('new')

      // undo：回写旧值，表格同步刷新
      stack.undo()
      expect(store.getValue(0, 0)).toBe('old')
      expect(table.getCellText(0, 0)).toBe('old')

      // 撤销回写不走编辑会话 → 不产生新命令
      expect(stack.canRedo).toBe(true)
      stack.redo()
      expect(store.getValue(0, 0)).toBe('new')
      expect(table.getCellText(0, 0)).toBe('new')

      binding.dispose()
    } finally {
      globalDoc.document = previous
    }
  })
})
