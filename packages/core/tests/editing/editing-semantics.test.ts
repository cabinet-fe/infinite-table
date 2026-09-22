// P3 下游语义回归锁定与公开配置接线（表格级，不改实现，纯行为锁定）：
// 1) 编辑会话中方向键不触发 onEditEnd（提交与取消都不触发）且活动格不变（onKeyDown 已让位编辑器）；
// 2) 编辑器字符上限经公开配置（options 级 / 列级覆盖 / 未配置）生效。
// editorMultiline 之外的编辑缺省行为见 edit-manager.test.ts / text-editor.test.ts。

import type { SceneEvent } from '@infinite-table/render'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorRegistry } from '../../src/editor-registry'
import { ListTable } from '../../src/list-table'
import type { EditEndEvent, ListTableOptions } from '../../src/types'
import { createFakeDoc, FakeEditorHost } from '../testing/fake-editor-dom'
import { StubHost } from '../testing/stub-host'

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  rowHeight: 32,
  headerHeight: 36,
  rowHeaderWidth: 48,
  defaultColWidth: 100,
  columns: [
    { field: 'name', title: 'Name', editor: 'text' },
    { field: 'age', title: 'Age', editor: 'text' },
  ],
} satisfies Partial<ListTableOptions>

/** 建可编辑表格（假宿主 + 假容器 + 假文档，node 环境无真实 DOM） */
function createEditingTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const container = new FakeEditorHost()
  const { doc, created } = createFakeDoc()
  vi.stubGlobal('document', doc)
  const registry = new EditorRegistry()
  registry.registerEditor('text', {})
  const records = [
    { name: 'Ada', age: '36' },
    { name: 'Bob', age: '25' },
  ]
  const table = new ListTable({
    ...BASE_OPTIONS,
    records,
    host,
    hostOptions: { container: container as unknown as HTMLElement },
    editorRegistry: registry,
    ...extra,
  })
  return { host, container, table, created, records }
}

/** 在 sky 层场景根派发 keydown（与真实 EventSystem 派发同构的最小事件） */
function fireSkyKeydown(host: StubHost, key: string, shiftKey = false): void {
  host.layers.get('sky')!.root.handleEvent({
    type: 'keydown',
    target: null,
    x: 0,
    y: 0,
    deltaX: 0,
    deltaY: 0,
    key,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    originalEvent: {},
  } as SceneEvent)
}

describe('编辑态方向键语义回归锁定', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('编辑会话中按方向键：不触发 onEditEnd（提交与取消都不触发）、活动格不变、不回写', () => {
    const { host, table, records } = createEditingTable()
    expect(table.startEdit(0, 0)).toBe(true)
    const ends: EditEndEvent[] = []
    table.onEditEnd((event) => ends.push(event))

    // 四向方向键 + shift 扩展路径：场景导航全部让位编辑器（光标移动在编辑器内）
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
      fireSkyKeydown(host, key)
    }
    fireSkyKeydown(host, 'ArrowDown', true)

    expect(ends).toEqual([])
    expect(table.isEditing()).toBe(true)
    expect(table.editManager.editingCell()).toEqual({ col: 0, row: 0 })
    // 活动格（选区焦点）不变：编辑中的方向键不驱动导航移格
    expect(table.getSelection().focus).toEqual({ col: 0, row: 0 })
    expect(records[0]!.name).toBe('Ada')
  })
})

describe('编辑器字符上限（公开配置）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('options 级设定后超限输入截断；列级覆盖 options；未配置不截断', () => {
    // options 级：提交口径超限截断
    const limited = createEditingTable({ editorMaxLength: 3 })
    limited.table.startEdit(0, 0)
    limited.created[0]!.value = 'abcdef'
    limited.table.commitEdit()
    expect(limited.records[0]!.name).toBe('abc')

    // 列级覆盖 options：第 0 列上限 5 优先于 options 3；同表未覆盖列走 options 级
    const overridden = createEditingTable({
      editorMaxLength: 3,
      columns: [
        { field: 'name', title: 'Name', editor: 'text', editorMaxLength: 5 },
        { field: 'age', title: 'Age', editor: 'text' },
      ],
    })
    overridden.table.startEdit(0, 0)
    overridden.created[0]!.value = 'abcdef'
    overridden.table.commitEdit()
    expect(overridden.records[0]!.name).toBe('abcde')
    overridden.table.startEdit(1, 0)
    overridden.created[1]!.value = 'abcdef'
    overridden.table.commitEdit()
    expect(overridden.records[0]!.age).toBe('abc')

    // 未配置：不截断，缺省行为不变
    const unlimited = createEditingTable()
    unlimited.table.startEdit(0, 0)
    unlimited.created[0]!.value = 'abcdef'
    unlimited.table.commitEdit()
    expect(unlimited.records[0]!.name).toBe('abcdef')
  })

  it('初值超限同样截断（open 口径，程序化赋值兜底）', () => {
    const { table, created } = createEditingTable({
      editorMaxLength: 3,
      records: [{ name: 'abcdef', age: '1' }],
    })
    expect(table.startEdit(0, 0)).toBe(true)
    expect(created[0]!.value).toBe('abc')
  })
})
