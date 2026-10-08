// sheet 插件对象装配测试：TablePlugin 契约、单表/书两种形态的 mount 接线
// （撤销记录、填充生成、选区同步）、handle 操作面（writeValues/快照/边框/xlsx 通道）。
// 各能力模块的单元语义由同目录深路径测试覆盖，此处只验证插件装配路径。

import { describe, expect, it } from 'vitest'

import { SceneNode } from '@infinitable/render'
import type { SceneEvent, SceneEventType } from '@infinitable/render'

import {
  EditorRegistry,
  ListTable,
  type SelectionSnapshot,
  type TablePlugin,
} from '@infinitable/core'

import { createSheetPlugin } from '../../src/sheet/sheet-plugin'
import { createFakeDoc } from '../testing/fake-editor-dom'
import { StubHost } from '../testing/stub-host'

/** 绕过 EventSystem 直接在场景根上派发事件（对齐 core 交互测试做法） */
function fire(root: SceneNode, type: SceneEventType, x: number, y: number): void {
  root.handleEvent({
    type,
    target: null,
    x,
    y,
    deltaX: 0,
    deltaY: 0,
    key: undefined,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    originalEvent: {},
  } as SceneEvent)
}

/** 单表形态装配：插件持有唯一 Store，宿主自建表并经 plugins 挂载 */
function setupSingle(options: Parameters<typeof createSheetPlugin>[0] = {}) {
  const sheet = createSheetPlugin({ store: { rowCount: 50, colCount: 5 }, ...options })
  const store = sheet.store!
  const host = new StubHost()
  const editorRegistry = new EditorRegistry()
  editorRegistry.registerEditor('text', {})
  const table = new ListTable({
    width: 600,
    height: 300,
    rowHeight: 32,
    headerHeight: 36,
    rowHeaderWidth: 48,
    columns: [{ field: 'c0', editor: 'text' }, { field: 'c1' }],
    model: store.asModel(),
    host,
    editorRegistry,
    plugins: [sheet],
  })
  return { sheet, store, host, table, root: host.layers.get('body')!.root }
}

describe('sheet 插件：契约与单表形态', () => {
  it('满足 TablePlugin 契约（name + mount/unmount）；store/createStore 可用', () => {
    const sheet = createSheetPlugin({ store: { rowCount: 3, colCount: 2 } })
    const plugin: TablePlugin = sheet
    expect(plugin.name).toBe('sheet')
    expect(typeof plugin.mount).toBe('function')
    expect(typeof plugin.unmount).toBe('function')
    expect(sheet.store?.getRowCount()).toBe(3)

    const created = sheet.createStore({ rowCount: 7, colCount: 4 })
    expect(created.getRowCount()).toBe(7)
    expect(sheet.store).not.toBe(created)
  })

  it('mount 接线引擎编辑撤销：编辑提交入栈，undo/redo 回写 Store 并刷新表格', () => {
    const { sheet, store, table } = setupSingle()
    const fake = createFakeDoc()
    const globalDoc = globalThis as { document?: unknown }
    const previous = globalDoc.document
    globalDoc.document = fake.doc
    try {
      store.setValue(0, 0, 'old')
      expect(sheet.canUndo).toBe(false)

      expect(table.startEdit(0, 0)).toBe(true)
      fake.created[0]!.value = 'new'
      expect(table.commitEdit()).toBe(true)
      expect(store.getValue(0, 0)).toBe('new')
      expect(sheet.canUndo).toBe(true)

      sheet.undo()
      expect(store.getValue(0, 0)).toBe('old')
      expect(table.getCellText(0, 0)).toBe('old')
      // 撤销回写不走编辑会话，不产生新命令
      sheet.redo()
      expect(store.getValue(0, 0)).toBe('new')
      sheet.clearHistory()
      expect(sheet.canUndo).toBe(false)
      expect(sheet.canRedo).toBe(false)
    } finally {
      globalDoc.document = previous
    }
  })

  it('mount 接线填充生成：拖拽填充柄写扩展区（撤销化），undo 整体回退', () => {
    const { sheet, store, table, root } = setupSingle()
    store.setValue(0, 0, 5)
    table.selectCell(0, 0)

    // 填充柄在格 (0,0) 右下角（144..148 × 64..68）；拖到格 (0,3) 中心
    fire(root, 'pointerdown', 146, 66)
    fire(root, 'pointermove', 98, 148)
    fire(root, 'pointerup', 98, 148)

    expect(store.getValue(0, 1)).toBe(6)
    expect(store.getValue(0, 3)).toBe(8)
    sheet.undo()
    expect(store.getValue(0, 1)).toBeUndefined()
    expect(store.getValue(0, 3)).toBeUndefined()
  })

  it('readonly 形态：mount 不接写路径（填充拖拽不写值、无撤销命令）', () => {
    const { sheet, store, table, root } = setupSingle({ readonly: true })
    store.setValue(0, 0, 5)
    table.selectCell(0, 0)

    fire(root, 'pointerdown', 146, 66)
    fire(root, 'pointermove', 98, 148)
    fire(root, 'pointerup', 98, 148)

    expect(store.getValue(0, 1)).toBeUndefined()
    expect(sheet.canUndo).toBe(false)
  })

  it('writeValues：同格末次为准、等值格不入命令；undo/redo 整体往返', () => {
    const { sheet, store } = setupSingle()
    store.setValue(1, 0, 1)
    sheet.writeValues(store, [
      { col: 0, row: 0, value: 'a' },
      { col: 0, row: 0, value: 'b' },
      { col: 1, row: 0, value: 1 },
    ])
    expect(store.getValue(0, 0)).toBe('b')
    expect(sheet.canUndo).toBe(true)
    sheet.undo()
    expect(store.getValue(0, 0)).toBeUndefined()
    sheet.redo()
    expect(store.getValue(0, 0)).toBe('b')

    // 全部等值：不产生命令
    sheet.clearHistory()
    sheet.writeValues(store, [{ col: 0, row: 0, value: 'b' }])
    expect(sheet.canUndo).toBe(false)
  })

  it('selectionSync 接线：表格选区驱动 apply；syncSelectionFromExternal 回流', () => {
    const applied: SelectionSnapshot[] = []
    let external: SelectionSnapshot = { ranges: [], focus: null }
    const { sheet, table } = setupSingle({
      selectionSync: { apply: (selection) => applied.push(selection), get: () => external },
    })

    table.selectCell(0, 0)
    expect(applied).toHaveLength(1)

    external = {
      ranges: [{ start: { col: 1, row: 1 }, end: { col: 1, row: 1 } }],
      focus: { col: 1, row: 1 },
    }
    sheet.syncSelectionFromExternal()
    expect(table.getSelection().focus).toEqual({ col: 1, row: 1 })
    // 回流不广播（applyExternalSelection 语义），不触发 apply
    expect(applied).toHaveLength(1)
  })

  it('快照操作面：saveSnapshot 采集 / restoreSnapshot 灌回（值/样式往返）', () => {
    const { sheet, store } = setupSingle()
    store.setValue(0, 0, 'v0')
    store.setStyle(0, 0, { fontWeight: 700 })
    const snap = sheet.saveSnapshot(store)
    expect(snap.cells).toEqual([{ col: 0, row: 0, value: 'v0' }])

    store.setValue(0, 0, 'changed')
    store.clearStyle(0, 0)
    store.setValue(1, 1, 'extra')
    sheet.restoreSnapshot(store, snap)
    expect(store.getValue(0, 0)).toBe('v0')
    expect(store.getStyle(0, 0)?.fontWeight).toBe(700)
    expect(store.getValue(1, 1)).toBeUndefined()
  })

  it('边框与 xlsx 通道：borderEdge/borderCells/exportSheet/decodeImage 达成散装能力', () => {
    const { sheet, store } = setupSingle()
    expect(sheet.borderEdge('medium', '#fff')).toEqual({ width: 2, color: '#fff' })
    expect(
      sheet.borderCells({ minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 }, 'outer', {
        width: 1,
        color: '#000',
      }),
    ).toHaveLength(1)

    store.setValue(0, 0, 42)
    const writeSheet = sheet.exportSheet({ name: 'demo', store })
    expect(writeSheet.name).toBe('demo')
    expect(writeSheet.rows?.[0]?.[0]).toBe(42)

    const payload = sheet.decodeImage('data:image/png;base64,iVBORw0KGgo=')
    expect(payload?.type).toBe('png')
    expect(payload?.data.byteLength).toBeGreaterThan(0)
    expect(sheet.decodeImage('https://example.com/a.png')).toBeUndefined()
  })
})

describe('sheet 插件：书形态（多 sheet 实例池）', () => {
  function setupBook() {
    const hosts: StubHost[] = []
    const sheet = createSheetPlugin({
      createHost: () => {
        const host = new StubHost()
        hosts.push(host)
        return { host }
      },
    })
    const storeA = sheet.createStore({ rowCount: 20, colCount: 3 })
    storeA.setValue(0, 0, 'A1')
    const storeB = sheet.createStore({ rowCount: 20, colCount: 3 })
    sheet.registerSheet({ id: 'a', store: storeA })
    sheet.registerSheet({ id: 'b', store: storeB })
    return { sheet, hosts, storeA, storeB }
  }

  it('switchTo 惰性建表并自动挂载插件：值可达、编辑撤销接线生效、事件抛出', () => {
    const { sheet, storeA } = setupBook()
    const events: { activeId: string | null; created: boolean }[] = []
    const off = sheet.onSheetChange((event) =>
      events.push({ activeId: event.activeId, created: event.created }),
    )

    expect(sheet.activeTable()).toBeNull()
    const table = sheet.switchTo('a')
    expect(sheet.activeId).toBe('a')
    expect(sheet.activeTable()).toBe(table)
    expect(sheet.activeStore()).toBe(storeA)
    expect(table.getCellText(0, 0)).toBe('A1')
    expect(events).toEqual([{ activeId: 'a', created: true }])

    // 建表即挂插件：writeValues 的命令可在该实例上撤销（撤销栈为插件级共享面）
    sheet.writeValues(storeA, [{ col: 1, row: 1, value: 'x' }])
    expect(sheet.canUndo).toBe(true)
    sheet.undo()
    expect(storeA.getValue(1, 1)).toBeUndefined()

    // 同 id 复用实例；未注册 id 抛错
    expect(sheet.switchTo('a')).toBe(table)
    expect(() => sheet.switchTo('missing')).toThrow(/unknown sheet id/)
    off()
  })

  it('removeSheet 销毁实例并摘 mount 接线；dispose 清空实例池（定义保留可重建）', () => {
    const { sheet, hosts } = setupBook()
    sheet.switchTo('a')
    sheet.switchTo('b')
    expect(hosts).toHaveLength(2)

    sheet.removeSheet('a')
    expect(sheet.has('a')).toBe(false)
    expect(sheet.get('a')).toBeUndefined()

    // 注入式宿主不随实例销毁（所有权在注入方）；dispose 清池后再切换重建出新实例
    sheet.dispose()
    expect(sheet.get('b')).toBeUndefined()
    sheet.switchTo('b')
    expect(hosts).toHaveLength(3)
  })

  it('构造期底座注入：Excel 键位默认启用，excelKeys:false 关闭；evaluate 注入公式显示', () => {
    const build = (pluginOptions: Parameters<typeof createSheetPlugin>[0]) => {
      const sheet = createSheetPlugin({
        createHost: () => ({ host: new StubHost() }),
        ...pluginOptions,
      })
      sheet.registerSheet({ id: 'a', store: sheet.createStore({ rowCount: 5, colCount: 2 }) })
      return sheet.switchTo('a')
    }
    const table = build({})
    expect(table.options.editCellOnEnter).toBe(true)
    expect(table.options.ctrlMultiSelect).toBe(false)

    const tableNoKeys = build({ excelKeys: false })
    expect(tableNoKeys.options.editCellOnEnter).toBeUndefined()
    expect(tableNoKeys.options.ctrlMultiSelect).toBeUndefined()

    const tableEval = build({ evaluate: () => 'E' })
    expect(tableEval.options.resolveDisplayValue?.(0, 0, '=1+1')).toBe('E')
    // 宿主统一 tableOptions / 单表 def options 覆盖底座
    const tableOverride = build({ tableOptions: { ctrlMultiSelect: true } })
    expect(tableOverride.options.editCellOnEnter).toBe(true)
    expect(tableOverride.options.ctrlMultiSelect).toBe(true)
  })
})
