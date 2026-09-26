import { describe, expect, it } from 'vitest'

import { CellNode } from '../src/cell-node'
import { EditorRegistry } from '../src/editor-registry'
import { ListTable } from '../src/list-table'
import { createFakeDoc } from './testing/fake-editor-dom'
import { findCellNode } from './testing/find-cell-node'
import { StubHost } from './testing/stub-host'
import type {
  CellChangeEvent,
  EditEndEvent,
  EditStartEvent,
  ListTableOptions,
  TableModel,
} from '../src/types'

/** 同步 echo 的假模型：setCellValue 内同步发变更事件 */
class EchoModel implements TableModel {
  readonly data = new Map<string, unknown>()
  private readonly listeners = new Set<(change: CellChangeEvent) => void>()
  setCalls = 0

  constructor(readonly rowCount: number) {}

  getCellValue(col: number, row: number): unknown {
    return this.data.get(`${col}:${row}`)
  }

  setCellValue(col: number, row: number, value: unknown): void {
    this.setCalls++
    const oldValue = this.data.get(`${col}:${row}`)
    this.data.set(`${col}:${row}`, value)
    this.emit({ col, row, oldValue, newValue: value })
  }

  onCellChange(listener: (change: CellChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 外部变更：直接改数据后发事件（不经表格回驱） */
  emit(change: CellChangeEvent): void {
    for (const listener of this.listeners) {
      listener(change)
    }
  }
}

const BASE_OPTIONS = {
  width: 800,
  height: 600,
  columns: Array.from({ length: 10 }, (_, i) => ({ field: 'name', title: `C${i}` })),
} satisfies Partial<ListTableOptions>

function createTable(extra: Partial<ListTableOptions> = {}) {
  const host = new StubHost()
  const table = new ListTable({ ...BASE_OPTIONS, host, ...extra })
  return { host, table }
}

/** 在 body 场景树中按坐标找节点（递归：表头节点在表头容器内） */
function findNode(host: StubHost, col: number, row: number): CellNode | undefined {
  const body = host.layers.get('body')
  return body ? findCellNode(body.root, col, row) : undefined
}

describe('ListTable 数据供给三形态', () => {
  it('records/columns 数组形态：列定义 field 取值并基础 text 绘制进场景树', () => {
    const { host, table } = createTable({
      columns: [{ field: 'name', title: 'Name' }, { title: 'NoField' }],
      records: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
    })
    expect(table.getCellText(0, 0)).toBe('a')
    expect(table.getCellText(0, 1)).toBe('b')
    expect(findNode(host, 0, 0)?.text).toBe('a')
    // 缺省字段列无值
    expect(table.getCellText(1, 0)).toBe('')
  })

  it('按格 hook 形态：resolveDisplayValue 接入取值管线（纯 hook 行数由 rowCount 供给）', () => {
    const { table } = createTable({
      rowCount: 1000,
      resolveDisplayValue: (col, row) => `R${row}C${col}`,
    })
    expect(table.getCellText(3, 7)).toBe('R7C3')
    expect(table.getVisibleRange().rows).toEqual({ start: 0, end: 18 })
  })

  it('模型事件订阅形态：外部变更 → 局部 cell 失效 + 节点文本更新', () => {
    const model = new EchoModel(100)
    const { host, table } = createTable({ model })
    expect(table.getCellText(0, 0)).toBe('')
    expect(host.submitted).toEqual([{ kind: 'body', inv: { type: 'full' } }])

    host.submitted.length = 0
    model.data.set('0:0', 'ext')
    model.emit({ col: 0, row: 0, oldValue: undefined, newValue: undefined })
    expect(table.getCellText(0, 0)).toBe('ext')
    expect(findNode(host, 0, 0)?.text).toBe('ext')
    // 短文本（30px < 内容盒 84px）不溢出：走廊按文本宽收敛，失效区即本格边界
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 100, height: 32 } } },
    ])
  })

  it('窗口外的模型变更不登记失效', () => {
    const model = new EchoModel(100)
    const { host } = createTable({ model })
    host.submitted.length = 0
    model.emit({ col: 0, row: 99, oldValue: undefined, newValue: undefined })
    expect(host.submitted).toEqual([])
  })

  it('三形态并存：模型值优先，hook 作用于管线末端，records 同在', () => {
    const model = new EchoModel(100)
    model.data.set('0:0', 'model-value')
    const { table } = createTable({
      records: [{ name: 'record-value' }],
      model,
      resolveDisplayValue: (_col, _row, value) => `[${String(value)}]`,
    })
    expect(table.getCellText(0, 0)).toBe('[model-value]')
    // 模型无值的格回退为 undefined，hook 仍生效
    expect(table.getCellText(1, 0)).toBe('[undefined]')
  })

  it('records + hook 并存：hook 拿到字段基础值', () => {
    const { table } = createTable({
      records: [{ name: 'a' }],
      resolveDisplayValue: (_col, _row, value) => `<${String(value)}>`,
    })
    expect(table.getCellText(0, 0)).toBe('<a>')
  })
})

/** 同步重算的假模型：setCellValue 回驱本格外，同步发派生格 (1,0) 的变更（模拟公式依赖重算） */
class RecalcEchoModel extends EchoModel {
  override setCellValue(col: number, row: number, value: unknown): void {
    super.setCellValue(col, row, value)
    if (col === 0 && row === 0) {
      this.data.set('1:0', 'derived')
      this.emit({ col: 1, row: 0, oldValue: undefined, newValue: 'derived' })
    }
  }
}

describe('ListTable 回驱窗口收集刷新', () => {
  it('updateCell 回驱：编辑格 echo 与显式刷新合并去重，本格只刷新一次，不回环', () => {
    const model = new EchoModel(100)
    const { host, table } = createTable({ model })
    host.submitted.length = 0
    table.updateCell(0, 0, 'x')
    expect(model.setCalls).toBe(1)
    expect(model.getCellValue(0, 0)).toBe('x')
    expect(findNode(host, 0, 0)?.text).toBe('x')
    // 编辑格恰一次 cell 失效；单字符不溢出（走廊按文本宽收敛），失效区即本格边界
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 100, height: 32 } } },
    ])
  })

  it('updateCell 回驱：模型同步重算发出的派生格逐格刷新一次（编辑格不重复刷新）', () => {
    const model = new RecalcEchoModel(100)
    const { host, table } = createTable({ model })
    host.submitted.length = 0
    table.updateCell(0, 0, 'x')
    expect(model.setCalls).toBe(1)
    expect(findNode(host, 0, 0)?.text).toBe('x')
    // 派生格当帧更新，无需滚动或重建
    expect(findNode(host, 1, 0)?.text).toBe('derived')
    // 编辑格一次（显式刷新，echo 去重，右邻已有派生内容阻断走廊）+ 派生格一次（'derived'
    // 70px 放得下、不溢出）；两格失效区都收敛为本格边界
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 148, y: 36, width: 100, height: 32 } } },
      { kind: 'body', inv: { type: 'cell', region: { x: 48, y: 36, width: 100, height: 32 } } },
    ])
  })
})

describe('ListTable 虚拟滚动窗口', () => {
  it('10 万行 records：窗口外行列不进入场景树', () => {
    const records = Array.from({ length: 100_000 }, (_, i) => ({ name: `row-${i}` }))
    const { host, table } = createTable({ records })
    // 视口 752x564：18 行 x 8 列 = 144 个数据格，加 8 列头 + 18 行号 + 1 左上角
    expect(table.getVisibleRange()).toEqual({
      rows: { start: 0, end: 18 },
      cols: { start: 0, end: 8 },
    })
    const body = host.layers.get('body')
    // 144 个数据格 + 表头容器 + underlay 底色/外框两个全表节点（表头收进容器）
    expect(body?.root.children).toHaveLength(144 + 3)
    const headerGroup = body?.root.children.at(-2)
    expect(headerGroup?.children).toHaveLength(27)
    expect(findNode(host, 0, 0)?.text).toBe('row-0')
    expect(findNode(host, 0, 18)).toBeUndefined()

    // 滚动到底部：窗口滑到末尾行，首行节点被移出场景树
    host.submitted.length = 0
    table.scrollTo(0, Number.MAX_SAFE_INTEGER)
    expect(table.getScrollState()).toEqual({ left: 0, top: 100_000 * 32 - 564 })
    expect(table.getVisibleRange().rows).toEqual({ start: 99_982, end: 100_000 })
    expect(findNode(host, 0, 99_999)?.text).toBe('row-99999')
    expect(findNode(host, 0, 0)).toBeUndefined()
    expect(body?.root.children).toHaveLength(144 + 3)
    // 滚动 → band 失效登记的主循环（无冻结时纵向滚动带为列头以下整个视口）
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'band', region: { x: 0, y: 36, width: 800, height: 564 } } },
    ])
  })

  it('横向滚动滑动列窗口', () => {
    const { table } = createTable({
      records: Array.from({ length: 100 }, () => ({ name: 'x' })),
    })
    table.scrollTo(200, 0)
    // 内容宽 1000，视口 752：200 处可见列 2..10（列 2 左缘对齐）
    expect(table.getVisibleRange().cols).toEqual({ start: 2, end: 10 })
    expect(table.getScrollState()).toEqual({ left: 200, top: 0 })
  })
})

describe('ListTable 行列头', () => {
  it('列头取列定义 title，行号列从 1 开始，左上角占位', () => {
    const { host } = createTable({ records: [{ name: 'a' }] })
    expect(findNode(host, 0, -1)?.text).toBe('C0')
    expect(findNode(host, -1, 0)?.text).toBe('1')
    expect(findNode(host, -1, 0)?.x).toBe(0)
    expect(findNode(host, 0, -1)?.y).toBe(0)
    expect(findNode(host, -1, -1)).toBeDefined()
  })

  it('行列头随滚动跟随数据窗口', () => {
    const records = Array.from({ length: 1000 }, (_, i) => ({ name: `r${i}` }))
    const { host, table } = createTable({ records })
    table.scrollTo(0, 3200)
    // 行 100 起的行号列
    expect(findNode(host, -1, 100)?.text).toBe('101')
    // 列头横向跟随：scrollLeft 200 时列 2 的列头仍在视口内
    table.scrollTo(200, 3200)
    expect(findNode(host, 2, -1)?.x).toBe(48 + 200 - 200)
    expect(findNode(host, 2, -1)?.text).toBe('C2')
  })
})

describe('ListTable 宿主生命周期', () => {
  it('注入的 host 不随表格 destroy 销毁；自建 host 随表格销毁', () => {
    const { host, table } = createTable({ records: [] })
    table.destroy()
    expect(host.destroyed).toBe(false)

    // 自建 host 需要 DOM（container/canvas），node 环境仅校验注入路径幂等
    table.destroy()
  })
})

describe('ListTable 编辑生命周期事件', () => {
  // ListTable 不注入 doc，text-editor 走 globalThis.document；
  // 测试内临时替换为假文档（同步路径，finally 恢复），驱动真实 startEdit/commit/cancel 全链路
  it('startEdit 成功抛 onEditStart（初值基础值口径）；提交按 onCellChange→onEditEnd；取消只抛 end', () => {
    const fake = createFakeDoc()
    const globalDoc = globalThis as { document?: unknown }
    const previous = globalDoc.document
    globalDoc.document = fake.doc
    try {
      const editorRegistry = new EditorRegistry()
      editorRegistry.registerEditor('text', {})
      const { table } = createTable({
        records: [{ name: 'a' }],
        columns: [{ field: 'name', title: 'Name', editor: 'text' }],
        editorRegistry,
      })
      const starts: EditStartEvent[] = []
      const ends: EditEndEvent[] = []
      const changes: CellChangeEvent[] = []
      const offStart = table.onEditStart((event) => starts.push(event))
      table.onEditEnd((event) => ends.push(event))
      table.onCellChange((event) => changes.push(event))

      expect(table.startEdit(0, 0)).toBe(true)
      expect(starts).toEqual([{ col: 0, row: 0, initialValue: 'a' }])
      // 同格幂等：不重复抛 start
      expect(table.startEdit(0, 0)).toBe(true)
      expect(starts).toHaveLength(1)

      // 提交：onCellChange 在前、onEditEnd 在后（end 带终值）
      fake.created[0]!.value = 'b'
      expect(table.commitEdit()).toBe(true)
      expect(changes).toEqual([{ col: 0, row: 0, oldValue: 'a', newValue: 'b' }])
      expect(ends).toEqual([
        { col: 0, row: 0, initialValue: 'a', finalValue: 'b', committed: true },
      ])

      // 取消：只抛 end（committed=false），不抛 onCellChange
      expect(table.startEdit(0, 0)).toBe(true)
      table.cancelEdit()
      expect(ends).toHaveLength(2)
      expect(ends[1]).toEqual({ col: 0, row: 0, initialValue: 'b', committed: false })
      expect(changes).toHaveLength(1)

      // 退订后不再抛（取消段第二次 startEdit 后 starts 已为 2）
      offStart()
      expect(table.startEdit(0, 0)).toBe(true)
      expect(starts).toHaveLength(2)
    } finally {
      globalDoc.document = previous
    }
  })

  it('可编判定失败 startEdit 返回 false 且不抛 onEditStart', () => {
    const editorRegistry = new EditorRegistry()
    editorRegistry.registerEditor('text', {})
    const { table } = createTable({
      records: [{ name: 'a' }],
      columns: [{ field: 'name', title: 'Name', editor: 'text' }],
      editorRegistry,
      resolveEditable: () => false,
    })
    const starts: EditStartEvent[] = []
    table.onEditStart((event) => starts.push(event))
    expect(table.startEdit(0, 0)).toBe(false)
    expect(starts).toEqual([])
  })
})
