import { describe, expect, it } from 'vitest'

import { CellNode } from '../src/cell-node'
import { ListTable } from '../src/list-table'
import { StubHost } from './testing/stub-host'
import type { ListTableOptions } from '../src/types'

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

/** 在 body 场景树中按坐标找节点 */
function findNode(host: StubHost, col: number, row: number): CellNode | undefined {
  const body = host.layers.get('body')
  return body?.root.children.find(
    (child): child is CellNode =>
      child instanceof CellNode && child.col === col && child.row === row,
  )
}

/** 命中：找包围盒包含层坐标点的最浅数据格节点（合并区命中即主格节点） */
function findNodeAt(host: StubHost, x: number, y: number): CellNode | undefined {
  const body = host.layers.get('body')
  return body?.root.children.find(
    (child): child is CellNode =>
      child instanceof CellNode &&
      x >= child.x &&
      x < child.x + child.width &&
      y >= child.y &&
      y < child.y + child.height,
  )
}

const records100 = () => Array.from({ length: 100 }, (_, i) => ({ name: `r${i}` }))

describe('ListTable 冻结', () => {
  it('冻结行/列的区域划分：冻结区固定、滚动区平移、可见窗口不含冻结区', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenColCount: 1,
      frozenRowCount: 1,
    })
    // 冻结角格固定
    expect(findNode(host, 0, 0)).toMatchObject({ x: 48, y: 36 })
    // 可见窗口不含冻结行/列
    expect(table.getVisibleRange()).toEqual({
      rows: { start: 1, end: 18 },
      cols: { start: 1, end: 8 },
    })

    table.scrollTo(100, 64)
    // 冻结角不动
    expect(findNode(host, 0, 0)).toMatchObject({ x: 48, y: 36 })
    // 冻结列随纵向滚动：行 5 → y = 36 + 5*32 - 64
    expect(findNode(host, 0, 5)).toMatchObject({ x: 48, y: 132 })
    // 冻结行随横向滚动：列 3 → x = 48 + 3*100 - 100
    expect(findNode(host, 3, 0)).toMatchObject({ x: 248, y: 36 })
    // 冻结列的列头固定、滚动列的列头跟随
    expect(findNode(host, 0, -1)).toMatchObject({ x: 48, y: 0 })
    expect(findNode(host, 3, -1)).toMatchObject({ x: 248, y: 0 })
  })

  it('滚动时冻结区与滚动区分层失效：只登记滚动方向的滚动区带，冻结区不重绘', () => {
    const { host, table } = createTable({
      records: records100(),
      frozenColCount: 1,
      frozenRowCount: 1,
    })
    host.submitted.length = 0
    // 纵向滚动：冻结行（y 36..68）以下的横带
    table.scrollTo(0, 64)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'band', region: { x: 0, y: 68, width: 800, height: 532 } } },
    ])
    // 横向滚动：冻结列（x 48..148）以右的纵带
    host.submitted.length = 0
    table.scrollTo(100, 64)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'band', region: { x: 148, y: 0, width: 652, height: 600 } } },
    ])
    // 双向：两条带，仍不整表重绘
    host.submitted.length = 0
    table.scrollTo(200, 128)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'band', region: { x: 0, y: 68, width: 800, height: 532 } } },
      { kind: 'body', inv: { type: 'band', region: { x: 148, y: 0, width: 652, height: 600 } } },
    ])
  })

  it('合并区不允许跨冻结边界：构造即抛错', () => {
    expect(() =>
      createTable({
        records: records100(),
        frozenColCount: 1,
        mergeCells: [{ startCol: 0, startRow: 0, endCol: 1, endRow: 0 }],
      }),
    ).toThrow(/frozen boundary/)
  })

  it('冻结数运行时可变：setFrozenColCount/setFrozenRowCount 后冻结区、窗口与下一帧渲染即时反映', () => {
    const { host, table } = createTable({ records: records100() })
    host.submitted.length = 0
    table.setFrozenColCount(1)
    table.setFrozenRowCount(1)
    expect(table.getFrozenColCount()).toBe(1)
    expect(table.getFrozenRowCount()).toBe(1)
    // 几何变更走全量重建（两次修改各一次）
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'full' } },
      { kind: 'body', inv: { type: 'full' } },
    ])
    // 冻结角固定在行号列/列头内侧，可见窗口扣除冻结行列
    expect(findNode(host, 0, 0)).toMatchObject({ x: 48, y: 36 })
    expect(table.getVisibleRange()).toEqual({
      rows: { start: 1, end: 18 },
      cols: { start: 1, end: 8 },
    })

    // 滚动带从新冻结边界起（纵向带顶 = 列头 36 + 冻结行高 32）
    host.submitted.length = 0
    table.scrollTo(0, 64)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'band', region: { x: 0, y: 68, width: 800, height: 532 } } },
    ])
    expect(findNode(host, 0, 0)).toMatchObject({ x: 48, y: 36 })

    // 夹取到 [0, 总数]
    table.setFrozenColCount(99)
    expect(table.getFrozenColCount()).toBe(10)
    table.setFrozenColCount(-3)
    expect(table.getFrozenColCount()).toBe(0)
  })

  it('运行时改冻结数使既有合并区跨边界：抛错并保持原状', () => {
    const { host, table } = createTable({
      records: records100(),
      mergeCells: [{ startCol: 1, startRow: 0, endCol: 2, endRow: 0 }],
    })
    expect(() => table.setFrozenColCount(2)).toThrow(/frozen boundary/)
    expect(table.getFrozenColCount()).toBe(0)
    // 原状：合并区仍为 [1,0 ~ 2,0]（主格宽 200，覆盖格无节点）
    expect(findNode(host, 1, 0)).toMatchObject({ x: 148, y: 36, width: 200 })
    expect(findNode(host, 2, 0)).toBeUndefined()
  })
})

describe('ListTable 合并单元格', () => {
  it('cell-range 布局：主格跨域取值/绘制，被覆盖格不建节点', () => {
    const { host, table } = createTable({
      records: records100(),
      mergeCells: [{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }],
    })
    const master = findNode(host, 1, 1)
    // 主格跨 3 列 2 行：x = 48 + 100，y = 36 + 32，300 x 64
    expect(master).toMatchObject({ x: 148, y: 68, width: 300, height: 64, text: 'r1' })
    expect(findNode(host, 2, 1)).toBeUndefined()
    expect(findNode(host, 3, 2)).toBeUndefined()
    // 合并区取值：被覆盖格取主格文本
    expect(table.getCellText(3, 2)).toBe('r1')
  })

  it('合并区命中：覆盖格位置的命中落到主格节点', () => {
    const { host } = createTable({
      records: records100(),
      mergeCells: [{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }],
    })
    // (2,1) 格内一点（x 148..448，y 68..132）
    expect(findNodeAt(host, 200, 80)).toBe(findNode(host, 1, 1))
  })

  it('合并区刷新：覆盖格坐标的局部刷新路由到主格，失效区为主格包围盒', () => {
    const { host, table } = createTable({
      records: records100(),
      mergeCells: [{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }],
    })
    host.submitted.length = 0
    table.refreshCell(3, 2)
    expect(host.submitted).toEqual([
      { kind: 'body', inv: { type: 'cell', region: { x: 148, y: 68, width: 300, height: 64 } } },
    ])
  })

  it('主格滚出窗口但合并区部分可见时补建主格节点', () => {
    const { host, table } = createTable({
      records: records100(),
      mergeCells: [{ startCol: 0, startRow: 20, endCol: 1, endRow: 21 }],
    })
    // 窗口从行 21 起：主格行 20 在窗口外，合并区下半仍可见
    table.scrollTo(0, 672)
    expect(table.getVisibleRange().rows.start).toBe(21)
    const master = findNode(host, 0, 20)
    expect(master).toBeDefined()
    expect(master).toMatchObject({ width: 200, height: 64, text: 'r20' })
    expect(findNode(host, 1, 21)).toBeUndefined()
  })

  it('合并区运行时整体替换：setMergeCells 后渲染、取值与命中即时反映', () => {
    const { host, table } = createTable({ records: records100() })
    table.setMergeCells([{ startCol: 1, startRow: 1, endCol: 3, endRow: 2 }])
    expect(findNode(host, 1, 1)).toMatchObject({
      x: 148,
      y: 68,
      width: 300,
      height: 64,
      text: 'r1',
    })
    expect(findNode(host, 2, 1)).toBeUndefined()
    expect(table.getCellText(3, 2)).toBe('r1')
    expect(findNodeAt(host, 200, 80)).toBe(findNode(host, 1, 1))

    // 清空集合恢复逐格布局
    table.setMergeCells([])
    expect(findNode(host, 2, 1)).toBeDefined()
    expect(findNode(host, 3, 2)).toBeDefined()
  })

  it('合并区运行时增删：重叠或跨冻结边界抛错并保持原状，删除按归一化匹配', () => {
    const { host, table } = createTable({ records: records100(), frozenColCount: 1 })
    table.addMergeCell({ startCol: 2, startRow: 1, endCol: 3, endRow: 2 })
    expect(findNode(host, 2, 1)).toMatchObject({ width: 200, height: 64 })
    expect(findNode(host, 3, 2)).toBeUndefined()

    // 与既有区间重叠：抛错（overlap），集合原状
    expect(() => table.addMergeCell({ startCol: 3, startRow: 2, endCol: 4, endRow: 2 })).toThrow(
      /overlap/,
    )
    expect(findNode(host, 4, 2)).toBeDefined()

    // 跨冻结边界（冻结列 0 与滚动列 1 之间）：抛错，集合原状
    expect(() => table.addMergeCell({ startCol: 0, startRow: 5, endCol: 1, endRow: 5 })).toThrow(
      /frozen boundary/,
    )
    expect(findNode(host, 0, 5)).toMatchObject({ width: 100 })
    expect(findNode(host, 1, 5)).toBeDefined()

    // 逆序坐标删除同一区间（归一化匹配），逐格恢复
    table.removeMergeCell({ startCol: 3, startRow: 2, endCol: 2, endRow: 1 })
    expect(findNode(host, 2, 1)).toBeDefined()
    expect(findNode(host, 3, 2)).toBeDefined()
  })
})

describe('ListTable 逐格样式 hook', () => {
  it('resolveCellStyle 投影到节点样式：覆盖字段生效，未覆盖继承主题，边框逐边独立', () => {
    const { host } = createTable({
      records: records100(),
      resolveCellStyle: (col, row) =>
        col === 0 && row === 0
          ? { background: '#fafafa', border: { left: { width: 2, color: '#f00' } } }
          : null,
    })
    const styled = findNode(host, 0, 0)
    expect(styled?.style.background).toBe('#fafafa')
    expect(styled?.style.color).toBe('#1f2329')
    expect(styled?.style.border).toEqual({ left: { width: 2, color: '#f00' } })
    // 未命中的格沿用主题样式且无边框
    const plain = findNode(host, 1, 0)
    expect(plain?.style.background).toBe('#ffffff')
    expect(plain?.style.border).toBeUndefined()
  })
})

describe('ListTable 列级样式投影缓存', () => {
  it('列级投影按列缓存：同列未命中 hook 的格共享同一投影对象且值等价', () => {
    const { host } = createTable({
      records: records100(),
      columns: Array.from({ length: 10 }, (_, i) => ({
        field: 'name',
        title: `C${i}`,
        textWrap: i === 1,
        style:
          i === 1
            ? { color: '#ff0000', border: { left: { width: 2, color: '#f00' } } }
            : undefined,
      })),
    })
    const a = findNode(host, 1, 0)
    const b = findNode(host, 1, 5)
    // 列级 textWrap 旗标并入主题层、列级样式覆盖生效，同列共享缓存对象
    expect(a?.style.textWrap).toBe(true)
    expect(a?.style.color).toBe('#ff0000')
    expect(a?.style.border).toEqual({ left: { width: 2, color: '#f00' } })
    expect(b?.style).toBe(a?.style)
    // 无列级样式的列同样按列缓存（共享主题投影对象）
    expect(findNode(host, 0, 0)?.style).toBe(findNode(host, 0, 9)?.style)
  })

  it('按格 hook 命中才做第二级投影：值与三级覆盖链等价，未命中格不受影响', () => {
    const { host } = createTable({
      records: records100(),
      columns: Array.from({ length: 10 }, (_, i) => ({
        field: 'name',
        title: `C${i}`,
        style: i === 1 ? { color: '#ff0000' } : undefined,
      })),
      resolveCellStyle: (col, row) =>
        col === 1 && row === 3 ? { background: '#00ff00' } : null,
    })
    const hooked = findNode(host, 1, 3)
    // 三级链逐字段等价：hook 覆盖 background，未给字段沿用列级/主题
    expect(hooked?.style.background).toBe('#00ff00')
    expect(hooked?.style.color).toBe('#ff0000')
    // hook 命中格与未命中格对象不同，未命中格仍共享列级缓存
    const plain = findNode(host, 1, 0)
    expect(hooked?.style).not.toBe(plain?.style)
    expect(findNode(host, 1, 5)?.style).toBe(plain?.style)
  })
})

describe('ListTable 自定义渲染 hook 与单元格类型', () => {
  it('resolveCellRenderer 接管任意格内容绘制（与取值管线解耦）', () => {
    const { host } = createTable({
      records: records100(),
      resolveCellRenderer: (col, row) =>
        col === 1 && row === 1 ? (target) => target.ctx.fillRect(0, 0, 5, 5) : null,
    })
    expect(findNode(host, 1, 1)?.renderer).toBeTypeOf('function')
    expect(findNode(host, 0, 1)?.renderer).toBeNull()
  })

  it('checkbox 类型：列定义 cellType 生效，基础值即勾选态', () => {
    const { host } = createTable({
      columns: [
        { field: 'done', title: 'Done', cellType: 'checkbox' },
        { field: 'name', title: 'Name' },
      ],
      records: [
        { done: true, name: 'a' },
        { done: false, name: 'b' },
      ],
    })
    expect(findNode(host, 0, 0)).toMatchObject({ cellType: 'checkbox', value: true })
    expect(findNode(host, 0, 1)).toMatchObject({ cellType: 'checkbox', value: false })
    // 缺省 text 类型
    expect(findNode(host, 1, 0)?.cellType).toBe('text')
  })
})
